// Approval gate 1: the style sheet. Twelve Midjourney prompts written from the art direction — one monster, one
// boss, one item icon, one worn-weapon sprite reference, one tile set, one card, one crest, one region ground,
// one stage backdrop, one pet, one wheel face, one lantern. Nothing else is generated until AJ approves a set.
//
//   node tools/art/style-sheet.mjs --queue              append the 12 prompts to art/midjourney/queue.md (once)
//   node tools/art/style-sheet.mjs --import             move art/inbox/midjourney/style__<id>.png → art/style/<id>.png
//   node tools/art/style-sheet.mjs --approve a,b,c       record the approved ids (+ --sref <id> <id> for Midjourney --sref)
//   node tools/art/style-sheet.mjs --status
// The approved images are the LoRA training seed (copied into art/style/icons and art/style/portraits by kind) and
// their --sref ids go on every later Midjourney line.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, styleRefs, writeJSONFile, stylePreamble, today } from './lib.mjs';
import { QUEUE_HEADER } from './adapters/manual.mjs';

export const STYLE_SHEET = [
  { id: 'monster', kind: 'portraits', ar: '1:1', prompt: 'Full-figure portrait of the Card Shark, a monster of the Casino Strip: a literal shark in a croupier\'s waistcoat, gills slit like card slots, a bone-engraved deck fanned in one fin, standing upright on a rain-slick street, lit by one candle and one magenta neon. Centred, three-quarter view, isolated on plain near-black.' },
  { id: 'boss', kind: 'portraits', ar: '1:1', prompt: 'Region boss of the Casino Strip: a towering croupier revenant crowned with a broken roulette wheel, oxblood coat, tarnished gold epaulettes of stacked chips, candle smoke pouring from the mouth, one magenta neon reflection. Imposing silhouette, centred, isolated on plain near-black.' },
  { id: 'item', kind: 'icons', ar: '1:1', prompt: 'Pixel-art inventory icon of the Coin Blade: a tarnished brass coin sharpened to a crescent and bound to a bone grip, oxblood wrap, a single bone-white highlight, drawn upright to fill a tall 1×3 grid footprint. Hard pixels, 1-pixel dark outline, two-step shading, under 32 colours, isolated on flat pure green #00FF00.' },
  { id: 'sprite', kind: 'icons', ar: '2:3', prompt: 'Pixel-art paper-doll figure, chunky and big-headed in three-quarter view, a heavy oxblood coat and a brass mask, holding a dice morningstar in the right hand, a belt lantern guttering at the hip, dark 1-pixel outline, soft two-step shading, 64×96 proportions, transparent-ready flat pure green #00FF00 background.' },
  { id: 'tiles', kind: 'icons', ar: '1:1', prompt: 'A set of six flat single-colour pixel glyphs on a 3×2 grid for hex tiles: a watching eye, a breaking wheel, a skull-stamped chip with a price tag, a candle in a bed-shaped niche, a cracked chip-shaped headstone, a hanging die on a rope — bone white, each legible at 26 px, on flat pure green #00FF00.' },
  { id: 'card', kind: 'portraits', ar: '3:5', prompt: 'A playing card for a grimdark casino: engraved on bone with a tarnished brass border, a deep oxblood face and a single central engraved skull-chip emblem, candle-stained edges, no text.' },
  { id: 'crest', kind: 'portraits', ar: '3:5', prompt: 'A worn tarot card, the crest of the Whale: bone with a tarnished-gold border, a split coin as the central emblem in oxblood and gold, a dead god\'s casino in the margins, candle-stained, no text, no numerals.' },
  { id: 'ground', kind: 'portraits', ar: '1:1', prompt: 'Top-down hex ground texture for The Docks: a drowned pier of black wet planks, lantern fog, barnacle and verdigris, one faint absinthe-green neon reflection in a puddle. Worn, lived in, no glyph, no figure, fills the frame edge to edge.' },
  { id: 'stage', kind: 'portraits', ar: '16:9', prompt: 'A 16:9 painted backdrop for card minigames in a grimdark casino: a dealer\'s table of bone-engraved cards, a card shoe made from a reliquary, candlelight, velvet and brass, one oxblood neon reflection, the centre of the table empty. No text.' },
  { id: 'pet', kind: 'icons', ar: '1:1', prompt: 'Pixel-art creature, the Cinderfox, Oxblood element, stage 1 of 3: a small cute-grim fox with ember eyes and a smouldering tail, a little wrong, standing in three-quarter view, hard pixels, 1-pixel dark outline, two-step shading, under 32 colours, on flat pure green #00FF00.' },
  { id: 'wheel', kind: 'portraits', ar: '1:1', prompt: 'A top-down painted wheel face for a grimdark casino, the Loot Wheel as a breaking wheel: a tarnished gold and oxblood velvet rim, bone studs, worn and candle-lit, the centre and face left as flat dark velvet with no divisions, no labels, no numbers. Perfectly centred circle filling a square frame.' },
  { id: 'lantern', kind: 'icons', ar: '1:1', prompt: 'Pixel-art belt lantern, brass and glass, seen from the front, guttering: a short leaning sputtering amber flame, half the glass dark, a curl of smoke, hard pixels, 1-pixel dark outline, under 32 colours, on flat pure green #00FF00.' },
];
const NEG = '--no text, letters, watermark, bright saturated fantasy colours, cute cartoon, photograph, blurry, lens flare';

