// Vite multi-page build. `root` is apps/, so every app keeps its folder in dist/:
//   dist/tv/      the shared screen (PC browser cast to the TV)   served at /
//   dist/phone/   the player controller (portrait PWA)            served at /phone
//   dist/gm/      the GM console                                  served at /gm
//   dist/lab/     the Game Lab, phone mode included               served at /lab
// netlify.toml maps the pretty paths; tools/build-classic.mjs copies legacy/site to dist/classic.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));
const apps = resolve(repo, 'apps');

export default defineConfig({
  root: apps,
  envDir: repo,
  appType: 'mpa',
  publicDir: resolve(repo, 'assets'),
  resolve: {
    alias: {
      '@shared': resolve(repo, 'packages/shared'),
      '@games': resolve(repo, 'packages/games'),
      '@ui': resolve(repo, 'packages/ui'),
      '@data': resolve(repo, 'data'),
    },
  },
  server: { host: true, port: 5173, fs: { allow: [repo] } },
  preview: { host: true, port: 4173 },
  build: {
    outDir: resolve(repo, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        tv: resolve(apps, 'tv/index.html'),
        phone: resolve(apps, 'phone/index.html'),
        gm: resolve(apps, 'gm/index.html'),
        lab: resolve(apps, 'lab/index.html'),
      },
    },
  },
});
