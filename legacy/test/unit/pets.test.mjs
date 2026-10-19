import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, G, mkGame, fixedRng, events } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PR = await import('../../site/js/profiles.js');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const fox = (c) => PT.speciesOf(c.config, 'emberfox');
const hatch = (c, player = c.p, opts = { free: true, speciesId: 'emberfox' }) => PT.hatchEgg(c.config, c.state, c.rng, player, opts).pet;

// ── D&D maths ──
test('ability modifiers follow D&D: 10–11 = +0, every 2 points = ±1', () => {
  assert.deepEqual([3, 8, 9, 10, 11, 12, 15, 18, 20].map(PT.mod), [-4, -1, -1, 0, 0, 1, 2, 4, 5]);
});

test('proficiency bonus steps up every four levels', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 13, 17, 20].map(PT.proficiency), [2, 2, 3, 3, 4, 5, 6, 6]);
});

test('hit points grow with level and Constitution, and never drop below 1', () => {
  assert.equal(PT.maxHp({ con: 10 }, 1), 14); assert.equal(PT.maxHp({ con: 14 }, 1), 20); assert.equal(PT.maxHp({ con: 14 }, 5), 44);
  assert.equal(PT.maxHp({ con: 6 }, 1), 10);                       // a penalty lowers the base but never the per-level gain
  assert.ok(PT.maxHp({ con: 3 }, 1) >= 1);
});

test('armour class comes from Dexterity plus a point every five levels', () => {
  assert.equal(PT.armorClass({ stats: { dex: 14 }, level: 1 }), 12); assert.equal(PT.armorClass({ stats: { dex: 14 }, level: 10 }), 14);
  assert.equal(PT.armorClass({ stats: { dex: 8 }, level: 1 }), 9);
});

test('XP to the next level is 50 × level', () => { assert.deepEqual([1, 2, 5].map(PT.xpToNext), [50, 100, 250]); });

// ── Species ──
test('the built-in bestiary: 12 species, every element covered, valid stats and growth', () => {
  const list = PT.DEFAULT_SPECIES; assert.equal(list.length, 12); assert.equal(new Set(list.map(s => s.id)).size, 12);
  assert.deepEqual([...new Set(list.map(s => s.element))].sort(), [...PT.ELEMENTS].sort());
  for (const s of list) {
    assert.ok(PT.RARITY_WEIGHT[s.rarity] > 0, s.id);
    for (const k of PT.STATS) assert.ok(s.base[k] >= 6 && s.base[k] <= 18, `${s.id}.${k}`);
    assert.ok(s.grow.length === 2 && s.grow.every(k => PT.STATS.includes(k)), s.id);
  }
});

test('a PetSpecies config tab replaces the built-in list; an empty tab keeps it', () => {
  assert.equal(PT.speciesList({ PetSpecies: [] }).length, 12);
  assert.deepEqual(PT.speciesList({ PetSpecies: [{ id: 'x' }] }).map(s => s.id), ['x']);
});

test('rarity drives hatch odds: commons are common, legendaries are ~1%', () => {
  const c = mkGame(); const count = {}; const N = 20000;
  for (let i = 0; i < N; i++) { const s = PT.pickSpecies(c.config, c.rng); count[s.rarity] = (count[s.rarity] || 0) + 1; }
  const total = PT.DEFAULT_SPECIES.reduce((s, x) => s + PT.RARITY_WEIGHT[x.rarity], 0);
  const expect = (r) => PT.DEFAULT_SPECIES.filter(x => x.rarity === r).length * PT.RARITY_WEIGHT[r] / total;
  for (const r of Object.keys(PT.RARITY_WEIGHT)) assert.ok(Math.abs(count[r] / N - expect(r)) < 0.015, `${r}: ${count[r] / N} vs ${expect(r)}`);
  assert.ok(count.common > count.uncommon && count.uncommon > count.rare && count.rare > count.epic && count.epic > count.legendary);
});

