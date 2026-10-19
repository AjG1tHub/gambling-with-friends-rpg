// Shop, Blood Pacts and the Collector, the Bank, sealed auctions, trades, bounties and the GM's economy controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, B } from './_helpers.mjs';
import { makeMap, startRun, makeCharacter, makeItem, land, slayCharacter, ctxFor, COL, at, characterOf, currentPlayerId } from './_fixtures-economy.mjs';
import { pactInterest, scoreOf, sellPriceOf, openPacts } from '../../packages/shared/handlers/economy.js';
import { spawnMonster } from '../../packages/shared/encounters/monsters.js';

function started({ seed = 42, mode = 'ffa' } = {}) {
  const r = room({ seed, mode }).join(names4); makeMap(r.state);
  for (const pid of r.state.seats) makeCharacter(r.state, pid, { pos: at('strip', COL.start), gold: 500, health: 80 });
  startRun(r); return r;
}
const lap = (r) => { for (let i = 0; i < r.state.seats.length; i++) r.append('TURN_END', {}, currentPlayerId(r.state)); };

test('Shop: only on the tile, priced from shop.*, class discounts, stock runs out, the Inn sells Potions, sell back at half', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  assert.match(r.try('SHOP_BUY', { sku: 'potion' }, pid).message, /not standing on shop/);
  land(r, pid, at('strip', COL.shop)); const shop = r.state.shops[at('strip', COL.shop)];
  r.append('SHOP_BUY', { sku: 'potion' }, pid); assert.equal(c.gold, 500 - B.shop.potion); assert.deepEqual(c.pendingLoot.at(-1), { baseId: 'potion', rarity: 'common', bought: true }); assert.equal(shop.stock.find(e => e.sku === 'potion').qty, B.shop.stock - 1);
  assert.match(r.try('SHOP_BUY', { sku: 'dragon' }, pid).message, /no dragon/);
  const gear = shop.stock.find(e => e.spec.baseId === 'loot'); const g = c.gold;
  r.append('SHOP_BUY', { sku: gear.sku }, pid); assert.equal(c.gold, g - B.shop[gear.priceKey]); assert.equal(c.pendingLoot.at(-1).baseId, 'loot'); assert.equal(c.pendingLoot.at(-1).rarity, gear.spec.rarity);
  assert.match(r.try('SHOP_BUY', { sku: gear.sku }, pid).message, /sold out/);
  c.classId = 'cutpurse'; const g2 = c.gold; r.append('SHOP_BUY', { sku: 'nudge' }, pid); assert.equal(c.gold, g2 - Math.round(B.shop.nudge * B.shop.cutpurseConsumableFraction));
  c.classId = 'pitboss'; c.level = B.xp.upgradeLevels[1]; const g3 = c.gold; r.append('SHOP_BUY', { sku: 'fork' }, pid); assert.equal(c.gold, g3 - Math.round(B.shop.fork * (1 - B.classes.pitBossShopDiscount)));
  c.gold = 1; assert.match(r.try('SHOP_BUY', { sku: 'spyglass' }, pid).message, /not enough Gold/); c.gold = 100;
  // the Inn: potions only
  c.classId = 'whale'; c.level = 1; land(r, pid, at('strip', COL.inn)); assert.match(r.try('SHOP_BUY', { sku: 'fork' }, pid).message, /only sells Potions/); r.append('SHOP_BUY', { sku: 'potion' }, pid); assert.equal(c.gold, 100 - B.shop.potion);
  r.append('INN_REST', {}, pid); assert.equal(c.health, 80 + B.health.innHeal); assert.match(r.try('INN_REST', {}, pid).message, /already rested/);
  c.classId = 'pitboss'; c.level = B.xp.upgradeLevels[0]; c.health = 50; land(r, pid, at('strip', COL.inn)); r.append('INN_REST', {}, pid); r.append('INN_REST', {}, pid); assert.equal(c.health, 50 + 2 * B.health.innHeal, 'Pit Boss 5 rests twice'); assert.match(r.try('INN_REST', {}, pid).message, /already/);
  land(r, pid, at('strip', COL.plain)); assert.match(r.try('INN_REST', {}, pid).message, /not at an Inn/);
  // selling
  const rare = makeItem({ name: 'Rare Ring', slot: 'ring', rarity: 'rare' }); const pots = makeItem({ name: 'Potion', baseId: 'potion', slot: 'consumable', qty: 3 }); const wornBlade = makeItem({ name: 'Blade' });
  c.items[rare.id] = rare; c.grid.cells.push({ itemId: rare.id, x: 0, y: 0 }); c.items[pots.id] = pots; c.worn.mainhand = wornBlade; c.items[wornBlade.id] = wornBlade;
  assert.match(r.try('SHOP_SELL', { itemId: rare.id }, pid).message, /not standing on shop/);
  land(r, pid, at('strip', COL.shop)); const g4 = c.gold;
  assert.equal(sellPriceOf(r.state, ctxFor(r), rare), Math.round(B.shop.itemRare * B.gold.shopSellFraction));
  r.append('SHOP_SELL', { itemId: rare.id }, pid); assert.equal(c.gold, g4 + Math.round(B.shop.itemRare * B.gold.shopSellFraction)); assert.equal(c.items[rare.id], undefined); assert.equal(c.grid.cells.length, 0);
  r.append('SHOP_SELL', { itemId: pots.id }, pid); assert.equal(c.gold, g4 + Math.round(B.shop.itemRare * B.gold.shopSellFraction) + Math.round(B.shop.potion * B.gold.shopSellFraction * 3));
  assert.match(r.try('SHOP_SELL', { itemId: wornBlade.id }, pid).message, /unequip/);
  // the shelf restocks after shop.restockRounds
  shop.stock.find(e => e.sku === 'potion').qty = 0; for (let i = 0; i < B.shop.restockRounds; i++) lap(r);
  land(r, currentPlayerId(r.state), at('strip', COL.shop)); assert.equal(r.state.shops[at('strip', COL.shop)].stock.find(e => e.sku === 'potion').qty, B.shop.stock);
});

