import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, fixedRng } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PB = await import('../../site/js/petbattle.js');

function arena(aElement, bElement = 'Fire', aStats = {}, bStats = {}) {
  const c = mkGame(['Aj', 'Nick'], 3);
  const give = (player, element, stats) => { const pet = PT.hatchEgg(c.config, c.state, c.rng, player, { free: true, speciesId: 'emberfox' }).pet;
    pet.element = element; pet.stats = { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10, ...stats }; pet.hpMax = PT.maxHp(pet.stats, 1); pet.hp = pet.hpMax; return pet; };
  give(c.p, aElement, aStats); give(c.q, bElement, bStats);
  PB.startPetBattle(c.config, c.state, fixedRng([0.99, 0.01]), { challengerId: c.p.id, opponentId: c.q.id });    // A goes first
  return { ...c, b: c.state.petBattle };
}
const roll = (n) => (n - 0.5) / 20, die = (n, sides) => (n - 0.5) / sides;
const use = (c, move, rolls) => PB.petBattleAction(c.config, c.state, fixedRng(rolls), move);
// element move that hits (15), does `dmg` on the d10, then the target rolls `save` on its WIS save
const zap = (c, save, dmg = 3) => use(c, 'element', [roll(15), die(dmg, 10), roll(save), die(2, 4)]);

test('each element except Light has a status, and the save DC is 8 + proficiency + attack mod', () => {
  assert.deepEqual(['Fire', 'Water', 'Grass', 'Electric', 'Shadow', 'Light'].map(PB.statusFor), ['burn', 'soak', 'root', 'shock', 'blind', null]);
  assert.equal(PB.saveDc({ level: 1, stats: { str: 14 } }, 'str'), 12); assert.equal(PB.saveDc({ level: 9, stats: { int: 18 } }, 'int'), 16);
});

test('a failed WIS save applies the status; a made save or a natural 20 shrugs it off; a natural 1 always fails', () => {
  let c = arena('Fire'); zap(c, 11); assert.equal(c.b.b.status.id, 'burn');                         // 11 + 0 < DC 12
  c = arena('Fire'); zap(c, 12); assert.equal(c.b.b.status, undefined); assert.match(c.b.log.at(-1).text, /resists/);
  c = arena('Fire', 'Fire', {}, { wis: 3 }); zap(c, 20); assert.equal(c.b.b.status, undefined);      // nat 20 despite −4
  c = arena('Fire', 'Fire', {}, { wis: 30 }); zap(c, 1); assert.equal(c.b.b.status.id, 'burn');      // nat 1 despite +10
});

test('a missed attack and a plain Strike never apply a status', () => {
  const c = arena('Fire'); use(c, 'element', [roll(2), die(5, 10), roll(1)]); assert.equal(c.b.b.status, undefined);
  use(c, 'guard', [0]); use(c, 'strike', [roll(18), die(5, 8), roll(1)]); assert.equal(c.b.b.status, undefined);
});

test('burn: 1d4 at the start of the victim\'s turns, three times, then it wears off', () => {
  const c = arena('Fire'); c.b.b.hp = c.b.b.hpMax = 60; zap(c, 2);                                   // B burned; B's turn starts → takes 2
  assert.equal(c.b.b.hp, 60 - 5 - 2); assert.equal(c.b.turn, 'b');                                  // 3 + STR mod 2, then burn 2
  use(c, 'guard', [0]); assert.equal(c.b.b.status.turns, 2);
  use(c, 'guard', [die(3, 4)]); assert.equal(c.b.b.hp, 53 - 3);                                      // A guards (no dice); B's next turn starts with burn 3
  use(c, 'guard', [0]); use(c, 'strike', [roll(1), die(1, 4)]); use(c, 'strike', [roll(1)]);
  assert.equal(c.b.b.status, null); assert.match(c.b.log.map(l => l.text).join('|'), /no longer burned/);
});

