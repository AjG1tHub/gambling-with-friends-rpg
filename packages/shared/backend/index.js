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

export function createBackend(opts = {}) {
  const url = opts.url ?? (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : undefined);
  const key = opts.key ?? (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_KEY : undefined);
  const wantLocal = opts.kind === 'local' || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('backend') === 'local');
  if (!wantLocal && url && key && opts.kind !== 'local') return import('./supabase.js').then(m => m.createSupabaseBackend({ url, key, ...opts }));
  return import('./local.js').then(m => m.createLocalBackend(opts));
}
