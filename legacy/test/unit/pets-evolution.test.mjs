import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, events } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PB = await import('../../site/js/petbattle.js');
const PR = await import('../../site/js/profiles.js');

const give = (c, speciesId = 'emberfox', name) => PT.hatchEgg(c.config, c.state, c.rng, c.p, { free: true, speciesId, name }).pet;
const xpTo = (level) => 50 * level * (level - 1) / 2;
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('every built-in species has two later forms at levels 8 and 16, with unique looks', () => {
  const emojis = new Set();
  for (const sp of PT.DEFAULT_SPECIES) {
    assert.deepEqual(sp.evolves.map(e => e.level), [8, 16], sp.id);
    for (const f of [sp, ...sp.evolves]) { assert.ok(f.name && f.emoji, sp.id); assert.ok(!emojis.has(f.emoji), `${f.emoji} is used twice`); emojis.add(f.emoji); }
  }
  assert.equal(emojis.size, 36);
});

test('a pet evolves on reaching the level: new name and look, +2 to both favoured stats, more HP', () => {
  const c = mkGame(); const pet = give(c); PT.addXp(c.config, c.state, c.rng, c.p, pet, xpTo(7));
  const before = { ...pet.stats }, hp = pet.hpMax;
  const ups = PT.addXp(c.config, c.state, c.rng, c.p, pet, 7 * 50);                           // → level 8
  assert.deepEqual([pet.level, pet.stage, pet.name, pet.emoji], [8, 1, 'Pyrewolf', '🐺']);
  assert.deepEqual(ups.at(-1).evolved, { from: 'Emberfox', to: 'Pyrewolf', emoji: '🐺' });
  assert.ok(pet.stats.dex >= before.dex + 2 && pet.stats.int >= before.int + 2); assert.ok(pet.hpMax > hp); assert.equal(pet.hp, pet.hpMax);
  assert.equal(events(c.state, 'PET_EVOLVE').length, 1); assert.equal(PT.formOf(c.config, pet).name, 'Pyrewolf');
});

test('a nickname survives evolution; only the look and form change', () => {
  const c = mkGame(); const pet = give(c, 'tidepup', 'Biscuit'); PT.addXp(c.config, c.state, c.rng, c.p, pet, xpTo(8));
  assert.deepEqual([pet.name, pet.emoji, PT.formOf(c.config, pet).name], ['Biscuit', '🐬', 'Surfseal']);
});

test('a big XP jump passes through both evolutions', () => {
  const c = mkGame(); const pet = give(c, 'sundrake'); PT.addXp(c.config, c.state, c.rng, c.p, pet, xpTo(17));
  assert.deepEqual([pet.stage, pet.name, pet.emoji], [2, 'Dawn Sovereign', '🦕']); assert.equal(events(c.state, 'PET_EVOLVE').length, 2);
  PT.addXp(c.config, c.state, c.rng, c.p, pet, 5000); assert.equal(pet.stage, 2);             // nothing past the last form
});

test('a species without later forms simply never evolves', () => {
  const c = mkGame(['A'], 1, (cfg) => { cfg.PetSpecies = [{ id: 'rock', name: 'Rock', emoji: '🪨', element: 'Grass', rarity: 'common', base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, grow: ['con', 'str'] }]; });
  const pet = give(c, 'rock'); PT.addXp(c.config, c.state, c.rng, c.p, pet, xpTo(12));
  assert.deepEqual([pet.level, pet.stage, pet.emoji], [12, undefined, '🪨']);
});

test('training reports an evolution in its message', () => {
  const c = mkGame(); const pet = give(c); PT.addXp(c.config, c.state, c.rng, c.p, pet, xpTo(8) - 10); PT.gainPower(c.state, c.p, 50, 'x');
  assert.match(PT.trainPet(c.config, c.state, c.rng, c.p, pet.id, 10).text, /evolved into 🐺 Pyrewolf/);
});

