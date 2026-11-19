// A phone that reloads starts from the TV's snapshot (JSON) plus the events after it; it must end up exactly where a
// phone that never reloaded is. It did not (19 Nov): JSON split a worn weapon from its copy in c.items (charges
// drifted), wrote a monster's endless charges as null, and dropped visited regions kept as properties of an array.
// This replays whole bot games twice, once straight and once through a snapshot every 25 events, and compares.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../packages/shared/index.js';
import { pack, unpack } from '../../packages/shared/snapshot.js';
import { applyEvent } from '../../packages/shared/index.js';
import { makeEvent } from '../../packages/shared/events.js';
import { makeRng } from '../../packages/shared/rng.js';
import { currentPlayerId } from '../../packages/shared/state.js';
import { nextAction, tableDuties } from '../../packages/shared/bot.js';
const strip = (s) => JSON.stringify(s, (k, v) => ['lastError','reequipped','rested','bought','duelled','fled','looted','pact','potion','potionsBought'].includes(k) || k.startsWith('__') ? undefined : v);
function diff(a, b, path = '') { if (typeof a !== typeof b || (a === null) !== (b === null)) return path; if (typeof a !== 'object' || a === null) return a === b ? null : path; const ks = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of ks) { const d = diff(a[k], b[k], path + '.' + k); if (d) return d; } return null; }
test('a client restored from a snapshot every 25 events stays identical to one that never reloaded', () => {
for (const [seed, mode] of [[1, 'ffa'], [4, 'royale'], [5, 'teams'], [3, 'pvp']]) {
  let now = 1_700_000_000_000, seq = 0; const rng = makeRng(seed * 31 + 5); let A, B, div = null, lastType = null;
  const apply = (type, payload, actor) => { const ev = { ...makeEvent(type, payload, { actor, ts: now }), id: 'e' + (seq + 1), seq: ++seq }; now += 4000;
    A = applyEvent(A || {}, ev, { clone: false, strict: false }); B = applyEvent(B || {}, JSON.parse(JSON.stringify(ev)), { clone: false, strict: false });
    if (seq % 25 === 0) B = unpack(JSON.parse(JSON.stringify(pack(B))));
    if (!div && seq % 5 === 0 && strip(A) !== strip(B)) { div = { seq, type, at: diff(JSON.parse(strip(A)), JSON.parse(strip(B))) }; }
    const e = A.lastError; return e && e.type === type && e.ts === now - 4000 ? e : null; };
  apply('ROOM_CREATED', { roomId: 's', code: 'SNAP', seed, mode, tier: 1, size: 'regular', gmPinHash: 'x' }, 'gm');
  const ids = []; for (let i = 0; i < 4; i++) { ids.push('bot' + i); apply('PLAYER_JOIN', { playerId: 'bot' + i, name: 'Bot ' + i, deviceId: 'd' + i }, 'system'); }
  if (mode === 'teams') apply('GM_SET_TEAMS', { teams: { t0: { name: 'A', members: ['bot0', 'bot2'] }, t1: { name: 'B', members: ['bot1', 'bot3'] } } }, 'gm');
  apply('CREATION_OPEN', {}, 'gm'); let last = 0;
  for (let g = 0; g < 8000 && A.phase !== 'ended' && !div; g++) { let acted = false;
    if (A.phase === 'creation' || A.phase === 'lobby') { for (const id of ids) { const a = nextAction(A, id, rng, now, {}); if (a && !apply(a.type, a.payload, a.actor)) acted = true; } if (!acted) { apply('RUN_START', {}, 'gm'); acted = true; } }
    else { for (const a of tableDuties(A, rng, now)) if (!apply(a.type, a.payload, a.actor)) acted = true;
      for (const id of [currentPlayerId(A), ...ids.filter(i => i !== currentPlayerId(A))].filter(Boolean)) { const a = nextAction(A, id, rng, now, {}); if (!a) continue; if (!apply(a.type, a.payload, a.actor)) acted = true; if (a.type === 'TURN_END') break; } }
    if (acted) last = g; else if (g - last > 40) { apply('TURN_END', {}, 'gm'); last = g; } }
  assert.equal(div, null, `seed ${seed} ${mode}: diverged at seq ${div?.seq} after ${div?.type} at ${div?.at}`); assert.ok(A.turnIdx > 20, 'the game ran');
}
});