test('burn can finish a fight — the win goes to the other side', () => {
  const c = arena('Fire'); c.b.b.hp = 7;                                                             // 5 damage leaves 2; burn 2 finishes it
  const r = zap(c, 2);
  assert.equal(r.finished, true); assert.equal(c.b.winner, 'a'); assert.match(c.b.log.at(-1).text, /succumbs to the burn/);
  assert.equal(c.q.pets[0].fainted, true);
});

test('soak lowers AC by 2', () => {
  const c = arena('Water', 'Grass'); zap(c, 2); assert.equal(c.b.b.status.id, 'soak');
  assert.equal(PB.effectiveAc(c.b.b), c.b.b.ac - 2);
  use(c, 'guard', [0]); assert.equal(PB.effectiveAc(c.b.b), c.b.b.ac);                               // +2 guard −2 soak
});

test('root and blind make the victim\'s attacks less accurate', () => {
  let c = arena('Grass', 'Fire'); zap(c, 2); assert.equal(c.b.b.status.id, 'root');
  assert.match(use(c, 'strike', [roll(8), die(4, 8)]).text, /rolls 8\+2 vs AC 11: MISS/);            // +4 −2
  c = arena('Shadow', 'Fire'); zap(c, 2); assert.equal(c.b.b.status.id, 'blind');
  assert.match(use(c, 'strike', [roll(9), die(4, 8)]).text, /rolls 9\+1 vs AC 11: MISS/);            // +4 −3
});

test('shock costs the victim its next turn, once per fight', () => {
  const c = arena('Electric', 'Fire'); c.b.b.hp = c.b.b.hpMax = 80;
  zap(c, 2); assert.equal(c.b.turn, 'a'); assert.match(c.b.log.at(-1).text, /shocked and loses its turn/);    // B skipped → A again
  assert.equal(c.b.b.status, null); assert.equal(c.b.b.shockedOnce, true);
  zap(c, 2); assert.equal(c.b.turn, 'b'); assert.equal(c.b.b.status, null);                          // no second stun
  assert.equal(c.b.round, 2);                                                                         // rounds still advance through the skip
});

test('Light heals the attacker for a quarter of the damage, never above max', () => {
  const c = arena('Light', 'Fire'); c.b.a.hp = 5;
  use(c, 'element', [roll(15), die(10, 10)]);                                                         // 10 + 2 = 12 damage → heal 3
  assert.equal(c.b.a.hp, 8); assert.equal(c.b.b.status, undefined);
  use(c, 'guard', [0]); c.b.a.hp = c.b.a.hpMax; use(c, 'element', [roll(15), die(10, 10)]); assert.equal(c.b.a.hp, c.b.a.hpMax);
});

test('Mend cures a status, even at full health', () => {
  const c = arena('Grass', 'Fire'); zap(c, 2); assert.equal(c.b.b.status.id, 'root');
  assert.match(use(c, 'mend', [die(4, 8)]).text, /shakes off rooted/); assert.equal(c.b.b.status, null); assert.equal(c.b.b.mends, 1);
});

test('a new status replaces the old one', () => {
  const c = arena('Fire', 'Fire'); c.b.b.status = { id: 'soak', turns: 3 };
  zap(c, 2); assert.equal(c.b.b.status.id, 'burn');
});

test('move descriptions tell the table what the element move can do', () => {
  const m = (element) => PB.movesFor({ element, stats: { str: 10, int: 12 }, mends: 2 })[1].desc;
  assert.match(m('Fire'), /burned/); assert.match(m('Electric'), /shocked/); assert.match(m('Light'), /Heals you/);
});

test('statuses never outlive the fight on the real pet', () => {
  const c = arena('Fire'); zap(c, 2); c.b.b.hp = 1; use(c, 'guard', [0]);
  use(c, 'strike', [roll(18), die(5, 8), 0, 0]);
  assert.equal(c.b.phase, 'done'); assert.equal(c.q.pets[0].status, undefined);
});
