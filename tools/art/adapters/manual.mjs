// Manual adapter for the tools without an API: Midjourney (portraits, textures, backdrops, map, crests, the
// style sheet) and Suno (music loops). `generate()` never returns a file: it appends one line per row to the
// tool's queue (art/midjourney/queue.md or art/suno/queue.md) and reports 'queued'. AJ runs the prompts and drops
// the results into art/inbox/<tool>/<key with / as __>.<png|wav>; `pipeline.mjs --import` (npm run art:import)
// picks them up by filename, post-processes and writes them to row.path.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, inboxCandidates, styleRefs, seedFor } from '../lib.mjs';

export const QUEUE_HEADER = {
  midjourney: `# Midjourney queue\n\nOne line per asset. Run each prompt in Midjourney (V7+/V8, paid plan), pick the best of the four, upscale,\nand save the PNG as \`art/inbox/midjourney/<key>.png\` (the key with \`/\` written as \`__\`, e.g.\n\`monsters__card_shark.png\`). Then \`npm run art:import\`. Lines are appended by the pipeline; a line whose file has\nlanded is marked DONE on import. \`--sref\` ids come from art/style/refs.json once the style sheet is approved.\n\n| status | key | aspect | seed | prompt |\n| --- | --- | --- | --- | --- |\n`,
  suno: `# Suno queue\n\nOne line per loop. Generate in Suno (paid plan), choose the take, download the WAV (or MP3 and convert), trim to a\nclean 2–3 minute loop, and save as \`art/inbox/suno/<key>.wav\` (e.g. \`sound__music_docks.wav\`). Then\n\`npm run art:import\` — post.py normalises to −16 LUFS and writes the 48 kHz WAV the game expects.\n\n| status | key | length | prompt |\n| --- | --- | --- | --- |\n`,
};
const aspectFor = (row) => { const [w, h] = row.size || [1, 1]; const g = (a, b) => (b ? g(b, a % b) : a); const d = g(w, h); const ar = `${w / d}:${h / d}`; return { '1:1': '1:1', '4:1': '4:1', '16:9': '16:9', '3:5': '3:5', '2:1': '2:1' }[ar] || (w >= h ? `${Math.round(w / h * 4)}:4` : `4:${Math.round(h / w * 4)}`); };

function ensureQueue(tool) { const p = PATHS.queues[tool]; mkdirSync(path.dirname(p), { recursive: true }); if (!existsSync(p)) writeFileSync(p, QUEUE_HEADER[tool]); return p; }
function queued(tool, key) { const p = ensureQueue(tool); return readFileSync(p, 'utf8').split('\n').some(l => l.includes(`| ${key} |`)); }

// Append the row to the queue (once). Returns { queued: true } — the pipeline records 'queued' in the ledger.
export async function generate(row, prompt, { tool = 'midjourney', seed = seedFor(row.key), log = () => {}, negative = '', requeue = false } = {}) {
  const p = ensureQueue(tool);
  if (requeue) markDone(tool, row.key, 'REDO');   // the old line stays for the record; a fresh one follows
  if (requeue || !queued(tool, row.key)) {
    const refs = styleRefs(); const sref = refs.sref?.length ? ` --sref ${refs.sref.join(' ')}` : '';
    const cells = tool === 'midjourney'
      ? ['todo', row.key, aspectFor(row), String(seed), `${prompt.replace(/\s+/g, ' ').trim()}${negative ? ` --no ${negative.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim()}` : ''} --ar ${aspectFor(row)} --seed ${seed}${sref}`]
      : ['todo', row.key, '2:30 loop', prompt.replace(/\s+/g, ' ').trim()];
    appendFileSync(p, `| ${cells.join(' | ')} |\n`);
    log(`  queued for ${tool}`);
  }
  return { queued: true, tool };
}

// Inbox: the file AJ dropped for this row, or null.
export function inboxFile(tool, row) { const c = inboxCandidates(tool, row); return c.length ? c.sort()[0] : null; }
export function markDone(tool, key, status = 'DONE') {
  const p = ensureQueue(tool); if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8').split('\n').map(l => l.includes(`| ${key} |`) ? l.replace(/^\| todo \|/, `| ${status} |`) : l).join('\n');
  writeFileSync(p, text);
}
export const relInbox = (abs) => path.relative(ROOT, abs);
