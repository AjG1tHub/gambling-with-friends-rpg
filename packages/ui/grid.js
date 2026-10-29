// The Cage grid (SPEC.md › Inventory grid): the drag-and-drop tile inventory on the phone, shared with the paper
// doll through one drag controller. Touch-first: a long-press (250 ms) lifts an item, it snaps to cells while
// dragging, a second finger (or the ↻ badge) rotates it, a bad placement shakes red and snaps back. Releasing
// without moving leaves the item "held": tap it to rotate in place, tap a free cell to put it there, drag it
// anywhere, or Cancel. Drops go to the engine as GRID_MOVE / GRID_EQUIP; the engine's refusals toast.
//
// main.js rebuilds the whole screen on every event, so everything that must outlive a render (the drag, the held
// item, the open details sheet) lives in module state and is re-applied by the next render.
//
//   gridElement({ c, state, me, dispatch, myTurn, width })   the grid box with its header (Auto-sort, Cancel)
//   itemSheet({ c, state, me, dispatch, myTurn })            the details sheet for the selected item (or null)
//   lootPanel({ c, state, dispatch, myTurn })                 loot lying on my hex, with Take
//   itemIcon(item, size, opts)                                a framed icon (paper doll, loot, trade lists)
//   pressable(el, { item, from, c, dispatch })                long-press + drag wiring (the paper doll uses it)
//   gridUi                                                    the module state (drag, held, selected)
import '../shared/index.js';   // handlers register in their canonical order before any handler helper is imported
import { h, toast, buzz } from './dom.js';
import * as G from '../shared/characters/grid.js';
import { itemIconUrl, frameUrl, rarityColour, loadManifest, manifestNow } from './sprite.js';
import { gameById } from '../shared/characters/generator.js';
import { leverSummary } from '../games/lever-view.js';
import { slotsFor, wornSlotOf } from '../shared/handlers/inventory.js';
import { sellPriceOf } from '../shared/handlers/economy.js';
import { group } from '../shared/balance.js';

export const CELL_MAX = 60, GAP = 2, PAD = 8, PRESS_MS = 250, SLOP = 8;
export const gridUi = { drag: null, held: null, selected: null, dispatch: null, confirmDrop: null, trade: null, last: null };
if (typeof window !== 'undefined') window.__gwfGrid = gridUi;   // for the browser tests

const SLOT_GLYPH = { weapon: '⚔', offhand: '🛡', spell: '✦', helmet: '⛑', torso: '🧥', pants: '👖', gloves: '🧤', boots: '👢', ring: '💍', necklace: '📿', consumable: '🧪', egg: '🥚', satchel: '🎒', tool: '🔭', cape: '🧣' };
export const SLOT_LABEL = { mainhand: 'Main hand', offhand: 'Off hand', spell1: 'Spell I', spell2: 'Spell II', helmet: 'Helmet', torso: 'Torso', pants: 'Pants', gloves: 'Gloves', boots: 'Boots', ring1: 'Ring', ring2: 'Ring', ring3: 'Ring', ring4: 'Ring', necklace: 'Necklace', cape: 'Cape' };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

export function cellSizeFor(cols, width = (typeof window !== 'undefined' ? window.innerWidth : 390)) {
  return Math.max(28, Math.min(CELL_MAX, Math.floor((width - 32 - 2 * PAD - GAP * (cols - 1)) / cols)));
}

