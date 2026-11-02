// PNG read/write for the adapters. tools/png.mjs decodes only the filter-0 RGBA files it writes itself, so a real
// PNG (anything a model returned) is decoded by Pillow through tools/art/post.py (`rgba`), which is on the PC
// anyway for the post-processing. Encoding never writes the placeholder marker.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../png.mjs';

const POST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'post.py');
export const PYTHON = process.env.ART_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function decodeViaPillow(buf) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gwf-png-'));
  try {
    const inP = path.join(dir, 'in.png'), outP = path.join(dir, 'out.rgba'); writeFileSync(inP, buf);
    execFileSync(PYTHON, ['-I', POST, 'rgba', inP, outP], { stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = readFileSync(outP); const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4); const c = P.canvas(w, h); c.data.set(raw.subarray(8, 8 + w * h * 4)); return c;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export const PNG = {
  decode(buf) { try { return P.decodePNG(buf); } catch { return decodeViaPillow(buf); } },
  encode(c) { return P.encodePNG(c); },
  crop: P.crop, canvas: P.canvas, blit: P.blit, inspect: P.inspectPNG,
};