import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const argv = isMain ? process.argv.slice(2) : [];
const flag = (n) => isMain && argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const STYLE_SECTION = '\n## Style sheet (approval gate 1)\n\nTwelve references. Save each as `art/inbox/midjourney/style__<id>.png`, then `node tools/art/style-sheet.mjs --import`, review them on `/lab/?art=1#style`, and approve with `--approve`.\n\n| status | key | aspect | seed | prompt |\n| --- | --- | --- | --- | --- |\n';

if (flag('queue')) {
  mkdirSync(path.dirname(PATHS.queues.midjourney), { recursive: true });
  let text = existsSync(PATHS.queues.midjourney) ? readFileSync(PATHS.queues.midjourney, 'utf8') : QUEUE_HEADER.midjourney;
  if (!text.includes('## Style sheet')) text += STYLE_SECTION;
  let added = 0;
  for (const s of STYLE_SHEET) { const key = `style/${s.id}`; if (text.includes(`| ${key} |`)) continue; const seed = 1000 + STYLE_SHEET.indexOf(s); text += `| todo | ${key} | ${s.ar} | ${seed} | ${s.prompt} ${NEG} --ar ${s.ar} --seed ${seed} --stylize 250 |\n`; added++; }
  writeFileSync(PATHS.queues.midjourney, text);
  console.log(`${added} style-sheet prompts added to ${path.relative(ROOT, PATHS.queues.midjourney)} (${STYLE_SHEET.length} total)`);
}
if (flag('import')) {
  const inbox = path.join(PATHS.inbox, 'midjourney'); mkdirSync(PATHS.style, { recursive: true });
  const refs = styleRefs(); let n = 0;
  if (existsSync(inbox)) for (const f of readdirSync(inbox)) { const m = f.match(/^style__([a-z]+)(?:[-.].*)?\.(png|jpg|jpeg)$/i); if (!m) continue; const id = m[1]; if (!STYLE_SHEET.some(s => s.id === id)) continue; const dst = path.join(PATHS.style, `${id}.${m[2].toLowerCase()}`); copyFileSync(path.join(inbox, f), dst); refs.images = { ...(refs.images || {}), [id]: path.relative(ROOT, dst) }; n++; }
  writeJSONFile(PATHS.styleRefs, refs); console.log(`${n} style images imported into ${path.relative(ROOT, PATHS.style)}`);
}
if (flag('approve')) {
  const ids = String(opt('approve') || '').split(',').map(s => s.trim()).filter(Boolean);
  const refs = styleRefs(); refs.approved = true; refs.approvedIds = ids; refs.approvedOn = today();
  const sref = argv.slice(argv.indexOf('--sref') + 1).filter(a => !a.startsWith('--')); if (argv.includes('--sref') && sref.length) refs.sref = sref;
  for (const id of ids) { const s = STYLE_SHEET.find(x => x.id === id); const src = refs.images?.[id]; if (!s || !src) { console.warn(`${id}: no imported image; skipped`); continue; } const dir = path.join(PATHS.style, s.kind); mkdirSync(dir, { recursive: true }); copyFileSync(path.join(ROOT, src), path.join(dir, `style_${id}${path.extname(src)}`)); }
  writeJSONFile(PATHS.styleRefs, refs); console.log(`approved: ${ids.join(', ')}${refs.sref?.length ? ` · --sref ${refs.sref.join(' ')}` : ''}\nThe approved images are in art/style/icons and art/style/portraits — the LoRA seeds (npm run art:lora -- --kind icons).`);
}
if (isMain && (flag('status') || !argv.length)) {
  const refs = styleRefs();
  console.log(`style sheet: ${refs.approved ? `APPROVED ${refs.approvedOn} (${(refs.approvedIds || []).join(', ')})` : 'not approved'}${refs.sref?.length ? ` · --sref ${refs.sref.join(' ')}` : ''}`);
  for (const s of STYLE_SHEET) console.log(`  ${s.id.padEnd(8)} ${refs.images?.[s.id] ? '✓ ' + refs.images[s.id] : '· waiting for art/inbox/midjourney/style__' + s.id + '.png'}`);
  console.log(`LoRAs: ${Object.entries(refs.loras || {}).map(([k, v]) => `${k} ${v.url}`).join(' · ') || 'none trained'}`);
}
