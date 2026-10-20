// The TV is the table's hands (UI-CHEATSHEET.md › GM, ARCHITECTURE.md): every second and after every event it
// appends the table duties (monster turns, Area resolution, challenge deadlines, vote closes, the clock at zero) as
// 'system', and plays every seat on autopilot — GM_AUTOPILOT, a seat proxied for over a minute with no console
// online, or a `?bots=N` demo seat — through the shared bot policy, dispatching as 'gm' with payload.playerId
// (requireActor lets the GM act for any seat; every seat handler reads payload.playerId first).
//
//   startAutopilot(session, { rng, botSeats, autostart, intervalMs, isGmOnline }) → { stop, tick, botSeats }
//
// Guards: one action per seat per second and never two in flight; one table duty of a type in flight at a time;
// CHALLENGE_GM_DECIDE is left to a live GM console (presence.gm within 30 s); a seat whose action is refused three
// times running backs off for five seconds, so a stale policy can never flood the log.
import { nextAction, tableDuties, botName } from '../shared/bot.js';
import { currentPlayerId, characterOf, activeSeats } from '../shared/state.js';
import { makeRng } from '../shared/rng.js';

const GM_FRESH_MS = 30000, PROXY_GRACE_MS = 60000, BACKOFF_MS = 5000;

export function startAutopilot(session, { rng = makeRng((Date.now() ^ 0x5bd1e995) >>> 0), botSeats = new Set(), autostart = false, intervalMs = 1000, isGmOnline = null, onAct = null } = {}) {
  const gmOnline = isGmOnline || ((now) => (session.presence?.gm || 0) > now - GM_FRESH_MS);
  const seatState = new Map();      // pid → { busy, last, refusals, backoffUntil, lastType }
  const dutyBusy = new Map();       // type → true while in flight
  let stopped = false, ticking = false, queued = false, startBusy = false;
  const seatRec = (pid) => { let r = seatState.get(pid); if (!r) { r = { busy: false, last: 0, refusals: 0, backoffUntil: 0, lastType: null }; seatState.set(pid, r); } return r; };

  const refusedNow = (type, before) => { const e = session.state.lastError; return e && e.type === type && e.ts >= before && Date.now() - e.ts < 5000 ? e : null; };
  async function dispatch(type, payload, actor) {
    const before = Date.now();
    try { await session.dispatch(type, payload, actor); } catch (e) { console.warn('[autopilot]', type, e.message); return { error: e.message }; }
    const err = refusedNow(type, before); if (err) console.warn('[autopilot] refused', type, err.message);
    onAct?.({ type, payload, actor, refused: err?.message || null });
    return { error: err?.message || null };
  }

  // Which seats the TV plays right now.
  function pilotedSeats(state, now) {
    const out = [];
    for (const pid of activeSeats(state)) {
      const p = state.players[pid]; if (!p) continue;
      if (botSeats.has(pid) || p.autopilot) { out.push(pid); continue; }
      if (p.proxied && !gmOnline(now)) { const since = state.gm?.proxies?.[pid] || 0; if (since && now - since > PROXY_GRACE_MS) out.push(pid); }
    }
    return out;
  }

  async function tick() {
    if (stopped || !session.state) return;
    if (ticking) { queued = true; return; }
    ticking = true;
    try {
      const state = session.state, now = Date.now();
      // 1. Table duties.
      if (state.phase === 'playing') {
        for (const d of tableDuties(state, rng, now)) {
          if (d.type === 'CHALLENGE_GM_DECIDE' && gmOnline(now)) continue;
          if (d.type === 'TURN_TIMEOUT' && session.__timeoutPending) continue;
          if (dutyBusy.get(d.type)) continue;
          dutyBusy.set(d.type, true);
          if (d.type === 'TURN_TIMEOUT') session.__timeoutPending = true;
          dispatch(d.type, d.payload, d.actor === 'gm' ? 'gm' : 'system').finally(() => { dutyBusy.delete(d.type); if (d.type === 'TURN_TIMEOUT') setTimeout(() => { session.__timeoutPending = false; }, 1500); });
        }
      }
      // 2. Seats on autopilot: the mover first, then everyone with a prompt, a challenge or a window to answer.
      const seats = pilotedSeats(state, now), mover = currentPlayerId(state);
      const order = [mover, ...seats.filter(id => id !== mover)].filter(id => id && seats.includes(id));
      let acted = false; const tickTypes = new Set();
      for (const pid of order) {
        const r = seatRec(pid);
        if (r.busy || now - r.last < intervalMs || now < r.backoffUntil) continue;
        let a = null;
        try { a = nextAction(state, pid, rng, now); } catch (e) { console.warn('[autopilot] policy', pid, e.message); r.backoffUntil = now + BACKOFF_MS; continue; }
        if (!a) continue;
        // Both parties of a challenge would report in the same tick; as 'gm' the first report settles it.
        if (a.type.startsWith('CHALLENGE_') && tickTypes.has(a.type)) continue; tickTypes.add(a.type);
        r.busy = true; r.last = now; r.lastType = a.type; acted = true;
        const payload = { ...a.payload }; if (payload.playerId == null) payload.playerId = pid;
        // Handlers that name the actor differently (see the engine-gap notes in the TV report).
        if ((a.type === 'LETTER_SEND' || a.type === 'ALLIANCE_PROPOSE') && payload.fromId == null) payload.fromId = pid;
        if (a.type === 'CHALLENGE_CALL' && payload.attackerId == null) payload.attackerId = pid;
        dispatch(a.type, payload, 'gm').then(({ error }) => {
          if (error) { r.refusals += 1; if (r.refusals >= 3) { r.backoffUntil = Date.now() + BACKOFF_MS; r.refusals = 0; } }
          else r.refusals = 0;
        }).finally(() => { r.busy = false; });
        if (pid === mover && state.phase === 'playing') break;     // one mover action per tick keeps the TV readable
      }
      // 3. Autostart for demos: open creation once the bots are seated, start the run once every seat is locked.
      if (autostart && !startBusy) {
        const ready = seats.length && seats.every(id => state.players[id]?.ready);
        if (state.phase === 'lobby' && ready && !acted) { startBusy = true; dispatch('CREATION_OPEN', {}, 'gm').finally(() => { startBusy = false; }); }
        else if (state.phase === 'creation' && !acted) {
          const locked = seats.length && seats.every(id => { const c = characterOf(state, id); return c && c.locked && !c.hatching && state.players[id]?.ready; });
          const idle = seats.every(id => !seatRec(id).busy);
          if (locked && idle) { startBusy = true; dispatch('RUN_START', {}, 'gm').finally(() => { startBusy = false; }); }
        }
      }
    } finally { ticking = false; if (queued) { queued = false; setTimeout(tick, 50); } }
  }
  const timer = setInterval(tick, intervalMs);
  const off = session.onChange(() => { if (!stopped) setTimeout(tick, 30); });
  tick();
  return { stop() { stopped = true; clearInterval(timer); off?.(); }, tick, botSeats };
}

// Seat N demo bots in the room (PLAYER_JOIN as 'system', then GM_AUTOPILOT so every client sees the flag).
export async function seatBots(session, n, { prefix = 'bot' } = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}-${i + 1}`; ids.push(id);
    if (!session.state.players[id]) {
      const name = botName(i, session.state);
      await session.dispatch('PLAYER_JOIN', { playerId: id, name, deviceId: `${prefix}-device-${i + 1}` }, 'system');
    }
    if (!session.state.players[id]?.autopilot) await session.dispatch('GM_AUTOPILOT', { playerId: id, on: true }, 'gm');
  }
  return ids;
}
