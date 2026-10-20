// The recap (SPEC.md › End of the run): placings, per-player cards, and inline-SVG charts built from the ledger.
// Health over rounds is reconstructed per character from the 'health' ledger rows (every Health move writes one),
// walking back from the final value; rounds are time bins between startedAt and endedAt (the ledger rows carry
// `ts`, not a round number). Everything is gold / bone / oxblood; no library.
//
//   placingsOf(state)                 → [{ pid, name, charName, classId, level, placing, winner, survived, kills, bosses, petsCaught, gold, score }]
//   healthSeries(state)               → { rounds, series: [{ charId, name, pid, points: [health per round], max }] }
//   lineChart({ series, rounds }, o)  → <svg>     barChart(rows, o) → <svg>
import { h } from './dom.js';
import { characterOf, activeSeats } from '../shared/state.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, parent = null) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } if (parent) parent.append(n); return n; };
export const SERIES_COLOURS = ['#e0c07a', '#c0262e', '#6fd36a', '#8f6cff', '#f0b66a', '#9aa7b0', '#d13c9f', '#6a5a3a'];
const CLASS_NAMES = { whale: 'Whale', pitboss: 'Pit Boss', cutpurse: 'Cutpurse', enforcer: 'Enforcer', beastmaster: 'Beastmaster', croupier: 'Croupier' };
export const className = (id) => CLASS_NAMES[id] || id || '—';

export function placingsOf(state) {
  const rows = (state.metaLedger || []).filter(r => r.placing != null && state.players[r.playerId]);
  if (rows.length) return rows.map(r => ({ pid: r.playerId, name: r.name, charName: r.characterName, classId: r.classId, level: r.level, placing: r.placing, winner: !!r.winner, survived: !!r.survived, kills: r.kills || 0, bosses: r.bosses || 0, petsCaught: r.petsCaught || 0, gold: r.gold || 0, score: r.score || 0 })).sort((a, b) => a.placing - b.placing);
  // Before the ledger closes (or on an imported room): a plain order — winner, survivors by score, the dead.
  const seats = activeSeats(state);
  const out = seats.map(pid => { const c = characterOf(state, pid), p = state.players[pid], st = state.stats[pid] || {}; return { pid, name: p.name, charName: c?.name || null, classId: c?.classId, level: c?.level, winner: state.winner === pid, survived: !!c && !c.dead, kills: c?.kills || 0, bosses: st.bosses || 0, petsCaught: st.petsCaught || 0, gold: c?.gold || 0, score: (c?.gold || 0) + (c?.kills || 0) * 50 + (c && !c.dead ? c.health : 0) }; });
  out.sort((a, b) => (b.winner - a.winner) || (b.survived - a.survived) || (b.score - a.score));
  return out.map((r, i) => ({ ...r, placing: i + 1 }));
}

export function healthSeries(state, { bins = null } = {}) {
  const start = state.startedAt || state.ledger?.[0]?.ts || 0, end = state.endedAt || state.lastEventTs || start + 1;
  const rounds = Math.max(1, Math.min(60, bins || state.round || 1));
  const binOf = (ts) => Math.max(0, Math.min(rounds - 1, Math.floor((ts - start) / Math.max(1, end - start) * rounds)));
  const series = [];
  for (const pid of activeSeats(state)) {
    const c = characterOf(state, pid); if (!c) continue;
    const rows = (state.ledger || []).filter(r => r.kind === 'health' && r.charId === c.id && r.ts >= start);
    const final = c.dead ? 0 : c.health;
    // Walk back: the value at the end of bin k = final − Σ moved in bins > k.
    const movedPerBin = new Array(rounds).fill(0); for (const r of rows) movedPerBin[binOf(r.ts)] += r.moved || 0;
    const points = new Array(rounds); let v = final;
    for (let k = rounds - 1; k >= 0; k--) { points[k] = v; v -= movedPerBin[k]; }
    const startValue = v;
    series.push({ charId: c.id, pid, name: c.name, points: [startValue, ...points], max: Math.max(c.maxHealth || 100, startValue, ...points), dead: !!c.dead });
  }
  return { rounds, series };
}

