// Table business that is not tied to whose turn it is (SPEC.md › Social, Economy): a secret vote to cast, a trade to
// answer, a sealed auction to bid in. Every seated phone gets these at the top of the Play tab while they are open.
// The engine side is handlers/social.js (VOTE_*) and handlers/economy.js (TRADE_*, AUCTION_*).
import { voteView } from '../../../packages/shared/handlers/social.js';
import { amountPicker, nameOf, redraw } from './prompts.js';
import { group } from '../../../packages/shared/balance.js';
import { unlocked } from '../../../packages/shared/handlers/ramp.js';
import { reviveOptions } from '../../../packages/shared/handlers/revive.js';

const itemName = (state, ownerId, id) => { const c = Object.values(state.characters).find(x => x.playerId === ownerId); return c?.items?.[id]?.name || 'an item'; };
const petName = (state, ownerId, id) => { const c = Object.values(state.characters).find(x => x.playerId === ownerId); return (c?.pets || []).find(p => p.id === id)?.name || 'a pet'; };
// "12 Gold, Coin Blade and Pip the Rat" — one side of a trade in words.
export function tradeSide(state, ownerId, s) {
  const parts = []; if (s?.gold) parts.push(`${s.gold} Gold`);
  for (const id of s?.itemIds || []) parts.push(itemName(state, ownerId, id));
  for (const id of s?.petIds || []) parts.push(petName(state, ownerId, id));
  return parts.length ? parts.join(', ') : 'nothing';
}
// Pure: what this phone has to deal with right now.
export function tableBusiness(state, me) {
  const out = { vote: null, incoming: [], outgoing: [], auction: null };
  if (state.phase !== 'playing') return out;
  const v = voteView(state, me); if (v && !state.votes.closed) out.vote = v;
  for (const t of state.trades || []) {
    if (t.status === 'offered' && t.toId === me) out.incoming.push(t);
    else if (t.fromId === me && (t.status === 'offered' || t.status === 'accepted')) out.outgoing.push(t);
  }
  const a = state.auction; if (a && !a.done && unlocked(state, me, 'social')) out.auction = a;   // not during a player's tutorial turns
  return out;
}

export function tablePanels(api) {
  const { state, me, c, h, dispatch } = api; const biz = tableBusiness(state, me); const out = [];
  if (biz.vote) {
    const v = biz.vote, box = h('section', { class: 'ph-sect table-biz vote' }, h('h3', {}, v.kind === 'table' ? 'Table vote' : 'Chaos vote'), h('p', {}, v.question));
    if (v.canVote === false && v.myChoice == null) box.append(h('p', { class: 'muted ital' }, 'You are not voting in this one.'));
    else {
      box.append(h('div', { class: 'chips' }, v.options.map(o => h('button', { class: `chip${v.myChoice === o ? ' on' : ''}`, onClick: () => dispatch('VOTE_CAST', { choice: o }) }, state.players[o]?.name || o))));
      box.append(h('p', { class: 'muted small' }, v.myChoice != null ? `Your ballot is in (${state.players[v.myChoice]?.name || v.myChoice}); tap another name to change it. Secret until it closes.` : 'Secret ballot: nobody sees who you picked.'), h('p', { class: 'muted small' }, `${v.cast} of ${v.eligible} ballots in.`));
    }
    out.push(box);
  }
  for (const t of biz.incoming) {
    out.push(h('section', { class: 'ph-sect table-biz trade' }, h('h3', {}, `Trade from ${nameOf(state, t.fromId)}`),
      h('p', {}, h('b', {}, 'You get: '), tradeSide(state, t.fromId, t.give)), h('p', {}, h('b', {}, 'You give: '), tradeSide(state, t.toId, t.want)),
      h('div', { class: 'row' }, h('button', { class: 'primary', onClick: () => dispatch('TRADE_ANSWER', { tradeId: t.id, accept: true }) }, 'Accept'), h('button', { class: 'ghost', onClick: () => dispatch('TRADE_ANSWER', { tradeId: t.id, accept: false }) }, 'Decline')),
      h('p', { class: 'muted small' }, 'An accepted trade settles at the next end of turn; it fails if either side no longer has what was promised.')));
  }
  for (const t of biz.outgoing) out.push(h('section', { class: 'ph-sect table-biz trade' }, h('p', { class: 'muted' }, t.status === 'accepted' ? `${nameOf(state, t.toId)} accepted your trade: it settles at the next end of turn.` : `Your trade offer to ${nameOf(state, t.toId)} (${tradeSide(state, t.fromId, t.give)} for ${tradeSide(state, t.toId, t.want)}) is waiting for an answer.`)));
  if (biz.auction && c && !c.dead) {
    const a = biz.auction, lot = a.lot?.item, lotName = lot?.name || `a ${a.lot?.spec?.rarity || ''} item`.replace('  ', ' ');
    const box = h('section', { class: 'ph-sect table-biz auction' }, h('h3', {}, 'Sealed auction'), h('p', {}, `${a.sellerId ? nameOf(state, a.sellerId) : 'The house'} is selling ${lotName}. Bids are secret; the highest wins when it closes.`));
    if (a.sellerId === me) box.append(h('p', { class: 'muted ital' }, `Your lot. ${Object.keys(a.bids || {}).length} sealed bid(s) so far.`));
    else {
      const mine = a.bids?.[me]?.amount, gold = c.gold || 0;
      const amt = amountPicker({ value: Math.max(a.minBid, Math.min(gold, mine || a.minBid)), min: a.minBid, max: Math.max(a.minBid, gold), step: 5, label: `Your bid in Gold (you hold ${gold}; minimum ${a.minBid})` });
      box.append(amt, h('button', { class: 'primary big', disabled: gold < a.minBid, onClick: () => dispatch('AUCTION_BID', { amount: amt.value() }) }, mine ? `Change bid (now ${mine})` : 'Seal a bid'));
      if (gold < a.minBid) box.append(h('p', { class: 'muted ital' }, 'Not enough Gold for the minimum bid.'));
    }
    out.push(box);
  }
  return out;
}

