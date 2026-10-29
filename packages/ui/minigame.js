// One minigame round on the phone (SPEC.md › Attacks and spells; Character creation). Renders a Round from
// packages/games/adapter.js as big touch controls (controls-as-data: info, inputs, buttons, grid, fork options) plus
// an optional stage preview (the same HTML the TV draws), and keeps rounds alive across the phone's full re-renders.
//
//   liveRound(key, make)        → the Round for this key, created once with make() (rounds survive re-renders)
//   dropRound(key)              forget it (after resolve)
//   roundView({ round, onAct, onFork, stage, now, note })   → element; call again after every act (cheap)
//   The host decides what to do with act results: dispatch ITEM_STEP after each, ITEM_RESOLVE when `round.done`.
//   Hidden picks (mines squares, scratch panels, the shell, bus calls) are fine here: this is the acting phone.
import { gameById } from '../shared/characters/generator.js';
import { h, morphHtml } from './dom.js';
import { leverBar } from './lever.js';

const rounds = new Map();
export function liveRound(key, make) {
  let r = rounds.get(key);
  if (!r) { r = { key, round: make(), resolved: false, handledChoice: null, startedAt: Date.now(), lastText: '' }; rounds.set(key, r); if (rounds.size > 12) rounds.delete(rounds.keys().next().value); }
  return r;
}
export const peekRound = (key) => rounds.get(key) || null;
export const dropRound = (key) => rounds.delete(key);

const inputValues = new Map();   // `${roundId}:${inputId}` → last typed value
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gridCols = (grid) => Math.max(2, Math.min(10, Number(grid.cols) || Math.round(Math.sqrt(grid.cells.length)) || 5));

// Live stage: redraws while the round is running or a timed reveal is still playing out.
function stageBox(round, now) {
  const box = h('div', { class: 'mg-stage' });
  const draw = (t) => { try { morphHtml(box, round.stage(t)); } catch (e) { morphHtml(box, `<div class="stage-sub">${esc(e.message)}</div>`); } };
  draw(now);
  const until = () => Math.max(round.revealAt?.() || 0, round.g?.view?.revealAt || 0, round.g?.view?.endedAt || 0) + 1800;
  const loop = () => {
    if (!box.isConnected) return;
    const t = Date.now();
    draw(t);
    if (!round.done || t < until() || round.gameId === 'crash' && round.g?.phase === 'running') setTimeout(loop, 110);
  };
  setTimeout(loop, 110);
  return box;
}

