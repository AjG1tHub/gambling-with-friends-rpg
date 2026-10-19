// Creation: look and unique names, class, the chip gamble, blood, lock-in and the starter kit, the creation
// clock, the mirror, roster picks, vault pulls, pet teams, and the bot-style run through every class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, shared, gen, chars, creationRoom, charOf, clone, CLASS_IDS } from './_fixtures-characters.mjs';
import { creationStatus, creationDeadline, safeAllocation, nameTaken } from '../../packages/shared/handlers/creation.js';
import { B } from '../../packages/shared/balance.js';

test('creation: CHAR_LOOK makes the character, names are unique against the table, the roster and the Wall; CHAR_CLASS moves the bonus', () => {
  const r = room().join(names4); r.append('CREATION_OPEN');
  assert.equal(r.state.phase, 'creation'); assert.equal(creationDeadline(r.state), r.now() + B.creation.clockSeconds * 1000);
  r.append('CHAR_LOOK', { name: 'Grim', crest: '🦊', look: { body: 1, hair: 4 } }, 'p0');
  const c = charOf(r, 'p0'); assert.equal(c.name, 'Grim'); assert.equal(c.crest, '🦊'); assert.equal(c.look.hair, 4); assert.equal(r.state.players.p0.characterId, c.id);
  assert.match(r.try('CHAR_LOOK', { name: 'grim' }, 'p1').message, /already on/);
  r.state.wall.push('Old Bones'); assert.match(r.try('CHAR_LOOK', { name: 'old bones' }, 'p1').message, /Wall/);
  r.state.roster.rx = { id: 'rx', ownerId: 'o9', name: 'Vinny Two', alive: true, vault: [], pets: [] }; assert.match(r.try('CHAR_LOOK', { name: 'Vinny Two' }, 'p1').message, /roster/);
  assert.match(r.try('CHAR_LOOK', { name: '' }, 'p1').message, /name is required/);
  assert.match(r.try('CHAR_LOOK', { name: 'Hax', playerId: 'p0' }, 'p1').message, /cannot act/);
  r.append('CHAR_LOOK', { name: 'Grimmer', look: { face: 7 } }, 'p0'); assert.equal(c.name, 'Grimmer'); assert.equal(c.look.hair, 4, 'look merges');
  assert.equal(nameTaken(r.state, 'Grimmer', c.id), false, 'a character may keep its own name');
  r.append('CHAR_CLASS', { classId: 'croupier' }, 'p0'); assert.equal(c.stats.nerve, 4);
  r.append('CHAR_CLASS', { classId: 'enforcer' }, 'p0'); assert.deepEqual(c.stats, { luck: 3, nerve: 3, greed: 3, grit: 4 });
  assert.match(r.try('CHAR_CLASS', { classId: 'wizard' }, 'p0').message, /no such class/);
  assert.match(r.try('CHAR_CLASS', { classId: 'whale' }, 'p1').message, /make a character/);
  const status = creationStatus(r.state, r.now()); assert.equal(status.players.length, 4); assert.equal(status.players[0].classId, 'enforcer'); assert.equal(status.players[1].hasCharacter, false); assert.equal(status.remainingMs, B.creation.clockSeconds * 1000);
});

