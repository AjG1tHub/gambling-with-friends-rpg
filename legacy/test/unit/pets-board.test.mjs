import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, mkGame, fixedRng, events, gold } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PB = await import('../../site/js/petbattle.js');

const verb = (c, v, params = {}, player = c.p, rng = c.rng) => E.executeVerb(c.config, c.state, rng, { verb: v, params, label: v }, player);
const give = (c, player = c.p, speciesId = 'emberfox') => PT.hatchEgg(c.config, c.state, c.rng, player, { free: true, speciesId }).pet;
const roll = (n) => (n - 0.5) / 20;

test('POWER_DELTA adds and drains Power, clamped at 0', () => {
  const c = mkGame(); assert.match(verb(c, 'POWER_DELTA', { amount: 40 }).text, /\+40 ⚡/); assert.equal(PT.powerOf(c.p), 40);
  assert.match(verb(c, 'POWER_DELTA', { amount: -100 }).text, /-40 ⚡/); assert.equal(PT.powerOf(c.p), 0);
});

test('EGG_GRANT hatches a free pet, or pays Power when the team is full', () => {
  const c = mkGame(); verb(c, 'EGG_GRANT'); assert.equal(c.p.pets.length, 1); assert.equal(PT.powerOf(c.p), 0);
  give(c); give(c);
  assert.match(verb(c, 'EGG_GRANT', { consolation: 50 }).text, /team is full/); assert.equal(c.p.pets.length, 3); assert.equal(PT.powerOf(c.p), 50);
});

test('PET_HEAL restores every pet the player owns', () => {
  const c = mkGame(); const a = give(c), b = give(c); a.hp = 1; b.hp = 0; b.fainted = true;
  verb(c, 'PET_HEAL'); assert.ok([a, b].every(p => p.hp === p.hpMax && !p.fainted));
  assert.match(verb(c, 'PET_HEAL', {}, c.q).text, /no pets/);
});

test('WILD_ENCOUNTER asks the GM for a fight when the player has a pet, else pays a little Power', () => {
  const c = mkGame(); const r = verb(c, 'WILD_ENCOUNTER', { consolation: 20 });
  assert.equal(r.wildEncounter, undefined); assert.equal(PT.powerOf(c.p), 20);
  give(c); assert.equal(verb(c, 'WILD_ENCOUNTER').wildEncounter, true);
});

test('the default GOOD / BAD wheels carry the pet outcomes and every row still has a handled verb', () => {
  const c = mkGame();
  assert.ok(c.config.Wheel_Good.some(r => r.verb === 'EGG_GRANT')); assert.ok(c.config.Wheel_Good.some(r => r.verb === 'POWER_DELTA'));
  assert.ok(c.config.Wheel_Bad.some(r => r.verb === 'WILD_ENCOUNTER'));
  assert.ok(c.config.Wheel_Battle.some(r => r.petBattle));
  for (const tab of ['Wheel_Good', 'Wheel_Bad']) for (const row of c.config[tab]) {
    const x = mkGame(); x.state.move = { startPos: 0, done: false };
    assert.notEqual(E.executeVerb(x.config, x.state, x.rng, row, x.p).adjudicate, true, `${tab} → ${row.label}`);
  }
});

test('a wild encounter is a pet of about your level, scaled up along its growth stats', () => {
  const c = mkGame(); const pet = give(c); PT.addXp(c.config, c.state, c.rng, c.p, pet, 50 + 100 + 150 + 200);       // level 5
  const r = PB.startWildEncounter(c.config, c.state, c.rng, c.p.id, { speciesId: 'tidepup', levelDelta: 1 });
  const w = c.state.petBattle.b;
  assert.equal(r.error, undefined); assert.deepEqual([c.state.petBattle.kind, w.level, w.owner, w.element, w.wild.rarity], ['wild', 6, 'WILD', 'Water', 'common']);
  assert.equal(w.hpMax, PT.maxHp(w.stats, 6)); assert.equal(w.rewardGold, 0);
  const base = PT.speciesOf(c.config, 'tidepup').base; assert.ok(w.stats.con >= base.con - 3 + 3);                  // 3 CON level-ups (levels 2, 4, 6)
});

test('a wild encounter needs a healthy pet', () => {
  const c = mkGame(); assert.equal(PB.startWildEncounter(c.config, c.state, c.rng, c.p.id).noPet, true);
  give(c).fainted = true; assert.match(PB.startWildEncounter(c.config, c.state, c.rng, c.p.id).text, /fainted/);
});

function winWild(c, captureRoll, speciesId = 'tidepup') {
  PB.startWildEncounter(c.config, c.state, fixedRng([0.5]), c.p.id, { speciesId, levelDelta: 0 });
  const b = c.state.petBattle; b.turn = 'a'; b.b.hp = 1;
  return PB.petBattleAction(c.config, c.state, fixedRng([roll(19), 0.5, roll(captureRoll), 0.5, 0.5]), 'strike');
}

