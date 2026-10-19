// Roster mirror, claims, the vault at run end, veterans, the Wall of Names and the export/import round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, gen, hooks, shared, playingRoom, charOf, give, clone } from './_fixtures-characters.mjs';
import { rosterExport, isAliveForRoster } from '../../packages/shared/handlers/roster.js';
import { B } from '../../packages/shared/balance.js';

test('roster: ROSTER_SYNC mirrors an owner\'s entries (cleaned) and only that owner or the GM may push; ROSTER_CLAIM binds a seat', () => {
  const r = room().join(names4);
  assert.match(r.try('ROSTER_CLAIM', { playerId: 'p0', ownerId: 'o1' }, 'p1').message, /cannot act/);
  r.append('ROSTER_CLAIM', { playerId: 'p0', ownerId: 'o1' }, 'p0'); assert.equal(r.state.players.p0.rosterOwnerId, 'o1');
  r.append('ROSTER_SYNC', { ownerId: 'o1', entries: [{ id: 'a', name: 'Anvil', classId: 'whale', level: '3', stats: { luck: 9 }, worn: { mainhand: { id: 'x', name: 'X' }, helmet: 'junk' }, alive: true, vault: [{ id: 'v1' }, null], pets: [] }, { bad: true }] }, 'p0');
  const e = r.state.roster.a; assert.equal(e.ownerId, 'o1'); assert.equal(e.level, 3); assert.deepEqual(e.stats, { luck: 9, nerve: 1, greed: 1, grit: 1 }); assert.equal(e.worn.helmet, null); assert.equal(e.worn.mainhand.id, 'x'); assert.deepEqual(e.vault.map(v => v.id), ['v1']); assert.equal(Object.keys(r.state.roster).length, 1);
  r.append('ROSTER_SYNC', { ownerId: 'o1', entries: [{ id: 'b', name: 'Bolt', alive: false, stats: {}, worn: {} }] }, 'p0');
  assert.ok(!r.state.roster.a && r.state.roster.b, 'a sync replaces the owner\'s set'); assert.ok(r.state.wall.includes('Bolt'));
  assert.match(r.try('ROSTER_SYNC', { ownerId: 'o1', entries: [] }, 'p1').message, /not your roster/);
  r.append('ROSTER_SYNC', { ownerId: 'o2', entries: [{ id: 'c', name: 'Cinder', stats: {}, worn: {} }] }, 'gm'); assert.ok(r.state.roster.c && r.state.roster.b, 'other owners are untouched');
  r.append('GM_REASSIGN_ROSTER', { playerId: 'p1', rosterOwnerId: 'o2' }); assert.equal(r.state.players.p1.rosterOwnerId, 'o2');
});