test('creation: the chip gamble pays chips × mult into the stat (Greed raises it), a push returns the stake, a loss burns it; caps and refusals', () => {
  const r = room().join(names4); r.append('CREATION_OPEN');
  r.append('CHAR_LOOK', { name: 'Lucky' }, 'p0'); r.append('CHAR_CLASS', { classId: 'cutpurse' }, 'p0'); const c = charOf(r, 'p0');
  assert.equal(c.chips, B.creation.chips);
  r.append('CHAR_STAT_GAMBLE', { stat: 'nerve', chips: 2, mult: 2, gameId: 'fifty' }, 'p0'); assert.equal(c.stats.nerve, 3 + 4); assert.equal(c.chips, 8);
  r.append('CHAR_STAT_GAMBLE', { stat: 'grit', chips: 1, mult: 0, gameId: 'dice' }, 'p0'); assert.equal(c.stats.grit, 3); assert.equal(c.chips, 7);
  r.append('CHAR_STAT_GAMBLE', { stat: 'grit', chips: 3, mult: 1, gameId: 'hilo' }, 'p0'); assert.equal(c.chips, 7, 'a push gives the chips back');
  r.append('CHAR_STAT_GAMBLE', { stat: 'grit', chips: 2, mult: 0.5, gameId: 'buyin' }, 'p0'); assert.equal(c.chips, 6, 'a half return');
  // Greed above neutral raises payouts: greed 5 → +10%
  c.stats.greed = 5; r.append('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 2, mult: 1.5, gameId: 'fifty' }, 'p0');
  assert.equal(c.stats.luck, 4 + Math.round(2 * 1.5 * (1 + B.creation.greedPayoutPerPoint * 2)));
  // the creation cap holds
  r.append('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 1, mult: 10, gameId: 'fifty' }, 'p0'); assert.equal(c.stats.luck, B.stats.creationCap);
  assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 1, mult: 2, gameId: 'fifty' }, 'p0').message, /creation cap/);
  assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'grit', chips: 6, mult: 2, gameId: 'fifty' }, 'p0').message, /stake 1 to 5/);
  assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'grit', chips: 1, mult: 2, gameId: 'crash' }, 'p0').message, /not a creation game/);
  assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'swag', chips: 1, mult: 2, gameId: 'fifty' }, 'p0').message, /no such stat/);
  c.chips = 0; assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'grit', chips: 1, mult: 2, gameId: 'fifty' }, 'p0').message, /not enough chips/);
  assert.equal(c.creation.gambles.length, 6); assert.ok(r.state.ledger.some(row => row.kind === 'chips'), 'chips move through the ledger');
});

test('creation: blood once, lock-in with an allocation, the safe allocation, the starter kit and the card', () => {
  const r = room().join(names4); r.append('CREATION_OPEN');
  r.append('CHAR_LOOK', { name: 'Pale' }, 'p0'); r.append('CHAR_CLASS', { classId: 'pitboss' }, 'p0'); const c = charOf(r, 'p0');
  assert.match(r.try('CHAR_BLOOD', { chips: 4 }, 'p0').message, /1 to 3/);
  r.append('CHAR_BLOOD', { chips: 2 }, 'p0'); assert.equal(c.maxHealth, B.health.maxAtLevel1 - 2 * B.creation.bloodHealthPerChip); assert.equal(c.chips, 12);
  assert.match(r.try('CHAR_BLOOD', { chips: 1 }, 'p0').message, /once/);
  assert.match(r.try('CHAR_LOCK', { alloc: { luck: 13 } }, 'p0').message, /not enough chips/);
  assert.match(r.try('CHAR_LOCK', { alloc: { grit: 6 } }, 'p0').message, /creation cap/);
  const safe = safeAllocation({ B: (g) => shared.group(r.state, g) }, c); assert.equal(Object.values(safe).reduce((a, b) => a + b, 0), 12); assert.ok(safe.grit >= 3 && safe.grit >= safe.luck, 'round-robin, class stat first');
  r.append('CHAR_LOCK', { alloc: { luck: 5, nerve: 5 } }, 'p0');
  assert.ok(c.locked); assert.equal(c.chips, 0); assert.equal(c.stats.luck, 8); assert.equal(c.stats.nerve, 8); assert.equal(c.stats.greed + c.stats.grit, 3 + 4 + 2, 'the two leftover chips went safe');
  // starter kit: Coin Blade, Loaded Dice, Mend, two Potions, and the class weapon (Ward) in the spell slot
  const names = Object.values(c.items).map(i => i.baseId).sort(); assert.deepEqual(names, ['coinblade', 'loadeddice', 'mend', 'potion', 'ward']);
  assert.equal(c.worn.spell1.baseId, 'ward'); assert.equal(c.worn.mainhand.baseId, 'coinblade'); assert.equal(Object.values(c.items).find(i => i.baseId === 'potion').qty, B.items.starterPotions);
  assert.equal(c.worn.spell1.affixes.length, 0, 'starter items are plain'); assert.equal(c.worn.mainhand.stake, B.items.stakeCommon);
  assert.match(r.try('CHAR_LOOK', { name: 'Paler' }, 'p0').message, /locked/); assert.match(r.try('CHAR_CLASS', { classId: 'whale' }, 'p0').message, /locked/);
  assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 1, mult: 2, gameId: 'fifty' }, 'p0').message, /locked/);
  r.append('CHAR_MIRROR', { look: { hair: 9 }, crest: '🐍' }, 'p0'); assert.equal(c.look.hair, 9); assert.equal(c.crest, '🐍');
  r.append('CHAR_LOOK', { name: 'NoClass' }, 'p1'); assert.match(r.try('CHAR_LOCK', {}, 'p1').message, /pick a class/);
  const st = creationStatus(r.state, r.now()); assert.ok(st.players[0].locked && st.players[0].stats.luck === 8);
});

