// fal.ai adapter: FLUX.2 for every icon set that must match (items, gear, consumables, tile glyphs, badges,
// letters, cards, dice, UI, rarity-frame sources, wheel textures). Queue REST API: POST queue.fal.run/<model>,
// poll status_url, GET response_url, download images[0].url. Fixed seed per row (hash32(key)).
//
// Models (override in .env.local when fal renames an endpoint; `--probe fal` fetches each endpoint's OpenAPI):
//   FAL_T2I_MODEL        text → image without a LoRA            default fal-ai/flux-2-pro
//   FAL_LORA_MODEL       text → image with the trained LoRA     default fal-ai/flux-2/klein/9b/lora
//   FAL_TRAINER_MODEL    LoRA trainer                           default fal-ai/flux-2-trainer
// Licence rule from the spec: ship only [pro] or [klein] output. The adapter refuses a model id containing
// "/dev" unless FAL_ALLOW_DEV=1 (and then marks the ledger entry licence 'NON-COMMERCIAL — do not ship').
import { env, PATHS, readJSONFile, writeJSONFile, styleRefs, isPixelRow } from '../lib.mjs';
import { request, poll, charge, assertBudget, download } from './_http.mjs';
import path from 'node:path';

const T2I = () => env('FAL_T2I_MODEL', 'fal-ai/flux-2-pro');
const LORA_MODEL = () => env('FAL_LORA_MODEL', 'fal-ai/flux-2/klein/9b/lora');
const TRAINER = () => env('FAL_TRAINER_MODEL', 'fal-ai/flux-2-trainer');
const headers = () => { const k = env('FAL_KEY'); if (!k) throw new Error('FAL_KEY missing from .env.local'); return { authorization: `Key ${k}` }; };
// USD per image for the spend cap (fal lists per-megapixel prices; these are round numbers, tune in .env.local).
const COST = { pro: Number(env('FAL_COST_PRO', 0.03)), klein: Number(env('FAL_COST_KLEIN', 0.015)), train: Number(env('FAL_COST_TRAIN', 2.5)) };
const ownerApp = (model) => model.split('/').slice(0, 2).join('/');
export const licenceFor = (model) => /\/dev\b/.test(model) ? 'FLUX.2 [dev] — NON-COMMERCIAL, do not ship' : /klein/.test(model) ? 'FLUX.2 [klein] via fal.ai (commercial)' : 'FLUX.2 [pro] via fal.ai (commercial)';
function guardLicence(model) { if (/\/dev\b/.test(model) && env('FAL_ALLOW_DEV') !== '1') throw new Error(`refusing ${model}: FLUX.2 [dev] output is non-commercial (set FAL_ALLOW_DEV=1 only for throwaway tests)`); }

// Submit to the queue and wait for the result object.
export async function run(model, input, { label = model } = {}) {
  guardLicence(model);
  const sub = await request(`https://queue.fal.run/${model}`, { method: 'POST', headers: headers(), body: input, label: `fal submit ${label}` });
  const statusUrl = sub.status_url || `https://queue.fal.run/${ownerApp(model)}/requests/${sub.request_id}/status`;
  const resultUrl = sub.response_url || `https://queue.fal.run/${ownerApp(model)}/requests/${sub.request_id}`;
  await poll(async () => { const s = await request(statusUrl, { headers: headers(), label: `fal status ${label}` }); if (s.status === 'COMPLETED') { if (s.error) throw new Error(`fal ${label}: ${s.error_type || ''} ${s.error}`); return s; } return null; }, { everyMs: 3000, maxMs: 60 * 60 * 1000, label: `fal ${label}` });
  return request(resultUrl, { headers: headers(), label: `fal result ${label}` });
}

// Which LoRA (if any) applies to a group: the icon LoRA for pixel/icon sets, the portrait LoRA for painted sets.
export function loraFor(row) {
  const refs = styleRefs(); const kind = isPixelRow(row) ? 'icons' : 'portraits';
  const l = refs.loras?.[kind]; return l?.url ? { kind, url: l.url, scale: Number(env('FAL_LORA_SCALE', 0.85)) } : null;
}
const genSize = (row) => { const [w, h] = row.genSize || row.size; const s = Math.min(1, 1024 / Math.max(w, h)); return { width: Math.max(256, Math.round(w * s / 16) * 16), height: Math.max(256, Math.round(h * s / 16) * 16) }; };

