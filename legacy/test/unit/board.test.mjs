import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, R, DEFAULT_CONFIG, mkGame, types } from './_helpers.mjs';

test('board has 40 tiles with the configured type counts', () => {
  for (const seed of [1, 2, 3, 99]) {
    const { state, config } = mkGame(['A', 'B'], seed);
    assert.equal(state.board.length, 40);
    for (const [type, n] of Object.entries(config.Board.tileCounts)) assert.equal(types(state, type).length, n, `${type} seed ${seed}`);
  }
});

test('pinned tiles land where the config says (START top-right, JAIL bottom-left)', () => {
  for (const seed of [1, 5, 77, 1234]) {
    const { state } = mkGame(['A', 'B'], seed);
    assert.equal(state.board[7].type, 'START');
    assert.equal(state.board[32].type, 'JAIL');
  }
});

test('tile numbers are permanent 1..40 and colors match the weighted distribution', () => {
  const { state, config } = mkGame();
  assert.deepEqual(state.board.map(t => t.number), Array.from({ length: 40 }, (_, i) => i + 1));
  const count = {}; state.board.forEach(t => { count[t.color] = (count[t.color] || 0) + 1; });
  assert.deepEqual(count, config.Board.colorWeights);
});

test('every GAME tile carries a built, non-hidden game; other tiles carry none', () => {
  const { state, config } = mkGame();
  const ok = new Set(config.Games.filter(g => g.built && !g.hidden).map(g => g.id));
  for (const t of state.board) {
    if (t.type === 'GAME') assert.ok(ok.has(t.gameId), `tile ${t.number} has ${t.gameId}`);
    else assert.equal(t.gameId, null);
  }
});

test('generateBoard rejects tile counts that do not fill the grid', () => {
  const config = structuredClone(DEFAULT_CONFIG); config.Board.tileCounts.GAME = 5;
  assert.throws(() => E.generateBoard(config, R.makeRng(1)), /Tile counts/);
});

test('builtGames falls back to hidden games when nothing else is built', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.Games.forEach(g => { if (!g.hidden) g.built = false; });
  assert.deepEqual(E.builtGames(config).map(g => g.id), ['placeholder']);
});

test('grid math: xy / toIdx round-trip and wrap', () => {
  const { config } = mkGame();
  for (let i = 0; i < 40; i++) { const { x, y } = E.xy(config, i); assert.equal(E.toIdx(config, x, y), i); }
  assert.equal(E.toIdx(config, -1, 0), 7);
  assert.equal(E.toIdx(config, 8, 4), 32);
  assert.equal(E.toIdx(config, 0, -1), 32);
});

test('stepIdx reports an edge crossing only when the grid wraps', () => {
  const { config } = mkGame();
  assert.deepEqual(E.stepIdx(config, 0, 'E'), { idx: 1, wrapped: false });
  assert.deepEqual(E.stepIdx(config, 7, 'E'), { idx: 0, wrapped: true });
  assert.deepEqual(E.stepIdx(config, 0, 'W'), { idx: 7, wrapped: true });
  assert.deepEqual(E.stepIdx(config, 3, 'N'), { idx: 35, wrapped: true });
  assert.deepEqual(E.stepIdx(config, 35, 'S'), { idx: 3, wrapped: true });
  assert.deepEqual(E.stepIdx(config, 10, 'S'), { idx: 18, wrapped: false });
});

test('torusDist takes the short way around', () => {
  const { config } = mkGame();
  assert.equal(E.torusDist(config, 0, 7), 1);   // across the left/right edge
  assert.equal(E.torusDist(config, 0, 32), 1);  // across the top/bottom edge
  assert.equal(E.torusDist(config, 0, 39), 2);
  assert.equal(E.torusDist(config, 0, 20), 6);  // (4,2): 4 across + 2 down
  assert.equal(E.torusDist(config, 12, 12), 0);
});
