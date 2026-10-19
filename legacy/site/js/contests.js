// Digital battle contests (Phase 3 backlog → automated). When the Battle Wheel lands on a
// "Digital" contest the app can run it instead of the table improvising: coin flip, high card,
// dice duel. Ties are replayed automatically. The result is staged on the shared screen
// (state.contest) and the GM still presses the settle button — wagers never move by themselves.
import { log } from './state.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], SUITS = ['♠', '♥', '♦', '♣'];
// Which automated contest a Battle Wheel row means: an explicit `auto` column wins, else the label.
export function contestKind(row) {
  if (!row) return null;
  if (['coin', 'card', 'dice'].includes(row.auto)) return row.auto;
  const l = String(row.label || '').toLowerCase();
  if (/coin/.test(l)) return 'coin'; if (/card/.test(l)) return 'card'; if (/dice|roll/.test(l)) return 'dice';
  return null;
}

export function runContest(config, state, rng, kind, aId, bId) {
  const a = state.players.find(p => p.id === aId), b = state.players.find(p => p.id === bId);
  if (!a || !b || a.id === b.id) return { error: true, text: 'Pick two different players.' };
  const rounds = []; let winner = null;
  for (let i = 0; i < 12 && !winner; i++) {
    if (kind === 'coin') {
      const heads = rng.chance(0.5); rounds.push({ a: heads ? '🪙 HEADS' : '', b: heads ? '' : '🪙 TAILS', note: `${a.name} is heads, ${b.name} is tails` }); winner = heads ? a : b;
    } else if (kind === 'card') {
      const ca = { r: rng.int(0, 12), s: rng.int(0, 3) }, cb = { r: rng.int(0, 12), s: rng.int(0, 3) };
      rounds.push({ a: RANKS[ca.r] + SUITS[ca.s], b: RANKS[cb.r] + SUITS[cb.s], av: ca.r, bv: cb.r }); if (ca.r !== cb.r) winner = ca.r > cb.r ? a : b;
    } else if (kind === 'dice') {
      const da = [rng.int(1, 6), rng.int(1, 6)], db = [rng.int(1, 6), rng.int(1, 6)], sa = da[0] + da[1], sb = db[0] + db[1];
      rounds.push({ a: `🎲 ${da[0]} + ${da[1]} = ${sa}`, b: `🎲 ${db[0]} + ${db[1]} = ${sb}`, av: sa, bv: sb }); if (sa !== sb) winner = sa > sb ? a : b;
    } else return { error: true, text: 'That contest is not automated.' };
  }
  if (!winner) winner = rng.chance(0.5) ? a : b;                 // twelve straight ties: let fate decide
  const title = { coin: 'COIN FLIP', card: 'HIGH CARD', dice: 'DICE DUEL' }[kind];
  const last = rounds.at(-1);
  state.contest = { kind, title, aId: a.id, bId: b.id, aName: a.name, bName: b.name, rounds, winnerId: winner.id, winnerName: winner.name, ts: Date.now() };
  log(state, 'CONTEST', winner.id, { kind, vs: winner.id === a.id ? b.id : a.id, ties: rounds.length - 1, a: last.a, b: last.b });
  return { winnerId: winner.id, rounds, ties: rounds.length - 1, text: `${title}: ${a.name} ${last.a || '—'} vs ${b.name} ${last.b || '—'} → ${winner.name} wins${rounds.length > 1 ? ` (after ${rounds.length - 1} tie${rounds.length > 2 ? 's' : ''})` : ''}` };
}
export function clearContest(state) { const had = !!state.contest; state.contest = null; return had; }
