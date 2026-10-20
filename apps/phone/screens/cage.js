// Phone tab: the Cage. The paper doll on its stand, the drag-and-drop grid, loot on this hex, Gold and titles.
// Receives { state, session, me, c, myTurn, ctx, h, dispatch, screen } from main.js on every event.
import { gridElement, itemSheet, lootPanel, onRerender, gridUi } from '../../../packages/ui/grid.js';
import { paperdollElement } from '../../../packages/ui/paperdoll.js';
import { characterOf } from '../../../packages/shared/state.js';

export function tabCage(args) {
  const { state, session, me, c, myTurn, h, dispatch, screen } = args;
  // Local UI changes (lifting, holding, selecting) redraw this tab without waiting for an event.
  onRerender(() => { if (!screen.isConnected) return; screen.replaceChildren(); const s = session?.state || state; tabCage({ ...args, state: s, c: characterOf(s, me.id) || c }); });
  if (!c) {
    screen.append(h('div', { class: 'hero' }, h('div', { class: 'crest' }, me.crest || '🂠'), h('h2', {}, 'The Cage'), h('p', { class: 'muted ital' }, me.spectator ? 'Spectators carry nothing but their wagers.' : 'Your gear and grid appear once you have a character.')));
    return;
  }
  const titles = c.titles || [];
  screen.append(
    h('div', { class: 'cage-head' },
      h('div', { class: 'grow' }, h('div', { class: 'tag' }, 'The Cage'), h('div', { class: 'cage-who' }, c.name, h('span', { class: 'muted ital' }, ` ${cap(c.classId)} · Lv ${c.level}`)),
        titles.length ? h('div', { class: 'cage-titles' }, titles.map(t => h('span', { class: 'pill gold' }, t))) : null),
      h('div', { class: 'cage-gold' }, h('div', {}, h('b', {}, c.gold ?? 0), h('span', { class: 'muted'}, ' Gold')), h('div', { class: 'muted small' }, `${c.bank ?? 0} banked`))),
    paperdollElement({ c, state, dispatch }),
    gridElement({ c, state, me, dispatch, myTurn }),
    lootPanel({ c, state, dispatch, myTurn }),
    (c.pendingLoot || []).length ? h('p', { class: 'muted small ital center' }, `${c.pendingLoot.length} piece${c.pendingLoot.length === 1 ? '' : 's'} of loot on the way — it lands in the grid at your next turn.`) : null,
    itemSheet({ c, state, me, dispatch, myTurn }),
  );
  if (gridUi.selected) screen.classList.add('has-sheet'); else screen.classList.remove('has-sheet');
}
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
