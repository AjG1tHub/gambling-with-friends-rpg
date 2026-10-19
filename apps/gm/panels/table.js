// GM panel: the table. Players (connection, ready, proxy, autopilot, kick, reassign roster), teams, phase controls.
import { fmtTime } from '../../../packages/ui/dom.js';
import { remainingMs } from '../../../packages/shared/clock.js';
import { currentPlayerId, characterOf } from '../../../packages/shared/state.js';

export function panelTable({ state, session, h, gm, main }) {
  const seats = state.seats.map(id => state.players[id]).filter(Boolean);
  const specs = Object.values(state.players).filter(p => p.spectator && !p.kicked);
  const cur = currentPlayerId(state);
  const bar = h('div', { class: 'gm-bar' },
    state.phase === 'lobby' ? h('button', { class: 'primary', onClick: () => gm('CREATION_OPEN', {}) }, 'Open character creation') : null,
    (state.phase === 'lobby' || state.phase === 'creation') ? h('button', { class: 'primary', onClick: () => confirmStart(seats, gm) }, 'Start the run') : null,
    state.phase === 'playing' ? h('button', { class: state.gm.paused ? 'primary' : '', onClick: () => gm(state.gm.paused ? 'GM_RESUME' : 'GM_PAUSE', {}) }, state.gm.paused ? '▶ Resume' : '⏸ Pause') : null,
    state.phase === 'playing' ? h('button', { onClick: () => gm('TURN_END', {}) }, 'End current turn') : null,
    state.phase === 'playing' ? h('button', { class: 'danger', onClick: () => { if (confirm('End the run now?')) gm('GM_END_RUN', { reason: 'the GM called it' }); } }, 'End run') : null);
  const rows = seats.map(p => {
    const c = characterOf(state, p.id);
    const seen = Math.max(session.presence[p.id] || 0, p.lastSeenTs || 0);
    return h('tr', { style: p.id === cur ? { background: 'rgba(201,164,92,.08)' } : null },
      h('td', {}, h('b', {}, p.name), p.id === cur ? h('span', { class: 'pill gold', style: { marginLeft: '6px' } }, 'to move') : null, h('div', { class: 'muted' }, c ? `${c.name} · ${c.classId} · Lv ${c.level} · ${c.health}/${c.maxHealth} HP · ${c.gold} G` : (p.ready ? 'ready' : 'no character'))),
      h('td', {}, h('span', { class: `pill ${p.connected ? 'ok' : 'bad'}` }, p.connected ? 'online' : 'away'), seen ? h('div', { class: 'muted' }, `seen ${Math.round((Date.now() - seen) / 1000)}s ago`) : null),
      h('td', {}, state.phase === 'playing' ? fmtTime(remainingMs(state, p.id, Date.now())) : '—'),
      h('td', {}, p.teamId ? state.gm.teams[p.teamId]?.name || p.teamId : '—'),
      h('td', { class: 'row' },
        h('button', { class: p.proxied ? 'primary' : '', title: 'Act for this phone from the console', onClick: () => gm('GM_PROXY', { playerId: p.id, on: !p.proxied }) }, p.proxied ? 'Proxy on' : 'Proxy'),
        h('button', { class: p.autopilot ? 'primary' : '', onClick: () => gm('GM_AUTOPILOT', { playerId: p.id, on: !p.autopilot }) }, p.autopilot ? 'Bot on' : 'Autopilot'),
        h('button', { onClick: () => { const t = prompt(`Whisper to ${p.name}:`); if (t) gm('GM_WHISPER', { playerId: p.id, text: t }); } }, 'Whisper'),
        h('button', { onClick: () => { const o = prompt('Roster owner id to give this seat:'); if (o) gm('GM_REASSIGN_ROSTER', { playerId: p.id, rosterOwnerId: o }); } }, 'Roster'),
        h('button', { class: 'danger', onClick: () => { if (confirm(`Remove ${p.name} from the table?`)) gm('GM_KICK', { playerId: p.id }); } }, 'Kick')));
  });
  main.append(h('div', { class: 'panel' }, h('h2', {}, 'The table'), bar),
    h('div', { class: 'panel' }, h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, h('th', {}, 'Seat'), h('th', {}, 'Phone'), h('th', {}, 'Clock'), h('th', {}, 'Team'), h('th', {}, ''))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Nobody yet — phones join at /phone with the code.')))),
      specs.length ? h('p', { class: 'muted' }, `Watching: ${specs.map(s => s.name).join(', ')}`) : null),
    state.mode === 'teams' && state.phase !== 'playing' ? teamsEditor({ state, seats, h, gm }) : null,
    h('div', { class: 'panel' }, h('h3', {}, 'Broadcast'), broadcast({ h, gm })));
}
function confirmStart(seats, gm) {
  const notReady = seats.filter(p => !p.ready && !p.kicked).map(p => p.name);
  if (notReady.length && !confirm(`Not ready: ${notReady.join(', ')}. Start anyway?`)) return;
  gm('RUN_START', {});
}
function broadcast({ h, gm }) {
  const input = h('input', { placeholder: 'Message to every phone' });
  return h('div', { class: 'row' }, input, h('button', { onClick: () => { if (input.value.trim()) { gm('GM_BROADCAST', { text: input.value.trim() }); input.value = ''; } } }, 'Send'), h('button', { onClick: () => { if (input.value.trim()) { gm('GM_BROADCAST', { text: input.value.trim(), banner: true }); input.value = ''; } } }, 'Banner on TV'));
}
function teamsEditor({ state, seats, h, gm }) {
  const teams = structuredClone(state.gm.teams || {});
  const ids = Object.keys(teams).length ? Object.keys(teams) : ['t1', 't2'];
  for (const id of ids) teams[id] ||= { name: id.toUpperCase(), members: [] };
  const sel = (p) => h('select', { onChange: (e) => { for (const t of Object.values(teams)) t.members = t.members.filter(m => m !== p.id); if (e.target.value) teams[e.target.value].members.push(p.id); } }, h('option', { value: '' }, '—'), ids.map(id => h('option', { value: id, selected: teams[id].members.includes(p.id) }, teams[id].name)));
  return h('div', { class: 'panel' }, h('h3', {}, 'Teams'), h('div', { class: 'list' }, seats.map(p => h('div', { class: 'row' }, h('span', { class: 'grow' }, p.name), sel(p)))),
    h('div', { class: 'row' }, h('button', { onClick: () => { const id = 't' + (ids.length + 1); teams[id] = { name: id.toUpperCase(), members: [] }; gm('GM_SET_TEAMS', { teams }); } }, '+ team'), h('button', { class: 'primary', onClick: () => gm('GM_SET_TEAMS', { teams }) }, 'Save teams')));
}
