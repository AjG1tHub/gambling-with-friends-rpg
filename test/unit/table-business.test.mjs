// Votes, trades and auctions end to end from the phone's side (apps/phone/screens/table.js is the pure view; the
// handlers are economy.js and social.js). 19 Nov: these had engine handlers but no way for a person to reach them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tableBusiness, tradeSide } from '../../apps/phone/screens/table.js';
import { auctionReveal } from '../../apps/tv/screens/play.js';
import { tableDuties } from '../../packages/shared/bot.js';
import { makeRng } from '../../packages/shared/rng.js';
import { currentPlayerId } from '../../packages/shared/state.js';
import { playingRoom, charOf, give, gen } from './_fixtures-characters.mjs';

test('trade: the recipient sees the offer with both sides in words, accepts, and it settles at the end of the turn', () => {
  const r = playingRoom(); const st = r.state; const [a, b] = st.seats;
  const ring = give(r, a, gen.makeGear(st, 'ring', { seed: 5 }));
  r.append('GM_GOLD', { playerId: b, amount: 40 });
  r.append('TRADE_OFFER', { toId: b, give: { itemIds: [ring.id] }, want: { gold: 25 } }, a);
  const biz = tableBusiness(st, b);
  assert.equal(biz.incoming.length, 1); assert.equal(tableBusiness(st, a).outgoing.length, 1);
  assert.equal(tradeSide(st, a, biz.incoming[0].give), ring.name); assert.equal(tradeSide(st, b, biz.incoming[0].want), '25 Gold');
  r.append('TRADE_ANSWER', { tradeId: biz.incoming[0].id, accept: true }, b);
  assert.equal(tableBusiness(st, b).incoming.length, 0, 'answered: nothing left to answer');
  const goldA = charOf(r, a).gold || 0;
  r.append('TURN_END', {}, currentPlayerId(st));
  assert.ok(charOf(r, b).items[ring.id] || (charOf(r, b).pendingLoot || []).some(l => l.item?.id === ring.id), 'the ring moved to the buyer');
  assert.equal(charOf(r, a).gold, goldA + 25, 'the Gold moved to the seller');
});

test('vote: every seat sees it and can cast; the ballot shows as cast; the table closes it at the deadline', () => {
  const r = playingRoom(); const st = r.state; const [a, b, c] = st.seats;
  r.append('VOTE_OPEN', { kind: 'table' }, a);
  const v = tableBusiness(st, b).vote; assert.ok(v && v.kind === 'table' && v.options.length >= 2);
  r.append('VOTE_CAST', { choice: a }, b);
  assert.equal(tableBusiness(st, b).vote.myChoice, a); assert.equal(tableBusiness(st, c).vote.myChoice, null, 'ballots are per phone');
  assert.deepEqual(tableDuties(st, makeRng(1), r.now()).filter(d => d.type === 'VOTE_CLOSE'), [], 'not before the deadline');
  r.tick(31000);
  const d = tableDuties(st, makeRng(1), r.now()).find(x => x.type === 'VOTE_CLOSE'); assert.ok(d, 'the table closes the vote at the deadline');
  r.append('VOTE_CLOSE', {}, 'system'); assert.equal(tableBusiness(st, b).vote, null);
});

test('auction: the house opens, phones bid, the table closes it at the deadline, the TV reveals every bid', () => {
  const r = playingRoom(); const st = r.state; const [a, b, c] = st.seats;
  for (const id of [a, b, c]) r.append('GM_GOLD', { playerId: id, amount: 80 });
  r.append('AUCTION_OPEN', { spec: { rarity: 'rare' } }, 'gm');
  assert.ok(tableBusiness(st, a).auction, 'every phone sees the open auction');
  r.append('AUCTION_BID', { amount: 30 }, a); r.append('AUCTION_BID', { amount: 45 }, b);
  assert.equal(tableDuties(st, makeRng(1), r.now()).some(x => x.type === 'AUCTION_CLOSE'), false, 'open until the deadline');
  r.tick(31000);
  const d = tableDuties(st, makeRng(1), r.now()).find(x => x.type === 'AUCTION_CLOSE'); assert.ok(d, 'the table closes the auction at the deadline (nothing did before)');
  r.append('AUCTION_CLOSE', {}, d.actor);
  assert.equal(tableBusiness(st, a).auction, null);
  const rev = auctionReveal(st.auction, st.players);
  assert.match(rev.headline, new RegExp(`SOLD to ${st.players[b].name} for 45 Gold`)); assert.equal(rev.bids.length, 2); assert.ok(rev.bids[0].endsWith(' 45'), 'highest bid first');
});
