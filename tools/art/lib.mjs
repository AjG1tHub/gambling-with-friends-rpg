// Shared plumbing for the art pipeline: .env.local, the asset rows with their prompt slots, prompt templates,
// adapter routing, the ledger, the review file, the inbox, seeds and the spend cap. Nothing here edits game
// code or data/*.json; everything it writes lives under assets/ (the files themselves) and art/ (the records).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, buildAssetList, loadData, readJSON, PALETTE, RARITY_COLOURS, FAMILY_COLOURS, SECRET_COLOURS, FOOTPRINT_BY_SLOT } from '../asset-list.mjs';
import { isPlaceholderFile } from '../placeholders.mjs';

export { ROOT, PALETTE, RARITY_COLOURS, FAMILY_COLOURS, SECRET_COLOURS };
export const ART = path.join(ROOT, 'art');
export const PATHS = {
  ledger: path.join(ART, 'ledger.json'),
  review: path.join(ART, 'review.json'),
  notes: path.join(ART, 'notes.json'),
  style: path.join(ART, 'style'),
  styleRefs: path.join(ART, 'style', 'refs.json'),
  inbox: path.join(ART, 'inbox'),
  cache: path.join(ART, 'cache'),
  queues: { midjourney: path.join(ART, 'midjourney', 'queue.md'), suno: path.join(ART, 'suno', 'queue.md') },
  prompts: path.join(ROOT, 'tools', 'art', 'prompts'),
};

// ── .env.local ──────────────────────────────────────────────────────
export function loadEnv() {
  const p = path.join(ROOT, '.env.local');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return process.env;
}
export const env = (name, dflt = undefined) => { const v = process.env[name]; return v === undefined || v === '' ? dflt : v; };
export const budgetUSD = () => Number(env('ART_BUDGET_USD', 25));

// ── seeds, hashes, files ────────────────────────────────────────────
export function hash32(str) { let h = 2166136261 >>> 0; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
export const seedFor = (key, attempt = 0) => hash32(attempt ? `${key}#${attempt}` : key);
export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
export const promptHash = (text) => sha1(Buffer.from(text, 'utf8')).slice(0, 12);
export const readJSONFile = (p, dflt) => { if (!existsSync(p)) return dflt; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return dflt; } };
export function writeJSONFile(p, obj) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 1) + '\n'); }
export const today = () => new Date().toISOString().slice(0, 10);

// Is the file at row.path real art (exists and carries no placeholder marker)?
export function isReal(row) {
  const abs = path.join(ROOT, row.path); if (!existsSync(abs)) return false;
  return !isPlaceholderFile(readFileSync(abs), row.kind);
}

// ── Adapter routing ─────────────────────────────────────────────────
// Which tool draws which group (the prompt's tool table). `svgwrap` means: a raster texture from fal, then post.py
// wraps it into the SVG the renderer expects. Tokens come from the monster's portrait through Gemini when the
// portrait is real, and from PixelLab otherwise. Rarity frames are one 9-slice source per rarity (fal), sliced
// into the six footprints by post.py.
export const TOOL_BY_GROUP = {
  monsters: 'midjourney', stages: 'midjourney', map: 'midjourney', crest: 'midjourney',
  tiles: 'fal',                      // glyphs; ground_/void_ textures are overridden to midjourney below
  body: 'pixellab', face: 'pixellab', hair: 'pixellab', outfit: 'pixellab', worn: 'pixellab', legendary: 'pixellab', lantern: 'pixellab', pets: 'pixellab',
  items: 'fal', gear: 'fal', consumables: 'fal', badges: 'fal', letters: 'fal', cards: 'fal', dice: 'fal', ui: 'fal', tv: 'fal', frames: 'fal', wheels: 'fal',
  sound: 'elevenlabs',
};
export const PIXEL_GROUPS = new Set(['tiles', 'body', 'face', 'hair', 'outfit', 'worn', 'legendary', 'lantern', 'pets', 'items', 'gear', 'consumables', 'badges', 'letters', 'cards', 'dice', 'ui', 'tv', 'frames']);
export const PAINTED_GROUPS = new Set(['monsters', 'stages', 'map', 'crest', 'wheels']);
export function toolFor(row) {
  if (row.group === 'tiles' && /^tiles\/(ground|void)_/.test(row.key)) return 'midjourney';
  if (row.group === 'sound') return row.meta?.music ? 'suno' : 'elevenlabs';
  if (row.group === 'monsters' && row.meta?.token) return 'gemini';
  if (row.group === 'pets' && row.key.startsWith('pets/attack_')) return 'fal';
  if (row.group === 'pets' && row.meta?.stage > 1) return 'gemini';          // stage 2 and 3 are edits of stage 1
  return TOOL_BY_GROUP[row.group] || 'fal';
}
export const isManualTool = (tool) => tool === 'midjourney' || tool === 'suno';
export const isPixelRow = (row) => PIXEL_GROUPS.has(row.group) && !(row.group === 'tiles' && /^tiles\/(ground|void)_/.test(row.key));