test('Blood Pacts: terms, interest modifiers, overheal, repayment, the due date and the Collector paying it down', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid); const ctx = ctxFor(r);
  assert.match(r.try('PACT_TAKE', { amount: 30 }, pid).message, /not standing on bloodbank/);
  // interest
  assert.equal(pactInterest(r.state, ctx, c, 'strip'), B.bloodPact.interest);
  assert.equal(pactInterest(r.state, ctx, c, 'docks'), Math.round(B.bloodPact.interest * (1 - B.bloodPact.docksDiscount) * 1000) / 1000);
  c.stats.greed = B.stats.neutral + 2; assert.equal(pactInterest(r.state, ctx, c, 'strip'), B.bloodPact.interest + 2 * B.bloodPact.greedInterestPerPoint); c.stats.greed = B.stats.neutral;
  c.classId = 'pitboss'; assert.equal(pactInterest(r.state, ctx, c, 'strip'), Math.round(B.bloodPact.interest * (1 - B.classes.pitBossPactDiscount) * 1000) / 1000); c.classId = 'whale';
  c.setBonuses = ['iron']; assert.equal(pactInterest(r.state, ctx, c, 'strip'), B.bloodPact.interest * B.bloodPact.ironSetFraction); c.setBonuses = [];
  land(r, pid, at('strip', COL.bloodbank)); c.health = 40;
  assert.match(r.try('PACT_TAKE', { amount: B.bloodPact.max + 1 }, pid).message, /at most/);
  assert.match(r.try('PACT_TAKE', { amount: 0 }, pid).message, /amount/);
  r.append('PACT_TAKE', { amount: 40 }, pid);
  const p = r.state.pacts[c.pactIds[0]]; assert.equal(c.health, 80, 'borrowed Health is credited'); assert.deepEqual([p.principal, p.owed, p.turnsLeft, p.status, p.charId], [40, Math.round(40 * (1 + B.bloodPact.interest)), B.bloodPact.dueTurns, 'open', c.id]);
  r.append('PACT_TAKE', { amount: 10 }, pid); assert.equal(openPacts(r.state, c).length, 2);
  assert.match(r.try('PACT_TAKE', { amount: 10 }, pid).message, /pacts open already/);
  // partial repayment, then in full; never to zero Health
  r.append('PACT_REPAY', { pactId: p.id, amount: 20 }, pid); assert.equal(p.owed, 30); assert.equal(c.health, 70);
  c.health = 25; assert.match(r.try('PACT_REPAY', { pactId: p.id, amount: 25 }, pid).message, /kill you/); c.health = 70;
  r.append('PACT_REPAY', { pactId: p.id }, pid); assert.equal(p.status, 'paid'); assert.equal(c.pactIds.length, 1); assert.equal(c.questCounters.pactRepaid, 1); assert.equal(c.health, 40);
  c.shield = 5; r.append('PACT_TAKE', { amount: 5 }, pid); r.append('PACT_REPAY', { pactId: c.pactIds[1], amount: 5 }, pid); assert.equal(c.shield, 5, 'repayment is paid in Health, not shield'); c.shield = 0; r.append('PACT_REPAY', { pactId: c.pactIds[1] }, pid);
  // the clock: own turns only; overdue brings the Collector who pays it down
  const q = r.state.pacts[c.pactIds[0]]; assert.equal(q.turnsLeft, B.bloodPact.dueTurns);
  for (let i = 0; i < B.bloodPact.dueTurns; i++) lap(r);
  assert.equal(q.status, 'overdue'); assert.equal(q.turnsLeft, 0); const h = c.health;
  lap(r); assert.equal(c.health, h - B.bloodPact.collectorPerTurn); assert.equal(q.owed, Math.round(10 * (1 + B.bloodPact.interest)) - B.bloodPact.collectorPerTurn); assert.equal(q.overdueTurns, 1);
  lap(r); assert.equal(q.status, 'paid'); assert.equal(c.health, h - Math.round(10 * (1 + B.bloodPact.interest))); assert.equal(openPacts(r.state, c).length, 0); assert.ok(r.state.log.some(l => /settled in blood/.test(l.text)));
  // Pit Boss 15 is never visited; the debt simply stands
  const other = r.state.seats.find(x => x !== pid); const oc = characterOf(r.state, other); oc.classId = 'pitboss'; oc.level = B.xp.upgradeLevels[2]; oc.pos = at('docks', COL.bloodbank);
  r.append('PACT_TAKE', { amount: 20, playerId: other }, 'gm'); const op = r.state.pacts[oc.pactIds[0]]; assert.equal(op.regionId, 'docks');
  const oh = oc.health; for (let i = 0; i < B.bloodPact.dueTurns + 2; i++) lap(r); assert.equal(op.status, 'overdue'); assert.equal(oc.health, oh, 'untouched');
  // the Inn shelters this round
  oc.classId = 'whale'; oc.level = 1;
  const idx = r.state.seats.indexOf(other); while (currentPlayerId(r.state) !== r.state.seats[(idx + 3) % 4]) r.append('TURN_END', {}, currentPlayerId(r.state));
  oc.innSafeRound = r.state.round + (idx === 0 ? 1 : 0);          // the round the Collector would call in
  r.append('TURN_END', {}, currentPlayerId(r.state)); assert.equal(currentPlayerId(r.state), other); assert.equal(oc.health, oh, 'sheltered by the Inn');
  lap(r); assert.equal(oc.health, oh - B.bloodPact.collectorPerTurn);
});

