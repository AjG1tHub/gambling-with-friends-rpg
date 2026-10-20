// The paper-doll sprite renderer (SPEC.md › Character sprites and the paper doll). Draws the ordered layers from
// layersFor(c) onto a canvas with nearest-neighbour scaling: body and weapon sheets carry one frame per
// animation frame; armour sheets carry one frame per pose and are moved with the body by the offset table below.
// Rarity shows as a trim (1 px silver / gold outline, Epic shimmer, Legendary glow); the lantern on the belt is the
// Health tell; pets stand beside the figure at 48 × 48 (fainted ones lie down). Every image goes through one cache
// and a missing image draws a flat silhouette, so a half-generated asset set never breaks a screen.
//
//   renderSprite(canvas, c, { pose, frame, scale, manifest, pets, tick })   draw once
//   spriteElement(c, { pose, scale, pets, fps })                           an animated canvas (stops when detached)
//   tokenElement(c, { scale })                                              head-and-shoulders crop for maps
//   loadManifest()                                                          the asset manifest (cached promise)
import { layersFor, FRAME, PET_FRAME, TOKEN_CROP, POSES, ARMOUR_POSES, petTokenKey } from '../shared/characters/sprites.js';
import { group } from '../shared/balance.js';

// Where a body-sheet pose starts (frames are side by side: idle 4 / attack 6 / hit 2 / death 6 / step 4).
export const POSE_START = (() => { const out = {}; let at = 0; for (const [p, n] of Object.entries(POSES)) { out[p] = at; at += n; } return out; })();
// Per-frame offsets applied to armour layers (one sprite per pose) so they ride the body's hand-drawn motion.
export const ARMOUR_OFFSETS = {
  idle: [[0, 0], [0, -1], [0, -1], [0, 0]],
  attack: [[0, 0], [1, 0], [3, -1], [4, -1], [2, 0], [0, 0]],
  hit: [[-2, 0], [-1, 1]],
  death: [[0, 0], [1, 2], [2, 5], [2, 9], [2, 13], [2, 14]],
  step: [[0, 0], [0, -1], [0, 0], [0, -1]],
};
const TRIM_COLOUR = { silver: '#cfd6dc', gold: '#e0c07a', glow: '#ffd86b' };
const LANTERN_ALIAS = { high: 'full', mid: 'guttering', low: 'out', dead: 'dead' };
const LANTERN_AT = { x: 46, y: 58, size: 16 };    // where the belt lantern hangs, in frame pixels

