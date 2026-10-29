// data/lever-curves.json is what the phones draw to show what a stat is worth; it must cover every game at every
// stat value and agree with levers.js about which stat governs each game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import curves from '../../data/lever-curves.json' with { type: 'json' };
import { LEVERS } from '../../packages/games/levers.js';
import { ITEM_DEFS } from '../../packages/games/items.js';
import { leverView, leverSummary, gamesForStat } from '../../packages/games/lever-view.js';
import { B } from '../../packages/shared/balance.js';

test('every game has a return at every stat value, governed by the lever\'s stat', () => {
  assert.equal(curves.neutral, B.stats.neutral); assert.equal(curves.min, B.stats.min); assert.equal(curves.max, B.stats.max);
  for (const d of ITEM_DEFS) {
    const g = curves.games[d.gameId]; assert.ok(g, `${d.gameId} is in lever-curves.json (run node tools/build-lever-curves.mjs)`);
    assert.equal(g.stat, LEVERS[d.gameId].stat, `${d.gameId} stat`);
    assert.equal(g.curve.length, B.stats.max - B.stats.min + 1, `${d.gameId} has a point per stat value`);
    g.curve.forEach((c, i) => { assert.equal(c.stat, B.stats.min + i); assert.ok(c.rtp > 0 && c.rtp < 5, `${d.gameId} rtp at ${c.stat} is sane`); assert.ok(c.win >= 0 && c.win <= 1); });
  }
});

test('leverView reads the player\'s value against neutral; a stat above neutral never reads as a loss of edge on an odds lever with a positive slope', () => {
  const v = leverView('fifty', 7);
  assert.equal(v.value, 7); assert.equal(v.neutral, B.stats.neutral); assert.ok(v.yours.rtp > v.base.rtp); assert.ok(v.deltaPts > 0);
  assert.match(leverSummary('fifty', 7), /Luck 7 · return \d+% \(base \d+%, \+\d+\)/);
  assert.equal(leverView('fifty', 99).value, B.stats.max, 'clamped to the stat range'); assert.equal(leverView('nope', 3), null);
  const luck = gamesForStat('luck', 7); assert.ok(luck.length >= 10); assert.ok(luck.every(x => x.view.stat === 'luck'));
  assert.ok(luck.every((x, i) => i === 0 || luck[i - 1].view.deltaPts >= x.view.deltaPts), 'best edge first');
});