export function lineChart({ series, rounds }, { width = 720, height = 260, title = 'Health over the run' } = {}) {
  const padL = 44, padR = 16, padT = 30, padB = 30, W = width - padL - padR, H = height - padT - padB;
  const max = Math.max(10, ...series.map(x => x.max)), n = rounds + 1;
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'recap-chart', role: 'img', 'aria-label': title });
  s('text', { x: padL, y: 18, 'font-family': 'Cinzel, serif', 'font-size': 13, 'letter-spacing': 2, fill: '#8a7a62', text: title.toUpperCase() }, svg);
  for (let i = 0; i <= 4; i++) { const y = padT + H - H * i / 4; s('line', { x1: padL, x2: width - padR, y1: y, y2: y, stroke: '#3a3230', 'stroke-width': 1, 'stroke-dasharray': i ? '2 3' : null }, svg); s('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#8a7a62', 'font-family': "'IM Fell English', serif", text: Math.round(max * i / 4) }, svg); }
  const xs = (i) => padL + (n > 1 ? W * i / (n - 1) : W / 2), ys = (v) => padT + H - H * Math.max(0, v) / max;
  for (let r = 0; r <= rounds; r += Math.max(1, Math.round(rounds / 8))) s('text', { x: xs(r), y: height - 10, 'text-anchor': 'middle', 'font-size': 11, fill: '#8a7a62', 'font-family': "'IM Fell English', serif", text: r === 0 ? 'start' : `R${r}` }, svg);
  series.forEach((x, i) => {
    const colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
    const pts = x.points.map((v, k) => `${xs(k).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
    s('polyline', { points: pts, fill: 'none', stroke: colour, 'stroke-width': 2.2, 'stroke-linejoin': 'round', opacity: x.dead ? 0.7 : 1 }, svg);
    const last = x.points.at(-1); s('circle', { cx: xs(x.points.length - 1), cy: ys(last), r: 3.5, fill: x.dead ? '#0d0a0b' : colour, stroke: colour, 'stroke-width': 1.5 }, svg);
    s('text', { x: width - padR, y: 18 - 0, 'text-anchor': 'end', dx: -(series.length - 1 - i) * 92, 'font-size': 11, fill: colour, 'font-family': "'IM Fell English', serif", text: `● ${x.name}${x.dead ? ' †' : ''}` }, svg);
  });
  return svg;
}
// rows: [{ label, values: [{ v, colour, name }] }]  grouped bars per player.
export function barChart(rows, { width = 460, height = 220, title = '', legend = [] } = {}) {
  const padL = 96, padR = 16, padT = 44, padB = 16, W = width - padL - padR, H = height - padT - padB;
  const max = Math.max(1, ...rows.flatMap(r => r.values.map(v => v.v)));
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'recap-chart', role: 'img', 'aria-label': title });
  s('text', { x: padL, y: 18, 'font-family': 'Cinzel, serif', 'font-size': 13, 'letter-spacing': 2, fill: '#8a7a62', text: title.toUpperCase() }, svg);
  legend.forEach((l, i) => { s('rect', { x: width - padR - 130 + i * 66, y: 26, width: 10, height: 10, fill: l.colour }, svg); s('text', { x: width - padR - 116 + i * 66, y: 36, 'font-size': 11, fill: '#c9bfae', 'font-family': "'IM Fell English', serif", text: l.name }, svg); });
  const rowH = H / Math.max(1, rows.length), barH = Math.min(16, rowH / (Math.max(1, rows[0]?.values.length || 1) + 0.6));
  rows.forEach((r, i) => {
    const y0 = padT + rowH * i + (rowH - barH * r.values.length) / 2;
    s('text', { x: padL - 10, y: y0 + barH * r.values.length / 2 + 4, 'text-anchor': 'end', 'font-size': 13, fill: '#e9e1cf', 'font-family': 'Cinzel, serif', text: r.label }, svg);
    r.values.forEach((v, k) => { const w = W * v.v / max; s('rect', { x: padL, y: y0 + barH * k, width: Math.max(0, w), height: barH - 2, fill: v.colour, rx: 1 }, svg); s('text', { x: padL + w + 6, y: y0 + barH * k + barH - 4, 'font-size': 11, fill: '#c9bfae', 'font-family': "'IM Fell English', serif", text: v.v }, svg); });
  });
  return svg;
}

// A one-line tally row (kills · bosses · pets · gold) used on the player cards.
export function tallyRow(items) { return h('div', { class: 'tally' }, items.map(([label, value]) => h('div', { class: 'tally-item' }, h('div', { class: 'tally-v display' }, String(value)), h('div', { class: 'tally-l' }, label)))); }
export const ordinal = (n) => { const m = n % 100; if (m >= 11 && m <= 13) return `${n}th`; return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`; };