test('a rolled pet stays within ±3 of its species base and starts at full health', () => {
  const c = mkGame();
  for (let i = 0; i < 200; i++) {
    const pet = PT.rollPet(c.config, c.state, c.rng, fox(c));
    for (const k of PT.STATS) assert.ok(Math.abs(pet.stats[k] - fox(c).base[k]) <= 3, `${k} ${pet.stats[k]}`);
    assert.equal(pet.hp, pet.hpMax); assert.equal(pet.hpMax, PT.maxHp(pet.stats, 1)); assert.equal(pet.level, 1);
  }
  const lo = PT.rollPet(c.config, c.state, fixedRng([0]), fox(c)), hi = PT.rollPet(c.config, c.state, fixedRng([0.999]), fox(c));
  assert.equal(lo.stats.dex, 11); assert.equal(hi.stats.dex, 17);
  assert.notEqual(lo.id, hi.id);
});

// ── Power Level ──
test('Power is clamped to 0–1000 and every change is ledgered', () => {
  const c = mkGame();
  assert.equal(PT.gainPower(c.state, c.p, 40, 'x'), 40); assert.equal(PT.gainPower(c.state, c.p, 5000, 'x'), 960); assert.equal(PT.powerOf(c.p), 1000);
  assert.equal(PT.gainPower(c.state, c.p, 10, 'x'), 0);                         // capped: no change, no ledger row
  assert.equal(PT.gainPower(c.state, c.p, -5000, 'x'), -1000); assert.equal(PT.powerOf(c.p), 0);
  assert.equal(events(c.state, 'POWER').length, 3);
});

test('spending Power needs enough of it', () => {
  const c = mkGame(); PT.gainPower(c.state, c.p, 50, 'x');
  assert.equal(PT.spendPower(c.state, c.p, 80, 'x').error, true); assert.equal(PT.spendPower(c.state, c.p, 0, 'x').error, true);
  assert.equal(PT.spendPower(c.state, c.p, 50, 'x').spent, 50); assert.equal(PT.powerOf(c.p), 0);
});

test('Power never touches Gold or the leaderboard value', () => {
  const c = mkGame(); PT.gainPower(c.state, c.p, 900, 'x');
  assert.equal(c.p.balances.Gold, 500); assert.equal(S.netWorth(c.config, c.p), 500);
});

test('main-game events earn Power: game wins, big wins, battles, jail, turns', () => {
  const c = mkGame(['A', 'B']); const R = PT.petRules(c.config);
  const play = (mult) => { c.state.game = { id: 'fifty', playerId: c.p.id, wagers: [{ amount: 100, cur: 'Gold' }] }; G.settle(c.config, c.state, c.p, mult); };
  play(2); assert.equal(PT.accruePower(c.config, c.state), R.gain.gameWin);
  play(0); play(1); assert.equal(PT.accruePower(c.config, c.state), 0);         // losses and pushes earn nothing
  play(10); assert.equal(PT.accruePower(c.config, c.state), R.gain.gameBigWin);
  E.settleBattle(c.config, c.state, [{ playerId: c.p.id, cur: 'Gold', amount: 100 }, { playerId: c.q.id, cur: 'Gold', amount: 100 }], c.q.id);
  PT.accruePower(c.config, c.state); assert.equal(PT.powerOf(c.q), R.gain.battleWin);
  E.sendToJail(c.config, c.state, c.q, 't'); E.releaseFromJail(c.config, c.state, c.q, 't'); PT.accruePower(c.config, c.state);
  assert.equal(PT.powerOf(c.q), R.gain.battleWin + R.gain.jailIn + R.gain.jailOut);
  const before = PT.powerOf(c.p); E.endTurn(c.state, c.config); PT.accruePower(c.config, c.state);
  assert.equal(PT.powerOf(c.p), before + R.gain.turn);                          // the player who just finished the turn
});

test('accruePower pays each event exactly once, however often it is called', () => {
  const c = mkGame(); c.state.game = { id: 'fifty', playerId: c.p.id, wagers: [{ amount: 100, cur: 'Gold' }] }; G.settle(c.config, c.state, c.p, 2);
  PT.accruePower(c.config, c.state); const after = PT.powerOf(c.p);
  for (let i = 0; i < 5; i++) assert.equal(PT.accruePower(c.config, c.state), 0);
  assert.equal(PT.powerOf(c.p), after);
});

test('everyone gets the session-start Power, and pets can be switched off', () => {
  const c = mkGame(['A', 'B', 'C']); S.log(c.state, 'SESSION_START', null, {}); PT.accruePower(c.config, c.state);
  assert.deepEqual(c.players.map(PT.powerOf), [50, 50, 50]);
  const off = mkGame(['A'], 1, (cfg) => { cfg.Pets.enabled = false; }); S.log(off.state, 'SESSION_START', null, {});
  assert.equal(PT.accruePower(off.config, off.state), 0); assert.equal(PT.hatchEgg(off.config, off.state, off.rng, off.p).error, true);
});

