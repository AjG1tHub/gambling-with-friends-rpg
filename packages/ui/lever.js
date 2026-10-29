// The lever widget: how much better (or worse) the odds are at the player's stat, drawn as a 10-bar curve.
//   leverBar({ gameId, statValue, compact })  → <div class="lever">
// Shared by the phone (round head, attack menu, item sheet, Self), the GM proxy and the Lab.
import { h } from './dom.js';
import { leverView, oddsLines, cap, returnPct } from '../games/lever-view.js';

const svgNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent = null) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.append(e); return e; };

export function leverCurve(v, { width = 220, height = 54 } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'lever-curve', role: 'img', 'aria-label': `return by ${v.stat}` });
  const n = v.curve.length, gap = 3, bw = (width - gap * (n - 1)) / n;
  const lo = Math.min(0.6, ...v.curve.map(c => c.rtp)), hi = Math.max(1.3, ...v.curve.map(c => c.rtp));
  const y = (r) => height - 14 - ((r - lo) / (hi - lo)) * (height - 18);
  // the 100% line
  if (lo < 1 && hi > 1) el('line', { x1: 0, x2: width, y1: y(1).toFixed(1), y2: y(1).toFixed(1), class: 'lever-even' }, svg);
  v.curve.forEach((c, i) => {
    const x = i * (bw + gap), top = y(c.rtp);
    const cls = c.stat === v.value ? 'yours' : c.stat === v.neutral ? 'neutral' : c.stat < v.neutral ? 'below' : 'above';
    el('rect', { x: x.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: Math.max(2, height - 14 - top).toFixed(1), rx: 2, class: `lever-bar ${cls}` }, svg);
    const t = el('text', { x: (x + bw / 2).toFixed(1), y: height - 3, 'text-anchor': 'middle', class: `lever-tick ${cls}` }, svg); t.textContent = String(c.stat);
  });
  return svg;
}

export function leverBar({ gameId, statValue, compact = false } = {}) {
  const v = leverView(gameId, statValue); if (!v) return null;
  const sign = v.deltaPts > 0 ? '+' : '';
  const headline = h('div', { class: 'lever-head' },
    h('span', { class: 'lever-stat' }, `${cap(v.stat)} ${v.value}`),
    h('span', { class: `lever-delta ${v.deltaPts > 0 ? 'up' : v.deltaPts < 0 ? 'down' : ''}` }, `${sign}${v.deltaPts}`),
    h('span', { class: 'lever-ret' }, `return ${returnPct(v.yours.rtp)}`, h('span', { class: 'muted' }, ` · base ${returnPct(v.base.rtp)}`)));
  if (compact) return h('div', { class: 'lever compact' }, headline);
  // Base odds vs your odds: the game's own numbers at neutral and at this stat.
  const lines = oddsLines(gameId, statValue);
  const table = lines.length ? h('table', { class: 'lever-odds' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Base odds'), h('th', { class: 'yours' }, `Your odds (${cap(v.stat)} ${v.value})`))),
    h('tbody', {}, lines.map(l => h('tr', { class: l.changed ? 'changed' : '' }, h('td', {}, l.label), h('td', {}, l.base), h('td', { class: 'yours' }, l.yours))))) : null;
  return h('div', { class: 'lever' }, headline, table, leverCurve(v), h('div', { class: 'lever-text muted' }, `${v.text}. Wins ${Math.round(v.yours.win * 100)}% of rounds at your ${v.stat} (${Math.round(v.base.win * 100)}% at neutral).`));
}
