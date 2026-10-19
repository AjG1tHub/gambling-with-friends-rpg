// The inventory grid: footprints, rotation, fit, stacking, sorting, resizing and the Chaos effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { grid as G } from './_fixtures-characters.mjs';

const bag = (cols = 8, rows = 6) => ({ grid: { cols, rows, cells: [] }, items: {} });
const item = (id, w, h, extra = {}) => ({ id, name: id, slot: 'ring', footprint: { w, h }, qty: 1, stackable: false, ...extra });

test('grid: footprints rotate, cells are enumerated, fits respects edges and occupancy', () => {
  const b = bag(); const sword = item('sword', 1, 3);
  assert.deepEqual(G.footprintOf(sword, 1), { w: 3, h: 1 });
  assert.equal(G.cellsOf(sword, 2, 1, 0).length, 3); assert.deepEqual(G.cellsOf(sword, 0, 0, 1).map(c => c.x), [0, 1, 2]);
  assert.ok(G.fits(b, sword, 0, 0, 0)); assert.ok(!G.fits(b, sword, 0, 4, 0), 'runs off the bottom'); assert.ok(G.fits(b, sword, 0, 5, 1), 'flat it fits');
  assert.ok(!G.fits(b, sword, -1, 0, 0)); assert.ok(!G.fits(b, sword, 7, 0, 1));
  G.place(b, sword, 0, 0, 0);
  assert.ok(!G.fits(b, item('ring', 1, 1), 0, 1, 0), 'occupied'); assert.ok(G.fits(b, item('ring', 1, 1), 1, 1, 0));
  assert.ok(G.fits(b, sword, 0, 0, 0), 'an item ignores its own cells when re-placed');
  assert.throws(() => G.place(b, item('torso', 2, 3), 7, 0, 0), /does not fit/);
  assert.equal(G.freeCells(b), 48 - 3);
});

test('grid: firstFit scans rows then columns and tries the rotation; remove and rotate', () => {
  const b = bag(4, 4);
  G.place(b, item('a', 4, 1), 0, 0, 0); G.place(b, item('b', 4, 1), 0, 1, 0);
  assert.deepEqual(G.firstFit(b, item('c', 1, 2)), { x: 0, y: 2, rot: 0 });
  assert.deepEqual(G.firstFit(b, item('d', 1, 3)), { x: 0, y: 2, rot: 1 }, 'a 1x3 only fits lying down');
  assert.equal(G.firstFit(b, item('e', 3, 3)), null);
  const c = G.place(b, item('c', 1, 2), 0, 2, 0); assert.equal(c.itemId, 'c');
  G.place(b, item('f', 1, 2), 1, 2, 0);
  assert.throws(() => G.rotate(b, 'c'), /no room/, 'f is in the way of c lying down');
  G.remove(b, 'f'); assert.ok(!G.inGrid(b, 'f')); assert.ok(b.items.f, 'remove keeps the item unless forget');
  assert.equal(G.rotate(b, 'c').rot, 1, 'with f gone c can lie down');
  G.remove(b, 'c', { forget: true }); assert.ok(!b.items.c);
  assert.throws(() => G.rotate(b, 'a'), /no room/, 'a cannot stand up through b');
});

test('grid: consumables stack to the cap and nothing else does', () => {
  const b = bag(); const potion = (id, qty) => item(id, 1, 1, { baseId: 'potion', stackable: true, qty, slot: 'consumable' });
  G.place(b, potion('p1', 4), 0, 0, 0);
  const more = potion('p2', 3); assert.equal(G.stack(b, more, 5), 1); assert.equal(b.items.p1.qty, 5); assert.equal(more.qty, 2);
  assert.equal(G.stack(b, potion('p3', 1), 5), 0, 'full stack takes nothing');
  assert.equal(G.stack(b, item('ring2', 1, 1), 5), 0);
  assert.ok(G.insert(b, potion('p4', 7), { stackMax: 5 })); assert.equal(b.grid.cells.length, 2);
  const sword = item('s', 1, 3); assert.ok(G.insert(b, sword)); assert.ok(G.inGrid(b, 's'));
});

test('grid: autoSort packs big to small and keeps every item; resize refuses to drop items; satchel column cap', () => {
  const b = bag(6, 4);
  G.place(b, item('r1', 1, 1), 5, 3, 0); G.place(b, item('t', 2, 3), 2, 0, 0); G.place(b, item('g', 2, 1), 0, 3, 0); G.place(b, item('r2', 1, 1), 0, 0, 0);
  const before = Object.keys(b.items).sort(); G.autoSort(b);
  assert.deepEqual(b.grid.cells.map(c => c.itemId).sort(), before);
  assert.equal(b.grid.cells[0].itemId, 't', 'largest first'); assert.deepEqual([b.grid.cells[0].x, b.grid.cells[0].y], [0, 0]);
  assert.throws(() => G.resize(b, 6, 2), /cannot shrink/);
  G.resize(b, 7, 4, { maxCols: 10 }); assert.equal(b.grid.cols, 7);
  G.resize(b, 12, 4, { maxCols: 10 }); assert.equal(b.grid.cols, 10, 'capped at maxCols');
  const empty = bag(); G.resize(empty, 8, 7); assert.equal(empty.grid.rows, 7);
});

test('grid: Chaos shrink lifts the bottom row and drops what will not fit; scramble is deterministic and keeps items', () => {
  const b = bag(2, 3);
  G.place(b, item('a', 2, 1), 0, 0, 0); G.place(b, item('b', 2, 1), 0, 1, 0); G.place(b, item('c', 2, 1), 0, 2, 0);
  const dropped = G.shrinkRow(b); assert.equal(b.grid.rows, 2); assert.deepEqual(dropped.map(i => i.id), ['c']); assert.equal(b.grid.cells.length, 2);
  const b2 = bag(2, 3); G.place(b2, item('a', 1, 1), 0, 0, 0); G.place(b2, item('c', 1, 1), 0, 2, 0);
  assert.deepEqual(G.shrinkRow(b2), []); assert.ok(G.inGrid(b2, 'c'), 'moved up instead of dropped');
  const { makeRng } = awaitRng(); const s1 = bag(4, 4), s2 = bag(4, 4);
  for (const s of [s1, s2]) { G.place(s, item('x', 1, 3), 0, 0, 0); G.place(s, item('y', 2, 2), 1, 0, 0); G.place(s, item('z', 1, 1), 3, 3, 0); }
  G.scramble(s1, makeRng(5)); G.scramble(s2, makeRng(5));
  assert.deepEqual(s1.grid.cells, s2.grid.cells); assert.equal(s1.grid.cells.length, 3);
  for (const c of s1.grid.cells) for (const k of G.cellsOf(s1.items[c.itemId], c.x, c.y, c.rot)) assert.ok(k.x < 4 && k.y < 4);
});
import { makeRng } from '../../packages/shared/rng.js';
function awaitRng() { return { makeRng }; }
