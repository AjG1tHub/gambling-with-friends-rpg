import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, mkGame, fixedRng, gold } from './_helpers.mjs';

const start = (c, id, rng = c.rng) => G.startGame(c.config, c.state, rng, id, c.p, [{ amount: 100, cur: 'Gold' }]);
const act = (c, action, payload, rng = c.rng) => G.gameAction(c.config, c.state, rng, action, payload);

test('starting a game never moves money — only settle does', () => {
  const c = mkGame();
  for (const g of c.config.Games.filter(x => x.built)) { start(c, g.id); assert.equal(gold(c.p), 500, g.id); }
});

test('50/50: win pays 1:1, loss returns 0, and the wheel is staged for the player view', () => {
  const c = mkGame(); start(c, 'fifty');
  act(c, 'spin', {}, fixedRng([0.49])); assert.deepEqual(c.state.game.pending, { mult: 2, label: 'WIN' });
  assert.equal(c.state.lastSpin.wheel, '50 / 50');
  act(c, 'spin', {}, fixedRng([0.5])); assert.deepEqual(c.state.game.pending, { mult: 0, label: 'LOSE' });
});

test('50/50 respects live odds overrides', () => {
  const c = mkGame(); c.state.oddsOverrides = { fifty: { winChance: 0.9, payout: 3 } }; start(c, 'fifty');
  act(c, 'spin', {}, fixedRng([0.85])); assert.equal(c.state.game.pending.mult, 4);
});

test('Big Wheel pays the segment it lands on (mult = total return, so 1× is a push)', () => {
  const c = mkGame(); start(c, 'bigwheel');
  act(c, 'spin', {}, fixedRng([0])); assert.equal(c.state.game.pending.mult, 1);
  act(c, 'spin', {}, fixedRng([0.9999])); assert.deepEqual(c.state.game.pending, { mult: 0, label: 'LOSE' });
  const segs = c.config.Games.find(g => g.id === 'bigwheel').odds.segments;
  for (const s of segs) assert.ok(Number(s.weight) > 0 && Number(s.mult) >= 0, s.label);
  // NOTE: with the default segments this wheel returns ~192% of stake on average — heavily
  // player-favourable. It is a Sheet tunable, so it is reported by test/balance.mjs, not "fixed" here.
});

test('roulette: colors, parity, ranges, dozens, columns, straight — and zero beats everything but straight 0', () => {
  const w = (type, n, number) => G.rouletteWins({ type, number }, n);
  assert.equal(G.rouletteColor(0), 'green'); assert.equal(G.rouletteColor(1), 'red'); assert.equal(G.rouletteColor(2), 'black'); assert.equal(G.rouletteColor(36), 'red');
  let reds = 0; for (let n = 1; n <= 36; n++) if (G.rouletteColor(n) === 'red') reds++; assert.equal(reds, 18);
  assert.ok(w('red', 3) && !w('red', 4) && w('black', 4));
  assert.ok(w('odd', 7) && w('even', 8) && w('low', 18) && !w('low', 19) && w('high', 19));
  assert.ok(w('dozen1', 12) && w('dozen2', 13) && w('dozen3', 36) && !w('dozen3', 24));
  assert.ok(w('col1', 34) && w('col2', 35) && w('col3', 36));
  assert.ok(w('straight', 17, 17) && !w('straight', 16, 17));
  for (const t of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'col3']) assert.equal(w(t, 0), false, t);
  assert.ok(w('straight', 0, 0));
});

test('roulette payouts: 35:1 straight, 2:1 dozens and columns, 1:1 the rest', () => {
  const odds = { straight: 35, dozen: 2, even: 1 };
  assert.equal(G.roulettePayout(odds, 'straight'), 35); assert.equal(G.roulettePayout(odds, 'dozen2'), 2);
  assert.equal(G.roulettePayout(odds, 'col1'), 2); assert.equal(G.roulettePayout(odds, 'red'), 1);
});

test('roulette needs a bet before it spins; a straight hit pays 36× total', () => {
  const c = mkGame(); start(c, 'roulette');
  assert.match(act(c, 'spin').text, /Nothing to do/);
  act(c, 'bet', { type: 'straight', number: 17 });
  act(c, 'spin', {}, fixedRng([17.5 / 37]));
  assert.equal(c.state.game.view.pocket, 17); assert.equal(c.state.game.pending.mult, 36);
  act(c, 'spin', {}, fixedRng([0])); assert.equal(c.state.game.pending.mult, 0);
});

