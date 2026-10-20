// Wheels on the TV (SPEC.md › Wheels and randomness). The result is already in state.lastSpin; the TV only animates
// the pointer landing on `index`, so the spin never decides anything. Faces: assets/wheels/<id>.svg (with
// <g id="segments"> / <g id="labels">) is inlined and relabelled when it is real art; placeholders and mismatched
// segment counts fall back to the SVG drawn here, so a GM relabelling a wheel in config never breaks the face.
//
//   wheelElement({ outcomes, colors?, face?, size? })  → <div class="wheel"> with .wheel-rotor to turn
//   spinTo(el, index, { ms, turns })                   → Promise, resolved when the rotor has landed on `index`
//   spinOverlay(stage, lastSpin, { now })              → shows/keeps the overlay for state.lastSpin; never re-animates a ts
import { h } from './dom.js';
import { WHEEL_SPIN_MS } from './sound.js';
import { assetEntry, assetUrl } from './sprite.js';
import petsRaw from '../../data/pets.json' with { type: 'json' };

const SPECIES = Object.fromEntries((petsRaw.species || []).map(sp => [sp.id, sp.name]));
const petLabel = (id) => (id === 'dud' || !id ? 'dud egg' : SPECIES[id] || id);

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#17111a', '#5a1a1a', '#1a1612', '#2a1020', '#0f1e18', '#3a1208'];
const TITLES = { buyin: 'Buy-in Wheel', chaos: 'Chaos Wheel', fortune: 'Fortune Wheel', fate: 'Fate Wheel', loot: 'Loot Wheel', boss: 'Boss Wheel', movement: 'Movement Wheel', challenge: 'Challenge Wheel', pets: 'Triple Pet Wheel', pet_common: 'Common pool', pet_region: 'Region pool', pet_rare: 'Rare pool' };
const svgEl = (tag, attrs = {}, parent = null) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } if (parent) parent.append(n); return n; };
const faceCache = new Map();
async function loadFace(id) {
  const e = assetEntry(`wheels/${id}`); if (!e || e.placeholder !== false) return null;
  if (!faceCache.has(id)) faceCache.set(id, fetch(assetUrl(e.path)).then(r => r.ok ? r.text() : null).catch(() => null));
  return faceCache.get(id);
}