// ── manifest + image cache ───────────────────────────────────────
let manifestPromise = null, manifestSync = null;
export function loadManifest() {
  if (!manifestPromise) manifestPromise = fetch(assetUrl('assets/manifest.json')).then(r => r.ok ? r.json() : null).then(m => { manifestSync = m; return m; }).catch(() => (manifestSync = null));
  return manifestPromise;
}
export const manifestNow = () => manifestSync;
// assets/ is Vite's publicDir, so `assets/foo/bar.png` in the manifest is served at `/foo/bar.png`.
export const assetUrl = (path) => '/' + String(path || '').replace(/^\/?assets\//, '').replace(/^\//, '');
export function assetEntry(key, manifest = manifestSync) {
  if (!manifest || !key) return null;
  const a = manifest.assets || manifest; const k = manifest.aliases?.[key] || key;
  return a[k] || null;
}
const images = new Map();   // url → { img, ok: true|false|null }
const redrawers = new Set();
export function loadImage(url) {
  if (!url) return null;
  let rec = images.get(url);
  if (!rec) {
    const img = new Image(); rec = { img, ok: null }; images.set(url, rec);
    img.onload = () => { rec.ok = true; for (const fn of redrawers) fn(); };
    img.onerror = () => { rec.ok = false; };
    img.src = url;
  }
  return rec;
}
export const imageFor = (key, manifest) => { const e = assetEntry(key, manifest); return e ? loadImage(assetUrl(e.path)) : null; };
// A UI element can ask to be redrawn when an image lands.
export function onImageLoad(fn) { redrawers.add(fn); return () => redrawers.delete(fn); }

// ── drawing ──────────────────────────────────────────────────────
const px = (ctx) => { ctx.imageSmoothingEnabled = false; ctx.webkitImageSmoothingEnabled = false; return ctx; };
const scratch = () => { const c = document.createElement('canvas'); c.width = FRAME.w; c.height = FRAME.h; return c; };

// Which source frame to blit for a layer: body sheets index by frame; armour sheets by pose (5 frames).
function sourceRect(entry, pose, frame) {
  const sp = entry?.sprite || {}; const fw = sp.frameW || FRAME.w, fh = sp.frameH || FRAME.h; const total = sp.frames || 1;
  const poses = sp.poses || {};
  let idx = 0;
  if (total >= 22 || (poses[pose] || 0) > 1) { let at = 0; for (const [p, n] of Object.entries(poses)) { if (p === pose) { idx = at + (frame % Math.max(1, n)); break; } at += n; } }
  else if (total === ARMOUR_POSES.length) idx = Math.max(0, ARMOUR_POSES.indexOf(pose));
  else idx = frame % total;
  idx = Math.min(idx, total - 1);
  return { sx: idx * fw, sy: 0, sw: fw, sh: fh };
}
function armourOffset(pose, frame) { const t = ARMOUR_OFFSETS[pose] || ARMOUR_OFFSETS.idle; return t[frame % t.length] || [0, 0]; }

// Draw one layer into a 64×96 scratch canvas (unscaled), trims included. Returns the scratch or null.
function drawLayer(layer, pose, frame, tick, manifest) {
  const entry = assetEntry(layer.key, manifest); const rec = entry ? loadImage(assetUrl(entry.path)) : null;
  const out = scratch(); const g = px(out.getContext('2d'));
  // Hand-drawn sheets (22 frames: the body, and weapons once they are drawn per frame) move on their own;
  // everything else is one sprite per pose and rides the body by the offset table.
  const isBody = layer.slot === 'body' || (entry?.sprite?.frames || 0) >= 22;
  const [ox, oy] = isBody ? [0, 0] : armourOffset(pose, frame);
  if (rec?.ok) {
    const { sx, sy, sw, sh } = sourceRect(entry, pose, frame);
    const dw = Math.min(sw, FRAME.w), dh = Math.min(sh, FRAME.h);
    g.drawImage(rec.img, sx, sy, sw, sh, ox + Math.floor((FRAME.w - dw) / 2), oy + (FRAME.h - dh), dw, dh);
  } else if (!drawSilhouette(g, layer, pose, frame, ox, oy)) return null;
  if (layer.trim) applyTrim(out, layer.trim, tick);
  return out;
}
// Missing art: a flat shape in the right place so the figure still reads.
function drawSilhouette(g, layer, pose, frame, ox, oy) {
  const bob = pose === 'idle' ? (frame % 4 === 1 || frame % 4 === 2 ? -1 : 0) : 0;
  const slot = layer.slot;
  if (slot === 'body') {
    g.fillStyle = '#c9a07a'; g.fillRect(22, 10 + bob, 20, 20); // head
    g.fillStyle = '#2a2224'; g.fillRect(20, 30 + bob, 24, 30); // torso
    g.fillRect(22, 60 + bob, 8, 28); g.fillRect(34, 60 + bob, 8, 28); // legs
    g.fillStyle = '#1a1412'; g.fillRect(21, 9 + bob, 22, 1); g.fillRect(19, 29 + bob, 26, 1);
    return true;
  }
  if (slot === 'spell') { const r = 26 + (frame % 2) * 2; const grd = g.createRadialGradient(32, 50, 4, 32, 50, r); grd.addColorStop(0, 'rgba(143,108,255,.45)'); grd.addColorStop(1, 'rgba(143,108,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, FRAME.w, FRAME.h); return true; }
  if (slot === 'rings') { g.fillStyle = '#e0c07a'; const n = layer.count || 1; for (let i = 0; i < n; i++) g.fillRect(16 + (i % 2) * 30, 56 + Math.floor(i / 2) * 3, 2, 2); return true; }
  if (slot === 'lantern') return false;
  if (slot === 'face' || slot === 'hair' || slot === 'pants' || slot === 'boots' || slot === 'torso') return false; // the body silhouette covers these
  const boxes = { helmet: [20, 6, 24, 8], gloves: [14, 54, 8, 8, 42, 54, 8, 8], necklace: [28, 32, 8, 4], cape: [16, 30, 32, 44], mainhand: [48, 28, 4, 36], offhand: [12, 34, 4, 28] };
  const b = boxes[slot]; if (!b) return false;
  g.fillStyle = 'rgba(201,164,92,.55)';
  for (let i = 0; i < b.length; i += 4) g.fillRect(b[i] + ox, b[i + 1] + oy + bob, b[i + 2], b[i + 3]);
  return true;
}
// Rarity trim: a 1 px outline in silver / gold (Epic shimmers between gold and bone every two frames), or a glow.
function applyTrim(layerCanvas, trim, tick) {
  const out = scratch(); const g = px(out.getContext('2d'));
  if (trim === 'glow') {
    g.save(); g.shadowColor = TRIM_COLOUR.glow; g.shadowBlur = 6 + (tick % 20 < 10 ? 1 : 3); g.drawImage(layerCanvas, 0, 0); g.restore();
  } else {
    const colour = trim === 'gold' && Math.floor(tick / 2) % 2 ? '#fff2c8' : TRIM_COLOUR[trim] || TRIM_COLOUR.silver;
    const mask = scratch(); const mg = px(mask.getContext('2d'));
    mg.drawImage(layerCanvas, 0, 0); mg.globalCompositeOperation = 'source-in'; mg.fillStyle = colour; mg.fillRect(0, 0, FRAME.w, FRAME.h);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.drawImage(mask, dx, dy);
  }
  g.drawImage(layerCanvas, 0, 0);
  const lg = px(layerCanvas.getContext('2d')); lg.clearRect(0, 0, FRAME.w, FRAME.h); lg.drawImage(out, 0, 0);
}
function drawLantern(g, layer, tick, manifest) {
  const third = String(layer.key).split('/')[1] || 'high';
  const entry = assetEntry(`lantern/${LANTERN_ALIAS[third] || third}`, manifest) || assetEntry(layer.key, manifest);
  const rec = entry ? loadImage(assetUrl(entry.path)) : null;
  const { x, y, size } = LANTERN_AT;
  if (rec?.ok) { const sp = entry.sprite || {}; const fw = sp.frameW || 128, n = sp.frames || 1; const i = Math.floor(tick / 4) % n; g.drawImage(rec.img, i * fw, 0, fw, sp.frameH || fw, x, y, size, size); return; }
  const colour = { high: '#f0b66a', mid: '#d88a3a', low: '#7a3a1a', dead: '#333' }[third] || '#f0b66a';
  g.fillStyle = '#2a2224'; g.fillRect(x + 5, y, 6, 4); g.fillStyle = colour; g.fillRect(x + 4, y + 4, 8, 10);
  if (third !== 'dead') { g.fillStyle = 'rgba(240,182,106,.25)'; g.fillRect(x, y + 1, 16, 16); }
}
function drawPet(g, pet, x, y, size, tick, manifest) {
  const key = `pets/${pet.speciesId}_${(pet.stage || 0) + 1}`;
  const entry = assetEntry(key, manifest) || assetEntry(petTokenKey(pet), manifest);
  const rec = entry ? loadImage(assetUrl(entry.path)) : null;
  const bob = pet.fainted ? 0 : (Math.floor(tick / 6) % 2);
  g.save();
  if (pet.fainted) { g.translate(x + size / 2, y + size / 2); g.rotate(Math.PI / 2); g.translate(-(x + size / 2), -(y + size / 2)); g.globalAlpha = .6; }
  if (rec?.ok) g.drawImage(rec.img, x, y + bob, size, size);
  else { g.fillStyle = '#6a5a3a'; g.beginPath(); g.ellipse(x + size / 2, y + size / 2 + bob, size * .36, size * .3, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e9e1cf'; g.fillRect(x + size * .4, y + size * .4 + bob, 2, 2); g.fillRect(x + size * .55, y + size * .4 + bob, 2, 2); }
  g.restore();
}

// Draw a character once. `pets` draws the active pet (or the first) beside the figure; `tick` drives shimmer/flicker.
export function renderSprite(canvas, c, { pose = 'idle', frame = 0, scale = 2, manifest = manifestSync, pets = true, tick = 0, health = null, bob = true } = {}) {
  const petList = pets ? petsToShow(c) : [];
  const petSize = Math.round(PET_FRAME.w / 2) * scale;
  const w = FRAME.w * scale + (petList.length ? petSize + 2 * scale : 0), h = FRAME.h * scale;
  if (canvas.width !== w) canvas.width = w; if (canvas.height !== h) canvas.height = h;
  const g = px(canvas.getContext('2d')); g.clearRect(0, 0, w, h);
  if (!c) return canvas;
  const H = health || safeHealthGroup();
  const layers = safeLayers(c, H);
  const dead = c.dead || pose === 'death';
  const bobY = bob && pose === 'idle' && !dead ? (frame % 4 === 1 || frame % 4 === 2 ? -1 : 0) : 0;
  const drawn = new Set();   // the class outfit sheet covers torso + pants + boots in one; draw it once
  for (const layer of layers) {
    if (layer.slot === 'lantern') continue;   // drawn last, scaled, below
    if (layer.key?.startsWith('outfit/')) { if (drawn.has(layer.key)) continue; drawn.add(layer.key); }
    const img = drawLayer(layer, pose, frame, tick, manifest); if (!img) continue;
    if (dead && pose !== 'death') g.globalAlpha = .55;
    g.drawImage(img, 0, bobY * scale, FRAME.w * scale, FRAME.h * scale);
    g.globalAlpha = 1;
  }
  // The lantern on top of everything, drawn at frame scale then blitted up.
  const lantern = layers.find(l => l.slot === 'lantern');
  if (lantern) { const s = scratch(); drawLantern(px(s.getContext('2d')), lantern, tick, manifest); g.drawImage(s, 0, bobY * scale, FRAME.w * scale, FRAME.h * scale); }
  petList.forEach((pet, i) => drawPet(g, pet, FRAME.w * scale + 2 * scale, h - petSize * (i + 1) - 2 * scale * i, petSize, tick, manifest));
  return canvas;
}
function petsToShow(c) { const list = c?.pets || []; const active = list.find(p => p.id === c.activePetId); return active ? [active] : list.slice(0, 1); }
function safeLayers(c, H) { try { return layersFor(c, H); } catch { return [{ slot: 'body', key: `body/${c.look?.body ?? 0}_${c.look?.skin ?? 0}`, z: 2 }]; } }
function safeHealthGroup() { try { return group(null, 'health'); } catch { return { tellHigh: .66, tellLow: .33 }; } }

// A canvas that animates while it is in the document. `.stop()` ends it early; detaching ends it on its own.
export function spriteElement(c, { pose = 'idle', scale = 2, pets = true, fps = 6, health = null, className = 'sprite' } = {}) {
  const canvas = document.createElement('canvas'); canvas.className = className; canvas.setAttribute('aria-label', c?.name ? `${c.name}` : 'character');
  canvas.style.imageRendering = 'pixelated';
  let on = true, frame = 0, tick = 0, last = 0, detachedFrames = 0, raf = 0;
  const frames = POSES[pose] || 4; const step = 1000 / fps;
  const draw = () => { try { renderSprite(canvas, c, { pose, frame, scale, pets, tick, health }); } catch (e) { console.error(e); } };
  const loop = (now) => {
    if (!on) return;
    if (!canvas.isConnected) { if (++detachedFrames > 30) { stop(); return; } } else detachedFrames = 0;
    if (now - last >= step) { last = now; tick++; frame = pose === 'death' && frame >= frames - 1 ? frame : (frame + 1) % frames; draw(); }
    raf = requestAnimationFrame(loop);
  };
  const stop = () => { on = false; cancelAnimationFrame(raf); offImg(); };
  const offImg = onImageLoad(draw);
  loadManifest().then(draw);
  draw(); raf = requestAnimationFrame(loop);
  canvas.stop = stop;
  canvas.setPose = (p) => { pose = p; frame = 0; draw(); };
  canvas.redraw = draw;
  return canvas;
}

// The hex token: the sprite at 1× cropped to the head and shoulders (TOKEN_CROP), optionally scaled up.
export function tokenElement(c, { scale = 1, health = null } = {}) {
  const full = document.createElement('canvas');
  const out = document.createElement('canvas'); out.className = 'sprite-token'; out.style.imageRendering = 'pixelated';
  out.width = TOKEN_CROP.w * scale; out.height = TOKEN_CROP.h * scale;
  const draw = () => {
    try {
      renderSprite(full, c, { pose: 'idle', frame: 0, scale: 1, pets: false, health, bob: false });
      const g = px(out.getContext('2d')); g.clearRect(0, 0, out.width, out.height);
      g.drawImage(full, TOKEN_CROP.x, TOKEN_CROP.y, TOKEN_CROP.w, TOKEN_CROP.h, 0, 0, out.width, out.height);
      if (c?.dead) { g.fillStyle = 'rgba(13,10,11,.55)'; g.fillRect(0, 0, out.width, out.height); }
    } catch (e) { console.error(e); }
  };
  const off = onImageLoad(() => { if (out.isConnected || !out.parentNode) draw(); });
  loadManifest().then(draw); draw();
  out.stop = off;
  return out;
}

// A pet alone (the Pets tab cards and hatching wheels): 48 × 48 at `scale`.
export function petElement(pet, { scale = 2 } = {}) {
  const canvas = document.createElement('canvas'); canvas.className = 'pet-sprite'; canvas.style.imageRendering = 'pixelated';
  const size = PET_FRAME.w * scale; canvas.width = size; canvas.height = size;
  let tick = 0, on = true, raf = 0, detached = 0, last = 0;
  const draw = () => { const g = px(canvas.getContext('2d')); g.clearRect(0, 0, size, size); if (pet) drawPet(g, pet, 0, 0, size, tick, manifestSync); };
  const loop = (now) => { if (!on) return; if (!canvas.isConnected) { if (++detached > 30) { on = false; off(); return; } } else detached = 0; if (now - last > 180) { last = now; tick++; draw(); } raf = requestAnimationFrame(loop); };
  const off = onImageLoad(draw);
  loadManifest().then(draw); draw(); raf = requestAnimationFrame(loop);
  canvas.stop = () => { on = false; cancelAnimationFrame(raf); off(); };
  return canvas;
}

// Icon lookup for items (grid cells, paper-doll slots, loot lists): items/<id>, gear/<baseId>, consumables/<id>,
// then the worn or legendary sprite sheet's idle frame. Null when nothing is in the manifest.
export function itemIconUrl(item, manifest = manifestSync) {
  if (!item) return null;
  const keys = [item.icon, `items/${item.baseId}`, `gear/${item.baseId}`, `consumables/${item.baseId}`, `items/${item.gameId}`, `items/${item.id}`, item.legendaryId ? `legendary/${item.legendaryId}` : null, item.sprite].filter(Boolean);
  for (const k of keys) { const e = assetEntry(k, manifest); if (e) return assetUrl(e.path); }
  return null;
}
export const frameUrl = (rarity, w, h, manifest = manifestSync) => { const e = assetEntry(`frames/${rarity || 'common'}_${w}x${h}`, manifest); return e ? assetUrl(e.path) : null; };
export const uiUrl = (name, manifest = manifestSync) => { const e = assetEntry(`ui/${name}`, manifest); return e ? assetUrl(e.path) : null; };
export const RARITY_COLOUR = { common: '#6a5a3a', rare: '#9aa7b0', epic: '#e0c07a', legendary: '#e9e1cf' };
export const rarityColour = (rarity) => RARITY_COLOUR[rarity] || RARITY_COLOUR.common;
// The class crest image (assets/crest/<classId>.png), null when the manifest lacks it.
export const crestUrl = (classId, manifest = manifestSync) => { const e = assetEntry(`crest/${classId}`, manifest); return e ? assetUrl(e.path) : null; };
// A pet's portrait url (pets/<species>_<stage+1>), null when missing.
export const petIconUrl = (pet, manifest = manifestSync) => { if (!pet) return null; const e = assetEntry(`pets/${pet.speciesId}_${(pet.stage || 0) + 1}`, manifest) || assetEntry(petTokenKey(pet), manifest); return e ? assetUrl(e.path) : null; };
