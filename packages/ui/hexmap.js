// The TV's hex map: an inked-parchment SVG of state.map (SPEC.md › Map, Shared screen, Art direction). Built once
// per map and patched on every render (a Map of key → element per layer), so a 200-hex map costs a few node edits
// per event, not a rebuild. Nothing hidden is drawn: no hex colours, no Health numbers, only the lantern tell.
//
//   renderHexMap(svgEl, state, { size, onHexClick, highlight, now, manifest }) → the build record
//
// Layers back to front: ground (hex fills, fog), marks (glyphs, bridges, gates, throne, courier), cartouches,
// path (the mover's walk), monsters, tokens (characters), crows (letters in flight), emotes.
import { toPixel, polygonPoints, neighbors, key as hexKey } from '../shared/hex.js';
import { TILES } from '../shared/map/query.js';
import { healthThird } from '../shared/health.js';
import { group } from '../shared/balance.js';
import { currentPlayerId, characterOf } from '../shared/state.js';
import { moveSummary } from '../shared/handlers/movement.js';
import regionsRaw from '../../data/regions.json' with { type: 'json' };
import { assetEntry, assetUrl } from './sprite.js';

const NS = 'http://www.w3.org/2000/svg';
const ACCENTS = Object.fromEntries(regionsRaw.regions.map(r => [r.id, r.accent]));
const builds = new WeakMap();