// ── Prompt slots: everything a template can mention, from the data files ─
let _data = null, _names = null;
export function data() { return _data || (_data = loadData()); }
function names() {
  if (_names) return _names;
  const n = { monsters: {}, pets: {}, items: {}, bases: {}, legendaries: {}, regions: {}, tiles: {}, classes: {}, wheels: {} };
  for (const s of readJSON('data/monsters.json')?.species || []) n.monsters[s.id] = s;
  for (const s of readJSON('data/pets.json')?.species || []) n.pets[s.id] = s;
  for (const i of readJSON('data/items36.json')?.items || []) n.items[i.id] = i;
  const bases = readJSON('data/bases.json') || {};
  for (const [slot, list] of Object.entries(bases)) if (Array.isArray(list)) for (const b of list) if (b?.id) n.bases[b.id] = { ...b, slot };
  for (const b of readJSON('data/boots.json')?.bases || []) n.bases[b.id] = { ...b, slot: 'boots' };
  for (const l of readJSON('data/legendaries.json')?.legendaries || []) n.legendaries[l.id] = l;
  for (const r of readJSON('data/regions.json')?.regions || []) n.regions[r.id] = r;
  for (const [id, t] of Object.entries(readJSON('data/tiles.json')?.tiles || {})) n.tiles[id] = t;
  for (const c of readJSON('data/classes.json')?.classes || []) n.classes[c.id] = c;
  const w = readJSON('data/wheels.json') || {}; for (const [id, def] of Object.entries(w)) if (!id.startsWith('_')) n.wheels[id] = def;
  return (_names = n);
}
const title = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const regionOf = (id) => names().regions[id] || data().regions.find(r => r.id === id) || null;

