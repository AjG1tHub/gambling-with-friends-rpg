// DECISIONS.md item 4: the eight legacy game files under packages/games/legacy/ are byte-identical copies of
// legacy/site/js/. Only the state.js shim is new. If this fails, someone edited a copy — edit nothing there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
export const COPIED = ['games.js', 'games-extra.js', 'games-quick.js', 'games-show.js', 'games-table.js', 'xkit.js', 'poker.js', 'rng.js'];

for (const f of COPIED) {
  test(`packages/games/legacy/${f} is byte-identical to legacy/site/js/${f}`, () => {
    const a = readFileSync(join(root, 'packages', 'games', 'legacy', f));
    const b = readFileSync(join(root, 'legacy', 'site', 'js', f));
    assert.ok(a.equals(b), `${f} differs from the legacy original`);
  });
}
test('the legacy folder holds exactly the eight copies plus the state.js shim', () => {
  const files = readdirSync(join(root, 'packages', 'games', 'legacy')).sort();
  assert.deepEqual(files, [...COPIED, 'state.js'].sort());
});
test('the state.js shim moves balances in memory and never needs a browser', async () => {
  const S = await import('../../packages/games/legacy/state.js');
  const state = { ledger: [] }, p = { id: 'p', balances: { Health: 10 } };
  S.credit(state, p, 'Health', -4, 'test'); assert.equal(p.balances.Health, 6);
  S.credit(state, p, 'Chips', -4, 'floor'); assert.equal(p.balances.Chips, 0);
  assert.equal(state.ledger.length, 2); assert.equal(state.ledger[1].asked, -4);
  assert.equal(S.log({}, 'X', null), null, 'no ledger, no row');
  assert.equal(typeof globalThis.localStorage, 'undefined');
});
