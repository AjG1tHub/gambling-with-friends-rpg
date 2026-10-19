// Ledger tools (Phase 6/7): search / filter the event log, export it as CSV, and rebuild each
// player's Gold over time for the recap chart. Pure functions over state.ledger.
export const GROUPS = {
  Money:  ['CREDIT', 'DEBIT', 'TRANSFER', 'LOAN', 'LOAN_REPAY', 'LOAN_PAID', 'LOAN_DEFAULT', 'LOAN_GARNISH', 'BUY_IN', 'AUCTION', 'AUCTION_START', 'AUCTION_END', 'SHOP_EXCHANGE'],
  Games:  ['GAME', 'GAME_START', 'ODDS'],
  Wheels: ['WHEEL_SPIN', 'JAIL_SPIN', 'VOID_TRIGGER', 'CHAOS', 'CHAOS_UNDO', 'RETCON'],
  Jail:   ['JAIL_IN', 'JAIL_OUT', 'JAIL_ESCALATE', 'JAIL_TIER_DOWN', 'JAIL_BUYOUT', 'JAIL_SWAP', 'PARDON_USED'],
  Battles: ['BATTLE', 'CONTEST', 'PET_BATTLE', 'PET_BATTLE_START', 'RAID_START', 'RAID_END'],
  Pets:   ['POWER', 'RANK_UP', 'PET_HATCH', 'PET_LEVEL', 'PET_EVOLVE', 'PET_CAPTURE', 'PET_RELEASE', 'PET_ITEM', 'SHOP_BUY_PET'],
  Table:  ['SESSION_START', 'SESSION_END', 'TURN_END', 'MOVE', 'TILE', 'PLAYER_JOIN', 'PLAYER_BENCH', 'PLAYER_RETURN', 'TURN_ORDER', 'STAKE', 'STAKE_SETTLED', 'STAKE_REOPENED', 'SHOP_BUY_POWERUP', 'POWERUP_USED', 'NOTE', 'SOUND_TEST'],
};
export const groupOf = (type) => Object.keys(GROUPS).find(g => GROUPS[g].includes(type)) || 'Other';

// opts: { playerId, group, types, text } — all optional, all must match.
export function filterLedger(state, opts = {}) {
  const text = String(opts.text || '').trim().toLowerCase();
  const types = opts.types && opts.types.length ? new Set(opts.types) : opts.group && opts.group !== 'All' ? new Set(GROUPS[opts.group] || []) : null;
  const name = (id) => state.players.find(p => p.id === id)?.name || '';
  return state.ledger.filter(r => {
    if (opts.playerId && r.playerId !== opts.playerId && r.toId !== opts.playerId && r.buyer !== opts.playerId) return false;
    if (opts.group === 'Other' ? groupOf(r.type) !== 'Other' : (types && !types.has(r.type))) return false;
    if (text && !(`${r.type} ${name(r.playerId)} ${describeRow(state, r)}`.toLowerCase().includes(text))) return false;
    return true;
  });
}

