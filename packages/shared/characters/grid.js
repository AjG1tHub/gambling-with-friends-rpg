// The inventory grid (SPEC.md › Inventory grid). Pure functions over a bag: anything shaped like a Character,
// i.e. `{ grid: { cols, rows, cells: [ { itemId, x, y, rot, qty } ] }, items: { itemId: Item } }`. One cell record
// per placed item (its top-left); the item's footprint and `rot` give the cells it covers. Worn items never take
// grid space. Nothing here reads balance or state: callers pass the numbers (stack size, column cap).
//
// Coordinates: x is the column (0..cols-1), y the row (0..rows-1). rot 0 = as drawn, rot 1 = turned 90 degrees.

export function footprintOf(item, rot = 0) {
  const w = item?.footprint?.w || 1, h = item?.footprint?.h || 1;
  return rot % 2 === 1 ? { w: h, h: w } : { w, h };
}
export function cellsOf(item, x, y, rot = 0) {
  const { w, h } = footprintOf(item, rot); const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}
export const cellKey = (x, y) => `${x},${y}`;
export const cellOf = (bag, itemId) => bag.grid.cells.find(c => c.itemId === itemId) || null;
export const inGrid = (bag, itemId) => !!cellOf(bag, itemId);

// Every occupied cell key → itemId, optionally ignoring one item (the one being moved).
export function occupancy(bag, ignoreItemId = null) {
  const occ = new Map();
  for (const cell of bag.grid.cells) {
    if (cell.itemId === ignoreItemId) continue;
    const item = bag.items[cell.itemId]; if (!item) continue;
    for (const c of cellsOf(item, cell.x, cell.y, cell.rot)) occ.set(cellKey(c.x, c.y), cell.itemId);
  }
  return occ;
}
export function freeCells(bag) { return bag.grid.cols * bag.grid.rows - occupancy(bag).size; }

