import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, gold, events } from './_helpers.mjs';
const BI = await import('../../site/js/buyin.js');

const row = (c, mech) => c.config.Wheel_BuyIn.find(r => BI.buyInMech(r) === mech);
const apply = (c, mech, opts = {}, player = c.p) => BI.applyBuyIn(c.config, c.state, player, row(c, mech), opts);

test('every default Buy-In Wheel row maps to a mechanic, by column or by label', () => {
  const c = mkGame();
  assert.deepEqual(c.config.Wheel_BuyIn.map(BI.buyInMech).sort(), ['auction', 'charity', 'double', 'flat', 'loan', 'sacrifice', 'tithe', 'work']);
  assert.deepEqual(['Flat Fee', 'Percentage Tithe', 'Loan Shark', 'Secondary Sacrifice', 'Mystery Box'].map(label => BI.buyInMech({ label })), ['flat', 'tithe', 'loan', 'sacrifice', null]);
});

test('flat fee: pay the agreed amount; a fee is required', () => {
  const c = mkGame(); assert.equal(apply(c, 'flat').error, true); assert.equal(apply(c, 'flat', { fee: -5 }).error, true);
  apply(c, 'flat', { fee: 300 }); assert.equal(gold(c.p), 200);
});

test('tithe: a percentage of current Gold, nothing from a player in debt', () => {
  const c = mkGame(); apply(c, 'tithe'); assert.equal(gold(c.p), 450);
  c.q.balances.Gold = -200; apply(c, 'tithe', {}, c.q); assert.equal(gold(c.q), -200);
});

test('charity: the richest other player pays', () => {
  const c = mkGame(['A', 'B', 'C']); c.players[2].balances.Gold = 2000;
  const r = apply(c, 'charity', { fee: 400 }); assert.equal(r.payerId, c.players[2].id);
  assert.deepEqual(c.players.map(gold), [500, 500, 1600]);
});

test('work release: skip a turn, no Gold moves', () => {
  const c = mkGame(); apply(c, 'work'); assert.equal(c.p.skipTurns, 1); assert.equal(gold(c.p), 500);
});

test('secondary sacrifice: the most valuable stack goes; with none the GM must pick another mechanic', () => {
  const c = mkGame(); assert.equal(apply(c, 'sacrifice').error, true);
  c.p.balances.Gems = 10; c.p.balances.Scrap = 100;                       // 50g vs 20g
  const r = apply(c, 'sacrifice'); assert.deepEqual(r.sacrificed, { cur: 'Gems', amount: 10, value: 50 });
  assert.deepEqual([c.p.balances.Gems, c.p.balances.Scrap, gold(c.p)], [0, 100, 500]);
});

test('double down: twice the fee now, next game win pays double', () => {
  const c = mkGame(); apply(c, 'double', { fee: 150 }); assert.equal(gold(c.p), 200); assert.deepEqual(c.p.winMult, { mult: 2 });
});

test('auction and loan hand off to their own panels without moving money', () => {
  const c = mkGame(); assert.equal(apply(c, 'auction').openAuction, true); assert.equal(apply(c, 'loan').openLoans, true); assert.equal(gold(c.p), 500);
});

test('an optional new stake is granted on top, and everything is ledgered', () => {
  const c = mkGame(); c.p.balances.Gold = -300;
  const r = apply(c, 'work', { grant: 500 }); assert.equal(gold(c.p), 200); assert.match(r.text, /New stake: \+500 Gold/);
  const rowLog = events(c.state, 'BUY_IN')[0]; assert.deepEqual([rowLog.mech, rowLog.grant, rowLog.fee], ['work', 500, 0]);
});

test('unknown mechanics are left to the GM', () => {
  const c = mkGame(); const r = BI.applyBuyIn(c.config, c.state, c.p, { label: 'Mystery Box' }, { fee: 100 });
  assert.equal(r.adjudicate, true); assert.equal(gold(c.p), 500);
});

test('the preview says exactly what applying would do', () => {
  const c = mkGame(['A', 'B']); c.q.balances.Gold = 900; c.p.balances.Keys = 3;
  const pv = (mech, fee) => BI.previewBuyIn(c.config, c.state, c.p, row(c, mech), fee);
  assert.equal(pv('flat', 250), 'A pays 250 Gold.'); assert.equal(pv('tithe'), 'A pays 50 Gold (10% of 500).');
  assert.equal(pv('charity', 250), 'B (richest) pays 250 Gold for A.'); assert.equal(pv('double', 100), 'A pays 200 Gold and their next game win pays 2×.');
  assert.match(pv('sacrifice'), /3 Keys \(worth ~30 Gold\)/); assert.match(pv('work'), /skips their next turn/);
  assert.equal(c.p.balances.Gold, 500);                                     // previews never change anything
});

test('needsFee marks the mechanics the GM must price', () => {
  assert.deepEqual(['flat', 'tithe', 'charity', 'work', 'sacrifice', 'double', 'auction', 'loan'].filter(BI.needsFee), ['flat', 'charity', 'double']);
});
