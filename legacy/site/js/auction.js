// Live auction (§8 Buy-Ins). A player's secondary currencies go under the hammer for Gold.
// Default = one lot per currency (Config.AuctionDefaultLots = PER_CURRENCY); BUNDLE sells the lot.
// Flow: start → players shout bids, GM taps them in → "Going once / twice / SOLD" → next lot.
// state.auction = { id, sellerId, lots[], lotIdx, phase, log[] }; lot = { items[{cur, amount}], refValue, high, calls, status }
import { log, credit, bal } from './state.js';

export const AUCTION_DEFAULTS = { minIncrement: 10, openingPct: 0.25, callsToSell: 3 };
export const auctionRules = (config) => ({ ...AUCTION_DEFAULTS, ...(config?.Auction || {}) });
const rate = (config, cur) => Number(config.Currencies.find(c => c.name === cur)?.goldRate) || 0;
export const currentLot = (a) => (a && a.phase === 'open' ? a.lots[a.lotIdx] : null);
const say = (a, text) => { a.log.push(text); if (a.log.length > 30) a.log.shift(); };

// opts: { mode: 'PER_CURRENCY' | 'BUNDLE', currencies: [names] (default: everything the seller holds) }
export function startAuction(config, state, sellerId, opts = {}) {
  if (state.auction && state.auction.phase === 'open') return { error: true, text: 'An auction is already running.' };
  const seller = state.players.find(p => p.id === sellerId); if (!seller) return { error: true, text: 'Pick a seller.' };
  if (state.players.length < 2) return { error: true, text: 'An auction needs someone to bid.' };
  const mode = opts.mode || config.Config.AuctionDefaultLots || 'PER_CURRENCY';
  const held = Object.entries(seller.balances).filter(([cur, amt]) => cur !== 'Gold' && amt > 0 && (!opts.currencies || opts.currencies.includes(cur)))
    .map(([cur, amount]) => ({ cur, amount })).sort((a, b) => b.amount * rate(config, b.cur) - a.amount * rate(config, a.cur));
  if (!held.length) return { error: true, text: `${seller.name} has no secondary currencies to auction.` };
  const R = auctionRules(config);
  const mkLot = (items) => { const refValue = Math.round(items.reduce((s, it) => s + it.amount * rate(config, it.cur), 0)); return { items, refValue, opening: Math.max(1, Math.round(refValue * R.openingPct)), high: null, calls: 0, status: 'open' }; };
  const lots = mode === 'BUNDLE' ? [mkLot(held)] : held.map(it => mkLot([it]));
  state.auctionSeq = (state.auctionSeq || 0) + 1;
  state.auction = { id: 'auc' + state.auctionSeq, sellerId: seller.id, sellerName: seller.name, mode, lots, lotIdx: 0, phase: 'open', log: [], ts: Date.now() };
  say(state.auction, `${seller.name}'s ${lots.length} lot${lots.length === 1 ? '' : 's'} go under the hammer.`);
  log(state, 'AUCTION_START', seller.id, { auctionId: state.auction.id, lots: lots.length, mode });
  return { auction: state.auction, text: state.auction.log[0] };
}

export const lotLabel = (lot) => lot.items.map(it => `${it.amount} ${it.cur}`).join(' + ');
export function minBid(config, lot) { const R = auctionRules(config); return lot.high ? lot.high.amount + R.minIncrement : lot.opening; }

export function placeBid(config, state, playerId, amount) {
  const a = state.auction, lot = currentLot(a); if (!lot) return { error: true, text: 'No lot is open.' };
  const p = state.players.find(x => x.id === playerId); if (!p) return { error: true, text: 'No such bidder.' };
  if (p.id === a.sellerId) return { error: true, text: 'The seller cannot bid on their own lot.' };
  amount = Math.round(Number(amount));
  const need = minBid(config, lot);
  if (!(amount >= need)) return { error: true, text: `The bid must be at least ${need} Gold.` };
  lot.high = { playerId: p.id, name: p.name, amount }; lot.calls = 0;        // a new bid resets the count
  say(a, `${p.name} bids ${amount}.`);
  return { text: `${p.name} bids ${amount} Gold for ${lotLabel(lot)}.` };
}

// "Going once… going twice… SOLD." With no bids the third call passes the lot (the seller keeps it).
export function callLot(config, state) {
  const a = state.auction, lot = currentLot(a); if (!lot) return { error: true, text: 'No lot is open.' };
  const R = auctionRules(config);
  lot.calls += 1;
  if (lot.calls < R.callsToSell) { const t = lot.calls === 1 ? 'Going once…' : 'Going twice…'; say(a, t); return { text: t }; }
  return closeLot(config, state, a, lot);
}
// Skip straight to the end of the current lot without the countdown (GM discretion).
export function passLot(config, state) { const a = state.auction, lot = currentLot(a); if (!lot) return { error: true, text: 'No lot is open.' }; lot.high = null; return closeLot(config, state, a, lot); }

function closeLot(config, state, a, lot) {
  const seller = state.players.find(p => p.id === a.sellerId); let text;
  if (lot.high && seller) {
    const buyer = state.players.find(p => p.id === lot.high.playerId);
    for (const it of lot.items) {
      const amount = Math.min(it.amount, bal(seller, it.cur));               // never sell more than is still held
      credit(state, seller, it.cur, -amount, 'Auction lot sold'); credit(state, buyer, it.cur, amount, 'Auction lot won');
    }
    credit(state, buyer, 'Gold', -lot.high.amount, 'Auction payment'); credit(state, seller, 'Gold', lot.high.amount, 'Auction proceeds');
    lot.status = 'sold';
    log(state, 'AUCTION', seller.id, { buyer: buyer.id, lot: lot.items, price: lot.high.amount, refValue: lot.refValue });
    text = `SOLD — ${lotLabel(lot)} to ${buyer.name} for ${lot.high.amount} Gold.`;
  } else { lot.status = 'passed'; text = `No bids — ${lotLabel(lot)} stays with ${a.sellerName}.`; }
  say(a, text);
  a.lotIdx += 1;
  if (a.lotIdx >= a.lots.length) {
    a.phase = 'done';
    const sold = a.lots.filter(l => l.status === 'sold'), total = sold.reduce((s, l) => s + l.high.amount, 0);
    a.summary = `${sold.length} of ${a.lots.length} lots sold for ${total} Gold.`; say(a, a.summary);
    log(state, 'AUCTION_END', a.sellerId, { auctionId: a.id, sold: sold.length, total });
    return { text, finished: true, summary: a.summary };
  }
  return { text };
}

export function endAuction(state) { const had = !!state.auction; state.auction = null; return had; }