test('creation: the clock — at RUN_START every unlocked character gets the safe allocation and seats without a character get a default; the TV may lock late players as system', () => {
  const r = room().join(names4); r.append('CREATION_OPEN');
  r.append('CHAR_LOOK', { name: 'Slow' }, 'p0'); r.append('CHAR_CLASS', { classId: 'whale' }, 'p0');
  r.append('CHAR_LOOK', { name: 'Classless' }, 'p1');
  r.tick(B.creation.clockSeconds * 1000 + 1);
  r.append('CHAR_LOCK', { playerId: 'p0' }, 'system'); const slow = charOf(r, 'p0'); assert.ok(slow.locked && slow.creation.auto); assert.equal(slow.stats.nerve, 4 + 3, 'Whale: Nerve first in the round-robin (10 chips over 4 stats)');
  r.append('RUN_START');
  for (const pid of names4.map((_, i) => 'p' + i)) { const c = charOf(r, pid); assert.ok(c && c.locked && c.classId, pid); assert.equal(c.chips, 0); assert.ok(Object.keys(c.items).length >= 5, 'kit given'); }
  assert.equal(charOf(r, 'p2').name, 'Sam'); assert.ok(charOf(r, 'p1').classId, 'a class was assigned');
  assert.equal(Object.values(r.state.stats).length, 4);
});

