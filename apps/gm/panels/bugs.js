// GM panel: Bugs & rewards (UI-CHEATSHEET.md › QA). Every BUG_REPORT newest first with its status, notes and
// reward; "Reward 🎡" spins the Bug Reward Wheel for the reporter (GM_BUG_REWARD, in secret: no TV wheel, no log
// line) and the console shows the spin here — a small wheel landing on the result, the label and text, and a tick
// once the phone has shown it (BUG_REWARD_SEEN). "Reward a seat" spins for anyone without a report. Status and
// notes go out as GM_BUG_STATUS; "Copy all as Markdown" puts the triage on the clipboard. The console redraws on
// every event and presence ping, so drafts, the open GM report line and the wheels already spun live in module
// state. Receives { state, session, ctx, h, gm, main }; main.js also uses openBugCount() for the nav badge and
// gmReportLine() for the "🐞 Report a bug" line in the nav.
import { characterOf } from '../../../packages/shared/state.js';
import { BUG_STATUSES } from '../../../packages/shared/handlers/qa.js';
import { wheelElement, spinTo, segmentAngle } from '../../../packages/ui/wheel.js';
import { toast } from '../../../packages/ui/dom.js';

const SPIN_MS = 3200;      // UI timing: the console's small wheel
const ui = { notes: {}, focus: null, gmOpen: false, gmDraft: '', gmFocus: false, seatPick: null };
const wheels = new Map();  // reward id → { el, landed } (animated once per console session, re-appended on redraw)
const reports = (state) => state.bugReports || [];
const rewards = (state) => state.bugRewards || Object.entries(state.secretSpins || {}).map(([playerId, r]) => ({ ...r, playerId }));

export const openBugCount = (state) => reports(state).filter(b => b.status === 'open').length;

export function panelBugs({ state, h, gm, main }) {
  const open = openBugCount(state), all = reports(state);
  main.append(
    h('div', { class: 'panel' },
      h('div', { class: 'row between' }, h('h2', {}, `Bugs & rewards — ${all.length} report${all.length === 1 ? '' : 's'}, ${open} open`),
        h('div', { class: 'gm-bar' }, h('button', { onClick: () => copyMarkdown(state) }, '📋 Copy all as Markdown'))),
      h('p', { class: 'muted' }, 'Players report from the 🐞 button on their phone. Rewarding spins the Bug Reward Wheel in secret: only that phone and this console see it; the TV never does.'),
      all.length ? h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'gm bugs' }, h('thead', {}, h('tr', {}, ['When', 'Who', 'Screen', 'What went wrong', 'Status', 'Notes', ''].map(x => h('th', {}, x)))), h('tbody', {}, [...all].reverse().map(b => bugRow({ state, h, gm, b }))))) : h('p', { class: 'muted ital' }, 'No reports yet.')),
    h('div', { class: 'grid2' }, rewardSeatCard({ state, h, gm }), rewardsCard({ state, h })));
}

// ── a report row ─────────────────────────────────────────────────────────────────────────────────
function bugRow({ state, h, gm, b }) {
  const hasChar = !!(b.playerId && state.players[b.playerId] && characterOf(state, b.playerId));
  const status = h('select', { 'aria-label': 'status', onChange: (e) => gm('GM_BUG_STATUS', { bugId: b.id, status: e.target.value }) }, BUG_STATUSES.map(s => h('option', { value: s, selected: s === b.status }, s)));
  const notes = h('input', { placeholder: 'notes', 'aria-label': 'notes', maxlength: 500, style: { minWidth: '160px' },
    onInput: (e) => { ui.notes[b.id] = e.target.value; },
    onFocus: () => { ui.focus = b.id; },
    onKeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    onBlur: (e) => { if (!e.target.isConnected) return; if (ui.focus === b.id) ui.focus = null; const v = e.target.value.trim(); if (v !== (b.notes || '')) { delete ui.notes[b.id]; gm('GM_BUG_STATUS', { bugId: b.id, notes: v }); } else delete ui.notes[b.id]; } });
  notes.value = ui.notes[b.id] ?? (b.notes || '');
  if (ui.focus === b.id) requestAnimationFrame(() => { if (notes.isConnected && document.activeElement !== notes) { notes.focus(); try { notes.setSelectionRange(notes.value.length, notes.value.length); } catch { /* ignore */ } } });
  const ctxLine = b.context ? [b.context.phase, b.context.round != null ? `round ${b.context.round}` : null, b.context.turnIdx != null ? `turn ${b.context.turnIdx + 1}` : null, b.context.myTurn ? 'their turn' : null, b.context.fight ? 'in a fight' : null, b.context.challenge ? 'in a challenge' : null].filter(Boolean).join(' · ') : [b.phase, b.round != null ? `round ${b.round}` : null].filter(Boolean).join(' · ');
  return h('tr', { 'data-bug': b.id, style: b.status === 'open' ? null : { opacity: .75 } },
    h('td', { title: new Date(b.ts).toLocaleString() }, ago(b.ts), h('div', { class: 'muted mono' }, b.eventSeq != null ? `#${b.eventSeq}` : '')),
    h('td', {}, h('b', {}, b.name || b.playerId || '—'), b.playerId && !hasChar ? h('div', { class: 'muted' }, 'no character') : null),
    h('td', {}, b.screen || '—', ctxLine ? h('div', { class: 'muted' }, ctxLine) : null),
    h('td', { class: 'bug-text', style: { maxWidth: '380px', whiteSpace: 'pre-wrap' } }, b.text),
    h('td', {}, h('span', { class: `pill ${pillClass(b.status)}` }, b.status), b.reward ? h('div', { class: 'muted' }, `🎁 ${b.reward.label}`) : null, h('div', { style: { marginTop: '4px' } }, status)),
    h('td', {}, notes),
    h('td', {}, h('button', { class: 'primary', disabled: !hasChar, title: hasChar ? 'Spin the Bug Reward Wheel for this player (secret)' : 'That player has no character yet', onClick: () => gm('GM_BUG_REWARD', { playerId: b.playerId, bugId: b.id }) }, 'Reward 🎡')));
}
const pillClass = (s) => ({ open: 'bad', rewarded: 'gold', fixed: 'ok' }[s] || '');

