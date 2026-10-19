import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, G, mkGame } from './_helpers.mjs';
const ST = await import('../../site/js/stats.js');

const play = (c, player, mult, amount = 100, gameId = 'fifty', cur = 'Gold') => {
  c.state.game = { id: gameId, playerId: player.id, wagers: [{ amount, cur }] };
  G.settle(c.config, c.state, player, mult);
};
const award = (stats, key) => stats.awards.find(a => a.key === key);

test('standings rank by Gold-equivalent value with net vs the starting bank', () => {
  const c = mkGame(['A', 'B', 'C']); const [a, b, d] = c.players;
  a.balances.Gold = 100; b.balances.Gems = 100;              // b = 500 + 500
  const s = ST.standings(c.config, c.state);
  assert.deepEqual(s.map(x => [x.name, x.value, x.net, x.rank]), [['B', 1000, 500, 1], ['C', 500, 0, 2], ['A', 100, -400, 3]]);
});

test('tied players share a rank and the next rank is skipped', () => {
  const c = mkGame(['A', 'B', 'C']); c.players[2].balances.Gold = 100;
  assert.deepEqual(ST.standings(c.config, c.state).map(x => x.rank), [1, 1, 3]);
});

test('rankMovement: positive = climbed, zero when there is no snapshot', () => {
  assert.deepEqual(ST.rankMovement({ a: 3, b: 1, c: 2 }, { a: 1, b: 2, c: 3 }), { a: 2, b: -1, c: -1 });
  assert.deepEqual(ST.rankMovement(null, { a: 1 }), { a: 0 });
  assert.deepEqual(ST.rankMovement({ a: 1 }, { a: 1, newcomer: 2 }), { a: 0, newcomer: 0 });
});

test('endTurn snapshots the ranks when a new round begins (only with config)', () => {
  const c = mkGame(['A', 'B']);
  E.endTurn(c.state, c.config); assert.equal(c.state.rankSnapshot, undefined);
  c.q.balances.Gold = 900;
  E.endTurn(c.state, c.config);
  assert.deepEqual(c.state.rankSnapshot, { p1: 1, p0: 2 });
  c.p.balances.Gold = 5000;
  assert.deepEqual(ST.rankMovement(c.state.rankSnapshot, ST.rankMap(c.config, c.state)), { p0: 1, p1: -1 });
});

test('game results: wins, losses, pushes, net and per-game table', () => {
  const c = mkGame();
  play(c, c.p, 2); play(c, c.p, 0); play(c, c.p, 1); play(c, c.p, 3, 200, 'bigwheel'); play(c, c.q, 0, 100, 'bigwheel');
  const st = ST.sessionStats(c.config, c.state); const a = st.players[c.p.id];
  assert.deepEqual([a.games, a.wins, a.losses, a.pushes, a.gameNet, a.biggestWager], [4, 2, 1, 1, 400, 200]);
  assert.equal(a.winRate, 0.5);
  const bw = st.games.find(g => g.id === 'bigwheel');
  assert.deepEqual([bw.plays, bw.wins, bw.losses, bw.net, bw.biggestMult], [2, 1, 1, 300, 3]);
  assert.equal(st.games[0].id, 'fifty');                              // most played first
  assert.equal(st.totals.games, 5);
});

test('game net values secondaries at GoldRate', () => {
  const c = mkGame(); c.p.balances.Gems = 50;
  play(c, c.p, 2, 10, 'fifty', 'Gems');                              // +10 Gems = 50g
  assert.equal(ST.sessionStats(c.config, c.state).players[c.p.id].gameNet, 50);
});

test('tile-resolution GAME rows (no result) are not counted as games', () => {
  const c = mkGame(); S.log(c.state, 'GAME', c.p.id, { tile: 5, action: 'minigame' });
  assert.equal(ST.sessionStats(c.config, c.state).players[c.p.id].games, 0);
});

