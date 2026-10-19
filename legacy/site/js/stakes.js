// IRL stakes (Phase 6) — real-life side bets, RECORD-ONLY: nothing here ever moves
// in-game currency. A stake is { id, ts, text, playerIds[], settled, settledTs, winnerId, note }.
import { log } from './state.js';

// Older saves stored { ts, text, settled } with no id / players — bring them up to shape.
export function normalizeStakes(state) {
  if (!Array.isArray(state.stakes)) state.stakes = [];
  // Upgrade IN PLACE — callers hold references to these objects across calls.
  state.stakes.forEach((s, i) => {
    if (!s.id) s.id = `s${s.ts || 0}_${i}`;
    if (!s.ts) s.ts = Date.now();
    s.text = String(s.text || '');
    if (!Array.isArray(s.playerIds)) s.playerIds = [];
    s.settled = !!s.settled;
    s.settledTs = s.settledTs || null; s.winnerId = s.winnerId || null; s.note = s.note || '';
  });
  return state.stakes;
}

export function addStake(state, { text, playerIds = [] } = {}) {
  const t = String(text || '').trim();
  if (!t) return { error: true, text: 'Describe the stake first.' };
  normalizeStakes(state);
  const valid = [...new Set(playerIds)].filter(id => state.players.some(p => p.id === id));
  const stake = { id: `s${Date.now()}_${state.stakes.length}`, ts: Date.now(), text: t, playerIds: valid, settled: false, settledTs: null, winnerId: null, note: '' };
  state.stakes.push(stake);
  log(state, 'STAKE', null, { stakeId: stake.id, text: t, players: valid, note: 'record-only, no in-game consequence' });
  return { stake, text: `Stake logged: ${t}` };
}

export function settleStake(state, id, { winnerId = null, note = '' } = {}) {
  const s = normalizeStakes(state).find(x => x.id === id);
  if (!s) return { error: true, text: 'No such stake.' };
  if (s.settled) return { error: true, text: 'Already settled.' };
  const winner = winnerId ? state.players.find(p => p.id === winnerId) : null;
  s.settled = true; s.settledTs = Date.now(); s.winnerId = winner ? winner.id : null; s.note = String(note || '');
  log(state, 'STAKE_SETTLED', s.winnerId, { stakeId: s.id, text: s.text, note: s.note });
  return { stake: s, text: `Settled: ${s.text}${winner ? ` — ${winner.name} wins` : ''}` };
}

export function reopenStake(state, id) {
  const s = normalizeStakes(state).find(x => x.id === id);
  if (!s) return { error: true, text: 'No such stake.' };
  if (!s.settled) return { error: true, text: 'Stake is already open.' };
  s.settled = false; s.settledTs = null; s.winnerId = null; s.note = '';
  log(state, 'STAKE_REOPENED', null, { stakeId: s.id, text: s.text });
  return { stake: s, text: `Reopened: ${s.text}` };
}

export const openStakes = (state) => normalizeStakes(state).filter(s => !s.settled);

// Human line for either window: "Aj vs Nick — loser buys pizza (Nick won)"
export function stakeLine(state, s) {
  const name = (id) => state.players.find(p => p.id === id)?.name || '?';
  const who = s.playerIds.length ? s.playerIds.map(name).join(' vs ') + ' — ' : '';
  const tail = s.settled ? (s.winnerId ? ` (${name(s.winnerId)} won)` : ' (settled)') + (s.note ? ` · ${s.note}` : '') : '';
  return who + s.text + tail;
}
