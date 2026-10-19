import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, fixedRng, events } from './_helpers.mjs';
const CT = await import('../../site/js/contests.js');

const int = (n, lo, hi) => (n - lo + 0.5) / (hi - lo + 1);        // make rng.int(lo, hi) return n

test('contest kind comes from the auto column, else from the label', () => {
  assert.equal(CT.contestKind({ label: 'Whatever', auto: 'dice' }), 'dice');
  assert.deepEqual(['Coin Flip', 'High Card', 'Dice Duel (high roll)', 'Thumb War', 'Staring Contest'].map(label => CT.contestKind({ label })), ['coin', 'card', 'dice', null, null]);
  assert.equal(CT.contestKind({ label: 'Coin Flip', auto: 'nonsense' }), 'coin'); assert.equal(CT.contestKind(null), null);
});

test('the default Battle Wheel marks its three digital contests as automated', () => {
  const c = mkGame(); const kinds = c.config.Wheel_Battle.map(CT.contestKind).filter(Boolean).sort();
  assert.deepEqual(kinds, ['card', 'coin', 'dice']);
});

test('coin flip: heads = the challenger, tails = the opponent', () => {
  const c = mkGame();
  assert.equal(CT.runContest(c.config, c.state, fixedRng([0.1]), 'coin', c.p.id, c.q.id).winnerId, c.p.id);
  assert.equal(CT.runContest(c.config, c.state, fixedRng([0.9]), 'coin', c.p.id, c.q.id).winnerId, c.q.id);
  assert.equal(c.state.contest.title, 'COIN FLIP'); assert.equal(c.state.contest.winnerName, 'Nick');
});

test('high card: higher rank wins, aces high, suits do not matter', () => {
  const c = mkGame();
  const r = CT.runContest(c.config, c.state, fixedRng([int(12, 0, 12), 0, int(11, 0, 12), 0.9]), 'card', c.p.id, c.q.id);     // A♠ vs K♣
  assert.equal(r.winnerId, c.p.id); assert.match(r.text, /A♠ vs Nick K♣/);
});

test('high card ties are replayed until someone wins', () => {
  const c = mkGame(); const seven = int(5, 0, 12);
  const r = CT.runContest(c.config, c.state, fixedRng([seven, 0, seven, 0, seven, 0, seven, 0, int(0, 0, 12), 0, int(9, 0, 12), 0]), 'card', c.p.id, c.q.id);
  assert.equal(r.ties, 2); assert.equal(r.winnerId, c.q.id); assert.match(r.text, /after 2 ties/); assert.equal(c.state.contest.rounds.length, 3);
});

test('dice duel: 2d6 each, higher total wins', () => {
  const c = mkGame(); const d = (n) => int(n, 1, 6);
  const r = CT.runContest(c.config, c.state, fixedRng([d(6), d(5), d(2), d(3)]), 'dice', c.p.id, c.q.id);
  assert.equal(r.winnerId, c.p.id); assert.match(r.text, /6 \+ 5 = 11 vs Nick 🎲 2 \+ 3 = 5/);
});

test('each contest is fair: both sides win about half the time', () => {
  for (const kind of ['coin', 'card', 'dice']) {
    const c = mkGame(); let a = 0; const N = 6000;
    for (let i = 0; i < N; i++) { if (CT.runContest(c.config, c.state, c.rng, kind, c.p.id, c.q.id).winnerId === c.p.id) a++; c.state.ledger.length = 0; }
    assert.ok(Math.abs(a / N - 0.5) < 0.03, `${kind}: challenger wins ${a / N}`);
  }
});

test('a contest never moves money — it only stages the result and logs it', () => {
  const c = mkGame(); const before = JSON.stringify(c.players.map(p => p.balances));
  CT.runContest(c.config, c.state, c.rng, 'dice', c.p.id, c.q.id);
  assert.equal(JSON.stringify(c.players.map(p => p.balances)), before);
  const row = events(c.state, 'CONTEST')[0]; assert.equal(row.playerId, c.state.contest.winnerId); assert.equal(row.kind, 'dice');
});

test('bad input: same player twice, unknown players, unknown contest', () => {
  const c = mkGame();
  assert.equal(CT.runContest(c.config, c.state, c.rng, 'coin', c.p.id, c.p.id).error, true);
  assert.equal(CT.runContest(c.config, c.state, c.rng, 'coin', c.p.id, 'ghost').error, true);
  assert.equal(CT.runContest(c.config, c.state, c.rng, 'arm-wrestle', c.p.id, c.q.id).error, true);
  assert.equal(c.state.contest, undefined);
});

test('twelve straight ties still produce a winner; clearing removes the stage', () => {
  const c = mkGame(); const r = CT.runContest(c.config, c.state, fixedRng([0.4]), 'card', c.p.id, c.q.id);          // every draw identical
  assert.equal(r.ties, 11); assert.ok([c.p.id, c.q.id].includes(r.winnerId));
  assert.equal(CT.clearContest(c.state), true); assert.equal(c.state.contest, null); assert.equal(CT.clearContest(c.state), false);
});
