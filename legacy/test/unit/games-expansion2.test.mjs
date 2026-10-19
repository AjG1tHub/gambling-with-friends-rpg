import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, mkGame, fixedRng } from './_helpers.mjs';
const SND = await import('../../site/js/sound.js');

const act = (c, action, payload, rng = c.rng) => G.gameAction(c.config, c.state, rng, action, payload);
const start = (c, id, rng = c.rng) => G.startGame(c.config, c.state, rng, id, c.p, [{ amount: 100, cur: 'Gold' }]);
const SY = G.SLOTS_DEFAULT_SYMBOLS, idx = (id) => SY.findIndex(s => s.id === id);
// script three reel stops by symbol id
const reels = (...ids) => fixedRng(ids.map(id => { const before = SY.slice(0, idx(id)).reduce((s, x) => s + x.weight, 0); return (before + 0.5) / 100; }));

test('slots paytable: three of a kind beats a pair; pairs only pay for symbols that have a pair prize', () => {
  const pay = (...ids) => G.slotsPay(SY, ids.map(idx));
  assert.deepEqual([pay('seven', 'seven', 'seven').mult, pay('seven', 'seven', 'seven').kind], [500, 'three']);
  assert.equal(pay('lemon', 'lemon', 'lemon').mult, 6);
  assert.deepEqual([pay('cherry', 'cherry', 'bell').mult, pay('cherry', 'bell', 'cherry').mult, pay('bell', 'cherry', 'cherry').mult], [2, 2, 2]);   // any two reels
  assert.equal(pay('seven', 'bell', 'seven').mult, 5); assert.equal(pay('diamond', 'diamond', 'lemon').mult, 3);
  assert.deepEqual([pay('lemon', 'lemon', 'bell').mult, pay('lemon', 'lemon', 'bell').kind], [0, 'none']);                                     // lemons have no pair prize
  assert.equal(pay('cherry', 'lemon', 'bell').mult, 0);
});

test('slots default strip returns 93–96% — computed exactly', () => {
  const rtp = G.slotsRtp(SY); assert.ok(rtp > 0.93 && rtp < 0.96, `slots RTP ${rtp}`);
  assert.equal(SY.reduce((s, x) => s + x.weight, 0), 100);
});

test('slotsRtp matches a brute-force walk over every reel combination', () => {
  let ev = 0;
  for (let a = 0; a < SY.length; a++) for (let b = 0; b < SY.length; b++) for (let c = 0; c < SY.length; c++)
    ev += SY[a].weight * SY[b].weight * SY[c].weight / 1e6 * G.slotsPay(SY, [a, b, c]).mult;
  assert.ok(Math.abs(ev - G.slotsRtp(SY)) < 1e-9);
});

test('slots: a spin stops three reels, sets the result and the reveal time', () => {
  const c = mkGame(); start(c, 'slots'); assert.equal(c.state.game.view.reels, null);
  act(c, 'spin', {}, reels('seven', 'seven', 'seven')); const g = c.state.game;
  assert.deepEqual(g.view.reels, [idx('seven'), idx('seven'), idx('seven')]); assert.equal(g.pending.mult, 500); assert.equal(g.view.win, 'three');
  assert.ok(g.view.revealAt > g.view.spinAt + G.SLOTS_REEL_MS[2]);
  act(c, 'spin', {}, reels('cherry', 'lemon', 'bell')); assert.equal(c.state.game.pending.mult, 0); assert.match(c.state.game.pending.label, /no line/);
});

test('slots: simulated return matches the exact figure', () => {
  const c = mkGame(); start(c, 'slots'); let ret = 0; const N = 60000;
  for (let i = 0; i < N; i++) { act(c, 'spin', {}); ret += c.state.game.pending.mult; }
  assert.ok(Math.abs(ret / N - G.slotsRtp(SY)) < 0.06, `simulated ${ret / N}`);
});

test('slots falls back to the default strip when the config row is empty or broken', () => {
  assert.equal(G.slotsSymbols({}).length, 6); assert.equal(G.slotsSymbols({ symbols: [{ id: 'x', weight: 0 }] }).length, 6);
  const custom = [{ id: 'a', icon: 'A', weight: 1, three: 2 }, { id: 'b', icon: 'B', weight: 1, three: 2 }];
  assert.equal(G.slotsSymbols({ symbols: custom }).length, 2); assert.equal(G.slotsRtp(custom), 0.5);
});

test('keno rules: defaults, and maxPicks never exceeds the paytable', () => {
  const R = G.kenoRules({}); assert.deepEqual([R.numbers, R.drawn, R.maxPicks], [40, 10, 10]);
  assert.equal(G.kenoRules({ maxPicks: 15 }).maxPicks, 10);
  assert.equal(G.kenoRules({ maxPicks: 4, pays: { 1: { 1: 3 }, 2: { 2: 9 } } }).maxPicks, 2);
});

