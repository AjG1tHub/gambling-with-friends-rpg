// The backend is a synchronized event store. Two implementations share one interface:
//   supabase.js   production: Postgres + Realtime through the publishable key
//   local.js      the Game Lab, unit and browser tests, and the offline fallback: localStorage + BroadcastChannel
//                 (or pure memory in Node)
//
// interface Backend {
//   kind
//   identity(): { deviceId }                         stable per browser (localStorage), random in Node
//   createRoom({ code, seed, mode, tier, size, gmPinHash }) → { roomId, code }
//   findRoom(code) → { roomId, code, status, snapshot, snapshotSeq } | null
//   getRoom(roomId) → same
//   append(roomId, event) → event with seq
//   loadEvents(roomId, afterSeq) → [event]
//   subscribe(roomId, onEvent) → unsubscribe()
//   saveSnapshot(roomId, seq, state)
//   roster: { forDevice(deviceId) → owner|null, create(deviceId) → owner, save(owner), claim(code, deviceId) → owner }
//   wall:   { all() → [{name,...}], add(rows) }
//   hallOfFame: { list() → rows, add(row) }
//   presets: { list(), save(preset) }
//   metaLedger: { add(rows) }
// }
export { createLocalBackend } from './local.js';
export { createSupabaseBackend } from './supabase.js';
export { createWsBackend } from './ws.js';

//   ws.js         tools/dev-server.mjs over one WebSocket: browser tests (one context per phone) and LAN nights
// Selection: `?backend=local|ws|supabase` on the URL wins; else Supabase when VITE_SUPABASE_URL/KEY exist; else local.
// A `?ws=ws://host:port` parameter names the dev server. The choice is remembered in sessionStorage so reloads keep it.
export function createBackend(opts = {}) {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const url = opts.url ?? env.VITE_SUPABASE_URL;
  const key = opts.key ?? env.VITE_SUPABASE_KEY;
  let kind = opts.kind, wsUrl = opts.wsUrl;
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    try {
      if (q.get('backend')) sessionStorage.setItem('gwfrpg:backend', q.get('backend'));
      if (q.get('ws')) sessionStorage.setItem('gwfrpg:ws', q.get('ws'));
      kind = kind || q.get('backend') || sessionStorage.getItem('gwfrpg:backend') || undefined;
      wsUrl = wsUrl || q.get('ws') || sessionStorage.getItem('gwfrpg:ws') || undefined;
    } catch { kind = kind || q.get('backend') || undefined; wsUrl = wsUrl || q.get('ws') || undefined; }
  }
  if (kind === 'ws' && wsUrl) return import('./ws.js').then(m => m.createWsBackend({ url: wsUrl }));
  if (kind !== 'local' && url && key) return import('./supabase.js').then(m => m.createSupabaseBackend({ url, key, ...opts }));
  return import('./local.js').then(m => m.createLocalBackend(opts));
}