test('Bank: deposit and withdraw only at a Bank; banked Gold is a separate pool', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  assert.match(r.try('BANK_DEPOSIT', { amount: 100 }, pid).message, /not standing on bloodbank\/bank/);
  land(r, pid, at('strip', COL.bloodbank));
  r.append('BANK_DEPOSIT', { amount: 300 }, pid); assert.equal(c.gold, 200); assert.equal(c.bank, 300);
  assert.match(r.try('BANK_DEPOSIT', { amount: 201 }, pid).message, /not enough Gold/);
  assert.match(r.try('BANK_WITHDRAW', { amount: 301 }, pid).message, /not that much/);
  r.append('BANK_WITHDRAW', { amount: 100 }, pid); assert.equal(c.gold, 300); assert.equal(c.bank, 200);
  assert.deepEqual(r.state.ledger.slice(-2).map(x => x.kind), ['bank', 'gold']);
});

test('Auction: sealed bids, the minimum, ties to the earlier bid, the winner pays, the seller is paid net of the house cut', () => {
  const r = started(); const [a, b, c, d] = r.state.seats; const cb = characterOf(r.state, b), cc = characterOf(r.state, c), cd = characterOf(r.state, d);
  assert.match(r.try('AUCTION_BID', { amount: 50 }, b).message, /no auction open/);
  r.append('AUCTION_OPEN', { spec: { baseId: 'loot', rarity: 'epic', seed: 1 } });
  const au = r.state.auction; assert.equal(au.sellerId, null); assert.equal(au.minBid, B.auction.minBid); assert.equal(au.deadline, r.now() + B.auction.windowSeconds * 1000);
  assert.match(r.try('AUCTION_OPEN', { spec: { baseId: 'loot' } }).message, /already open/);
  assert.match(r.try('AUCTION_BID', { amount: B.auction.minBid - 1 }, b).message, /at least/);
  assert.match(r.try('AUCTION_BID', { amount: 9999 }, b).message, /not enough Gold/);
  r.append('AUCTION_BID', { amount: 100 }, b); r.tick(1000); r.append('AUCTION_BID', { amount: 100 }, c); r.append('AUCTION_BID', { amount: 60 }, d);
  assert.equal(Object.keys(au.bids).length, 3);
  assert.match(r.try('AUCTION_CLOSE', {}, b).message, /GM only/);
  r.append('AUCTION_CLOSE', {}, 'system');
  assert.equal(au.done, true); assert.equal(au.result.winnerId, b, 'the earlier of two equal bids'); assert.equal(cb.gold, 400); assert.equal(cc.gold, 500); assert.equal(cd.gold, 500);
  assert.deepEqual(cb.pendingLoot.at(-1), { baseId: 'loot', rarity: 'epic', seed: 1, auction: true }); assert.equal(cb.questCounters.auctionsWon, 1);
  // a player sells a grid item from the Arena; a re-bid loses its place in the tie order
  const ring = makeItem({ name: 'Ring', slot: 'ring' }); const ca = characterOf(r.state, a); ca.items[ring.id] = ring; ca.grid.cells.push({ itemId: ring.id, x: 0, y: 0 });
  assert.match(r.try('AUCTION_OPEN', { itemId: ring.id }, a).message, /not standing on arena/);
  land(r, a, at('strip', COL.arena)); r.state.pendingPrompt = null;
  r.append('AUCTION_OPEN', { itemId: ring.id, minBid: 20 }, a); assert.equal(ca.items[ring.id], undefined); assert.equal(r.state.auction.minBid, 20); assert.equal(r.state.auction.lot.item.id, ring.id);
  assert.match(r.try('AUCTION_BID', { amount: 50 }, a).message, /seller cannot bid/);
  r.append('AUCTION_BID', { amount: 50 }, c); r.append('AUCTION_BID', { amount: 50 }, d); r.append('AUCTION_BID', { amount: 50 }, c);
  const g = ca.gold; r.append('AUCTION_CLOSE', {});
  assert.equal(r.state.auction.result.winnerId, d); assert.equal(cd.gold, 450); assert.equal(ca.gold, g + Math.round(50 * (1 - B.auction.houseCut))); assert.equal(cd.pendingLoot.at(-1).item.id, ring.id);
  // no bids: the lot goes back to the seller
  const ring2 = makeItem({ name: 'Ring 2', slot: 'ring' }); ca.items[ring2.id] = ring2;
  r.append('AUCTION_OPEN', { itemId: ring2.id }, a); r.append('AUCTION_CLOSE', {}); assert.equal(r.state.auction.result.winnerId, null); assert.equal(ca.pendingLoot.at(-1).item.id, ring2.id);
  // a bidder who spent their Gold since is skipped
  r.append('AUCTION_OPEN', { spec: { baseId: 'loot', rarity: 'rare' } }); r.append('AUCTION_BID', { amount: 300 }, c); r.append('AUCTION_BID', { amount: 40 }, d); cc.gold = 10; r.append('AUCTION_CLOSE', {}); assert.equal(r.state.auction.result.winnerId, d);
});

