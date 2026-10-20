// Phone tab: Letters. Inbox, outbox, compose, alliance proposals, and the intercept desk when mail crosses your
// path (the courier hex, a Spyglass, a Cutpurse). The unread dot on the tab is main.js's; here a letter is "new"
// until you open it.
import { letterCard, composeForm, alliancesPanel, lettersUi, readSet } from '../../../packages/ui/letters.js';
import { onRerender, rerenderSoon } from '../../../packages/ui/grid.js';
import { inbox, outbox, interceptable } from '../../../packages/shared/handlers/social.js';
import { characterOf, currentPlayerId } from '../../../packages/shared/state.js';

const tabUi = { view: 'inbox' };

export function tabLetters(args) {
  const { state, session, me, c, myTurn, h, dispatch, screen } = args;
  const again = () => { if (!screen.isConnected) return; screen.replaceChildren(); const s = session?.state || state; tabLetters({ ...args, state: s, c: characterOf(s, me.id) || c, myTurn: s.phase === 'playing' && currentPlayerId(s) === me.id }); };
  onRerender(again);
  if (!screen.dataset.lettersWired) { screen.dataset.lettersWired = '1'; screen.addEventListener('gwf-rerender', () => rerenderSoon()); }
  if (me.spectator) { screen.append(h('div', { class: 'hero' }, h('h2', {}, 'Letters'), h('p', { class: 'muted ital' }, 'Spectators have no crow.'))); return; }

  const mine = safe(() => inbox(state, me.id), []).slice().sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));
  const sent = safe(() => outbox(state, me.id), []).slice().reverse();
  const crossing = safe(() => interceptable(state, me.id), []);
  const read = readSet(me.id);
  const unread = mine.filter(l => !l.read && !read.has(l.id)).length;
  const proposals = mine.filter(l => l.kind === 'alliance' && !l.answered);

  // ── intercept desk, on top when there is mail to read ──
  if (crossing.length) screen.append(h('div', { class: 'panel blood intercept' }, h('h3', {}, 'Mail crosses your path'),
    h('p', { class: 'muted small ital' }, `${crossing.length} letter${crossing.length === 1 ? '' : 's'} in transit. Nobody knows you have seen ${crossing.length === 1 ? 'it' : 'them'}.`),
    h('div', { class: 'letters' }, crossing.map(l => letterCard({ letter: l, state, me: me.id, dispatch, mode: 'intercept' })))));

  // ── proposals needing an answer ──
  if (proposals.length) screen.append(h('div', { class: 'panel gold' }, h('h3', {}, 'Alliance proposed'), h('div', { class: 'letters' }, proposals.map(l => { lettersUi.open.add(l.id); return letterCard({ letter: l, state, me: me.id, dispatch, mode: 'in' }); }))));

  // ── tabs: inbox / outbox / write ──
  const views = [['inbox', `Inbox${unread ? ` (${unread})` : ''}`], ['outbox', `Sent${sent.length ? ` (${sent.length})` : ''}`], ['write', 'Write']];
  screen.append(h('div', { class: 'subtabs' }, views.map(([id, label]) => h('button', { class: id === tabUi.view ? 'on' : '', onClick: () => { tabUi.view = id; rerenderSoon(); } }, label))));
  if (tabUi.view === 'inbox') {
    const list = mine.filter(l => !(l.kind === 'alliance' && !l.answered));
    screen.append(list.length ? h('div', { class: 'letters' }, list.map(l => letterCard({ letter: l, state, me: me.id, dispatch, mode: 'in' })))
      : h('div', { class: 'panel' }, h('p', { class: 'muted ital' }, 'No letters yet. A crow lands at the start of your turn, two of your turns after it was sent.')));
  } else if (tabUi.view === 'outbox') {
    screen.append(sent.length ? h('div', { class: 'letters' }, sent.map(l => letterCard({ letter: l, state, me: me.id, dispatch, mode: 'out' })))
      : h('div', { class: 'panel' }, h('p', { class: 'muted ital' }, 'You have sent nothing. What you send can be read on the way, or never arrive.')));
  } else screen.append(composeForm({ state, me: me.id, c, dispatch, myTurn }));

  screen.append(alliancesPanel({ state, me: me.id, dispatch }));
  if (tabUi.view !== 'write') screen.append(h('button', { class: 'primary big', style: { marginTop: '12px' }, onClick: () => { tabUi.view = 'write'; rerenderSoon(); } }, 'Write a letter'));
}
const safe = (fn, d) => { try { return fn() ?? d; } catch { return d; } };