// The slot values for one row. Templates reference them as {name}, {flavour}, {region}, {accent}, {accentName},
// {footprint}, {stage}, {element}, {letter}, {labels}, {kind}, {family}, {slot}, {rarity}, {role}, {cue}, {frames},
// {look}, {mark}, {pose}, {sides}, {tier}, {species}, {stageName}, {notes}.
export function slotsFor(row) {
  const N = names(); const [group, id] = row.key.split('/'); const m = row.meta || {};
  const s = { key: row.key, group, id, name: row.name && row.name !== row.key ? row.name : title(id), flavour: '', region: '', regionName: '', accent: '', accentName: '', footprint: m.footprint || '', stage: m.stage || '', element: '', letter: m.letter || '', labels: (m.labels || []).join(', '), kind: m.kind || '', family: m.family || '', slot: m.slot || row.sprite?.slot || '', rarity: m.rarity || '', role: m.role || '', cue: m.cue || '', frames: row.sprite?.frames || m.frames || '', look: '', mark: m.mark || '', sides: m.sides || '', tier: m.tier || '', species: m.species || '', stageName: '', className: '', notes: notesFor(row.key), size: row.size ? row.size.join('x') : '', poses: row.sprite ? Object.keys(row.sprite.poses).join(', ') : '' };
  const setRegion = (rid) => { const r = regionOf(rid); if (!r) return; s.region = r.id; s.regionName = r.name; s.accent = r.accent; s.accentName = r.accentName || r.accent; s.look = r.look || ''; };
  if (m.region) setRegion(m.region);
  if (group === 'monsters') { const mon = N.monsters[id.replace(/_token$/, '')]; if (mon) { s.name = mon.name; s.flavour = mon.flavour || ''; setRegion(mon.regionId); s.tier = mon.tier || ''; s.role = mon.role || s.role; } }
  if (group === 'pets') { const sp = N.pets[m.species || id.replace(/^egg_|^attack_/, '')]; if (sp) { s.species = sp.id; s.element = sp.element || ''; s.flavour = sp.flavour || ''; setRegion(sp.regionBias); const st = sp.stages?.[(m.stage || 1) - 1]; s.stageName = st?.name || sp.name; s.name = m.egg ? `${sp.name} egg` : st?.name || sp.name; } }
  if (group === 'items' || group === 'worn') { const it = N.items[id]; if (it) { s.name = it.name; s.flavour = it.goal || it.howTo || ''; s.kind = it.kind; s.family = it.family; } const b = N.bases[id]; if (b) { s.name = b.name || title(id); s.slot = b.slot; s.flavour = b.text || b.flavour || ''; s.footprint = s.footprint || FOOTPRINT_BY_SLOT[b.slot] || ''; } }
  if (id.startsWith('twohand_')) { s.family = id.slice(8); s.name = `Two-handed ${title(s.family)} weapon`; s.kind = 'attack'; s.footprint = '2x4'; }
  if (group === 'gear') { const b = N.bases[id]; if (b) { s.name = b.name || title(id); s.flavour = b.text || b.flavour || ''; } }
  if (group === 'legendary') { const l = N.legendaries[id]; if (l) { s.name = l.name; s.flavour = l.text || ''; s.slot = l.slot; } }
  if (group === 'tiles') { const t = N.tiles[id]; if (t) { s.name = t.name; s.flavour = t.text || ''; } if (/^(ground|void)_/.test(id)) { setRegion(id.replace(/^(ground|void)_/, '')); s.name = row.name; } }
  if (group === 'crest' || group === 'outfit' || (group === 'ui' && id.startsWith('active_')) || (group === 'letters' && id.startsWith('seal_'))) { const c = N.classes[id.replace(/^active_|^seal_/, '')]; if (c) { s.mark = c.mark; s.flavour = c.playsLike || ''; s.className = c.name; s.name = s.name.includes(c.name) ? s.name : `${c.name} ${group === 'crest' ? 'crest' : group === 'outfit' ? 'base outfit' : group === 'ui' ? 'active icon' : 'wax seal'}`; } }
  if (group === 'wheels') { const w = N.wheels[id]; if (w?.name) s.name = w.name; }
  if (group === 'stages') { s.family = m.family || ''; s.accent = FAMILY_COLOURS[m.family] || ''; s.accentName = { dice: 'bone white', cards: 'oxblood', wheels: 'tarnished gold', nerve: 'candle amber', picks: 'verdigris' }[m.family] || ''; }
  if (group === 'frames') { s.accent = RARITY_COLOURS[m.rarity] || ''; s.accentName = { common: 'tarnished brass', rare: 'tarnished silver', epic: 'worn gold', legendary: 'bone white' }[m.rarity] || ''; }
  if (group === 'cards') { s.accent = m.hex || ''; s.element = m.colour || ''; s.accentName = m.colour || ''; }
  if (group === 'sound') { s.name = title(m.cue); if (m.music) setRegion(m.cue.replace('music_', '')); }
  if (!s.accent) { s.accent = PALETTE.gold2; s.accentName = 'tarnished gold'; }
  if (!s.accentName) s.accentName = s.accent;
  return s;
}

// Prompt notes from docs/ASSET-LIST.xlsx (via tools/art/notes.mjs → art/notes.json). Empty when not extracted.
let _notes = null;
export function notesFor(key) { if (!_notes) _notes = readJSONFile(PATHS.notes, {}); return _notes[key]?.notes || ''; }

