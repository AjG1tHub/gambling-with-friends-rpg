import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, S, mkGame, fixedRng, gold, events } from './_helpers.mjs';

test('credit: Gold can go negative, secondaries floor at zero, every move is ledgered', () => {
  const c = mkGame();
  S.credit(c.state, c.p, 'Gold', -700, 'x'); assert.equal(gold(c.p), -200);
  S.credit(c.state, c.p, 'Gems', -3, 'x'); assert.equal(c.p.balances.Gems, 0);
  S.credit(c.state, c.p, 'Gems', 4, 'x'); assert.equal(S.bal(c.p, 'Gems'), 4);
  assert.deepEqual(c.state.ledger.slice(-3).map(r => r.type), ['DEBIT', 'DEBIT', 'CREDIT']);
});

test('goldValue converts secondaries at GoldRate; richest / poorest rank by it', () => {
  const c = mkGame(['A', 'B', 'C']); const [a, b, d] = c.players;
  a.balances.Crowns = 10;                                   // 500 + 10×50
  assert.equal(S.goldValue(c.config, a), 1000);
  d.balances.Gold = 50;
  assert.equal(S.richest(c.config, c.state).id, a.id);
  assert.equal(S.poorest(c.config, c.state).id, d.id);
  assert.equal(S.richest(c.config, c.state, a.id).id, b.id);
});

test('the ledger never lets event data overwrite the event type, and caps at LEDGER_MAX rows', () => {
  const c = mkGame();
  const row = S.log(c.state, 'GAME', c.p.id, { type: 'sneaky', playerId: 'nope' });
  assert.equal(row.type, 'GAME'); assert.equal(row.playerId, c.p.id);
  for (let i = 0; i < S.LEDGER_MAX + 100; i++) S.log(c.state, 'NOTE', null, { i });
  assert.equal(c.state.ledger.length, S.LEDGER_MAX);
});

test('saveState / loadState round-trip through storage and broadcast to the other window', async () => {
  const { sentMessages } = await import('./_helpers.mjs');
  const c = mkGame(); c.state.banner = 'hello';
  S.saveState(c.state);
  assert.equal(S.loadState().banner, 'hello');
  assert.equal(sentMessages.at(-1).type, 'state');
  S.clearState(); assert.equal(S.loadState(), null); assert.equal(sentMessages.at(-1).type, 'reset');
});

test('shop offers N currencies with session rates inside the displayed bounds, cached per session', () => {
  const c = mkGame();
  const first = E.shopOffers(c.config, c.state, c.rng);
  assert.equal(first.offers.length, c.config.ShopConfig.currenciesPerVisit);
  for (const o of first.offers) {
    assert.ok(o.sessionRate >= o.goldRate * 0.5 - 0.01 && o.sessionRate <= o.goldRate * 2 + 0.01, `${o.name} ${o.sessionRate}`);
    assert.notEqual(o.name, 'Gold');
  }
  const snapshot = { ...c.state.shopRates };
  for (let i = 0; i < 30; i++) E.shopOffers(c.config, c.state, c.rng);
  for (const [name, rate] of Object.entries(snapshot)) assert.equal(c.state.shopRates[name], rate, `${name} re-rolled`);
});

test('shop exchange is bidirectional at the session rate with no house cut', () => {
  const c = mkGame(); c.state.shopRates.Gems = 6;
  E.shopExchange(c.config, c.state, c.p, 'Gems', 10, 'buy');
  assert.equal(gold(c.p), 440); assert.equal(c.p.balances.Gems, 10);
  E.shopExchange(c.config, c.state, c.p, 'Gems', 10, 'sell');
  assert.equal(gold(c.p), 500); assert.equal(c.p.balances.Gems, 0);
  assert.equal(events(c.state, 'SHOP_EXCHANGE').length, 2);
});

test('shop refuses currencies not on offer and selling more than is held', () => {
  const c = mkGame(); c.state.shopRates.Gems = 6;
  assert.equal(E.shopExchange(c.config, c.state, c.p, 'Orbs', 1, 'buy').error, true);
  assert.equal(E.shopExchange(c.config, c.state, c.p, 'Gems', 1, 'sell').error, true);
  assert.equal(gold(c.p), 500);
});

