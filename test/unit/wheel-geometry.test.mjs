// The wheel you see is the wheel the RNG spins: every renderer draws slice angles proportional to the segment
// weights (packages/ui/wheel.js `arcs`, shared by the TV, the phone, the GM console and the Lab), and every
// `lastSpin` the engine writes carries those weights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcs, segmentAngle, equalWeights } from '../../packages/ui/wheel.js';
import wheelsData from '../../data/wheels.json' with { type: 'json' };
import { room } from './_helpers.mjs';
import { group } from '../../packages/shared/balance.js';
import { spinWheel, spinWheelSecret, segmentsFor } from '../../packages/shared/handlers/wheels.js';

test('arcs: spans are proportional to weights, sum to 360, segment 0 sits under the pointer', () => {
  const A = arcs(['a', 'b', 'c', 'd'], [10, 20, 30, 40]);
  assert.deepEqual(A.map(x => x.span), [36, 72, 108, 144]);
  assert.equal(A.reduce((s, x) => s + x.span, 0), 360);
  assert.equal(A[0].mid, 0);
  for (let i = 1; i < A.length; i++) assert.equal(A[i].a0, A[i - 1].a1);
  // zero weight → no slice; no weights → equal slices
  assert.equal(arcs(['a', 'b'], [0, 5])[0].span, 0);
  assert.deepEqual(arcs(['a', 'b', 'c']).map(x => x.span), [120, 120, 120]);
  assert.equal(segmentAngle(4, 2, [10, 20, 30, 40]), -18 + 36 + 72 + 54);   // segment 0 straddles the pointer
  assert.equal(equalWeights([2, 2, 2], 3), true); assert.equal(equalWeights([1, 2], 2), false); assert.equal(equalWeights(null, 3), true);
});

test('every wheel in wheels.json has unequal odds somewhere, so equal slices would lie', () => {
  for (const [id, segs] of Object.entries(wheelsData)) {
    if (id.startsWith('_')) continue;
    const w = segs.map(s => Number(s.weight ?? 1));
    const A = arcs(segs.map(s => s.label), w), total = w.reduce((a, b) => a + b, 0);
    segs.forEach((s, i) => assert.ok(Math.abs(A[i].span / 360 - w[i] / total) < 1e-9, `${id}:${s.id} slice share equals its weight share`));
  }
});

test('lastSpin carries the segment weights for the wheels the engine spins', () => {
  const r = room({ seed: 11 }).join(['A', 'B']);
  r.append('RUN_START');
  {
    const pid = r.state.seats[0];
    const ctx = { now: r.now() + 5000, actor: 'gm', isGm: true, payload: {}, B: (g) => group(r.state, g) };
    for (const wheel of ['fortune', 'fate', 'loot']) {
      spinWheel(r.state, ctx, wheel, pid);
      const segs = segmentsFor(r.state, wheel);
      assert.deepEqual(r.state.lastSpin.weights, segs.map(s => Number(s.weight ?? 1) || 0), `${wheel} weights ride on lastSpin`);
      assert.equal(r.state.lastSpin.outcomes.length, r.state.lastSpin.weights.length);
    }
    const secret = spinWheelSecret(r.state, ctx, 'bugreward', pid);
    assert.equal(secret.weights.length, secret.outcomes.length);
    assert.ok(secret.weights.some(w => w !== secret.weights[0]), 'the reward wheel is weighted');
  }
});
