// Shared fixtures for the unit suites. Everything runs in plain Node: no DOM, no backend.
import * as shared from '../../packages/shared/index.js';
import { makeEvent } from '../../packages/shared/events.js';

export { shared };
export const { applyEvent, replay, initialState, currentPlayerId, characterOf, B } = shared;

// A tiny in-process room: append(type, payload, actor) applies an event in place and returns the state.
export function room({ seed = 42, mode = 'ffa', tier = 1, size = 'regular', code = 'ABCD', t0 = 1_700_000_000_000, balance = null } = {}) {
  let now = t0; let seq = 0;
  let state = applyEvent({}, { ...makeEvent('ROOM_CREATED', { roomId: 'r1', code, seed, mode, tier, size, gmPinHash: 'x', balance: balance || undefined }, { actor: 'gm', ts: now }), seq: ++seq }, { clone: false, strict: true });
  const api = {
    get state() { return state; },
    now: () => now,
    tick: (ms) => { now += ms; return now; },
    append(type, payload = {}, actor = 'gm', { strict = true } = {}) {
      const ev = { ...makeEvent(type, payload, { actor, ts: now }), seq: ++seq };
      state = applyEvent(state, ev, { clone: false, strict });
      return state;
    },
    try(type, payload = {}, actor = 'gm') { try { api.append(type, payload, actor); return null; } catch (e) { return e; } },
    join(names) { names.forEach((n, i) => api.append('PLAYER_JOIN', { playerId: 'p' + i, name: n, deviceId: 'd' + i }, 'system')); return api; },
  };
  return api;
}
export const names4 = ['Aj', 'Nick', 'Sam', 'Vin'];