test('beating a wild pet: a good CHA roll befriends it at its level', () => {
  const c = mkGame(); const mine = give(c); mine.stats.cha = 14;                                                    // +2
  const r = winWild(c, 6);                                                                                          // 6 + 2 = DC 8 for a common
  assert.equal(r.finished, true); assert.deepEqual([c.state.petBattle.capture.ok, c.state.petBattle.capture.dc], [true, 8]);
  assert.equal(c.p.pets.length, 2); assert.deepEqual([c.p.pets[1].speciesId, c.p.pets[1].level, c.p.pets[1].hp], ['tidepup', 1, c.p.pets[1].hpMax]);
  assert.equal(PT.activePet(c.p).id, mine.id); assert.equal(events(c.state, 'PET_CAPTURE').length, 1);
  assert.notEqual(c.p.pets[1].id, mine.id);
});

test('a poor roll lets it slip away; rarer pets are harder; a natural 20 always works', () => {
  let c = mkGame(); give(c).stats.cha = 10; winWild(c, 7); assert.equal(c.p.pets.length, 1); assert.equal(c.state.petBattle.capture.ok, false);
  c = mkGame(); give(c).stats.cha = 10; winWild(c, 19, 'goldengoose'); assert.equal(c.p.pets.length, 1);            // 19 < DC 20
  c = mkGame(); give(c).stats.cha = 3; winWild(c, 20, 'goldengoose'); assert.equal(c.p.pets.length, 2);
  assert.deepEqual(Object.values(PB.CAPTURE_DC), [8, 11, 14, 17, 20]);
});

test('a full team cannot befriend another pet', () => {
  const c = mkGame(); give(c).stats.cha = 20; give(c); give(c);
  winWild(c, 20); assert.equal(c.p.pets.length, 3); assert.equal(c.state.petBattle.capture.full, true);
  assert.ok(c.state.petBattle.rewards.some(n => /No room/.test(n)));
});

test('losing to a wild pet: no capture, the pet faints, and it counts as a wild battle', () => {
  const c = mkGame(); give(c);
  PB.startWildEncounter(c.config, c.state, fixedRng([0.5]), c.p.id, { speciesId: 'tidepup', levelDelta: 0 });
  const b = c.state.petBattle; b.turn = 'b'; b.a.hp = 1;
  PB.runBossTurns(c.config, c.state, fixedRng([0.99, 0.99, 0.5, roll(19), 0.5]));
  assert.equal(b.winner, 'b'); assert.equal(c.p.pets.length, 1); assert.equal(c.p.pets[0].fainted, true); assert.equal(b.capture, undefined);
  const row = events(c.state, 'PET_BATTLE')[0]; assert.deepEqual([row.wild, row.won, row.boss], [true, false, false]);
});

test('pet goods: the egg hatches, the potion heals, the candy gives XP — all for Gold', () => {
  const c = mkGame(); c.p.balances.Gold = 1000;
  assert.equal(PT.buyPetGood(c.config, c.state, c.rng, c.p, 'potion').error, true);                                // nothing to use it on
  assert.equal(PT.buyPetGood(c.config, c.state, c.rng, c.p, 'egg').error, undefined); assert.equal(gold(c.p), 600); assert.equal(c.p.pets.length, 1);
  const pet = c.p.pets[0];
  assert.equal(PT.buyPetGood(c.config, c.state, c.rng, c.p, 'potion').error, true); assert.equal(gold(c.p), 600);  // already healthy → no charge
  pet.hp = 0; pet.fainted = true; PT.buyPetGood(c.config, c.state, c.rng, c.p, 'potion');
  assert.deepEqual([pet.fainted, pet.hp, gold(c.p)], [false, pet.hpMax, 500]);
  PT.buyPetGood(c.config, c.state, c.rng, c.p, 'candy'); assert.deepEqual([pet.level, pet.xp, gold(c.p)], [2, 10, 350]);
  assert.equal(events(c.state, 'SHOP_BUY_PET').length, 3);
});

test('pet goods: need the Gold, a known item, room on the team, and pets switched on', () => {
  const c = mkGame(); c.p.balances.Gold = 50;
  assert.match(PT.buyPetGood(c.config, c.state, c.rng, c.p, 'egg').text, /Need 400 Gold/);
  assert.equal(PT.buyPetGood(c.config, c.state, c.rng, c.p, 'sword').error, true);
  c.p.balances.Gold = 5000; give(c); give(c); give(c);
  assert.equal(PT.buyPetGood(c.config, c.state, c.rng, c.p, 'egg').error, true); assert.equal(gold(c.p), 5000);
  const off = mkGame(['A'], 1, (cfg) => { cfg.Pets.enabled = false; }); assert.equal(PT.buyPetGood(off.config, off.state, off.rng, off.p, 'egg').error, true);
});

test('a PetShop config tab replaces the price list', () => {
  const c = mkGame(['A'], 1, (cfg) => { cfg.PetShop = [{ id: 'egg', name: 'Bargain Egg', price: 10 }]; });
  PT.buyPetGood(c.config, c.state, c.rng, c.p, 'egg'); assert.equal(gold(c.p), 490); assert.equal(PT.petShop(c.config).length, 1);
});
