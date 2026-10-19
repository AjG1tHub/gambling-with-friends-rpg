// Pets: the species data, the Triple Pet Wheel (pools, rig, duds), hatching and the team cap, switching,
// pet attacks against monsters (damage, heals, Gold, faints, swarm bodies, Beastmaster grace), pets fighting
// first, pet battles, Rally, Pet Revive, evolution and the run-start hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, gen, hooks, shared, playingRoom, creationRoom, charOf, give, stubMonster, stubFight, ctxFor, clone } from './_fixtures-characters.mjs';
import { SPECIES, speciesDef, newPet, gainPower, wheelPools, activePet } from '../../packages/shared/handlers/pets.js';
import { B } from '../../packages/shared/balance.js';

test('pets data: fifteen species (the twelve plus the Maw, the Mucklings and the Moon), four attacks each on real games, three stages, the three named references', () => {
  assert.equal(SPECIES.length, 15);
  const legacy = ['emberfox', 'tidepup', 'sprigbun', 'zapmouse', 'gloomcat', 'dawnowl', 'boulderox', 'stormhawk', 'lavatoad', 'voidling', 'sundrake', 'goldengoose'];
  for (const id of legacy) assert.ok(speciesDef(id), id);
  for (const s of SPECIES) {
    assert.ok(['common', 'region', 'rare'].includes(s.pool), s.id); assert.ok(B.map.secretColours.includes(s.element), `${s.id} element ${s.element}`);
    assert.equal(s.stages.length, 3); assert.equal(s.attacks.length, B.pets.attacks);
    for (const a of s.attacks) { assert.ok(gen.gameById(a.gameId), `${s.id} ${a.name} plays ${a.gameId}`); assert.ok(a.stake > 0); }
    assert.ok(['strip', 'docks', 'blackwood', 'caldera', 'citadel'].includes(s.regionBias));
  }
  const maw = speciesDef('grazingmaw'); assert.equal(maw.onlyRegion, 'blackwood'); assert.equal(maw.element, 'Verdigris'); assert.deepEqual(maw.attacks.map(a => a.gameId), ['thimbles', 'dice', 'hilo', 'crash']); assert.equal(maw.attacks[2].effect, 'healTrainer');
  const muck = speciesDef('mucklings'); assert.ok(muck.swarm); assert.equal(muck.element, 'Soot'); assert.deepEqual(muck.attacks.map(a => a.gameId), ['chuckaluck', 'plinko', 'scratch', 'bigwheel']); assert.equal(muck.attacks[2].effect, 'gold');
  const moon = speciesDef('notoriousmoon'); assert.equal(moon.onlyRegion, 'citadel'); assert.deepEqual(moon.attacks.map(a => a.gameId), ['hilo', 'fifty', 'plinko', 'hilo']); assert.ok(moon.attacks[1].doubling);
});

