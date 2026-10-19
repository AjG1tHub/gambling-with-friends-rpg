import { test } from 'node:test';
import assert from 'node:assert/strict';
import { R, fixedRng } from './_helpers.mjs';

test('makeRng is deterministic per seed and differs across seeds', () => {
  const a = R.makeRng(7), b = R.makeRng(7), c = R.makeRng(8);
  const seqA = Array.from({ length: 20 }, () => a.next()), seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, () => c.next()));
});

test('next() stays in [0, 1)', () => {
  const r = R.makeRng(1);
  for (let i = 0; i < 5000; i++) { const x = r.next(); assert.ok(x >= 0 && x < 1); }
});

test('getState / setState resume the exact sequence (reload safety)', () => {
  const r = R.makeRng(99); r.next(); r.next();
  const saved = r.getState();
  const expected = [r.next(), r.next(), r.next()];
  const r2 = R.makeRng(1); r2.setState(saved);
  assert.deepEqual([r2.next(), r2.next(), r2.next()], expected);
});

test('int is inclusive on both ends', () => {
  const r = R.makeRng(3); const seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = r.int(1, 6); assert.ok(v >= 1 && v <= 6); seen.add(v); }
  assert.equal(seen.size, 6);
});

test('weightedIndex follows the weights and never picks a zero weight', () => {
  const r = R.makeRng(11); const items = [{ weight: 1 }, { weight: 0 }, { weight: 3 }];
  const hits = [0, 0, 0];
  for (let i = 0; i < 20000; i++) hits[R.weightedIndex(r, items)]++;
  assert.equal(hits[1], 0);
  assert.ok(Math.abs(hits[2] / hits[0] - 3) < 0.25, `ratio ${hits[2] / hits[0]}`);
});

test('weightedIndex falls back to uniform when every weight is zero', () => {
  const r = R.makeRng(5); const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(R.weightedIndex(r, [{ weight: 0 }, { weight: 0 }]));
  assert.equal(seen.size, 2);
});

test('weightedIndex boundaries with a scripted roll', () => {
  const items = [{ weight: 10 }, { weight: 30 }, { weight: 60 }];
  assert.equal(R.weightedIndex(fixedRng([0]), items), 0);
  assert.equal(R.weightedIndex(fixedRng([0.0999]), items), 0);
  assert.equal(R.weightedIndex(fixedRng([0.1]), items), 1);
  assert.equal(R.weightedIndex(fixedRng([0.4]), items), 2);
  assert.equal(R.weightedIndex(fixedRng([0.9999]), items), 2);
});

test('shuffle keeps every element and does not mutate the input', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8]; const copy = src.slice();
  const out = R.shuffle(R.makeRng(2), src);
  assert.deepEqual(src, copy);
  assert.deepEqual(out.slice().sort(), copy);
});