// ── framed icon ──────────────────────────────────────────────────
// A framed item icon `w × h` cells at `cell` px (or a square of `size` px when `size` is given). The rarity frame
// is the 9-slice from the manifest when it exists, else a rarity-coloured border; Legendary glows.
export function itemIcon(item, size = 44, { cell = null, w = 1, h: hh = 1, rot = 0, showName = false } = {}) {
  const fp = G.footprintOf(item, 0); const cw = cell ? fp.w : w, ch = cell ? fp.h : hh;
  const pitch = cell ? cell + GAP : size;
  const boxW = cell ? pitch * (rot ? ch : cw) - GAP : size, boxH = cell ? pitch * (rot ? cw : ch) - GAP : size;
  const frameW = cell ? pitch * cw - GAP : size, frameH = cell ? pitch * ch - GAP : size;
  const colour = rarityColour(item?.rarity);
  const el = h('div', { class: `gi-icon r-${item?.rarity || 'common'}`, style: { width: `${boxW}px`, height: `${boxH}px` } });
  const frame = h('div', { class: 'gi-frame', style: { width: `${frameW}px`, height: `${frameH}px`, borderColor: colour, transform: rot ? 'translate(-50%,-50%) rotate(90deg)' : 'translate(-50%,-50%)' } });
  const fu = frameUrl(item?.rarity, cw, ch); if (fu) frame.style.borderImage = `url("${fu}") 12 fill / ${Math.max(6, Math.round(Math.min(frameW, frameH) * 0.18))}px stretch`;
  const url = itemIconUrl(item); const iconSize = Math.max(14, Math.min(frameW, frameH) - 14);
  const img = url ? h('img', { src: url, alt: '', draggable: false, class: 'gi-img', style: { width: `${iconSize}px`, height: `${iconSize}px` } }) : h('span', { class: 'gi-glyph', style: { fontSize: `${Math.round(iconSize * 0.6)}px` } }, SLOT_GLYPH[item?.slot] || '▪');
  if (url) img.onerror = () => img.replaceWith(h('span', { class: 'gi-glyph', style: { fontSize: `${Math.round(iconSize * 0.6)}px` } }, SLOT_GLYPH[item?.slot] || '▪'));
  frame.append(img);
  if (showName && cell && cw * ch >= 2 && item?.name) frame.append(h('span', { class: `gi-name ${ch > cw ? 'vert' : ''}` }, String(item.name).toUpperCase()));
  el.append(frame);
  const qty = item?.qty || 1; if (qty > 1) el.append(h('span', { class: 'gi-qty' }, qty));
  if (item?.charges > 0 && item.slot !== 'consumable' && (item.setId === 'gilt' || item.legendaryId)) el.append(h('span', { class: 'gi-charges' }, item.charges));
  return el;
}

// ── drag controller ──────────────────────────────────────────────
let listening = false;
function listen() {
  if (listening || typeof document === 'undefined') return; listening = true;
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('pointerdown', onAnyDown, true);
}
const press = { active: null, timer: 0 };
function clearPress() { clearTimeout(press.timer); press.active = null; }

