// Local backend: the same interface as Supabase, backed by localStorage + BroadcastChannel in a browser (every
// tab on the machine sees the room; a reload keeps it) or plain memory in Node (tests, bots). Also the
// classic-mode fallback when the backend is down: the TV, GM and phones can all be tabs on one PC.
import { uuid, shortId, claimCode as newClaimCode } from '../ids.js';

const PREFIX = 'gwfrpg:';
function storage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
}

export function createLocalBackend({ namespace = 'default', store = null, latencyMs = 0 } = {}) {
  const st = store || storage();
  const ns = PREFIX + namespace + ':';
  const read = (k, dflt) => { try { const v = st.getItem(ns + k); return v == null ? dflt : JSON.parse(v); } catch { return dflt; } };
  const write = (k, v) => st.setItem(ns + k, JSON.stringify(v));
  const listeners = new Map();      // roomId → Set(fn)
  // In a browser the channel carries events between tabs; in Node it exists too but must not keep the process alive.
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(ns + 'bus') : null;
  if (channel && typeof channel.unref === 'function') channel.unref();
  const tabId = shortId('tab');
  const emit = (roomId, event) => { for (const fn of listeners.get(roomId) || []) { try { fn(event); } catch (e) { console.error(e); } } };
  if (channel) channel.onmessage = (m) => { if (m.data?.sender !== tabId && m.data?.roomId) emit(m.data.roomId, m.data.event); };
  const delay = (v) => (latencyMs ? new Promise(res => setTimeout(() => res(v), latencyMs)) : Promise.resolve(v));

  const rooms = () => read('rooms', {});
  const saveRooms = (r) => write('rooms', r);
  const evKey = (roomId) => `events:${roomId}`;

  let identity = read('identity', null);
  if (!identity) { identity = { deviceId: uuid() }; write('identity', identity); }

  const api = {
    kind: 'local',
    identity: () => identity,
    async createRoom({ code, seed, mode = 'ffa', tier = 1, size = 'regular', gmPinHash = '' }) {
      const all = rooms();
      if (Object.values(all).some(r => r.code === code && r.status !== 'ended')) throw new Error('room code in use');
      const roomId = uuid();
      all[roomId] = { roomId, code, seed, mode, tier, size, gmPinHash, status: 'lobby', lastSeq: 0, snapshot: null, snapshotSeq: 0, createdAt: Date.now() };
      saveRooms(all); write(evKey(roomId), []);
      return delay({ roomId, code });
    },
    async findRoom(code) { const r = Object.values(rooms()).filter(r => r.code === code).sort((a, b) => b.createdAt - a.createdAt)[0]; return delay(r ? { ...r } : null); },
    async getRoom(roomId) { const r = rooms()[roomId]; return delay(r ? { ...r } : null); },
    async append(roomId, event) {
      const all = rooms(); const r = all[roomId]; if (!r) throw new Error('no such room');
      r.lastSeq += 1; const stored = { ...event, roomId, seq: r.lastSeq };
      if (['RUN_START', 'CREATION_OPEN'].includes(event.type)) r.status = event.type === 'RUN_START' ? 'playing' : 'creation';
      if (['RUN_END', 'GM_END_RUN'].includes(event.type)) r.status = 'ended';
      saveRooms(all);
      const log = read(evKey(roomId), []); log.push(stored); write(evKey(roomId), log);
      await delay(null);
      emit(roomId, stored);
      if (channel) channel.postMessage({ sender: tabId, roomId, event: stored });
      return stored;
    },
    async loadEvents(roomId, afterSeq = 0) { return delay(read(evKey(roomId), []).filter(e => e.seq > afterSeq)); },
    subscribe(roomId, onEvent) { if (!listeners.has(roomId)) listeners.set(roomId, new Set()); listeners.get(roomId).add(onEvent); return () => listeners.get(roomId)?.delete(onEvent); },
    async saveSnapshot(roomId, seq, state) { const all = rooms(); const r = all[roomId]; if (r && seq >= r.snapshotSeq) { r.snapshot = state; r.snapshotSeq = seq; saveRooms(all); } },
    roster: {
      async forDevice(deviceId) { return Object.values(read('roster', {})).find(o => o.deviceIds.includes(deviceId)) || null; },
      async create(deviceId, displayName = '') { const all = read('roster', {}); const o = { id: uuid(), claimCode: newClaimCode(), deviceIds: [deviceId], displayName, data: { characters: [], vault: [], pets: [], veterans: [] }, updatedAt: Date.now() }; all[o.id] = o; write('roster', all); return o; },
      async save(owner) { const all = read('roster', {}); all[owner.id] = { ...owner, updatedAt: Date.now() }; write('roster', all); return all[owner.id]; },
      async get(ownerId) { return read('roster', {})[ownerId] || null; },
      async claim(code, deviceId) { const all = read('roster', {}); const o = Object.values(all).find(o => o.claimCode === String(code).toUpperCase()); if (!o) throw new Error('no roster with that claim code'); if (!o.deviceIds.includes(deviceId)) o.deviceIds.push(deviceId); write('roster', all); return o; },
    },
    wall: {
      async all() { return read('wall', []); },
      async add(rows) { const w = read('wall', []); const keys = new Set(w.map(r => r.nameKey)); for (const r of rows) { const k = String(r.name).trim().toLowerCase(); if (!keys.has(k)) { w.push({ nameKey: k, ...r, diedAt: r.diedAt || Date.now() }); keys.add(k); } } write('wall', w); return w; },
      async taken(name) { const k = String(name).trim().toLowerCase(); return read('wall', []).some(r => r.nameKey === k); },
    },
    hallOfFame: { async list() { return read('hof', []); }, async add(row) { const h = read('hof', []); h.push({ id: shortId('h'), createdAt: Date.now(), ...row }); write('hof', h); return h; } },
    presets: { async list() { return read('presets', []); }, async save(p) { const all = read('presets', []).filter(x => x.id !== p.id); all.push(p); write('presets', all); return p; } },
    metaLedger: { async add(rows) { const all = read('meta', []); all.push(...rows.map(r => ({ id: shortId('m'), createdAt: Date.now(), ...r }))); write('meta', all); return all; }, async list() { return read('meta', []); } },
    seasons: { async current() { let s = read('season', null); if (!s) { s = { id: 1, name: 'Season 1', nights: 0, startedAt: Date.now() }; write('season', s); } return s; }, async save(s) { write('season', s); return s; } },
    // Test helper: wipe everything in this namespace.
    close() { channel?.close?.(); listeners.clear(); },
    _reset() { const keys = []; for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith(ns)) keys.push(k); } keys.forEach(k => st.removeItem(k)); write('identity', identity); },
  };
  return api;
}
