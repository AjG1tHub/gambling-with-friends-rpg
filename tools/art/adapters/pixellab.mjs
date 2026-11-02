// PixelLab adapter (https://api.pixellab.ai/v2). Pixel-art rows: paper-doll body sheets, faces, hair, class
// outfits, worn-item layers, Legendary layers, the lantern, pets (stage 1 and eggs) and monster hex tokens when
// no real portrait exists yet.
//
// How each row is made (the adapter returns { frames: [Buffer], layout } for sheets, or a Buffer for one image;
// post.py assembles the strip, diffs worn layers against the base body and quantises):
//   body/<build>_<skin>   one 64×96 idle frame from text (create-image-pixflux, transparent background), then one
//                         animate-with-text-v3 job per pose (idle 4, attack 6, hit 2, death 6, step 4) from that frame.
//   face / hair / outfit  the reference body frame for each pose as init_image, asked to add the feature → post.py
//   worn / legendary      diffs the result against the bare body so only the added pixels survive (SPEC.md › sprites).
//   lantern/<state>       one 128×128 frame from text, then a 4-frame flicker animation.
//   pets/<species>_1, egg one 128×128 image from text (nearest-neighbour ×4 to the 512 spec size in post.py).
//   monsters/<id>_token   one 128×128 head token from text (×2 to 256 in post.py).
// Endpoints and field names follow the v2 OpenAPI document (api.pixellab.ai/v2/openapi.json). Run
// `node tools/art/pipeline.mjs --probe pixellab` once on the PC: it fetches that document and reports any field
// this adapter sends that the live schema does not list, so API drift is a one-line fix in PIXELLAB_FIELDS below.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { env, ROOT, PATHS, readJSONFile, writeJSONFile } from '../lib.mjs';
import { request, poll, charge, assertBudget, dataUriToBuffer, bufferToDataUri } from './_http.mjs';
import { PNG } from '../png-io.mjs';

const BASE = () => env('PIXELLAB_BASE', 'https://api.pixellab.ai/v2');
const headers = () => { const k = env('PIXELLAB_API_KEY'); if (!k) throw new Error('PIXELLAB_API_KEY missing from .env.local'); return { authorization: `Bearer ${k}` }; };
// Cost per generation in USD, used only for the spend cap (PixelLab bills in plan credits; tune in .env.local).
const COST = { image: Number(env('PIXELLAB_COST_IMAGE', 0.02)), animation: Number(env('PIXELLAB_COST_ANIMATION', 0.08)) };
// Field names this adapter relies on; the probe checks them against the live schema.
export const PIXELLAB_FIELDS = {
  '/create-image-pixflux': ['description', 'negative_description', 'image_size', 'no_background', 'init_image', 'init_image_strength', 'seed', 'text_guidance_scale'],
  '/animate-with-text-v3': ['first_frame', 'action', 'frame_count', 'seed'],
  '/background-jobs/{background_job_id}': [],
};

const img = (buf) => ({ type: 'base64', base64: bufferToDataUri(buf) });
const sizeOf = (w, h) => ({ width: w, height: h });

async function pixflux({ description, negative = '', w, h, init = null, strength = 300, seed = 0, noBackground = true }) {
  assertBudget(COST.image);
  const body = { description: description.slice(0, 1500), image_size: sizeOf(w, h), no_background: noBackground, seed: seed >>> 0 };
  if (negative) body.negative_description = negative.slice(0, 600);
  if (init) { body.init_image = img(init); body.init_image_strength = strength; }
  const res = await request(`${BASE()}/create-image-pixflux`, { method: 'POST', headers: headers(), body, label: 'pixellab pixflux' });
  charge(COST.image);
  const b64 = res?.image?.base64 || res?.images?.[0]?.base64; if (!b64) throw new Error(`pixellab pixflux: no image in response (${JSON.stringify(res).slice(0, 200)})`);
  return dataUriToBuffer(b64);
}
async function animate({ firstFrame, action, frames, seed = 0 }) {
  assertBudget(COST.animation);
  const body = { first_frame: img(firstFrame), action, frame_count: frames, seed: seed >>> 0 };
  const sub = await request(`${BASE()}/animate-with-text-v3`, { method: 'POST', headers: headers(), body, label: 'pixellab animate' });
  charge(COST.animation);
  const jobId = sub.background_job_id; if (!jobId) throw new Error('pixellab animate: no background_job_id');
  const job = await poll(async () => { const j = await request(`${BASE()}/background-jobs/${jobId}`, { headers: headers(), label: 'pixellab job' }); if (j.status === 'failed' || j.status === 'error') throw new Error(`pixellab animate failed: ${JSON.stringify(j.last_response || j).slice(0, 300)}`); return j.status === 'completed' ? j : null; }, { label: 'pixellab animate' });
  const images = job.last_response?.images || job.last_response?.frames || []; if (!images.length) throw new Error('pixellab animate: no frames in completed job');
  return images.map(x => dataUriToBuffer(x.base64 || x));
}

