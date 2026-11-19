// Shared fixtures for the unit suites. Everything runs in plain Node: no DOM, no backend.
import * as shared from '../../packages/shared/index.js';
import { makeEvent } from '../../packages/shared/events.js';

import { pack, unpack } from '../../packages/shared/snapshot.js';
const SHADOW = process.env.GWF_SHADOW === '1';
const flat = (x) => JSON.stringify(x, (k, v) => k === 'lastError' ? undefined : v);
const firstDiff = (a, b, path = '') => { if (typeof a !== typeof b || (a === null) !== (b === null)) return `${path} (${JSON.stringify(a)?.slice(0, 40)} vs ${JSON.stringify(b)?.slice(0, 40)})`; if (typeof a !== 'object' || a === null) return a === b ? null : `${path} (${a} vs ${b})`; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], path + '.' + k); if (d) return d; } return null; };
export { shared };
export const { applyEvent, replay, initialState, currentPlayerId, characterOf, B } = shared;

// A tiny in-process room: append(type, payload, actor) applies an event in place and returns the state.
// Event ids are derived from seq (makeEvent's are random) so two rooms fed the same events build identical states;
// some handlers (tiles.js fight ids) fold the event id into state.
// `ramp` is the tutorial opening (handlers/ramp.js): off here by default so every suite plays a full first turn; ramp.test.mjs turns it on.
export function room({ seed = 42, mode = 'ffa', tier = 1, size = 'regular', code = 'ABCD', t0 = 1_700_000_000_000, balance = null, ramp = false, rampSteps = undefined } = {}) {
  let now = t0; let seq = 0;
  let state = applyEvent({}, { ...makeEvent('ROOM_CREATED', { roomId: 'r1', code, seed, mode, tier, size, gmPinHash: 'x', balance: balance || undefined, ramp, rampSteps }, { actor: 'gm', ts: now }), id: 'e1', seq: ++seq }, { clone: false, strict: true });
  const api = {
    get state() { return state; },
    now: () => now,
    tick: (ms) => { now += ms; return now; },
    append(type, payload = {}, actor = 'gm', { strict = true } = {}) {
      const ev = { ...makeEvent(type, payload, { actor, ts: now }), id: 'e' + (seq + 1), seq: ++seq };
      // GWF_SHADOW=1: before every event, a second copy of the room goes through a snapshot (JSON) and takes the same
      // event; the two must agree afterwards. This is every scenario in the unit suite asking "does a phone that
      // just reloaded compute what the table computes?" (see snapshot.test.mjs for why that matters).
      // Run it as: GWF_SHADOW=1 node --test test/unit/*.test.mjs 2>&1 | grep 'SHADOW DIVERGED'  (no output = good; the
      // ten or so tests that count calls to a spy hook fail in this mode because the shadow calls the hook too).
      const pre = SHADOW ? unpack(JSON.parse(JSON.stringify(pack(state)))) : null;
      state = applyEvent(state, ev, { clone: false, strict });
      if (pre) { const sh = applyEvent(pre, JSON.parse(JSON.stringify(ev)), { clone: false, strict: false }); const a = flat(state), b = flat(sh); if (a !== b) { const d = firstDiff(JSON.parse(a), JSON.parse(b)); if (d) throw new Error(`SHADOW DIVERGED after ${type} at ${d}`); } }
      return state;
    },
    try(type, payload = {}, actor = 'gm') { try { api.append(type, payload, actor); return null; } catch (e) { return e; } },
    join(names) { names.forEach((n, i) => api.append('PLAYER_JOIN', { playerId: 'p' + i, name: n, deviceId: 'd' + i }, 'system')); return api; },
  };
  return api;
}
export const names4 = ['Aj', 'Nick', 'Sam', 'Vin'];
