// The economy: Shop, Blood Pacts and the Collector, the Bank, sealed-bid auctions, trades, bounties and the GM's
// money and world controls. Gold is never bet (SPEC.md › Health economy); it moves only through health.js.
//
// Events (payloads):
//   SHOP_BUY   { sku, playerId? }                       on a Shop hex (Potions also at an Inn); price from shop.*
//   SHOP_SELL  { itemId, playerId? }                    a grid item, back at gold.shopSellFraction of its price
//   PACT_TAKE  { amount, playerId? }                    on a Blood Bank: borrow Health (credited up to max Health)
//   PACT_REPAY { pactId?, amount?, playerId? }          on a Blood Bank: pay Health back
//   BANK_DEPOSIT / BANK_WITHDRAW { amount, playerId? }  on a Blood Bank (or a 'bank' hex if the map has one)
//   AUCTION_OPEN  { itemId?, sellerId?, spec?, minBid?, windowSeconds? }  GM, or a player on an Arena hex selling a grid item
//   AUCTION_BID   { amount, playerId? }                 sealed; at least auction.minBid; the UI hides other bids
//   AUCTION_CLOSE {}                                    GM/TV after the window: highest pays, ties go to the earlier bid
//   TRADE_OFFER   { toId, give: { gold, itemIds, petIds }, want: { gold, itemIds, petIds }, fromId? }
//   TRADE_ANSWER  { tradeId, accept }                   settles at the next end of turn (turnEnd hook)
//   BOUNTY_PLACE  { targetId, gold, playerId? }         on a Bounty Board (or GM); collected by whoever KOs the target
//   GM_GOLD { playerId, amount } · GM_HEALTH { playerId, amount } · GM_ITEM { playerId, baseId, rarity, seed?, slot? }
//   GM_TELEPORT { playerId, hex } · GM_SPAWN { speciesId, hex, name? }
// State: state.pacts { id: { id, charId, playerId, principal, interest, owed, paid, turnsLeft, status, takenAt } },
//   state.auction { id, sellerId, lot: { item } | { spec }, minBid, openedAt, deadline, bids: { pid: { amount, seq, ts } }, done, result },
//   state.trades [ { id, fromId, toId, give, want, status: 'offered'|'accepted'|'declined'|'settled'|'failed', offeredAt } ],
//   state.bounties [ { id, targetId, byId, gold, placedAt } ].
import { register, refuse, requireGm, requirePhase, requireActor, requirePlayer } from '../reducer.js';
import { characterOf, currentPlayerId, note } from '../state.js';
import { health, gold, bankGold, canPay } from '../health.js';
import { RARITIES, rarityKey } from '../balance.js';
import { hooks as runHooks } from './run.js';
import { ensureShopStock } from './tiles.js';
import { pushLoot, collectorVisit, counter, isLandable, regionOf } from './wheels.js';
import { killCharacter, resolveCharacter, removeItem, isWorn } from './death.js';
import { spawnMonster } from '../encounters/monsters.js';

const need = (state, pid) => { const c = characterOf(state, pid); if (!c) refuse(`no character for ${pid}`); return c; };
const hexOf = (state, c) => state.map?.hexes?.[c.pos] || null;
const onTile = (state, ctx, c, ...types) => { const h = hexOf(state, c); if (!ctx.isGm && !(h && types.includes(h.type))) refuse(`not standing on ${types.join('/')}`, 'tile'); return h; };
const whoFor = (state, ctx) => { const pid = ctx.payload.playerId || (ctx.isGm ? currentPlayerId(state) : ctx.actor); requireActor(state, ctx, pid); return pid; };
const seq = (state, key) => (state[key] = (state[key] || 0) + 1);
export const openPacts = (state, c) => (c.pactIds || []).map(id => state.pacts[id]).filter(p => p && p.owed > 0);
export const scoreOf = (state, ctx, c) => Math.round((c.gold || 0) + ctx.B('gold').scorePerKill * (c.kills || 0) + (c.dead ? 0 : c.health || 0));

