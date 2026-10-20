// Phone dice: the movement die rolled on the Play tab (SPEC.md › Boots and movement modes, Dice). Nearest-neighbour
// look: each die is the placeholder PNG from assets/dice/d<n>.png behind a big Cinzel number; while rolling the face
// cycles through random pips and the die shakes, then it lands on the value the engine already decided.
//
//   dieElement({ sides, value, rolling })            one die (a <div class="die">)
//   diceElement({ dice: [6, 6], rolls: [3, 4], rolling, onDone, ms })   a row of dice that animate once, then settle
//   rollOnce(key)                                     true the first time a key is seen (so a re-render does not re-roll)
import { h } from './dom.js';

const rolled = new Set();
export function rollOnce(key) { if (rolled.has(key)) return false; rolled.add(key); if (rolled.size > 200) rolled.delete(rolled.values().next().value); return true; }
export const dieImageUrl = (sides, variant = '') => `/dice/d${[4, 6, 8, 10, 12, 20].includes(Number(sides)) ? sides : 6}${variant ? '_' + variant : ''}.png`;

export function dieElement({ sides = 6, value = null, rolling = false, size = 84 } = {}) {
  const el = h('div', { class: `die d${sides} ${rolling ? 'rolling' : ''}`, style: { width: `${size}px`, height: `${size}px` }, 'aria-label': value == null ? `d${sides}` : `d${sides} shows ${value}` },
    h('img', { src: dieImageUrl(sides, rolling ? 'roll' : ''), alt: '', draggable: false, onError: (e) => { e.target.style.visibility = 'hidden'; } }),
    h('b', { class: 'face' }, value == null ? '?' : String(value)));
  return el;
}

// A row of dice. With `rolling` the faces tumble for `ms` then settle on `rolls`; onDone fires once after the settle.
export function diceElement({ dice = [6], rolls = [], rolling = false, ms = 900, onDone = null, size = 84 } = {}) {
  const row = h('div', { class: 'dice-row' });
  const dies = dice.map((sides, i) => { const d = dieElement({ sides, value: rolling ? null : rolls[i] ?? null, rolling, size }); row.append(d); return d; });
  if (!rolling) return row;
  const t0 = performance.now();
  const tick = () => {
    if (!row.isConnected) return;
    const t = performance.now() - t0;
    if (t >= ms) {
      dies.forEach((d, i) => { d.classList.remove('rolling'); d.querySelector('img').src = dieImageUrl(dice[i]); d.querySelector('.face').textContent = String(rolls[i] ?? '?'); d.classList.add('landed'); });
      onDone?.();
      return;
    }
    dies.forEach((d, i) => { d.querySelector('.face').textContent = String(1 + Math.floor(Math.random() * Number(dice[i] || 6))); });
    setTimeout(tick, 70 + t / 8);
  };
  setTimeout(tick, 60);
  return row;
}

// A small wheel-stop strip for the movement wheel: the outcomes in a row, the landed one lit.
// Segment widths follow the weights (the odds), like the wheel's slices; a zero-weight segment is left out.
export function wheelStrip({ outcomes = [], weights = null, index = 0, title = '' } = {}) {
  const w = outcomes.map((_, i) => { const v = Number(weights?.[i]); return weights ? (Number.isFinite(v) && v > 0 ? v : 0) : 1; });
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return h('div', { class: 'wheel-strip' }, title ? h('div', { class: 'tag' }, title) : null,
    h('div', { class: `segs${weights ? ' weighted' : ''}` }, outcomes.map((o, i) => w[i] <= 0 ? null : h('span', { class: `seg ${i === index ? 'hit' : ''}`, style: { flex: `${(w[i] / total * outcomes.length).toFixed(3)} 1 0`, minWidth: '0' }, title: weights ? `${Math.round(w[i] / total * 100)}%` : null }, String(o)))));
}
