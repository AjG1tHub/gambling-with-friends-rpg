import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, mkGame, types, events } from './_helpers.mjs';

const snapshot = (state) => state.board.map(t => `${t.type}/${t.color}/${t.gameId}`).join('|');
const counts = (state) => { const c = {}; state.board.forEach(t => { c[t.type] = (c[t.type] || 0) + 1; }); return c; };

test('T1 Reshuffle only reassigns minigames', () => {
  const c = mkGame(); const before = c.state.board.map(t => [t.type, t.color]);
  E.chaosShuffle(c.config, c.state, c.rng, 1);
  assert.deepEqual(c.state.board.map(t => [t.type, t.color]), before);
});

test('T2+ keeps tile-type counts, pinned tiles and START in place', () => {
  for (const tier of [2, 3, 4, 5]) {
    const c = mkGame(['A', 'B'], tier * 7); const before = counts(c.state);
    E.chaosShuffle(c.config, c.state, c.rng, tier);
    if (tier < 5) assert.deepEqual(counts(c.state), before, `tier ${tier}`);
    assert.equal(c.state.board[7].type, 'START'); assert.equal(c.state.board[32].type, 'JAIL');
    assert.equal(types(c.state, 'JAIL').length, 2); assert.equal(types(c.state, 'SHOP').length, 2);
    for (const t of c.state.board) assert.equal(!!t.gameId, t.type === 'GAME', `tile ${t.number} game/type mismatch`);
  }
});

test('colors keep their distribution when repainted', () => {
  const c = mkGame(); E.chaosShuffle(c.config, c.state, c.rng, 2);
  const count = {}; c.state.board.forEach(t => { count[t.color] = (count[t.color] || 0) + 1; });
  assert.deepEqual(count, c.config.Board.colorWeights);
});

test('T3 clears cached shop rates so they re-roll', () => {
  const c = mkGame(); c.state.shopRates = { Gems: 7 };
  E.chaosShuffle(c.config, c.state, c.rng, 2); assert.deepEqual(c.state.shopRates, { Gems: 7 });
  E.chaosShuffle(c.config, c.state, c.rng, 3); assert.deepEqual(c.state.shopRates, {});
});

test('T4 scatters free players but never frees or strands jailed ones', () => {
  const c = mkGame(['A', 'B', 'C'], 5); const [a, b] = c.players;
  E.sendToJail(c.config, c.state, a, 'test'); a.jailTier = 3;
  for (let i = 0; i < 20; i++) {
    E.chaosShuffle(c.config, c.state, c.rng, 4);
    assert.equal(a.jailTier, 3); assert.equal(c.state.board[a.pos].type, 'JAIL', `jailed player left on a ${c.state.board[a.pos].type} tile`);
  }
  assert.ok(b.pos >= 0 && b.pos < 40);
});

test('T5 wildcard flips exactly one GOOD/BAD tile', () => {
  const c = mkGame(['A', 'B'], 3);
  const r = E.chaosShuffle(c.config, c.state, c.rng, 5);
  assert.ok(r.notes.some(n => /flipped to (GOOD|BAD)/.test(n)));
  assert.equal(types(c.state, 'GOOD').length + types(c.state, 'BAD').length, 6);
  assert.equal(Math.abs(types(c.state, 'GOOD').length - 3), 1);
});

test('a shuffle ends any move in flight and loud shuffles flash on the player view', () => {
  const c = mkGame(); c.state.move = { done: false };
  E.chaosShuffle(c.config, c.state, c.rng, 2, { loud: true });
  assert.equal(c.state.move.done, true); assert.equal(c.state.chaosFlash.tier, 2);
  E.chaosShuffle(c.config, c.state, c.rng, 2, { loud: false });
  assert.equal(c.state.chaosFlash, null);
  assert.deepEqual(events(c.state, 'CHAOS').map(e => e.loud), [true, false]);
});

test('undo restores the board, positions and shop rates exactly — once', () => {
  const c = mkGame(); c.state.shopRates = { Gems: 7 };
  const board = snapshot(c.state); const pos = c.players.map(p => p.pos);
  E.chaosShuffle(c.config, c.state, c.rng, 4);
  assert.notEqual(snapshot(c.state), board);
  E.chaosUndo(c.state);
  assert.equal(snapshot(c.state), board); assert.deepEqual(c.players.map(p => p.pos), pos); assert.deepEqual(c.state.shopRates, { Gems: 7 });
  assert.match(E.chaosUndo(c.state).text, /Nothing to undo/);
});

test('an unknown tier is reported, not thrown', () => {
  const c = mkGame(); assert.match(E.chaosShuffle(c.config, c.state, c.rng, 9).text, /No Chaos tier/);
});

test('SpecialTilesShuffle = false leaves special tiles where they are', () => {
  const c = mkGame(['A', 'B'], 4, (cfg) => { cfg.Config.SpecialTilesShuffle = false; });
  const before = c.state.board.map(t => t.type);
  E.chaosShuffle(c.config, c.state, c.rng, 2);
  assert.deepEqual(c.state.board.map(t => t.type), before);
});

test('retconTile changes type and/or color and keeps the game assignment consistent', () => {
  const c = mkGame(); const t = c.state.board.find(x => x.type === 'GOOD');
  E.retconTile(c.config, c.state, c.rng, t.idx, { type: 'GAME', color: 'Black' });
  assert.equal(t.type, 'GAME'); assert.equal(t.color, 'Black'); assert.ok(t.gameId);
  E.retconTile(c.config, c.state, c.rng, t.idx, { type: 'BAD' }); assert.equal(t.gameId, null);
  assert.match(E.retconTile(c.config, c.state, c.rng, 99, {}).text, /No such tile/);
});