// Wire long-press lift and tap on an item element. `from` is {kind:'grid', x, y, rot} or {kind:'slot', slot}.
export function pressable(el, { item, from, c, dispatch, onTap }) {
  listen();
  el.dataset.itemId = item.id; el.style.touchAction = 'none';
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    if (gridUi.drag) return;   // the second finger is handled by onAnyDown (rotate)
    gridUi.dispatch = dispatch || gridUi.dispatch;
    const held = gridUi.held && gridUi.held.itemId === item.id;
    press.active = { x: e.clientX, y: e.clientY, t: Date.now(), item, from, c, el, pointerId: e.pointerId, onTap, held };
    clearTimeout(press.timer);
    // A held item lifts as soon as the finger moves (a tap on it rotates); anything else after the long-press delay.
    press.timer = setTimeout(() => { if (press.active) lift(press.active.x, press.active.y); }, PRESS_MS);
  });
}
function lift(clientX, clientY) {
  const p = press.active; if (!p) return;
  const { item, from, c, el } = p;
  const rect = el.getBoundingClientRect();
  const gridEl = gridNode(); const cell = gridEl ? Number(gridEl.dataset.cell) : 40; const pitch = cell + GAP;
  const rot = gridUi.held?.itemId === item.id ? gridUi.held.rot : (from.rot || 0);
  // Which cell of the footprint the finger holds, so the snap feels anchored.
  const grabDx = from.kind === 'grid' ? Math.max(0, Math.min(G.footprintOf(item, rot).w - 1, Math.floor((clientX - rect.left) / pitch))) : 0;
  const grabDy = from.kind === 'grid' ? Math.max(0, Math.min(G.footprintOf(item, rot).h - 1, Math.floor((clientY - rect.top) / pitch))) : 0;
  gridUi.drag = { itemId: item.id, item, from, c, rot, grabDx, grabDy, pointerId: p.pointerId, startX: clientX, startY: clientY, moved: false, ghost: null, over: null };
  gridUi.held = null; gridUi.selected = null;
  el.classList.add('lifted'); buzz(30);
  const ghost = h('div', { class: 'gi-ghost' }, itemIcon(item, 0, { cell, rot, showName: true }), h('span', { class: 'gi-rotate', title: 'rotate' }, '↻'));
  document.body.append(ghost); gridUi.drag.ghost = ghost;
  positionGhost(clientX, clientY);
  updateHover(clientX, clientY);
  clearPress();
}
function positionGhost(x, y) {
  const d = gridUi.drag; if (!d?.ghost) return;
  const gridEl = gridNode(); const cell = gridEl ? Number(gridEl.dataset.cell) : 40; const pitch = cell + GAP;
  d.ghost.style.left = `${x - d.grabDx * pitch - cell / 2}px`; d.ghost.style.top = `${y - d.grabDy * pitch - cell / 2}px`;
}
export const gridNode = () => document.querySelector('[data-gwf-grid]');
function gridCellAt(clientX, clientY) {
  const gridEl = gridNode(); if (!gridEl) return null;
  const r = gridEl.getBoundingClientRect(); const cell = Number(gridEl.dataset.cell), pitch = cell + GAP;
  const x = Math.floor((clientX - r.left - PAD) / pitch), y = Math.floor((clientY - r.top - PAD) / pitch);
  const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  return { x, y, inside, gridEl, cell, pitch };
}
function slotAt(clientX, clientY) {
  const d = gridUi.drag; if (d?.ghost) d.ghost.style.display = 'none';
  const el = document.elementFromPoint(clientX, clientY);
  if (d?.ghost) d.ghost.style.display = '';
  return el?.closest?.('[data-slot]') || null;
}
function updateHover(clientX, clientY) {
  const d = gridUi.drag; if (!d) return;
  for (const s of document.querySelectorAll('[data-slot].drop-ok, [data-slot].drop-bad')) s.classList.remove('drop-ok', 'drop-bad');
  const slotEl = slotAt(clientX, clientY);
  const hover = hoverNode();
  if (slotEl) {
    const slot = slotEl.dataset.slot; const ok = slotsFor(d.item).includes(slot) || (d.item.twoHand && slot === 'mainhand');
    slotEl.classList.add(ok ? 'drop-ok' : 'drop-bad'); d.over = { kind: 'slot', slot, ok };
    if (hover) hover.style.display = 'none';
    return;
  }
  const g = gridCellAt(clientX, clientY);
  if (!g || !g.inside) { d.over = null; if (hover) hover.style.display = 'none'; return; }
  const x = g.x - d.grabDx, y = g.y - d.grabDy; const ok = G.fits(d.c, d.item, x, y, d.rot);
  d.over = { kind: 'grid', x, y, ok };
  if (hover) {
    const fp = G.footprintOf(d.item, d.rot);
    Object.assign(hover.style, { display: 'block', left: `${PAD + x * g.pitch}px`, top: `${PAD + y * g.pitch}px`, width: `${fp.w * g.pitch - GAP}px`, height: `${fp.h * g.pitch - GAP}px` });
    hover.className = `grid-hover ${ok ? 'ok' : 'bad'}`;
  }
}
function hoverNode() { const gridEl = gridNode(); if (!gridEl) return null; let n = gridEl.querySelector('.grid-hover'); if (!n) { n = h('div', { class: 'grid-hover' }); gridEl.append(n); } return n; }
function onAnyDown(e) {
  const d = gridUi.drag;
  if (d && e.pointerId !== d.pointerId) { e.preventDefault(); rotateDrag(); return; }
  // A tap anywhere outside the held item (and its grid/slots) lets go of it.
  if (gridUi.held && !d && !e.target.closest?.(`[data-item-id="${gridUi.held.itemId}"], [data-gwf-grid], [data-slot], .cage-tools`)) { gridUi.held = null; rerenderSoon(); }
}
function rotateDrag() {
  const d = gridUi.drag; if (!d) return;
  const fp = G.footprintOf(d.item); if (fp.w === fp.h) { toast('That one is square'); return; }
  d.rot = (d.rot + 1) % 2; d.grabDx = 0; d.grabDy = 0; buzz(15);
  const gridEl = gridNode(); const cell = gridEl ? Number(gridEl.dataset.cell) : 40;
  d.ghost.replaceChildren(itemIcon(d.item, 0, { cell, rot: d.rot, showName: true }), h('span', { class: 'gi-rotate' }, '↻'));
  positionGhost(d.lastX ?? d.startX, d.lastY ?? d.startY); updateHover(d.lastX ?? d.startX, d.lastY ?? d.startY);
}
function onMove(e) {
  const p = press.active;
  if (p && !gridUi.drag && e.pointerId === p.pointerId) { if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) { if (p.held) lift(p.x, p.y); else clearPress(); } return; }
  const d = gridUi.drag; if (!d || e.pointerId !== d.pointerId) return;
  e.preventDefault();
  d.lastX = e.clientX; d.lastY = e.clientY;
  if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > SLOP) d.moved = true;
  edgeScroll(e.clientY);   // scroll first, so the snap preview matches what is under the finger
  positionGhost(e.clientX, e.clientY); updateHover(e.clientX, e.clientY);
}
// Dragging near the top or bottom of the viewport scrolls the screen so the whole grid is reachable.
function edgeScroll(clientY) {
  const vh = window.innerHeight, zone = 70;
  const dy = clientY > vh - zone - 60 ? Math.ceil((clientY - (vh - zone - 60)) / 6) : clientY < zone + 60 ? -Math.ceil((zone + 60 - clientY) / 6) : 0;
  if (!dy) return;
  const sc = document.querySelector('.screen');
  if (sc && sc.scrollHeight > sc.clientHeight + 2) sc.scrollTop += dy; else window.scrollBy({ top: dy, behavior: 'instant' });
}
function onUp(e) {
  const p = press.active;
  if (p && !gridUi.drag && e.pointerId === p.pointerId) {
    // A short press that never lifted: a tap. On a held item that means rotate in place.
    clearPress();
    if (Date.now() - p.t < PRESS_MS + 50 && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= SLOP) p.onTap?.(p.item, p.from);
    return;
  }
  const d = gridUi.drag; if (!d || e.pointerId !== d.pointerId) return;
  finishDrag(e.clientX, e.clientY);
}
function onCancel(e) { if (press.active && e.pointerId === press.active.pointerId) clearPress(); const d = gridUi.drag; if (d && e.pointerId === d.pointerId) endDrag(false); }
function endDrag(ok) {
  const d = gridUi.drag; if (!d) return;
  d.ghost?.remove(); gridUi.drag = null;
  const hover = document.querySelector('[data-gwf-grid] .grid-hover'); if (hover) hover.style.display = 'none';
  for (const s of document.querySelectorAll('[data-slot].drop-ok, [data-slot].drop-bad')) s.classList.remove('drop-ok', 'drop-bad');
  const el = document.querySelector(`[data-item-id="${d.itemId}"]`); if (el) { el.classList.remove('lifted'); if (!ok) shake(el); }
}
export function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); buzz([20, 30, 20]); setTimeout(() => el.classList.remove('shake'), 450); }
async function finishDrag(clientX, clientY) {
  const d = gridUi.drag;
  if (!d.over || !d.lastX) updateHover(clientX, clientY);   // otherwise drop exactly where the preview last showed
  gridUi.last = { itemId: d.itemId, moved: d.moved, over: d.over, from: d.from, rot: d.rot, at: [clientX, clientY] };
  const dispatch = gridUi.dispatch;
  // No movement at all: keep the item held (tap to rotate, tap a cell to place).
  if (!d.moved && d.over?.kind !== 'slot') {
    gridUi.held = { itemId: d.itemId, rot: d.rot, from: d.from }; endDrag(true); rerenderSoon(); return;
  }
  const over = d.over;
  if (!over) { endDrag(false); return; }
  if (over.kind === 'slot') {
    if (!over.ok) { endDrag(false); toast(`${d.item.name} does not go there`, 'bad'); return; }
    if (d.from.kind === 'slot' && d.from.slot === over.slot) { endDrag(true); return; }
    endDrag(true); const ok = await dispatch?.('GRID_EQUIP', { itemId: d.itemId, slot: over.slot }); if (ok === false) shake(document.querySelector(`[data-item-id="${d.itemId}"]`));
    return;
  }
  if (!over.ok) { endDrag(false); return; }
  if (d.from.kind === 'grid' && d.from.x === over.x && d.from.y === over.y && d.from.rot === d.rot) { endDrag(true); return; }
  endDrag(true);
  const ok = await dispatch?.('GRID_MOVE', { itemId: d.itemId, x: over.x, y: over.y, rot: d.rot });
  if (ok === false) shake(document.querySelector(`[data-item-id="${d.itemId}"]`));
}
// Ask the frame to redraw (main.js re-renders on events; between events we re-run the last view).
let rerenderFn = null;
export function onRerender(fn) { rerenderFn = fn; }
export function rerenderSoon() { if (rerenderFn) requestAnimationFrame(() => rerenderFn?.()); }