// ---- Shop -------------------------------------------------------------------------------------------------
const CONSUMABLE_PRICE_KEY = { potion: 'potion', nudge: 'nudge', reroll: 'reroll', fork: 'fork', smokebomb: 'smokeBomb', phoenixfeather: 'phoenixFeather', petrevive: 'petRevive', satchel: 'satchel', spyglass: 'spyglass' };
export function priceOf(state, ctx, c, entry) {
  const S = ctx.B('shop'), CL = ctx.B('classes'), X = ctx.B('xp');
  let price = S[entry.priceKey]; if (price == null) refuse(`no price for ${entry.priceKey}`);
  if (c.classId === 'cutpurse' && (entry.sku === 'nudge' || entry.sku === 'fork')) price *= S.cutpurseConsumableFraction;
  if (c.classId === 'pitboss' && (c.level || 1) >= X.upgradeLevels[1]) price *= 1 - CL.pitBossShopDiscount;
  return Math.max(1, Math.round(price));
}
export function basePriceOfItem(state, ctx, item) {
  const S = ctx.B('shop');
  const key = CONSUMABLE_PRICE_KEY[item.baseId];
  if (key) return S[key];
  return S[rarityKey(RARITIES.includes(item.rarity) ? item.rarity : 'common', 'item')];
}
export const sellPriceOf = (state, ctx, item) => Math.max(0, Math.round(basePriceOfItem(state, ctx, item) * ctx.B('gold').shopSellFraction * (item.qty || 1)));

// ---- Blood Pacts ------------------------------------------------------------------------------------------
export function pactInterest(state, ctx, c, regionId) {
  const BP = ctx.B('bloodPact'), S = ctx.B('stats'), CL = ctx.B('classes');
  let interest = BP.interest + BP.greedInterestPerPoint * Math.max(0, (c.stats?.greed ?? S.neutral) - S.neutral);
  const region = regionId ? state.map?.regions?.[regionId] : null;
  if (regionId === 'docks' || region?.modifier?.key === 'cheapPacts') interest *= 1 - BP.docksDiscount;
  if (c.classId === 'pitboss') interest *= 1 - CL.pitBossPactDiscount;
  const iron = Array.isArray(c.setBonuses) ? c.setBonuses.includes('iron') : !!c.setBonuses?.iron?.complete;   // characters module: { iron: { pieces, complete } }
  if (iron) interest *= BP.ironSetFraction;
  return Math.max(0, Math.round(interest * 1000) / 1000);
}
function pactTick(state, ctx, pid) {
  const c = characterOf(state, pid); if (!c) return;
  const BP = ctx.B('bloodPact');
  for (const p of openPacts(state, c)) {
    if (p.status === 'open') {
      p.turnsLeft -= 1;
      if (p.turnsLeft <= 0) { p.status = 'overdue'; p.turnsLeft = 0; note(state, `${c.name}'s Blood Pact is overdue (${p.owed} Health). The Collector is coming.`, 'pact', ctx.now); }
      else if (p.turnsLeft === 1) note(state, `${c.name}'s Blood Pact (${p.owed} Health) is due next turn`, 'pact', ctx.now);
      continue;
    }
    if (p.status === 'overdue' && !c.dead) {
      const took = collectorVisit(state, ctx, c, `Blood Pact ${p.id}`, Math.min(BP.collectorPerTurn, p.owed));
      p.overdueTurns = (p.overdueTurns || 0) + 1;
      if (took > 0) { p.owed = Math.max(0, p.owed - took); p.paid = (p.paid || 0) + took; }
      if (p.owed <= 0) { p.status = 'paid'; c.pactIds = c.pactIds.filter(id => id !== p.id); counter(c, 'pactRepaid'); note(state, `${c.name}'s pact is settled in blood`, 'pact', ctx.now); }
    }
  }
}
runHooks.turnStart.push(pactTick);

