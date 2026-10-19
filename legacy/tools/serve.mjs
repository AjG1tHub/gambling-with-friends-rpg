// Tiny static server for playing locally (ES modules do not load from file://).   node tools/serve.mjs [port]
// Serves the site/ folder at http://localhost:8080 — /gm, /lab, /rules and the player view at /.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site'), port = Number(process.argv[2] || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  let f = path.join(root, p);
  if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isDirectory()) { res.writeHead(302, { location: p + '/' }); return res.end(); }
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
}).listen(port, '127.0.0.1', () => { console.log(`Gambling With Friends is running.\n  Game Lab:    http://localhost:${port}/lab/\n  GM monitor:  http://localhost:${port}/gm/\n  Player view: http://localhost:${port}/\nLeave this window open while you play. Close it to stop.`); });