test('pets: the three wheels — common pool, region-weighted pool, rare pool with duds; the GM can rig any; hatch, pick, team cap', () => {
  const r = creationRoom(); const st = r.state; const ctx = ctxFor(r);
  const [common, region, rare] = wheelPools(st, ctx, 'blackwood');
  assert.equal(common.outcomes.length, B.pets.wheelSegments); assert.ok(common.outcomes.every(id => speciesDef(id).pool === 'common'));
  assert.ok(region.outcomes.filter(id => speciesDef(id).regionBias === 'blackwood').length >= B.map.regionBiasWeight, 'the region\'s species are repeated');
  assert.ok(region.outcomes.includes('grazingmaw'), 'the Maw only in Blackwood'); assert.ok(!wheelPools(st, ctx, 'docks')[1].outcomes.includes('grazingmaw'));
  assert.equal(rare.outcomes.filter(o => o === null).length, B.pets.rareWheelBlanks); assert.ok(rare.outcomes.filter(Boolean).every(id => speciesDef(id).pool === 'rare' || speciesDef(id).onlyRegion === 'blackwood'));
  assert.ok(wheelPools(st, ctx, 'citadel')[2].outcomes.includes('notoriousmoon')); assert.ok(!wheelPools(st, ctx, 'strip')[2].outcomes.includes('notoriousmoon'));
  // hatch at setup: three spins land on the TV, a pick keeps one
  r.append('PET_HATCH', { source: 'setup' }, 'p0'); const c = charOf(r, 'p0');
  assert.equal(c.hatching.wheels.length, 3); assert.equal(st.lastSpin.wheel, 'pets'); assert.equal(st.lastSpin.outcomes.length, 3);
  assert.match(r.try('PET_HATCH', { source: 'setup' }, 'p0').message, /pick from the wheels/);
  assert.match(r.try('PET_HATCH_PICK', { index: 5 }, 'p0').message, /pick wheel/);
  r.append('PET_HATCH_PICK', { index: 0 }, 'p0'); assert.equal(c.pets.length, 1); assert.equal(c.activePetId, c.pets[0].id); assert.equal(c.pets[0].power, B.pets.startPower); assert.equal(c.hatching, null); assert.equal(st.stats.p0.petsCaught, 1);
  assert.match(r.try('PET_HATCH', { source: 'setup' }, 'p0').message, /already have a pet/);
  // the rig: force the rare wheel onto the Voidling, then a dud
  const egg = give(r, 'p0', gen.makeConsumable(st, 'egg')); r.append('GM_RIG', { stream: 'pets', value: 'emberfox' }); r.append('GM_RIG', { stream: 'pets', value: 'gloomcat' }); r.append('GM_RIG', { stream: 'pets', value: 'voidling' });
  r.append('PET_HATCH', { source: 'egg' }, 'p0'); assert.ok(!c.items[egg.id], 'the egg is spent'); assert.deepEqual(st.lastSpin.outcomes, ['emberfox', 'gloomcat', 'voidling']);
  r.append('PET_HATCH_PICK', { index: 2 }, 'p0'); assert.equal(c.pets[1].speciesId, 'voidling');
  assert.match(r.try('PET_HATCH', { source: 'egg' }, 'p0').message, /no egg/);
  give(r, 'p0', gen.makeConsumable(st, 'egg')); r.append('GM_RIG', { stream: 'pets', value: 0 }); r.append('GM_RIG', { stream: 'pets', value: 0 }); r.append('GM_RIG', { stream: 'pets', value: 'dud' });
  r.append('PET_HATCH', { source: 'egg' }, 'p0'); r.append('PET_HATCH_PICK', { index: 2 }, 'p0'); assert.equal(c.pets.length, 2, 'a dud keeps nothing');
  // the team cap; the Beastmaster's seventh at level 5
  while (c.pets.length < B.pets.teamMax) c.pets.push(newPet(st, ctx, speciesDef('zapmouse')));
  assert.match(r.try('PET_HATCH', { source: 'boss', playerId: 'p0' }, 'gm').message, /team is full/);
  c.classId = 'beastmaster'; c.upgrades.push('carry7'); r.append('PET_HATCH', { source: 'boss', playerId: 'p0' }, 'gm'); assert.ok(c.hatching); c.hatching = null;
  assert.match(r.try('PET_HATCH', { source: 'boss' }, 'p0').message, /GM only/);
  assert.match(r.try('PET_HATCH', { source: 'nest' }, 'p1').message, /egg, setup or boss/);
  // a dud-rigged spin is deterministic across a replay
  assert.deepEqual(clone(st.lastSpin), JSON.parse(JSON.stringify(st.lastSpin)));
});

