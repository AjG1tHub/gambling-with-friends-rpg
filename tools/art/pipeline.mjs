#!/usr/bin/env node
// The art pipeline driver (tools/art/README.md has the one-page loop).
//
//   node tools/art/pipeline.mjs --group monsters --priority P1 [--only key[,key|prefix*]] [--force] [--dry-run]
//   node tools/art/pipeline.mjs --import            pick up art/inbox/<tool>/ files (Midjourney, Suno), post-process, write
//   node tools/art/pipeline.mjs --probe <tool|all>  check the live API schemas against what the adapters send
//   node tools/art/pipeline.mjs --redo              only rows marked redo / redo-note in art/review.json
//
// For each row of buildAssetList() that matches: skip when a real (non-placeholder) file already exists (unless
// --force, or the reviewer asked for a redo); build the prompt from tools/art/prompts/<group>.md and the row's data;
// call the adapter (or append to the manual queue); hand the raw output to post.py with a job that knows the
// row's size, mode and op; write the file at row.path; append to art/ledger.json. Idempotent, safe to re-run,
// stops at ART_BUDGET_USD. Never edits game code, data/*.json, asset-list.mjs or the manifest by hand — it runs
// tools/build-manifest.mjs at the end so `placeholder` flips to false for the files that landed.
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, PATHS, loadEnv, rows as selectRows, toolFor, isManualTool, isPixelRow, isReal, buildPrompt, seedFor, promptHash, loadLedger, saveLedger, loadReview, saveReview, needsRedo, LICENCE, today, byGroup, budgetUSD, writeJSONFile } from './lib.mjs';
import { spend, BudgetExceeded } from './adapters/_http.mjs';
import * as pixellab from './adapters/pixellab.mjs';
import * as fal from './adapters/fal.mjs';
import * as gemini from './adapters/gemini.mjs';
import * as elevenlabs from './adapters/elevenlabs.mjs';
import * as manual from './adapters/manual.mjs';
import { PYTHON } from './png-io.mjs';

const ADAPTERS = { pixellab, fal, gemini, elevenlabs, midjourney: manual, suno: manual };
const POST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'post.py');

// ── CLI ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const log = (s) => console.log(s);
const verbose = argv.includes('--verbose');
// Dry-run preview: the row-specific part of the prompt (the shared style preamble is the first paragraph).
const preview = (p) => verbose ? '\n' + p.split('\n').map(l => '    ' + l).join('\n') : '\n    ' + (p.split('\n\n').slice(1).join(' ') || p).replace(/\n/g, ' ').slice(0, 200) + '…';

// What post.py does with each group's raw output.
const CUTOUT = { items: 'chroma', gear: 'chroma', consumables: 'chroma', badges: 'chroma', letters: 'chroma', dice: 'chroma', tiles: 'chroma', pets: 'chroma', monsters: 'auto', map: 'auto', crest: 'none', stages: 'none', ui: 'chroma', tv: 'none', cards: 'none', wheels: 'none', frames: 'chroma', lantern: 'none', body: 'none', face: 'none', hair: 'none', outfit: 'none', worn: 'none', legendary: 'none' };
const OPAQUE_KEYS = /^(tiles\/(ground|void)_|map\/parchment_frame|stages\/(dice|cards|wheels|nerve|picks|felt)|ui\/(btn_|panel_)|tv\/)/;
const cutoutFor = (row) => OPAQUE_KEYS.test(row.key) ? 'none' : (CUTOUT[row.group] || 'auto');
const modeFor = (row) => row.group === 'sound' ? 'audio' : isPixelRow(row) ? 'pixel' : 'painted';
const needsPixelate = (row, tool) => modeFor(row) === 'pixel' && tool !== 'pixellab';   // fal/gemini output is not on the pixel grid yet

