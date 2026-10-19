import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, gold, events } from './_helpers.mjs';
const AU = await import('../../site/js/auction.js');

function table() { const c = mkGame(['Aj', 'Nick', 'Sam']); c.p.balances.Gems = 20; c.p.balances.Keys = 5; c.p.balances.Scrap = 50; return c; }      // 100g, 50g, 10g
const start = (c, opts) => AU.startAuction(c.config, c.state, c.p.id, opts);
const bid = (c, player, amt) => AU.placeBid(c.config, c.state, player.id, amt);
const call = (c) => AU.callLot(c.config, c.state);

test('per-currency lots, most valuable first, each with a reference value and opening bid', () => {
  const c = table(); const r = start(c); assert.equal(r.error, undefined);
  const lots = c.state.auction.lots;
  assert.deepEqual(lots.map(l => [AU.lotLabel(l), l.refValue, l.opening]), [['20 Gems', 100, 25], ['5 Keys', 50, 13], ['50 Scrap', 10, 3]]);
  assert.equal(c.state.auction.mode, 'PER_CURRENCY'); assert.equal(events(c.state, 'AUCTION_START').length, 1);
});

test('BUNDLE sells everything as one lot; a currency filter narrows what goes up', () => {
  let c = table(); start(c, { mode: 'BUNDLE' });
  assert.equal(c.state.auction.lots.length, 1); assert.equal(c.state.auction.lots[0].refValue, 160); assert.equal(AU.lotLabel(c.state.auction.lots[0]), '20 Gems + 5 Keys + 50 Scrap');
  c = table(); start(c, { currencies: ['Keys'] }); assert.deepEqual(c.state.auction.lots.map(AU.lotLabel), ['5 Keys']);
});

test('an auction needs a seller with secondaries, a second player, and no auction already running', () => {
  const c = table(); assert.equal(AU.startAuction(c.config, c.state, c.q.id).error, true);        // Nick holds only Gold
  assert.equal(AU.startAuction(c.config, c.state, 'ghost').error, true);
  start(c); assert.match(start(c).text, /already running/);
  const solo = mkGame(['Solo']); solo.p.balances.Gems = 5; assert.equal(AU.startAuction(solo.config, solo.state, solo.p.id).error, true);
});

test('bids must meet the opening bid, then beat the high bid by the increment; the seller cannot bid', () => {
  const c = table(); start(c); const [, nick, sam] = c.players;
  assert.match(bid(c, nick, 24).text, /at least 25/); assert.equal(bid(c, c.p, 500).error, true);
  assert.equal(bid(c, nick, 25).error, undefined);
  assert.match(bid(c, sam, 30).text, /at least 35/); assert.equal(bid(c, sam, 35).error, undefined);
  assert.deepEqual(c.state.auction.lots[0].high, { playerId: sam.id, name: 'Sam', amount: 35 });
  assert.equal(bid(c, { id: 'ghost' }, 999).error, true);
});

test('going once, going twice, sold: currency to the buyer, Gold to the seller', () => {
  const c = table(); start(c); const nick = c.q; bid(c, nick, 80);
  assert.match(call(c).text, /once/); assert.match(call(c).text, /twice/);
  const r = call(c); assert.match(r.text, /SOLD — 20 Gems to Nick for 80 Gold/);
  assert.deepEqual([gold(c.p), gold(nick), c.p.balances.Gems, nick.balances.Gems], [580, 420, 0, 20]);
  assert.equal(c.state.auction.lotIdx, 1); assert.equal(c.state.auction.lots[0].status, 'sold');
});

test('a new bid resets the going-once count', () => {
  const c = table(); start(c); bid(c, c.q, 25); call(c); call(c);
  bid(c, c.players[2], 50); assert.equal(c.state.auction.lots[0].calls, 0);
  assert.match(call(c).text, /once/);
});

test('a lot with no bids passes and stays with the seller', () => {
  const c = table(); start(c); call(c); call(c); const r = call(c);
  assert.match(r.text, /No bids — 20 Gems stays with Aj/); assert.equal(c.p.balances.Gems, 20); assert.equal(c.state.auction.lots[0].status, 'passed');
});

test('passing skips the countdown and discards any bid', () => {
  const c = table(); start(c); bid(c, c.q, 60);
  AU.passLot(c.config, c.state); assert.deepEqual([gold(c.q), c.p.balances.Gems, c.state.auction.lotIdx], [500, 20, 1]);
});

test('the auction ends after the last lot with a summary', () => {
  const c = table(); start(c);
  bid(c, c.q, 100); call(c); call(c); call(c);                    // Gems sold
  call(c); call(c); call(c);                                      // Keys passed
  bid(c, c.players[2], 3); call(c); call(c); const r = call(c);   // Scrap sold
  assert.equal(r.finished, true); assert.deepEqual([c.state.auction.phase, c.state.auction.summary], ['done', '2 of 3 lots sold for 103 Gold.']);
  assert.equal(gold(c.p), 603); assert.equal(AU.currentLot(c.state.auction), null);
  assert.equal(bid(c, c.q, 500).error, true); assert.equal(call(c).error, true);
  assert.equal(events(c.state, 'AUCTION').length, 2); assert.equal(events(c.state, 'AUCTION_END')[0].total, 103);
});

test('a bundle moves every currency in one sale', () => {
  const c = table(); start(c, { mode: 'BUNDLE' }); bid(c, c.q, 150); call(c); call(c); call(c);
  assert.deepEqual([c.q.balances.Gems, c.q.balances.Keys, c.q.balances.Scrap, gold(c.q), gold(c.p)], [20, 5, 50, 350, 650]);
  assert.equal(c.state.auction.phase, 'done');
});

test('bidders may go into debt (Gold can go negative), and a seller who spent the goods mid-auction sells only what is left', () => {
  const c = table(); start(c); bid(c, c.q, 900); c.p.balances.Gems = 6;
  call(c); call(c); call(c);
  assert.deepEqual([gold(c.q), c.q.balances.Gems, c.p.balances.Gems], [-400, 6, 0]);
});

test('minBid tracks the lot; ending the auction clears it', () => {
  const c = table(); start(c); const lot = AU.currentLot(c.state.auction);
  assert.equal(AU.minBid(c.config, lot), 25); bid(c, c.q, 40); assert.equal(AU.minBid(c.config, lot), 50);
  assert.equal(AU.endAuction(c.state), true); assert.equal(c.state.auction, null); assert.equal(c.p.balances.Gems, 20);
});

test('auction rules are tunable', () => {
  const c = mkGame(['A', 'B'], 1, (cfg) => { cfg.Auction = { minIncrement: 50, openingPct: 0.5, callsToSell: 1 }; }); c.p.balances.Gems = 20;
  AU.startAuction(c.config, c.state, c.p.id); assert.equal(AU.currentLot(c.state.auction).opening, 50);
  AU.placeBid(c.config, c.state, c.q.id, 50); assert.equal(AU.minBid(c.config, AU.currentLot(c.state.auction)), 100);
  assert.match(AU.callLot(c.config, c.state).text, /SOLD/);
});
