// Copies legacy/site (the previous one-computer build, served at /classic) into dist/classic after `vite build`.
// Used by the Netlify build command. If dist/ does not exist there is nothing to attach it to: no-op with a message.
import { existsSync, cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './asset-list.mjs';

export const SRC = 'legacy/site';
export const DEST = 'dist/classic';

function countFiles(dir) { let n = 0; for (const e of readdirSync(dir)) { const p = path.join(dir, e); if (statSync(p).isDirectory()) n += countFiles(p); else n++; } return n; }

export function build({ root = ROOT, force = false } = {}) {
  const src = path.join(root, SRC), dist = path.join(root, 'dist'), dest = path.join(root, DEST);
  if (!existsSync(src)) return { copied: 0, message: `${SRC} not found; nothing to copy` };
  if (!existsSync(dist) && !force) return { copied: 0, message: 'dist/ does not exist (run `vite build` first); classic not copied' };
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  const copied = countFiles(dest);
  return { copied, message: `copied ${copied} files from ${SRC} to ${DEST}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(build({ force: process.argv.includes('--force') }).message);
}
