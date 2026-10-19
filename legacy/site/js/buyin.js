// Buy-in mechanics (§8). The Buy-In Wheel picks HOW a player pays; this applies it so the GM
// only supplies the one number the table has to agree on (the fee). Each wheel row may carry
// `mech` (the mechanic id) and params; rows without one are matched by label.
//   flat      pay the fee                         tithe     pay pct% of current Gold (default 10)
//   charity   the richest other player pays it    work      skip your next turn instead of paying
//   sacrifice hand over your most valuable secondary stack
//   double    pay 2× the fee, next game win pays 2×
//   auction / loan → open the Auction / Loan Shark panel (they have their own rules)
// opts.grant = Gold handed to the player as their new stake (the "buy back in" itself), if the table uses one.
import { log, credit, bal, richest } from './state.js';

const BY_LABEL = [[/flat/i, 'flat'], [/tithe|percent/i, 'tithe'], [/auction/i, 'auction'], [/loan/i, 'loan'], [/charity/i, 'charity'], [/work/i, 'work'], [/sacrifice/i, 'sacrifice'], [/double/i, 'double']];
export function buyInMech(row) {
  if (!row) return null;
  if (row.mech) return row.mech;
  const hit = BY_LABEL.find(([re]) => re.test(String(row.label || '')));
  return hit ? hit[1] : null;
}
export const needsFee = (mech) => ['flat', 'charity', 'double'].includes(mech);
function topSecondary(config, player) {
  const rates = Object.fromEntries(config.Currencies.map(c => [c.name, Number(c.goldRate) || 0]));
  let best = null, bestV = -1;
  for (const [cur, amt] of Object.entries(player.balances)) { if (cur === 'Gold' || !(amt > 0)) continue; const v = amt * (rates[cur] ?? 0); if (v > bestV) { bestV = v; best = cur; } }
  return best ? { cur: best, amount: player.balances[best], value: Math.round(bestV) } : null;
}

// What the mechanic would cost right now — shown to the GM before applying.
export function previewBuyIn(config, state, player, row, fee = 0) {
  const mech = buyInMech(row); fee = Math.max(0, Math.round(Number(fee) || 0));
  switch (mech) {
    case 'flat': return `${player.name} pays ${fee} Gold.`;
    case 'tithe': { const pct = Number(row.params?.pct ?? 10); return `${player.name} pays ${Math.max(0, Math.round(bal(player, 'Gold') * pct / 100))} Gold (${pct}% of ${bal(player, 'Gold')}).`; }
    case 'charity': { const r = richest(config, state, player.id); return r ? `${r.name} (richest) pays ${fee} Gold for ${player.name}.` : 'No one else is at the table.'; }
    case 'work': return `${player.name} skips their next turn instead of paying.`;
    case 'sacrifice': { const t = topSecondary(config, player); return t ? `${player.name} hands over ${t.amount} ${t.cur} (worth ~${t.value} Gold).` : `${player.name} holds no secondaries — pick another mechanic.`; }
    case 'double': return `${player.name} pays ${fee * 2} Gold and their next game win pays 2×.`;
    case 'auction': return `${player.name}'s secondaries go to auction.`;
    case 'loan': return `${player.name} borrows from the Loan Shark.`;
    default: return 'GM adjudicates this one.';
  }
}

export function applyBuyIn(config, state, player, row, opts = {}) {
  const mech = buyInMech(row); const fee = Math.round(Number(opts.fee) || 0), grant = Math.max(0, Math.round(Number(opts.grant) || 0));
  if (!mech) return { error: true, text: `No rule for "${row?.label || '?'}" — GM adjudicates.`, adjudicate: true };
  if (needsFee(mech) && !(fee > 0)) return { error: true, text: 'Enter the fee the table agreed on.' };
  let text, extra = {};
  switch (mech) {
    case 'flat': credit(state, player, 'Gold', -fee, 'Buy-in: flat fee'); text = `${player.name} pays the ${fee} Gold buy-in.`; break;
    case 'tithe': { const pct = Number(row.params?.pct ?? 10); const amt = Math.max(0, Math.round(bal(player, 'Gold') * pct / 100)); if (amt) credit(state, player, 'Gold', -amt, `Buy-in: ${pct}% tithe`); text = `${player.name} tithes ${amt} Gold (${pct}%).`; break; }
    case 'charity': { const r = richest(config, state, player.id); if (!r) return { error: true, text: 'No one else is at the table.' }; credit(state, r, 'Gold', -fee, `Buy-in charity for ${player.name}`); text = `${r.name} pays ${player.name}'s ${fee} Gold buy-in. They will remember.`; extra.payerId = r.id; break; }
    case 'work': player.skipTurns += 1; text = `${player.name} takes Work Release: skips their next turn.`; break;
    case 'sacrifice': { const t = topSecondary(config, player); if (!t) return { error: true, text: `${player.name} holds no secondaries — pick another mechanic.` }; credit(state, player, t.cur, -t.amount, 'Buy-in: secondary sacrifice'); text = `${player.name} sacrifices ${t.amount} ${t.cur}.`; extra.sacrificed = t; break; }
    case 'double': credit(state, player, 'Gold', -fee * 2, 'Buy-in: double down'); player.winMult = { mult: 2 }; text = `${player.name} doubles down: pays ${fee * 2} Gold, next game win pays 2×.`; break;
    case 'auction': extra.openAuction = true; text = `${player.name}'s secondaries go to auction.`; break;
    case 'loan': extra.openLoans = true; text = `${player.name} visits the Loan Shark.`; break;
    default: return { error: true, text: 'GM adjudicates this one.', adjudicate: true };
  }
  if (grant) { credit(state, player, 'Gold', grant, 'Buy-in stake'); text += ` New stake: +${grant} Gold.`; }
  log(state, 'BUY_IN', player.id, { mech, fee: needsFee(mech) ? fee : 0, grant, label: row.label });
  return { text, mech, ...extra };
}