// ── reward a seat without a report ───────────────────────────────────────────────────────────────
function rewardSeatCard({ state, h, gm }) {
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked && !p.spectator);
  const who = h('select', { 'aria-label': 'seat', onChange: (e) => { ui.seatPick = e.target.value; } }, seats.map(p => h('option', { value: p.id, selected: p.id === ui.seatPick, disabled: !characterOf(state, p.id) }, `${p.name}${characterOf(state, p.id) ? '' : ' (no character)'}`)));
  return h('div', { class: 'panel' }, h('h3', {}, 'Reward a seat'), h('p', { class: 'muted' }, 'A secret spin for anyone — a bug told in person, a good catch, a kindness.'),
    h('div', { class: 'gm-bar' }, who, h('button', { class: 'primary', disabled: !seats.some(p => characterOf(state, p.id)), onClick: () => { const pid = who.value; if (!pid) return toast('Pick a seat', 'bad'); gm('GM_BUG_REWARD', { playerId: pid }); } }, 'Spin 🎡')));
}

// ── the spins, newest first, with the wheel for the recent ones ──────────────────────────────────
function rewardsCard({ state, h }) {
  const list = [...rewards(state)].reverse();
  const box = h('div', { class: 'panel col' }, h('h3', {}, `Rewards spun — ${list.length}`));
  if (!list.length) { box.append(h('p', { class: 'muted ital' }, 'No reward spun yet.')); return box; }
  list.forEach((r, i) => {
    const name = state.players[r.playerId]?.name || r.playerId;
    const row = h('div', { class: 'reward-row', 'data-reward': r.id });
    const head = h('div', { class: 'row between' }, h('div', {}, h('b', {}, name), h('span', { class: 'muted' }, ` · ${ago(r.ts)}${r.bugId ? ' · for a report' : ' · no report'}`)), h('span', { class: `pill ${r.seen ? 'ok' : ''}`, title: r.seen ? 'the phone has shown the wheel' : 'not yet shown on the phone' }, r.seen ? '✓ seen on phone' : 'waiting for the phone'));
    row.append(head);
    if (i < 4) row.append(rewardWheel(r, h)); else row.append(h('div', { class: 'reward-line' }, h('span', { class: 'display', style: { color: 'var(--amber)' } }, r.label), r.text ? h('span', { class: 'muted ital' }, ` — ${r.text}`) : null));
    box.append(row);
  });
  return box;
}
function rewardWheel(r, h) {
  let rec = wheels.get(r.id);
  if (rec) return rec.el;
  const outcomes = r.outcomes || [r.label], index = Math.max(0, Math.min(outcomes.length - 1, r.index ?? 0));
  const wheel = wheelElement({ outcomes, weights: r.weights || null });
  const label = h('div', { class: 'reward-label display' }, ''), text = h('div', { class: 'reward-text muted ital' }, '');
  const el = h('div', { class: 'reward-spin row' }, h('div', { class: 'reward-wheel' }, wheel), h('div', { class: 'col reward-result', style: { gap: '4px' } }, label, text));
  rec = { el, landed: false }; wheels.set(r.id, rec);
  const reveal = () => { label.textContent = r.label || outcomes[index] || ''; text.textContent = r.text || ''; el.classList.add('landed'); rec.landed = true; };
  if (Date.now() - (r.ts || 0) > 120000) { const w = wheel.__wheel; w.angle = -segmentAngle(outcomes.length, index); w.rotor.style.transform = `rotate(${w.angle}deg)`; wheel.classList.add('landed'); reveal(); }   // an old spin: already landed
  else requestAnimationFrame(() => spinTo(wheel, index, { ms: SPIN_MS, turns: 4 }).then(reveal));
  if (wheels.size > 40) for (const k of [...wheels.keys()].slice(0, wheels.size - 20)) wheels.delete(k);
  return el;
}