// ── Templates: tools/art/prompts/<group>.md ─────────────────────────
// Format: a `tool:` line is optional (routing is in toolFor); `## style` is the shared preamble (from _style.md when
// the group file has none), `## prompt` is the body, `## negative` the negatives, `## variants` optional per-id
// overrides as `- <id-prefix>: text`. {slot} placeholders are filled from slotsFor(row).
const sections = (md) => { const out = {}; let cur = null; for (const line of md.split(/\r?\n/)) { const m = line.match(/^##\s+(\w+)/); if (m) { cur = m[1].toLowerCase(); out[cur] = ''; continue; } if (cur) out[cur] += line + '\n'; } for (const k of Object.keys(out)) out[k] = out[k].trim(); return out; };
let _style = null;
export function stylePreamble() { if (_style === null) { const p = path.join(PATHS.prompts, '_style.md'); _style = existsSync(p) ? sections(readFileSync(p, 'utf8')) : {}; } return _style; }
export function template(group) {
  const p = path.join(PATHS.prompts, `${group}.md`);
  if (!existsSync(p)) throw new Error(`no prompt template for group ${group} (expected ${path.relative(ROOT, p)})`);
  return sections(readFileSync(p, 'utf8'));
}
const fill = (text, slots) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => (slots[k] ?? '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
export function buildPrompt(row) {
  const t = template(row.group), st = stylePreamble(), s = slotsFor(row);
  let body = t.prompt || '';
  // Variants: `- key: text` prepends, `= key: text` replaces the body. `key_` matches ids with that prefix, `*key`
  // ids with that suffix, anything else the id exactly.
  if (t.variants) for (const line of t.variants.split('\n')) { const m = line.match(/^([-=])\s*([^:]+):\s*(.+)$/); if (!m) continue; const k = m[2].trim(); const hit = k.startsWith('*') ? s.id.endsWith(k.slice(1)) : k.endsWith('_') ? s.id.startsWith(k) : s.id === k; if (!hit) continue; body = m[1] === '=' ? m[3] : m[3] + '\n' + body; }
  const style = t.style || (isPixelRow(row) ? st.pixel : row.group === 'sound' ? '' : st.painted) || '';
  const neg = [st.negative, t.negative].filter(Boolean).join('\n');
  const prompt = fill([style, body].filter(Boolean).join('\n\n'), s);
  const negative = fill(neg, s);
  return { prompt, negative, slots: s };
}

// ── Ledger (art/ledger.json) ───────────────────────────────────────
export function loadLedger() { return readJSONFile(PATHS.ledger, { _about: 'One entry per asset key: which tool and model produced the file at its path, the prompt hash and seed so it can be regenerated, what it cost, the licence, and the reviewer verdict from art/review.json. Written by tools/art/pipeline.mjs; never edit by hand.', entries: {} }); }
export function saveLedger(l) { const sorted = Object.fromEntries(Object.entries(l.entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)); writeJSONFile(PATHS.ledger, { ...l, entries: sorted }); }
export const LICENCE = { pixellab: 'PixelLab paid plan (commercial use)', fal: 'FLUX.2 [pro]/[klein] via fal.ai (commercial)', gemini: 'Gemini image (Nano Banana) paid tier', elevenlabs: 'ElevenLabs paid plan (commercial)', midjourney: 'Midjourney paid plan (commercial)', suno: 'Suno paid plan (commercial)', local: 'Generated locally (rembg/Pillow)' };

// ── Review (art/review.json) ───────────────────────────────────────
// { entries: { key: { verdict: 'approve'|'redo'|'redo-note'|'pending', note, attempt, date } } }
export function loadReview() { return readJSONFile(PATHS.review, { _about: 'Reviewer verdicts from the Lab art page (/lab/?art=1 with `npm run art:review`). approve keeps the file; redo and redo-note make the next pipeline run regenerate the row with a new seed (attempt + 1). Edit by hand if you must; the pipeline only clears verdicts it has acted on.', entries: {} }); }
export function saveReview(r) { writeJSONFile(PATHS.review, r); }
export const needsRedo = (review, key) => /^redo/.test(review.entries?.[key]?.verdict || '');

// ── Rows ──────────────────────────────────────────────────────────────
export function rows({ group = null, priority = null, only = null, tool = null } = {}) {
  let list = buildAssetList(data());
  if (group) { const gs = String(group).split(','); list = list.filter(r => gs.includes(r.group)); }
  if (priority) { const ps = String(priority).split(','); list = list.filter(r => ps.includes(r.priority)); }
  if (only) { const ks = String(only).split(','); list = list.filter(r => ks.some(k => k.endsWith('*') ? r.key.startsWith(k.slice(0, -1)) : r.key === k)); }
  if (tool) list = list.filter(r => toolFor(r) === tool);
  return list;
}
export const byGroup = (list) => { const out = {}; for (const r of list) (out[r.group] ||= []).push(r); return out; };

// ── Inbox (manual tools) ───────────────────────────────────────────
export const inboxPath = (tool, row) => path.join(PATHS.inbox, tool, `${row.key.replace(/\//g, '__')}.${tool === 'suno' ? 'wav' : 'png'}`);
export const inboxCandidates = (tool, row) => { const base = row.key.replace(/\//g, '__'); const dir = path.join(PATHS.inbox, tool); if (!existsSync(dir)) return []; return readdirSync(dir).filter(f => f.startsWith(base + '.') || f.startsWith(base + '-') || f === base).map(f => path.join(dir, f)).filter(f => statSync(f).isFile()); };

// ── Style references (approved style sheet) ────────────────────────
export function styleRefs() { return readJSONFile(PATHS.styleRefs, { approved: false, sref: [], cref: {}, images: {}, loras: {} }); }