// ---- trades settle at the end of a turn -------------------------------------------------------------------
function settleTrades(state, ctx) {
  for (const t of state.trades || []) {
    if (t.status !== 'accepted') continue;
    const a = characterOf(state, t.fromId), b = characterOf(state, t.toId);
    const ok = a && b && !a.dead && !b.dead && canPay(a, t.give.gold || 0) && canPay(b, t.want.gold || 0)
      && (t.give.itemIds || []).every(id => a.items?.[id] && !isWorn(a, id)) && (t.want.itemIds || []).every(id => b.items?.[id] && !isWorn(b, id))
      && (t.give.petIds || []).every(id => (a.pets || []).some(p => p.id === id)) && (t.want.petIds || []).every(id => (b.pets || []).some(p => p.id === id));
    if (!ok) { t.status = 'failed'; t.settledAt = ctx.now; note(state, `The trade between ${a?.name || t.fromId} and ${b?.name || t.toId} falls through`, 'trade', ctx.now); continue; }
    const move = (from, to, side) => {
      if (side.gold) { gold(state, from, -side.gold, `trade with ${to.name}`, ctx); gold(state, to, side.gold, `trade with ${from.name}`, ctx); }
      for (const id of side.itemIds || []) { const it = from.items[id]; removeItem(from, id); pushLoot(to, { item: it }); }
      for (const id of side.petIds || []) { const i = from.pets.findIndex(p => p.id === id); const [pet] = from.pets.splice(i, 1); (to.pets ||= []).push(pet); if (from.activePetId === id) from.activePetId = from.pets[0]?.id ?? null; if (!to.activePetId) to.activePetId = pet.id; }
    };
    move(a, b, t.give); move(b, a, t.want);
    t.status = 'settled'; t.settledAt = ctx.now;
    note(state, `${a.name} and ${b.name} trade`, 'trade', ctx.now);
  }
}
runHooks.turnEnd.push((state, ctx) => settleTrades(state, ctx));

// ---- auctions ---------------------------------------------------------------------------------------------
export function auctionWinner(state) {
  const a = state.auction; if (!a) return null;
  const bids = Object.entries(a.bids).map(([pid, b]) => ({ pid, ...b })).sort((x, y) => y.amount - x.amount || x.seq - y.seq);
  for (const b of bids) { const c = characterOf(state, b.pid); if (c && canPay(c, b.amount)) return b; }
  return null;
}

