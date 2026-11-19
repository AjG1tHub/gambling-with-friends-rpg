// GM panel: the run. Event log, restore points and undo, pause, end.
export function panelRun({ state, h, gm, main }) {
  const label = h('input', { placeholder: 'Restore point label' });
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Run'), h('div', { class: 'gm-bar' },
      h('button', { onClick: () => { gm('GM_RESTORE_POINT', { label: label.value || undefined }); label.value = ''; } }, 'Save restore point'), label,
      h('button', { class: 'danger', onClick: () => { if (state.restorePoints.length && confirm('Undo to the last restore point?')) gm('GM_UNDO', {}); } }, 'Undo to last point'))),
    tableEvents({ state, h, gm }),
    h('div', { class: 'panel' }, h('h3', {}, 'Restore points'), state.restorePoints.length ? h('div', { class: 'list' }, [...state.restorePoints].reverse().map(r => h('div', { class: 'item' }, h('span', { class: 'grow' }, r.label, h('span', { class: 'muted' }, ` · ${new Date(r.ts).toLocaleTimeString()}`)), h('button', { onClick: () => { if (confirm(`Restore "${r.label}"?`)) gm('GM_UNDO', { restoreId: r.id }); } }, 'Restore')))) : h('p', { class: 'muted' }, 'None yet. Save one before anything risky.')),
    h('div', { class: 'panel' }, h('h3', {}, 'Log'), h('div', { class: 'log log-box' }, [...state.log].reverse().slice(0, 120).map(l => h('div', { class: l.kind }, h('span', { class: 'mono muted' }, new Date(l.ts).toLocaleTimeString() + ' '), l.text)))));
}

// Votes, auctions and trades: the GM opens the first two and sees every trade (SPEC.md › Economy, PvP and social).
function tableEvents({ state, h, gm }) {
  const name = (id) => state.players[id]?.name || id;
  const v = state.votes && !state.votes.closed ? state.votes : null, a = state.auction && !state.auction.done ? state.auction : null;
  const side = (owner, s) => { const c = Object.values(state.characters).find(x => x.playerId === owner); const parts = []; if (s?.gold) parts.push(`${s.gold} Gold`); for (const id of s?.itemIds || []) parts.push(c?.items?.[id]?.name || 'an item'); for (const id of s?.petIds || []) parts.push((c?.pets || []).find(p => p.id === id)?.name || 'a pet'); return parts.join(', ') || 'nothing'; };
  const trades = (state.trades || []).slice(-8).reverse();
  const playing = state.phase === 'playing';
  return h('div', { class: 'panel' }, h('h3', {}, 'Votes, auctions, trades'),
    h('div', { class: 'gm-bar' },
      h('button', { disabled: !playing || !!v, onClick: () => gm('VOTE_OPEN', { kind: 'chaos', options: state.seats.filter(id => { const c = Object.values(state.characters).find(x => x.playerId === id); return c && !c.dead; }) }) }, 'Chaos vote: who does Chaos visit?'),
      h('button', { disabled: !playing || !!v, onClick: () => gm('VOTE_OPEN', { kind: 'table' }) }, 'Table vote: who goes to the Graveyard?'),
      v ? h('button', { onClick: () => gm('VOTE_CLOSE', {}) }, `Close the vote now (${Object.keys(v.ballots).length}/${v.eligible.length} in)`) : null),
    h('div', { class: 'gm-bar' },
      ['rare', 'epic', 'legendary'].map(r => h('button', { disabled: !playing || !!a, onClick: () => gm('AUCTION_OPEN', { spec: { rarity: r } }) }, `House auction: a ${r} item`)),
      a ? h('button', { onClick: () => gm('AUCTION_CLOSE', {}) }, `Close the auction now (${Object.keys(a.bids).length} bid(s))`) : null),
    a ? h('p', { class: 'muted' }, `Open: ${a.sellerId ? name(a.sellerId) : 'the house'} sells ${a.lot?.item?.name || `a ${a.lot?.spec?.rarity} item`}; bids: ${Object.entries(a.bids).map(([p, b]) => `${name(p)} ${b.amount}`).join(', ') || 'none yet'} (only you see these).`) : null,
    trades.length ? h('div', { class: 'list' }, trades.map(t => h('div', { class: 'item' }, h('span', { class: 'grow' }, `${name(t.fromId)} → ${name(t.toId)}: ${side(t.fromId, t.give)} for ${side(t.toId, t.want)}`), h('span', { class: 'pill' }, t.status)))) : h('p', { class: 'muted ital' }, 'No trades yet.'));
}