// A short human sentence for one row.
export function describeRow(state, r) {
  const name = (id) => state.players.find(p => p.id === id)?.name || '?';
  switch (r.type) {
    case 'CREDIT': case 'DEBIT': return `${r.amount > 0 ? '+' : ''}${r.amount} ${r.cur} — ${r.why || ''}`;
    case 'GAME': return 'won' in r ? `${r.gameId}: ${r.won ? 'won' : r.mult < 1 ? 'lost' : 'push'} at ${r.mult}×${r.label ? ` (${r.label})` : ''}` : `landed on tile ${r.tile}`;
    case 'GAME_START': return `${r.gameId} — wagers ${(r.wagers || []).map(w => `${w.amount} ${w.cur}`).join(' + ')}`;
    case 'WHEEL_SPIN': return `${r.wheel} wheel → ${r.outcome}${r.forced ? ' (forced)' : ''}`;
    case 'JAIL_IN': return `jailed — ${r.why || ''}`;
    case 'JAIL_OUT': return `released — ${r.why || ''}`;
    case 'JAIL_BUYOUT': return `bought out of Jail ${r.tier} for ${r.fee}`;
    case 'TRANSFER': return `${r.amount} ${r.cur} → ${name(r.toId)} (${r.why || ''})`;
    case 'BATTLE': return r.won ? `won the battle${r.forfeitBy ? ` (${name(r.forfeitBy)} refused)` : ''}` : `battle vs ${name(r.vs)}: ${r.contest}`;
    case 'LOAN': return `borrowed ${r.principal} from ${r.lender === 'house' ? 'the house' : name(r.lender)}, owes ${r.owed}`;
    case 'PET_BATTLE': return `${r.winner} beat ${r.loser} (${r.kind}, ${r.rounds} rounds)`;
    case 'POWER': return `${r.amount > 0 ? '+' : ''}${r.amount} ⚡ — ${r.why || ''}`;
    case 'TURN_END': return `turn ${r.next} begins`;
    case 'CHAOS': return `tier ${r.tier} ${r.label}${r.loud ? '' : ' (silent)'}`;
    default: { const { ts, type, playerId, n, ...rest } = r; const s = JSON.stringify(rest); return s === '{}' ? '' : s.length > 120 ? s.slice(0, 117) + '…' : s; }
  }
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(state, rows = state.ledger) {
  const name = (id) => state.players.find(p => p.id === id)?.name || '';
  const head = ['n', 'time', 'type', 'player', 'currency', 'amount', 'summary', 'data'];
  const lines = rows.map(r => { const { ts, type, playerId, n, ...rest } = r; return [n ?? '', new Date(ts).toISOString(), type, name(playerId), r.cur ?? '', r.amount ?? '', describeRow(state, r), JSON.stringify(rest)].map(csvCell).join(','); });
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

// Gold after each Gold movement, oldest first: [{ n, ts, gold }]. Rebuilt backwards from today's balance.
export function goldTimeline(state, playerId) {
  const p = state.players.find(x => x.id === playerId); if (!p) return [];
  const moves = state.ledger.filter(r => r.playerId === playerId && r.cur === 'Gold' && (r.type === 'CREDIT' || r.type === 'DEBIT'));
  let g = p.balances.Gold || 0; const out = [];
  for (let i = moves.length - 1; i >= 0; i--) { out.push({ n: moves[i].n ?? i, ts: moves[i].ts, gold: g }); g -= moves[i].amount; }
  out.push({ n: 0, ts: state.createdAt || (moves[0]?.ts ?? 0), gold: g });
  return out.reverse();
}

// Bright line colours for the chart's fixed dark background (CHART_BG) — the same on every theme.
export const CHART_BG = '#15171c';
export const CHART_COLORS = ['#ff6b6b', '#4a9eff', '#7ddb8a', '#e9c46a', '#b98bff', '#ff8a3d', '#5ce1e6', '#ff6bb5'];
// One SVG chart of everyone's Gold across the session (x = ledger sequence, y = Gold).
export function goldChartSvg(state, { width = 640, height = 180, colors = CHART_COLORS } = {}) {
  const series = state.players.map(p => ({ name: p.name, pts: goldTimeline(state, p.id) })).filter(s => s.pts.length > 1);
  if (!series.length) return '';
  const all = series.flatMap(s => s.pts); const maxN = Math.max(...all.map(p => p.n), 1);
  const lo = Math.min(0, ...all.map(p => p.gold)), hi = Math.max(1, ...all.map(p => p.gold));
  const pad = 6, X = (n) => pad + n / maxN * (width - pad * 2), Y = (g) => height - pad - (g - lo) / (hi - lo || 1) * (height - pad * 2);
  const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = series.map((s, i) => {
    // step line: Gold holds until the next movement
    let d = ''; s.pts.forEach((p, k) => { d += k === 0 ? `M${X(p.n).toFixed(1)},${Y(p.gold).toFixed(1)}` : `H${X(p.n).toFixed(1)}V${Y(p.gold).toFixed(1)}`; }); d += `H${X(maxN).toFixed(1)}`;
    return `<path d="${d}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2.5" stroke-linejoin="round"><title>${esc(s.name)}</title></path>`;
  }).join('');
  const zero = lo < 0 ? `<line x1="${pad}" x2="${width - pad}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#888" stroke-dasharray="4 4" stroke-width="1"/>` : '';
  const legend = series.map((s, i) => `<span class="chart-key"><i style="background:${colors[i % colors.length]}"></i>${esc(s.name)}</span>`).join('');
  return `<div class="gold-chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Gold over the session">${zero}${lines}</svg><div class="chart-legend">${legend}<span class="subtle">Gold over the session · high ${Math.round(hi).toLocaleString('en-US')} · low ${Math.round(lo).toLocaleString('en-US')}</span></div></div>`;
}