test('pack / unpack: shared objects stay shared, Infinity survives, an old snapshot gets its worn items relinked', () => {
  const it = { id: 'i1', charges: 3 }; const s = { characters: { c1: { items: { i1: it }, worn: { mainhand: it, offhand: null }, visitedRegions: {} } }, monsters: { m: { items: [{ id: 'x', charges: Infinity }] } } };
  const back = unpack(JSON.parse(JSON.stringify(pack(s))));
  assert.equal(back.characters.c1.worn.mainhand, back.characters.c1.items.i1); assert.equal(back.monsters.m.items[0].charges, Infinity); assert.ok(!('__aliases' in back) && !('__nonfinite' in back));
  assert.ok(!('__aliases' in s), 'pack does not write on the live state');
  const old = unpack(JSON.parse(JSON.stringify(s))); assert.equal(old.characters.c1.worn.mainhand, old.characters.c1.items.i1); assert.equal(old.monsters.m.items[0].charges, Infinity);
});

// The same through the real room session and a backend that stores JSON: phones that open mid-game start from the
// TV's snapshot and must agree with the TV at the end.
test('phones that join mid-game from the TV\'s snapshot agree with the TV at the end of the night', async () => {
  const { createLocalBackend } = await import('../../packages/shared/backend/local.js');
  const { openRoom, createRoom } = await import('../../packages/shared/room.js');
  const be = createLocalBackend({ namespace: 'snap-' + Math.random() });
  const tv = await createRoom(be, { code: 'SNPB', seed: 6, mode: 'ffa', tier: 1, size: 'regular', gmPinHash: 'h', role: 'tv', snapshotEvery: 25 });
  const rng = makeRng(77); const ids = []; const late = []; let n = 0, last = 0;
  const send = async (type, payload, actor) => { n++; await tv.dispatch(type, payload, actor); const e = tv.state.lastError; if (n % 150 === 0 && late.length < 4) late.push(await openRoom(be, { code: 'SNPB', role: 'phone' })); return e && e.type === type ? e : null; };
  for (let i = 0; i < 4; i++) { ids.push('bot' + i); await send('PLAYER_JOIN', { playerId: 'bot' + i, name: 'Bot ' + i, deviceId: 'd' + i }, 'system'); }
  await send('CREATION_OPEN', {}, 'gm');
  for (let g = 0; g < 4000 && tv.state.phase !== 'ended' && n < 700; g++) { let acted = false; const A = tv.state, now = Date.now();
    if (A.phase === 'creation' || A.phase === 'lobby') { for (const id of ids) { const a = nextAction(tv.state, id, rng, now, {}); if (a && !(await send(a.type, a.payload, a.actor))) acted = true; } if (!acted) { await send('RUN_START', {}, 'gm'); acted = true; } }
    else { for (const a of tableDuties(tv.state, rng, now)) if (!(await send(a.type, a.payload, a.actor))) acted = true;
      for (const id of [currentPlayerId(tv.state), ...ids.filter(i => i !== currentPlayerId(tv.state))].filter(Boolean)) { const a = nextAction(tv.state, id, rng, now, {}); if (!a) continue; if (!(await send(a.type, a.payload, a.actor))) acted = true; if (a.type === 'TURN_END') break; } }
    if (acted) last = g; else if (g - last > 40) { await send('TURN_END', {}, 'gm'); last = g; } }
  await new Promise(r => setTimeout(r, 20));
  assert.ok(late.length >= 3 && tv.state.turnIdx > 20, `the game ran (${n} events, ${late.length} late phones)`);
  for (const [i, ph] of late.entries()) { assert.equal(ph.lastSeq, tv.lastSeq); const d = diff(JSON.parse(strip(tv.state)), JSON.parse(strip(ph.state))); assert.equal(d, null, `late phone ${i} differs at ${d}`); }
  [tv, ...late].forEach(s => s.close());
});