test('high-level wild pets appear already evolved, and join in that form', () => {
  const c = mkGame(); const mine = give(c); PT.addXp(c.config, c.state, c.rng, c.p, mine, xpTo(9)); mine.stats.cha = 30;
  PB.startWildEncounter(c.config, c.state, c.rng, c.p.id, { speciesId: 'tidepup', levelDelta: 0 });
  const b = c.state.petBattle; assert.deepEqual([b.b.name, b.b.emoji, b.b.wild.stage], ['Wild Surfseal', '🐬', 1]);
  b.turn = 'a'; b.b.hp = 1; PB.petBattleAction(c.config, c.state, c.rng, 'strike');
  if (b.phase === 'done' && b.capture?.ok) assert.deepEqual([c.p.pets[1].name, c.p.pets[1].emoji, c.p.pets[1].stage, c.p.pets[1].level], ['Surfseal', '🐬', 1, 9]);
});

// ── Trainer ranks ──
test('ranks climb with lifetime Power earned and spending never demotes', () => {
  const c = mkGame(); assert.equal(PT.rankOf(c.p).id, 'rookie');
  PT.gainPower(c.state, c.p, 250, 'x'); assert.equal(PT.rankOf(c.p).id, 'trainer');
  PT.spendPower(c.state, c.p, 250, 'x'); assert.equal(PT.rankOf(c.p).id, 'trainer'); assert.equal(PT.powerOf(c.p), 0);
  PT.gainPower(c.state, c.p, 600, 'x'); assert.equal(PT.rankOf(c.p).id, 'ace'); assert.equal(PT.nextRank(c.p).id, 'champion');
  assert.deepEqual(events(c.state, 'RANK_UP').map(e => e.rank), ['trainer', 'ace']);
});

test('lifetime Power keeps counting past the 1,000 cap; GM adjustments do not count', () => {
  const c = mkGame(); for (let i = 0; i < 4; i++) PT.gainPower(c.state, c.p, 800, 'x');
  assert.equal(PT.powerOf(c.p), 1000); assert.equal(PT.powerEarned(c.p), 3200); assert.equal(PT.rankOf(c.p).id, 'legend'); assert.equal(PT.nextRank(c.p), null);
  PT.gainPower(c.state, c.q, 5000, 'GM adjustment'); assert.equal(PT.rankOf(c.q).id, 'rookie'); assert.equal(PT.powerOf(c.q), 1000);
});

test('rank perks: cheaper eggs and bonus training XP', () => {
  const c = mkGame(); assert.equal(PT.eggCostFor(c.config, c.p), 100);
  c.p.powerEarned = 1500; c.p.power = 500;                                                    // Champion: −15% eggs, +20% XP
  assert.equal(PT.eggCostFor(c.config, c.p), 85);
  const pet = PT.hatchEgg(c.config, c.state, c.rng, c.p).pet; assert.equal(PT.powerOf(c.p), 415);
  assert.equal(PT.trainPet(c.config, c.state, c.rng, c.p, pet.id, 10).xp, 24);                // 10 × 2 × 1.2
});

test('ranks are ordered, each better than the last', () => {
  for (let i = 1; i < PT.RANKS.length; i++) { const a = PT.RANKS[i - 1], b = PT.RANKS[i]; assert.ok(b.earned > a.earned && b.eggDiscount >= a.eggDiscount && b.xpBonus >= a.xpBonus, b.id); }
});

test('rank progress and evolved pets carry over on the profile', () => {
  const st = mem(); const prof = PR.saveProfile({ name: 'Aj' }, st, 1).profile;
  const c = mkGame(['Aj']); c.p.profileId = prof.id; const pet = give(c); PT.addXp(c.config, c.state, c.rng, c.p, pet, xpTo(8)); PT.gainPower(c.state, c.p, 800, 'x');
  PR.stashProgress(c.state, st);
  const seat = PR.playerFromProfile(PR.loadProfiles(st)[0], 0, 500);
  assert.deepEqual([PT.rankOf(seat).id, seat.pets[0].stage, seat.pets[0].emoji, PT.formOf(c.config, seat.pets[0]).name], ['ace', 1, '🐺', 'Pyrewolf']);
});