test('Trades: an offer is checked, answered any time, settled at the next end of turn; a declined or impossible trade moves nothing', () => {
  const r = started(); const [a, b] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b);
  const blade = makeItem({ name: 'Blade' }); ca.items[blade.id] = blade; ca.grid.cells.push({ itemId: blade.id, x: 0, y: 0 });
  const pet = { id: 'pet1', speciesId: 'maw', name: 'Moo', element: 'Verdigris', stage: 1, power: 40, maxPower: 40, attacks: [], heldItem: null, fainted: false }; cb.pets = [pet]; cb.activePetId = 'pet1';
  assert.match(r.try('TRADE_OFFER', { toId: b, give: {}, want: {} }, a).message, /empty trade/);
  assert.match(r.try('TRADE_OFFER', { toId: b, give: { gold: 9999 } }, a).message, /not enough Gold/);
  assert.match(r.try('TRADE_OFFER', { toId: b, give: { itemIds: ['nope'] } }, a).message, /do not hold/);
  assert.match(r.try('TRADE_OFFER', { toId: a, give: { gold: 1 } }, a).message, /someone else/);
  r.append('TRADE_OFFER', { toId: b, give: { gold: 100, itemIds: [blade.id] }, want: { petIds: ['pet1'], gold: 20 } }, a);
  const t = r.state.trades[0]; assert.equal(t.status, 'offered');
  assert.match(r.try('TRADE_ANSWER', { tradeId: t.id, accept: true }, a).message, /cannot act/);
  r.append('TRADE_ANSWER', { tradeId: t.id, accept: true }, b); assert.equal(t.status, 'accepted'); assert.equal(ca.gold, 500, 'nothing moves yet');
  r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t.status, 'settled'); assert.equal(ca.gold, 420); assert.equal(cb.gold, 580); assert.equal(ca.items[blade.id], undefined); assert.equal(ca.grid.cells.length, 0);
  // the blade is handed over as a pendingLoot spec; the inventory module materialises it into the grid at b's turn start
  assert.ok(cb.items[blade.id] || cb.pendingLoot.some(s => s.item?.id === blade.id), 'the blade is b\'s now');
  assert.deepEqual(cb.pets, []); assert.equal(cb.activePetId, null); assert.equal(ca.pets[0].id, 'pet1'); assert.equal(ca.activePetId, 'pet1');
  // decline; and a trade whose goods vanished fails at settlement
  r.append('TRADE_OFFER', { toId: a, give: { gold: 10 } }, b); r.append('TRADE_ANSWER', { tradeId: r.state.trades[1].id, accept: false }, a); assert.equal(r.state.trades[1].status, 'declined');
  r.append('TRADE_OFFER', { toId: a, give: { gold: 50 } }, b); r.append('TRADE_ANSWER', { tradeId: r.state.trades[2].id, accept: true }, a); cb.gold = 0; r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.trades[2].status, 'failed'); assert.equal(ca.gold, 420);
});

