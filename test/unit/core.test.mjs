// The shared core: RNG streams and rigging, hex math, reducer discipline, lobby and turn order, clocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, shared, replay, currentPlayerId } from './_helpers.mjs';
import * as hex from '../../packages/shared/hex.js';
import { makeRng, makeStreams, streamRng, rig, rigged, rigAwareInt, hash32 } from '../../packages/shared/rng.js';
import { remainingMs } from '../../packages/shared/clock.js';
import { listTunables, B, checkOverrides } from '../../packages/shared/balance.js';

test('rng: a seed replays; streams are independent; a rig is consumed once', () => {
  const a = makeRng(7), b = makeRng(7); for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  const s = makeStreams(99); assert.notEqual(s.map, s.loot); assert.equal(hash32('x'), hash32('x'));
  const st = { seed: 99, rng: makeStreams(99) };
  const before = st.rng.dice; const r1 = streamRng(st, 'dice').int(1, 6); assert.notEqual(st.rng.dice, before); assert.equal(st.rng.loot, makeStreams(99).loot);
  const st2 = { seed: 99, rng: makeStreams(99) }; assert.equal(streamRng(st2, 'dice').int(1, 6), r1);
  rig(st, 'dice', 6); assert.equal(rigAwareInt(st, 'dice', 1, 6), 6); assert.equal(rigged(st, 'dice'), null);
  rig(st, 'dice', 99); assert.equal(rigAwareInt(st, 'dice', 1, 6), 6, 'rig is clamped to the range');
});

test('hex: distance, neighbours, rings, lines and pathfinding around void', () => {
  const o = { q: 0, r: 0 };
  assert.equal(hex.neighbors(o).length, 6); assert.equal(hex.distance(o, { q: 3, r: -1 }), 3);
  assert.equal(hex.ring(o, 1).length, 6); assert.equal(hex.ring(o, 2).length, 12); assert.equal(hex.range(o, 2).length, 19);
  assert.equal(hex.line(o, { q: 3, r: 0 }).length, 4);
  for (let i = 0; i < 6; i++) assert.equal(hex.dirIndex(o, hex.neighbor(o, i)), i);
  const wall = new Set(['1,0', '1,-1', '0,1']);
  const p = hex.path(o, { q: 2, r: 0 }, (k) => !wall.has(k));
  assert.ok(p && p.length >= 3 && p.at(-1) === '2,0' && !p.some(k => wall.has(k)));
  assert.equal(hex.path(o, { q: 2, r: 0 }, () => false), null);
  const px = hex.toPixel({ q: 2, r: -1 }, 10); assert.deepEqual(hex.fromPixel(px.x, px.y, 10), { q: 2, r: -1 });
});

test('balance: every tunable has a unit, a spec section and a note; overrides are validated', () => {
  const rows = listTunables(); assert.ok(rows.length > 150, `only ${rows.length} tunables`);
  for (const r of rows) assert.ok(r.unit && r.spec && r.note && r.note.length > 8, r.path);
  assert.equal(B.health.maxAtLevel1, 100);
  assert.deepEqual(checkOverrides({ health: { maxAtLevel1: 120 } }), []);
  assert.ok(checkOverrides({ health: { maxAtLevel1: 'lots' } }).length === 1);
  assert.ok(checkOverrides({ nope: { x: 1 } }).length === 1);
});

test('lobby: join, full table, reconnect by device, kick, proxy and the room code', () => {
  const r = room().join(names4);
  assert.equal(r.state.code, 'ABCD'); assert.equal(Object.keys(r.state.players).length, 4); assert.deepEqual(r.state.seats, ['p0', 'p1', 'p2', 'p3']);
  r.append('PLAYER_JOIN', { playerId: 'p9', name: 'Dup', deviceId: 'd1' }, 'system');
  assert.equal(Object.keys(r.state.players).length, 4, 'a known device reconnects instead of taking a seat');
  for (let i = 4; i < 8; i++) r.append('PLAYER_JOIN', { playerId: 'p' + i, name: 'P' + i, deviceId: 'dd' + i }, 'system');
  const e = r.try('PLAYER_JOIN', { playerId: 'p8', name: 'Nine', deviceId: 'x' }, 'system'); assert.match(e.message, /full/);
  r.append('PLAYER_JOIN', { playerId: 'spec', name: 'Watcher', deviceId: 'sx', spectator: true }, 'system'); assert.equal(r.state.seats.length, 8);
  r.append('PLAYER_LEAVE', { playerId: 'p1' }, 'system'); assert.equal(r.state.players.p1.connected, false);
  r.append('GM_PROXY', { playerId: 'p1' }); assert.equal(r.state.players.p1.proxied, true);
  r.append('PLAYER_RECONNECT', { playerId: 'p1', deviceId: 'd1' }, 'p1'); assert.equal(r.state.players.p1.proxied, false); assert.equal(r.state.players.p1.connected, true);
  r.append('GM_KICK', { playerId: 'p2' }); assert.ok(!r.state.seats.includes('p2'));
  assert.match(r.try('GM_KICK', { playerId: 'p3' }, 'p0').message, /GM only/);
  assert.match(r.try('PLAYER_RENAME', { playerId: 'p3', name: 'Hacker' }, 'p0').message, /not your seat/);
});

