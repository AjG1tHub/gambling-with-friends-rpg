// Turn tools (Phase 6/7): reorder the table, bench or return a player mid-session, and a shot
// clock. state.turnOrder is the list of ids that take turns; state.turnIdx counts turns since
// the session began (current = turnOrder[turnIdx % length]). Every edit here keeps the SAME
// player "up" unless that player is the one being benched.
import { log, currentPlayer } from './state.js';

const curId = (state) => currentPlayer(state)?.id || null;
// Re-point turnIdx at `id` without changing how many full rounds have been counted.
function pointAt(state, id) {
  const n = state.turnOrder.length; if (!n) { state.turnIdx = 0; return; }
  const i = Math.max(0, state.turnOrder.indexOf(id));
  state.turnIdx = Math.floor(state.turnIdx / Math.max(1, n)) * n + i;
}

// Move a player one seat earlier (-1) or later (+1) in the turn order.
export function moveInOrder(state, playerId, delta) {
  const o = state.turnOrder, i = o.indexOf(playerId); if (i < 0) return { error: true, text: 'That player is not in the turn order.' };
  const j = i + Math.sign(delta); if (j < 0 || j >= o.length) return { error: true, text: 'Already at the end of the order.' };
  const up = curId(state);
  [o[i], o[j]] = [o[j], o[i]];
  pointAt(state, up);
  log(state, 'TURN_ORDER', playerId, { order: [...o] });
  return { text: `Turn order: ${o.map(id => state.players.find(p => p.id === id)?.name || '?').join(' → ')}` };
}

// Take a player out of the rotation (bathroom, phone call, rage quit). They keep everything they own.
export function benchPlayer(state, playerId, why = 'benched') {
  const p = state.players.find(x => x.id === playerId); if (!p) return { error: true, text: 'No such player.' };
  const o = state.turnOrder, i = o.indexOf(playerId); if (i < 0) return { error: true, text: `${p.name} is already out of the rotation.` };
  if (o.length <= 1) return { error: true, text: 'Someone has to keep playing.' };
  const wasUp = curId(state) === playerId;
  const next = wasUp ? o[(i + 1) % o.length] : curId(state);
  const rounds = Math.floor(state.turnIdx / o.length);
  o.splice(i, 1); p.benched = true;
  state.turnIdx = rounds * o.length + Math.max(0, o.indexOf(next));
  if (wasUp) { state.move = null; state.turnStartedTs = Date.now(); }
  log(state, 'PLAYER_BENCH', playerId, { why });
  return { wasUp, text: `${p.name} sits out${wasUp ? ` — ${state.players.find(x => x.id === next)?.name} is up` : ''}.` };
}

// Put a benched player back at the end of the order.
export function returnPlayer(state, playerId) {
  const p = state.players.find(x => x.id === playerId); if (!p) return { error: true, text: 'No such player.' };
  if (state.turnOrder.includes(playerId)) return { error: true, text: `${p.name} is already playing.` };
  const up = curId(state);
  state.turnOrder.push(playerId); p.benched = false;
  if (up) pointAt(state, up);
  log(state, 'PLAYER_RETURN', playerId, {});
  return { text: `${p.name} is back in — acting last in the order.` };
}
export const benched = (state) => state.players.filter(p => !state.turnOrder.includes(p.id));

// ── Shot clock ───────────────────────────────────────────────────
export const TIMER_CHOICES = [0, 30, 60, 90, 120, 180];
// Seconds left on the current turn, or null when the clock is off / not running.
export function turnTimeLeft(state, now = Date.now()) {
  const limit = Number(state.turnTimerSec) || 0;
  if (!limit || state.phase !== 'playing' || !state.turnStartedTs) return null;
  return Math.ceil(limit - (now - state.turnStartedTs) / 1000);
}
export function timerView(state, now = Date.now()) {
  const left = turnTimeLeft(state, now); if (left === null) return null;
  const limit = Number(state.turnTimerSec);
  return { left, limit, over: left <= 0, pct: Math.max(0, Math.min(100, left / limit * 100)), text: left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'TIME!' };
}
export function restartTurnClock(state, now = Date.now()) { state.turnStartedTs = now; }