test('jail, void, wheel, shop and battle counters', () => {
  const c = mkGame();
  E.sendToJail(c.config, c.state, c.p, 't'); E.spinJailWheel(c.config, c.state, c.rng, c.p); c.p.jailTier = 1; E.jailBuyout(c.config, c.state, c.p);
  S.log(c.state, 'VOID_TRIGGER', c.p.id, {}); E.spinGoodBad(c.config, c.state, c.rng, 'good', c.q);
  c.p.balances.Gold = 5000; G.buyPowerUp(c.config, c.state, c.p, 'nudge'); c.state.shopRates.Gems = 5; E.shopExchange(c.config, c.state, c.p, 'Gems', 1, 'buy');
  E.settleBattle(c.config, c.state, [{ playerId: c.p.id, cur: 'Gold', amount: 100 }, { playerId: c.q.id, cur: 'Gold', amount: 100 }], c.q.id);
  E.chaosShuffle(c.config, c.state, c.rng, 1); E.endTurn(c.state, c.config);
  const st = ST.sessionStats(c.config, c.state); const a = st.players[c.p.id], b = st.players[c.q.id];
  assert.deepEqual([a.jailed, a.jailSpins, a.buyouts, a.buyoutGold, a.voids, a.powerUpsBought, a.shopTrades], [1, 1, 1, 200, 1, 1, 1]);
  assert.deepEqual([a.battles, a.battlesWon, b.battles, b.battlesWon], [1, 0, 1, 1]);
  assert.deepEqual([st.totals.jailings, st.totals.voids, st.totals.chaos, st.totals.battles, st.totals.turns], [1, 1, 1, 1, 1]);
  assert.equal(st.totals.wheelSpins, 2);
});

test('Gold high and low water marks are rebuilt from the ledger', () => {
  const c = mkGame();
  S.credit(c.state, c.p, 'Gold', -900, 'x'); S.credit(c.state, c.p, 'Gold', 2000, 'x'); S.credit(c.state, c.p, 'Gold', -600, 'x');
  const a = ST.sessionStats(c.config, c.state).players[c.p.id];
  assert.deepEqual([a.lowestGold, a.highestGold, a.biggestWin, a.biggestLoss], [-400, 1600, 2000, -900]);
  const b = ST.sessionStats(c.config, c.state).players[c.q.id];
  assert.deepEqual([b.lowestGold, b.highestGold], [500, 500]);
});

test('awards go to the right players and unearned awards are left out', () => {
  const c = mkGame(['A', 'B', 'C']); const [a, b, d] = c.players;
  let st = ST.sessionStats(c.config, c.state);
  assert.deepEqual(st.awards.map(x => x.key), ['champion', 'spoon']);          // nothing happened yet
  play(c, a, 2, 400); play(c, a, 2); play(c, a, 2);                             // A: 3 wins, big wager
  E.sendToJail(c.config, c.state, b, 't'); E.releaseFromJail(c.config, c.state, b, 't'); E.sendToJail(c.config, c.state, b, 't');
  S.credit(c.state, d, 'Gold', -1200, 'disaster');
  st = ST.sessionStats(c.config, c.state);
  assert.equal(award(st, 'champion').name, 'A'); assert.equal(award(st, 'spoon').name, 'C');
  assert.equal(award(st, 'highroller').name, 'A'); assert.match(award(st, 'highroller').detail, /400g/);
  assert.equal(award(st, 'hothand').name, 'A'); assert.match(award(st, 'hothand').detail, /3 of 3/);
  assert.equal(award(st, 'jailbird').name, 'B'); assert.match(award(st, 'jailbird').detail, /2×/);
  assert.equal(award(st, 'ouch').name, 'C'); assert.equal(award(st, 'rockbottom').name, 'C'); assert.match(award(st, 'rockbottom').detail, /−700/);
  assert.equal(award(st, 'gladiator'), undefined); assert.equal(award(st, 'voidtourist'), undefined);
});

test('Hot Hand needs at least three games', () => {
  const c = mkGame(); play(c, c.p, 2); play(c, c.p, 2);
  assert.equal(award(ST.sessionStats(c.config, c.state), 'hothand'), undefined);
});

test('award ties go to the higher-ranked player', () => {
  const c = mkGame(['A', 'B']); c.q.balances.Gold = 900;
  E.sendToJail(c.config, c.state, c.p, 't'); E.sendToJail(c.config, c.state, c.q, 't');
  assert.equal(award(ST.sessionStats(c.config, c.state), 'jailbird').name, 'B');
});

test('a single-player table gets no Wooden Spoon', () => {
  const c = mkGame(['Solo']); assert.deepEqual(ST.sessionStats(c.config, c.state).awards.map(a => a.key), ['champion']);
});

test('sessionStats is pure: it does not touch the state', () => {
  const c = mkGame(); play(c, c.p, 2); const before = JSON.stringify(c.state);
  ST.sessionStats(c.config, c.state); ST.standings(c.config, c.state);
  assert.equal(JSON.stringify(c.state), before);
});

test('Hot Hand is only for a winning record (50%+)', () => {
  const c = mkGame(); play(c, c.p, 2); play(c, c.p, 0); play(c, c.p, 0); play(c, c.p, 0);
  assert.equal(award(ST.sessionStats(c.config, c.state), 'hothand'), undefined);
  play(c, c.p, 2); play(c, c.p, 2);
  assert.equal(award(ST.sessionStats(c.config, c.state), 'hothand').name, 'Aj');
});