test('crash point follows (1 − edge)/(1 − u), capped between 1× and maxMult', () => {
  const c = mkGame();
  start(c, 'crash', fixedRng([0.5])); assert.equal(c.state.game.secret.crashAt, 1.92);
  start(c, 'crash', fixedRng([0])); assert.equal(c.state.game.secret.crashAt, 1);
  start(c, 'crash', fixedRng([0.9999])); assert.equal(c.state.game.secret.crashAt, 50);
});

test('crash: cashing out before the crash pays the live multiple; after it pays nothing', () => {
  const c = mkGame(); start(c, 'crash', fixedRng([0.9]));               // crashes at 9.6×
  act(c, 'launch'); const g = c.state.game;
  g.startedTs = Date.now() - 5000;                                       // e^(0.5) ≈ 1.64×
  const r = act(c, 'cashout'); assert.equal(r.done, true); assert.ok(r.mult >= 1.64 && r.mult < 1.7, `mult ${r.mult}`);
  start(c, 'crash', fixedRng([0.1])); act(c, 'launch'); c.state.game.startedTs = Date.now() - 20000;
  assert.equal(act(c, 'cashout').mult, 0); assert.equal(c.state.game.view.crashed, true);
});

test('crash multiplier grows with time and stops at the cap', () => {
  const g = { startedTs: 0, view: { growthPerSec: 0.1, maxMult: 50 }, secret: { crashAt: 10 } };
  assert.equal(G.crashMult(g, 0), 1); assert.equal(G.crashMult(g, 10000), 2.71);
  assert.equal(G.crashMult(g, 1e6), 50);
  assert.equal(G.crashHasCrashed(g, 10000), false); assert.equal(G.crashHasCrashed(g, 24000), true);
});

test('mines: the multiplier is the fair odds less the house edge', () => {
  const odds = { grid: 25, mines: 3, houseEdge: 0.03 };
  assert.equal(G.minesMult(odds, 0), 0.97); assert.equal(G.minesMult(odds, 1), 1.1);       // 25/22 × 0.97
  assert.equal(G.minesMult(odds, 2), 1.25);                                               // 25/22 × 24/21 × 0.97 = 1.2597, floored
  assert.ok(G.minesMult(odds, 22) > 2000);
});

test('mines: placing, revealing safely, stopping, and hitting a mine', () => {
  const c = mkGame(); start(c, 'mines'); const g = c.state.game;
  assert.equal(new Set(g.secret.mines).size, 3);
  const safe = [...Array(25).keys()].filter(i => !g.secret.mines.includes(i));
  act(c, 'reveal', { idx: safe[0] }); act(c, 'reveal', { idx: safe[1] });
  assert.equal(g.view.mult, 1.25);
  assert.match(act(c, 'reveal', { idx: safe[1] }).text, /Nothing to do/);                    // already open
  const r = act(c, 'stop'); assert.deepEqual([r.done, r.mult], [true, 1.25]);
  start(c, 'mines'); const g2 = c.state.game;
  const boom = act(c, 'reveal', { idx: g2.secret.mines[0] });
  assert.deepEqual([boom.done, boom.mult, g2.view.hit], [true, 0, g2.secret.mines[0]]);
});

test('mines: stopping before any reveal is a push; clearing the field ends the game', () => {
  const c = mkGame(); start(c, 'mines');
  assert.equal(act(c, 'stop').mult, 1);
  start(c, 'mines'); const g = c.state.game;
  const safe = [...Array(25).keys()].filter(i => !g.secret.mines.includes(i));
  let r; for (const i of safe) r = act(c, 'reveal', { idx: i });
  assert.equal(r.done, true); assert.equal(g.phase, 'done'); assert.ok(r.mult > 2000);
});

test('GM Call placeholder: won pays 1:1, lost takes the stake', () => {
  const c = mkGame(); start(c, 'placeholder');
  act(c, 'won'); assert.equal(c.state.game.pending.mult, 2);
  act(c, 'lost'); assert.equal(c.state.game.pending.mult, 0);
});

test('actions with no game running are harmless', () => {
  const c = mkGame(); assert.match(act(c, 'spin').text, /No game running/);
});
