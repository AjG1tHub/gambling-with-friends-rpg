// Gemini image ("Nano Banana") adapter for edits that must stay consistent with a parent asset: pet stage 2 from
// stage 1 (and 3 from 2), a monster's hex token from its portrait, rarity recolours. Image-to-image: the parent
// PNG is attached as inline_data and the prompt describes only the change.
//   GEMINI_API_KEY        required
//   GEMINI_IMAGE_MODEL    default gemini-2.5-flash-image (Nano Banana); gemini-3-pro-image-preview for Pro
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { env, ROOT, isReal } from '../lib.mjs';
import { request, charge, assertBudget } from './_http.mjs';

const MODEL = () => env('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image');
const COST = () => Number(env('GEMINI_COST_IMAGE', 0.04));
const key = () => { const k = env('GEMINI_API_KEY'); if (!k) throw new Error('GEMINI_API_KEY missing from .env.local'); return k; };

// The parent asset for a row: the previous pet stage, or the monster portrait for a token.
export function parentFor(row, rowsByKey) {
  const [g, id] = row.key.split('/');
  if (g === 'pets' && row.meta?.stage > 1) return rowsByKey[`pets/${row.meta.species}_${row.meta.stage - 1}`] || null;
  if (g === 'monsters' && row.meta?.token) return rowsByKey[`monsters/${id.replace(/_token$/, '')}`] || null;
  return null;
}

export async function edit({ parentPng, prompt, mime = 'image/png' }) {
  assertBudget(COST());
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: parentPng.toString('base64') } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } };
  const res = await request(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key() }, body, label: `gemini ${MODEL()}` });
  charge(COST());
  const parts = res?.candidates?.[0]?.content?.parts || [];
  const img = parts.find(p => p.inline_data?.data || p.inlineData?.data); if (!img) throw new Error(`gemini: no image in response (${JSON.stringify(res).slice(0, 300)})`);
  return Buffer.from((img.inline_data || img.inlineData).data, 'base64');
}

export async function generate(row, prompt, { seed = 0, log = () => {}, rowsByKey = {} } = {}) {
  const parent = parentFor(row, rowsByKey);
  if (!parent) throw new Error(`gemini: ${row.key} has no parent asset to edit`);
  if (!isReal(parent)) throw new Error(`gemini: parent ${parent.key} is still a placeholder — generate it first`);
  const parentPng = readFileSync(path.join(ROOT, parent.path));
  log(`  gemini edit from ${parent.key}`);
  // Gemini has no seed; the attempt number only varies the wording so a redo is not identical.
  const out = await edit({ parentPng, prompt: seed ? `${prompt}\n(variation ${seed % 97})` : prompt });
  return Object.assign(out, { _model: MODEL(), _parent: parent.key });
}

export async function probe() {
  const res = await request(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}`, { headers: { 'x-goog-api-key': key() }, label: 'gemini model', retries: 1 });
  return [`${MODEL()}: ${res.supportedGenerationMethods?.join(', ') || 'reachable'}`];
}