test('partial Pets config merges with the defaults (including nested gain)', () => {
  const R = PT.petRules({ Pets: { eggCost: 40, gain: { turn: 9 } } });
  assert.deepEqual([R.eggCost, R.gain.turn, R.gain.gameWin, R.maxPets], [40, 9, 10, 3]);
});

// ── Hatching, roster, training ──
test('hatching costs Power, adds the pet, and the first pet becomes active', () => {
  const c = mkGame(); assert.equal(PT.hatchEgg(c.config, c.state, c.rng, c.p).error, true);            // 0 Power
  PT.gainPower(c.state, c.p, 240, 'x');                                       // under the 250 that earns the Trainer egg discount
  const r = PT.hatchEgg(c.config, c.state, c.rng, c.p);
  assert.equal(r.error, undefined); assert.equal(PT.powerOf(c.p), 140); assert.equal(c.p.pets.length, 1); assert.equal(PT.activePet(c.p).id, r.pet.id);
  const second = PT.hatchEgg(c.config, c.state, c.rng, c.p).pet; assert.equal(PT.activePet(c.p).id, r.pet.id); assert.notEqual(second.id, r.pet.id);
  assert.equal(events(c.state, 'PET_HATCH').length, 2);
});

test('GM gift eggs are free and can name the species; the pet limit holds', () => {
  const c = mkGame(); const pet = hatch(c, c.p, { free: true, speciesId: 'sundrake', name: 'Toast' });
  assert.deepEqual([pet.speciesId, pet.name, pet.element, pet.rarity], ['sundrake', 'Toast', 'Light', 'epic']); assert.equal(PT.powerOf(c.p), 0);
  hatch(c); hatch(c);
  assert.match(PT.hatchEgg(c.config, c.state, c.rng, c.p, { free: true }).text, /already has 3 pets/);
  assert.equal(PT.hatchEgg(c.config, c.state, c.rng, c.q, { free: true, speciesId: 'nope' }).error, true);
});

test('active pet, rename and release', () => {
  const c = mkGame(); const a = hatch(c), b = hatch(c);
  PT.setActivePet(c.state, c.p, b.id); assert.equal(PT.activePet(c.p).id, b.id);
  assert.equal(PT.setActivePet(c.state, c.p, 'nope').error, true);
  assert.equal(PT.renamePet(c.p, a.id, '  Sir Fluffington the Extremely Long-Named  ').pet.name.length, 24);
  assert.equal(PT.renamePet(c.p, a.id, '  ').error, true);
  PT.releasePet(c.state, c.p, b.id); assert.equal(c.p.pets.length, 1); assert.equal(PT.activePet(c.p).id, a.id);
  PT.releasePet(c.state, c.p, a.id); assert.equal(PT.activePet(c.p), null); assert.equal(c.p.activePetId, null);
});

test('training converts Power to XP and levels the pet up', () => {
  const c = mkGame(); const pet = hatch(c); PT.gainPower(c.state, c.p, 200, 'x');
  const r1 = PT.trainPet(c.config, c.state, c.rng, c.p, pet.id, 10);                                    // 20 XP of 50
  assert.equal(r1.ups.length, 0); assert.equal(pet.xp, 20); assert.equal(PT.powerOf(c.p), 190);
  const r2 = PT.trainPet(c.config, c.state, c.rng, c.p, pet.id, 90);                                    // +180 XP → L2 (50), L3 (100), 50 left
  assert.deepEqual([pet.level, pet.xp, r2.ups.length], [3, 50, 2]);
  assert.equal(PT.trainPet(c.config, c.state, c.rng, c.p, pet.id, 500).error, true);                    // can't afford
  assert.equal(PT.trainPet(c.config, c.state, c.rng, c.p, 'nope', 5).error, true);
});

