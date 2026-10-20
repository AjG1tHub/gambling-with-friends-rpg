// The run: creation → start → turns → end. Other modules plug into the turn loop through `hooks` so this
// file never needs to know about Chaos, pacts, letters or death penalties:
//   hooks.runStart(state, ctx)        after seats are shuffled, before the first turn (map, kits, quests)
//   hooks.turnStart(state, ctx, pid)  start of every turn; return 'skip' to end that turn at once (dead, missed turns)
//   hooks.turnEnd(state, ctx, pid)    end of every turn (letters tick, cooldowns)
//   hooks.roundEnd(state, ctx)        when turnIdx wraps the table (Chaos tier, tile loot sweep)
//   hooks.endCheck(state, ctx)        after every event while playing; return { winner, reason } to end the run
import { register, refuse, requireGm, requirePhase, requireActor, onAfter } from '../reducer.js';
import { activeSeats, tableSeats, currentPlayerId, characterOf, note, ensureCharacterShape } from '../state.js';
import { startClock, stopClock } from '../clock.js';
import { streamRng, rigAwareWeightedIndex } from '../rng.js';

export const hooks = { runStart: [], turnStart: [], turnEnd: [], roundEnd: [], endCheck: [], turnPhaseAdvance: [] };

export function beginTurn(state, ctx) {
  let guard = 0;
  while (guard++ < 64) {
    state.moverId = null;
    const pid = currentPlayerId(state); if (!pid) return;
    state.moverId = pid;
    const p = state.players[pid], c = ensureCharacterShape(characterOf(state, pid));
    state.turnStartedAt = ctx.now; state.turnPhase = 'move'; state.moveSession = null; state.pendingPrompt = null;
    state.stats[pid] && (state.stats[pid].turns += 1);
    if (c) { c.turnsTaken = (c.turnsTaken || 0) + 1; c.usedThisTurn = { attack: 0, spell: 0, moved: false }; }
    let skip = false;
    for (const h of hooks.turnStart) { if (h(state, ctx, pid) === 'skip') skip = true; }
    if (skip) { finishTurn(state, ctx, pid, 'skipped'); continue; }
    const nerve = c ? Math.max(0, (c.stats?.nerve || 0) - ctx.B('stats').neutral) * ctx.B('health').nerveClockSeconds : 0;
    startClock(state, pid, ctx.now, ctx.B('clock'), nerve);
    note(state, `${p.name}'s turn`, 'turn', ctx.now);
    return;
  }
}
export function finishTurn(state, ctx, pid, how) {
  stopClock(state, pid, ctx.now);
  state.moverId = null;
  for (const h of hooks.turnEnd) h(state, ctx, pid, how);
  const seats = tableSeats(state), before = state.turnIdx;
  state.turnIdx += 1;
  // One lap of the table = a round.
  if (seats.length && Math.floor(state.turnIdx / seats.length) > Math.floor(before / seats.length)) { state.round += 1; for (const h of hooks.roundEnd) h(state, ctx); }
  state.moveSession = null; state.turnPhase = 'move'; state.pendingPrompt = null;
}
export function endTurn(state, ctx, how = 'ended') {
  const pid = currentPlayerId(state); if (!pid) return;
  // Leaving an encounter mid-fight: the monster gets a parting blow (the TV plays it), then the fight closes as 'left'.
  if (state.fight && state.fight.playerId === pid && !state.fight.done && state.fight.kind !== 'solo') { state.fight.passed = true; state.fight.turn = 'monster'; if (state.fight.game && !state.fight.game.result) { state.fight.abandonedGame = state.fight.game; state.fight.game = null; } }
  if (state.fight && state.fight.kind === 'solo' && state.fight.playerId === pid) state.fight.done = true;
  finishTurn(state, ctx, pid, how);
  if (state.phase === 'playing') beginTurn(state, ctx);
}
export function endRun(state, ctx, winner, reason) {
  if (state.phase === 'ended') return;
  state.phase = 'ended'; state.endedAt = ctx.now; state.winner = winner || null; state.endReason = reason || '';
  for (const id of Object.keys(state.clocks)) stopClock(state, id, ctx.now);
  note(state, `Run over: ${reason || 'the GM called it'}`, 'end', ctx.now);
}

