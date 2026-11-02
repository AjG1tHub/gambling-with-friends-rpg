// npm run art:lora -- --kind icons|portraits
// Zips the approved style images for the kind (art/style/<kind>/*.png — the approved style-sheet icons for
// `icons`, the approved portraits for `portraits`; add more approved generations to the folder as they land, 25–40
// is the sweet spot), uploads the zip to fal storage, trains a FLUX.2 LoRA (fal-ai/flux-2-trainer by default), and
// records the LoRA URL in art/style/refs.json so tools/art/adapters/fal.mjs picks it up for every later batch.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadEnv, PATHS, stylePreamble } from './lib.mjs';
import * as fal from './adapters/fal.mjs';

loadEnv();
const argv = process.argv.slice(2); const i = argv.indexOf('--kind'); const kind = i >= 0 ? argv[i + 1] : 'icons';
if (!['icons', 'portraits'].includes(kind)) { console.error('usage: node tools/art/train-lora.mjs --kind icons|portraits'); process.exit(1); }
const dir = path.join(PATHS.style, kind);
if (!existsSync(dir)) { console.error(`${path.relative(process.cwd(), dir)} does not exist — approve the style sheet first (node tools/art/style-sheet.mjs --approve …)`); process.exit(1); }
const files = readdirSync(dir).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
if (files.length < 10) { console.error(`${files.length} images in ${dir}; the trainer wants at least 10 (25–40 is better)`); process.exit(1); }

// Build the zip with Python's zipfile (no extra Node dependency). Captions: <name>.txt beside an image is kept;
// otherwise the trainer's default_caption (the style preamble) applies to every image.
const tmp = mkdtempSync(path.join(tmpdir(), 'gwf-lora-')); const zip = path.join(tmp, `${kind}.zip`);
const py = `import zipfile, sys, os\nz = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)\nfor f in sorted(os.listdir(sys.argv[2])):\n    if f.lower().endswith(('.png', '.jpg', '.jpeg', '.txt')): z.write(os.path.join(sys.argv[2], f), f)\nz.close()\nprint(len(z.namelist()))`;
const r = spawnSync(process.env.ART_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-I', '-c', py, zip, dir], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log(`zipped ${r.stdout.trim()} files from ${path.relative(process.cwd(), dir)}`);
const caption = (kind === 'icons' ? stylePreamble().pixel : stylePreamble().painted || '').replace(/\{\w+\}/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
try {
  const url = await fal.upload(readFileSync(zip), `${kind}.zip`);
  console.log(`uploaded → ${url}\ntraining (this takes a few minutes)…`);
  const lora = await fal.train({ zipUrl: url, caption, kind });
  console.log(`LoRA for ${kind}: ${lora.url}\nrecorded in art/style/refs.json — later fal batches for ${kind === 'icons' ? 'pixel/icon' : 'painted'} groups use it automatically.`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
