import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../../..'); const apps = resolve(repo, 'apps');
export default defineConfig({ root: apps, envDir: repo, appType: 'mpa', publicDir: resolve(repo, 'assets'), logLevel: 'warn',
  resolve: { alias: { '@shared': resolve(repo, 'packages/shared'), '@games': resolve(repo, 'packages/games'), '@ui': resolve(repo, 'packages/ui'), '@data': resolve(repo, 'data') } },
  build: { outDir: resolve(repo, 'test/browser/tmp/dist'), emptyOutDir: true, target: 'es2022', rollupOptions: { input: { tv: resolve(apps, 'tv/index.html'), phone: resolve(apps, 'phone/index.html'), gm: resolve(apps, 'gm/index.html') } } } });