test('creation: roster picks — a survivor returns as it left (and only into its tier band), a dead one lends look and class under a new name; vault pulls; pet teams', () => {
  const r = room({ tier: 2 }).join(names4); r.append('CREATION_OPEN');
  r.append('ROSTER_CLAIM', { playerId: 'p0', ownerId: 'owner-a' }, 'p0'); r.append('ROSTER_CLAIM', { playerId: 'p1', ownerId: 'owner-b' }, 'p1');
  const st = r.state; const sword = gen.makeWeapon(st, gen.weaponDefById('bonecage'), { rarity: 'epic', seed: 3 }); const helm = gen.makeGear(st, 'helmet', { rarity: 'rare', seed: 4 });
  const vaultRing = gen.makeGear(st, 'ring', { rarity: 'epic', seed: 5 }); const vaultNeck = gen.makeGear(st, 'necklace', { seed: 6 }); const vaultTorso = gen.makeGear(st, 'torso', { seed: 7 }); const vault4 = gen.makeGear(st, 'ring', { seed: 8 });
  const pet = { id: 'petA', speciesId: 'gloomcat', name: 'Smudge', element: 'Soot', stage: 1, power: 70, maxPower: 70, attacks: [{ name: 'Scratch', gameId: 'scratch', stake: 8 }], heldItem: null, fainted: false, caughtAt: 1 };
  r.append('ROSTER_SYNC', { ownerId: 'owner-a', entries: [
    { id: 'vet', name: 'Old Vinny', classId: 'enforcer', look: { body: 2, skin: 1, face: 5, hair: 6, coat: '#112233' }, level: 9, stats: { luck: 4, nerve: 5, greed: 3, grit: 8 }, worn: { mainhand: sword, helmet: helm }, alive: true, vault: [vaultRing, vaultNeck, vaultTorso, vault4], pets: [pet], titles: ['Undying'] },
    { id: 'ghost', name: 'Dead Dave', classId: 'cutpurse', look: { body: 0, skin: 3, face: 1, hair: 2, coat: '#445566' }, level: 4, stats: { luck: 6, nerve: 3, greed: 4, grit: 3 }, worn: {}, alive: false, diedAt: 1, vault: [], pets: [] },
  ] }, 'p0');
  assert.ok(st.wall.includes('Dead Dave'), 'dead roster names are on the Wall');
  assert.match(r.try('ROSTER_SYNC', { ownerId: 'owner-a', entries: [] }, 'p1').message, /not your roster/);
  assert.match(r.try('CHAR_PICK_ROSTER', { rosterEntryId: 'vet' }, 'p1').message, /not on your roster/);
  // tier band: level 9 is band 2 → tier 2 is fine; a tier-1 room would refuse
  const r1 = room({ tier: 1 }).join(names4); r1.append('ROSTER_CLAIM', { playerId: 'p0', ownerId: 'owner-a' }, 'p0'); r1.append('ROSTER_SYNC', { ownerId: 'owner-a', entries: [clone(st.roster.vet)] }, 'p0');
  assert.match(r1.try('CHAR_PICK_ROSTER', { rosterEntryId: 'vet' }, 'p0').message, /tier 2 or deeper/);
  r.append('CHAR_PICK_ROSTER', { rosterEntryId: 'vet' }, 'p0'); const v = charOf(r, 'p0');
  assert.equal(v.name, 'Old Vinny'); assert.equal(v.level, 9); assert.deepEqual(v.stats, { luck: 4, nerve: 5, greed: 3, grit: 8 }); assert.ok(v.locked && v.veteran); assert.equal(v.rosterId, 'vet');
  assert.equal(v.worn.mainhand.id, sword.id); assert.equal(v.worn.helmet.id, helm.id); assert.ok(v.items[sword.id]); assert.equal(v.maxHealth, B.health.maxAtLevel1 + 8 * B.health.maxPerLevel + (v.flags.wornMaxHealth || 0));
  assert.equal(v.grid.rows, B.grid.rows + 1); assert.ok(chars.hasUpgrade(v, 'firsthit')); assert.ok(!chars.hasUpgrade(v, 'killheal')); assert.deepEqual(v.titles, ['Undying']);
  assert.ok(v.worn.mainhand.id === sword.id, 'the kit does not displace a veteran\'s weapon'); assert.ok(Object.values(v.items).some(i => i.baseId === 'coinblade'), 'but the kit is in the grid');
  assert.equal(v.pets.length, 1); assert.equal(v.pets[0].id, 'petA'); assert.equal(v.activePetId, 'petA');
  assert.match(r.try('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 1, mult: 2, gameId: 'fifty' }, 'p0').message, /locked/, 'a survivor skips the gamble');
  // vault pull: up to 3, from the owner's vault, into the grid
  assert.match(r.try('VAULT_PULL', { itemIds: [vaultRing.id, vaultNeck.id, vaultTorso.id, vault4.id] }, 'p0').message, /pull 3/);
  r.append('VAULT_PULL', { itemIds: [vaultRing.id, vaultNeck.id] }, 'p0'); assert.ok(v.items[vaultRing.id] && v.items[vaultNeck.id]); assert.equal(st.roster.vet.vault.length, 2);
  r.append('VAULT_PULL', { itemIds: [vaultTorso.id] }, 'p0'); assert.match(r.try('VAULT_PULL', { itemIds: [vault4.id] }, 'p0').message, /pull 3/);
  assert.match(r.try('VAULT_PULL', { itemIds: ['nope'] }, 'p1').message, /make a character/);
  // the dead one: look and class copied, new name required, gambles again
  const p1 = charOf(r, 'p1'); assert.equal(p1, null);
  r.state.players.p1.rosterOwnerId = 'owner-a';
  assert.match(r.try('CHAR_PICK_ROSTER', { rosterEntryId: 'ghost' }, 'p1').message, /give the new character a name/);
  assert.match(r.try('CHAR_PICK_ROSTER', { rosterEntryId: 'ghost', name: 'Dead Dave' }, 'p1').message, /already on/);
  r.append('CHAR_PICK_ROSTER', { rosterEntryId: 'ghost', name: 'Dave Again' }, 'p1'); const d = charOf(r, 'p1');
  assert.equal(d.name, 'Dave Again'); assert.equal(d.classId, 'cutpurse'); assert.deepEqual(d.look, { body: 0, skin: 3, face: 1, hair: 2, coat: '#445566' }); assert.ok(!d.locked); assert.equal(d.chips, B.creation.chips); assert.equal(d.level, 1); assert.equal(d.flags.rebornFrom, 'ghost');
  assert.match(r.try('CHAR_PICK_ROSTER', { rosterEntryId: 'vet' }, 'p1').message, /already at the table/);
  // pet team from the owner's pets
  assert.match(r.try('PET_TEAM', { petIds: ['zzz'] }, 'p1').message, /not on your roster/);
  r.append('PET_TEAM', { petIds: ['petA'] }, 'p1'); assert.equal(d.pets[0].name, 'Smudge');
  r.append('PET_TEAM', { petIds: [] }, 'p1'); assert.equal(d.pets.length, 0); assert.equal(d.activePetId, null);
  // the mirror closes during your own turn once the run starts
  r.append('CHAR_LOCK', {}, 'p1'); r.append('RUN_START'); const cur = shared.currentPlayerId(r.state);
  assert.match(r.try('CHAR_MIRROR', { look: { hair: 1 } }, cur).message, /closed during your turn/);
  const other = r.state.seats.find(id => id !== cur); r.append('CHAR_MIRROR', { look: { hair: 1 } }, other); assert.equal(charOf(r, other).look.hair, 1);
});

test('creation bot: every class plays through creation with injected results; the state survives a JSON round trip', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  const r = creationRoom({ names, classes: CLASS_IDS, gamble: (pid, i) => [
    { stat: 'luck', chips: 2, mult: i % 2 ? 2 : 0, gameId: 'fifty' }, { stat: 'nerve', chips: 3, mult: 1.5, gameId: 'dice' }, { stat: 'greed', chips: 1, mult: 1, gameId: 'hilo' }, { stat: 'grit', chips: 2, mult: 3, gameId: 'buyin' },
  ] });
  names.forEach((_, i) => {
    const c = charOf(r, 'p' + i); assert.ok(c.locked); assert.equal(c.classId, CLASS_IDS[i]); assert.equal(c.chips, 0);
    for (const s of chars.STAT_IDS) assert.ok(c.stats[s] >= B.stats.min && c.stats[s] <= B.stats.creationCap, `${c.name} ${s}=${c.stats[s]}`);
    const total = Object.values(c.stats).reduce((a, b) => a + b, 0); assert.ok(total >= 12 && total <= 32, `${c.name} total ${total}`);
    assert.ok(c.worn.mainhand || c.worn.spell1); assert.equal(c.creation.gambles.length, 4);
  });
  const before = JSON.stringify(r.state); const again = JSON.parse(before); assert.deepEqual(again, r.state); assert.equal(JSON.stringify(again), before);
  r.append('RUN_START'); assert.equal(r.state.phase, 'playing');
  const snap = clone(r.state); assert.deepEqual(Object.keys(snap.characters).length, 6);
});
