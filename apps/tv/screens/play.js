// TV during a run. Placeholder frame: the map, fight and wheel renderers are added by the UI phase.
import { h, fmtTime } from '../../../packages/ui/dom.js';
import { currentPlayerId, characterOf } from '../../../packages/shared/state.js';
import { remainingMs } from '../../../packages/shared/clock.js';

export function renderPlay({ state, stage, rail, clockEls }) {
  const pid = currentPlayerId(state), p = state.players[pid], c = characterOf(state, pid);
  const big = h('div', { class: 'clock-big' }, fmtTime(remainingMs(state, pid, Date.now())));
  big.update = (now) => { big.textContent = fmtTime(remainingMs(state, pid, now)); };
  clockEls.main = big;
  const others = state.seats.filter(id => id !== pid && state.players[id] && !state.players[id].kicked).map(id => `${state.players[id].name} ${fmtTime(remainingMs(state, id, Date.now()))}`).join(' · ');
  rail.append(h('div', { class: 'panel gold' }, h('h3', {}, 'To move'), h('div', {}, h('b', {}, c?.name || p?.name || '—'), ' ', h('span', { class: 'ital muted' }, c ? `the ${c.classId}` : '')), big, h('div', { class: 'clock-small' }, 'banked ', others)));
  stage.append(h('div', { style: { padding: '2vw' } }, h('h2', {}, 'The map'), h('p', { class: 'muted ital' }, 'Map rendering arrives with the overworld UI.'), h('div', { class: 'log' }, state.log.slice(-8).map(l => h('div', { class: l.kind }, l.text)))));
}