// ── post.py ───────────────────────────────────────────────────────────
function runPost(job) {
  mkdirSync(PATHS.cache, { recursive: true });
  const jobPath = path.join(PATHS.cache, `job-${job.key.replace(/\//g, '__')}.json`); writeJSONFile(jobPath, job);
  const r = spawnSync(PYTHON, [POST, 'process', jobPath], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`post.py ${job.op} ${job.key}: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
const rawPath = (key, i = null, ext = 'png') => path.join(PATHS.cache, 'raw', `${key.replace(/\//g, '__')}${i == null ? '' : `-${String(i).padStart(2, '0')}`}.${ext}`);
function saveRaw(key, out) {
  mkdirSync(path.join(PATHS.cache, 'raw'), { recursive: true });
  if (Buffer.isBuffer(out)) { const p = rawPath(key, null, out._format?.startsWith('pcm') ? 'pcm' : 'png'); writeFileSync(p, out); return { inputs: [p] }; }
  const inputs = out.frames.map((b, i) => { const p = rawPath(key, i); writeFileSync(p, b); return p; });
  const bases = out.bases ? out.bases.map((b, i) => { const p = rawPath(key + '__base', i); writeFileSync(p, b); return p; }) : null;
  return { inputs, bases, layout: out.layout, frameW: out.frameW, frameH: out.frameH, diff: out.diff };
}

// The post.py job for a row given the saved raw output.
function jobFor(row, tool, raw, extra = {}) {
  const out = path.join(ROOT, row.path); const base = { key: row.key, group: row.group, out, size: row.size, genSize: row.genSize || null, mode: modeFor(row), inputs: raw.inputs, cutout: raw.cutout || cutoutFor(row) };
  if (row.kind === 'wav') return { ...base, op: 'audio', format: extra.format || 'wav', music: !!row.meta?.music, rate: 48000, lufs: -16 };
  if (row.group === 'wheels' && !/\/(pointer|hub)$/.test(row.key)) return { ...base, op: 'wheel-svg', labels: row.meta?.labels || [] };
  if (row.kind === 'svg') return { ...base, op: 'svg-wrap', trim: /ui\/(tab_|slot_|hexbtn_|stop_hub)/.test(row.key), ...(needsPixelate(row, tool) ? { pixelate: row.genSize || row.size } : {}) };
  if (row.group === 'frames') return { ...base, op: 'nineslice', slice: row.meta.slice || 12, cells: row.meta.footprint.split('x').map(Number) };
  if (raw.layout === 'layer') return { ...base, op: 'layer', bases: raw.bases, frameW: raw.frameW, frameH: raw.frameH, tol: 24 };
  if (raw.layout === 'body' || raw.layout === 'strip' || raw.inputs.length > 1) return { ...base, op: 'strip', frameW: raw.frameW || row.sprite?.frameW || row.meta?.frameW || 64, frameH: raw.frameH || row.sprite?.frameH || row.size[1], baseline: raw.layout === 'body' ? 92 : (raw.frameH || row.size[1]) - 2, align: raw.layout !== 'strip' };
  const single = { ...base, op: 'single', margin: /^(items|gear|consumables|badges|pets\/attack_|letters|ui\/active_)/.test(row.key) ? 0.06 : 0, anchor: /^pets\//.test(row.key) && !row.meta?.egg ? 'bottom' : 'center' };
  if (needsPixelate(row, tool)) single.pixelate = row.genSize || [Math.min(row.size[0], 256), Math.min(row.size[1], 256)];
  return single;
}

// ── ledger helpers ────────────────────────────────────────────────────
function record(ledger, row, entry) { ledger.entries[row.key] = { ...(ledger.entries[row.key] || {}), ...entry, path: row.path, group: row.group, priority: row.priority, date: today(), ...(entry.status === 'landed' ? { landedAt: new Date().toISOString() } : {}) }; saveLedger(ledger); }

// ── one row ───────────────────────────────────────────────────────────
async function doRow(row, { ledger, review, rowsByKey, dryRun, force, importOnly }) {
  const tool = opt('tool') || toolFor(row);
  const redo = needsRedo(review, row.key);
  const attempt = (ledger.entries[row.key]?.attempt || 0) + (redo ? 1 : 0);
  const seed = seedFor(row.key, attempt);
  if (isReal(row) && !force && !redo) return 'skip';
  let { prompt, negative } = buildPrompt(row);
  const note = review.entries[row.key]?.note; if (redo && note) prompt += `\nReviewer note: ${note.trim()}`;
  const label = `${row.key} [${row.priority} ${tool}${redo ? ' redo' : ''}]`;

  if (isManualTool(tool)) {
    let file = manual.inboxFile(tool, row);
    // On a redo, the inbox file that produced the rejected asset is stale: only a drop newer than the last landing counts.
    if (file && redo) { const landedAt = Date.parse(ledger.entries[row.key]?.landedAt || 0); if (statSync(file).mtimeMs <= landedAt) file = null; }
    if (file) {
      if (dryRun) { log(`${label} → import ${manual.relInbox(file)}`); return 'would-import'; }
      const t0 = spend.usd;
      const job = jobFor(row, tool, { inputs: [file] }, { format: tool === 'suno' ? (file.endsWith('.wav') ? 'wav' : 'ffmpeg') : 'png' });
      const res = runPost(job); manual.markDone(tool, row.key);
      record(ledger, row, { tool, model: tool === 'midjourney' ? 'Midjourney (manual)' : 'Suno (manual)', prompt, promptHash: promptHash(prompt), seed, attempt, cost: 0, licence: LICENCE[tool], status: 'landed', inbox: manual.relInbox(file), post: res });
      if (redo) { review.entries[row.key] = { ...review.entries[row.key], verdict: 'pending', acted: today() }; saveReview(review); }
      log(`${label} ← ${manual.relInbox(file)} → ${row.path}`); return 'landed';
    }
    if (importOnly) return 'waiting';
    if (dryRun) { log(`${label} → queue${preview(prompt)}`); return 'would-queue'; }
    await manual.generate(row, prompt, { tool, seed, negative, log, requeue: redo });
    record(ledger, row, { tool, model: tool === 'midjourney' ? 'Midjourney (manual)' : 'Suno (manual)', prompt, promptHash: promptHash(prompt), seed, attempt, cost: 0, licence: LICENCE[tool], status: 'queued' });
    return 'queued';
  }
  if (importOnly) return 'skip';
  if (dryRun) { log(`${label} seed ${seed}${preview(prompt)}`); return 'would-generate'; }

  const adapter = ADAPTERS[tool]; if (!adapter) throw new Error(`no adapter for tool ${tool}`);
  log(label);
  const t0 = spend.usd;
  const out = await adapter.generate(row, prompt, { negative, seed, log, rowsByKey });
  const raw = saveRaw(row.key, out);
  const res = runPost(jobFor(row, tool, raw, { format: out._format || 'png' }));
  record(ledger, row, { tool, model: out._model || tool, prompt, promptHash: promptHash(prompt), seed, attempt, cost: +(spend.usd - t0).toFixed(4), licence: out._licence || LICENCE[tool], status: 'landed', post: res, ...(out._takes ? { takes: out._takes } : {}), ...(out._parent ? { parent: out._parent } : {}) });
  if (redo) { review.entries[row.key] = { ...review.entries[row.key], verdict: 'pending', acted: today() }; saveReview(review); }
  log(`  → ${row.path}`);
  return 'landed';
}

// Rarity frames: one 9-slice source per rarity (fal), sliced into six footprints by post.py.
async function doFrames(list, ctx) {
  const byRarity = {}; for (const r of list) (byRarity[r.meta.rarity] ||= []).push(r);
  const results = [];
  for (const [rarity, rowsOf] of Object.entries(byRarity)) {
    const pending = rowsOf.filter(r => ctx.force || !isReal(r) || needsRedo(ctx.review, r.key)); if (!pending.length) { results.push(...rowsOf.map(() => 'skip')); continue; }
    const proto = { ...rowsOf[0], key: `frames/_source_${rarity}`, size: [192, 192], genSize: [192, 192], name: `${rarity} frame source` };
    const { prompt, negative } = buildPrompt(proto); const seed = seedFor(proto.key);
    const src = rawPath(proto.key);
    if (ctx.dryRun) { log(`frames/${rarity}_* [${rowsOf[0].priority} fal] 9-slice source seed ${seed}${preview(prompt)}`); results.push(...pending.map(() => 'would-generate')); continue; }
    if (!existsSync(src) || ctx.force) { log(`frames/_source_${rarity} [fal]`); const t0 = spend.usd; const out = await fal.generate(proto, prompt, { negative, seed, log }); saveRaw(proto.key, out); ctx.ledger.entries[proto.key] = { tool: 'fal', model: out._model, prompt, promptHash: promptHash(prompt), seed, cost: +(spend.usd - t0).toFixed(4), licence: out._licence, status: 'source', date: today() }; }
    // Key the chroma background out once, into a clean 192×192 source.
    const clean = rawPath(proto.key + '__clean'); runPost({ key: proto.key, group: 'frames', out: clean, size: [192, 192], genSize: [192, 192], mode: 'pixel', inputs: [src], cutout: 'chroma', op: 'single', margin: 0, quantize: true, pixelate: [192, 192] });
    for (const r of pending) { const res = runPost(jobFor(r, 'fal', { inputs: [clean] })); record(ctx.ledger, r, { tool: 'fal', model: ctx.ledger.entries[proto.key]?.model || 'fal', prompt, promptHash: promptHash(prompt), seed, cost: 0, licence: ctx.ledger.entries[proto.key]?.licence || LICENCE.fal, status: 'landed', source: proto.key, post: res }); log(`  → ${r.path}`); results.push('landed'); }
  }
  return results;
}

// Dice: faces one at a time (fal), then a strip; the roll blur as 4 frames; the outline as a single.
async function doDie(row, ctx) {
  const tool = 'fal'; const redo = needsRedo(ctx.review, row.key);
  if (isReal(row) && !ctx.force && !redo) return 'skip';
  const { prompt, negative } = buildPrompt(row); const seed = seedFor(row.key, redo ? 1 : 0);
  const isStrip = /^dice\/d\d+(_roll)?$/.test(row.key); const n = row.key.endsWith('_roll') ? 4 : row.meta.sides;
  if (ctx.dryRun) { log(`${row.key} [${row.priority} fal${isStrip ? ` ×${n}` : ''}] seed ${seed}${preview(prompt)}`); return 'would-generate'; }
  log(`${row.key} [${row.priority} fal]`);
  const t0 = spend.usd; let raw;
  if (isStrip) {
    const frames = [];
    for (let i = 0; i < n; i++) { log(`  ${row.key.endsWith('_roll') ? `tumble frame ${i + 1}` : `face ${i + 1}`}/${n}`); const p = row.key.endsWith('_roll') ? `${prompt}\nMotion-blurred tumbling die, frame ${i + 1} of ${n}.` : `${prompt}\nThe face showing ${i + 1}, pips or numeral clearly legible.`; frames.push(await fal.generate({ ...row, genSize: [256, 256], size: [256, 256] }, p, { negative, seed: seed + i, log })); }
    const saved = saveRaw(row.key, { frames, layout: 'strip', frameW: 64, frameH: 64 }); raw = { ...saved };
    // Downscale each face to the 64 px cell with the pixelate path: strip op expects pixel-grid inputs, so run single first.
    raw.inputs = raw.inputs.map((p, i) => { const o = rawPath(row.key + '__cell', i); runPost({ key: row.key, group: 'dice', out: o, size: [64, 64], genSize: [64, 64], mode: 'pixel', inputs: [p], cutout: 'chroma', op: 'single', margin: 0.04, pixelate: [64, 64] }); return o; });
    raw.cutout = 'none';
  } else raw = saveRaw(row.key, await fal.generate(row, prompt, { negative, seed, log }));
  const res = runPost(jobFor(row, tool, raw));
  record(ctx.ledger, row, { tool, model: 'fal', prompt, promptHash: promptHash(prompt), seed, cost: +(spend.usd - t0).toFixed(4), licence: LICENCE.fal, status: 'landed', post: res });
  log(`  → ${row.path}`); return 'landed';
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  loadEnv();
  if (flag('probe')) { const which = opt('probe', 'all'); for (const [name, a] of Object.entries(ADAPTERS)) { if (which !== 'all' && which !== name) continue; if (!a.probe) continue; try { for (const line of await a.probe()) log(`${name}: ${line}`); } catch (e) { log(`${name}: ${e.message}`); } } return; }
  const dryRun = flag('dry-run'), force = flag('force'), importOnly = flag('import'), redoOnly = flag('redo');
  const review = loadReview(), ledger = loadLedger();
  let list = selectRows({ group: opt('group'), priority: opt('priority'), only: opt('only'), tool: opt('tool') });
  if (redoOnly) list = list.filter(r => needsRedo(review, r.key));
  if (importOnly) list = list.filter(r => isManualTool(toolFor(r)));
  // Order: P1 → P2 → P3, parents before children (portraits before tokens, pet stage 1 before 2 before 3).
  const pr = { P1: 0, P2: 1, P3: 2 };
  list.sort((a, b) => (pr[a.priority] - pr[b.priority]) || ((a.meta?.token ? 1 : 0) - (b.meta?.token ? 1 : 0)) || ((a.meta?.stage || 0) - (b.meta?.stage || 0)) || (a.key < b.key ? -1 : 1));
  const rowsByKey = Object.fromEntries(selectRows().map(r => [r.key, r]));
  const ctx = { ledger, review, rowsByKey, dryRun, force, importOnly };
  const tally = {}; const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
  log(`${list.length} rows${dryRun ? ' (dry run)' : ''}; budget $${budgetUSD()}; ${Object.keys(review.entries).filter(k => needsRedo(review, k)).length} redo requests pending`);
  const groups = byGroup(list);
  try {
    for (const [group, rowsOf] of Object.entries(groups)) {
      if (group === 'frames' && !importOnly) { for (const r of await doFrames(rowsOf, ctx)) bump(r); continue; }
      for (const row of rowsOf) {
        try {
          const r = group === 'dice' && !importOnly ? await doDie(row, ctx) : await doRow(row, ctx);
          bump(r);
        } catch (e) {
          if (e instanceof BudgetExceeded) throw e;
          bump('failed'); log(`${row.key}: FAILED — ${e.message}`);
          if (!dryRun) record(ledger, row, { status: 'failed', error: e.message.slice(0, 300) });
        }
      }
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) log(`\nSTOPPED: ${e.message}`); else throw e;
  }
  log(`\n${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')} · spent $${spend.usd.toFixed(2)} in ${spend.calls} calls`);
  if (!dryRun && (tally.landed || 0) > 0 && !flag('no-manifest')) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-manifest.mjs')], { encoding: 'utf8' }); log((r.stdout || r.stderr).trim());
  }
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
