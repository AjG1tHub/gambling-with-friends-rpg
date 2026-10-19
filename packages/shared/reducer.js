// applyEvent(state, event) → state. The single reducer every client runs. Handlers are plain functions
// (state, event, ctx) that mutate `state` in place; the caller decides whether to clone first.
// A handler that throws leaves the room exactly as it was: the reducer applies to a working copy and only
// commits on success, and the error is recorded on state.lastError so the GM console can show it.
//
// ctx = { now, actor, isGm, payload, B(group) } — `now` is the event's timestamp, never Date.now().
import { note } from './state.js';
import { group } from './balance.js';

const HANDLERS = new Map();
const BEFORE = [];      // hooks run before every event (e.g. the clock catch-up)
const AFTER = [];       // hooks run after every successful event (e.g. end-of-run checks)

export function register(table) {
  for (const [type, fn] of Object.entries(table)) {
    if (HANDLERS.has(type)) throw new Error(`handler for ${type} registered twice`);
    HANDLERS.set(type, fn);
  }
}
export const onBefore = (fn) => BEFORE.push(fn);
export const onAfter = (fn) => AFTER.push(fn);
export const hasHandler = (type) => HANDLERS.has(type);
export const handlerTypes = () => [...HANDLERS.keys()];

export class EventError extends Error { constructor(msg, code = 'refused') { super(msg); this.code = code; } }
export const refuse = (msg, code) => { throw new EventError(msg, code); };

export function applyEvent(state, event, { clone = true, strict = false } = {}) {
  const fn = HANDLERS.get(event.type);
  if (!fn) { if (strict) throw new EventError(`no handler for ${event.type}`, 'unknown'); return state; }
  const work = clone ? structuredClone(state) : state;
  const ctx = { now: Number(event.ts) || 0, actor: event.actor, isGm: event.actor === 'gm' || event.actor === 'system', payload: event.payload || {}, B: (g) => group(work, g), event };
  try {
    for (const h of BEFORE) h(work, event, ctx);
    fn(work, event, ctx);
    for (const h of AFTER) h(work, event, ctx);
    work.eventCount = (work.eventCount || 0) + 1;
    work.lastEventTs = ctx.now;
    work.lastSeq = event.seq ?? work.lastSeq ?? null;
    work.lastError = null;
    return work;
  } catch (e) {
    if (strict) throw e;
    // Refusals are normal play (a stale phone taps twice); they are kept on the state for the UI to show.
    if (!clone) { state.lastError = { type: event.type, actor: event.actor, message: e.message, code: e.code || 'error', ts: ctx.now }; return state; }
    const out = structuredClone(state);
    out.lastError = { type: event.type, actor: event.actor, message: e.message, code: e.code || 'error', ts: ctx.now };
    if (!(e instanceof EventError)) note(out, `⚠ ${event.type}: ${e.message}`, 'error', ctx.now);
    return out;
  }
}

// Rebuild a room from its event log. Events are applied in seq order; the first must be ROOM_CREATED.
export function replay(events, { strict = false } = {}) {
  let state = null;
  const sorted = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const ev of sorted) {
    if (!state) { if (ev.type !== 'ROOM_CREATED') { if (strict) throw new EventError('log does not start with ROOM_CREATED'); continue; } state = applyEvent({ __fresh: true }, ev, { clone: false, strict }); continue; }
    state = applyEvent(state, ev, { clone: false, strict });
  }
  return state;
}

// Common guards handlers share.
export function requireGm(ctx) { if (!ctx.isGm) refuse('GM only', 'forbidden'); }
export function requirePhase(state, ...phases) { if (!phases.includes(state.phase)) refuse(`not in ${phases.join('/')} (now ${state.phase})`, 'phase'); }
export function requirePlayer(state, id) { const p = state.players[id]; if (!p || p.kicked) refuse(`no such player ${id}`, 'player'); return p; }
export function requireNotPaused(state, ctx) { if (state.gm.paused && !ctx.isGm) refuse('game is paused', 'paused'); }
// Who may act for a seat: the seat itself, the GM, or the system.
export function requireActor(state, ctx, playerId) {
  if (ctx.isGm) return;
  if (ctx.actor !== playerId) refuse(`${ctx.actor} cannot act for ${playerId}`, 'forbidden');
  if (state.players[playerId]?.proxied) refuse('this seat is proxied by the GM', 'proxied');
}
