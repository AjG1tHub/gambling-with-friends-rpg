import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, mkGame, gold, events } from './_helpers.mjs';

const stake = (c, wagers = [{ amount: 100, cur: 'Gold' }], id = 'fifty') => { c.state.game = { id, playerId: c.p.id, wagers }; };
const pu = (c, id) => c.p.heldPowerUps.push({ id, name: id });

test('settle: mult 2 pays 1:1, mult 0 takes the stake, mult 1 pushes', () => {
  const c = mkGame();
  stake(c); assert.equal(G.settle(c.config, c.state, c.p, 2).won, true); assert.equal(gold(c.p), 600);
  stake(c); assert.equal(G.settle(c.config, c.state, c.p, 0).lost, true); assert.equal(gold(c.p), 500);
  stake(c); const r = G.settle(c.config, c.state, c.p, 1); assert.equal(r.won || r.lost, false); assert.equal(gold(c.p), 500);
  assert.equal(c.state.game, null);
});

test('settle: fractional and negative multiples (Plinko 0.3×, doubled blackjack −1×)', () => {
  const c = mkGame();
  stake(c); G.settle(c.config, c.state, c.p, 0.3); assert.equal(gold(c.p), 430);
  stake(c); G.settle(c.config, c.state, c.p, -1); assert.equal(gold(c.p), 230);
  stake(c); G.settle(c.config, c.state, c.p, 2.5); assert.equal(gold(c.p), 380);
});

test('settle: every currency in a multi-currency bet multiplies independently', () => {
  const c = mkGame(); c.p.balances.Gems = 10;
  stake(c, [{ amount: 100, cur: 'Gold' }, { amount: 4, cur: 'Gems' }]);
  G.settle(c.config, c.state, c.p, 3);
  assert.equal(gold(c.p), 700); assert.equal(c.p.balances.Gems, 18);
  stake(c, [{ amount: 100, cur: 'Gold' }, { amount: 4, cur: 'Gems' }]);
  G.settle(c.config, c.state, c.p, 0);
  assert.equal(gold(c.p), 600); assert.equal(c.p.balances.Gems, 14);
});

test('settle: win buff multiplies profit once and is consumed; a loss leaves it in place', () => {
  const c = mkGame(); c.p.winMult = { mult: 2 };
  stake(c); G.settle(c.config, c.state, c.p, 0); assert.deepEqual(c.p.winMult, { mult: 2 });
  stake(c); G.settle(c.config, c.state, c.p, 2); assert.equal(gold(c.p), 600); assert.equal(c.p.winMult, null);
  c.p.winMult = { mult: 0.5 }; stake(c); G.settle(c.config, c.state, c.p, 2); assert.equal(gold(c.p), 650);
});

test('settle: High Roller doubles gains AND losses and is always consumed', () => {
  const c = mkGame(); pu(c, 'highroller');
  stake(c); G.settle(c.config, c.state, c.p, 2); assert.equal(gold(c.p), 700); assert.equal(c.p.heldPowerUps.length, 0);
  pu(c, 'highroller'); stake(c); G.settle(c.config, c.state, c.p, 0); assert.equal(gold(c.p), 500);
});

test('settle: Floor protects staked secondaries on a loss (Gold still lost) and is kept on a win', () => {
  const c = mkGame(); c.p.balances.Gems = 10; pu(c, 'floor');
  stake(c, [{ amount: 100, cur: 'Gold' }, { amount: 4, cur: 'Gems' }]);
  G.settle(c.config, c.state, c.p, 2); assert.equal(c.p.heldPowerUps.length, 1);
  stake(c, [{ amount: 100, cur: 'Gold' }, { amount: 4, cur: 'Gems' }]);
  G.settle(c.config, c.state, c.p, 0);
  assert.equal(c.p.balances.Gems, 14); assert.equal(gold(c.p), 500); assert.equal(c.p.heldPowerUps.length, 0);
});

test('settle: Social Barter pays the creditor 25% of the next 3 wins, then stops', () => {
  const c = mkGame(); c.p.debuffs.push({ tag: 'owed', winsLeft: 3, payeeId: c.q.id, cut: 0.25 });
  for (let i = 0; i < 3; i++) { stake(c); G.settle(c.config, c.state, c.p, 2); }
  assert.equal(gold(c.p), 725); assert.equal(gold(c.q), 575); assert.equal(c.p.debuffs.length, 0);
  stake(c); G.settle(c.config, c.state, c.p, 2); assert.equal(gold(c.q), 575);
});

