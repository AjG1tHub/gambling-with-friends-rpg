// A live room session for one client (a phone, the TV, the GM console or a bot). Opens the room from the
// backend's snapshot plus the events after it, subscribes to new events, applies everything in seq order
// (buffering out-of-order arrivals and back-filling gaps), and exposes dispatch() to append.
//
// Presence is not an event (it would flood the log): the session pings the backend's presence channel and
// exposes `presence` (playerId → lastSeenTs) so the TV can decide proxy mode after 30 seconds of silence.
import { applyEvent } from './reducer.js';
import { makeEvent } from './events.js';

export async function openRoom(backend, { roomId, code, role = 'phone', onChange = () => {}, onError = () => {}, snapshotEvery = 25, gapMs = 1500 } = {}) {
  const info = roomId ? await backend.getRoom(roomId) : await backend.findRoom(code);
  if (!info) throw new Error(roomId ? 'room not found' : `no room with code ${code}`);
  roomId = info.roomId;
  let state = info.snapshot && info.snapshotSeq ? info.snapshot : null;
  let lastSeq = state ? info.snapshotSeq : 0;
  const buffer = new Map();            // seq → event, arrivals ahead of lastSeq
  const listeners = new Set([onChange]);
  let closed = false, gapTimer = null, filling = false;
  const presence = {};

  const notify = (ev) => { for (const fn of listeners) { try { fn(state, ev); } catch (e) { onError(e); } } };
  const applyOne = (ev) => {
    const next = applyEvent(state || {}, ev, { clone: false, strict: false });
    state = next; lastSeq = ev.seq;
    if (state.lastError && state.lastError.ts === ev.ts && state.lastError.type === ev.type) onError(Object.assign(new Error(state.lastError.message), { event: ev, code: state.lastError.code }));
    notify(ev);
    if (role === 'tv' && snapshotEvery && lastSeq % snapshotEvery === 0) backend.saveSnapshot(roomId, lastSeq, state).catch(onError);
  };
  const drain = () => { while (buffer.has(lastSeq + 1)) { const ev = buffer.get(lastSeq + 1); buffer.delete(ev.seq); applyOne(ev); } if (buffer.size && !gapTimer) gapTimer = setTimeout(fillGap, gapMs); };
  async function fillGap() {
    gapTimer = null; if (closed || filling) return; filling = true;
    try { const missing = await backend.loadEvents(roomId, lastSeq); for (const ev of missing) if (ev.seq > lastSeq) buffer.set(ev.seq, ev); drain(); } catch (e) { onError(e); } finally { filling = false; }
  }
  const ingest = (ev) => { if (closed || ev.seq <= lastSeq) return; buffer.set(ev.seq, ev); drain(); };

  // Subscribe first, then back-fill, so nothing slips between the two.
  const unsub = backend.subscribe(roomId, ingest);
  const events = await backend.loadEvents(roomId, lastSeq);
  for (const ev of events) buffer.set(ev.seq, ev);
  drain();
  if (!state) throw new Error('room has no events');

  const session = {
    roomId, code: info.code, role, backend,
    get state() { return state; }, get lastSeq() { return lastSeq; }, presence,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async dispatch(type, payload = {}, actor = 'system') {
      const ev = makeEvent(type, payload, { actor, ts: Date.now(), roomId });
      const stored = await backend.append(roomId, ev);
      ingest(stored);
      // In strict terms the local apply happens through ingest; a caller that wants the refusal can look at state.lastError.
      return stored;
    },
    // Apply an event without appending it (previews, bots in pure memory).
    peek(type, payload = {}, actor = 'system') { return applyEvent(state, makeEvent(type, payload, { actor, ts: Date.now(), roomId }), { clone: true, strict: false }); },
    touch(playerId, ts = Date.now()) { presence[playerId] = ts; },
    async refresh() { await fillGap(); },
    close() { closed = true; unsub?.(); if (gapTimer) clearTimeout(gapTimer); listeners.clear(); },
  };
  return session;
}

// Create a room and open it as its GM/TV client.
export async function createRoom(backend, { code, seed, mode, tier, size, gmPinHash, role = 'tv', balance = null, challengePreset = null, fogOfWar = null, gmDeviceId = null, ...rest }) {
  const made = await backend.createRoom({ code, seed, mode, tier, size, gmPinHash });
  await backend.append(made.roomId, makeEvent('ROOM_CREATED', { roomId: made.roomId, code, seed, mode, tier, size, gmPinHash, balance: balance || undefined, challengePreset: challengePreset || undefined, fogOfWar: fogOfWar ?? undefined, gmDeviceId }, { actor: 'gm', ts: Date.now(), roomId: made.roomId }));
  return openRoom(backend, { roomId: made.roomId, role, ...rest });
}