test('Bounties: posted at the board for at least gold.bountyMin, paid by the poster, collected by the killer; the GM posts for the house', () => {
  const r = started(); const [a, b, c] = r.state.seats; const ca = characterOf(r.state, a), cc = characterOf(r.state, c);
  assert.match(r.try('BOUNTY_PLACE', { targetId: b, gold: 100 }, a).message, /not standing on bounty/);
  land(r, a, at('strip', COL.bounty));
  assert.match(r.try('BOUNTY_PLACE', { targetId: b, gold: B.gold.bountyMin - 1 }, a).message, /at least/);
  assert.match(r.try('BOUNTY_PLACE', { targetId: a, gold: 100 }, a).message, /not on yourself/);
  r.append('BOUNTY_PLACE', { targetId: b, gold: 100 }, a); assert.equal(ca.gold, 400); assert.deepEqual(r.state.bounties.map(x => [x.targetId, x.byId, x.gold]), [[b, a, 100]]);
  r.append('BOUNTY_PLACE', { targetId: b, gold: 70 }, 'gm'); assert.equal(r.state.bounties[1].byId, 'house');
  slayCharacter(r, characterOf(r.state, b).id, { killerId: cc.id, killerKind: 'player' });
  assert.equal(cc.gold, 500 + B.gold.perKO + 170); assert.deepEqual(r.state.bounties, []);
});