// The once-a-night table vote ("who goes to the Graveyard?"): any seated player may call it on their own turn. Two taps.
let armed = 0;
export function tableVoteCall(api) {
  const { state, me, h, dispatch } = api; const S = group(state, 'social');
  if ((state.tableVotesUsed || 0) >= S.tableVotesPerNight || (state.votes && !state.votes.closed)) return null;
  const alive = state.seats.filter(id => { const ch = Object.values(state.characters).find(x => x.playerId === id); return ch && !ch.dead; });
  if (alive.length < 3) return null;   // with two players it is just a murder button
  const hot = Date.now() - armed < 6000;
  return h('section', { class: 'ph-sect table-biz' }, h('button', { class: hot ? 'danger' : 'ghost', onClick: () => { if (hot) { armed = 0; dispatch('VOTE_OPEN', { kind: 'table' }); } else { armed = Date.now(); redraw(api); } } }, hot ? 'Really call it: the table votes someone into the Graveyard' : `Call the table vote (${S.tableVotesPerNight - (state.tableVotesUsed || 0)} left tonight)`),
    h('p', { class: 'muted small' }, `Everyone votes in secret for ${S.voteSeconds} seconds; the name with the most ballots dies.`));
}

// Bring a dead player back early: for Gold at a Shop, or with a Phoenix Feather at their Graveyard (PvE-only, Teams).
export function revivePanel(api) {
  const { state, me, h, dispatch } = api; const opts = reviveOptions(state, me); if (!opts.length) return null;
  return h('section', { class: 'ph-sect table-biz revive' }, h('h3', {}, 'The dead'),
    opts.map(o => h('button', { class: 'big', disabled: !!o.why, title: o.why || '', onClick: () => dispatch('REVIVE', { targetId: o.targetId, how: o.how }) }, o.how === 'shop' ? `Buy ${o.name} back (${o.price} Gold)` : `🪶 Burn a Phoenix Feather for ${o.name}`)),
    opts.some(o => o.why) ? h('p', { class: 'muted ital' }, opts.find(o => o.why).why) : null,
    h('p', { class: 'muted small' }, 'They wake at their Graveyard now instead of missing turns. Grit makes the Shop price cheaper.'));
}
