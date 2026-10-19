import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, mkGame, fixedRng, events, gold } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PB = await import('../../site/js/petbattle.js');
const ST = await import('../../site/js/stats.js');
const SND = await import('../../site/js/sound.js');

// A table where both players own a pet with fixed, known stats.
function arena({ aStats = {}, bStats = {}, aElement = 'Fire', bElement = 'Fire', tweak = null } = {}) {
  const c = mkGame(['Aj', 'Nick', 'Sam'], 3, tweak);
  const give = (player, element, stats) => {
    const pet = PT.hatchEgg(c.config, c.state, c.rng, player, { free: true, speciesId: 'emberfox' }).pet;
    pet.element = element; pet.stats = { str: 14, dex: 12, con: 12, int: 10, wis: 12, cha: 10, ...stats };
    pet.hpMax = PT.maxHp(pet.stats, pet.level); pet.hp = pet.hpMax; return pet;
  };
  const petA = give(c.p, aElement, aStats), petB = give(c.q, bElement, bStats);
  return { ...c, petA, petB };
}
// d20 rolls → rng values. roll(n) makes rng.int(1, 20) return n; die(n, sides) likewise for damage dice.
const roll = (n) => (n - 0.5) / 20, die = (n, sides) => (n - 0.5) / sides;
const pvp = (c, wager = 0, rng = fixedRng([roll(20), roll(1)])) => PB.startPetBattle(c.config, c.state, rng, { challengerId: c.p.id, opponentId: c.q.id, wager });
const use = (c, move, rolls) => PB.petBattleAction(c.config, c.state, fixedRng(rolls), move);

// ── Elements ──
test('element chart: the triangle, Electric, and the Shadow/Light feud', () => {
  const e = PB.effectiveness;
  assert.deepEqual([e('Fire', 'Grass'), e('Grass', 'Fire'), e('Water', 'Fire'), e('Fire', 'Water'), e('Grass', 'Water'), e('Water', 'Grass')], [1.5, 0.75, 1.5, 0.75, 1.5, 0.75]);
  assert.deepEqual([e('Electric', 'Water'), e('Water', 'Electric'), e('Grass', 'Electric'), e('Electric', 'Grass')], [1.5, 0.75, 1.5, 0.75]);
  assert.deepEqual([e('Shadow', 'Light'), e('Light', 'Shadow')], [1.5, 1.5]);
  assert.deepEqual([e('Fire', 'Fire'), e('Fire', 'Shadow'), e(null, 'Fire'), e('Fire', undefined)], [1, 1, 1, 1]);
});

test('the element multipliers are tunable (classic Pokémon ×2 / ×½ if you want it)', () => {
  const classic = { strongMult: 2, resistMult: 0.5 };
  assert.deepEqual([PB.effectiveness('Water', 'Fire', classic), PB.effectiveness('Fire', 'Water', classic)], [2, 0.5]);
});

test('every element is strong against something and weak to something', () => {
  for (const el of PT.ELEMENTS) {
    assert.ok(PT.ELEMENTS.some(o => PB.effectiveness(el, o) > 1), `${el} has no good match-up`);
    assert.ok(PT.ELEMENTS.some(o => PB.effectiveness(o, el) > 1), `nothing beats ${el}`);
  }
});

test('every pet knows four moves and its element move uses its better attacking stat', () => {
  const f = (stats) => PB.movesFor({ element: 'Water', stats, mends: 2 });
  assert.deepEqual(f({ str: 14, int: 10 }).map(m => m.id), ['strike', 'element', 'guard', 'mend']);
  assert.equal(f({ str: 14, int: 10 })[1].stat, 'str'); assert.equal(f({ str: 9, int: 15 })[1].stat, 'int');
  assert.equal(f({ str: 9, int: 15 })[1].name, 'Tidal Slam'); assert.equal(f({ str: 9, int: 15 })[1].element, 'Water');
});