export function fits(bag, item, x, y, rot = 0, ignoreItemId = item?.id ?? null) {
  if (!item || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return false;
  const { w, h } = footprintOf(item, rot);
  if (x + w > bag.grid.cols || y + h > bag.grid.rows) return false;
  const occ = occupancy(bag, ignoreItemId);
  return cellsOf(item, x, y, rot).every(c => !occ.has(cellKey(c.x, c.y)));
}

// First free spot scanning rows then columns, trying both rotations (upright first). Null when nothing fits.
export function firstFit(bag, item, ignoreItemId = item?.id ?? null) {
  for (const rot of [0, 1]) {
    const { w, h } = footprintOf(item, rot);
    if (rot === 1 && w === h) break;
    for (let y = 0; y + h <= bag.grid.rows; y++) for (let x = 0; x + w <= bag.grid.cols; x++) if (fits(bag, item, x, y, rot, ignoreItemId)) return { x, y, rot };
  }
  return null;
}

// Place (or move) an item. Returns the cell record; throws on a bad placement so handlers can refuse().
export function place(bag, item, x, y, rot = 0) {
  if (!fits(bag, item, x, y, rot)) throw new Error(`${item?.name || item?.id} does not fit at ${x},${y}`);
  bag.items[item.id] = bag.items[item.id] || item;
  let cell = cellOf(bag, item.id);
  if (!cell) { cell = { itemId: item.id, x, y, rot, qty: item.qty || 1 }; bag.grid.cells.push(cell); }
  else { cell.x = x; cell.y = y; cell.rot = rot; cell.qty = item.qty || 1; }
  return cell;
}
// Take an item out of the grid (it stays in bag.items unless `forget`). Returns the removed cell or null.
export function remove(bag, itemId, { forget = false } = {}) {
  const i = bag.grid.cells.findIndex(c => c.itemId === itemId);
  const cell = i >= 0 ? bag.grid.cells.splice(i, 1)[0] : null;
  if (forget) delete bag.items[itemId];
  return cell;
}
export function rotate(bag, itemId) {
  const cell = cellOf(bag, itemId); const item = bag.items[itemId];
  if (!cell || !item) throw new Error('not in the grid');
  const rot = (cell.rot + 1) % 2;
  if (!fits(bag, item, cell.x, cell.y, rot)) throw new Error('no room to rotate');
  cell.rot = rot; return cell;
}

// Consumables stack: merge `item` into an existing stack of the same base with room (up to `max`). Returns the
// number of units merged (the caller drops the merged item, or places the remainder).
export function stack(bag, item, max) {
  if (!item?.stackable) return 0;
  let left = item.qty || 1, merged = 0;
  for (const cell of bag.grid.cells) {
    const other = bag.items[cell.itemId];
    if (!other || other.id === item.id || other.baseId !== item.baseId || !other.stackable) continue;
    const room = max - (other.qty || 1); if (room <= 0) continue;
    const take = Math.min(room, left);
    other.qty = (other.qty || 1) + take; cell.qty = other.qty; left -= take; merged += take;
    if (!left) break;
  }
  item.qty = left;
  return merged;
}

// Put an item in the grid wherever it fits (stacking consumables first). Returns true when it is all in.
export function insert(bag, item, { stackMax = 1 } = {}) {
  if (item.stackable && stackMax > 1) { stack(bag, item, stackMax); if ((item.qty || 0) <= 0) { delete bag.items[item.id]; return true; } }
  const spot = firstFit(bag, item);
  if (!spot) return false;
  place(bag, item, spot.x, spot.y, spot.rot);
  return true;
}

// Pack the grid: biggest footprints first, each at its first fit. Everything that was in stays in (the same
// cells exist before and after), so it cannot fail; it only re-arranges.
export function autoSort(bag) {
  const placed = bag.grid.cells.map(c => ({ cell: c, item: bag.items[c.itemId] })).filter(p => p.item);
  placed.sort((a, b) => (footprintOf(b.item).w * footprintOf(b.item).h) - (footprintOf(a.item).w * footprintOf(a.item).h) || String(a.item.slot).localeCompare(String(b.item.slot)) || String(a.item.id).localeCompare(String(b.item.id)));
  const before = bag.grid.cells; bag.grid.cells = [];
  for (const p of placed) {
    const spot = firstFit(bag, p.item, null);
    if (!spot) { bag.grid.cells = before; throw new Error('auto-sort could not repack the grid'); }
    bag.grid.cells.push({ itemId: p.item.id, x: spot.x, y: spot.y, rot: spot.rot, qty: p.item.qty || 1 });
  }
  return bag.grid.cells;
}

// Resize. Growing always works. Shrinking is refused (throws) when an occupied cell would fall off the grid.
export function resize(bag, cols, rows, { maxCols = Infinity } = {}) {
  cols = Math.max(1, Math.min(maxCols, Math.round(cols))); rows = Math.max(1, Math.round(rows));
  const occ = occupancy(bag);
  for (const key of occ.keys()) { const [x, y] = key.split(',').map(Number); if (x >= cols || y >= rows) throw new Error(`cannot shrink to ${cols}x${rows}: ${bag.items[occ.get(key)]?.name || 'an item'} is in the way`); }
  bag.grid.cols = cols; bag.grid.rows = rows;
  return bag.grid;
}
// Chaos "shrink one row": hides the bottom row; items on it are lifted and re-placed, or dropped if nothing fits.
export function shrinkRow(bag) {
  const rows = bag.grid.rows - 1; if (rows < 1) return [];
  const dropped = [];
  for (const cell of [...bag.grid.cells]) {
    const item = bag.items[cell.itemId]; if (!item) continue;
    if (cellsOf(item, cell.x, cell.y, cell.rot).some(c => c.y >= rows)) {
      remove(bag, item.id);
      bag.grid.rows = rows; const spot = firstFit(bag, item); bag.grid.rows = rows + 1;
      if (spot) place(bag, item, spot.x, spot.y, spot.rot); else dropped.push(item);
    }
  }
  bag.grid.rows = rows;
  return dropped;
}
// Chaos "scramble": re-place every item at a random fit using the supplied rng (seeded by the caller).
export function scramble(bag, rng) {
  const items = bag.grid.cells.map(c => bag.items[c.itemId]).filter(Boolean);
  const order = rng.shuffle(items);
  bag.grid.cells = [];
  for (const item of order) {
    const spots = [];
    for (const rot of [0, 1]) { const { w, h } = footprintOf(item, rot); for (let y = 0; y + h <= bag.grid.rows; y++) for (let x = 0; x + w <= bag.grid.cols; x++) if (fits(bag, item, x, y, rot, null)) spots.push({ x, y, rot }); }
    const s = spots.length ? rng.pick(spots) : null;
    if (s) place(bag, item, s.x, s.y, s.rot); else { const f = firstFit(bag, item, null); if (f) place(bag, item, f.x, f.y, f.rot); }
  }
  return bag.grid.cells;
}
export const gridItems = (bag) => bag.grid.cells.map(c => bag.items[c.itemId]).filter(Boolean);
