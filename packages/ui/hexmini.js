// The phone mini-map (SPEC.md › Map, Phone UI): an SVG of the revealed hexes centred on the player, pannable by
// drag, with tile glyphs, players' tokens (crest letters), monsters and region names. Hex colours are painted ONLY
// when the caller passes a `colours` map (from cardView(): the mover wears Card boots, within range); otherwise every
// hex wears its region's accent, dimmed. Tapping a hex calls onTap(key, hex) unless the pointer moved (a drag).
//
//   hexMini({ state, me, c, size, height, colours, lit, path, onTap, centre, showNames })
//     colours: { 'q,r': 'oxblood' }     lit: Set of keys drawn bright (Card destinations, reachable hexes)
//     path: [keys] drawn as a dotted trail     centre: a hex key to centre on (default: my position)
import { h } from './dom.js';
import * as H from '../shared/hex.js';
import { tileGlyph, tileLabel, livingMonsterAt } from '../shared/map/query.js';
import { colourHex, colourInk } from './cards.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v); for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k))); return el; };
const VOID_FILL = { water: '#0a1016', chasm: '#0b0809', wall: '#15100f' };
const mix = (hex, amt = 0.25) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return '#1e1a16'; const n = parseInt(m[1], 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const f = (v) => Math.round(v * amt + 20 * (1 - amt)); return `rgb(${f(r)},${f(g)},${f(b)})`; };
const letterOf = (c) => { const n = String(c?.name || '?'); const ch = [...n][0] || '?'; return ch.toUpperCase(); };