// ── Starting a fight ──
test('a battle needs two healthy pets and two different players', () => {
  const c = arena();
  assert.match(PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.players[2].id, opponentId: c.q.id }).text, /no pet/);
  assert.match(PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, opponentId: c.players[2].id }).text, /no pet/);
  assert.equal(PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, opponentId: c.p.id }).error, true);
  assert.equal(PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, bossId: 'nope' }).error, true);
  c.petA.fainted = true; assert.match(pvp(c).text, /fainted/);
  c.petA.fainted = false; c.petB.hp = 0; assert.match(pvp(c).text, /fainted/);
  assert.equal(c.state.petBattle, undefined);
});

test('initiative: d20 + DEX mod decides who goes first; ties go to the higher DEX', () => {
  let c = arena(); pvp(c, 0, fixedRng([roll(5), roll(15)])); assert.equal(c.state.petBattle.turn, 'b');
  c = arena(); pvp(c, 0, fixedRng([roll(15), roll(5)])); assert.equal(c.state.petBattle.turn, 'a');
  c = arena({ bStats: { dex: 16 } }); pvp(c, 0, fixedRng([roll(12), roll(10)]));          // 12+1 vs 10+3 → tie → B has more DEX
  assert.deepEqual(c.state.petBattle.initiative, { a: 13, b: 13 }); assert.equal(c.state.petBattle.turn, 'b');
});

test('only one battle at a time; the fighters are copies of the pets', () => {
  const c = arena(); pvp(c);
  assert.match(pvp(c).text, /already running/);
  c.state.petBattle.a.hp = 1; assert.equal(c.petA.hp, c.petA.hpMax);                     // the real pet is untouched until the end
  assert.equal(c.state.petBattle.a.ac, PT.armorClass(c.petA)); assert.equal(events(c.state, 'PET_BATTLE_START').length, 1);
});

// ── To-hit and damage ──
test('an attack hits when d20 + proficiency + mod meets the AC', () => {
  const c = arena(); pvp(c);                                   // A first. A: STR 14 (+2), prof 2 → +4. B: AC 11.
  assert.match(use(c, 'strike', [roll(6), die(4, 8)]).text, /rolls 6\+4 vs AC 11: MISS/);
  use(c, 'guard', [0]);                                        // B's turn — pass it
  const hp = c.state.petBattle.b.hp;
  assert.match(use(c, 'strike', [roll(9), die(4, 8)]).text, /rolls 9\+4 vs AC 13: hit for 6/);           // B guarded: AC 11+2; 4 + STR mod 2
  assert.equal(c.state.petBattle.b.hp, hp - 6);
});

test('a natural 1 always misses and a natural 20 always crits with doubled dice', () => {
  const c = arena({ aStats: { str: 24 }, bStats: { dex: 30 } }); pvp(c);                 // huge bonus, absurd AC
  assert.match(use(c, 'strike', [roll(1), die(8, 8)]).text, /MISS/);
  use(c, 'guard', [0]);
  const hp = c.state.petBattle.b.hp;
  const r = use(c, 'strike', [roll(20), die(8, 8), die(8, 8)]);
  assert.match(r.text, /CRITICAL HIT for 23/);                                           // 8+8 dice + STR mod 7
  assert.equal(c.state.petBattle.b.hp, Math.max(0, hp - 23));
});

test('element moves hit harder against a weak element, softer against a resistant one, and always do at least 1', () => {
  let c = arena({ aElement: 'Water', bElement: 'Fire' }); pvp(c);
  assert.match(use(c, 'element', [roll(15), die(5, 10)]).text, /hit for 10 \(super effective!\)/);       // floor((5 + 2) × 1.5)
  c = arena({ aElement: 'Fire', bElement: 'Water' }); pvp(c);
  assert.match(use(c, 'element', [roll(15), die(5, 10)]).text, /hit for 5 \(resisted\)/);                // floor(7 × 0.75)
  c = arena({ aElement: 'Fire', bElement: 'Water', aStats: { str: 3, int: 3 } }); pvp(c);
  assert.match(use(c, 'element', [roll(20), die(1, 10), die(1, 10)]).text, /for 1 /);                    // floor((2 + 0) × 0.75) = 1
});

