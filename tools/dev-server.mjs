// Dev/test backend server: the Backend interface over one WebSocket, in-memory (optionally persisted to a JSON
// file). Used by the browser suite (each page gets its own browser context, like real phones) and handy for a
// LAN night when Supabase is unreachable: `node tools/dev-server.mjs 8787` and open any app with
// `?backend=ws&ws=ws://<pc-ip>:8787`.
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createLocalBackend } from '../packages/shared/backend/local.js';
import { fileURLToPath } from 'node:url';

export function startDevServer({ port = 0, file = null } = {}) {
  // Reuse the local backend's logic over a memory store; persist the store to `file` if given.
  const mem = new Map();
  if (file && existsSync(file)) { try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) mem.set(k, v); } catch { /* fresh */ } }
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); dirty = true; }, removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
  let dirty = false;
  const backend = createLocalBackend({ namespace: 'ws', store });
  if (file) setInterval(() => { if (dirty) { dirty = false; writeFileSync(file, JSON.stringify(Object.fromEntries(mem))); } }, 2000).unref();
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  const subs = new Map();   // roomId → Set(ws)
  const presence = new Map(); // roomId → { key: ts }
  wss.on('connection', (ws) => {
    const mine = new Set();
    ws.on('message', async (buf) => {
      let msg; try { msg = JSON.parse(buf); } catch { return; }
      const reply = (res) => ws.send(JSON.stringify({ id: msg.id, ...res }));
      try {
        const { op, args = [] } = msg;
        if (op === 'subscribe') { const [roomId] = args; if (!subs.has(roomId)) subs.set(roomId, new Set()); subs.get(roomId).add(ws); mine.add(roomId); return reply({ ok: true }); }
        if (op === 'presence') { const [roomId, key] = args; const m = presence.get(roomId) || {}; m[key] = Date.now(); presence.set(roomId, m); for (const c of subs.get(roomId) || []) c.send(JSON.stringify({ presence: m, roomId })); return reply({ ok: true, result: m }); }
        const [group, method] = op.split('.');
        const target = method ? backend[group] : backend;
        const fn = method ? target[method] : backend[op];
        if (typeof fn !== 'function') return reply({ error: `no such op ${op}` });
        const result = await fn.apply(target, args);
        if (op === 'append') for (const c of subs.get(args[0]) || []) if (c !== ws) c.send(JSON.stringify({ event: result, roomId: args[0] }));
        reply({ ok: true, result });
      } catch (e) { reply({ error: e.message }); }
    });
    ws.on('close', () => { for (const r of mine) subs.get(r)?.delete(ws); });
  });
  return new Promise((ok) => wss.on('listening', () => ok({ wss, port: wss.address().port, url: `ws://127.0.0.1:${wss.address().port}`, backend, close: () => wss.close() })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) startDevServer({ port: Number(process.argv[2]) || 8787, file: process.argv[3] || null }).then(({ url }) => console.log(`GWF dev backend on ${url} — open the apps with ?backend=ws&ws=${url}`));