export function roundView({ round, onAct, onFork = null, stage = true, now = Date.now(), note = '', compact = false, leverStat = undefined } = {}) {
  const root = h('div', { class: `mg ${compact ? 'compact' : ''}` });
  if (!round) { root.append(h('p', { class: 'muted ital' }, 'No round open.')); return root; }
  let controls;
  try { controls = round.controls(); } catch (e) { controls = { info: e.message, buttons: [] }; }
  const g = round.g;
  if (stage) root.append(stageBox(round, now));
  const head = h('div', { class: 'mg-head' }, h('div', { class: 'tag' }, `${round.item?.name || round.gameId} · stake ${round.stake} ${round.cur === 'Chips' ? 'chips' : 'Health'}${round.statName ? ` · ${round.statName} ${round.statValue}` : ''}`));
  root.append(head);
  // leverStat: the Lab previews a stat the sliders are moving; a real phone always shows the stat the round was dealt at.
  if (round.gameId && round.statName) { const lv = leverBar({ gameId: round.gameId, statValue: leverStat ?? round.statValue }); if (lv) root.append(lv); }
  // "How to play": the item's goal and how-to from items36.json, folded under the head; open state remembered per game.
  const def = round.gameId ? gameById(round.gameId) : null;
  if (def?.howTo) {
    let open = false; try { open = localStorage.getItem(`gwfrpg:howto:${round.gameId}`) !== 'seen'; } catch { open = true; }
    const body = h('div', { class: 'mg-howto-body', style: { display: open ? '' : 'none' } }, def.goal ? h('b', {}, def.goal + ' ') : null, def.howTo);
    const btn = h('button', { class: 'ghost small mg-howto-btn', onClick: () => { open = !open; body.style.display = open ? '' : 'none'; btn.textContent = open ? 'ⓘ Hide how to play' : 'ⓘ How to play'; try { localStorage.setItem(`gwfrpg:howto:${round.gameId}`, open ? 'open' : 'seen'); } catch { /* ignore */ } } }, open ? 'ⓘ Hide how to play' : 'ⓘ How to play');
    root.append(h('div', { class: 'mg-howto' }, btn, body));
  }
  if (note) root.append(h('p', { class: 'muted ital mg-note' }, note));
  if (controls.info) root.append(h('div', { class: 'mg-info', html: String(controls.info) }));
  // Fork: two held results, pick one.
  if (g?.forkOptions?.length) {
    root.append(h('div', { class: 'mg-fork' }, h('div', { class: 'tag' }, 'Fork — pick a branch'),
      h('div', { class: 'btn-grid' }, g.forkOptions.map((o, i) => h('button', { class: 'primary big', onClick: () => onFork?.(i) }, `${o.label} · ${o.mult}×`)))));
    return root;
  }
  if (round.done) { root.append(h('div', { class: `mg-result ${round.result?.mult > 1 ? 'win' : round.result?.mult < 1 ? 'lose' : 'push'}` }, round.result?.label || 'Round over')); return root; }
  // Inputs (number targets etc.)
  const inputEls = {};
  if (controls.inputs?.length) {
    root.append(h('div', { class: 'mg-inputs' }, controls.inputs.map(inp => {
      const k = `${round.id}:${inp.id}`; const v = inputValues.has(k) ? inputValues.get(k) : inp.value;
      const el = h('input', { type: inp.type || 'number', inputmode: 'decimal', min: inp.min, max: inp.max, step: inp.step, value: v, 'aria-label': inp.id, onInput: (e) => inputValues.set(k, e.target.value) });
      inputEls[inp.id] = el;
      return h('label', { class: 'mg-input' }, h('span', { class: 'tag' }, inp.label || 'target'), el);
    })));
  }
  const payloadFor = (bt) => { const p = { ...(bt.p || {}) }; if (bt.from) for (const [field, id] of Object.entries(bt.from)) { const el = inputEls[id]; if (el) p[field] = Number(el.value); } return p; };
  // Grid (mines, keno, roulette numbers)
  if (controls.grid?.cells?.length) {
    const grid = controls.grid;
    root.append(h('div', { class: 'mg-grid', style: { gridTemplateColumns: `repeat(${gridCols(grid)}, 1fr)` } }, grid.cells.map(cell =>
      h('button', { class: `cell ${cell.state || ''}`, disabled: !!cell.disabled, onClick: () => onAct?.(cell.a, payloadFor(cell)) }, String(cell.label ?? '')))));
  }
  // Buttons
  const buttons = (controls.buttons || []);
  if (buttons.length) {
    const wrap = h('div', { class: 'mg-buttons' });
    for (const bt of buttons) {
      if (bt.br) wrap.append(h('div', { class: 'br' }));
      wrap.append(h('button', { class: `${bt.primary ? 'primary' : ''} ${bt.danger ? 'danger' : ''} ${(bt.label || '').length > 18 ? 'long' : ''}`, disabled: !!bt.disabled, html: String(bt.label || bt.a), onClick: () => onAct?.(bt.a, payloadFor(bt)) }));
    }
    root.append(wrap);
  }
  if (!buttons.length && !controls.grid?.cells?.length && !g?.forkOptions) root.append(h('p', { class: 'muted ital' }, 'Waiting on the table…'));
  return root;
}

// Nudge picker for a held Nudge consumable: the labels the game can be nudged to.
export function nudgePicker(round, onPick) {
  const labels = round.nudgeLabels?.() || [];
  if (!labels.length) return h('div', { class: 'mg-nudge' }, h('p', { class: 'muted ital' }, 'Nudge is armed: the next result leans your way.'), h('button', { class: 'primary', onClick: () => onPick(null) }, 'Carry on'));
  return h('div', { class: 'mg-nudge' }, h('div', { class: 'tag' }, 'Nudge — where should it land?'), h('div', { class: 'mg-buttons' }, labels.slice(0, 40).map(l => h('button', { class: 'primary', onClick: () => onPick(l) }, String(l)))));
}
// A seed for an actor-authoritative round.
export const seedFor = (...parts) => parts.map(p => String(p ?? '')).join(':');
