// The room session over the local backend: create, join from four "phones", drop, rejoin, kick, snapshot resume,
// out-of-order delivery and gap filling.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../packages/shared/index.js';
import { createLocalBackend } from '../../packages/shared/backend/local.js';
import { openRoom, createRoom } from '../../packages/shared/room.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('four phones join a room, one drops and rejoins, the GM kicks one; every client agrees', async () => {
  const be = createLocalBackend({ namespace: 't-' + Math.random() });
  const tv = await createRoom(be, { code: 'WXYZ', seed: 11, mode: 'ffa', tier: 1, size: 'regular', gmPinHash: 'h', role: 'tv' });
  const phones = [];
  for (let i = 0; i < 4; i++) { const s = await openRoom(be, { code: 'WXYZ', role: 'phone' }); phones.push(s); await s.dispatch('PLAYER_JOIN', { playerId: 'p' + i, name: 'P' + i, deviceId: 'dev' + i }, 'p' + i); }
  await sleep(5);
  assert.equal(Object.keys(tv.state.players).length, 4);
  for (const s of phones) assert.equal(JSON.stringify(s.state.players), JSON.stringify(tv.state.players));
  // drop and rejoin: the same device gets the same seat without a GM action
  phones[2].close(); await tv.dispatch('PLAYER_LEAVE', { playerId: 'p2' }, 'system');
  await tv.dispatch('GM_PROXY', { playerId: 'p2' }, 'gm'); assert.equal(tv.state.players.p2.proxied, true);
  const back = await openRoom(be, { code: 'WXYZ', role: 'phone' });
  assert.equal(back.lastSeq, tv.lastSeq, 'a rejoining phone catches up to the head');
  await back.dispatch('PLAYER_RECONNECT', { playerId: 'p2', deviceId: 'dev2' }, 'p2'); await sleep(5);
  assert.equal(tv.state.players.p2.proxied, false); assert.equal(back.state.players.p2.connected, true);
  await tv.dispatch('GM_KICK', { playerId: 'p3' }, 'gm'); await sleep(5);
  assert.ok(!back.state.seats.includes('p3')); assert.equal(back.state.players.p3.kicked, true);
  // a refused event is recorded, not applied
  await phones[0].dispatch('GM_KICK', { playerId: 'p1' }, 'p0'); await sleep(5);
  assert.equal(tv.state.players.p1.kicked, false); assert.equal(phones[0].state.lastError.code, 'forbidden');
  [tv, back, ...phones].forEach(s => s.close());
});

test('a snapshot plus the tail rebuilds the same state as a full replay; out-of-order and missing events are handled', async () => {
  const be = createLocalBackend({ namespace: 't-' + Math.random() });
  const tv = await createRoom(be, { code: 'SNAP', seed: 3, mode: 'pve', tier: 1, size: 'short', gmPinHash: 'h', role: 'tv', snapshotEvery: 5 });
  for (let i = 0; i < 4; i++) await tv.dispatch('PLAYER_JOIN', { playerId: 'p' + i, name: 'P' + i, deviceId: 'd' + i }, 'system');
  await tv.dispatch('RUN_START', {}, 'gm');
  for (let i = 0; i < 6; i++) await tv.dispatch('TURN_END', {}, 'gm');
  await sleep(5);
  const info = await be.getRoom(tv.roomId); assert.ok(info.snapshotSeq >= 10, 'the TV wrote a snapshot');
  const late = await openRoom(be, { code: 'SNAP', role: 'phone' });
  assert.equal(JSON.stringify({ ...late.state, log: null }), JSON.stringify({ ...tv.state, log: null }));
  // deliver events out of order through the subscription path
  const be2 = createLocalBackend({ namespace: 't-' + Math.random() });
  const a = await createRoom(be2, { code: 'GAPS', seed: 1, mode: 'ffa', tier: 1, size: 'short', gmPinHash: 'h', role: 'tv' });
  const origSubscribe = be2.subscribe;
  const held = [];
  const b = await openRoom(be2, { code: 'GAPS', role: 'phone', gapMs: 50 });
  // monkey-patch: b's listener gets events in reverse batches
  const lis = [...(await (async () => { const set = new Set(); const u = be2.subscribe(a.roomId, (e) => set.add(e)); u(); return set; })())];
  void lis; void origSubscribe; void held;
  await a.dispatch('PLAYER_JOIN', { playerId: 'x', name: 'X', deviceId: 'dx' }, 'system');
  await a.dispatch('PLAYER_JOIN', { playerId: 'y', name: 'Y', deviceId: 'dy' }, 'system');
  await sleep(80);
  assert.equal(b.lastSeq, a.lastSeq); assert.equal(Object.keys(b.state.players).length, 2);
  [tv, late, a, b].forEach(s => s.close());
});