test('Strike is never typed: no element bonus or penalty', () => {
  const c = arena({ aElement: 'Water', bElement: 'Fire' }); pvp(c);
  assert.match(use(c, 'strike', [roll(15), die(5, 8)]).text, /hit for 7\./);
});

test('Guard adds 2 AC up to +4; Mend heals with WIS, twice per fight, never above max', () => {
  const c = arena({ aStats: { wis: 16 } }); pvp(c);
  use(c, 'guard', [0]); use(c, 'guard', [0]); use(c, 'guard', [0]); use(c, 'guard', [0]);              // A, B, A, B
  assert.equal(c.state.petBattle.a.guard, 4); assert.equal(use(c, 'guard', [0]).error, true);
  assert.equal(c.state.petBattle.turn, 'a');                                                            // a refused move does not pass the turn
  assert.equal(use(c, 'mend', [die(8, 8)]).error, true);                                                // full health
  c.state.petBattle.a.hp = 1;
  assert.match(use(c, 'mend', [die(5, 8)]).text, /mends 8 HP/); use(c, 'strike', [roll(1)]);            // 5 + WIS mod 3; B whiffs
  c.state.petBattle.a.hp = c.state.petBattle.a.hpMax - 2;
  assert.match(use(c, 'mend', [die(8, 8)]).text, /mends 2 HP/); use(c, 'strike', [roll(1)]);            // capped at max
  c.state.petBattle.a.hp = 1; assert.equal(use(c, 'mend', [die(8, 8)]).error, true);                    // none left
});

test('turns alternate and the round counter advances every two moves', () => {
  const c = arena(); pvp(c); const b = c.state.petBattle;
  assert.deepEqual([b.turn, b.round], ['a', 1]);
  use(c, 'guard', [0]); assert.deepEqual([b.turn, b.round], ['b', 1]);
  use(c, 'guard', [0]); assert.deepEqual([b.turn, b.round], ['a', 2]);
  assert.equal(use(c, 'dance', [0]).error, true);
});

// ── Ending a fight ──
test('a knockout ends the fight: HP, record and XP are written back to the real pets', () => {
  const c = arena(); pvp(c); c.state.petBattle.b.hp = 3;
  const r = use(c, 'strike', [roll(15), die(6, 8), 0, 0]);
  assert.equal(r.finished, true); assert.equal(r.winner, 'a');
  const b = c.state.petBattle; assert.deepEqual([b.phase, b.winner], ['done', 'a']);
  assert.deepEqual([c.petB.hp, c.petB.fainted, c.petB.losses, c.petA.wins, c.petA.fainted], [0, true, 1, 1, false]);
  assert.equal(c.petA.xp, 26); assert.equal(c.petB.xp, 10);                                             // 20 + 6×level 1, and 10 for losing
  const row = events(c.state, 'PET_BATTLE')[0];
  assert.deepEqual([row.playerId, row.won, row.boss, row.kind], [c.p.id, true, false, 'pvp']);
  assert.equal(use(c, 'strike', [roll(10)]).error, true);                                               // it's over
});

test('PvP wager: the winner takes the loser\'s Gold; no wager moves nothing', () => {
  let c = arena(); pvp(c, 200); c.state.petBattle.b.hp = 1; use(c, 'strike', [roll(15), die(6, 8), 0, 0]);
  assert.deepEqual([gold(c.p), gold(c.q)], [700, 300]);
  c = arena(); pvp(c, 0); c.state.petBattle.b.hp = 1; use(c, 'strike', [roll(15), die(6, 8), 0, 0]);
  assert.deepEqual([gold(c.p), gold(c.q)], [500, 500]);
});

test('a fight that runs out of rounds goes to the pet in better shape', () => {
  const c = arena({ tweak: (cfg) => { cfg.PetBattle.maxRounds = 2; } }); pvp(c);
  c.state.petBattle.a.hp = 5; let r;
  for (let i = 0; i < 4; i++) r = use(c, 'strike', [roll(1)]);                                          // four misses = two rounds
  assert.equal(r.finished, true); assert.equal(c.state.petBattle.winner, 'b'); assert.match(c.state.petBattle.log.at(-1).text, /Time!/);
  assert.equal(c.petA.fainted, false); assert.equal(c.petA.hp, 5);
});

