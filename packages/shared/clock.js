// Chess clocks. Each seat has a bank of milliseconds; the mover's clock runs from `runningSince` (an event
// timestamp). Remaining time is always computed from timestamps, never ticked, so a phone that sleeps or
// a TV that lags cannot drift the game. The TV appends TURN_TIMEOUT when it sees the mover at zero.
export function clockOf(state, playerId) { return state.clocks[playerId] || (state.clocks[playerId] = { bankMs: 0, runningSince: null }); }
export function remainingMs(state, playerId, now) {
  const c = state.clocks[playerId]; if (!c) return 0;
  const elapsed = c.runningSince != null && !state.gm.paused ? Math.max(0, now - c.runningSince) : 0;
  return Math.max(0, c.bankMs - elapsed);
}
export function startClock(state, playerId, now, B, bonusSeconds = 0) {
  const c = clockOf(state, playerId);
  c.bankMs = Math.min(B.bankCapSeconds * 1000, c.bankMs + (B.perTurnSeconds + bonusSeconds) * 1000);
  c.runningSince = state.gm.paused ? null : now;
  c.pendingStart = state.gm.paused ? true : false;
}
export function stopClock(state, playerId, now) {
  const c = state.clocks[playerId]; if (!c) return;
  if (c.runningSince != null) c.bankMs = Math.max(0, c.bankMs - Math.max(0, now - c.runningSince));
  c.runningSince = null; c.pendingStart = false;
}
export function pauseAll(state, now) { for (const [id, c] of Object.entries(state.clocks)) if (c.runningSince != null) { c.bankMs = Math.max(0, c.bankMs - Math.max(0, now - c.runningSince)); c.runningSince = null; c.pendingStart = true; } }
export function resumeAll(state, now) { for (const c of Object.values(state.clocks)) if (c.pendingStart) { c.runningSince = now; c.pendingStart = false; } }
export const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
