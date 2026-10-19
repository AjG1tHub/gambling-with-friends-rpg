import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, G, mkGame } from './_helpers.mjs';
const SN = await import('../../site/js/snapshots.js');

const clock = () => { let t = 1000; const now = () => t; now.tick = (ms) => { t += ms; }; return now; };

test('the stack restores the most recent snapshot first', () => {
  const now = clock(); const u = new SN.UndoStack({ now });
  u.push('{"a":1}'); now.tick(1000); u.push('{"a":2}'); now.tick(1000); u.push('{"a":3}');
  assert.equal(u.size, 3); assert.equal(u.pop().json, '{"a":3}'); assert.equal(u.pop().json, '{"a":2}'); assert.equal(u.pop().json, '{"a":1}'); assert.equal(u.pop(), null);
});

test('saves from the same click are folded into one undo step', () => {
  const now = clock(); const u = new SN.UndoStack({ now, mergeMs: 250 });
  assert.equal(u.push('{"a":1}'), true); now.tick(40); assert.equal(u.push('{"a":1.5}'), false); now.tick(40); assert.equal(u.push('{"a":1.7}'), false);
  assert.equal(u.size, 1); assert.equal(u.peek().json, '{"a":1}');                 // the restore point is the state BEFORE the click
  now.tick(600); assert.equal(u.push('{"a":2}'), true); assert.equal(u.size, 2);
});

test('an unchanged state is not pushed twice, junk is ignored, and the stack is capped', () => {
  const now = clock(); const u = new SN.UndoStack({ now, max: 5 });
  u.push('{"a":1}'); now.tick(1000); assert.equal(u.push('{"a":1}'), false);
  assert.equal(u.push(''), false); assert.equal(u.push(null), false); assert.equal(u.push({ a: 1 }), false);
  for (let i = 2; i < 20; i++) { now.tick(1000); u.push(`{"a":${i}}`); }
  assert.equal(u.size, 5); assert.equal(u.peek().json, '{"a":19}'); assert.equal(u.items[0].json, '{"a":15}');
});

test('after an undo the next push is never swallowed by the merge window', () => {
  const now = clock(); const u = new SN.UndoStack({ now });
  u.push('{"a":1}'); now.tick(1000); u.push('{"a":2}'); u.pop();
  assert.equal(u.push('{"a":9}'), true);
  u.clear(); assert.equal(u.size, 0);
});

test('undoing a real action restores balances, the game, and the dice sequence exactly', () => {
  const c = mkGame(); const before = JSON.stringify({ ...c.state, rngState: c.rng.getState() });
  const rngBefore = c.rng.getState();
  G.startGame(c.config, c.state, c.rng, 'fifty', c.p, [{ amount: 100, cur: 'Gold' }]); G.gameAction(c.config, c.state, c.rng, 'spin', {});
  const outcome = c.state.game.pending.label; G.settle(c.config, c.state, c.p, c.state.game.pending.mult);
  assert.notEqual(c.p.balances.Gold, 500);
  const restored = JSON.parse(before); c.rng.setState(restored.rngState);
  assert.equal(restored.players[0].balances.Gold, 500); assert.equal(restored.game, undefined); assert.equal(c.rng.getState(), rngBefore);
  // replaying the same click after an undo gives the same result (the dice rewind too)
  G.startGame(c.config, restored, c.rng, 'fifty', restored.players[0], [{ amount: 100, cur: 'Gold' }]); G.gameAction(c.config, restored, c.rng, 'spin', {});
  assert.equal(restored.game.pending.label, outcome);
});

test('undoLabel names what would be undone', () => {
  const c = mkGame(); const snap = JSON.stringify(c.state);
  E.sendToJail(c.config, c.state, c.p, 't'); assert.equal(SN.undoLabel(c.state, snap), 'JAIL_IN (Aj)');
  const snap2 = JSON.stringify(c.state); S.credit(c.state, c.q, 'Gold', 50, 'x'); assert.equal(SN.undoLabel(c.state, snap2), 'CREDIT (Nick)');
  assert.equal(SN.undoLabel(c.state, JSON.stringify(c.state)), 'last change'); assert.equal(SN.undoLabel(c.state, 'not json'), 'last change');
});

test('a session file round-trips the whole table', () => {
  const c = mkGame(); c.p.balances.Gold = 1234; c.state.round = 7; E.sendToJail(c.config, c.state, c.q, 't');
  const file = SN.exportSession(c.state, { configSource: 'sheets', now: 42 });
  const r = SN.parseSessionFile(file);
  assert.equal(r.error, undefined); assert.equal(r.exportedAt, 42); assert.match(r.text, /3 players, round 7/);
  assert.deepEqual(r.state, JSON.parse(JSON.stringify(c.state)));
});

test('a bare state object (older export) is accepted too', () => {
  const c = mkGame(); assert.equal(SN.parseSessionFile(JSON.stringify(c.state)).error, undefined);
});

test('wrong or damaged files are refused with a reason', () => {
  const c = mkGame(); const good = JSON.parse(SN.exportSession(c.state));
  assert.match(SN.parseSessionFile('{{{').text, /not valid JSON/);
  assert.match(SN.parseSessionFile(JSON.stringify({ kind: 'history', sessions: [] })).text, /not a Gambling With Friends session/);
  assert.match(SN.parseSessionFile('[]').text, /not a Gambling With Friends session/);
  const noBoard = structuredClone(good); delete noBoard.state.board; assert.match(SN.parseSessionFile(JSON.stringify(noBoard)).text, /no board/);
  const badPlayer = structuredClone(good); badPlayer.state.players[0] = { name: 'x' }; assert.match(SN.parseSessionFile(JSON.stringify(badPlayer)).text, /malformed/);
  const ghost = structuredClone(good); ghost.state.turnOrder.push('ghost'); assert.match(SN.parseSessionFile(JSON.stringify(ghost)).text, /missing player/);
});
