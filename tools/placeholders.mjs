// Draws a stand-in for every row of tools/asset-list.mjs at its final path. Flat colours from the grimdark
// palette, seeded by the asset key, so the output is deterministic and small. Idempotent: a file that is byte-
// identical is left alone, a file that carries our marker is regenerated, and anything else (real art dropped
// in by filename) is never touched. PNGs carry a tEXt chunk `gwf-placeholder`; SVGs start with `<!--gwf-placeholder-->`.
//   node tools/placeholders.mjs            write everything, print a count per group
//   node tools/placeholders.mjs --check    only report what would change (exit 1 if anything would)
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './png.mjs';
import { ROOT, buildAssetList, loadData, PALETTE, SECRET_COLOURS, RARITY_COLOURS, FAMILY_COLOURS, FRAME, BODY_POSES, POSE_ORDER, LAYER_Z } from './asset-list.mjs';

export const SVG_MARKER = '<!--gwf-placeholder-->';
export const isPlaceholderSVG = (buf) => buf.subarray(0, 512).toString('utf8').includes(SVG_MARKER);
export function isPlaceholderFile(buf, kind) {
  if (kind === 'svg') return isPlaceholderSVG(buf);
  if (kind === 'png') return P.isPlaceholderPNG(buf);
  if (kind === 'wav') return buf.subarray(0, 256).toString('latin1').includes('gwf-placeholder');
  return false;
}