test('turns: order is derived from turnIdx, held seats are skipped, clocks bank and time out', () => {
  const r = room().join(names4);
  r.append('RUN_START'); assert.equal(r.state.phase, 'playing'); assert.equal(r.state.seats.length, 4);
  const first = currentPlayerId(r.state); assert.ok(first);
  // With the full reducer, RUN_START gives every seat a default character (creation.js), and Nerve above neutral
  // adds shot-clock seconds (run.js). The turn clock is therefore perTurn + Nerve bonus, read from the real stats.
  const turnMs = (pid) => { const c = shared.characterOf(r.state, pid); const bonus = Math.max(0, (c?.stats?.nerve || 0) - B.stats.neutral) * B.health.nerveClockSeconds; return (B.clock.perTurnSeconds + bonus) * 1000; };
  const firstMs = turnMs(first); assert.ok(firstMs >= B.clock.perTurnSeconds * 1000);
  assert.equal(remainingMs(r.state, first, r.now()), firstMs);
  r.tick(10_000); assert.equal(remainingMs(r.state, first, r.now()), firstMs - 10_000);
  assert.match(r.try('TURN_END', {}, 'nobody').message, /cannot act/);
  r.append('TURN_END', {}, first); assert.equal(r.state.turnIdx, 1); assert.notEqual(currentPlayerId(r.state), first);
  assert.equal(r.state.clocks[first].bankMs, firstMs - 10_000, 'unused time is banked');
  // hold the next player in a challenge: they are skipped by derivation (the mover of a turn in progress is sticky)
  const second = currentPlayerId(r.state); r.state.held[second] = { since: r.now(), challengeId: 'ch1' };
  assert.notEqual(currentPlayerId(r.state), second); delete r.state.held[second];
  // timeout only at zero
  const cur = currentPlayerId(r.state); assert.match(r.try('TURN_TIMEOUT', {}, 'system').message, /not yet/);
  r.tick(remainingMs(r.state, cur, r.now()) + 1); r.append('TURN_TIMEOUT', {}, 'system'); assert.notEqual(currentPlayerId(r.state), cur);
  // four turns = one round
  for (let i = 0; i < 2; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.round, 2);
  // pause freezes the clock
  const p = currentPlayerId(r.state); const left = remainingMs(r.state, p, r.now());
  r.append('GM_PAUSE'); r.tick(30_000); assert.equal(remainingMs(r.state, p, r.now()), left); r.append('GM_RESUME'); r.tick(1000); assert.equal(remainingMs(r.state, p, r.now()), left - 1000);
});

test('reducer: a refused event leaves the state untouched; replay rebuilds the same state; restore points undo', () => {
  const r = room().join(names4); const log = [];
  const snap = JSON.stringify(r.state);
  const err = r.try('TURN_END', {}, 'p0'); assert.ok(err); assert.equal(JSON.stringify(r.state), snap);
  r.append('GM_RESTORE_POINT', { label: 'before start' }); r.append('RUN_START'); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.phase, 'playing'); r.append('GM_UNDO', {}); assert.equal(r.state.phase, 'lobby');
  // non-strict mode records the refusal instead of throwing
  const s2 = shared.applyEvent(r.state, { type: 'GM_KICK', actor: 'p0', ts: 1, payload: { playerId: 'p1' } });
  assert.equal(s2.lastError.code, 'forbidden'); assert.equal(s2.players.p1.kicked, false);
  // replay
  const events = [{ seq: 1, type: 'ROOM_CREATED', actor: 'gm', ts: 1, payload: { roomId: 'r', code: 'QQQQ', seed: 5, mode: 'pvp', tier: 2, size: 'short' } }, { seq: 2, type: 'PLAYER_JOIN', actor: 'system', ts: 2, payload: { playerId: 'a', name: 'A', deviceId: 'da' } }, { seq: 3, type: 'PLAYER_JOIN', actor: 'system', ts: 3, payload: { playerId: 'b', name: 'B', deviceId: 'db' } }, { seq: 4, type: 'RUN_START', actor: 'gm', ts: 4, payload: {} }];
  const a = replay(events, { strict: true }), b = replay(events.slice().reverse(), { strict: true });
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.equal(a.mode, 'pvp'); assert.equal(a.phase, 'playing');
});