const el = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
  if (parent) parent.append(n);
  return n;
};
const setAttrs = (n, attrs) => { for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) n.removeAttribute(k); else if (n.getAttribute(k) !== String(v)) n.setAttribute(k, v); } return n; };
// Mix a hex colour towards a base: the region accent at 14–22% over the parchment-black is the "ink wash".
function mix(hex, base, t) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const a = p(hex), b = p(base);
  return '#' + a.map((v, i) => Math.round(v * t + b[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const realAsset = (key, manifest) => { const e = assetEntry(key, manifest); return e && e.placeholder === false ? assetUrl(e.path) : null; };
const letterOf = (type) => TILES[type]?.letter || '?';
const LANTERN = { high: '#f0a840', mid: '#c07a30', low: '#7a4020', dead: '#3a3230' };
const LANTERN_SCALE = { high: 1, mid: 0.72, low: 0.45, dead: 0.3 };

// ── geometry ───────────────────────────────────────────────────────
// Void hexes more than one step from any land hex are not drawn (the generator pads clusters generously), so the
// map fits the stage as tightly as the clusters allow.
function keptHexes(map) {
  const land = Object.values(map.hexes).filter(h => !h.void);
  const keep = new Set(land.map(h => h.key));
  for (const h of land) for (const n of neighbors(h)) { const k = hexKey(n); if (map.hexes[k]) keep.add(k); }
  return keep;
}
function layout(map, size) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const px = {}, keep = keptHexes(map);
  for (const h of Object.values(map.hexes)) { const p = toPixel(h, size); px[h.key] = p; if (!keep.has(h.key)) continue; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const pad = size * 1.6, top = size * 2.4, bottom = size * 1.9;
  return { px, keep, viewBox: `${minX - pad} ${minY - top} ${maxX - minX + pad * 2} ${maxY - minY + top + bottom}`, minX, minY, maxX, maxY, pad, top, bottom };
}
// Where a region's name goes: a corner of the cluster's bounding box that covers the fewest land hexes of other
// regions (the clusters touch at the bridges, so a fixed corner would sit on a neighbour); the centre as a last resort.
function regionCentre(map, r, px, size) {
  const keys = (r.hexKeys || []).filter(k => map.hexes[k] && !map.hexes[k].void);
  const pts = keys.map(k => px[k]).filter(Boolean);
  if (!pts.length && r.centre && px[r.centre]) return { x: px[r.centre].x, y: px[r.centre].y - size * 2, anchor: 'middle' };
  if (!pts.length) return null;
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y)), minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const w = String(r.name || r.id).length * size * 0.36, hh = size * 0.9;
  const others = Object.values(map.hexes).filter(h => !h.void && h.regionId !== r.id).map(h => px[h.key]);
  const cands = [
    { x: minX - size * 0.6, y: minY - size * 1.25, anchor: 'start' }, { x: maxX + size * 0.6, y: minY - size * 1.25, anchor: 'end' },
    { x: minX - size * 0.6, y: maxY + size * 1.7, anchor: 'start' }, { x: maxX + size * 0.6, y: maxY + size * 1.7, anchor: 'end' },
    { x: (minX + maxX) / 2, y: (minY + maxY) / 2, anchor: 'middle' },
  ];
  const own = pts;
  const score = (c) => { const x0 = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - w : c.x - w / 2, x1 = x0 + w, y0 = c.y - hh, y1 = c.y + size * 0.6; const hit = (p) => p.x > x0 - size * 0.5 && p.x < x1 + size * 0.5 && p.y > y0 - size * 0.5 && p.y < y1 + size * 0.5; return others.filter(hit).length * 3 + (c.anchor === 'middle' ? own.filter(hit).length : 0); };
  let best = cands[0], bs = Infinity; for (const c of cands) { const sc = score(c); if (sc < bs) { bs = sc; best = c; } }
  return best;
}

// ── build (once per map) ───────────────────────────────────────────
function build(svg, state, size, manifest, onHexClick) {
  const map = state.map, L = layout(map, size);
  svg.replaceChildren();
  svg.setAttribute('viewBox', L.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('font-family', 'Cinzel, serif');
  svg.classList.add('hexmap');
  const defs = el('defs', {}, svg);
  // Fog: ink that has not dried — a turbulence-displaced edge on the unrevealed clusters.
  const fog = el('filter', { id: 'hm-ink', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.035', numOctaves: '2', seed: String(map.seed % 97 || 3), result: 'n' }, fog);
  el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: String(size * 0.5), xChannelSelector: 'R', yChannelSelector: 'G' }, fog);
  const glow = el('filter', { id: 'hm-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: String(size * 0.12), result: 'b' }, glow);
  const mg = el('feMerge', {}, glow); el('feMergeNode', { in: 'b' }, mg); el('feMergeNode', { in: 'SourceGraphic' }, mg);
  const marker = el('marker', { id: 'hm-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto' }, defs);
  el('path', { d: 'M0 0L10 5L0 10z', fill: '#f0b66a' }, marker);
  // Ground textures when real art exists: one pattern per region (ground + void).
  const patterns = {};
  for (const r of Object.values(map.regions)) {
    for (const kind of ['ground', 'void']) {
      const url = realAsset(`tiles/${kind}_${r.id}`, manifest); if (!url) continue;
      const id = `hm-${kind}-${r.id}`; const p = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: size * 2, height: size * 2 }, defs);
      el('image', { href: url, width: size * 2, height: size * 2, preserveAspectRatio: 'xMidYMid slice' }, p);
      patterns[`${kind}_${r.id}`] = `url(#${id})`;
    }
  }
  const layers = {};
  for (const name of ['ground', 'marks', 'cartouches', 'path', 'monsters', 'tokens', 'crows', 'emotes', 'legend']) layers[name] = el('g', { class: `hm-${name}` }, svg);
  const regionGroups = {};
  for (const r of Object.values(map.regions)) {
    regionGroups[r.id] = { ground: el('g', { class: 'hm-region', 'data-region': r.id }, layers.ground), marks: el('g', { class: 'hm-region-marks', 'data-region': r.id }, layers.marks) };
  }
  const hexEls = {};
  for (const h of Object.values(map.hexes)) {
    if (!L.keep.has(h.key)) continue;
    const p = L.px[h.key], accent = ACCENTS[h.regionId] || '#8a7a62', g = regionGroups[h.regionId] || regionGroups[Object.keys(regionGroups)[0]];
    const pts = polygonPoints(p.x, p.y, size - 0.8);
    const isGate = !!h.gate || h.type === 'bossgate' || h.type === 'throne';
    let fill, stroke, extra = {};
    if (h.void) { fill = patterns[`void_${h.regionId}`] || mix(accent, '#0e0b0c', 0.05); stroke = mix(accent, '#2a2420', 0.25); extra = { opacity: 0.55 }; }
    else if (h.bridge) { fill = '#1e1a16'; stroke = h.gate ? '#c9a45c' : '#8a7a62'; extra = { 'stroke-dasharray': '3 2' }; }
    else { fill = patterns[`ground_${h.regionId}`] || mix(accent, '#15100f', 0.17); stroke = mix(accent, '#2b2320', 0.6); }
    const poly = el('polygon', { points: pts, fill, stroke, 'stroke-width': '1', class: `hm-hex${h.void ? ' void' : ''}${h.bridge ? ' bridge' : ''}`, 'data-key': h.key, ...extra }, g.ground);
    if (onHexClick) { poly.style.cursor = 'pointer'; poly.addEventListener('click', () => onHexClick(h)); }
    const marks = el('g', { class: 'hm-mark', transform: `translate(${p.x},${p.y})` }, g.marks);
    if (!h.void) {
      const glyphUrl = realAsset(`tiles/${h.type}`, manifest);
      if (h.bridge) el('text', { y: 3, 'text-anchor': 'middle', 'font-size': size * 0.27, fill: '#c9a45c', 'letter-spacing': '.5', text: h.gate ? 'GATE' : 'BRIDGE' }, marks);
      else if (h.type === 'throne') { el('circle', { r: size * 0.62, fill: 'none', stroke: '#e0c07a', 'stroke-width': 1.2, 'stroke-dasharray': '2 2' }, marks); el('text', { y: 3, 'text-anchor': 'middle', 'font-size': size * 0.3, fill: '#e0c07a', 'letter-spacing': '1', text: 'THRONE' }, marks); }
      else if (h.type === 'bossgate') { el('circle', { r: size * 0.6, fill: 'none', stroke: '#ff7a2a', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }, marks); el('text', { y: 3, 'text-anchor': 'middle', 'font-size': size * 0.28, fill: '#ffd0a0', 'letter-spacing': '1', text: 'GATE' }, marks); }
      else if (h.type === 'portal') el('text', { y: 3, 'text-anchor': 'middle', 'font-size': size * 0.27, fill: '#c9a45c', 'letter-spacing': '.5', text: 'PORTAL' }, marks);
      else if (h.type === 'start') el('text', { y: 3, 'text-anchor': 'middle', 'font-size': size * 0.27, fill: '#c9a45c', 'letter-spacing': '.5', text: 'THE SIGN' }, marks);
      else if (glyphUrl) el('image', { href: glyphUrl, x: -size * 0.4, y: -size * 0.4, width: size * 0.8, height: size * 0.8, opacity: 0.9 }, marks);
      else if (h.type !== 'plain') el('text', { y: size * 0.16, 'text-anchor': 'middle', 'font-size': size * 0.46, fill: '#e9e1cf', class: 'hm-glyph', text: letterOf(h.type) }, marks);
      if (h.gate && !h.bridge && h.type !== 'bossgate' && h.type !== 'throne') el('circle', { r: size * 0.7, fill: 'none', stroke: '#c9a45c', 'stroke-dasharray': '2 2' }, marks);
    }
    hexEls[h.key] = { poly, marks, hex: h };
  }
  // Region cartouches (name in the accent neon; the fog note under an unrevealed one).
  const cartouches = {};
  for (const r of Object.values(map.regions)) {
    const c = regionCentre(map, r, L.px, size); if (!c) continue;
    const g = el('g', { class: 'hm-cartouche', transform: `translate(${c.x},${c.y})` }, layers.cartouches);
    const url = realAsset(`map/cartouche_${r.id}`, manifest);
    if (url) el('image', { href: url, x: c.anchor === 'end' ? -size * 4.8 : c.anchor === 'middle' ? -size * 2.6 : -size * 0.4, y: -size * 1.1, width: size * 5.2, height: size * 1.6, preserveAspectRatio: `${c.anchor === 'end' ? 'xMax' : c.anchor === 'middle' ? 'xMid' : 'xMin'}YMid meet` }, g);
    const t = el('text', { 'text-anchor': c.anchor || 'start', 'font-size': size * 0.5, 'letter-spacing': '3', fill: ACCENTS[r.id] || '#c9a45c', stroke: '#15100f', 'stroke-width': size * 0.18, 'paint-order': 'stroke', 'stroke-linejoin': 'round', text: String(r.name || r.id).toUpperCase() }, g);
    const sub = el('text', { y: size * 0.5, 'text-anchor': c.anchor || 'start', 'font-size': size * 0.34, stroke: '#15100f', 'stroke-width': size * 0.14, 'paint-order': 'stroke', 'font-family': "'IM Fell English', serif", 'font-style': 'italic', fill: '#7a6a4a', text: 'unrevealed, ink not yet dry' }, g);
    cartouches[r.id] = { g, t, sub };
  }
  // Courier post marker (the crow's roost) and the legend.
  if (map.courier && L.px[map.courier]) { const p = L.px[map.courier]; const g = el('g', { class: 'hm-courier', transform: `translate(${p.x},${p.y - size * 0.55})` }, layers.marks); el('path', { d: crowPath(size * 0.45), fill: '#1a1618', stroke: '#8a7a62', 'stroke-width': 0.8 }, g); el('text', { y: size * 0.95, 'text-anchor': 'middle', 'font-size': size * 0.25, fill: '#8a7a62', 'letter-spacing': '.5', text: 'COURIER' }, g); }
  el('text', { x: L.minX - L.pad + size * 0.4, y: L.maxY + L.bottom - size * 0.35, 'font-family': "'IM Fell English', serif", 'font-size': size * 0.36, fill: '#8a7a62', text: 'E Encounter · C Chest · X Chaos · I Inn · B Blood Bank · $ Shop · G Graveyard · W Wheel · A Arena · F Event · % Bounty · dashed hex = gated bridge · void = impassable' }, layers.legend);
  const rec = { sig: mapSig(map), size, L, layers, regionGroups, hexEls, cartouches, tokens: new Map(), monsters: new Map(), crows: new Map(), emotes: new Map(), pathEls: null, ringEls: new Map(), lootEls: new Map(), fogState: {} };
  builds.set(svg, rec);
  return rec;
}
const mapSig = (map) => `${map.seed}:${Object.keys(map.hexes).length}:${map.courier}`;
export const crowPath = (s) => `M${-s} ${s * 0.1} C${-s * 0.6} ${-s * 0.5} ${-s * 0.2} ${-s * 0.4} 0 ${-s * 0.1} C${s * 0.2} ${-s * 0.4} ${s * 0.6} ${-s * 0.5} ${s} ${s * 0.1} C${s * 0.6} ${s * 0.05} ${s * 0.3} ${s * 0.15} 0 ${s * 0.4} C${-s * 0.3} ${s * 0.15} ${-s * 0.6} ${s * 0.05} ${-s} ${s * 0.1} Z`;
const flamePath = (k) => `M0 ${2 * k} C${4 * k} ${7 * k} ${6 * k} ${10 * k} ${6 * k} ${14 * k} A${6 * k} ${6 * k} 0 0 1 ${-6 * k} ${14 * k} C${-6 * k} ${10 * k} ${-4 * k} ${7 * k} 0 ${2 * k} Z`;

// ── patch (every render) ──────────────────────────────────────────
export function renderHexMap(svg, state, { size = 26, onHexClick = null, highlight = null, now = Date.now(), manifest = null } = {}) {
  const map = state.map; if (!map) { svg.replaceChildren(); builds.delete(svg); return null; }
  let rec = builds.get(svg);
  if (!rec || rec.sig !== mapSig(map) || rec.size !== size) rec = build(svg, state, size, manifest, onHexClick);
  const { L, layers, hexEls } = rec;
  const H = group(state, 'health');
  // Fog: an unrevealed region is undried ink while fogOfWar is on.
  const fogOn = state.gm?.fogOfWar !== false;
  for (const r of Object.values(map.regions)) {
    const revealed = !fogOn || !!(map.revealed?.[r.id] || r.revealed);
    if (rec.fogState[r.id] === revealed) continue; rec.fogState[r.id] = revealed;
    const g = rec.regionGroups[r.id]; if (!g) continue;
    g.ground.classList.toggle('fog', !revealed); g.marks.classList.toggle('fog', !revealed);
    setAttrs(g.ground, { filter: revealed ? null : 'url(#hm-ink)', opacity: revealed ? null : 0.62 });
    setAttrs(g.marks, { opacity: revealed ? null : 0.22 });
    const c = rec.cartouches[r.id]; if (c) { setAttrs(c.t, { opacity: revealed ? 1 : 0.55 }); setAttrs(c.sub, { display: revealed ? 'none' : null }); }
  }
  // Tile loot left on the ground (shown so anyone may take it).
  const lootKeys = new Set(Object.entries(state.tileLoot || {}).filter(([, v]) => v && v.length).map(([k]) => k));
  for (const k of lootKeys) if (!rec.lootEls.has(k) && hexEls[k]) { const p = L.px[k]; rec.lootEls.set(k, el('text', { x: p.x + size * 0.55, y: p.y - size * 0.45, 'font-size': size * 0.32, fill: '#e0c07a', class: 'hm-loot', text: '✦' }, layers.marks)); }
  for (const [k, n] of rec.lootEls) if (!lootKeys.has(k)) { n.remove(); rec.lootEls.delete(k); }

  // The mover's path (dice/wheel: every hex walked; Card boots: only the end hex) and the highlight ring.
  const mover = currentPlayerId(state), ms = state.phase === 'playing' ? moveSummary(state) : null;
  layers.path.replaceChildren(); rec.pathEls = null;
  const ring = (key, colour, width = 2) => { const p = L.px[key]; if (!p) return; el('polygon', { points: polygonPoints(p.x, p.y, size - 0.8), fill: 'none', stroke: colour, 'stroke-width': width, class: 'hm-ring' }, layers.path); };
  if (ms && ms.playerId && !ms.done || (ms && ms.done && now - (state.lastEventTs || 0) < 6000)) {
    const mc = characterOf(state, ms.playerId);
    if (ms.mode === 'card') { if (ms.endKey) ring(ms.endKey, '#f0b66a'); }
    else if (ms.path?.length) {
      const keys = [ms.from, ...ms.path].filter(k => L.px[k]);
      for (const k of ms.path) ring(k, '#f0b66a', 1.6);
      const pts = keys.map((k, i) => { const p = L.px[k]; if (i === keys.length - 1 && keys.length > 1) { const q = L.px[keys[i - 1]]; const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1; return `${p.x - dx / d * size * 0.45},${p.y - dy / d * size * 0.45}`; } return `${p.x},${p.y}`; });
      el('polyline', { points: pts.join(' '), fill: 'none', stroke: '#f0b66a', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'marker-end': 'url(#hm-arrow)' }, layers.path);
      const last = L.px[keys.at(-1)];
      const label = ms.mode === 'wheel' ? `wheel: ${ms.wheel?.label || ms.roll}` : ms.mode === 'barefoot' ? 'plods' : `rolled ${ms.roll}`;
      el('text', { x: last.x, y: last.y + size * 1.3, 'text-anchor': 'middle', 'font-size': size * 0.34, 'font-family': "'IM Fell English', serif", 'font-style': 'italic', fill: '#f0b66a', text: `${label}${ms.done ? '' : ` · ${ms.movesLeft} move${ms.movesLeft === 1 ? '' : 's'} left`}${mc?.name ? ` · ${mc.name}` : ''}` }, layers.path);
    }
  }
  if (highlight) ring(highlight, '#e0c07a', 2.4);

  // Monsters: a token on their hex; a tiny health bar only during a fight with that monster.
  const f = state.fight && !state.fight.done ? state.fight : null;
  const seenM = new Set();
  for (const m of Object.values(state.monsters || {})) {
    if (!m.pos || m.dead || !L.px[m.pos] || m.dummy) continue;
    const regionRevealed = !fogOn || map.revealed?.[map.hexes[m.pos]?.regionId];
    if (!regionRevealed && !m.final) continue;
    seenM.add(m.id);
    const p = L.px[m.pos];
    let g = rec.monsters.get(m.id);
    const big = m.boss || m.raid || m.final;
    if (!g) {
      g = el('g', { class: `hm-monster${big ? ' boss' : ''}`, 'data-id': m.id }, layers.monsters);
      const url = realAsset(`monsters/${m.speciesId}_token`, manifest);
      el('circle', { r: big ? size * 0.78 : size * 0.52, fill: big ? '#3a1208' : '#2a1416', stroke: big ? '#ff7a2a' : '#c0262e', 'stroke-width': big ? 3 : 1.6, class: 'tok-body' }, g);
      if (big) el('circle', { r: size * 1.02, fill: 'none', stroke: '#ff7a2a', 'stroke-opacity': 0.35, 'stroke-width': 2, class: 'tok-halo' }, g);
      if (url) el('image', { href: url, x: -size * 0.5, y: -size * 0.5, width: size, height: size, 'clip-path': 'circle(50%)' }, g);
      else el('text', { y: size * 0.13, 'text-anchor': 'middle', 'font-size': big ? size * 0.34 : size * 0.4, fill: big ? '#ffd0a0' : '#f2b3b3', text: big ? 'BOSS' : 'M' }, g);
      const bar = el('g', { class: 'hm-hbar', display: 'none' }, g);
      el('rect', { x: -size * 0.7, y: size * 0.72, width: size * 1.4, height: size * 0.16, fill: '#2a1a1c', stroke: '#5a1218', 'stroke-width': 0.6 }, bar);
      el('rect', { x: -size * 0.7, y: size * 0.72, width: size * 1.4, height: size * 0.16, fill: '#9a1a28', class: 'fillbar' }, bar);
      g.__bar = bar;
      rec.monsters.set(m.id, g);
    }
    setAttrs(g, { transform: `translate(${p.x},${p.y - (big ? 0 : size * 0.05)})` });
    const inFight = f && f.monsterId === m.id;
    setAttrs(g.__bar, { display: inFight ? null : 'none' });
    if (inFight) setAttrs(g.__bar.querySelector('.fillbar'), { width: Math.max(0, size * 1.4 * (m.maxHealth ? m.health / m.maxHealth : 0)) });
    g.classList.toggle('fighting', !!inFight);
  }
  for (const [id, g] of rec.monsters) if (!seenM.has(id)) { g.remove(); rec.monsters.delete(id); }

  // Character tokens: a worn tarot card with the initial, the class mark colour, the lantern (the only Health tell).
  const byHex = {};
  const chars = Object.values(state.characters || {}).filter(c => c.pos && L.px[c.pos] && state.players[c.playerId] && !state.players[c.playerId].kicked && !c.flags?.hiddenOnTv);
  for (const c of chars) (byHex[c.pos] ||= []).push(c);
  const seenC = new Set();
  for (const [key, list] of Object.entries(byHex)) {
    const p = L.px[key]; list.sort((a, b) => a.id < b.id ? -1 : 1);
    list.forEach((c, i) => {
      seenC.add(c.id);
      const third = healthThird(c, H), isMover = c.playerId === mover;
      let g = rec.tokens.get(c.id);
      if (!g) {
        g = el('g', { class: 'hm-token', 'data-id': c.id }, layers.tokens);
        const tilt = Math.round((hash(c.id) - 0.5) * 14);
        el('rect', { x: -size * 0.5, y: -size, width: size, height: size, rx: 3, fill: '#1a1412', stroke: '#c9a45c', 'stroke-width': 1.2, transform: `rotate(${tilt})`, class: 'tok-card' }, g);
        el('text', { y: -size * 0.32, 'text-anchor': 'middle', 'font-size': size * 0.42, fill: '#e9e1cf', class: 'tok-initial', text: initial(c) }, g);
        const lamp = el('g', { class: 'tok-lantern' }, g);
        el('path', { d: flamePath(size / 26), class: 'flame' }, lamp);
        el('path', { d: `M0 ${8 * size / 26} C${2 * size / 26} ${11 * size / 26} ${3 * size / 26} ${12 * size / 26} ${3 * size / 26} ${14 * size / 26} A${3 * size / 26} ${3 * size / 26} 0 0 1 ${-3 * size / 26} ${14 * size / 26} C${-3 * size / 26} ${12 * size / 26} ${-2 * size / 26} ${11 * size / 26} 0 ${8 * size / 26} Z`, fill: '#fff0c0', class: 'flame-core' }, lamp);
        el('text', { y: -size * 1.15, 'text-anchor': 'middle', 'font-size': size * 0.3, fill: '#c9bfae', class: 'tok-name' }, g);
        rec.tokens.set(c.id, g);
      }
      const n = list.length, off = n > 1 ? (i - (n - 1) / 2) * size * 0.55 : 0;
      setAttrs(g, { transform: `translate(${p.x + off},${p.y + (n > 1 ? (i % 2) * size * 0.25 : 0)})`, class: `hm-token third-${third}${isMover ? ' mover' : ''}${c.dead ? ' dead' : ''}` });
      const card = g.querySelector('.tok-card'); setAttrs(card, { stroke: c.dead ? '#4a3f36' : isMover ? '#f0b66a' : third === 'high' ? '#c9a45c' : third === 'mid' ? '#8a7a62' : '#6a3a3a', 'stroke-width': isMover ? 2 : 1.2 });
      setAttrs(g.querySelector('.tok-initial'), { fill: c.dead ? '#6a5f55' : third === 'high' ? '#e9e1cf' : third === 'mid' ? '#c9bfae' : '#a08a7a' });
      const flame = g.querySelector('.flame'); setAttrs(flame, { fill: LANTERN[third], transform: `translate(0 ${(1 - LANTERN_SCALE[third]) * 12 * size / 26}) scale(${LANTERN_SCALE[third]})` });
      setAttrs(g.querySelector('.flame-core'), { display: third === 'high' ? null : 'none' });
      const nm = g.querySelector('.tok-name'); nm.textContent = isMover ? c.name : ''; setAttrs(nm, { display: isMover ? null : 'none' });
    });
  }
  for (const [id, g] of rec.tokens) if (!seenC.has(id)) { g.remove(); rec.tokens.delete(id); }

  // Letters in flight: a crow between sender and recipient, as far along as the delivery count says.
  const seenL = new Set();
  for (const l of state.letters || []) {
    if (l.deliveredAt || l.destroyed) continue;
    const a = characterOf(state, l.fromId), b = characterOf(state, l.toId); if (!a?.pos || !b?.pos || !L.px[a.pos] || !L.px[b.pos]) continue;
    seenL.add(l.id);
    const turns = Math.max(0, (state.turnCounts?.[l.toId] || 0) - (l.recipientTurnsAtSend || 0)), t = Math.min(0.92, 0.12 + 0.8 * turns / Math.max(1, l.deliverAfterTurns || 2));
    const pa = L.px[a.pos], pb = L.px[b.pos];
    const x = pa.x + (pb.x - pa.x) * t, y = pa.y + (pb.y - pa.y) * t - size * 1.1 - Math.sin(t * Math.PI) * size;
    let g = rec.crows.get(l.id);
    if (!g) {
      g = el('g', { class: `hm-crow${l.intercepted ? ' broken' : ''}` }, layers.crows);
      const url = realAsset('letters/crow', manifest);
      if (url) el('image', { href: url, x: -size * 0.6, y: -size * 0.45, width: size * 1.2, height: size * 0.9 }, g);
      else el('path', { d: crowPath(size * 0.6), fill: '#1a1618', stroke: '#3a3238', 'stroke-width': 1 }, g);
      el('rect', { x: -size * 0.14, y: size * 0.05, width: size * 0.28, height: size * 0.2, fill: '#e9e1cf' }, g);
      el('circle', { cy: size * 0.15, r: size * 0.05, fill: l.intercepted ? '#3a3230' : '#8a1a24' }, g);
      rec.crows.set(l.id, g);
    }
    setAttrs(g, { transform: `translate(${x},${y}) scale(${pb.x < pa.x ? -1 : 1},1)` });
  }
  for (const [id, g] of rec.crows) if (!seenL.has(id)) { g.remove(); rec.crows.delete(id); }

  // Emotes float over the sender's token for a few seconds.
  const seenE = new Set();
  for (const e of (state.emotes || []).slice(-8)) {
    if (now - (e.ts || 0) > 4000) continue;
    const c = characterOf(state, e.playerId); if (!c?.pos || !L.px[c.pos]) continue;
    seenE.add(e.id);
    if (rec.emotes.has(e.id)) continue;
    const p = L.px[c.pos];
    const g = el('g', { class: 'hm-emote', transform: `translate(${p.x},${p.y - size * 1.5})` }, layers.emotes);
    const text = e.emoji || e.text || '…';
    if (!e.emoji && e.text) { el('rect', { x: -size * 1.6, y: -size * 0.5, width: size * 3.2, height: size * 0.7, rx: 4, fill: '#1a1412', stroke: '#8a7a62', 'stroke-width': 0.6 }, g); }
    el('text', { 'text-anchor': 'middle', 'font-size': e.emoji ? size * 0.9 : size * 0.36, 'font-family': e.emoji ? null : "'IM Fell English', serif", fill: '#e9e1cf', text: String(text).slice(0, 28) }, g);
    rec.emotes.set(e.id, g);
  }
  for (const [id, g] of rec.emotes) if (!seenE.has(id)) { g.remove(); rec.emotes.delete(id); }
  return rec;
}
const initial = (c) => { const n = String(c.name || '?').trim(); const ch = n.charAt(0).toUpperCase(); return /[A-Z0-9]/.test(ch) ? ch : (n.codePointAt(0) ? String.fromCodePoint(n.codePointAt(0)) : '?'); };
// Pixel centre of a hex in the svg's own coordinate space (for HTML overlays that follow a token).
export function hexClientPoint(svg, key) {
  const rec = builds.get(svg); if (!rec || !rec.L.px[key]) return null;
  const p = rec.L.px[key], pt = svg.createSVGPoint(); pt.x = p.x; pt.y = p.y;
  const m = svg.getScreenCTM(); if (!m) return null; const o = pt.matrixTransform(m); const r = svg.getBoundingClientRect();
  return { x: o.x - r.left, y: o.y - r.top };
}