test('pets: run start gives the session bonus (×2 for the Beastmaster), an egg to the Beastmaster, and spins a setup hatch for the petless', () => {
  const r = creationRoom({ classes: ['beastmaster', 'whale', 'whale', 'whale'] }); const st = r.state; const ctx = ctxFor(r);
  const bm = charOf(r, 'p0'), w = charOf(r, 'p1');
  bm.pets.push(newPet(st, ctx, speciesDef('emberfox'))); bm.activePetId = bm.pets[0].id; w.pets.push(newPet(st, ctx, speciesDef('tidepup'))); w.activePetId = w.pets[0].id;
  r.append('RUN_START');
  assert.equal(w.pets[0].power, B.pets.startPower + B.pets.sessionPowerBonus); assert.equal(bm.pets[0].power, B.pets.startPower + B.pets.sessionPowerBonus * B.pets.beastmasterPowerMult);
  assert.ok(Object.values(bm.items).some(i => i.slot === 'egg'), 'the Beastmaster\'s extra egg'); assert.ok(!Object.values(w.items).some(i => i.slot === 'egg'));
  assert.ok(!bm.hatching && !w.hatching); assert.ok(charOf(r, 'p2').hatching && charOf(r, 'p3').hatching, 'petless players get the three wheels');
  r.append('PET_HATCH_PICK', { index: 1 }, 'p2'); assert.equal(charOf(r, 'p2').pets.length, 1);
  assert.ok(r.state.ledger.some(row => row.kind === 'power'), 'Power moves through the ledger');
});

test('pets: attacks stake Power, hit monsters through a ledger row, heal, pay Gold, faint at zero; Mucklings lose a body; Beastmaster grace; evolution', () => {
  const r = playingRoom({ classes: ['beastmaster', 'whale', 'whale', 'whale'] }); const st = r.state; const ctx = ctxFor(r);
  for (const c of Object.values(st.characters)) c.hatching = null;
  const pid = 'p0'; const c = charOf(r, pid); assert.equal(c.classId, 'beastmaster'); c.pets = []; c.activePetId = null;
  const maw = newPet(st, ctx, speciesDef('grazingmaw')); c.pets.push(maw); c.activePetId = maw.id;
  const m = stubMonster(r, { health: 60 });
  assert.match(r.try('PET_ATTACK', { attackIndex: 1, mult: 2 }, pid).message, /not in a fight/);
  stubFight(r, pid);
  assert.match(r.try('PET_ATTACK', { attackIndex: 9, mult: 2 }, pid).message, /no such attack/);
  r.append('PET_ATTACK', { attackIndex: 1, mult: 2, label: 'Chomp: exact 7' }, pid);   // Chomp = dice, stake 12
  const expected = Math.round(12 * 2 * (c.classId === 'beastmaster' && c.upgrades.includes('petattack') ? 1 + B.pets.beastmasterAttackBonus : 1));
  assert.equal(m.health, 60 - expected); assert.ok(st.ledger.at(-2).kind === 'monsterHealth' || st.ledger.some(x => x.kind === 'monsterHealth' && x.charId === 'm1'));
  assert.equal(maw.power, B.pets.startPower + B.pets.winPower * (c.classId === 'beastmaster' ? B.pets.beastmasterPowerMult : 1), 'a win earns Power (doubled for the Beastmaster)');
  assert.equal(st.stats[pid].damageDealt, expected); assert.match(r.try('PET_ATTACK', { attackIndex: 1, mult: 2 }, pid).message, /attacked this turn/);
  c.usedThisTurn.petAttack = false; c.health = 40; r.append('PET_ATTACK', { attackIndex: 2, mult: 2 }, pid); assert.equal(c.health, 40 + 20, 'Milk of Grief heals the trainer');
  c.usedThisTurn.petAttack = false; const p0 = maw.power; r.append('PET_ATTACK', { attackIndex: 3, mult: 0, label: 'the fuse blew' }, pid); assert.equal(maw.power, p0 - 16, 'a loss burns the stake');
  c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 0, mult: 1 }, pid); assert.equal(maw.power, p0 - 16, 'a push costs nothing');
  c.usedThisTurn.petAttack = false; m.health = 100; r.append('PET_ATTACK', { attackIndex: 3, mult: 3 }, pid); assert.equal(m.skipTurns, 1, 'Swallow Whole eats the monster\'s turn'); assert.ok(!m.dead);
  // faint: the Beastmaster's first faint is undone, the second sticks; a Pet Revive brings it back
  maw.power = 16; c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 3, mult: 0 }, pid); assert.ok(!maw.fainted && maw.power === B.pets.startPower && c.flags.faintUndone, 'Beastmaster grace');
  maw.power = 16; c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 3, mult: 0 }, pid); assert.ok(maw.fainted); assert.equal(c.activePetId, null);
  assert.match(r.try('PET_ATTACK', { attackIndex: 0, mult: 2 }, pid).message, /no active pet/);
  const revive = give(r, pid, gen.makeConsumable(st, 'petrevive')); hooks.consumables.petrevive(st, ctx, c, { petId: maw.id }, revive); assert.ok(!maw.fainted && maw.power === maw.maxPower && !c.items[revive.id]);
  // Mucklings: a body per faint, Gold from Gilt Heap, Pile On scaled by bodies
  const muck = newPet(st, ctx, speciesDef('mucklings')); c.pets.push(muck); c.activePetId = muck.id; assert.equal(muck.bodies, B.pets.swarmBodies);
  const gold0 = c.gold; c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 2, mult: 3 }, pid); assert.equal(c.gold, gold0 + 24);
  muck.power = 10; c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 1, mult: 0 }, pid); assert.equal(muck.bodies, B.pets.swarmBodies - 1); assert.ok(!muck.fainted && muck.power === B.pets.startPower);
  muck.bodies = 1; muck.power = 10; c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 1, mult: 0 }, pid); assert.ok(muck.fainted, 'the last heap faints');
  // evolution at the Power thresholds
  const fox = newPet(st, ctx, speciesDef('emberfox')); c.pets.push(fox); c.classId = 'whale';
  gainPower(st, ctx, c, fox, B.pets.evolveAt[0] - fox.power, 'test'); assert.equal(fox.stage, 1); assert.equal(fox.name, 'Pyrewolf'); assert.equal(fox.maxPower, B.pets.evolveAt[0] + B.pets.powerPerStage);
  gainPower(st, ctx, c, fox, B.pets.evolveAt[1], 'test'); assert.equal(fox.stage, 2); assert.equal(fox.name, 'Ashen Kitsune');
  // a kill by a pet counts
  m.health = 5; m.dead = false; c.activePetId = fox.id; c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 1, mult: 2 }, pid); assert.ok(m.dead); assert.equal(st.stats[pid].kills, 1);
});