export async function generate(row, prompt, { negative = '', seed = 0, log = () => {} } = {}) {
  const lora = loraFor(row); const model = lora ? LORA_MODEL() : T2I();
  const cost = /klein/.test(model) ? COST.klein : COST.pro; assertBudget(cost);
  const input = { prompt: negative ? `${prompt}\n\nAvoid: ${negative}` : prompt, image_size: genSize(row), seed: seed >>> 0, num_images: 1, output_format: 'png', enable_safety_checker: false };
  if (lora) input.loras = [{ path: lora.url, scale: lora.scale }];
  log(`  fal ${model}${lora ? ` + ${lora.kind} LoRA` : ''} ${input.image_size.width}×${input.image_size.height}`);
  const res = await run(model, input, { label: row.key });
  charge(cost);
  const url = res?.images?.[0]?.url; if (!url) throw new Error(`fal ${row.key}: no image in result (${JSON.stringify(res).slice(0, 200)})`);
  const buf = await download(url, `fal image ${row.key}`);
  return Object.assign(buf, { _model: model, _licence: licenceFor(model) });
}

// Train a style LoRA from a zip of approved images (+ optional captions). `zipUrl` must be public or a fal
// storage URL; `tools/art/train-lora.mjs` uploads the approved style folder and calls this.
export async function train({ zipUrl, caption, steps = Number(env('FAL_LORA_STEPS', 1000)), kind }) {
  assertBudget(COST.train);
  const res = await run(TRAINER(), { image_data_url: zipUrl, default_caption: caption, steps, output_lora_format: 'fal' }, { label: `train ${kind}` });
  charge(COST.train);
  const url = res?.diffusers_lora_file?.url || res?.lora_file?.url; if (!url) throw new Error(`fal trainer: no LoRA file in result (${JSON.stringify(res).slice(0, 300)})`);
  const refs = styleRefs(); refs.loras = { ...(refs.loras || {}), [kind]: { url, trainer: TRAINER(), steps, caption, config: res?.config_file?.url || null, date: new Date().toISOString().slice(0, 10) } };
  writeJSONFile(PATHS.styleRefs, refs);
  return refs.loras[kind];
}

// Upload a local file to fal storage (returns a URL the trainer can read). Uses the documented initiate-upload flow.
export async function upload(buf, filename, contentType = 'application/zip') {
  const init = await request('https://rest.alpha.fal.ai/storage/upload/initiate', { method: 'POST', headers: headers(), body: { file_name: filename, content_type: contentType }, label: 'fal upload initiate' });
  await request(init.upload_url, { method: 'PUT', headers: { 'content-type': contentType }, body: buf, expect: 'response', label: 'fal upload put', retries: 2 });
  return init.file_url;
}

export async function probe() {
  const out = [];
  for (const [name, model] of [['T2I', T2I()], ['LoRA', LORA_MODEL()], ['trainer', TRAINER()]]) {
    try {
      const spec = await request(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(model)}`, { label: `fal openapi ${model}`, retries: 1 });
      const schemas = spec.components?.schemas || {}; const inputName = Object.keys(schemas).find(k => /Input$/.test(k)); const props = Object.keys(schemas[inputName]?.properties || {});
      out.push(`${name} ${model}: ok (${inputName}: ${props.join(', ')})${name === 'LoRA' && !props.includes('loras') ? ' — WARNING: no `loras` field, set FAL_LORA_MODEL to a LoRA-capable endpoint' : ''}${name === 'trainer' && !props.includes('image_data_url') ? ' — WARNING: trainer input differs from the adapter' : ''}`);
      writeJSONFile(path.join(PATHS.cache, `fal-${model.replace(/\//g, '_')}.json`), spec);
    } catch (e) { out.push(`${name} ${model}: ${e.message}`); }
  }
  return out;
}