// Draw a wheel face: n wedges, labels along each wedge's bisector, a brass rim and a bone hub.
function drawFace(svg, outcomes, colors) {
  const n = Math.max(1, outcomes.length), R = 480, cx = 512, cy = 512, step = 360 / n;
  svg.replaceChildren();
  svgEl('circle', { cx, cy, r: 500, fill: '#120d10' }, svg);
  svgEl('circle', { cx, cy, r: 492, fill: 'none', stroke: '#c9a24a', 'stroke-width': 10 }, svg);
  const segs = svgEl('g', { id: 'segments' }, svg), labels = svgEl('g', { id: 'labels' }, svg);
  const pt = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  for (let i = 0; i < n; i++) {
    const a0 = i * step - step / 2, a1 = a0 + step, [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
    const d = n === 1 ? `M${cx - R},${cy} A${R},${R} 0 1,1 ${cx + R},${cy} A${R},${R} 0 1,1 ${cx - R},${cy} Z` : `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${step > 180 ? 1 : 0},1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
    svgEl('path', { d, fill: colors?.[i] || PALETTE[i % PALETTE.length], stroke: '#9c7a2e', 'stroke-width': 3, 'data-index': i }, segs);
    const label = String(outcomes[i] ?? ''), mid = i * step, short = label.length > 22 ? label.slice(0, 21) + '…' : label;
    if (n <= 8) {
      // Few segments: the label sits across the wedge, upright-ish, sized to fit the chord.
      const fs = Math.max(22, Math.min(48, 1200 / Math.max(6, short.length) / Math.max(1, n / 6)));
      const [lx, ly] = pt(mid, R * 0.6);
      const rot = mid > 90 && mid < 270 ? mid + 180 : mid;      // keep the bottom half's labels upright
      svgEl('text', { x: lx.toFixed(1), y: ly.toFixed(1), transform: `rotate(${rot} ${lx.toFixed(1)} ${ly.toFixed(1)})`, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'Cinzel, serif', 'font-size': fs, fill: '#e9e1cf', 'letter-spacing': '1', text: short }, labels);
    } else {
      // Many segments: the label runs along the spoke from the hub outward, sized to the wedge's width.
      const arc = 2 * Math.PI * R * 0.55 / n, fs = Math.max(16, Math.min(34, arc * 0.72, 560 / Math.max(6, short.length)));
      const [lx, ly] = pt(mid, R * 0.22);
      svgEl('text', { x: lx.toFixed(1), y: ly.toFixed(1), transform: `rotate(${mid - 90} ${lx.toFixed(1)} ${ly.toFixed(1)})`, 'text-anchor': 'start', 'dominant-baseline': 'middle', 'font-family': 'Cinzel, serif', 'font-size': fs, fill: '#e9e1cf', 'letter-spacing': '.5', text: short }, labels);
    }
  }
  svgEl('circle', { cx, cy, r: 70, fill: '#e9e1cf', stroke: '#c9a24a', 'stroke-width': 8 }, svg);
  svgEl('circle', { cx, cy, r: 22, fill: '#5a1218' }, svg);
}
// Try a real face: inline it and relabel its <g id="labels">; keep our own when the segment count differs.
async function applyFace(svg, faceId, outcomes) {
  const text = await loadFace(faceId); if (!text) return false;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'); const root = doc.documentElement;
  const segs = root.querySelector('#segments'); if (!segs || segs.children.length !== outcomes.length) return false;
  const vb = root.getAttribute('viewBox') || '0 0 1024 1024'; svg.setAttribute('viewBox', vb);
  svg.replaceChildren(...[...root.childNodes].map(n => document.importNode(n, true)));
  const labels = svg.querySelector('#labels'); if (labels) labels.querySelectorAll('text').forEach((t, i) => { if (outcomes[i] != null) t.textContent = String(outcomes[i]); });
  return true;
}

export function wheelElement({ outcomes = [], colors = null, face = null, size = null, title = null } = {}) {
  const svg = svgEl('svg', { viewBox: '0 0 1024 1024', class: 'wheel-face' });
  drawFace(svg, outcomes, colors);
  if (face) applyFace(svg, face, outcomes).catch(() => {});
  const rotor = h('div', { class: 'wheel-rotor' }); rotor.append(svg);
  const pointer = h('div', { class: 'wheel-pointer', 'aria-hidden': 'true' });
  const el = h('div', { class: 'wheel', style: size ? { width: size, height: size } : {} }, rotor, pointer);
  el.__wheel = { outcomes, rotor, angle: 0 };
  if (title) el.append(h('div', { class: 'wheel-title' }, title));
  return el;
}
export const segmentAngle = (n, index) => (n ? 360 / n * index : 0);
// Rotate the rotor so segment `index` (its centre) sits under the top pointer. Time-driven (not a CSS transition),
// so a re-parented wheel keeps spinning; ease-out cubic with `turns` extra full turns.
export function spinTo(el, index, { ms = WHEEL_SPIN_MS, turns = 5, start = null } = {}) {
  const w = el.__wheel; if (!w) return Promise.resolve();
  const n = w.outcomes.length || 1, target = -(segmentAngle(n, index)) + 360 * turns;
  const from = w.angle % 360, t0 = start ?? performance.now();
  if (w.raf) cancelAnimationFrame(w.raf);
  return new Promise((done) => {
    const tick = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / ms)), e = 1 - Math.pow(1 - p, 3);
      w.angle = from + (target - from) * e; w.rotor.style.transform = `rotate(${w.angle}deg)`;
      const seg = Math.round(((-w.angle % 360) + 360) % 360 / (360 / n)) % n; if (seg !== w.seg) { w.seg = seg; el.dispatchEvent(new CustomEvent('ratchet', { detail: seg })); }
      if (p < 1) w.raf = requestAnimationFrame(tick); else { w.raf = null; el.classList.add('landed'); done(); }
    };
    el.classList.remove('landed'); w.raf = requestAnimationFrame(tick);
  });
}

// ── the overlay the play/lobby screens use ─────────────────────────
// One spin shows at a time; a spin that arrives while another is landing waits its turn (`pending`); the same
// `ts` is never animated twice; a reroll inside a challenge's GM window retargets the wheel that has not started.
let current = null, pending = null, seen = new Set();
export function spinOverlay(stage, lastSpin, { now = Date.now(), holdMs = 2000, onDismiss = null, spinnerName = null } = {}) {
  if (current) {
    if (now >= current.dismissAt) { current.el.remove(); current = null; }
    else {
      if (lastSpin && lastSpin.ts !== current.ts && !seen.has(lastSpin.ts)) {
        if (!current.spun && current.challengeId && current.challengeId === lastSpin.challengeId) { seen.add(lastSpin.ts); current.ts = lastSpin.ts; current.spin = lastSpin; retarget(current, lastSpin); }
        else pending = lastSpin;
      }
      if (current.el.parentNode !== stage) stage.append(current.el);
      return current.el;
    }
  }
  const spin = pending && !seen.has(pending.ts) ? pending : lastSpin; pending = null;
  if (!spin || !spin.wheel || seen.has(spin.ts)) return null;
  if (now - (spin.ts || 0) > 60000) { seen.add(spin.ts); return null; }       // stale: from before this TV opened
  seen.add(spin.ts); if (seen.size > 200) seen = new Set([...seen].slice(-100));
  const el = h('div', { class: 'stage-wrap wheel-overlay' });
  const wheels = spin.wheel === 'pets' && spin.wheels ? spin.wheels.map((w, i) => ({ id: ['pet_common', 'pet_region', 'pet_rare'][i], outcomes: w.outcomes.map(petLabel), index: w.index, title: TITLES[['pet_common', 'pet_region', 'pet_rare'][i]] })) : [{ id: spin.wheel, outcomes: spin.outcomes || [], index: spin.index, title: null }];
  const row = h('div', { class: `wheel-row n${wheels.length}` });
  const els = wheels.map(w => { const we = wheelElement({ outcomes: w.outcomes, colors: spin.colors || null, face: w.id, title: w.title }); row.append(we); return { ...w, el: we }; });
  const waitForGm = spin.revealAt && now < spin.revealAt;
  const who = spinnerName ? `${spinnerName} spins. ` : '';
  const sub = h('div', { class: 'wheel-sub ital muted' }, waitForGm ? `${who}The House considers the wheel…` : `${who}The wheel turns…`);
  const head = h('div', { class: 'wheel-head' }, h('h2', {}, TITLES[spin.wheel] || spin.wheel), sub);
  const result = h('div', { class: 'wheel-result display' });
  el.append(h('div', { class: 'wheel-panel' }, head, row, result));
  stage.append(el);
  const startAt = waitForGm ? spin.revealAt : now;
  current = { ts: spin.ts, challengeId: spin.challengeId || null, spin, el, els, sub, result, startAt, dismissAt: startAt + WHEEL_SPIN_MS + holdMs + (els.length - 1) * 400, spun: false };
  const cur = current;
  const go = () => {
    if (current !== cur) return;
    const wait = cur.startAt - Date.now(); if (wait > 20) { setTimeout(go, wait); return; }
    cur.spun = true; cur.sub.textContent = `${who}The wheel turns…`;
    Promise.all(cur.els.map((w, i) => spinTo(w.el, w.index ?? 0, { ms: WHEEL_SPIN_MS + i * 400 }))).then(() => {
      if (current !== cur) return;
      const sp = cur.spin, names = cur.els.map(w => w.outcomes[w.index ?? 0] ?? '—');
      cur.result.textContent = sp.wheel === 'pets' ? names.join(' · ') : (sp.text || names[0] || '');
      if (sp.wheel === 'pets') cur.sub.textContent = `${who}Keep one of the three.`;
      cur.el.classList.add('landed'); cur.landed = true; onDismiss?.();   // landed: the screens may now show the result lines they held back
      setTimeout(() => { if (current === cur) { cur.el.remove(); current = null; onDismiss?.(); } }, Math.max(0, cur.dismissAt - Date.now()));
    });
  };
  go();
  return el;
}
function retarget(cur, spin) {
  cur.els.forEach((w, i) => { const src = spin.wheel === 'pets' && spin.wheels ? spin.wheels[i] : spin; w.index = src?.index ?? 0; w.outcomes = src?.outcomes || w.outcomes; w.el.__wheel.outcomes = w.outcomes; drawFace(w.el.querySelector('svg'), w.outcomes, spin.colors || null); });
  cur.startAt = spin.revealAt && spin.revealAt > Date.now() ? spin.revealAt : Date.now(); cur.dismissAt = cur.startAt + WHEEL_SPIN_MS + 2000 + (cur.els.length - 1) * 400;
}
export const wheelTitle = (id) => TITLES[id] || id;
export const activeOverlay = () => current?.el || null;
// True while a wheel is turning on the TV (before it lands): screens hold back log lines that would spoil it.
export const spinning = () => !!current && !current.landed;
export const spinningTs = () => (current && !current.landed ? current.ts : null);
// Has the TV finished animating the spin with this ts? (False while it turns or waits its turn in `pending`.)
export const landedFor = (ts) => !(ts != null && ((current && current.ts === ts && !current.landed) || (pending && pending.ts === ts)));