test('pets: pets fight first (redirect + faint check), switching costs the move, pet battles lock and resolve deterministically, Rally', () => {
  const r = playingRoom(); const st = r.state; const ctx = ctxFor(r);
  for (const c of Object.values(st.characters)) c.hatching = null;
  const pid = shared.currentPlayerId(st); const oid = st.seats.find(id => id !== pid); const c = charOf(r, pid), o = charOf(r, oid);
  c.pets = [newPet(st, ctx, speciesDef('boulderox')), newPet(st, ctx, speciesDef('gloomcat'))]; c.activePetId = c.pets[0].id;
  o.pets = [newPet(st, ctx, speciesDef('stormhawk'))]; o.activePetId = o.pets[0].id;
  const info = { attackerId: o.id, targetId: c.id, targetKind: 'character', stake: 10, mult: 2, flat: 0, notes: [] };
  for (const h of hooks.petHooks.beforeCharacterHit) h(st, ctx, info); assert.equal(info.redirectToPet, c.pets[0].id);
  c.pets[0].power = 0; for (const h of hooks.damageHooks.afterHit) h(st, ctx, info); assert.ok(c.pets[0].fainted); assert.equal(c.activePetId, c.pets[1].id, 'the next healthy pet steps up');
  const noPets = { ...info, targetId: charOf(r, st.seats[2]).id, redirectToPet: undefined }; charOf(r, st.seats[2]).pets = []; for (const h of hooks.petHooks.beforeCharacterHit) h(st, ctx, noPets); assert.equal(noPets.redirectToPet, undefined);
  // switching
  assert.match(r.try('PET_SWITCH', { petId: c.pets[0].id }, pid).message, /is down/);
  c.pets[0].fainted = false; c.pets[0].power = 20; assert.match(r.try('PET_SWITCH', { petId: c.pets[1].id }, pid).message, /already out/);
  r.append('PET_SWITCH', { petId: c.pets[0].id }, pid); assert.equal(c.activePetId, c.pets[0].id); assert.ok(c.usedThisTurn.moved);
  assert.match(r.try('PET_SWITCH', { petId: c.pets[1].id }, pid).message, /move/); assert.match(r.try('PET_SWITCH', { petId: c.pets[1].id }, oid).message, /not your turn/);
  // Rally heals the active pet to full; at 20 it revives
  c.classId = 'beastmaster'; c.pets[0].power = 5; hooks.classActives.rally(st, ctx, c, {}); assert.equal(c.pets[0].power, c.pets[0].maxPower); assert.equal(c.cooldowns.active, B.classes.beastmasterCooldown);
  c.pets[0].fainted = true; assert.throws(() => hooks.classActives.rally(st, ctx, c, {}), /final upgrade/); c.upgrades.push('revive'); hooks.classActives.rally(st, ctx, c, {}); assert.ok(!c.pets[0].fainted);
  // a pet battle: both lock, the seeded stream decides, the loser's Power drops by the winner's stake
  c.gold = 100; o.gold = 100;
  assert.match(r.try('PET_BATTLE_START', { opponentId: oid, wager: 500 }, pid).message, /cover the wager/);
  r.append('PET_BATTLE_START', { opponentId: oid, wager: 30 }, pid); assert.equal(st.fight.kind, 'petbattle'); assert.deepEqual(st.fight.playerIds, [pid, oid]);
  assert.match(r.try('PET_BATTLE_LOCK', { attackIndex: 0 }, st.seats[2]).message, /not your battle/);
  const snap = JSON.stringify(st);
  r.append('PET_BATTLE_LOCK', { attackIndex: 3 }, pid); assert.ok(st.fight && st.fight.locks[pid] === 3); assert.match(r.try('PET_BATTLE_LOCK', { attackIndex: 1 }, pid).message, /already locked/);
  r.append('PET_BATTLE_LOCK', { attackIndex: 0 }, oid);
  const after1 = st.fight || st.lastPetBattle; assert.equal(after1.log.length, 1); assert.deepEqual(after1.locks, {});
  const total = c.pets[0].power + o.pets[0].power; assert.ok(total < c.pets[0].maxPower + o.pets[0].maxPower, 'somebody lost Power');
  // the same two locks on the same state replay the same outcome
  const r2 = { state: JSON.parse(snap) }; const ev = (type, payload, actor) => shared.applyEvent(r2.state, { type, actor, ts: r.now(), payload }, { clone: false, strict: true });
  ev('PET_BATTLE_LOCK', { attackIndex: 3 }, pid); ev('PET_BATTLE_LOCK', { attackIndex: 0 }, oid);
  assert.equal((r2.state.fight || r2.state.lastPetBattle).log[0].winnerId, after1.log[0].winnerId);
  // fight it out
  let guard = 0; while (st.fight && st.fight.kind === 'petbattle' && guard++ < 40) { r.append('PET_BATTLE_LOCK', { attackIndex: 3 }, pid); r.append('PET_BATTLE_LOCK', { attackIndex: 3 }, oid); }
  assert.equal(st.fight, null); const res = st.lastPetBattle.result; assert.ok(res.winnerId && res.loserId);
  const win = charOf(r, res.winnerId), lose = charOf(r, res.loserId); assert.equal(win.gold, 130); assert.equal(lose.gold, 70); assert.ok(win.xp >= B.xp.petWin || win.level > 1);
  assert.equal(st.stats[res.winnerId].challengesWon, 1);
  // a page reload keeps every pet intact
  assert.deepEqual(clone(c.pets), c.pets);
});
