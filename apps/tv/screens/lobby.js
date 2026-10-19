// TV lobby: who is at the table, creation progress, Spotlight slots (filled by the play agent later).
import { h } from '../../../packages/ui/dom.js';
import { characterOf } from '../../../packages/shared/state.js';

export function renderLobby({ state, stage, rail }) {
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked);
  const list = h('div', { class: 'lobby-list' });
  for (const p of seats) {
    const c = characterOf(state, p.id);
    list.append(h('div', { class: `seat ${p.connected ? '' : 'off'} ${p.ready ? 'ready' : ''}` },
      h('div', { class: 'crest' }, c?.crest || p.crest || '🂠'),
      h('div', {}, h('div', { class: 'name' }, c?.name || p.name), h('div', { class: 'muted' }, c ? (c.locked ? `${c.classId} · locked in` : 'making a character…') : (p.connected ? (p.ready ? 'ready' : 'at the table') : 'phone asleep')))));
  }
  if (!seats.length) list.append(h('p', { class: 'muted ital', style: { padding: '2vw' } }, 'Nobody has sat down yet. Scan the code to join.'));
  stage.append(h('div', { style: { padding: '1vw' } }, h('h2', {}, state.phase === 'creation' ? 'Character creation' : 'The lobby'), list));
  const watching = Object.values(state.players).filter(p => p.spectator && !p.kicked).length;
  rail.append(h('div', { class: 'panel' }, h('h3', {}, 'At the table'), h('p', {}, `${seats.length} seated${watching ? ` · ${watching} watching` : ''}`), h('p', { class: 'muted' }, state.phase === 'creation' ? 'Dress the sprite, pick a class, gamble for your stats.' : 'Waiting for the GM to open creation.')));
}