export function hexMini({ state, me = null, c = null, size = 26, height = 220, colours = null, lit = null, path = null, onTap = null, centre = null, showNames = true, dim = null } = {}) {
  const wrap = h('div', { class: 'hexmini', style: { height: `${height}px` } });
  const map = state?.map;
  if (!map || !map.hexes || !Object.keys(map.hexes).length) { wrap.append(h('div', { class: 'hexmini-empty muted ital' }, 'The map is not rolled yet.')); return wrap; }
  const revealed = (rid) => !!(map.revealed?.[rid] || map.regions?.[rid]?.revealed);
  const hexes = Object.values(map.hexes).filter(hx => revealed(hx.regionId) || (c?.pos && H.distance(H.parse(c.pos), H.parse(hx.key)) <= 2));
  if (!hexes.length) { wrap.append(h('div', { class: 'hexmini-empty muted ital' }, 'Nothing revealed yet.')); return wrap; }
  const at = centre || c?.pos || map.start || hexes[0].key;
  const origin = H.toPixel(H.parse(at), size);
  const W = 360, Hh = Math.round(height * 360 / 360);   // viewBox in CSS-ish px: a 360-wide phone shows hexes at `size`
  const svg = s('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'hexmini-svg', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Mini-map' });
  const g = s('g', { class: 'pan' });
  svg.append(g);
  let tx = W / 2 - origin.x, ty = Hh / 2 - origin.y;
  const apply = () => g.setAttribute('transform', `translate(${tx.toFixed(1)} ${ty.toFixed(1)})`);
  apply();
  const litSet = lit instanceof Set ? lit : new Set(lit || []);
  const pathSet = new Set(path || []);
  const players = Object.values(state.characters || {}).filter(x => x.pos && !x.dead && Object.values(state.players).some(p => p.characterId === x.id && !p.kicked));
  const byHex = {}; for (const x of players) (byHex[x.pos] ||= []).push(x);
  // hexes
  for (const hx of hexes) {
    const { x, y } = H.toPixel(H.parse(hx.key), size);
    const region = map.regions?.[hx.regionId];
    const col = colours?.[hx.key];
    const isVoid = hx.void || VOID_FILL[hx.type];
    let fill = isVoid ? (VOID_FILL[hx.type] || '#0b0809') : col ? colourHex(col) : mix(region?.accent, 0.22);
    const isLit = litSet.has(hx.key), isMe = c?.pos === hx.key, onPath = pathSet.has(hx.key);
    const dimmed = dim && !dim.has(hx.key) && !isMe;
    const poly = s('polygon', { points: H.polygonPoints(x, y, size - 1.2), fill, stroke: isLit ? '#f0b66a' : isMe ? '#e0c07a' : hx.bridge ? '#c9a45c' : isVoid ? '#2a2220' : 'rgba(201,164,92,.35)', 'stroke-width': isLit || isMe ? 3 : hx.bridge ? 2 : 1, 'stroke-dasharray': isVoid ? '3 4' : null, opacity: dimmed ? 0.35 : 1, class: `hx ${isLit ? 'lit' : ''} ${isVoid ? 'void' : ''}` });
    const cell = s('g', { class: 'cell', 'data-key': hx.key, style: onTap && !isVoid ? 'cursor:pointer' : '' }, poly);
    if (!isVoid) {
      const glyph = tileGlyph(hx.type);
      cell.append(s('text', { x, y: y + 6, 'text-anchor': 'middle', 'font-size': hx.type === 'plain' ? 14 : 18, fill: col ? colourInk(col) : '#e9e1cf', opacity: hx.type === 'plain' ? 0.45 : 0.95, class: 'glyph' }, glyph));
      if (hx.gate) cell.append(s('text', { x, y: y - size * 0.55, 'text-anchor': 'middle', 'font-size': 9, fill: '#c9a45c', 'font-family': 'Cinzel, serif' }, 'GATE'));
      if (onPath && !isMe) cell.append(s('circle', { cx: x, cy: y, r: 4, fill: '#f0b66a' }));
      const loot = state.tileLoot?.[hx.key]?.length; if (loot) cell.append(s('circle', { cx: x + size * 0.5, cy: y + size * 0.5, r: 5, fill: '#e0c07a', stroke: '#1a1412' }));
      const m = livingMonsterAt(state, hx.key);
      if (m) cell.append(s('g', { class: 'mon' }, s('circle', { cx: x - size * 0.5, cy: y - size * 0.45, r: 8, fill: m.boss || m.final ? '#c0262e' : '#7a1a22', stroke: '#f2b3b3', 'stroke-width': 1.5 }), s('text', { x: x - size * 0.5, y: y - size * 0.45 + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#fff', 'font-family': 'Cinzel, serif' }, m.boss || m.final ? 'B' : 'M')));
      const here = byHex[hx.key] || [];
      here.slice(0, 3).forEach((x2, i) => {
        const px = x + (i - (Math.min(here.length, 3) - 1) / 2) * 13, py = y + size * 0.55;
        const mine = x2.id === c?.id;
        cell.append(s('g', { class: 'tok' }, s('rect', { x: px - 7, y: py - 8, width: 14, height: 16, rx: 2, fill: mine ? '#e0c07a' : '#1a1412', stroke: mine ? '#fff0c0' : '#c9a45c', 'stroke-width': 1 }), s('text', { x: px, y: py + 4, 'text-anchor': 'middle', 'font-size': 10, fill: mine ? '#1a1412' : '#e9e1cf', 'font-family': 'Cinzel, serif', 'font-weight': 700 }, letterOf(x2))));
      });
      if (here.length > 3) cell.append(s('text', { x: x + size * 0.7, y: y + size * 0.6, 'font-size': 9, fill: '#e0c07a' }, `+${here.length - 3}`));
    }
    g.append(cell);
  }
  // region names (centroid of revealed hexes)
  if (showNames) for (const region of Object.values(map.regions || {})) {
    if (!revealed(region.id)) continue;
    const keys = (region.hexKeys || []).filter(k => map.hexes[k] && !map.hexes[k].void); if (!keys.length) continue;
    let sx = 0, sy = 0, miny = Infinity; for (const k of keys) { const p = H.toPixel(H.parse(k), size); sx += p.x; sy += p.y; miny = Math.min(miny, p.y); }
    g.append(s('text', { x: sx / keys.length, y: miny - size * 0.9, 'text-anchor': 'middle', 'font-size': 13, fill: region.accent || '#c9a45c', 'font-family': 'Cinzel, serif', 'letter-spacing': 2, opacity: 0.9, class: 'rname' }, String(region.name || region.id).toUpperCase()));
  }
  // pan by drag; tap when the pointer did not move
  let drag = null;
  const scale = () => { const r = svg.getBoundingClientRect(); return r.width ? W / r.width : 1; };
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false }; svg.setPointerCapture?.(e.pointerId); });
  svg.addEventListener('pointermove', (e) => { if (!drag) return; const k = scale(); const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k; if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true; tx = drag.tx + dx; ty = drag.ty + dy; apply(); });
  const up = (e) => {
    if (!drag) return; const was = drag; drag = null;
    if (was.moved || !onTap) return;
    const cell = e.target.closest?.('.cell'); const key = cell?.dataset?.key; if (!key) return;
    const hx = map.hexes[key]; if (hx) onTap(key, hx);
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', () => { drag = null; });
  wrap.append(svg);
  // a recentre control
  wrap.append(h('button', { class: 'ghost recentre', type: 'button', 'aria-label': 'Centre on me', onClick: () => { tx = W / 2 - origin.x; ty = Hh / 2 - origin.y; apply(); } }, '⌖'));
  return wrap;
}
// A one-line description of a hex for the tile sheet.
export function hexInfo(state, key) {
  const hx = state?.map?.hexes?.[key]; if (!hx) return null;
  const region = state.map.regions?.[hx.regionId];
  const m = livingMonsterAt(state, key);
  const who = Object.values(state.characters || {}).filter(x => x.pos === key && !x.dead).map(x => x.name);
  return { hex: hx, region, label: tileLabel(hx.type), glyph: tileGlyph(hx.type), monster: m, who, loot: state.tileLoot?.[key] || [] };
}