// ── the GM's own report line (in the nav) ────────────────────────────────────────────────────────
export function gmReportLine({ h, gm, rerender }) {
  const wrap = h('div', { class: 'gm-report' });
  const toggle = h('button', { class: `ghost${ui.gmOpen ? ' on' : ''}`, onClick: () => { ui.gmOpen = !ui.gmOpen; ui.gmFocus = ui.gmOpen; rerender(); } }, '🐞 Report a bug');
  wrap.append(toggle);
  if (!ui.gmOpen) return wrap;
  const text = h('textarea', { placeholder: 'What went wrong?', rows: 3, maxlength: 1000, 'aria-label': 'What went wrong?', onInput: (e) => { ui.gmDraft = e.target.value; }, onFocus: () => { ui.gmFocus = true; }, onBlur: (e) => { if (e.target.isConnected) ui.gmFocus = false; } });
  text.value = ui.gmDraft;
  const send = async () => { const t = text.value.trim(); if (!t) return toast('Say what went wrong', 'bad'); if (await gm('BUG_REPORT', { text: t, screen: 'GM' })) { ui.gmDraft = ''; ui.gmOpen = false; ui.gmFocus = false; toast('Logged under Bugs & rewards'); rerender(); } };
  wrap.append(text, h('div', { class: 'row' }, h('button', { class: 'ghost', onClick: () => { ui.gmOpen = false; ui.gmFocus = false; rerender(); } }, 'Cancel'), h('button', { class: 'primary', onClick: send }, 'Send')));
  if (ui.gmFocus) requestAnimationFrame(() => { if (text.isConnected && document.activeElement !== text) { text.focus(); try { text.setSelectionRange(text.value.length, text.value.length); } catch { /* ignore */ } } });
  return wrap;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
export function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - (ts || 0)) / 1000));
  if (s < 10) return 'just now'; if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const hr = Math.round(m / 60); if (hr < 24) return `${hr} h ago`; return `${Math.round(hr / 24)} d ago`;
}
export function bugsMarkdown(state) {
  const all = reports(state), rw = rewards(state);
  const lines = [`# Bug reports — room ${state.code || '?'} (${all.length} report${all.length === 1 ? '' : 's'}, ${openBugCount(state)} open)`, ''];
  for (const b of [...all].reverse()) {
    const ctx = b.context ? Object.entries(b.context).filter(([, v]) => v != null && v !== false).map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(', ') : '';
    lines.push(`- [${b.status}] ${new Date(b.ts).toISOString()} · **${b.name || b.playerId || '—'}** on ${b.screen || '—'}${ctx ? ` (${ctx})` : ''}`);
    lines.push(`  ${String(b.text).replace(/\n/g, '\n  ')}`);
    if (b.notes) lines.push(`  - notes: ${b.notes}`);
    if (b.reward) lines.push(`  - reward: ${b.reward.label}${b.reward.text ? ` — ${b.reward.text}` : ''}`);
  }
  if (rw.length) { lines.push('', '## Rewards spun', ''); for (const r of [...rw].reverse()) lines.push(`- ${new Date(r.ts).toISOString()} · ${state.players[r.playerId]?.name || r.playerId}: ${r.label}${r.text ? ` — ${r.text}` : ''}${r.bugId ? ` (for ${r.bugId})` : ''}${r.seen ? ' · seen' : ''}`); }
  return lines.join('\n') + '\n';
}
async function copyMarkdown(state) {
  const md = bugsMarkdown(state);
  try { await navigator.clipboard.writeText(md); toast('Copied as Markdown'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = md; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied as Markdown'); } catch { toast('Could not copy — select the text and copy by hand', 'bad'); }
    ta.remove();
  }
}