test('GM controls: Gold (never below zero), Health, an item spec, teleport, spawn; the ffa score', () => {
  const r = started(); const pid = r.state.seats[1]; const c = characterOf(r.state, pid);
  assert.match(r.try('GM_GOLD', { playerId: pid, amount: 5 }, pid).message, /GM only/);
  r.append('GM_GOLD', { playerId: pid, amount: 250 }); assert.equal(c.gold, 750); r.append('GM_GOLD', { playerId: pid, amount: -9999 }); assert.equal(c.gold, 0);
  r.append('GM_HEALTH', { playerId: pid, amount: 15 }); assert.equal(c.health, 95); r.append('GM_HEALTH', { playerId: pid, amount: 50, overheal: true }); assert.equal(c.health, 145);
  r.append('GM_ITEM', { playerId: pid, baseId: 'loot', rarity: 'rare', seed: 77 }); assert.deepEqual(c.pendingLoot.at(-1), { baseId: 'loot', rarity: 'rare', region: 'strip', seed: 77, gm: true });
  r.append('GM_ITEM', { playerId: pid, legendaryId: 'potency', seed: 78 }); assert.deepEqual(c.pendingLoot.at(-1), { baseId: 'potency', rarity: 'legendary', region: 'strip', seed: 78, gm: true }, 'a named Legendary goes by its id');
  assert.match(r.try('GM_TELEPORT', { playerId: pid, hex: at('docks', COL.wall) }).message, /not a hex/);
  r.append('GM_TELEPORT', { playerId: pid, hex: at('caldera', COL.plain) }); assert.equal(c.pos, at('caldera', COL.plain)); assert.equal(c.region, 'caldera'); assert.equal(c.prevPos, at('strip', COL.start));
  assert.match(r.try('GM_SPAWN', { speciesId: 'card_shark', hex: at('strip', COL.enc1) }).message, /already stands/);
  r.append('GM_SPAWN', { speciesId: 'boss_docks', hex: at('strip', COL.plain), name: 'Big Bertha' });
  const m = r.state.monsters[r.state.map.hexes[at('strip', COL.plain)].monsterId]; assert.equal(m.name, 'Big Bertha'); assert.ok(m.boss); assert.equal(m.regionId, 'strip');
  assert.throws(() => spawnMonster(r.state, ctxFor(r), 'nope', at('strip', COL.plain)), /unknown species/);
  c.gold = 120; c.kills = 2; c.health = 33; assert.equal(scoreOf(r.state, ctxFor(r), c), 120 + 2 * B.gold.scorePerKill + 33); c.dead = true; assert.equal(scoreOf(r.state, ctxFor(r), c), 120 + 2 * B.gold.scorePerKill);
});