register({
  SHOP_BUY(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = whoFor(state, ctx); const c = need(state, pid);
    const h = onTile(state, ctx, c, 'shop', 'inn'); if (!h) refuse('no shop here');
    const sku = String(ctx.payload.sku || ''); if (!sku) refuse('sku required');
    if (h.type === 'inn' && sku !== 'potion') refuse('the Inn only sells Potions', 'shop');
    const shop = h.type === 'inn' ? (state.shops[h.key] ||= { hexKey: h.key, regionId: h.regionId, openedRound: state.round, inn: true, stock: [{ sku: 'potion', name: 'Potion', priceKey: 'potion', qty: ctx.B('shop').stock, spec: { baseId: 'potion', rarity: 'common' } }] }) : ensureShopStock(state, ctx, h.key, h.regionId);
    const entry = shop.stock.find(e => e.sku === sku); if (!entry) refuse(`no ${sku} on this shelf`, 'shop'); if (entry.qty <= 0) refuse(`${entry.name} is sold out`, 'shop');
    const price = priceOf(state, ctx, c, entry); if (!canPay(c, price)) refuse(`not enough Gold (${price})`, 'gold');
    gold(state, c, -price, `buy ${entry.name}`, ctx); entry.qty -= 1;
    pushLoot(c, { ...structuredClone(entry.spec), bought: true }); counter(c, 'purchases');
    note(state, `${c.name} buys ${entry.name} for ${price} Gold`, 'shop', ctx.now);
  },
  SHOP_SELL(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = whoFor(state, ctx); const c = need(state, pid);
    onTile(state, ctx, c, 'shop');
    const item = c.items?.[ctx.payload.itemId]; if (!item) refuse('no such item', 'item'); if (isWorn(c, item.id)) refuse('unequip it first', 'item');
    const price = sellPriceOf(state, ctx, item);
    removeItem(c, item.id); gold(state, c, price, `sell ${item.name}`, ctx);
    note(state, `${c.name} sells ${item.name} for ${price} Gold`, 'shop', ctx.now);
  },
  PACT_TAKE(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = whoFor(state, ctx); const c = need(state, pid);
    const h = onTile(state, ctx, c, 'bloodbank'); const BP = ctx.B('bloodPact');
    const amount = Math.round(Number(ctx.payload.amount)); if (!(amount > 0)) refuse('amount required'); if (amount > BP.max) refuse(`the Bank lends at most ${BP.max} Health`, 'pact');
    if (openPacts(state, c).length >= BP.maxPacts) refuse(`${BP.maxPacts} pacts open already`, 'pact');
    const interest = pactInterest(state, ctx, c, h?.regionId ?? regionOf(state, c));
    const id = `pact${seq(state, 'pactSeq')}`;
    const pact = { id, charId: c.id, playerId: pid, principal: amount, interest, owed: Math.round(amount * (1 + interest)), paid: 0, turnsLeft: BP.dueTurns, status: 'open', takenAt: ctx.now, regionId: h?.regionId ?? null };
    state.pacts[id] = pact; (c.pactIds ||= []).push(id);
    health(state, c, amount, `Blood Pact ${id}`, ctx); counter(c, 'pactsTaken');          // credited up to max Health (health.js clamps to max on the next move anyway)
    note(state, `${c.name} signs a Blood Pact: ${amount} Health now, ${pact.owed} owed within ${BP.dueTurns} turns`, 'pact', ctx.now);
  },
  PACT_REPAY(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = whoFor(state, ctx); const c = need(state, pid);
    onTile(state, ctx, c, 'bloodbank');
    const pact = ctx.payload.pactId ? state.pacts[ctx.payload.pactId] : openPacts(state, c)[0];
    if (!pact || pact.owed <= 0 || pact.charId !== c.id) refuse('no open pact', 'pact');
    const want = ctx.payload.amount != null ? Math.round(Number(ctx.payload.amount)) : pact.owed; if (!(want > 0)) refuse('amount must be positive');
    const paid = Math.min(want, pact.owed);
    if (c.health - paid < 1) refuse('that would kill you', 'pact');
    health(state, c, -paid, `repay ${pact.id}`, ctx, { ignoreShield: true });
    pact.owed -= paid; pact.paid = (pact.paid || 0) + paid;
    if (pact.owed <= 0) { pact.status = 'paid'; pact.settledAt = ctx.now; c.pactIds = c.pactIds.filter(id => id !== pact.id); counter(c, 'pactRepaid'); }
    note(state, `${c.name} repays ${paid} Health${pact.owed ? ` (${pact.owed} still owed)` : '; the pact is torn up'}`, 'pact', ctx.now);
  },
  BANK_DEPOSIT(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = whoFor(state, ctx); const c = need(state, pid); onTile(state, ctx, c, 'bloodbank', 'bank');
    const amount = Math.round(Number(ctx.payload.amount)); if (!(amount > 0)) refuse('amount required'); if (!canPay(c, amount)) refuse('not enough Gold', 'gold');
    gold(state, c, -amount, 'deposit', ctx); bankGold(state, c, amount, 'deposit', ctx); counter(c, 'deposits');
    note(state, `${c.name} banks ${amount} Gold`, 'bank', ctx.now);
  },
  BANK_WITHDRAW(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = whoFor(state, ctx); const c = need(state, pid); onTile(state, ctx, c, 'bloodbank', 'bank');
    const amount = Math.round(Number(ctx.payload.amount)); if (!(amount > 0)) refuse('amount required'); if ((c.bank || 0) < amount) refuse('not that much in the Bank', 'gold');
    bankGold(state, c, -amount, 'withdraw', ctx); gold(state, c, amount, 'withdraw', ctx);
    note(state, `${c.name} withdraws ${amount} Gold`, 'bank', ctx.now);
  },
  AUCTION_OPEN(state, ev, ctx) {
    requirePhase(state, 'playing');
    if (state.auction && !state.auction.done) refuse('an auction is already open', 'auction');
    const A = ctx.B('auction');
    let lot, sellerId = null;
    if (ctx.payload.sellerId || !ctx.isGm) {
      sellerId = ctx.payload.sellerId || ctx.actor; requireActor(state, ctx, sellerId);
      const c = need(state, sellerId); onTile(state, ctx, c, 'arena');
      const item = c.items?.[ctx.payload.itemId]; if (!item) refuse('no such item', 'item'); if (isWorn(c, item.id)) refuse('unequip it first', 'item');
      removeItem(c, item.id); lot = { item };
    } else {
      requireGm(ctx); if (!ctx.payload.spec && !ctx.payload.item) refuse('spec or item required');
      lot = ctx.payload.item ? { item: ctx.payload.item } : { spec: ctx.payload.spec };
    }
    const minBid = Math.max(A.minBid, Math.round(Number(ctx.payload.minBid) || 0));
    const window = Number(ctx.payload.windowSeconds) > 0 ? Number(ctx.payload.windowSeconds) : A.windowSeconds;
    state.auction = { id: `auc${seq(state, 'auctionSeq')}`, sellerId, lot, minBid, openedAt: ctx.now, deadline: ctx.now + window * 1000, bids: {}, bidSeq: 0, done: false, result: null };
    note(state, `${sellerId ? state.players[sellerId]?.name : 'The house'} opens an auction: ${lot.item?.name || `a ${lot.spec?.rarity || ''} item`} (bids from ${minBid})`, 'auction', ctx.now);
  },
  AUCTION_BID(state, ev, ctx) {
    requirePhase(state, 'playing'); const a = state.auction; if (!a || a.done) refuse('no auction open', 'auction');
    const pid = whoFor(state, ctx); const c = need(state, pid);
    if (pid === a.sellerId) refuse('the seller cannot bid', 'auction');
    const amount = Math.round(Number(ctx.payload.amount)); if (!(amount >= a.minBid)) refuse(`bid at least ${a.minBid}`, 'auction'); if (!canPay(c, amount)) refuse('not enough Gold', 'gold');
    a.bids[pid] = { amount, seq: ++a.bidSeq, ts: ctx.now };
    note(state, `${c.name} seals a bid`, 'auction', ctx.now);
  },
  AUCTION_CLOSE(state, ev, ctx) {
    requireGm(ctx); const a = state.auction; if (!a || a.done) refuse('no auction open', 'auction');
    const A = ctx.B('auction');
    const win = auctionWinner(state);
    a.done = true; a.closedAt = ctx.now;
    if (!win) {
      a.result = { winnerId: null };
      if (a.sellerId) { const s = characterOf(state, a.sellerId); if (s) pushLoot(s, a.lot.item ? { item: a.lot.item } : a.lot.spec); }
      note(state, 'No bids; the lot goes back', 'auction', ctx.now); return;
    }
    const c = need(state, win.pid);
    gold(state, c, -win.amount, 'auction', ctx);
    if (a.sellerId) { const s = characterOf(state, a.sellerId); const net = Math.round(win.amount * (1 - A.houseCut)); if (s && net > 0) gold(state, s, net, 'auction proceeds', ctx); }
    pushLoot(c, a.lot.item ? { item: a.lot.item } : { ...structuredClone(a.lot.spec), auction: true }); counter(c, 'auctionsWon');
    a.result = { winnerId: win.pid, amount: win.amount, bids: Object.fromEntries(Object.entries(a.bids).map(([p, b]) => [p, b.amount])) };
    note(state, `SOLD to ${c.name} for ${win.amount} Gold`, 'auction', ctx.now);
  },
  TRADE_OFFER(state, ev, ctx) {
    requirePhase(state, 'playing');
    const fromId = ctx.payload.fromId || ctx.actor; requireActor(state, ctx, fromId); const a = need(state, fromId);
    const toId = ctx.payload.toId; requirePlayer(state, toId); const b = need(state, toId); if (toId === fromId) refuse('trade with someone else');
    const clean = (s = {}) => ({ gold: Math.max(0, Math.round(Number(s.gold) || 0)), itemIds: [...(s.itemIds || [])], petIds: [...(s.petIds || [])] });
    const give = clean(ctx.payload.give), want = clean(ctx.payload.want);
    if (!give.gold && !give.itemIds.length && !give.petIds.length && !want.gold && !want.itemIds.length && !want.petIds.length) refuse('an empty trade');
    if (!canPay(a, give.gold)) refuse('not enough Gold', 'gold');
    for (const id of give.itemIds) if (!a.items?.[id] || isWorn(a, id)) refuse(`you do not hold ${id} in your grid`, 'item');
    for (const id of give.petIds) if (!(a.pets || []).some(p => p.id === id)) refuse(`no pet ${id}`, 'pet');
    for (const id of want.itemIds) if (!b.items?.[id]) refuse(`${b.name} does not hold ${id}`, 'item');
    (state.trades ||= []).push({ id: `tr${seq(state, 'tradeSeq')}`, fromId, toId, give, want, status: 'offered', offeredAt: ctx.now });
    note(state, `${a.name} offers ${b.name} a trade`, 'trade', ctx.now);
  },
  TRADE_ANSWER(state, ev, ctx) {
    requirePhase(state, 'playing');
    const t = (state.trades || []).find(x => x.id === ctx.payload.tradeId); if (!t || t.status !== 'offered') refuse('no such open trade', 'trade');
    requireActor(state, ctx, t.toId);
    t.status = ctx.payload.accept === false ? 'declined' : 'accepted'; t.answeredAt = ctx.now;
    note(state, `${state.players[t.toId]?.name} ${t.status} the trade${t.status === 'accepted' ? ' (settles at the end of the turn)' : ''}`, 'trade', ctx.now);
  },
  BOUNTY_PLACE(state, ev, ctx) {
    requirePhase(state, 'playing'); const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const G = ctx.B('gold');
    const targetId = ctx.payload.targetId; requirePlayer(state, targetId); if (targetId === pid) refuse('not on yourself');
    if (!characterOf(state, targetId)) refuse('no such character');
    const amount = Math.round(Number(ctx.payload.gold)); if (!(amount >= G.bountyMin)) refuse(`a bounty is at least ${G.bountyMin} Gold`, 'gold');
    let byId = 'house';
    if (!ctx.isGm || state.players[pid]) { const c = characterOf(state, pid); if (c) { onTile(state, ctx, c, 'bounty'); if (!canPay(c, amount)) refuse('not enough Gold', 'gold'); gold(state, c, -amount, `bounty on ${state.players[targetId].name}`, ctx); byId = pid; } }
    state.bounties.push({ id: `b${seq(state, 'bountySeq')}`, targetId, byId, gold: amount, placedAt: ctx.now });
    note(state, `${byId === 'house' ? 'The house' : state.players[pid].name} posts ${amount} Gold on ${state.players[targetId].name}`, 'bounty', ctx.now);
  },
  GM_GOLD(state, ev, ctx) {
    requireGm(ctx); const c = resolveCharacter(state, ctx.payload.playerId || ctx.payload.charId); if (!c) refuse('no such character');
    let amount = Math.round(Number(ctx.payload.amount) || 0); if (amount < 0) amount = -Math.min(-amount, c.gold || 0);
    gold(state, c, amount, ctx.payload.why || 'GM', ctx); note(state, `GM ${amount >= 0 ? 'grants' : 'takes'} ${Math.abs(amount)} Gold ${amount >= 0 ? 'to' : 'from'} ${c.name}`, 'gm', ctx.now);
  },
  GM_HEALTH(state, ev, ctx) {
    requireGm(ctx); const c = resolveCharacter(state, ctx.payload.playerId || ctx.payload.charId); if (!c) refuse('no such character');
    const amount = Math.round(Number(ctx.payload.amount) || 0);
    health(state, c, amount, ctx.payload.why || 'GM', ctx, { ignoreShield: true, overheal: !!ctx.payload.overheal });
    note(state, `GM ${amount >= 0 ? 'heals' : 'wounds'} ${c.name} by ${Math.abs(amount)}`, 'gm', ctx.now);
    if (c.health <= 0 && !c.dead) killCharacter(state, ctx, c, { killerId: null, killerKind: 'gm' });
  },
  GM_ITEM(state, ev, ctx) {
    requireGm(ctx); const c = resolveCharacter(state, ctx.payload.playerId || ctx.payload.charId); if (!c) refuse('no such character');
    const rarity = RARITIES.includes(ctx.payload.rarity) ? ctx.payload.rarity : 'common';
    const spec = { baseId: ctx.payload.legendaryId || ctx.payload.baseId || 'loot', rarity: ctx.payload.legendaryId ? 'legendary' : rarity, region: ctx.payload.region ?? regionOf(state, c), seed: (Number(ctx.payload.seed) || ctx.now) >>> 0, gm: true };
    if (ctx.payload.slot) spec.slot = ctx.payload.slot;
    pushLoot(c, spec); note(state, `GM hands ${c.name} a ${rarity} ${spec.baseId}`, 'gm', ctx.now);
  },
  GM_TELEPORT(state, ev, ctx) {
    requireGm(ctx); const c = resolveCharacter(state, ctx.payload.playerId || ctx.payload.charId); if (!c) refuse('no such character');
    const h = state.map?.hexes?.[ctx.payload.hex]; if (!isLandable(h)) refuse('not a hex anyone can stand on', 'hex');
    c.prevPos = c.pos; c.pos = h.key; c.region = h.regionId; note(state, `GM moves ${c.name} to ${h.key}`, 'gm', ctx.now);
  },
  GM_MONSTER_MOVE(state, ev, ctx) {
    requireGm(ctx); const m = state.monsters[ctx.payload.monsterId]; if (!m || m.dead) refuse('no such monster', 'monster');
    const h = state.map?.hexes?.[ctx.payload.hex]; if (!h || h.void) refuse('no such hex', 'hex');
    if (h.monsterId && h.monsterId !== m.id && state.monsters[h.monsterId] && !state.monsters[h.monsterId].dead) refuse('a monster already stands there', 'hex');
    if (state.fight && state.fight.monsterId === m.id && !state.fight.done) refuse('it is in a fight', 'busy');
    const from = state.map.hexes[m.pos]; if (from && from.monsterId === m.id) from.monsterId = null;
    m.pos = h.key; m.regionId = h.regionId || m.regionId; h.monsterId = m.id;
    note(state, `GM moves ${m.name} to ${h.key}`, 'gm', ctx.now);
  },
  GM_SPAWN(state, ev, ctx) {
    requireGm(ctx); const h = state.map?.hexes?.[ctx.payload.hex]; if (!h || h.void) refuse('no such hex', 'hex');
    if (h.monsterId && state.monsters[h.monsterId] && !state.monsters[h.monsterId].dead) refuse('a monster already stands there', 'hex');
    const m = spawnMonster(state, ctx, ctx.payload.speciesId, h.key, { name: ctx.payload.name || null, gmControlled: !!ctx.payload.gmControlled });
    note(state, `GM spawns ${m.name} at ${h.key}`, 'gm', ctx.now);
  },
});