// ── the grid ─────────────────────────────────────────────────────
export function gridElement({ c, state, me, dispatch, myTurn = false, width } = {}) {
  gridUi.dispatch = dispatch;
  const grid = c?.grid || { cols: 8, rows: 6, cells: [] }; const items = c?.items || {};
  const cell = cellSizeFor(grid.cols, width); const pitch = cell + GAP;
  const W = PAD * 2 + grid.cols * pitch - GAP, H = PAD * 2 + grid.rows * pitch - GAP;
  const used = G.occupancy(c || { grid, items }).size, total = grid.cols * grid.rows;
  const held = gridUi.held && items[gridUi.held.itemId] ? gridUi.held : (gridUi.held = null);
  if (gridUi.drag && !items[gridUi.drag.itemId]) endDrag(true);
  const box = h('div', { class: 'cage-grid', 'data-gwf-grid': '', 'data-cell': cell, 'data-cols': grid.cols, 'data-rows': grid.rows, style: { width: `${W}px`, height: `${H}px` } });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  // cells
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) {
    const cellEl = h('div', { class: 'cage-cell', style: { left: `${PAD + x * pitch}px`, top: `${PAD + y * pitch}px`, width: `${cell}px`, height: `${cell}px` } });
    cellEl.addEventListener('click', () => {
      // Tapping a free cell places the held item there (its top-left on that cell).
      const hd = gridUi.held; if (!hd || gridUi.drag) return; const it = items[hd.itemId]; if (!it) return;
      if (!G.fits(c, it, x, y, hd.rot)) { shake(cellEl); return; }
      gridUi.held = null; dispatch?.('GRID_MOVE', { itemId: it.id, x, y, rot: hd.rot }).then(ok => { if (ok === false) rerenderSoon(); });
    });
    box.append(cellEl);
  }
  // items
  for (const cr of grid.cells) {
    const item = items[cr.itemId]; if (!item) continue;
    const isHeld = held?.itemId === item.id; const rot = isHeld ? held.rot : (cr.rot || 0);
    const fp = G.footprintOf(item, rot);
    const el = h('div', { class: `gi ${isHeld ? 'held' : ''} ${gridUi.drag?.itemId === item.id ? 'lifted' : ''} ${gridUi.selected === item.id ? 'selected' : ''}`, role: 'button', 'aria-label': item.name, tabindex: 0,
      style: { left: `${PAD + cr.x * pitch}px`, top: `${PAD + cr.y * pitch}px`, width: `${fp.w * pitch - GAP}px`, height: `${fp.h * pitch - GAP}px` } },
      itemIcon(item, 0, { cell, rot, showName: true }));
    if (isHeld) { el.append(h('span', { class: 'gi-rotate on' }, '↻')); if (!G.fits(c, item, cr.x, cr.y, rot)) el.classList.add('bad'); }
    pressable(el, { item, from: { kind: 'grid', x: cr.x, y: cr.y, rot: cr.rot || 0 }, c, dispatch, onTap: (it) => {
      if (gridUi.held?.itemId === it.id) rotateHeld(c, it, cr, dispatch);
      else { gridUi.held = null; gridUi.selected = gridUi.selected === it.id ? null : it.id; gridUi.confirmDrop = null; gridUi.trade = null; rerenderSoon(); }
    } });
    box.append(el);
  }
  box.append(h('div', { class: 'grid-hover', style: { display: 'none' } }));
  const tools = h('div', { class: 'cage-tools row between' },
    h('div', { class: 'tag' }, `Grid ${grid.cols} × ${grid.rows}`),
    h('div', { class: 'muted small' }, `${used} of ${total} cells · `, h('span', { class: 'ital' }, held ? 'tap to rotate, tap a cell to place' : 'long-press to lift')),
    held ? h('button', { class: 'ghost mini', onClick: () => { gridUi.held = null; rerenderSoon(); } }, 'Let go')
      : h('button', { class: 'ghost mini', disabled: !grid.cells.length, onClick: () => dispatch?.('GRID_SORT', {}) }, 'Auto-sort'));
  const wrap = h('div', { class: 'cage-grid-wrap' }, tools, h('div', { class: 'cage-grid-scroll' }, box));
  if (!manifestNow()) loadManifest().then(() => rerenderSoon());   // icons and frames need the manifest; redraw once it lands
  return wrap;
}
function rotateHeld(c, item, cr, dispatch) {
  const fp = G.footprintOf(item); if (fp.w === fp.h) { toast('That one is square'); return; }
  const hd = gridUi.held; hd.rot = (hd.rot + 1) % 2; buzz(15);
  if (G.fits(c, item, cr.x, cr.y, hd.rot)) { gridUi.held = null; dispatch?.('GRID_MOVE', { itemId: item.id, x: cr.x, y: cr.y, rot: hd.rot }).then(ok => { if (ok === false) rerenderSoon(); }); }
  else { rerenderSoon(); toast('No room to turn it here — tap a free cell or drag it'); }
}