test('each level raises a favoured stat (alternating), every 4th level a bonus stat, and HP keeps up', () => {
  const c = mkGame(); const pet = hatch(c); const before = { ...pet.stats }; const hp0 = pet.hpMax;
  PT.addXp(c.config, c.state, fixedRng([0]), c.p, pet, 50 + 100 + 150);                                 // → level 4
  assert.equal(pet.level, 4);
  assert.equal(pet.stats.dex, before.dex + 2);                                                          // levels 2 and 4 (grow = dex, int)
  assert.equal(pet.stats.int, before.int + 1);                                                          // level 3
  assert.equal(pet.stats.str, before.str + 1);                                                          // level-4 bonus (scripted roll → STR)
  assert.ok(pet.hpMax > hp0); assert.equal(pet.hp, pet.hpMax); assert.equal(pet.hpMax, PT.maxHp(pet.stats, 4));
  assert.equal(events(c.state, 'PET_LEVEL').length, 3);
});

test('levelling stops at the max level and stats cap at 24', () => {
  const c = mkGame(); const pet = hatch(c); pet.stats.dex = 24;
  PT.addXp(c.config, c.state, c.rng, c.p, pet, 1e6);
  assert.equal(pet.level, 20); assert.equal(pet.stats.dex, 24); assert.ok(pet.xp < PT.xpToNext(20));
  assert.equal(PT.trainPet(c.config, c.state, c.rng, c.p, pet.id, 1).error, true);
});

test('a fainted pet does not get healed by levelling; healing costs Power; resting is free', () => {
  const c = mkGame(); const pet = hatch(c); pet.hp = 0; pet.fainted = true;
  PT.addXp(c.config, c.state, c.rng, c.p, pet, 50); assert.equal(pet.hp, 0);
  assert.equal(PT.revivePet(c.config, c.state, c.p, pet.id).error, true);                                // no Power
  PT.gainPower(c.state, c.p, 30, 'x'); PT.revivePet(c.config, c.state, c.p, pet.id);
  assert.deepEqual([pet.fainted, pet.hp, PT.powerOf(c.p)], [false, pet.hpMax, 5]);
  assert.equal(PT.revivePet(c.config, c.state, c.p, pet.id).error, true);                                // already healthy
  pet.hp = 1; hatch(c).fainted = true;
  assert.equal(PT.restAllPets(c.state), 2); assert.ok(c.p.pets.every(x => !x.fainted && x.hp === x.hpMax));
});

test('statLine reads like a D&D stat block', () => {
  assert.equal(PT.statLine({ stats: { str: 14, dex: 16, con: 10, int: 8, wis: 12, cha: 11 } }), 'STR 14 (+2) · DEX 16 (+3) · CON 10 (+0) · INT 8 (-1) · WIS 12 (+1) · CHA 11 (+0)');
});

test('petPower gives one comparable number that rises with level', () => {
  const c = mkGame(); const pet = hatch(c); const p1 = PT.petPower(pet);
  PT.addXp(c.config, c.state, c.rng, c.p, pet, 50); assert.ok(PT.petPower(pet) > p1);
});

// ── Carry-over between sessions ──
test('pets and Power are saved on the profile at session end and restored when re-seated, healed', () => {
  const st = mem(); const prof = PR.saveProfile({ name: 'Aj' }, st, 1).profile;
  const c = mkGame(['Aj', 'Guest']); c.p.profileId = prof.id;
  const pet = hatch(c); PT.addXp(c.config, c.state, c.rng, c.p, pet, 60); pet.hp = 1; pet.fainted = true; PT.gainPower(c.state, c.p, 333, 'x');
  hatch(c, c.q);                                                         // the guest has no profile
  assert.equal(PR.stashProgress(c.state, st), 1);
  const seat = PR.playerFromProfile(PR.loadProfiles(st)[0], 0, 500);
  assert.equal(seat.balances.Gold, 500);                                 // Gold always starts fresh
  assert.deepEqual([seat.power, seat.pets.length, seat.pets[0].level, seat.pets[0].fainted, seat.pets[0].hp], [333, 1, 2, false, seat.pets[0].hpMax]);
  assert.equal(seat.activePetId, pet.id);
  seat.pets[0].name = 'Changed'; assert.notEqual(PR.loadProfiles(st)[0].pets[0].name, 'Changed');       // a copy, not a shared object
});

test('players saved before pets existed work without the fields', () => {
  const c = mkGame(); delete c.p.pets; delete c.p.power; delete c.p.activePetId;
  assert.equal(PT.powerOf(c.p), 0); assert.equal(PT.activePet(c.p), null); assert.deepEqual(PT.petsOf(c.p), []);
  assert.equal(hatch(c).level, 1);
});
