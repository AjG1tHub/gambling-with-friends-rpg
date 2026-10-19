import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, fixedRng, events, gold } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PB = await import('../../site/js/petbattle.js');
const PR = await import('../../site/js/profiles.js');

const give = (c, player = c.p) => { const pet = PT.hatchEgg(c.config, c.state, c.rng, player, { free: true, speciesId: 'emberfox' }).pet; pet.stats = { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }; pet.hpMax = PT.maxHp(pet.stats, 1); pet.hp = pet.hpMax; return pet; };
const roll = (n) => (n - 0.5) / 20, die = (n, sides) => (n - 0.5) / sides;
function duel(c) { PB.startPetBattle(c.config, c.state, fixedRng([0.99, 0.01]), { challengerId: c.p.id, opponentId: c.q.id }); return c.state.petBattle; }
const use = (c, move, rolls) => PB.petBattleAction(c.config, c.state, fixedRng(rolls), move);

test('five held items, each with a price and a description', () => {
  assert.deepEqual(Object.keys(PT.PET_ITEMS).sort(), ['berry', 'charm', 'fang', 'focus', 'shell']);
  for (const it of Object.values(PT.PET_ITEMS)) assert.ok(it.price > 0 && it.desc && it.icon && it.name);
});

test('items go into the bag, equip onto a pet, and swap back cleanly', () => {
  const c = mkGame(); const pet = give(c);
  PT.addItem(c.state, c.p, 'fang'); PT.addItem(c.state, c.p, 'shell'); assert.deepEqual(PT.bagOf(c.p), { fang: 1, shell: 1 });
  PT.equipItem(c.state, c.p, pet.id, 'fang'); assert.equal(pet.item, 'fang'); assert.deepEqual(PT.bagOf(c.p), { shell: 1 });
  PT.equipItem(c.state, c.p, pet.id, 'shell'); assert.equal(pet.item, 'shell'); assert.deepEqual(PT.bagOf(c.p), { fang: 1 });
  PT.equipItem(c.state, c.p, pet.id, null); assert.equal(pet.item, null); assert.deepEqual(PT.bagOf(c.p), { fang: 1, shell: 1 });
});

test('you cannot equip what you do not have, unknown items, or onto a pet that is not yours', () => {
  const c = mkGame(); const pet = give(c);
  assert.equal(PT.equipItem(c.state, c.p, pet.id, 'fang').error, true); assert.equal(PT.equipItem(c.state, c.p, pet.id, 'sword').error, true);
  assert.equal(PT.equipItem(c.state, c.q, pet.id, null).error, true); assert.equal(PT.addItem(c.state, c.p, 'sword').error, true);
});

test('the shop sells gear for Gold into the bag (no pet needed)', () => {
  const c = mkGame(); c.p.balances.Gold = 1000;
  const r = PT.buyPetGood(c.config, c.state, c.rng, c.p, 'fang');
  assert.equal(r.error, undefined); assert.equal(gold(c.p), 700); assert.deepEqual(PT.bagOf(c.p), { fang: 1 });
  assert.equal(PT.petShop(c.config).filter(i => i.gear).length, 5); assert.equal(PT.petShop(c.config).length, 8);
});

test('Sharp Fang adds 2 damage; Focus Band adds 1 to hit; Hard Shell adds 1 AC', () => {
  let c = mkGame(); give(c).item = 'fang'; give(c, c.q); let b = duel(c);
  assert.match(use(c, 'strike', [roll(15), die(4, 8)]).text, /hit for 8\./);                          // 4 + 2 STR + 2 fang
  c = mkGame(); give(c).item = 'focus'; give(c, c.q); b = duel(c);
  assert.match(use(c, 'strike', [roll(6), die(4, 8)]).text, /rolls 6\+5 vs AC 11: hit/);              // +4 +1, would miss without
  c = mkGame(); give(c); give(c, c.q).item = 'shell'; b = duel(c);
  assert.equal(b.b.ac, 12); assert.match(use(c, 'strike', [roll(7), die(4, 8)]).text, /vs AC 12: MISS/);
});

