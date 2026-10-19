import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, mkGame, events } from './_helpers.mjs';
const TN = await import('../../site/js/turns.js');

const names = (c) => c.state.turnOrder.map(id => c.players.find(p => p.id === id).name);
const up = (c) => S.currentPlayer(c.state).name;
const table = () => mkGame(['A', 'B', 'C', 'D']);

test('moving a seat swaps neighbours and keeps the same player up', () => {
  const c = table(); E.endTurn(c.state, c.config);                      // B is up
  TN.moveInOrder(c.state, c.players[3].id, -1); assert.deepEqual(names(c), ['A', 'B', 'D', 'C']); assert.equal(up(c), 'B');
  TN.moveInOrder(c.state, c.players[1].id, -1); assert.deepEqual(names(c), ['B', 'A', 'D', 'C']); assert.equal(up(c), 'B');   // the current player moved: still up
  TN.moveInOrder(c.state, c.players[1].id, 1); TN.moveInOrder(c.state, c.players[1].id, 1); assert.deepEqual(names(c), ['A', 'D', 'B', 'C']); assert.equal(up(c), 'B');
});

test('you cannot move past either end, or move someone who is not in the order', () => {
  const c = table();
  assert.equal(TN.moveInOrder(c.state, c.players[0].id, -1).error, true); assert.equal(TN.moveInOrder(c.state, c.players[3].id, 1).error, true);
  assert.equal(TN.moveInOrder(c.state, 'ghost', 1).error, true); assert.deepEqual(names(c), ['A', 'B', 'C', 'D']);
});

test('benching someone who is not up changes nothing for the current player', () => {
  const c = table(); E.endTurn(c.state, c.config); E.endTurn(c.state, c.config);            // C is up
  const r = TN.benchPlayer(c.state, c.players[0].id);
  assert.equal(r.wasUp, false); assert.deepEqual(names(c), ['B', 'C', 'D']); assert.equal(up(c), 'C'); assert.equal(c.players[0].benched, true);
  assert.equal(c.players[0].balances.Gold, 500);                                            // they keep everything
});

test('benching the player who is up passes the turn to the next seat and ends their move', () => {
  const c = table(); E.endTurn(c.state, c.config); c.state.move = { done: false };          // B is up, mid-move
  const r = TN.benchPlayer(c.state, c.players[1].id);
  assert.equal(r.wasUp, true); assert.equal(up(c), 'C'); assert.equal(c.state.move, null); assert.match(r.text, /C is up/);
});

test('benching the last seat while it is up wraps to the first seat', () => {
  const c = table(); for (let i = 0; i < 3; i++) E.endTurn(c.state, c.config);              // D is up
  TN.benchPlayer(c.state, c.players[3].id); assert.equal(up(c), 'A'); assert.deepEqual(names(c), ['A', 'B', 'C']);
});

test('the table never benches its last player, and nobody is benched twice', () => {
  const c = mkGame(['A', 'B']); TN.benchPlayer(c.state, c.p.id);
  assert.equal(TN.benchPlayer(c.state, c.q.id).error, true); assert.equal(TN.benchPlayer(c.state, c.p.id).error, true);
  assert.equal(TN.benchPlayer(c.state, 'ghost').error, true);
});

test('a returning player joins at the end without disturbing whose turn it is', () => {
  const c = table(); E.endTurn(c.state, c.config);                                           // B up
  TN.benchPlayer(c.state, c.players[0].id); TN.returnPlayer(c.state, c.players[0].id);
  assert.deepEqual(names(c), ['B', 'C', 'D', 'A']); assert.equal(up(c), 'B'); assert.equal(c.players[0].benched, false);
  assert.equal(TN.returnPlayer(c.state, c.players[0].id).error, true);
  assert.deepEqual(TN.benched(c.state), []);
});

test('turns keep flowing correctly after edits: everyone still in the order gets a turn each round', () => {
  const c = table(); E.endTurn(c.state, c.config); TN.benchPlayer(c.state, c.players[2].id); TN.moveInOrder(c.state, c.players[3].id, -1);
  const seen = []; for (let i = 0; i < 6; i++) { seen.push(up(c)); E.endTurn(c.state, c.config); }
  const order = names(c); assert.equal(order.length, 3);
  for (const n of order) assert.equal(seen.filter(x => x === n).length, 2, `${n} got ${seen.filter(x => x === n).length} turns in two rounds`);
  assert.ok(!seen.includes('C'));
});

test('bench / return / reorder are ledgered', () => {
  const c = table(); TN.benchPlayer(c.state, c.players[1].id); TN.returnPlayer(c.state, c.players[1].id); TN.moveInOrder(c.state, c.players[0].id, 1);
  assert.equal(events(c.state, 'PLAYER_BENCH').length, 1); assert.equal(events(c.state, 'PLAYER_RETURN').length, 1); assert.equal(events(c.state, 'TURN_ORDER').length, 1);
});

test('shot clock: off by default, counts down from the turn start, and reports TIME! when it runs out', () => {
  const c = table(); assert.equal(TN.turnTimeLeft(c.state, 5000), null);
  c.state.turnTimerSec = 60; c.state.turnStartedTs = 10000;
  assert.equal(TN.turnTimeLeft(c.state, 10000), 60); assert.equal(TN.turnTimeLeft(c.state, 25400), 45); assert.equal(TN.turnTimeLeft(c.state, 80000), -10);
  assert.deepEqual(TN.timerView(c.state, 25000), { left: 45, limit: 60, over: false, pct: 75, text: '0:45' });
  assert.deepEqual(TN.timerView(c.state, 100000).text, 'TIME!'); assert.equal(TN.timerView(c.state, 100000).pct, 0);
  c.state.turnTimerSec = 180; assert.equal(TN.timerView(c.state, 10000).text, '3:00');
});

test('the clock restarts when the turn passes and is idle outside a session', () => {
  const c = table(); c.state.turnTimerSec = 30; c.state.turnStartedTs = 1;
  E.endTurn(c.state, c.config); assert.ok(c.state.turnStartedTs > 1); assert.ok(TN.turnTimeLeft(c.state) <= 30 && TN.turnTimeLeft(c.state) >= 29);
  c.state.phase = 'ended'; assert.equal(TN.turnTimeLeft(c.state), null);
  TN.restartTurnClock(c.state, 777); assert.equal(c.state.turnStartedTs, 777);
});