test('roster: at run end a survivor vaults 3, the dead vault 1, veterans are saved, and the export carries level/stats/worn/vault/pets back through a sync', () => {
  const r = playingRoom(); const st = r.state; const [pa, pb] = st.seats; const a = charOf(r, pa), b = charOf(r, pb);
  r.append('ROSTER_CLAIM', { playerId: pa, ownerId: 'oa' }, 'gm'); r.append('ROSTER_CLAIM', { playerId: pb, ownerId: 'ob' }, 'gm');
  assert.match(r.try('VAULT_BANK', { playerId: pa, itemIds: [] }, pa).message, /not in ended/);
  const ring = give(r, pa, gen.makeGear(st, 'ring', { rarity: 'epic', seed: 1 })); const neck = give(r, pa, gen.makeGear(st, 'necklace', { seed: 2 })); const torso = give(r, pa, gen.makeGear(st, 'torso', { seed: 3 })); const boots = give(r, pa, gen.makeGear(st, 'boots', { seed: 4 }));
  r.append('GRID_EQUIP', { itemId: torso.id }, pa);
  a.level = 6; a.stats.luck = 7; a.pets.push({ id: 'petZ', speciesId: 'emberfox', name: 'Ash', element: 'Oxblood', stage: 0, power: 0, maxPower: 60, attacks: [], heldItem: null, fainted: true, caughtAt: 1 }); a.activePetId = 'petZ';
  for (const h of hooks.deathHooks.onDeath) h(st, { now: r.now(), B: (g) => shared.group(st, g) }, { charId: b.id, killerId: null, cause: 'monster' });
  b.deaths = 1; assert.ok(st.wall.includes(b.name)); assert.ok(!isAliveForRoster(b)); assert.ok(isAliveForRoster(a));
  r.append('GM_END_RUN', { reason: 'test' }); assert.equal(st.phase, 'ended');
  assert.match(r.try('VAULT_BANK', { playerId: pa, itemIds: [ring.id, neck.id, torso.id, boots.id] }, pa).message, /vault 3 items/);
  r.append('VAULT_BANK', { playerId: pa, itemIds: [ring.id, torso.id] }, pa); assert.equal(a.worn.torso, null, 'a worn item can be vaulted straight off the body'); assert.ok(!a.items[ring.id]);
  r.append('VAULT_BANK', { playerId: pa, itemIds: [neck.id] }, pa); assert.match(r.try('VAULT_BANK', { playerId: pa, itemIds: [boots.id] }, pa).message, /vault 3/);
  const bRing = give(r, pb, gen.makeGear(st, 'ring', { seed: 5 })); const bRing2 = give(r, pb, gen.makeGear(st, 'ring', { seed: 6 }));
  assert.match(r.try('VAULT_BANK', { playerId: pb, itemIds: [bRing.id, bRing2.id] }, pb).message, /vault 1 item/); r.append('VAULT_BANK', { playerId: pb, itemIds: [bRing.id] }, pb);
  assert.match(r.try('VETERAN_SAVE', { playerId: pb }, pb).message, /did not survive/);
  r.append('VETERAN_SAVE', { playerId: pa }, pa); assert.ok(a.veteran);
  const ea = rosterExport(st, pa), eb = rosterExport(st, pb);
  assert.equal(ea.alive, true); assert.equal(ea.level, 6); assert.equal(ea.stats.luck, 7); assert.equal(ea.ownerId, 'oa'); assert.deepEqual(ea.vault.map(v => v.id).sort(), [ring.id, torso.id, neck.id].sort()); assert.equal(ea.worn.mainhand.id, a.worn.mainhand.id); assert.equal(ea.worn.torso, null);
  assert.equal(ea.pets[0].fainted, false); assert.equal(ea.pets[0].power, 60, 'pets rest between runs'); assert.ok(ea.veteran); assert.equal(ea.runs, 1);
  assert.equal(eb.alive, false); assert.equal(eb.level, 1); assert.equal(eb.worn.mainhand, null); assert.deepEqual(eb.vault.map(v => v.id), [bRing.id]); assert.ok(eb.diedAt);
  assert.deepEqual(st.roster[ea.id], ea, 'the mirror holds the export after VAULT_BANK / VETERAN_SAVE');
  // next night: the phone syncs the export back and the survivor returns as it left; the dead name is on the Wall
  const r2 = room({ tier: 1 }).join(['Aj', 'Nick']); r2.append('ROSTER_CLAIM', { playerId: 'p0', ownerId: 'oa' }, 'p0'); r2.append('ROSTER_CLAIM', { playerId: 'p1', ownerId: 'ob' }, 'p1');
  r2.append('ROSTER_SYNC', { ownerId: 'oa', entries: [clone(ea)] }, 'p0'); r2.append('ROSTER_SYNC', { ownerId: 'ob', entries: [clone(eb)] }, 'p1');
  r2.append('CHAR_PICK_ROSTER', { rosterEntryId: ea.id }, 'p0'); const back = charOf(r2, 'p0');
  assert.equal(back.level, 6); assert.equal(back.stats.luck, 7); assert.equal(back.worn.mainhand.id, a.worn.mainhand.id); assert.equal(back.pets[0].id, 'petZ'); assert.ok(back.locked);
  r2.append('VAULT_PULL', { itemIds: [ring.id] }, 'p0'); assert.ok(back.items[ring.id]); assert.equal(r2.state.roster[ea.id].vault.length, 2);
  assert.ok(r2.state.wall.includes(b.name)); assert.match(r2.try('CHAR_LOOK', { name: b.name }, 'p1').message, /Wall/);
  assert.match(r2.try('CHAR_PICK_ROSTER', { rosterEntryId: eb.id }, 'p1').message, /give the new character a name/);
  r2.append('CHAR_PICK_ROSTER', { rosterEntryId: eb.id, name: 'Nick Reborn' }, 'p1'); assert.equal(charOf(r2, 'p1').classId, b.classId); assert.deepEqual(charOf(r2, 'p1').look, b.look);
  // the whole thing survives a reload
  assert.deepEqual(clone(r2.state), JSON.parse(JSON.stringify(r2.state)));
});