// ── Bosses ──
test('five built-in bosses, ordered by level, each with more HP than a pet of that level', () => {
  const list = PB.DEFAULT_BOSSES; assert.equal(list.length, 5);
  assert.deepEqual(list.map(b => b.level), list.map(b => b.level).slice().sort((a, b) => a - b));
  for (const boss of list) { const f = PB.previewFighter({}, { bossId: boss.id }); assert.equal(f.hpMax, Math.round(PT.maxHp(boss.stats, boss.level) * 1.1)); assert.ok(f.isBoss && boss.rewardGold > 0); }
  assert.equal(PB.bossList({ PetBosses: [{ id: 'x' }] }).length, 1);
});

test('beating a boss pays its Gold reward and earns boss Power; the boss gets no XP or record', () => {
  const c = arena(); const R = PT.petRules(c.config);
  PB.startPetBattle(c.config, c.state, fixedRng([roll(20), roll(1)]), { challengerId: c.p.id, bossId: 'sewerking' });
  const b = c.state.petBattle; assert.equal(b.kind, 'boss'); assert.equal(b.turn, 'a'); b.b.hp = 1;
  use(c, 'strike', [roll(18), die(6, 8), 0, 0]);
  assert.equal(gold(c.p), 650); assert.equal(c.petA.wins, 1);
  assert.equal(c.petA.xp, 32);                                                                          // 20 + 6 × boss level 2
  const before = PT.powerOf(c.p); PT.accruePower(c.config, c.state); assert.equal(PT.powerOf(c.p) - before, R.gain.bossWin);
});

test('losing to a boss costs no Gold, faints the pet, and logs a loss with no winner player', () => {
  const c = arena(); PB.startPetBattle(c.config, c.state, fixedRng([roll(1), roll(20)]), { challengerId: c.p.id, bossId: 'housedragon' });
  const b = c.state.petBattle; assert.equal(b.turn, 'b'); b.a.hp = 1;
  const outs = PB.runBossTurns(c.config, c.state, fixedRng([0.99, 0.99, 0.5, roll(19), die(5, 10)]));   // not low, no guard, element, hit
  assert.equal(outs.at(-1).finished, true); assert.equal(b.winner, 'b');
  assert.deepEqual([c.petA.fainted, c.petA.losses, gold(c.p)], [true, 1, 500]);
  const row = events(c.state, 'PET_BATTLE')[0]; assert.deepEqual([row.playerId, row.won, row.boss], [null, false, true]);
  const before = PT.powerOf(c.p); PT.accruePower(c.config, c.state); assert.equal(PT.powerOf(c.p), before);
});

test('boss AI: mends when badly hurt, otherwise attacks; never an illegal move', () => {
  const c = arena(); PB.startPetBattle(c.config, c.state, fixedRng([roll(1), roll(20)]), { challengerId: c.p.id, bossId: 'krakenjr' });
  const b = c.state.petBattle;
  b.b.hp = Math.floor(b.b.hpMax * 0.2); assert.equal(PB.bossChoice(b, fixedRng([0.1])), 'mend');
  b.b.mends = 0; assert.ok(['element', 'strike', 'guard'].includes(PB.bossChoice(b, fixedRng([0.1]))));
  b.b.hp = b.b.hpMax; assert.equal(PB.bossChoice(b, fixedRng([0.99, 0.5])), 'element'); assert.equal(PB.bossChoice(b, fixedRng([0.99, 0.9])), 'strike');
});

test('runBossTurns plays exactly the boss\'s turn and hands back to the player', () => {
  const c = arena(); PB.startPetBattle(c.config, c.state, fixedRng([roll(1), roll(20)]), { challengerId: c.p.id, bossId: 'sewerking' });
  assert.equal(PB.runBossTurns(c.config, c.state, c.rng).length, 1); assert.equal(c.state.petBattle.turn, 'a');
  assert.equal(PB.runBossTurns(c.config, c.state, c.rng).length, 0);                                    // not the boss's turn
});

