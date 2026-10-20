// Letters (SPEC.md › PvP and social): post, not chat. Cards with a wax seal, the compose form with its recipient
// picker and the off-turn limit, alliance proposals and answers, and the intercept desk for whoever stands on
// the courier hex or carries a Spyglass. Shared by the phone's Letters tab (and any screen that shows a letter).
//
//   letterCard({ letter, state, me, dispatch, mode: 'in' | 'out' | 'intercept' })
//   composeForm({ state, me, c, dispatch, myTurn })
//   alliancesPanel({ state, me, dispatch })
//   sealUrl(classId)   the class's wax seal image when the manifest has one
import '../shared/index.js';
import { h, toast, store } from './dom.js';
import { assetEntry, assetUrl, manifestNow } from './sprite.js';
import { group } from '../shared/balance.js';
import { characterOf, currentPlayerId } from '../shared/state.js';

export const lettersUi = { compose: { toId: null, text: '', kind: 'letter' }, open: new Set(), forging: null, forgeText: '' };
const readKey = (me) => `gwfrpg:lettersread:${me}`;
export const readSet = (me) => new Set(store.get(readKey(me), []));
export function markRead(me, letterId) { const s = readSet(me); if (s.has(letterId)) return; s.add(letterId); store.set(readKey(me), [...s].slice(-200)); }

export const sealUrl = (classId) => { const e = assetEntry(`letters/seal_${classId}`, manifestNow()); return e ? assetUrl(e.path) : null; };
const letterArt = (name) => { const e = assetEntry(`letters/${name}`, manifestNow()); return e ? assetUrl(e.path) : null; };
const nameOf = (state, pid) => state.players?.[pid]?.name || 'someone';
const crestOf = (state, pid) => characterOf(state, pid)?.crest || state.players?.[pid]?.crest || '🂠';
const classOf = (state, pid) => characterOf(state, pid)?.classId || null;
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// Turns of the recipient still to pass before a letter in transit lands (0 when due at their next turn start).
export function turnsUntil(state, l) { if (l.deliveredAt) return 0; const n = state.turnCounts?.[l.toId] || 0; return Math.max(0, (l.deliverAfterTurns || 0) - (n - (l.recipientTurnsAtSend || 0))); }

function seal(state, pid, { broken = false } = {}) {
  const classId = classOf(state, pid); const url = classId ? sealUrl(classId) : null;
  const el = h('div', { class: `wax ${broken ? 'broken' : ''} c-${classId || 'none'}`, title: classId ? `${cap(classId)}'s seal` : '' });
  if (url) el.style.backgroundImage = `url("${url}")`; else el.append(h('span', {}, crestOf(state, pid)));
  return el;
}

