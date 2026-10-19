// GM panel: Ledger & Recap. The metagame ledger (real buy-ins the GM types, placings, what was vaulted — a record,
// never a wallet), the Buy-in Wheel / flat start per player, the recap numbers and the Hall of Fame.
import { characterOf } from '../../../packages/shared/state.js';

export function panelLedger({ state, session, h, gm, main }) {
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked);
  const rows = seats.map(p => {
    const row = state.metaLedger.find(r => r.playerId === p.id) || {};
    const c = characterOf(state, p.id);
    const buy = h('input', { value: row.buyIn || '', placeholder: '$', style: { maxWidth: '100px' }, onChange: (e) => gm('META_LEDGER', { playerId: p.id, buyIn: e.target.value, notes: row.notes || '' }) });
    const notes = h('input', { value: row.notes || '', placeholder: 'notes', onChange: (e) => gm('META_LEDGER', { playerId: p.id, buyIn: buy.value, notes: e.target.value }) });
    return h('tr', {}, h('td', {}, h('b', {}, p.name), h('div', { class: 'muted' }, c ? `${c.name} · ${c.classId}` : '—')), h('td', {}, buy), h('td', {}, notes),
      h('td', {}, c ? `${c.health}/${c.maxHealth}` : '—', c && !c.buyinSpun && state.phase !== 'playing' ? h('span', { class: 'row', style: { marginTop: '4px' } }, h('button', { onClick: () => gm('BUYIN_SPIN', { playerId: p.id }) }, 'Spin buy-in'), h('button', { onClick: () => gm('BUYIN_FLAT', { playerId: p.id }) }, 'Flat start')) : null),
      h('td', {}, row.placing ?? (state.phase === 'ended' ? '—' : '')), h('td', { class: 'muted' }, (c?.vaulted || []).map(i => i.name).join(', ') || ''));
  });
  const stats = seats.map(p => ({ p, s: state.stats[p.id] || {} }));
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Metagame ledger'), h('p', { class: 'muted' }, 'One row per player per run. The buy-in is whatever you type; the app never holds or moves money and the figure has no effect in play. Season totals live in the backend.'),
      h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', {}, 'Buy-in'), h('th', {}, 'Notes'), h('th', {}, 'Health'), h('th', {}, 'Placing'), h('th', {}, 'Vaulted'))), h('tbody', {}, rows))),
    h('div', { class: 'panel' }, h('h2', {}, 'Recap'), h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, ['Player', 'Turns', 'Hits', 'Crits', 'Kills', 'Deaths', 'Dealt', 'Taken', 'Bosses', 'Pets', 'Gold earned', 'Challenges W/L'].map(x => h('th', {}, x)))),
      h('tbody', {}, stats.map(({ p, s }) => h('tr', {}, h('td', {}, p.name), ...[s.turns, s.hits, s.crits, s.kills, s.deaths, s.damageDealt, s.damageTaken, s.bosses, s.petsCaught, s.goldEarned].map(v => h('td', {}, v ?? 0)), h('td', {}, `${s.challengesWon ?? 0}/${s.challengesLost ?? 0}`))))),
      state.phase === 'ended' ? h('p', {}, h('b', {}, 'Result: '), state.endReason, state.winner ? ` — winner ${state.players[state.winner]?.name || state.winner}` : '') : null),
    hallOfFame({ session, h }));
}
function hallOfFame({ session, h }) {
  const box = h('div', { class: 'muted' }, 'Loading…');
  session.backend.hallOfFame.list().then(rows => { box.replaceChildren(rows.length ? h('ul', {}, rows.slice(0, 40).map(r => h('li', {}, `${new Date(r.createdAt || Date.now()).toLocaleDateString()} · ${r.kind} · ${r.title || r.summary || JSON.stringify(r).slice(0, 120)}`))) : 'Nothing yet. The first run writes the first row.'); }).catch(e => { box.textContent = e.message; });
  return h('div', { class: 'panel' }, h('h2', {}, 'Hall of Fame'), box);
}