test('keno hit chances are a proper distribution', () => {
  const R = G.kenoRules({});
  for (let k = 1; k <= 10; k++) { let sum = 0; for (let h = 0; h <= k; h++) sum += G.kenoHitChance(R, k, h); assert.ok(Math.abs(sum - 1) < 1e-9, `picks ${k}`); }
  assert.equal(G.kenoHitChance(R, 1, 1), 0.25); assert.ok(Math.abs(G.kenoHitChance(R, 2, 2) - 45 / 780) < 1e-12);
});

test('keno: every pick count returns between 92% and 97%', () => {
  const R = G.kenoRules({});
  for (let k = 1; k <= 10; k++) { const rtp = G.kenoRtp(R, k); assert.ok(rtp > 0.92 && rtp < 0.97, `picks ${k}: ${rtp}`); }
});

test('keno picking: toggle, limit, range, quick pick, clear', () => {
  const c = mkGame(); start(c, 'keno'); const v = c.state.game.view;
  act(c, 'pick', { n: 7 }); act(c, 'pick', { n: 3 }); assert.deepEqual(c.state.game.view.picks, [3, 7]);
  act(c, 'pick', { n: 7 }); assert.deepEqual(c.state.game.view.picks, [3]);
  assert.equal(act(c, 'pick', { n: 0 }).error, true); assert.equal(act(c, 'pick', { n: 41 }).error, true);
  for (let n = 10; n < 19; n++) act(c, 'pick', { n });
  assert.equal(c.state.game.view.picks.length, 10); assert.equal(act(c, 'pick', { n: 30 }).error, true);
  act(c, 'clear'); assert.deepEqual(c.state.game.view.picks, []);
  act(c, 'quick', { count: 5 }); const q = c.state.game.view.picks;
  assert.equal(q.length, 5); assert.equal(new Set(q).size, 5); assert.ok(q.every(n => n >= 1 && n <= 40)); assert.deepEqual(q, q.slice().sort((a, b) => a - b));
  act(c, 'quick', { count: 99 }); assert.equal(c.state.game.view.picks.length, 10);
});

test('keno will not draw with no picks, draws 10 distinct numbers, and locks the ticket afterwards', () => {
  const c = mkGame(); start(c, 'keno');
  assert.equal(act(c, 'spin').error, true);
  act(c, 'quick', { count: 4 }); const picks = c.state.game.view.picks.slice();
  act(c, 'spin'); const g = c.state.game;
  assert.equal(g.view.draw.length, 10); assert.equal(new Set(g.view.draw).size, 10);
  const hits = picks.filter(n => g.view.draw.includes(n)).length;
  assert.equal(g.view.hits, hits); assert.equal(g.pending.mult, G.kenoPay(G.kenoRules({}), 4, hits));
  assert.match(act(c, 'pick', { n: 1 }).text, /Nothing to do/); assert.deepEqual(c.state.game.view.picks, picks);
});

test('keno: simulated 5-pick return matches the exact figure', () => {
  const c = mkGame(); let ret = 0; const N = 40000; const R = G.kenoRules({});
  start(c, 'keno'); act(c, 'quick', { count: 5 });
  for (let i = 0; i < N; i++) { act(c, 'spin'); ret += c.state.game.pending.mult; }
  assert.ok(Math.abs(ret / N - G.kenoRtp(R, 5)) < 0.12, `simulated ${ret / N} vs ${G.kenoRtp(R, 5)}`);
});

test('keno pays 3× for a ten-pick with zero hits (the consolation line)', () => {
  assert.equal(G.kenoPay(G.kenoRules({}), 10, 0), 3); assert.equal(G.kenoPay(G.kenoRules({}), 10, 1), 0); assert.equal(G.kenoPay(G.kenoRules({}), 3, 1), 0);
});

test('sound: reels click as they stop; keno balls tick, hits chime', () => {
  const c = mkGame(); start(c, 'slots'); let prev = structuredClone(c.state); act(c, 'spin', {});
  assert.equal(SND.cuesFor(prev, c.state).filter(x => x.cue === 'card').length, 3);
  start(c, 'keno'); act(c, 'quick', { count: 5 }); prev = structuredClone(c.state); act(c, 'spin');
  const cues = SND.cuesFor(prev, c.state);
  assert.equal(cues.filter(x => x.cue === 'gem' || x.cue === 'peg').length, 10); assert.equal(cues.filter(x => x.cue === 'gem').length, c.state.game.view.hits);
});

test('all twelve classic games start cleanly, every built game is listed for the board, and no two share an icon', () => {
  const c = mkGame(); const built = c.config.Games.filter(g => g.built && !g.hidden).map(g => g.id);
  const classics = ['fifty', 'bigwheel', 'roulette', 'crash', 'mines', 'blackjack', 'baccarat', 'plinko', 'hilo', 'dice', 'slots', 'keno'];
  assert.deepEqual(built.slice(0, 12), classics); assert.equal(built.length, 36);
  for (const id of built) { start(c, id); assert.equal(c.state.game.id, id); assert.equal(c.state.game.playerId, c.p.id); }
  assert.equal(new Set(c.config.Games.map(g => g.icon)).size, c.config.Games.length, 'every game should have its own icon');
});