// One letter. mode 'in': received (open to read, answer alliances); 'out': sent (status only); 'intercept': the desk.
export function letterCard({ letter: l, state, me, dispatch, mode = 'in' } = {}) {
  const other = mode === 'out' ? l.toId : l.fromId;
  const isOpen = lettersUi.open.has(l.id) || mode === 'intercept';
  const unread = mode === 'in' && !l.read && !readSet(me).has(l.id);
  const when = l.deliveredAt ? new Date(l.deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const status = mode === 'out'
    ? (l.deliveredAt ? `delivered${when ? ` · ${when}` : ''}` : `in transit · lands after ${turnsUntil(state, l)} more of ${nameOf(state, l.toId)}'s turns`)
    : mode === 'intercept' ? `from ${nameOf(state, l.fromId)} to ${nameOf(state, l.toId)}` : (when ? `arrived ${when}` : '');
  const card = h('article', { class: `letter ${mode} ${isOpen ? 'open' : ''} ${unread ? 'unread' : ''} ${l.kind === 'alliance' ? 'alliance' : ''} ${l.intercepted?.action === 'forge' && mode === 'in' ? '' : ''}` });
  const head = h('header', { class: 'letter-head', onClick: () => { if (mode === 'intercept') return; if (lettersUi.open.has(l.id)) lettersUi.open.delete(l.id); else { lettersUi.open.add(l.id); if (mode === 'in') markRead(me, l.id); } card.dispatchEvent(new CustomEvent('gwf-rerender', { bubbles: true })); } },
    seal(state, other, { broken: isOpen || mode === 'out' }),
    h('div', { class: 'grow' }, h('div', { class: 'letter-who' }, mode === 'out' ? `To ${nameOf(state, l.toId)}` : `From ${nameOf(state, l.fromId)}`, l.kind === 'alliance' ? h('span', { class: 'pill gold' }, 'alliance') : null, unread ? h('span', { class: 'pill bad' }, 'new') : null),
      h('div', { class: 'muted small ital' }, status)),
    mode !== 'intercept' ? h('span', { class: 'letter-chev' }, isOpen ? '▾' : '▸') : null);
  card.append(head);
  if (isOpen) {
    const body = h('div', { class: 'letter-body' }, h('p', { class: 'letter-text' }, l.text));
    if (mode === 'in' && l.kind === 'alliance') {
      if (l.answered) body.append(h('p', { class: 'muted small ital' }, l.accepted ? 'You accepted. You are allies: neither of you is hit by the other’s Area items.' : 'You declined.'));
      else body.append(h('div', { class: 'row' }, h('button', { class: 'primary grow', disabled: state.phase !== 'playing', onClick: () => dispatch('ALLIANCE_ANSWER', { letterId: l.id, accept: true }) }, 'Accept the alliance'), h('button', { class: 'ghost', disabled: state.phase !== 'playing', onClick: () => dispatch('ALLIANCE_ANSWER', { letterId: l.id, accept: false }) }, 'Decline')));
    }
    if (mode === 'out' && l.kind === 'alliance' && l.answered) body.append(h('p', { class: 'muted small ital' }, l.accepted ? `${nameOf(state, l.toId)} accepted.` : `${nameOf(state, l.toId)} declined.`));
    if (mode === 'intercept') body.append(interceptControls({ letter: l, state, me, dispatch }));
    card.append(body);
  }
  return card;
}

function interceptControls({ letter: l, state, me, dispatch }) {
  const c = characterOf(state, me); const X = safeGroup(state, 'xp'), S = safeGroup(state, 'social');
  const canForge = c?.classId === 'cutpurse' && ((c.upgrades || []).includes('forge') || (c.level || 0) >= (X.upgradeLevels?.[0] || 5));
  const forging = lettersUi.forging === l.id;
  const box = h('div', { class: 'col' },
    h('p', { class: 'muted small ital' }, 'This letter crosses your path. Let it through, burn it, or (a Cutpurse of level 5) rewrite it in their hand.'),
    h('div', { class: 'row' },
      h('button', { class: 'primary grow', onClick: () => dispatch('LETTER_INTERCEPT', { letterId: l.id, action: 'pass' }) }, 'Let it pass'),
      h('button', { class: 'danger', onClick: () => dispatch('LETTER_INTERCEPT', { letterId: l.id, action: 'destroy' }) }, 'Burn it'),
      canForge ? h('button', { class: forging ? '' : 'ghost', onClick: () => { lettersUi.forging = forging ? null : l.id; lettersUi.forgeText = l.text; box.dispatchEvent(new CustomEvent('gwf-rerender', { bubbles: true })); } }, 'Forge') : null));
  if (forging && canForge) {
    const ta = h('textarea', { maxlength: S.letterMaxChars || 280, rows: 3, 'aria-label': 'forged text' }, lettersUi.forgeText || l.text);
    ta.addEventListener('input', () => { lettersUi.forgeText = ta.value; });
    box.append(ta, h('button', { class: 'primary', onClick: () => { const t = (lettersUi.forgeText || '').trim(); if (!t) return toast('Write something first', 'bad'); lettersUi.forging = null; dispatch('LETTER_INTERCEPT', { letterId: l.id, action: 'forge', forgedText: t }); } }, 'Send the forgery on'));
  }
  return box;
}

// Compose: pick a recipient, write up to letterMaxChars, send as a letter or an alliance proposal.
export function composeForm({ state, me, c, dispatch, myTurn = false } = {}) {
  const S = safeGroup(state, 'social'); const max = S.letterMaxChars || 280;
  const cu = lettersUi.compose;
  const others = Object.values(state.players || {}).filter(p => p.id !== me && !p.spectator && !p.kicked);
  if (cu.toId && !others.some(p => p.id === cu.toId)) cu.toId = null;
  const offTurnUsed = state.offTurnLetters?.[me] || 0; const offTurnLeft = Math.max(0, (S.lettersOffTurn ?? 1) - offTurnUsed);
  const canSend = state.phase === 'playing' && !c?.dead && (myTurn || offTurnLeft > 0);
  const allied = (pid) => (state.alliances || []).some(a => a.active && a.members.includes(me) && a.members.includes(pid));
  const ta = h('textarea', { maxlength: max, rows: 3, placeholder: cu.kind === 'alliance' ? 'Shall we work together? (optional)' : 'Write by crow…', 'aria-label': 'letter text' }, cu.text || '');
  const counter = h('span', { class: 'muted small' }, `${(cu.text || '').length} / ${max}`);
  ta.addEventListener('input', () => { cu.text = ta.value; counter.textContent = `${ta.value.length} / ${max}`; });
  const form = h('div', { class: 'panel compose' }, h('h3', {}, 'Write a letter'),
    h('div', { class: 'tag' }, 'To'),
    others.length ? h('div', { class: 'row recipients' }, others.map(p => h('button', { class: `mini ${cu.toId === p.id ? 'primary' : ''}`, onClick: () => { cu.toId = p.id; form.dispatchEvent(new CustomEvent('gwf-rerender', { bubbles: true })); } }, crestOf(state, p.id), ' ', p.name, allied(p.id) ? h('span', { class: 'pill ok' }, 'ally') : null, characterOf(state, p.id)?.dead ? h('span', { class: 'pill' }, 'dead') : null))) : h('p', { class: 'muted ital' }, 'Nobody else at the table.'),
    h('div', { class: 'row' }, h('button', { class: `mini ${cu.kind === 'letter' ? 'primary' : 'ghost'}`, onClick: () => { cu.kind = 'letter'; form.dispatchEvent(new CustomEvent('gwf-rerender', { bubbles: true })); } }, 'Letter'), h('button', { class: `mini ${cu.kind === 'alliance' ? 'primary' : 'ghost'}`, onClick: () => { cu.kind = 'alliance'; form.dispatchEvent(new CustomEvent('gwf-rerender', { bubbles: true })); } }, 'Propose an alliance')),
    ta, h('div', { class: 'row between' }, counter, h('span', { class: 'muted small ital' }, `arrives after ${S.letterDelayTurns ?? 2} of their turns · can be read on the way`)),
    h('div', { class: 'row between' },
      h('span', { class: 'muted small' }, state.phase !== 'playing' ? 'The crows fly once the run starts.' : myTurn ? 'Your turn: write as many as you like.' : `Off your turn: ${offTurnLeft} of ${S.lettersOffTurn ?? 1} left.`),
      h('button', { class: 'primary', disabled: !canSend || !cu.toId, onClick: () => {
        const text = (cu.text || '').trim(); if (cu.kind !== 'alliance' && !text) return toast('An empty letter', 'bad');
        const type = cu.kind === 'alliance' ? 'ALLIANCE_PROPOSE' : 'LETTER_SEND';
        dispatch(type, { toId: cu.toId, text }).then(ok => { if (ok !== false) { cu.text = ''; cu.kind = 'letter'; form.dispatchEvent(new CustomEvent('gwf-rerender', { bubbles: true })); } });
      } }, cu.kind === 'alliance' ? 'Send the proposal' : 'Send by crow')));
  return form;
}

// Standing alliances with Break (an alliance can only be ended, by either side).
export function alliancesPanel({ state, me, dispatch } = {}) {
  const mine = (state.alliances || []).filter(a => a.active && a.members.includes(me));
  if (!mine.length) return null;
  return h('div', { class: 'panel' }, h('h3', {}, 'Alliances'),
    h('div', { class: 'list' }, mine.map(a => { const other = a.members.find(id => id !== me); return h('div', { class: 'item' }, h('span', {}, crestOf(state, other)), h('span', { class: 'grow' }, nameOf(state, other), h('span', { class: 'muted small' }, ` · since round ${roundAt(state, a.since)}`)), h('button', { class: 'ghost mini', onClick: () => dispatch('ALLIANCE_ANSWER', { allianceId: a.id, accept: false }) }, 'Break')); })),
    h('p', { class: 'muted small ital' }, 'Allies are never hit by each other’s Area items. The table does not know until it shows.'));
}
const roundAt = (state, ts) => state.round || 1;
const safeGroup = (state, g) => { try { return group(state, g); } catch { return {}; } };
export { currentPlayerId };