test('whole fights against every boss always finish, and a same-level pet wins a fair share overall', () => {
  let wins = 0, fights = 0;
  for (const boss of PB.DEFAULT_BOSSES) for (const speciesId of ['emberfox', 'tidepup', 'gloomcat', 'boulderox']) {
    for (let i = 0; i < 40; i++) {
      const c = mkGame(['A', 'B'], 1000 + i); const pet = PT.hatchEgg(c.config, c.state, c.rng, c.p, { free: true, speciesId }).pet;
      PT.addXp(c.config, c.state, c.rng, c.p, pet, 50 * boss.level * (boss.level - 1) / 2);              // same level as the boss
      pet.hp = pet.hpMax;
      PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, bossId: boss.id }); PB.runBossTurns(c.config, c.state, c.rng);
      let guard = 0;
      while (c.state.petBattle.phase === 'active' && guard++ < 200) {
        const me = c.state.petBattle.a; const mv = me.hp / me.hpMax < 0.4 && me.mends > 0 ? 'mend' : 'element';
        PB.petBattleAction(c.config, c.state, c.rng, mv); PB.runBossTurns(c.config, c.state, c.rng);
      }
      assert.equal(c.state.petBattle.phase, 'done', `${boss.id} vs ${speciesId} #${i} never ended`);
      assert.ok(c.state.petBattle.round <= PB.BATTLE_DEFAULTS.maxRounds + 1);
      fights++; if (c.state.petBattle.winner === 'a') wins++;
    }
  }
  assert.ok(wins / fights > 0.2 && wins / fights < 0.7, `overall same-level win rate vs bosses: ${wins / fights}`);
});

// ── Glue ──
test('matchup odds favour the stronger, well-typed pet and sum to 1', () => {
  const c = arena({ aElement: 'Water', bElement: 'Fire' });
  const a = PB.previewFighter(c.config, { player: c.p }), b = PB.previewFighter(c.config, { player: c.q });
  const m = PB.matchup(a, b); assert.ok(Math.abs(m.a + m.b - 1) < 1e-9); assert.ok(m.a > 0.6);
  assert.equal(PB.previewFighter(c.config, { player: c.players[2] }), null);
});

test('aborting clears the battle without touching the pets', () => {
  const c = arena(); pvp(c, 300); c.state.petBattle.a.hp = 1;
  assert.equal(PB.clearPetBattle(c.state), true); assert.equal(c.state.petBattle, null);
  assert.equal(c.petA.hp, c.petA.hpMax); assert.equal(gold(c.p), 500); assert.equal(PB.clearPetBattle(c.state), false);
});

test('stats count pet battles and award the Beastmaster', () => {
  const c = arena(); pvp(c); c.state.petBattle.b.hp = 1; use(c, 'strike', [roll(15), die(6, 8), 0, 0]);
  const st = ST.sessionStats(c.config, c.state);
  assert.equal(st.totals.petBattles, 1); assert.equal(st.players[c.p.id].petBattlesWon, 1);
  assert.equal(st.awards.find(a => a.key === 'beastmaster').name, 'Aj');
});

test('sound: a battle opens with a sting, hits and crits have their own cues, and the win gets a fanfare', () => {
  const c = arena(); let prev = structuredClone(c.state); pvp(c);
  assert.ok(SND.cuesFor(prev, c.state).some(x => x.cue === 'battle'));
  prev = structuredClone(c.state); use(c, 'strike', [roll(20), die(4, 8), die(4, 8)]);
  assert.ok(SND.cuesFor(prev, c.state).some(x => x.cue === 'explode'));
  prev = structuredClone(c.state); c.state.petBattle.a.hp = 1; use(c, 'strike', [roll(18), die(8, 8), 0, 0]);
  assert.ok(SND.cuesFor(prev, c.state).some(x => x.cue === 'fanfare'));
});