test('transfer validates players, amount and holdings', () => {
  const c = mkGame();
  assert.equal(E.transfer(c.config, c.state, c.p, c.p, 'Gold', 10).error, true);
  assert.equal(E.transfer(c.config, c.state, c.p, c.q, 'Gold', 0).error, true);
  assert.equal(E.transfer(c.config, c.state, c.p, c.q, 'Gems', 5).error, true);
  E.transfer(c.config, c.state, c.p, c.q, 'Gold', 800);
  assert.equal(gold(c.p), -300); assert.equal(gold(c.q), 1300);
});

test('battle: winner takes both stakes, unequal and multi-currency', () => {
  const c = mkGame(); c.q.balances.Gems = 50;
  const wagers = [{ playerId: c.p.id, cur: 'Gold', amount: 300 }, { playerId: c.q.id, cur: 'Gems', amount: 40 }];
  const r = E.settleBattle(c.config, c.state, wagers, c.p.id);
  assert.equal(r.error, undefined);
  assert.equal(gold(c.p), 500); assert.equal(c.p.balances.Gems, 40); assert.equal(c.q.balances.Gems, 10);
});

test('battle: a refusal forfeits the refuser\'s stake to the other side', () => {
  const c = mkGame();
  const wagers = [{ playerId: c.p.id, cur: 'Gold', amount: 100 }, { playerId: c.q.id, cur: 'Gold', amount: 250 }];
  E.settleBattle(c.config, c.state, wagers, c.p.id, { forfeitId: c.q.id });
  assert.equal(gold(c.p), 750); assert.equal(gold(c.q), 250);
  assert.equal(events(c.state, 'BATTLE').at(-1).forfeitBy, c.q.id);
});

test('battle floor: wagers under the table minimum (Gold-equivalent) are rejected and nothing moves', () => {
  const c = mkGame(); c.q.balances.Bananas = 500;                // 0.1g each
  const low = [{ playerId: c.p.id, cur: 'Gold', amount: 99 }, { playerId: c.q.id, cur: 'Gold', amount: 100 }];
  assert.equal(E.settleBattle(c.config, c.state, low, c.p.id).error, true);
  const cheap = [{ playerId: c.p.id, cur: 'Gold', amount: 100 }, { playerId: c.q.id, cur: 'Bananas', amount: 500 }];   // 50g
  assert.equal(E.settleBattle(c.config, c.state, cheap, c.p.id).error, true);
  assert.equal(gold(c.p), 500); assert.equal(c.q.balances.Bananas, 500);
  const ok = [{ playerId: c.p.id, cur: 'Gold', amount: 100 }, { playerId: c.q.id, cur: 'Gems', amount: 20 }];
  c.q.balances.Gems = 20;
  assert.equal(E.settleBattle(c.config, c.state, ok, c.q.id).error, undefined);
});

test('battle: a player cannot wager secondaries they do not hold', () => {
  const c = mkGame();
  const w = [{ playerId: c.p.id, cur: 'Gold', amount: 100 }, { playerId: c.q.id, cur: 'Crowns', amount: 5 }];
  assert.equal(E.settleBattle(c.config, c.state, w, c.p.id).error, true);
  assert.equal(c.p.balances.Crowns, undefined);
});

test('battle wheel: Name 10 also spins a category', () => {
  const c = mkGame(); const rows = c.config.Wheel_Battle;
  const i = rows.findIndex(r => r.spinCategory); const total = rows.reduce((s, r) => s + r.weight, 0);
  const before = rows.slice(0, i).reduce((s, r) => s + r.weight, 0);
  const r = E.spinBattleWheel(c.config, c.state, fixedRng([(before + 0.5) / total, 0]), c.p.id, c.q.id);
  assert.equal(r.contest.spinCategory, true); assert.equal(r.category, c.config.Wheel_Category[0].label);
  assert.equal(E.spinBattleWheel(c.config, c.state, fixedRng([0]), c.p.id, c.q.id).category, null);
});

test('auction lot: currency goes to the buyer, Gold to the seller', () => {
  const c = mkGame(); c.p.balances.Keys = 4;
  E.settleAuctionLot(c.config, c.state, c.p.id, c.q.id, 'Keys', 3, 250);
  assert.equal(c.p.balances.Keys, 1); assert.equal(c.q.balances.Keys, 3);
  assert.equal(gold(c.p), 750); assert.equal(gold(c.q), 250);
});

test('buy-in wheel returns one of the configured mechanisms', () => {
  const c = mkGame();
  const o = E.spinBuyInWheel(c.config, c.state, fixedRng([0]), c.p);
  assert.equal(o.label, 'Flat Fee'); assert.equal(c.state.lastSpin.wheel, 'BUY-IN WHEEL');
});