test('settle: a loss does not burn a Social Barter win', () => {
  const c = mkGame(); c.p.debuffs.push({ tag: 'owed', winsLeft: 3, payeeId: c.q.id, cut: 0.25 });
  stake(c); G.settle(c.config, c.state, c.p, 0);
  assert.equal(c.p.debuffs[0].winsLeft, 3);
});

test('HouseEdgeMultiplier scales profits; the live override beats the config', () => {
  const c = mkGame(['A', 'B'], 1, (cfg) => { cfg.Config.HouseEdgeMultiplier = 0.5; });
  stake(c); G.settle(c.config, c.state, c.p, 2); assert.equal(gold(c.p), 550);
  c.state.oddsOverrides = { HouseEdgeMultiplier: 2 };
  stake(c); G.settle(c.config, c.state, c.p, 2); assert.equal(gold(c.p), 750);
});

test('settle logs one GAME row with the outcome', () => {
  const c = mkGame(); stake(c, undefined, 'roulette');
  G.settle(c.config, c.state, c.p, 2, { label: '17 black' });
  const row = events(c.state, 'GAME').at(-1);
  assert.deepEqual([row.gameId, row.mult, row.won, row.label], ['roulette', 2, true, '17 black']);
});

test('power-ups: buying checks price, stock limit and unknown ids', () => {
  const c = mkGame();
  assert.equal(G.buyPowerUp(c.config, c.state, c.p, 'nope').error, true);
  G.buyPowerUp(c.config, c.state, c.p, 'reroll'); assert.equal(gold(c.p), 200);
  assert.equal(G.buyPowerUp(c.config, c.state, c.p, 'reroll').error, true);      // can't afford the second
  c.p.balances.Gold = 5000;
  G.buyPowerUp(c.config, c.state, c.p, 'reroll');
  assert.match(G.buyPowerUp(c.config, c.state, c.p, 'reroll').text, /max 2/);
  G.buyPowerUp(c.config, c.state, c.p, 'fork');
  assert.match(G.buyPowerUp(c.config, c.state, c.p, 'fork').text, /max 1/);
  assert.equal(events(c.state, 'SHOP_BUY_POWERUP').length, 3);
});

test('power-ups: take removes exactly one and logs it', () => {
  const c = mkGame(); pu(c, 'reroll'); pu(c, 'reroll');
  assert.ok(G.hasPowerUp(c.p, 'reroll')); G.takePowerUp(c.state, c.p, 'reroll');
  assert.equal(c.p.heldPowerUps.length, 1); assert.equal(G.takePowerUp(c.state, c.p, 'fork'), null);
});

test('Nudge adds 50% weight to the named outcome only', () => {
  const rows = [{ label: 'A', weight: 10 }, { label: 'B', weight: 10 }];
  const { fixedRng } = { fixedRng: (v) => ({ next: () => v }) };
  assert.equal(G.pickWeighted(fixedRng(0.55), rows), 1);            // 11/20 → B without Nudge
  assert.equal(G.pickWeighted(fixedRng(0.55), rows, 'A'), 0);       // A now 15/25 = 0.6
  assert.equal(rows[0].weight, 10);                                  // input untouched
});

test('effectiveOdds layers built-in defaults < config < live overrides', () => {
  const c = mkGame(); c.config.Games.find(g => g.id === 'blackjack').odds = {};
  assert.equal(G.effectiveOdds(c.config, c.state, 'blackjack').blackjackPays, 1.5);
  c.config.Games.find(g => g.id === 'blackjack').odds = { blackjackPays: 1.2 };
  assert.equal(G.effectiveOdds(c.config, c.state, 'blackjack').blackjackPays, 1.2);
  c.state.oddsOverrides = { blackjack: { blackjackPays: 2 } };
  assert.equal(G.effectiveOdds(c.config, c.state, 'blackjack').blackjackPays, 2);
  assert.equal(G.effectiveOdds(c.config, c.state, 'blackjack').decks, 6);
});