const C = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, P.hex(v)]));
const INK = C.ink, BONE = C.bone, GOLD = C.gold2, OX = C.oxblood, VEL = C.velvet, VEL2 = C.velvet2, AMBER = C.amber;
const SKINS = ['#f1d2b0', '#c99c6b', '#8d5a3a', '#4f3121'].map(P.hex);
const HAIR = ['#1a1416', '#4a2a1a', '#8a5a2a', '#c9a24a', '#e8dfc8', '#5a1a1a', '#6b3fa0', '#3f8a73', '#2a2a2e', '#b8b8c4', '#ff3fa4', '#7dff5a'].map(P.hex);
const CLASS_COLOUR = { whale: '#7a2424', pitboss: '#9c7a2e', cutpurse: '#2a2a2e', enforcer: '#8a6a2a', beastmaster: '#3f8a73', croupier: '#1f5c3a' };
const initials = (s) => String(s).replace(/^(boss|the)_/, '').split(/[_\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const pick = (key, list) => list[P.hashKey(key) % list.length];
const pickHex = (key, extra = []) => P.hex(pick(key, [PALETTE.oxblood2, PALETTE.gold, PALETTE.brass, PALETTE.verdigris, PALETTE.violet, PALETTE.smoke, PALETTE.amber, ...extra]));
const withA = (c, a) => [c[0], c[1], c[2], a];

// ── The figure: anchors for one frame of one pose ───────────────────
export function figure(build, pose, f) {
  const n = BODY_POSES[pose] || 1, t = n > 1 ? f / (n - 1) : 0;
  let dy = 0, dx = 0, armR = 0, lean = 0, crouch = 0, legPhase = 0, lying = false;
  if (pose === 'idle') dy = [0, 1, 2, 1][f % 4];
  if (pose === 'attack') { armR = Math.round(Math.sin(Math.PI * t) * 16); dx = Math.round(Math.sin(Math.PI * t) * 3); }
  if (pose === 'hit') { dx = f ? -4 : -2; lean = -3; }
  if (pose === 'death') { crouch = Math.round(t * 22); lean = Math.round(t * 8); lying = f >= 4; }
  if (pose === 'step') { dy = f % 2; legPhase = [0, 1, 0, -1][f % 4]; }
  const tw = 18 + build * 4, hr = 12 + build;
  const base = 92, torsoH = 26 - Math.round(crouch * 0.5), legH = 24 - Math.round(crouch * 0.5);
  const legY = base - legH, torsoY = legY - torsoH + 2, headCy = torsoY - 12 + dy;
  const torso = { x: 32 - tw / 2 + dx, y: torsoY + dy, w: tw, h: torsoH };
  return {
    lying, dx, dy, build, pose, f,
    head: { cx: 32 + dx + lean, cy: headCy, rx: hr, ry: 13 },
    torso,
    armL: { x: torso.x - 5, y: torso.y + 2, w: 5, h: 20 },
    armR: armR ? { x: torso.x + torso.w, y: torso.y + 4, w: 6 + armR, h: 5 } : { x: torso.x + torso.w, y: torso.y + 2, w: 5, h: 20 },
    handL: { x: torso.x - 4, y: torso.y + 20 }, handR: armR ? { x: torso.x + torso.w + armR + 3, y: torso.y + 6 } : { x: torso.x + torso.w + 2, y: torso.y + 20 },
    legL: { x: 32 - 8 + dx, y: legY + dy + (legPhase > 0 ? -2 : 0), w: 7, h: legH - (legPhase > 0 ? -2 : 0) }, legR: { x: 32 + 1 + dx, y: legY + dy + (legPhase < 0 ? -2 : 0), w: 7, h: legH - (legPhase < 0 ? -2 : 0) },
    feetY: base, neck: { x: 32 + dx - 4, y: torsoY + dy - 2 },
  };
}
function drawBody(c, ox, g, skin, build) {
  if (g.lying) { P.fillRect(c, ox + 10, 80, 44, 10, skin); P.ellipse(c, ox + 12, 85, 9, 6, skin); return; }
  for (const r of [g.legL, g.legR, g.armL, g.armR]) P.fillRect(c, ox + r.x, r.y, r.w, r.h, skin);
  P.fillRect(c, ox + g.torso.x, g.torso.y, g.torso.w, g.torso.h, skin);
  P.ellipse(c, ox + g.head.cx, g.head.cy, g.head.rx, g.head.ry, skin);
}
// One sheet: frames of (pose, f) in order; `draw(c, ox, g)` paints one frame at x offset ox.
function sheet(poses, draw, { outline = true } = {}) {
  const frames = []; for (const pose of POSE_ORDER) for (let f = 0; f < (poses[pose] || 0); f++) frames.push([pose, f]);
  const c = P.canvas(FRAME.w * frames.length, FRAME.h);
  frames.forEach(([pose, f], i) => { const cell = P.canvas(FRAME.w, FRAME.h); draw(cell, 0, pose, f); if (outline) P.outline(cell, INK); P.blit(c, cell, i * FRAME.w, 0); });
  return c;
}
const ARMOUR = { idle: 1, attack: 1, hit: 1, death: 1, step: 1 };
// Armour layers are drawn once per pose against the pose's first body frame.
const layerSheet = (draw, build = 1) => sheet(ARMOUR, (c, ox, pose, f) => draw(c, ox, figure(build, pose, f)));

function drawSlotLayer(c, ox, g, slot, col, key) {
  const hi = P.lighten(col, 0.25), lo = P.darken(col, 0.3);
  if (g.lying && !['mainhand', 'spell', 'offhand', 'cape'].includes(slot)) { P.fillRect(c, ox + 14, 82, 36, 6, col); return; }
  switch (slot) {
    case 'helmet': P.ellipse(c, ox + g.head.cx, g.head.cy - 3, g.head.rx + 1, g.head.ry - 2, col); P.fillRect(c, ox + g.head.cx - g.head.rx - 1, g.head.cy - 2, 2 * g.head.rx + 2, 3, lo); break;
    case 'torso': P.fillRect(c, ox + g.torso.x, g.torso.y, g.torso.w, g.torso.h, col); P.fillRect(c, ox + g.torso.x + 2, g.torso.y + 2, g.torso.w - 4, 3, hi); break;
    case 'outfit': P.fillRect(c, ox + g.torso.x, g.torso.y + 2, g.torso.w, g.torso.h - 2, col); P.fillRect(c, ox + g.legL.x, g.legL.y, g.legL.w, 10, lo); P.fillRect(c, ox + g.legR.x, g.legR.y, g.legR.w, 10, lo); break;
    case 'pants': P.fillRect(c, ox + g.legL.x, g.legL.y, g.legL.w, g.legL.h - 8, col); P.fillRect(c, ox + g.legR.x, g.legR.y, g.legR.w, g.legR.h - 8, col); break;
    case 'boots': P.fillRect(c, ox + g.legL.x - 1, g.feetY - 7, g.legL.w + 2, 7, col); P.fillRect(c, ox + g.legR.x - 1, g.feetY - 7, g.legR.w + 2, 7, col); break;
    case 'gloves': P.fillRect(c, ox + g.handL.x - 1, g.handL.y - 2, 6, 6, col); P.fillRect(c, ox + g.handR.x - 3, g.handR.y - 2, 6, 6, col); break;
    case 'ring': P.fillRect(c, ox + g.handR.x - 1, g.handR.y, 2, 2, hi); P.fillRect(c, ox + g.handL.x + 1, g.handL.y, 2, 2, hi); break;
    case 'necklace': P.fillRect(c, ox + g.neck.x - 2, g.neck.y + 2, 12, 2, col); P.fillRect(c, ox + g.neck.x + 3, g.neck.y + 4, 3, 3, hi); break;
    case 'cape': P.fillRect(c, ox + g.torso.x - 3, g.torso.y + 1, g.torso.w + 6, g.torso.h + 14, col); break;
    case 'mainhand': { const fam = FAMILY_COLOURS[key] ? P.hex(FAMILY_COLOURS[key]) : col; if (g.pose === 'attack') P.fillRect(c, ox + g.handR.x, g.handR.y - 1, 22, 4, fam); else P.fillRect(c, ox + g.handR.x - 1, g.handR.y - 24, 4, 28, fam); P.fillRect(c, ox + g.handR.x - 3, g.handR.y - 2, 7, 3, lo); break; }
    case 'offhand': P.fillRect(c, ox + g.handL.x - 6, g.handL.y - 8, 9, 14, col); P.fillRect(c, ox + g.handL.x - 4, g.handL.y - 6, 5, 10, hi); break;
    case 'spell': P.circle(c, ox + g.handL.x, g.handL.y - 2, 8, withA(hi, 150)); P.circle(c, ox + g.handL.x, g.handL.y - 2, 4, hi); break;
    case 'lantern': P.fillRect(c, ox + g.torso.x + g.torso.w - 2, g.torso.y + g.torso.h - 2, 5, 8, col); break;
    case 'face': break;
    default: P.fillRect(c, ox + g.torso.x, g.torso.y, g.torso.w, 6, col);
  }
}

// ── Group drawers: each returns a canvas (PNG) or a string (SVG) ───
const draw = {};
draw.body = (row) => { const skin = SKINS[row.meta.skin], build = row.meta.build; return sheet(BODY_POSES, (c, ox, pose, f) => drawBody(c, ox, figure(build, pose, f), skin, build)); };
draw.face = (row) => { const i = Number(row.key.split('/')[1]); return layerSheet((c, ox, g) => { if (g.lying) return; const eyeDx = 4 + (i % 3), eyeY = g.head.cy - 1 + (i % 2); P.fillRect(c, ox + g.head.cx - eyeDx - 1, eyeY, 2, 2, INK); P.fillRect(c, ox + g.head.cx + eyeDx - 1, eyeY, 2, 2, INK); const m = i % 4; if (m === 0) P.fillRect(c, ox + g.head.cx - 3, g.head.cy + 6, 6, 1, INK); if (m === 1) P.fillRect(c, ox + g.head.cx - 2, g.head.cy + 5, 4, 2, OX); if (m === 2) P.fillRect(c, ox + g.head.cx - 3, g.head.cy + 7, 7, 1, INK); if (m === 3) P.fillRect(c, ox + g.head.cx - 1, g.head.cy + 6, 2, 2, INK); if (i >= 4) P.fillRect(c, ox + g.head.cx + eyeDx - 2, eyeY - 3, 5, 1, OX); }, { outline: false }); };
draw.hair = (row) => { const i = Number(row.key.split('/')[1]), col = HAIR[i]; return layerSheet((c, ox, g) => { if (g.lying) { P.ellipse(c, ox + 10, 83, 7, 5, col); return; } const h = g.head; const style = i % 4; P.ellipse(c, ox + h.cx, h.cy - 5, h.rx + 1, h.ry - 4, col); if (style === 1) { P.fillRect(c, ox + h.cx - h.rx - 1, h.cy - 6, 4, 22, col); P.fillRect(c, ox + h.cx + h.rx - 3, h.cy - 6, 4, 22, col); } if (style === 2) P.fillRect(c, ox + h.cx - 2, h.cy - h.ry - 6, 5, 10, col); if (style === 3) P.fillRect(c, ox + h.cx - h.rx, h.cy - h.ry - 2, 2 * h.rx + 1, 5, P.darken(col, 0.3)); }); };
draw.outfit = (row) => { const cls = row.key.split('/')[1], col = P.hex(CLASS_COLOUR[cls] || PALETTE.smoke); return layerSheet((c, ox, g) => drawSlotLayer(c, ox, g, 'outfit', col, cls)); };
draw.worn = (row) => { const col = pickHex(row.key); return layerSheet((c, ox, g) => drawSlotLayer(c, ox, g, row.sprite.slot, col, row.meta?.family)); };
draw.legendary = (row) => { const col = P.hex(PALETTE.bone2); const s = layerSheet((c, ox, g) => drawSlotLayer(c, ox, g, row.sprite.slot, col, null), { outline: false }); P.outline(s, withA(GOLD, 220)); P.outline(s, withA(AMBER, 90)); return s; };
draw.lantern = (row) => {
  const state = row.key.split('/')[1]; const c = P.canvas(512, 128);
  for (let f = 0; f < 4; f++) {
    const ox = f * 128; P.fillRect(c, ox + 48, 20, 32, 6, C.brass); P.fillRect(c, ox + 62, 10, 4, 12, C.brass); P.strokeRect(c, ox + 44, 26, 40, 70, C.brass, 4); P.fillRect(c, ox + 48, 30, 32, 62, withA(VEL2, 230));
    const flick = [1, 0.8, 1.1, 0.9][f];
    if (state === 'full') { P.ellipse(c, ox + 64, 68, 10 * flick, 22 * flick, AMBER); P.ellipse(c, ox + 64, 74, 5, 12, P.hex('#fff2b0')); }
    if (state === 'guttering') { P.ellipse(c, ox + 64 + (f % 2 ? 3 : -3), 80, 5 * flick, 9 * flick, AMBER); P.ellipse(c, ox + 64, 84, 2, 4, P.hex('#fff2b0')); }
    if (state === 'out') { P.ellipse(c, ox + 64, 86, 4, 2, C.smoke); P.line(c, ox + 64, 82, ox + 60 + f * 3, 50, withA(C.silver, 90), 2); }
    if (state === 'dead') { P.line(c, ox + 50, 40, ox + 78, 88, C.soot, 2); P.line(c, ox + 78, 40, ox + 50, 88, C.soot, 2); }
    P.fillRect(c, ox + 48, 92, 32, 6, C.brass);
  }
  P.outline(c, INK); return c;
};
draw.crest = (row) => { const cls = row.key.split('/')[1], c = P.canvas(150, 250, VEL); P.strokeRect(c, 4, 4, 142, 242, GOLD, 3); P.strokeRect(c, 12, 12, 126, 226, C.gold, 1); classMark(c, cls, 75, 105, 40); P.textCentered(c, 75, 215, (row.name || cls).replace(/ crest$/, '').toUpperCase(), BONE, 2); P.noise(c, row.key, 6, 5); return c; };
draw.ui = (row) => row.kind === 'svg' ? svgUI(row) : (() => { const cls = row.key.replace('ui/active_', ''); const c = P.canvas(128, 128); P.circle(c, 64, 64, 58, P.hex(CLASS_COLOUR[cls] || PALETTE.smoke)); P.circle(c, 64, 64, 58, withA(INK, 0)); classMark(c, cls, 64, 64, 30); P.outline(c, GOLD); return c; })();

function classMark(c, cls, cx, cy, r) {
  switch (cls) {
    case 'whale': P.circle(c, cx, cy, r, GOLD); P.fillRect(c, cx - 2, cy - r, 4, 2 * r, VEL); break;
    case 'pitboss': P.fillRect(c, cx - r * 0.8, cy - r, r * 1.6, 2 * r, BONE); for (let i = 1; i < 5; i++) P.fillRect(c, cx - r * 0.6, cy - r + i * (2 * r / 5), r * 1.2, 2, VEL); break;
    case 'cutpurse': P.polygon(c, [[cx - r, cy - r * 0.6], [cx + r, cy - r * 0.6], [cx, cy + r]], P.hex('#c2652a')); P.polygon(c, [[cx - r, cy - r * 0.6], [cx - r * 0.6, cy - r * 1.3], [cx - r * 0.3, cy - r * 0.6]], P.hex('#c2652a')); P.polygon(c, [[cx + r, cy - r * 0.6], [cx + r * 0.6, cy - r * 1.3], [cx + r * 0.3, cy - r * 0.6]], P.hex('#c2652a')); P.fillRect(c, cx - r * 0.5, cy - r * 0.3, r * 0.3, r * 0.2, VEL); P.fillRect(c, cx + r * 0.2, cy - r * 0.3, r * 0.3, r * 0.2, VEL); break;
    case 'enforcer': P.fillRect(c, cx - r, cy - r * 0.5, 2 * r, r * 1.2, C.brass); for (let i = 0; i < 4; i++) P.circle(c, cx - r + r * 0.25 + i * r * 0.5, cy - r * 0.5, r * 0.25, C.brass); P.polyline(c, [[cx - r * 0.4, cy - r * 0.4], [cx, cy], [cx - r * 0.2, cy + r * 0.3], [cx + r * 0.3, cy + r * 0.7]], VEL, 2); break;
    case 'beastmaster': for (let a = 0; a < 360; a += 4) P.put(c, Math.round(cx + Math.cos(a * Math.PI / 180) * r * 0.7), Math.round(cy - r * 0.3 + Math.sin(a * Math.PI / 180) * r * 0.5), C.verdigris); P.polyline(c, [[cx, cy + r * 0.2], [cx + r * 0.3, cy + r * 0.7], [cx - r * 0.2, cy + r]], C.verdigris, 3); break;
    case 'croupier': P.ellipse(c, cx, cy, r, r * 0.45, P.hex('#1f5c3a')); P.fillRect(c, cx - r, cy - r * 0.1, 2 * r, r * 0.55, VEL); P.fillRect(c, cx - r * 0.9, cy - r * 0.1, r * 1.8, 3, GOLD); break;
    default: P.circle(c, cx, cy, r, GOLD);
  }
}

draw.tiles = (row) => {
  const S = 256, r = 124, c = P.canvas(S, S), pts = P.hexPoints(S / 2, S / 2, r), id = row.key.split('/')[1];
  if (id.startsWith('ground_')) { const acc = P.hex(row.meta.accent); P.polygon(c, pts, P.mix(VEL2, acc, 0.12)); P.noise(c, row.key, 9, 2); P.polyline(c, pts, P.mix(C.smoke, acc, 0.4), 3, true); return c; }
  if (id.startsWith('void_')) {
    const fl = row.meta.flavour, base = fl === 'water' ? P.hex('#0a1420') : fl === 'chasm' ? P.hex('#060406') : P.hex('#1a1518');
    P.polygon(c, pts, base); P.noise(c, row.key, 6, 3);
    const mark = withA(P.mix(BONE, P.hex(row.meta.accent), 0.3), 70);
    if (fl === 'water') for (let y = 60; y < 200; y += 24) for (let x = 40; x < 216; x += 2) P.put(c, x, y + Math.round(Math.sin(x / 9) * 4), mark);
    else if (fl === 'chasm') for (let i = -200; i < 260; i += 22) P.line(c, i, 40, i + 160, 216, mark, 1);
    else for (let y = 50; y < 210; y += 20) { P.line(c, 30, y, 226, y, mark, 1); for (let x = (y / 20) % 2 ? 40 : 60; x < 220; x += 40) P.line(c, x, y, x, y + 20, mark, 1); }
    P.polyline(c, pts, C.soot, 2, true); return c;
  }
  // Glyph tiles: a faint hex edge and one flat single-colour mark that reads at 26 px.
  P.polyline(c, pts, withA(BONE, 60), 2, true);
  const special = { bridge: () => { P.fillRect(c, 48, 112, 160, 32, BONE); for (let x = 56; x < 200; x += 24) P.fillRect(c, x, 104, 6, 48, BONE); }, bridge_gated: () => { P.fillRect(c, 48, 112, 160, 32, BONE); P.strokeRect(c, 100, 72, 56, 112, BONE, 8); P.fillRect(c, 120, 120, 16, 24, BONE); }, fog: () => { P.polygon(c, pts, withA(C.smoke, 200)); for (let i = 0; i < 5; i++) P.ellipse(c, 70 + i * 30, 120 + (i % 2) * 30, 34, 18, withA(BONE, 40)); } };
  if (special[id]) special[id](); else { const letter = row.meta.letter || id[0].toUpperCase(); const px = 12; P.textCentered(c, S / 2, S / 2, letter, BONE, px); }
  return c;
};
draw.map = (row) => {
  const id = row.key.split('/')[1];
  if (id === 'parchment_frame') { const c = P.canvas(256, 256); P.strokeRect(c, 0, 0, 256, 256, C.brass, 14); P.strokeRect(c, 14, 14, 228, 228, BONE, 2); P.noise(c, row.key, 10, 2); return c; }
  if (id.startsWith('cartouche_')) { const c = P.canvas(256, 64, withA(VEL, 230)); const acc = P.hex(row.meta.accent); P.strokeRect(c, 2, 2, 252, 60, acc, 2); P.textCentered(c, 128, 32, row.meta.label.toUpperCase(), BONE, 2); return c; }
  if (id === 'courier_marker') { const c = P.canvas(128, 128); P.circle(c, 64, 64, 50, VEL2); P.textCentered(c, 64, 64, 'P', BONE, 6); P.outline(c, GOLD); return c; }
  if (id === 'path_brush') { const c = P.canvas(128, 128); for (let r = 56; r > 0; r -= 8) P.circle(c, 64, 64, r, withA(AMBER, 20)); return c; }
  const c = P.canvas(256, 256); const pts = P.hexPoints(128, 128, 120); P.polyline(c, pts, withA(AMBER, 200), 6, true); P.polyline(c, P.hexPoints(128, 128, 108), withA(AMBER, 80), 2, true); return c;
};
draw.monsters = (row) => {
  const id = row.key.split('/')[1].replace(/_token$/, ''), token = !!row.meta?.token, data = draw._data;
  const region = data.regions.find(r => (r.monsterTable || []).includes(id) || r.bossId === id || r.raidBossId === id) || pick(id, data.regions);
  const acc = P.mix(P.hex(region.accent), VEL2, 0.55), role = row.meta.role;
  if (token) { const c = P.canvas(128, 128); P.circle(c, 64, 70, 46, acc); P.textCentered(c, 64, 70, initials(id), BONE, 3); if (role !== 'monster' && role !== 'other') P.polygon(c, [[30, 36], [44, 14], [58, 36], [70, 14], [84, 36], [98, 14], [98, 44], [30, 44]], GOLD); P.outline(c, INK); return c; }
  const c = P.canvas(256, 256); const h = role === 'final' ? 110 : role === 'raid' ? 100 : role === 'boss' ? 92 : 76;
  P.ellipse(c, 128, 150, h * 0.8, h, acc); P.ellipse(c, 128, 96, 44, 40, P.lighten(acc, 0.1));
  P.fillRect(c, 108, 88, 10, 8, INK); P.fillRect(c, 138, 88, 10, 8, INK);
  if (role === 'boss' || role === 'raid' || role === 'final') { P.polygon(c, [[90, 70], [104, 40], [118, 66], [128, 32], [138, 66], [152, 40], [166, 70]], GOLD); }
  if (role === 'raid') for (let i = 0; i < 4; i++) P.circle(c, 60 + i * 45, 220, 16, acc);
  P.textCentered(c, 128, 236, (data.monsterNames?.[id] || id.replace(/_/g, ' ')).toUpperCase().slice(0, 18), BONE, 2);
  P.outline(c, INK); P.noise(c, row.key, 8, 3); return c;
};
draw.items = (row) => {
  const id = row.key.split('/')[1], fam = row.meta?.family, col = fam ? P.hex(FAMILY_COLOURS[fam]) : pickHex(row.key), c = P.canvas(128, 128);
  if (row.meta?.twoHand) { P.fillRect(c, 44, 8, 40, 112, P.darken(col, 0.2)); P.fillRect(c, 28, 84, 72, 10, C.brass); P.textCentered(c, 64, 50, initials(id.replace('twohand_', '')), VEL, 2); }
  else { P.fillRect(c, 52, 10, 24, 100, col); P.fillRect(c, 40, 76, 48, 8, C.brass); P.fillRect(c, 58, 84, 12, 30, C.smoke); P.textCentered(c, 64, 42, initials(row.name || id), VEL, 2); }
  P.outline(c, INK); return c;
};
draw.gear = (row) => {
  const id = row.key.split('/')[1], slot = row.meta.slot, col = pickHex(row.key), c = P.canvas(128, 128), hi = P.lighten(col, 0.25);
  switch (slot) {
    case 'helmet': P.ellipse(c, 64, 64, 46, 40, col); P.fillRect(c, 18, 64, 92, 24, P.darken(col, 0.2)); P.fillRect(c, 30, 70, 68, 8, VEL); break;
    case 'torso': P.fillRect(c, 28, 20, 72, 92, col); P.fillRect(c, 12, 24, 20, 40, col); P.fillRect(c, 96, 24, 20, 40, col); P.fillRect(c, 48, 20, 32, 10, VEL); break;
    case 'pants': P.fillRect(c, 28, 18, 72, 30, col); P.fillRect(c, 28, 48, 32, 64, col); P.fillRect(c, 68, 48, 32, 64, col); break;
    case 'gloves': P.fillRect(c, 34, 44, 60, 60, col); for (let i = 0; i < 4; i++) P.fillRect(c, 36 + i * 15, 20, 12, 30, col); P.fillRect(c, 22, 60, 14, 30, col); break;
    case 'boots': P.fillRect(c, 36, 16, 36, 70, col); P.fillRect(c, 36, 76, 72, 30, col); P.fillRect(c, 36, 100, 72, 8, P.darken(col, 0.3)); break;
    case 'ring': for (let y = 28; y < 108; y++) for (let x = 24; x < 104; x++) { const d = Math.hypot(x + 0.5 - 64, y + 0.5 - 68); if (d <= 40 && d >= 26) P.put(c, x, y, col); } P.polygon(c, [[64, 14], [80, 34], [64, 50], [48, 34]], hi); break;
    case 'necklace': for (let a = 0; a < 180; a += 2) { const x = 64 + Math.cos((a + 180) * Math.PI / 180) * 44, y = 44 + Math.sin((a + 180) * Math.PI / 180) * -44; P.fillRect(c, Math.round(x), Math.round(y), 4, 4, col); } P.fillRect(c, 60, 86, 8, 8, col); P.polygon(c, [[64, 92], [78, 106], [64, 120], [50, 106]], hi); break;
    default: P.fillRect(c, 24, 24, 80, 80, col);
  }
  P.textCentered(c, 64, 120, initials(id), BONE, 1); P.outline(c, INK); return c;
};
draw.consumables = (row) => {
  const id = row.key.split('/')[1], c = P.canvas(128, 128);
  const col = /potion/.test(id) ? OX : id === 'egg' ? BONE : id === 'smokebomb' ? C.smoke : id === 'phoenixfeather' ? AMBER : id === 'satchel' ? C.brass : id === 'spyglass' ? C.gold2 : pickHex(row.key);
  const size = id === 'potion_small' ? 0.6 : id === 'potion_large' ? 1 : 0.8;
  if (/potion/.test(id)) { P.fillRect(c, 54, 20, 20, 16, C.brass); P.ellipse(c, 64, 64 + (1 - size) * 20, 34 * size, 40 * size, col); P.ellipse(c, 54, 56, 6, 10, withA(BONE, 120)); }
  else if (id === 'egg') { P.ellipse(c, 64, 68, 36, 46, col); P.circle(c, 54, 56, 5, C.verdigris); P.circle(c, 76, 76, 6, C.verdigris); }
  else { P.circle(c, 64, 64, 48, col); P.textCentered(c, 64, 64, initials(id), id === 'egg' || id === 'phoenixfeather' ? VEL : BONE, 3); }
  P.outline(c, INK); return c;
};
draw.frames = (row) => {
  const [w, h] = row.size, r = row.meta.rarity, col = P.hex(RARITY_COLOURS[r]), c = P.canvas(w, h);
  if (r === 'legendary') { P.strokeRect(c, 0, 0, w, h, withA(col, 60), 4); P.strokeRect(c, 2, 2, w - 4, h - 4, withA(col, 110), 2); }
  P.strokeRect(c, 2, 2, w - 4, h - 4, INK, 2); P.strokeRect(c, 4, 4, w - 8, h - 8, col, 6); P.strokeRect(c, 10, 10, w - 20, h - 20, INK, 1);
  for (const [x, y] of [[4, 4], [w - 12, 4], [4, h - 12], [w - 12, h - 12]]) P.fillRect(c, x, y, 8, 8, P.darken(col, 0.35));
  return c;
};
draw.pets = (row) => {
  const id = row.key.split('/')[1], c = P.canvas(128, 128);
  if (id.startsWith('attack_')) { const t = id.slice(7), col = { strike: OX, element: C.violet, guard: C.brass, mend: C.verdigris }[t] || pickHex(id); P.circle(c, 64, 64, 50, col); P.textCentered(c, 64, 64, t[0].toUpperCase(), BONE, 4); P.outline(c, INK); return c; }
  const species = row.meta.species, col = P.hex(pick(species, Object.values(SECRET_COLOURS).filter(h => h !== SECRET_COLOURS.soot)));
  if (row.meta.egg) { P.ellipse(c, 64, 70, 36, 46, BONE); for (let i = 0; i < 4; i++) P.circle(c, 48 + (i * 17) % 34, 50 + i * 12, 5, col); P.outline(c, INK); return c; }
  const s = row.meta.stage, r = [0, 28, 40, 54][s];
  P.circle(c, 64, 72, r, col); P.fillRect(c, 64 - r * 0.45 - 2, 66, 4, 4, INK); P.fillRect(c, 64 + r * 0.45 - 2, 66, 4, 4, INK);
  if (s >= 2) { P.polygon(c, [[64 - r * 0.8, 72 - r * 0.6], [64 - r * 0.6, 72 - r * 1.4], [64 - r * 0.2, 72 - r * 0.8]], col); P.polygon(c, [[64 + r * 0.8, 72 - r * 0.6], [64 + r * 0.6, 72 - r * 1.4], [64 + r * 0.2, 72 - r * 0.8]], col); }
  if (s === 3) for (let a = 200; a <= 340; a += 35) P.polygon(c, [[64 + Math.cos(a * Math.PI / 180) * r * 0.9, 72 + Math.sin(a * Math.PI / 180) * r * 0.9], [64 + Math.cos((a + 8) * Math.PI / 180) * r * 1.35, 72 + Math.sin((a + 8) * Math.PI / 180) * r * 1.35], [64 + Math.cos((a + 16) * Math.PI / 180) * r * 0.9, 72 + Math.sin((a + 16) * Math.PI / 180) * r * 0.9]], P.darken(col, 0.25));
  P.textCentered(c, 64, 118, initials(species) + s, BONE, 1); P.outline(c, INK); return c;
};
draw.dice = (row) => {
  const n = row.meta.sides, id = row.key.split('/')[1];
  const shape = (cx, cy, r, rot = -Math.PI / 2) => ({ 4: P.regularPolygon(cx, cy, r, 3, rot), 6: [[cx - r * 0.8, cy - r * 0.8], [cx + r * 0.8, cy - r * 0.8], [cx + r * 0.8, cy + r * 0.8], [cx - r * 0.8, cy + r * 0.8]], 8: P.regularPolygon(cx, cy, r, 4, rot), 10: [[cx, cy - r], [cx + r * 0.75, cy - r * 0.25], [cx + r * 0.5, cy + r], [cx - r * 0.5, cy + r], [cx - r * 0.75, cy - r * 0.25]], 12: P.regularPolygon(cx, cy, r, 5, rot), 20: P.regularPolygon(cx, cy, r, 6, rot) }[n]);
  if (id.endsWith('_outline')) { const c = P.canvas(128, 128); P.polyline(c, shape(64, 64, 54), BONE, 3, true); P.textCentered(c, 64, 64, 'D' + n, BONE, 2); return c; }
  if (id.endsWith('_roll')) { const c = P.canvas(256, 64); for (let f = 0; f < 4; f++) { P.polygon(c, shape(32 + f * 64, 32, 26, -Math.PI / 2 + f * 0.5), withA(BONE, 200)); P.textCentered(c, 32 + f * 64, 34, '?', INK, 2); } P.outline(c, INK); return c; }
  const c = P.canvas(64 * n, 64);
  for (let i = 0; i < n; i++) { P.polygon(c, shape(32 + i * 64, 34, 27), BONE); P.textCentered(c, 32 + i * 64, 36, String(i + 1), INK, 2); }
  P.outline(c, INK); return c;
};
draw.letters = (row) => {
  const id = row.key.split('/')[1];
  if (id === 'crow') { const c = P.canvas(384, 128); for (let f = 0; f < 3; f++) { const ox = f * 128, wing = [-26, 0, 26][f]; P.ellipse(c, ox + 64, 70, 22, 14, C.soot); P.circle(c, ox + 84, 60, 10, C.soot); P.polygon(c, [[ox + 92, 60], [ox + 104, 62], [ox + 92, 65]], AMBER); P.polygon(c, [[ox + 50, 66], [ox + 20, 66 + wing], [ox + 66, 76]], C.soot); P.polygon(c, [[ox + 78, 66], [ox + 108, 66 + wing], [ox + 62, 76]], C.soot); } P.outline(c, INK); return c; }
  const c = P.canvas(128, 128);
  if (id.startsWith('seal_')) { const cls = id.slice(5); P.circle(c, 64, 64, 46, OX); P.circle(c, 64, 64, 40, C.oxblood2); classMark(c, cls, 64, 64, 22); P.outline(c, INK); return c; }
  P.fillRect(c, 14, 34, 100, 68, BONE); P.polyline(c, [[14, 34], [64, 72], [114, 34]], C.brass, 2);
  if (id === 'sealed') P.circle(c, 64, 70, 11, OX);
  if (id === 'broken') { P.circle(c, 56, 72, 8, OX); P.circle(c, 74, 66, 7, OX); P.line(c, 64, 56, 64, 84, BONE, 2); }
  if (id === 'delivered') { P.polygon(c, [[14, 34], [64, 4], [114, 34]], P.darken(BONE, 0.1)); P.fillRect(c, 30, 48, 68, 4, C.smoke); P.fillRect(c, 30, 58, 50, 4, C.smoke); }
  if (id === 'forged') { P.circle(c, 64, 70, 11, C.violet); P.textCentered(c, 64, 70, 'F', BONE, 2); }
  P.outline(c, INK); return c;
};
draw.stages = (row) => {
  const id = row.key.split('/')[1];
  if (id === 'cardback') { const c = P.canvas(150, 250, VEL); P.strokeRect(c, 6, 6, 138, 238, GOLD, 3); for (let y = 20; y < 230; y += 16) for (let x = 20 + ((y / 16) % 2) * 8; x < 130; x += 16) P.polygon(c, [[x, y - 5], [x + 5, y], [x, y + 5], [x - 5, y]], C.gold); return c; }
  if (id === 'chips') { const c = P.canvas(512, 128); [OX, C.verdigris, C.violet, C.gold2].forEach((col, i) => { const cx = 64 + i * 128; P.circle(c, cx, 64, 54, col); P.circle(c, cx, 64, 40, P.darken(col, 0.25)); for (let a = 0; a < 360; a += 45) P.fillRect(c, Math.round(cx + Math.cos(a * Math.PI / 180) * 48) - 4, Math.round(64 + Math.sin(a * Math.PI / 180) * 48) - 4, 8, 8, BONE); P.circle(c, cx, 62, 14, BONE); P.fillRect(c, cx - 7, 58, 4, 4, col); P.fillRect(c, cx + 3, 58, 4, 4, col); }); P.outline(c, INK); return c; }
  const fam = row.meta?.family, base = id === 'felt' ? P.hex('#143a2c') : P.mix(VEL2, P.hex(FAMILY_COLOURS[fam]), 0.18);
  const c = P.canvas(480, 270, base); P.noise(c, row.key, 5, 4); P.vignette(c, 0.8);
  if (fam) P.textCentered(c, 240, 135, fam.toUpperCase(), withA(BONE, 40), 6);
  return c;
};
draw.badges = (row) => { const id = row.key.split('/')[1], c = P.canvas(128, 128); P.polygon(c, P.regularPolygon(64, 64, 58, 8, Math.PI / 8), C.gold); P.circle(c, 64, 64, 44, VEL2); P.textCentered(c, 64, 64, initials(id), GOLD, 3); P.outline(c, INK); return c; };

// ── SVG drawers ────────────────────────────────────────────────────
const svg = (w, h, body, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>\n${SVG_MARKER}\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${extra}>\n${body}\n</svg>\n`;
const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const hexPath = (cx, cy, r) => P.hexPoints(cx, cy, r).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const FONT = 'font-family="Cinzel, Georgia, serif"';

draw.wheels = (row) => {
  const id = row.key.split('/')[1];
  if (id === 'pointer') return svg(128, 192, `<polygon points="64,184 16,24 112,24" fill="${PALETTE.bone}" stroke="${PALETTE.ink}" stroke-width="6"/><circle cx="64" cy="40" r="18" fill="${PALETTE.oxblood}" stroke="${PALETTE.ink}" stroke-width="4"/>`);
  if (id === 'hub') return svg(256, 256, `<circle cx="128" cy="128" r="120" fill="${PALETTE.velvet}" stroke="${PALETTE.gold2}" stroke-width="10"/><circle cx="128" cy="128" r="72" fill="${PALETTE.oxblood}" stroke="${PALETTE.brass}" stroke-width="6"/><circle cx="128" cy="128" r="20" fill="${PALETTE.bone}"/>`);
  const labels = row.meta.labels || [], n = Math.max(1, labels.length), R = 480, cx = 512, cy = 512;
  const seg = [], lab = [];
  for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n - Math.PI / 2, a1 = (2 * Math.PI * (i + 1)) / n - Math.PI / 2, mid = (a0 + a1) / 2;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0), x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const fill = i % 2 ? PALETTE.oxblood : PALETTE.velvet2;
    seg.push(`<path id="seg-${i}" data-index="${i}" d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${n === 1 ? 1 : 0},1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${fill}" stroke="${PALETTE.gold}" stroke-width="3"/>`);
    const lx = cx + R * 0.68 * Math.cos(mid), ly = cy + R * 0.68 * Math.sin(mid), rot = (mid * 180) / Math.PI;
    lab.push(`<text data-index="${i}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" fill="${PALETTE.bone}" font-size="${n > 10 ? 30 : 40}" text-anchor="middle" dominant-baseline="middle" ${FONT}>${esc(labels[i])}</text>`);
  }
  return svg(1024, 1024, `<g id="rim"><circle cx="${cx}" cy="${cy}" r="${R + 20}" fill="${PALETTE.ink}"/><circle cx="${cx}" cy="${cy}" r="${R + 12}" fill="none" stroke="${PALETTE.gold2}" stroke-width="10"/></g>\n<g id="segments">${seg.join('')}</g>\n<g id="labels">${lab.join('')}</g>\n<g id="hub"><circle cx="${cx}" cy="${cy}" r="70" fill="${PALETTE.velvet}" stroke="${PALETTE.gold2}" stroke-width="8"/><text x="${cx}" y="${cy + 10}" fill="${PALETTE.bone}" font-size="26" text-anchor="middle" ${FONT}>${esc(row.name || id)}</text></g>`);
};
draw.cards = (row) => {
  const id = row.key.split('/')[1];
  const frame = (inner) => svg(600, 1000, `<rect x="10" y="10" width="580" height="980" rx="40" fill="${PALETTE.velvet}" stroke="${PALETTE.gold2}" stroke-width="12"/>${inner}`);
  if (id === 'back') { let lat = ''; for (let y = 80; y < 940; y += 60) for (let x = 70 + ((y / 60) % 2) * 30; x < 540; x += 60) lat += `<polygon points="${x},${y - 20} ${x + 20},${y} ${x},${y + 20} ${x - 20},${y}" fill="${PALETTE.gold}" opacity="0.7"/>`; return frame(`<rect x="50" y="50" width="500" height="900" rx="24" fill="none" stroke="${PALETTE.brass}" stroke-width="4"/>${lat}`); }
  const col = row.meta.hex, name = row.meta.colour.toUpperCase(), dbl = !!row.meta.double;
  const mark = (cx, cy, s) => `<polygon points="${cx},${cy - s} ${cx + s * 0.7},${cy} ${cx},${cy + s} ${cx - s * 0.7},${cy}" fill="${col}" stroke="${PALETTE.bone}" stroke-width="6"/>`;
  return frame(`<rect x="50" y="50" width="500" height="900" rx="24" fill="${col}" opacity="0.18"/>${dbl ? mark(300, 380, 150) + mark(300, 640, 150) : mark(300, 500, 220)}<text x="300" y="120" fill="${PALETTE.bone}" font-size="56" text-anchor="middle" ${FONT}>${name}${dbl ? ' ×2' : ''}</text><text x="300" y="920" fill="${PALETTE.bone}" font-size="56" text-anchor="middle" transform="rotate(180 300 900)" ${FONT}>${name}${dbl ? ' ×2' : ''}</text>`);
};
function svgUI(row) {
  const id = row.key.split('/')[1], [w, h] = row.size;
  const state = id.split('_').pop();
  const fill = { idle: PALETTE.velvet2, pressed: PALETTE.gold, disabled: PALETTE.soot }[state] || PALETTE.velvet2, stroke = state === 'disabled' ? PALETTE.smoke : PALETTE.gold2, op = state === 'disabled' ? ' opacity="0.55"' : '';
  if (id.startsWith('hexbtn_')) return svg(w, h, `<polygon points="${hexPath(60, 60, 56)}" fill="${fill}" stroke="${stroke}" stroke-width="4"${op}/>`);
  if (id === 'stop_hub') return svg(w, h, `<circle cx="60" cy="60" r="54" fill="${PALETTE.oxblood}" stroke="${PALETTE.bone}" stroke-width="5"/><text x="60" y="68" fill="${PALETTE.bone}" font-size="22" text-anchor="middle" ${FONT}>STOP</text>`);
  if (id === 'cage_cell') return svg(w, h, `<rect x="1" y="1" width="62" height="62" fill="${PALETTE.velvet}" stroke="${PALETTE.brass}" stroke-width="2"/><line x1="21" y1="2" x2="21" y2="62" stroke="${PALETTE.smoke}" stroke-width="2"/><line x1="42" y1="2" x2="42" y2="62" stroke="${PALETTE.smoke}" stroke-width="2"/>`);
  if (id === 'doll_stand') return svg(w, h, `<rect x="110" y="380" width="100" height="18" fill="${PALETTE.brass}"/><rect x="150" y="300" width="20" height="90" fill="${PALETTE.brass}"/><ellipse cx="160" cy="420" rx="120" ry="30" fill="${PALETTE.velvet2}" stroke="${PALETTE.gold}" stroke-width="4"/><rect x="20" y="20" width="280" height="440" rx="20" fill="none" stroke="${PALETTE.brass}" stroke-width="3" stroke-dasharray="8 6"/>`);
  if (id.startsWith('slot_')) {
    const s = id.slice(5).replace(/\d$/, ''), g = PALETTE.smoke, shapes = {
      mainhand: `<rect x="29" y="8" width="6" height="40" fill="${g}"/><rect x="20" y="40" width="24" height="5" fill="${g}"/><rect x="29" y="45" width="6" height="12" fill="${g}"/>`,
      offhand: `<path d="M32 8 L54 16 L50 44 L32 58 L14 44 L10 16 Z" fill="${g}"/>`, spell: `<circle cx="32" cy="32" r="18" fill="none" stroke="${g}" stroke-width="5"/><circle cx="32" cy="32" r="6" fill="${g}"/>`,
      helmet: `<path d="M12 40 A20 20 0 0 1 52 40 L52 50 L12 50 Z" fill="${g}"/>`, torso: `<path d="M18 10 L46 10 L56 24 L48 30 L48 56 L16 56 L16 30 L8 24 Z" fill="${g}"/>`,
      pants: `<path d="M16 8 L48 8 L50 56 L36 56 L32 30 L28 56 L14 56 Z" fill="${g}"/>`, gloves: `<rect x="18" y="26" width="30" height="30" rx="4" fill="${g}"/><rect x="20" y="8" width="6" height="22" fill="${g}"/><rect x="29" y="6" width="6" height="24" fill="${g}"/><rect x="38" y="8" width="6" height="22" fill="${g}"/>`,
      boots: `<path d="M20 8 L40 8 L40 36 L56 44 L56 56 L20 56 Z" fill="${g}"/>`, ring: `<circle cx="32" cy="36" r="16" fill="none" stroke="${g}" stroke-width="7"/><polygon points="32,8 40,18 32,26 24,18" fill="${g}"/>`,
      necklace: `<path d="M12 12 Q32 56 52 12" fill="none" stroke="${g}" stroke-width="5"/><polygon points="32,36 40,46 32,56 24,46" fill="${g}"/>`, cape: `<path d="M14 8 L50 8 L56 56 L8 56 Z" fill="${g}"/>`,
    };
    return svg(w, h, `<rect x="1" y="1" width="62" height="62" rx="6" fill="${PALETTE.velvet}" stroke="${PALETTE.brass}" stroke-width="2"/>${shapes[s] || `<rect x="16" y="16" width="32" height="32" fill="${g}"/>`}`);
  }
  if (id.startsWith('tab_')) {
    const t = id.slice(4), b = PALETTE.bone, icons = { play: `<polygon points="14,8 42,24 14,40" fill="${b}"/>`, cage: `<rect x="8" y="8" width="32" height="32" fill="none" stroke="${b}" stroke-width="3"/><line x1="24" y1="8" x2="24" y2="40" stroke="${b}" stroke-width="3"/><line x1="8" y1="24" x2="40" y2="24" stroke="${b}" stroke-width="3"/>`, self: `<circle cx="24" cy="16" r="8" fill="${b}"/><path d="M8 42 Q24 20 40 42 Z" fill="${b}"/>`, pets: `<circle cx="24" cy="30" r="9" fill="${b}"/><circle cx="12" cy="18" r="4" fill="${b}"/><circle cx="21" cy="12" r="4" fill="${b}"/><circle cx="30" cy="12" r="4" fill="${b}"/><circle cx="38" cy="18" r="4" fill="${b}"/>`, map: `<polygon points="${hexPath(24, 24, 18)}" fill="none" stroke="${b}" stroke-width="3"/><circle cx="24" cy="24" r="4" fill="${b}"/>`, letters: `<rect x="6" y="12" width="36" height="26" fill="none" stroke="${b}" stroke-width="3"/><polyline points="6,12 24,28 42,12" fill="none" stroke="${b}" stroke-width="3"/>` };
    return svg(w, h, icons[t] || `<circle cx="24" cy="24" r="16" fill="${b}"/>`);
  }
  if (id.startsWith('btn_')) return svg(w, h, `<rect x="2" y="2" width="316" height="68" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="3"${op}/>`);
  if (id.startsWith('panel_')) { const k = id.slice(6); const st = k === 'alert' ? PALETTE.oxblood2 : PALETTE.gold; return svg(w, h, `<rect x="3" y="3" width="354" height="234" rx="10" fill="${PALETTE.velvet2}" stroke="${st}" stroke-width="3"/>${k === 'ornate' ? `<rect x="10" y="10" width="340" height="220" rx="6" fill="none" stroke="${PALETTE.brass}" stroke-width="1.5"/><circle cx="10" cy="10" r="5" fill="${PALETTE.gold2}"/><circle cx="350" cy="10" r="5" fill="${PALETTE.gold2}"/><circle cx="10" cy="230" r="5" fill="${PALETTE.gold2}"/><circle cx="350" cy="230" r="5" fill="${PALETTE.gold2}"/>` : ''}`); }
  return svg(w, h, `<rect width="${w}" height="${h}" fill="${PALETTE.velvet2}"/>`);
}
draw.tv = (row) => {
  const id = row.key.split('/')[1], [w, h] = row.size;
  if (id.startsWith('chaos_banner_')) { const t = row.meta.tier, cols = ['#3a3340', '#5a1a1a', '#7a2424', '#a02020', '#ff3fa4']; return svg(w, h, `<rect width="${w}" height="${h}" fill="${cols[t - 1]}" opacity="0.92"/><rect x="0" y="0" width="${w}" height="8" fill="${PALETTE.gold2}"/><rect x="0" y="${h - 8}" width="${w}" height="8" fill="${PALETTE.gold2}"/><text x="${w / 2}" y="${h / 2 + 24}" fill="${PALETTE.bone}" font-size="72" text-anchor="middle" ${FONT}>CHAOS TIER ${t}</text>`); }
  if (id === 'clock_face') { let ticks = ''; for (let i = 0; i < 60; i++) { const a = (i / 60) * 2 * Math.PI, l = i % 5 ? 8 : 18; ticks += `<line x1="${(160 + 140 * Math.cos(a)).toFixed(1)}" y1="${(160 + 140 * Math.sin(a)).toFixed(1)}" x2="${(160 + (140 - l) * Math.cos(a)).toFixed(1)}" y2="${(160 + (140 - l) * Math.sin(a)).toFixed(1)}" stroke="${PALETTE.bone}" stroke-width="${i % 5 ? 2 : 4}"/>`; } return svg(w, h, `<circle cx="160" cy="160" r="150" fill="${PALETTE.velvet}" stroke="${PALETTE.gold2}" stroke-width="8"/>${ticks}<circle cx="160" cy="160" r="8" fill="${PALETTE.oxblood2}"/>`); }
  if (id === 'offscreen_card') return svg(w, h, `<rect x="4" y="4" width="632" height="352" rx="16" fill="${PALETTE.velvet}" stroke="${PALETTE.gold2}" stroke-width="6"/><circle cx="320" cy="110" r="60" fill="${PALETTE.oxblood}" stroke="${PALETTE.gold}" stroke-width="4"/><rect x="60" y="200" width="100" height="130" fill="${PALETTE.smoke}"/><rect x="480" y="200" width="100" height="130" fill="${PALETTE.smoke}"/><text x="320" y="250" fill="${PALETTE.bone}" font-size="40" text-anchor="middle" ${FONT}>OFF-SCREEN</text><text x="320" y="310" fill="${PALETTE.amber}" font-size="48" text-anchor="middle" ${FONT}>5:00</text>`);
  if (id === 'recap_card') return svg(w, h, `<rect x="6" y="6" width="588" height="788" rx="24" fill="${PALETTE.velvet}" stroke="${PALETTE.gold2}" stroke-width="10"/><rect x="40" y="40" width="520" height="720" rx="12" fill="none" stroke="${PALETTE.brass}" stroke-width="3"/>`);
  const title = { header: 'GAMBLING WITH FRIENDS', panel_frame: '', panel_frame_wide: '', fight_panel: 'FIGHT', ticker: 'STANDINGS', recap_frame: 'RECAP' }[id] ?? '';
  return svg(w, h, `<rect x="0" y="0" width="${w}" height="${h}" fill="${PALETTE.velvet}" opacity="0.94"/><rect x="0" y="${h - 6}" width="${w}" height="6" fill="${PALETTE.gold2}"/><rect x="0" y="0" width="${w}" height="3" fill="${PALETTE.brass}"/>${title ? `<text x="40" y="${h / 2 + 18}" fill="${PALETTE.bone}" font-size="48" ${FONT}>${title}</text>` : ''}`);
};

// ── Render + write ─────────────────────────────────────────────────
export function render(row, data) {
  draw._data = data;
  const fn = draw[row.group]; if (!fn) throw new Error(`no drawer for group ${row.group}`);
  const out = fn(row);
  if (typeof out === 'string') return Buffer.from(out, 'utf8');
  if (!out) throw new Error(`drawer returned nothing for ${row.key}`);
  if (row.kind !== 'png') throw new Error(`${row.key}: ${row.kind} expected, canvas returned`);
  return P.encodePlaceholderPNG(out, row.key);
}

export function generate({ check = false, quiet = false, rows = null } = {}) {
  const data = loadData();
  data.monsterNames = {}; const monP = path.join(ROOT, 'data/monsters.json'); if (existsSync(monP)) { try { for (const s of JSON.parse(readFileSync(monP, 'utf8')).species || []) data.monsterNames[s.id] = s.name; } catch { /* ignore */ } }
  rows = rows || buildAssetList(data).filter(r => r.kind !== 'wav');
  const stats = {}; const changed = [];
  for (const row of rows) {
    const s = (stats[row.group] ||= { new: 0, same: 0, updated: 0, kept: 0 });
    const abs = path.join(ROOT, row.path);
    const buf = render(row, data);
    if (existsSync(abs)) {
      const cur = readFileSync(abs);
      if (cur.equals(buf)) { s.same++; continue; }
      if (!isPlaceholderFile(cur, row.kind)) { s.kept++; continue; }
      s.updated++;
    } else s.new++;
    changed.push(row.path);
    if (!check) { mkdirSync(path.dirname(abs), { recursive: true }); writeFileSync(abs, buf); }
  }
  if (!quiet) { for (const [g, s] of Object.entries(stats)) console.log(`${g.padEnd(12)} ${String(s.new + s.same + s.updated + s.kept).padStart(4)}  new ${s.new}  same ${s.same}  updated ${s.updated}  real-art-kept ${s.kept}`); console.log(`total ${rows.length} assets${check ? `, ${changed.length} would change` : ''}`); }
  return { stats, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const t0 = Date.now(); const { changed } = generate({ check });
  console.log(`${check ? 'checked' : 'wrote'} in ${Date.now() - t0} ms`);
  if (check && changed.length) process.exit(1);
}
