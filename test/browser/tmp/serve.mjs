// Static server over dist/ with the same pretty-path redirects as netlify.toml, for the browser tests and for
// playing a built copy locally: `node test/browser/serve.mjs [port]`.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const APPS = ['tv', 'phone', 'gm', 'lab'];

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/' || path === '/tv') path = '/tv/index.html';
    for (const a of APPS) if (path === `/${a}` || (path.startsWith(`/${a}/`) && !extname(path))) path = `/${a}/index.html`;
    if (path === '/classic') path = '/classic/index.html';
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) startServer(Number(process.argv[2]) || 4180).then(({ url }) => console.log(`serving dist at ${url}`));