// ── details sheet ────────────────────────────────────────────────
export function describeItem(item, c = null, state = null) {
  const lines = [];
  const def = item.gameId ? gameById(item.gameId) : null;
  if (def) {
    lines.push({ k: 'Game', v: `${def.name}${item.kind === 'spell' ? ' (spell)' : ''}` });
    if (item.stake) lines.push({ k: 'Stake', v: `${item.stake} Health` });
    if (def.goal) lines.push({ k: 'The game', v: def.goal });
    if (def.howTo) lines.push({ k: 'How to play', v: def.howTo });
    if (def.lever) lines.push({ k: `${cap(def.stat)} lever`, v: `${def.lever}${c?.stats?.[def.stat] != null ? ` · ${leverSummary(def.gameId, c.stats[def.stat])}` : ''}` });
    if (item.charges) lines.push({ k: 'Charges', v: `${item.charges}` });
    if (item.twoHand) lines.push({ k: 'Two-handed', v: 'takes both hands' });
  }
  if (item.bootMode) lines.push({ k: 'Boots', v: `${cap(item.bootMode)}${item.die ? ` · d${item.die}` : ''}` });
  if (item.text) lines.push({ k: '', v: item.text });
  if (item.setId) lines.push({ k: 'Set', v: cap(item.setId) + (c?.setBonuses?.[item.setId] ? ` · ${c.setBonuses[item.setId].pieces} worn${c.setBonuses[item.setId].complete ? ', complete' : ''}` : '') });
  for (const a of item.affixes || []) lines.push({ k: a.kind === 'unique' ? 'Unique' : cap(a.kind), v: a.text || a.id, affix: true, kind: a.kind });
  return lines;
}
export function itemSheet({ c, state, me, dispatch, myTurn = false } = {}) {
  const id = gridUi.selected; const item = id && c?.items?.[id]; if (!item) { gridUi.selected = null; return null; }
  const worn = wornSlotOf(c, item.id); const cell = G.cellOf(c, item.id); const fp = G.footprintOf(item);
  const onShop = !!(state?.shops?.[c.pos]) || state?.map?.hexes?.[c.pos]?.type === 'shop';
  const playing = state?.phase === 'playing';
  let price = null; if (onShop) { try { price = sellPriceOf(state, { B: (g) => group(state, g) }, item); } catch { price = null; } }
  const close = () => { gridUi.selected = null; gridUi.confirmDrop = null; gridUi.trade = null; rerenderSoon(); };
  const act = (type, payload) => { close(); dispatch?.(type, payload); };
  const buttons = [];
  if (worn) buttons.push(h('button', { class: 'primary', onClick: () => act('GRID_UNEQUIP', { slot: worn }) }, 'Unequip'));
  else if (slotsFor(item).length) buttons.push(h('button', { class: 'primary', onClick: () => act('GRID_EQUIP', { itemId: item.id }) }, 'Equip'));
  if (item.slot === 'egg') buttons.push(h('button', { class: 'primary', disabled: !playing, onClick: () => act('PET_HATCH', { source: 'egg', itemId: item.id }) }, 'Hatch'));
  else if (item.slot === 'consumable' || item.slot === 'satchel') buttons.push(h('button', { class: 'primary', disabled: !playing, title: playing ? '' : 'Only during the run', onClick: () => act('CONSUMABLE_USE', { itemId: item.id }) }, 'Use'));
  if (cell && fp.w !== fp.h) buttons.push(h('button', { onClick: () => { const rot = ((cell.rot || 0) + 1) % 2; if (!G.fits(c, item, cell.x, cell.y, rot)) { toast('No room to turn it there', 'bad'); return; } act('GRID_MOVE', { itemId: item.id, x: cell.x, y: cell.y, rot }); } }, '↻ Rotate'));
  if (onShop && !worn && playing) buttons.push(h('button', { onClick: () => act('SHOP_SELL', { itemId: item.id }) }, `Sell${price != null ? ` ${price}` : ''}`));
  if (!worn) {
    if (gridUi.confirmDrop === item.id) buttons.push(h('button', { class: 'danger', onClick: () => act('GRID_DROP', { itemId: item.id }) }, 'Really drop'));
    else buttons.push(h('button', { onClick: () => { gridUi.confirmDrop = item.id; rerenderSoon(); } }, 'Drop'));
    if (playing) buttons.push(h('button', { onClick: () => { gridUi.trade = gridUi.trade === item.id ? null : item.id; rerenderSoon(); } }, 'Trade'));
  }
  buttons.push(h('button', { class: 'ghost', onClick: close }, 'Close'));
  const others = Object.values(state?.players || {}).filter(p => p.id !== me?.id && !p.spectator && !p.kicked && state.characters[p.characterId] && !state.characters[p.characterId].dead);
  const tradeBox = gridUi.trade === item.id ? h('div', { class: 'sheet-trade' }, h('div', { class: 'tag' }, 'Offer it to'),
    others.length ? h('div', { class: 'row' }, others.map(p => h('button', { class: 'mini', onClick: () => act('TRADE_OFFER', { toId: p.id, give: { itemIds: [item.id] }, want: {} }) }, p.crest || '🂠', ' ', p.name))) : h('p', { class: 'muted ital' }, 'Nobody to trade with.'),
    h('p', { class: 'muted small' }, 'They answer on their phone; the swap settles at the next end of turn.')) : null;
  const lines = describeItem(item, c, state);
  return h('div', { class: 'item-sheet', role: 'dialog', 'aria-label': item.name },
    h('div', { class: 'sheet-head' }, itemIcon(item, 52),
      h('div', { class: 'grow' }, h('div', { class: 'sheet-name' }, item.name), h('div', { class: 'muted small ital' }, `${cap(item.rarity)} · ${cap(item.slot === 'weapon' ? (item.twoHand ? 'two-hand weapon' : 'weapon') : item.slot)} · ${fp.w} × ${fp.h}${worn ? ` · worn (${SLOT_LABEL[worn] || worn})` : cell ? '' : ' · not placed'}${item.qty > 1 ? ` · ×${item.qty}` : ''}`)),
      h('span', { class: `pill r-${item.rarity}` }, cap(item.rarity))),
    h('div', { class: 'sheet-lines' }, lines.length ? lines.map(l => h('div', { class: `line ${l.affix ? 'affix k-' + l.kind : ''}` }, l.k ? h('span', { class: 'k' }, l.k) : null, h('span', { class: 'v' }, l.v))) : h('p', { class: 'muted ital' }, 'No affixes. Plain, honest kit.')),
    tradeBox,
    h('div', { class: 'sheet-buttons' }, buttons));
}

// ── tile loot ────────────────────────────────────────────────────
export function lootPanel({ c, state, dispatch, myTurn = false } = {}) {
  const list = c?.pos ? state?.tileLoot?.[c.pos] || [] : [];
  if (!list.length) return null;
  return h('div', { class: 'panel loot-panel' }, h('h3', {}, 'On this hex'),
    h('div', { class: 'list' }, list.map(it => h('div', { class: 'item' }, itemIcon(it, 44), h('div', { class: 'grow' }, h('div', {}, it.name || 'Something'), h('div', { class: 'muted small ital' }, `${cap(it.rarity || 'common')}${it.by && it.by !== c.id ? ` · left by ${state.characters?.[it.by]?.name || 'someone'}` : ''}`)),
      h('button', { class: 'primary mini', disabled: !myTurn, title: myTurn ? '' : 'On your turn', onClick: () => dispatch?.('TILE_TAKE_LOOT', { itemId: it.id }) }, 'Take')))),
    myTurn ? null : h('p', { class: 'muted small ital' }, 'You can take it on your turn.'));
}