register({
  CREATION_OPEN(state, ev, ctx) { requireGm(ctx); requirePhase(state, 'lobby'); state.phase = 'creation'; state.creationOpenedAt = ctx.now; note(state, 'Character creation is open', 'gm', ctx.now); },
  BUYIN_FLAT(state, ev, ctx) {
    requireGm(ctx); requirePhase(state, 'lobby', 'creation');
    const c = characterOf(state, ctx.payload.playerId); if (!c) refuse('no character');
    const v = Math.round(Number(ctx.payload.health ?? ctx.B('health').flatStart));
    c.maxHealth = v; c.health = v; c.buyinSpun = true;
  },
  BUYIN_SPIN(state, ev, ctx) {
    requirePhase(state, 'lobby', 'creation');
    const pid = ctx.payload.playerId; requireActor(state, ctx, pid);
    const c = characterOf(state, pid); if (!c) refuse('no character'); if (c.buyinSpun) refuse('already spun');
    const H = ctx.B('health'), steps = 8, span = H.buyinMax - H.buyinMin;
    const segments = Array.from({ length: steps }, (_, i) => ({ label: String(Math.round(H.buyinMin + span * i / (steps - 1))), weight: 1 }));
    const i = rigAwareWeightedIndex(state, 'wheels', segments);
    const v = Number(segments[i].label); c.maxHealth = v; c.health = v; c.buyinSpun = true;
    state.lastSpin = { wheel: 'buyin', outcomes: segments.map(s => s.label), index: i, playerId: pid, ts: ctx.now };
    note(state, `${state.players[pid].name} buys in at ${v} Health`, 'wheel', ctx.now);
  },
  META_LEDGER(state, ev, ctx) {
    requireGm(ctx);
    const { playerId, buyIn, notes } = ctx.payload;
    const row = state.metaLedger.find(r => r.playerId === playerId) || (state.metaLedger.push({ playerId }) && state.metaLedger.at(-1));
    row.buyIn = String(buyIn ?? ''); row.notes = String(notes || '').slice(0, 140); row.ts = ctx.now;
  },
  RUN_START(state, ev, ctx) {
    requireGm(ctx); requirePhase(state, 'lobby', 'creation');
    const seats = activeSeats(state); if (!seats.length) refuse('nobody at the table');
    state.seats = streamRng(state, 'misc').shuffle(seats);
    state.phase = 'playing'; state.startedAt = ctx.now; state.turnIdx = 0; state.round = 1;
    for (const c of Object.values(state.characters)) ensureCharacterShape(c);
    for (const h of hooks.runStart) h(state, ctx);
    note(state, `The run begins. Order: ${state.seats.map(id => state.players[id].name).join(' → ')}`, 'start', ctx.now);
    beginTurn(state, ctx);
  },
  TURN_END(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = currentPlayerId(state); requireActor(state, ctx, pid);
    if (state.gm.paused && !ctx.isGm) refuse('paused', 'paused');
    if (state.challenge && !state.challenge.done && (state.challenge.attackerId === pid || state.challenge.defenderId === pid)) refuse('finish the challenge first', 'challenge');
    endTurn(state, ctx, 'ended');
  },
  TURN_TIMEOUT(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = currentPlayerId(state); if (!pid) return;
    const c = state.clocks[pid]; if (!c || c.runningSince == null) return;
    if (c.bankMs - (ctx.now - c.runningSince) > ctx.B('clock').timeoutSlackMs) refuse('clock not yet at zero', 'early');
    note(state, `${state.players[pid].name} ran out of time`, 'turn', ctx.now);
    endTurn(state, ctx, 'timeout');
  },
  CLOCK_TICK() { /* a no-op event the TV may append to force clients to re-render clocks; kept for logs */ },
  GM_END_RUN(state, ev, ctx) { requireGm(ctx); endRun(state, ctx, ctx.payload.winner || null, ctx.payload.reason || 'the GM called it'); },
  RUN_END(state, ev, ctx) { requireGm(ctx); endRun(state, ctx, ctx.payload.winner || null, ctx.payload.reason || 'ended'); },
});

onAfter((state, ev, ctx) => {
  if (state.phase !== 'playing') return;
  for (const h of hooks.endCheck) { const r = h(state, ctx); if (r) { endRun(state, ctx, r.winner, r.reason); return; } }
});
