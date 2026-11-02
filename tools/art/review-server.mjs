// npm run art:review — the local companion of the Lab art page (/lab/?art=1). It serves a small JSON API on
// http://127.0.0.1:8791 (CORS open to localhost only) so the page can read the inventory, the ledger and the
// review file, fetch the placeholder drawing for the left-hand side of each card, and write Approve / Redo
// verdicts into art/review.json; then it starts the Vite dev server and prints the page URL. The deployed site
// has no such server: there the page works read-only and offers "Download review.json" instead.
//   node tools/art/review-server.mjs [--port 8791] [--no-vite] [--open]
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, rows, isReal, toolFor, loadLedger, loadReview, saveReview, styleRefs, data as loadData, today } from './lib.mjs';
import { render as renderPlaceholder } from '../placeholders.mjs';
import { report } from './report.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(opt('port', 8791));
const MIME = { png: 'image/png', svg: 'image/svg+xml', wav: 'audio/wav', json: 'application/json' };

function state() {
  const ledger = loadLedger(), review = loadReview();
  const list = rows().map(r => ({ key: r.key, group: r.group, path: r.path, kind: r.kind, size: r.size, genSize: r.genSize, priority: r.priority, name: r.name, sprite: r.sprite || null, meta: r.meta || null, real: isReal(r), tool: toolFor(r), ledger: ledger.entries[r.key] || null, review: review.entries[r.key] || null }));
  return { rows: list, report: report(), style: styleRefs(), generated: new Date().toISOString() };
}
const cors = (req, res) => { const o = req.headers.origin || ''; if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) { res.setHeader('access-control-allow-origin', o); res.setHeader('access-control-allow-headers', 'content-type'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS'); } };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s)); });

const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state') return send(res, 200, JSON.stringify(state()));
    if (url.pathname.startsWith('/api/placeholder/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/placeholder/'.length)); const row = rows().find(r => r.key === key);
      if (!row || row.kind === 'wav') return send(res, 404, 'no placeholder', 'text/plain');
      const d = loadData(); d.monsterNames = {}; return send(res, 200, renderPlaceholder(row, d), MIME[row.kind]);
    }
    if (url.pathname.startsWith('/api/file/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/file/'.length)); const row = rows().find(r => r.key === key);
      if (!row) return send(res, 404, 'no such asset', 'text/plain');
      const abs = path.join(ROOT, row.path); if (!existsSync(abs)) return send(res, 404, 'missing', 'text/plain');
      return send(res, 200, readFileSync(abs), MIME[row.kind] || 'application/octet-stream');
    }
    if (url.pathname === '/api/review' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}'); const key = String(body.key || ''); if (!rows().some(r => r.key === key)) return send(res, 400, 'unknown key', 'text/plain');
      const review = loadReview(); const cur = review.entries[key] || {};
      if (body.verdict === 'clear') delete review.entries[key];
      else review.entries[key] = { ...cur, verdict: ['approve', 'redo', 'redo-note', 'pending'].includes(body.verdict) ? body.verdict : cur.verdict || 'pending', note: body.note != null ? String(body.note).slice(0, 2000) : cur.note || '', date: today() };
      saveReview(review); return send(res, 200, JSON.stringify(review.entries[key] || null));
    }
    if (url.pathname.startsWith('/api/style/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/style/'.length)).replace(/[^a-z0-9_-]/gi, ''); const refs = styleRefs(); const rel = refs.images?.[id];
      if (!rel) return send(res, 404, 'no style image', 'text/plain'); const abs = path.join(ROOT, rel); if (!existsSync(abs)) return send(res, 404, 'missing', 'text/plain');
      return send(res, 200, readFileSync(abs), MIME[path.extname(abs).slice(1)] || 'image/png');
    }
    if (url.pathname === '/api/review' && req.method === 'GET') return send(res, 200, JSON.stringify(loadReview()));
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { send(res, 500, e.message, 'text/plain'); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`art review API on http://127.0.0.1:${PORT}/api/state`);
  if (!argv.includes('--no-vite')) {
    const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    vite.on('exit', () => process.exit(0));
    const pageUrl = `http://localhost:5173/lab/?art=1&api=${PORT}`;
    setTimeout(() => { console.log(`\nReview page: ${pageUrl}`); if (argv.includes('--open')) spawn(process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', pageUrl] : [pageUrl], { stdio: 'ignore', detached: true }).unref(); }, 1500);
  }
});
