// QA on the phone (UI-CHEATSHEET.md › QA): the 🐞 button in the top bar opens a sheet that sends BUG_REPORT with
// the tab, turn and round the player is looking at; the secret Bug Reward Wheel overlay shows
// state.secretSpins[me] once (the id is remembered in localStorage, so a reload never re-animates it) and sends
// BUG_REWARD_SEEN on "Got it". Both survive re-renders: the draft lives in `store`, the overlay element is reused.
import { h, toast, buzz, store } from '../../packages/ui/dom.js';
import { wheelElement, spinTo, segmentAngle } from '../../packages/ui/wheel.js';
import { currentPlayerId } from '../../packages/shared/state.js';

const SPIN_MS = 3600;    // UI timing: how long the phone's reward wheel turns before it lands
const draftKey = (code, me) => `gwfrpg:qa:draft:${code}:${me}`;
const seenKey = (code, me) => `gwfrpg:qa:rewardSeen:${code}:${me}`;
const ui = { open: false, focus: false };
let overlay = null;   // { id, el } — the reward overlay for the current reward id, re-appended on every render

// ── the 🐞 button and the report sheet ───────────────────────────────────────────────────────────
export function bugButton({ rerender }) {
  return h('button', { class: `bug-btn${ui.open ? ' on' : ''}`, 'aria-label': 'Report a bug', title: 'Report a bug', onClick: () => { ui.open = !ui.open; ui.focus = ui.open; rerender(); } }, '🐞');
}

export function bugSheet({ state, ctx, me, myTurn, dispatch, rerender }) {
  if (!ui.open) return null;
  const key = draftKey(ctx.code, me.id);
  const pid = currentPlayerId(state);
  const where = `${tabLabel(ctx.tab)} · ${state.phase === 'playing' ? `turn ${(state.turnIdx ?? 0) + 1}, round ${state.round ?? 0}${myTurn ? ' (your turn)' : pid ? ` (${state.players[pid]?.name || '—'} to move)` : ''}` : state.phase}`;
  const text = h('textarea', { class: 'bug-text', placeholder: 'What went wrong?', rows: 4, maxlength: 1000, 'aria-label': 'What went wrong?', onInput: (e) => store.set(key, e.target.value) });
  text.value = store.get(key, '') || '';
  const close = () => { ui.open = false; ui.focus = false; rerender(); };
  const send = async () => {
    const t = text.value.trim(); if (!t) { toast('Say what went wrong', 'bad'); text.focus(); return; }
    const context = { tab: ctx.tab, turnIdx: state.turnIdx ?? null, round: state.round ?? null, phase: state.phase, myTurn: !!myTurn, fight: !!(state.fight && !state.fight.done), challenge: !!(state.challenge && !state.challenge.done) };
    const ok = await dispatch('BUG_REPORT', { text: t, screen: tabLabel(ctx.tab), context });
    if (!ok) return;
    store.del(key); ui.open = false; ui.focus = false;
    toast('Thanks — the House owes you one 🤫', '', 3200); buzz(60);
    rerender();
  };
  const sheet = h('div', { class: 'bug-sheet', role: 'dialog', 'aria-label': 'Report a bug' },
    h('div', { class: 'bug-card panel gold col' },
      h('h3', {}, '🐞 Report a bug'),
      h('div', { class: 'bug-where muted', title: 'sent with the report' }, where),
      text,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'ghost', onClick: close }, 'Cancel'), h('button', { class: 'primary bug-send', onClick: send }, 'Send'))));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  if (ui.focus) requestAnimationFrame(() => { if (text.isConnected && document.activeElement !== text) { text.focus(); try { text.setSelectionRange(text.value.length, text.value.length); } catch { /* ignore */ } } });
  return sheet;
}
const tabLabel = (id) => ({ play: 'Play', cage: 'Cage', self: 'Self', pets: 'Pets', map: 'Map', letters: 'Letters' }[id] || id || 'phone');

// ── the secret reward overlay ────────────────────────────────────────────────────────────────────
// Shown above the tabs while state.secretSpins[me] exists and is not seen. The same reward id is animated once:
// its id goes into localStorage before the spin starts, so a reload shows the wheel already landed.
export function rewardOverlay({ state, ctx, me, dispatch }) {
  const r = state.secretSpins?.[me.id];
  if (!r || r.seen) { if (overlay) { overlay.el.remove(); overlay = null; } return null; }
  if (overlay && overlay.id === r.id) return overlay.el;
  const key = seenKey(ctx.code, me.id);
  const animated = store.get(key, []);
  const already = Array.isArray(animated) && animated.includes(r.id);
  const outcomes = r.outcomes || [r.label];
  const index = Math.max(0, Math.min(outcomes.length - 1, r.index ?? 0));
  const wheel = wheelElement({ outcomes, weights: r.weights || null, size: null });
  const result = h('div', { class: 'reward-result' }, h('div', { class: 'reward-label display' }, ''), h('div', { class: 'reward-text ital' }, ''));
  const btn = h('button', { class: 'primary big reward-ok', disabled: true, onClick: async () => { const ok = await dispatch('BUG_REWARD_SEEN', {}); if (ok !== false) { overlay?.el.remove(); overlay = null; } } }, 'Got it 🤐');
  const el = h('div', { class: 'qa-reward', role: 'dialog', 'aria-label': 'Secret reward' },
    h('div', { class: 'reward-note' }, r.message || ''),
    h('div', { class: 'reward-wheel' }, wheel),
    result, btn);
  overlay = { id: r.id, el };
  const reveal = () => { result.querySelector('.reward-label').textContent = r.label || outcomes[index] || ''; result.querySelector('.reward-text').textContent = r.text || ''; el.classList.add('landed'); btn.disabled = false; };
  if (already) {
    // Landed already on a previous load: park the rotor on the segment and show the result at once.
    const w = wheel.__wheel; w.angle = -segmentAngle(outcomes.length, index); w.rotor.style.transform = `rotate(${w.angle}deg)`; wheel.classList.add('landed');
    reveal();
  } else {
    store.set(key, [...(Array.isArray(animated) ? animated : []), r.id].slice(-20));
    buzz([40, 30, 40]);
    requestAnimationFrame(() => spinTo(wheel, index, { ms: SPIN_MS, turns: 5 }).then(() => { if (overlay?.id === r.id) { reveal(); buzz(90); } }));
  }
  return el;
}