test('Rally Berry heals 30% once when its holder drops under 30%', () => {
  const c = mkGame(); give(c); give(c, c.q).item = 'berry'; const b = duel(c); b.b.hpMax = 40; b.b.hp = 15;
  use(c, 'strike', [roll(15), die(4, 8)]);                                                            // 15 − 6 = 9 (< 12) → +12
  assert.equal(b.b.hp, 21); assert.equal(b.b.berryUsed, true); assert.match(b.log.map(l => l.text).join('|'), /Rally Berry/);
  use(c, 'guard', [0]); b.b.hp = 8; use(c, 'strike', [roll(15), die(1, 8)]); assert.equal(b.b.hp, 5);                // only once
});

test('Rally Berry cannot save a pet that was knocked out in one hit', () => {
  const c = mkGame(); give(c); give(c, c.q).item = 'berry'; const b = duel(c); b.b.hp = 3;
  const r = use(c, 'strike', [roll(15), die(8, 8), 0, 0]); assert.equal(r.finished, true); assert.equal(b.b.hp, 0);
});

test('Lucky Charm: +3 on befriending rolls and +10% XP', () => {
  const c = mkGame(); const pet = give(c); pet.item = 'charm';
  PT.addXp(c.config, c.state, c.rng, c.p, pet, 40); assert.equal(pet.xp, 44);
  PB.startWildEncounter(c.config, c.state, fixedRng([0.5]), c.p.id, { speciesId: 'tidepup', levelDelta: 0 });
  const b = c.state.petBattle; b.turn = 'a'; b.b.hp = 1;
  PB.petBattleAction(c.config, c.state, fixedRng([roll(19), 0.5, roll(5), 0.5, 0.5]), 'strike');       // 5 + 0 CHA + 3 charm = DC 8
  assert.deepEqual([b.capture.bonus, b.capture.ok], [3, true]);
});

test('bosses drop a random item some of the time, straight into the winner\'s bag', () => {
  let drops = 0; const N = 300;
  for (let i = 0; i < N; i++) {
    const c = mkGame(['A', 'B'], 2000 + i); give(c);
    PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, bossId: 'sewerking' });
    const b = c.state.petBattle; b.turn = 'a'; b.b.hp = 1;
    let g = 0; while (b.phase === 'active' && g++ < 50) { PB.petBattleAction(c.config, c.state, c.rng, 'strike'); if (b.phase === 'active' && b.turn === 'b') b.turn = 'a'; }
    const n = Object.values(PT.bagOf(c.p)).reduce((s, x) => s + x, 0); if (n) { drops++; assert.equal(n, 1); assert.ok(b.rewards.some(t => /dropped/.test(t))); }
  }
  assert.ok(Math.abs(drops / N - 0.3) < 0.09, `drop rate ${drops / N}`);
});

test('PvP and wild battles never drop gear; dropChance 0 switches drops off', () => {
  const c = mkGame(['A', 'B'], 1, (cfg) => { cfg.PetBattle.dropChance = 0; }); give(c);
  for (let i = 0; i < 20; i++) { PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, bossId: 'sewerking' }); const b = c.state.petBattle; b.turn = 'a'; b.b.hp = 1; let g = 0;
    while (b.phase === 'active' && g++ < 50) { PB.petBattleAction(c.config, c.state, c.rng, 'strike'); if (b.phase === 'active') b.turn = 'a'; }
    PB.clearPetBattle(c.state); c.p.pets[0].hp = c.p.pets[0].hpMax; c.p.pets[0].fainted = false; }
  assert.deepEqual(PT.bagOf(c.p), {});
});

test('the bag and held items carry over on the profile', () => {
  const m = new Map(); const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const prof = PR.saveProfile({ name: 'Aj' }, st, 1).profile; const c = mkGame(['Aj']); c.p.profileId = prof.id;
  const pet = give(c); PT.addItem(c.state, c.p, 'fang'); PT.addItem(c.state, c.p, 'berry'); PT.equipItem(c.state, c.p, pet.id, 'fang');
  PR.stashProgress(c.state, st); const seat = PR.playerFromProfile(PR.loadProfiles(st)[0], 0, 500);
  assert.deepEqual([seat.pets[0].item, seat.petItems], ['fang', { berry: 1 }]);
});

test('itemBonus is zero for bare pets, bosses and unknown items', () => {
  assert.equal(PT.itemBonus({}, 'dmg'), 0); assert.equal(PT.itemBonus(null, 'ac'), 0); assert.equal(PT.itemBonus({ item: 'mystery' }, 'hit'), 0);
  assert.equal(PT.itemBonus({ item: 'fang' }, 'ac'), 0); assert.equal(PT.itemBonus({ item: 'fang' }, 'dmg'), 2);
});
