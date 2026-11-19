// Hostile phones (tools/fuzz.mjs): garbage and near-miss events from every seat must be refused, never crash a
// handler, never poison the state. Found on 19 Nov: a payload naming 'constructor' wrote a function into the room
// (structuredClone then failed on every later event), and PET_TEAM / VAULT_BANK spread a non-list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzGame } from '../../tools/fuzz.mjs';
import { room, names4 } from './_helpers.mjs';
import { poisoned } from '../../packages/shared/reducer.js';

test('four fuzzed games: no handler crashes, no NaN, the state still serialises', () => {
  for (const [seed, mode] of [[115, 'ffa'], [101, 'pve'], [117, 'pvp'], [7, 'teams']]) {
    const r = fuzzGame({ seed, mode, per: 1500, ramp: seed === 7 });
    assert.deepEqual(r.crashes, [], `seed ${seed} ${mode}`); assert.deepEqual(r.bad, [], `seed ${seed} ${mode}`); assert.ok(r.hostile > 200);
  }
});

test('a phone cannot name Object\'s own properties as ids, and a non-list ...Ids is an empty list', () => {
  assert.ok(poisoned({ toId: 'constructor' })); assert.ok(poisoned({ give: { itemIds: ['__proto__'] } })); assert.ok(poisoned({ teams: { toString: 1 } }));
  assert.ok(!poisoned({ toId: 'p1', text: 'a constructor of things', n: 3, list: ['a'] }));
  const r = room().join(names4);
  assert.equal(r.try('PLAYER_READY', { playerId: 'constructor' }, 'p0')?.code, 'bad-id');
  r.append('CREATION_OPEN', {}, 'gm');
  const e = r.try('PET_TEAM', { petIds: 99999 }, 'p0'); assert.ok(!e || e.code !== undefined, 'refused or accepted, not thrown raw'); assert.ok(!(e instanceof TypeError));
  structuredClone(r.state);
});