// Reference body frames: one PNG per pose cut from assets/sprites/body/<ref>.png (real art once it lands, the
// placeholder meanwhile — the diff still works because post.py diffs against the very frame it sent).
const POSES = { idle: 4, attack: 6, hit: 2, death: 6, step: 4 }, POSE_ORDER = ['idle', 'attack', 'hit', 'death', 'step'];
export function bodyFramesForPoses(ref = env('ART_BODY_REF', '1_1')) {
  const p = path.join(ROOT, `assets/sprites/body/${ref}.png`); if (!existsSync(p)) throw new Error(`reference body ${ref} missing`);
  const sheet = PNG.decode(readFileSync(p)); const out = {}; let at = 0;
  for (const pose of POSE_ORDER) { out[pose] = PNG.encode(PNG.crop(sheet, at * 64, 0, 64, 96)); at += POSES[pose]; }
  return out;
}
const ACTIONS = { idle: 'standing idle, breathing, slight bob, facing three-quarter front', attack: 'swings the weapon in the right hand in a fast arc, lunges forward, returns to stance', hit: 'recoils backwards from a hit, flinches', death: 'staggers, crumples and collapses to the ground, lying still', step: 'walks in place, a short careful step cycle' };
const POSE_PROMPT = { idle: 'standing idle', attack: 'mid-swing, weapon arm extended', hit: 'flinching back', death: 'collapsed lying on the ground', step: 'mid-step' };

export async function generate(row, prompt, { negative = '', seed = 0, log = () => {} } = {}) {
  const g = row.group, id = row.key.split('/')[1];
  if (g === 'body') {
    const first = await pixflux({ description: `${prompt}\n${POSE_PROMPT.idle}`, negative, w: 64, h: 96, seed });
    const frames = [];
    for (const pose of POSE_ORDER) { log(`  animate ${pose} ×${POSES[pose]}`); const fr = await animate({ firstFrame: first, action: ACTIONS[pose], frames: POSES[pose], seed: seed + POSE_ORDER.indexOf(pose) }); frames.push(...fr.slice(0, POSES[pose])); while (frames.length < POSE_ORDER.slice(0, POSE_ORDER.indexOf(pose) + 1).reduce((a, p) => a + POSES[p], 0)) frames.push(fr[fr.length - 1]); }
    return { frames, layout: 'body', frameW: 64, frameH: 96 };
  }
  if (['face', 'hair', 'outfit', 'worn', 'legendary'].includes(g)) {
    const refs = bodyFramesForPoses(); const frames = [], bases = [];
    const strength = Number(env('PIXELLAB_LAYER_STRENGTH', g === 'face' || g === 'hair' ? 420 : 350));
    for (const pose of POSE_ORDER) { log(`  layer ${pose}`); const out = await pixflux({ description: `${prompt}\nSame figure, same pose (${POSE_PROMPT[pose]}), identical outline; only add the ${g === 'face' ? 'face' : g === 'hair' ? 'hair' : 'worn item'}.`, negative, w: 64, h: 96, init: refs[pose], strength, seed: seed + POSE_ORDER.indexOf(pose) }); frames.push(out); bases.push(refs[pose]); }
    return { frames, bases, layout: 'layer', frameW: 64, frameH: 96, diff: true };
  }
  if (g === 'lantern') {
    const first = await pixflux({ description: prompt, negative, w: 128, h: 128, seed });
    const fr = await animate({ firstFrame: first, action: id === 'dead' ? 'the dead lantern hangs still, a wisp of smoke drifts' : id === 'out' ? 'the last ember flickers weakly and nearly dies' : id === 'guttering' ? 'the flame gutters and sputters in the wind' : 'the flame burns steady with a gentle dance', frames: 4, seed });
    return { frames: fr.slice(0, 4), layout: 'strip', frameW: 128, frameH: 128 };
  }
  if (g === 'pets' || (g === 'monsters' && row.meta?.token)) return pixflux({ description: prompt, negative, w: 128, h: 128, seed });
  // Anything else routed here by hand (--tool pixellab): one image at the row's genSize or size, capped at 400×400 area.
  const [w0, h0] = row.genSize || row.size; const scale = Math.min(1, Math.sqrt(160000 / (w0 * h0))); const w = Math.max(16, Math.round(w0 * scale / 4) * 4), h = Math.max(16, Math.round(h0 * scale / 4) * 4);
  return pixflux({ description: prompt, negative, w, h, seed });
}

// Fetch the live OpenAPI document and report any field this adapter sends that the schema does not list.
export async function probe() {
  const spec = await request(`${BASE()}/openapi.json`, { label: 'pixellab openapi', retries: 1 });
  const out = [];
  for (const [p, fields] of Object.entries(PIXELLAB_FIELDS)) {
    const op = spec.paths?.[p]; if (!op) { out.push(`MISSING PATH ${p}`); continue; }
    const post = op.post; if (!post) continue;
    let schema = post.requestBody?.content?.['application/json']?.schema || {};
    if (schema.$ref) schema = spec.components?.schemas?.[schema.$ref.split('/').pop()] || {};
    const props = Object.keys(schema.properties || {});
    const bad = fields.filter(f => props.length && !props.includes(f));
    out.push(`${p}: ${bad.length ? 'UNKNOWN FIELDS ' + bad.join(', ') : 'ok'}${props.length ? ` (schema has: ${props.join(', ')})` : ' (schema not inline)'}`);
  }
  writeJSONFile(path.join(PATHS.cache, 'pixellab-openapi.json'), spec);
  return out;
}
