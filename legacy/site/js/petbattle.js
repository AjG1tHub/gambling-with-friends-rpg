// Pet battles (Phase 7) — the D&D / Pokémon-style fights. Turn based, d20 driven:
//   to hit:  d20 + proficiency + ability mod  ≥  target AC (+ Guard)     natural 1 misses, natural 20 crits
//   damage:  move dice (+ ability mod), dice doubled on a crit, ×2 / ×½ for element match-ups, minimum 1
// Two kinds of fight share one engine: a BOSS fight (player's pet vs a boss, for Gold + Power) and
// PvP (two players' pets, optional Gold pot). The battle lives in state.petBattle so the shared
// screen can show it; the pets themselves are only written back (HP, XP, record) when it ends.
import { log, credit, bal } from './state.js';
import { mod, proficiency, armorClass, maxHp, activePet, petsOf, addXp, STATS, rollPet, pickSpecies, speciesOf, petRules, itemBonus, itemDef, addItem, PET_ITEMS } from './pets.js';

// att → the elements it hits for double damage. The reverse match-up is halved.
export const STRONG = { Fire: ['Grass'], Grass: ['Water', 'Electric'], Water: ['Fire'], Electric: ['Water'], Shadow: ['Light'], Light: ['Shadow'] };
// Returns the damage multiplier. `rules` supplies the tunables (default ×1.5 strong / ×0.75 resisted —
// a straight Pokémon ×2 / ×½ made match-ups a foregone conclusion in testing).
export function effectiveness(att, def, rules = BATTLE_DEFAULTS) {
  if (!att || !def) return 1;
  const strong = (STRONG[att] || []).includes(def), resisted = (STRONG[def] || []).includes(att);
  return strong ? Number(rules.strongMult ?? 1.5) : resisted ? Number(rules.resistMult ?? 0.75) : 1;   // Shadow ↔ Light: strong both ways
}

// ── Status effects ───────────────────────────────────────────────
// An element move that hits forces a WIS save: d20 + target WIS mod vs DC 8 + attacker proficiency +
// attacker's attack-stat mod. Fail and the element's status sticks (one status at a time; Mend cures it).
export const STATUS = {
  burn:  { element: 'Fire',     icon: '🔥', name: 'Burned',  turns: 3, desc: 'takes 1d4 at the start of each of its turns' },
  soak:  { element: 'Water',    icon: '💧', name: 'Soaked',  turns: 3, desc: '−2 AC' },
  root:  { element: 'Grass',    icon: '🌿', name: 'Rooted',  turns: 3, desc: '−2 to hit' },
  shock: { element: 'Electric', icon: '⚡', name: 'Shocked', turns: 1, desc: 'loses its next turn (once per fight)' },
  blind: { element: 'Shadow',   icon: '🌑', name: 'Blinded', turns: 2, desc: '−3 to hit' },
};
export const statusFor = (element) => Object.entries(STATUS).find(([, v]) => v.element === element)?.[0] || null;
export const LIGHT_DRAIN = 0.25;      // Light has no status: Radiant Beam heals the user for a quarter of the damage
export const saveDc = (attacker, stat) => 8 + proficiency(attacker.level) + mod(attacker.stats[stat]);
const acOf = (f) => f.ac + f.guard - (f.status?.id === 'soak' ? 2 : 0);
const hitPenalty = (f) => f.status?.id === 'root' ? 2 : f.status?.id === 'blind' ? 3 : 0;
export const effectiveAc = acOf;

const ELEMENT_MOVE = {
  Fire: { name: 'Ember Burst', icon: '🔥' }, Water: { name: 'Tidal Slam', icon: '🌊' }, Grass: { name: 'Vine Lash', icon: '🌿' },
  Electric: { name: 'Thunder Jolt', icon: '⚡' }, Shadow: { name: 'Night Claw', icon: '🌑' }, Light: { name: 'Radiant Beam', icon: '✨' },
};
// Every pet knows four moves: a plain physical hit, its element's signature move, Guard and Mend.
export function movesFor(fighter) {
  const em = ELEMENT_MOVE[fighter.element] || { name: 'Wild Surge', icon: '💥' };
  const best = fighter.stats.str >= fighter.stats.int ? 'str' : 'int';
  return [
    { id: 'strike', name: 'Strike', icon: '👊', kind: 'attack', stat: 'str', dice: [1, 8], element: null, desc: 'Physical hit (STR)' },
    { id: 'element', name: em.name, icon: em.icon, kind: 'attack', stat: best, dice: [1, 10], element: fighter.element, desc: `${fighter.element} attack (${best.toUpperCase()}) — bonus damage vs weak elements, reduced vs resistant. ${fighter.element === 'Light' ? 'Heals you for 25% of the damage.' : STATUS[statusFor(fighter.element)] ? `May leave the target ${STATUS[statusFor(fighter.element)].name.toLowerCase()} (${STATUS[statusFor(fighter.element)].desc}).` : ''}` },
    { id: 'guard', name: 'Guard', icon: '🛡️', kind: 'guard', desc: '+2 AC for the rest of the fight (max +4)' },
    { id: 'mend', name: 'Mend', icon: '💚', kind: 'mend', desc: `Heal 1d8 + WIS (${fighter.mends} left)` },
  ];
}

export const DEFAULT_BOSSES = [
  { id: 'sewerking',  name: 'The Sewer King',   emoji: '🐀', element: 'Shadow',   level: 2,  stats: { str: 12, dex: 14, con: 12, int: 8,  wis: 10, cha: 8  }, rewardGold: 150 },
  { id: 'dunestinger', name: 'Dune Stinger',    emoji: '🦂', element: 'Fire',     level: 4,  stats: { str: 15, dex: 13, con: 14, int: 9,  wis: 11, cha: 8  }, rewardGold: 300 },
  { id: 'krakenjr',   name: 'Kraken Jr.',       emoji: '🐙', element: 'Water',    level: 6,  stats: { str: 16, dex: 12, con: 16, int: 13, wis: 12, cha: 10 }, rewardGold: 500 },
  { id: 'bridgetroll', name: 'The Bridge Troll', emoji: '🧌', element: 'Grass',   level: 9,  stats: { str: 19, dex: 9,  con: 18, int: 8,  wis: 10, cha: 7  }, rewardGold: 800 },
  { id: 'housedragon', name: 'The House Dragon', emoji: '🐲', element: 'Fire',    level: 13, stats: { str: 20, dex: 14, con: 18, int: 17, wis: 15, cha: 18 }, rewardGold: 1500 },
];
export function bossList(config) { const b = config?.PetBosses; return Array.isArray(b) && b.length ? b : DEFAULT_BOSSES; }
export const BATTLE_DEFAULTS = { maxRounds: 30, bossHpScale: 1.1, strongMult: 1.5, resistMult: 0.75, winXpBase: 20, winXpPerLevel: 6, loseXp: 10, minWager: 0, dropChance: 0.3 };
export const battleRules = (config) => ({ ...BATTLE_DEFAULTS, ...(config?.PetBattle || {}) });

export function fighterFromPet(player, pet) {
  return { side: null, playerId: player.id, petId: pet.id, speciesId: pet.speciesId, stage: pet.stage || 0, rarity: pet.rarity, name: pet.name, owner: player.name, emoji: pet.emoji, element: pet.element, level: pet.level,
    stats: { ...pet.stats }, hpMax: pet.hpMax, hp: pet.hp, ac: armorClass(pet) + itemBonus(pet, 'ac'), guard: 0, mends: 2, isBoss: false, item: pet.item || null };
}
export function fighterFromBoss(config, boss) {
  const hpMax = Math.round(maxHp(boss.stats, boss.level) * battleRules(config).bossHpScale);
  return { side: null, playerId: null, petId: null, bossId: boss.id, name: boss.name, owner: 'BOSS', emoji: boss.emoji, element: boss.element, level: boss.level,
    stats: { ...boss.stats }, hpMax, hp: hpMax, ac: armorClass(boss), guard: 0, mends: 1, isBoss: true, rewardGold: Number(boss.rewardGold) || 0 };
}
export const d = (rng, sides) => rng.int(1, sides);
export const say = (b, text, extra = {}) => { b.log.push({ text, round: b.round, ...extra }); if (b.log.length > 40) b.log.shift(); };
export const currentFighter = (b) => b[b.turn];
export const otherFighter = (b) => b[b.turn === 'a' ? 'b' : 'a'];

// opts: { challengerId, bossId } or { challengerId, opponentId, wager } (Gold each, winner takes both).
export function startPetBattle(config, state, rng, opts) {
  if ((state.petBattle && state.petBattle.phase === 'active') || (state.raid && state.raid.phase === 'active')) return { error: true, text: 'A pet battle is already running.' };
  const R = battleRules(config);
  const pa = state.players.find(p => p.id === opts.challengerId); if (!pa) return { error: true, text: 'Pick a challenger.' };
  const petA = activePet(pa); if (!petA) return { error: true, text: `${pa.name} has no pet. Hatch an egg first.` };
  if (petA.fainted || petA.hp <= 0) return { error: true, text: `${petA.name} has fainted — heal it first.` };
  let a = fighterFromPet(pa, petA), b, kind, wager = 0;
  if (opts.bossId) {
    const boss = bossList(config).find(x => x.id === opts.bossId); if (!boss) return { error: true, text: 'No such boss.' };
    b = fighterFromBoss(config, boss); kind = 'boss';
  } else {
    const pb = state.players.find(p => p.id === opts.opponentId);
    if (!pb || pb.id === pa.id) return { error: true, text: 'Pick a different opponent.' };
    const petB = activePet(pb); if (!petB) return { error: true, text: `${pb.name} has no pet.` };
    if (petB.fainted || petB.hp <= 0) return { error: true, text: `${petB.name} has fainted — heal it first.` };
    wager = Math.max(0, Math.round(Number(opts.wager) || 0));
    if (wager < R.minWager) return { error: true, text: `Minimum pet-battle wager is ${R.minWager} Gold.` };
    b = fighterFromPet(pb, petB); kind = 'pvp';
  }
  a.side = 'a'; b.side = 'b';
  // Initiative: d20 + DEX mod, ties to the higher DEX, then to the challenger
  const ia = d(rng, 20) + mod(a.stats.dex), ib = d(rng, 20) + mod(b.stats.dex);
  const first = ia > ib || (ia === ib && a.stats.dex >= b.stats.dex) ? 'a' : 'b';
  state.petBattleSeq = (state.petBattleSeq || 0) + 1;
  const battle = { id: 'pb' + state.petBattleSeq, kind, a, b, turn: first, round: 1, phase: 'active', winner: null, wager, log: [], startedTs: Date.now(), initiative: { a: ia, b: ib } };
  say(battle, `${a.emoji} ${a.name} (${a.owner}) vs ${b.emoji} ${b.name}${kind === 'pvp' ? ` (${b.owner})` : ''}!`, { kind: 'start' });
  say(battle, `Initiative: ${a.name} ${ia}, ${b.name} ${ib} — ${battle[first].name} goes first.`, { kind: 'info' });
  state.petBattle = battle;
  log(state, 'PET_BATTLE_START', pa.id, { battleId: battle.id, kind, vs: kind === 'boss' ? b.bossId : b.playerId, wager });
  return { battle, text: battle.log[0].text };
}

// ── Wild encounters ──────────────────────────────────────────────
// A wild pet of about your pet's level jumps out. Beat it and your pet tries to befriend it:
// d20 + your pet's CHA mod vs a DC set by rarity. Success (and room on the team) = it joins you.
export const CAPTURE_DC = { common: 8, uncommon: 11, rare: 14, epic: 17, legendary: 20 };
export function startWildEncounter(config, state, rng, challengerId, opts = {}) {
  if (state.petBattle && state.petBattle.phase === 'active') return { error: true, text: 'A pet battle is already running.' };
  const pa = state.players.find(p => p.id === challengerId); if (!pa) return { error: true, text: 'Pick a player.' };
  const petA = activePet(pa);
  if (!petA) return { error: true, text: `${pa.name} has no pet — the wild creature loses interest.`, noPet: true };
  if (petA.fainted || petA.hp <= 0) return { error: true, text: `${petA.name} has fainted — heal it first.` };
  const species = opts.speciesId ? speciesOf(config, opts.speciesId) : pickSpecies(config, rng);
  const wild = rollPet(config, { petSeq: 0 }, rng, species, `Wild ${species.name}`);           // not owned yet: no real pet id
  const level = Math.max(1, petA.level + (opts.levelDelta ?? rng.int(-1, 1)));
  for (let l = 2; l <= level; l++) { const k = species.grow[(l - 2) % species.grow.length]; wild.stats[k] = Math.min(24, wild.stats[k] + 1); }
  let stage = 0; for (const ev of species.evolves || []) if (level >= ev.level) { stage++; for (const k of species.grow) wild.stats[k] = Math.min(24, wild.stats[k] + 2); }
  const form = stage ? species.evolves[stage - 1] : species;
  wild.level = level; wild.hpMax = maxHp(wild.stats, level); wild.hp = wild.hpMax; wild.name = `Wild ${form.name}`;
  const a = fighterFromPet(pa, petA);
  const b = { side: 'b', playerId: null, petId: null, wild: { speciesId: species.id, stats: { ...wild.stats }, level, rarity: species.rarity, stage, formName: form.name, emoji: form.emoji }, speciesId: species.id, stage, rarity: species.rarity, name: wild.name, owner: 'WILD', emoji: form.emoji, element: species.element,
    level, stats: { ...wild.stats }, hpMax: wild.hpMax, hp: wild.hpMax, ac: armorClass(wild), guard: 0, mends: 1, isBoss: true, rewardGold: 0 };
  a.side = 'a';
  const ia = d(rng, 20) + mod(a.stats.dex), ib = d(rng, 20) + mod(b.stats.dex);
  const first = ia > ib || (ia === ib && a.stats.dex >= b.stats.dex) ? 'a' : 'b';
  state.petBattleSeq = (state.petBattleSeq || 0) + 1;
  const battle = { id: 'pb' + state.petBattleSeq, kind: 'wild', a, b, turn: first, round: 1, phase: 'active', winner: null, wager: 0, log: [], startedTs: Date.now(), initiative: { a: ia, b: ib } };
  say(battle, `A wild ${form.emoji} ${form.name} (level ${level}, ${species.rarity}) appears before ${pa.name}!`, { kind: 'start' });
  say(battle, `Initiative: ${a.name} ${ia}, ${b.name} ${ib} — ${battle[first].name} goes first.`, { kind: 'info' });
  state.petBattle = battle;
  log(state, 'PET_BATTLE_START', pa.id, { battleId: battle.id, kind: 'wild', vs: species.id, level });
  return { battle, text: battle.log[0].text };
}
function tryCapture(config, state, rng, battle, owner, notes) {
  const w = battle.b.wild; const pet = activePet(owner); const R = petRules(config);
  const dc = CAPTURE_DC[w.rarity] ?? 12, roll = d(rng, 20), bonus = mod((pet || battle.a).stats.cha) + itemBonus(pet, 'capture');
  const full = petsOf(owner).length >= R.maxPets;
  const ok = !full && (roll === 20 || (roll !== 1 && roll + bonus >= dc));
  battle.capture = { roll, bonus, dc, ok, full };
  if (ok) {
    const species = speciesOf(config, w.speciesId);
    state.petSeq = (state.petSeq || 0) + 1;
    const joined = { id: 'pet' + state.petSeq, speciesId: species.id, name: w.formName || species.name, emoji: w.emoji || species.emoji, stage: w.stage || 0, element: species.element, rarity: species.rarity,
      level: w.level, xp: 0, stats: { ...w.stats }, hpMax: maxHp(w.stats, w.level), hp: maxHp(w.stats, w.level), fainted: false, wins: 0, losses: 0 };
    petsOf(owner).push(joined);
    log(state, 'PET_CAPTURE', owner.id, { petId: joined.id, species: species.id, rarity: species.rarity, level: w.level });
    notes.push(`Befriended! (rolled ${roll}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc}) — ${species.emoji} ${species.name} joins ${owner.name}`);
    say(battle, `💞 ${owner.name}'s charm works (${roll}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc}) — the wild ${species.name} joins the team!`, { kind: 'mend' });
  } else {
    notes.push(full ? `No room on the team — the wild ${battle.b.name.replace('Wild ', '')} wanders off` : `It slips away (rolled ${roll}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc})`);
    say(battle, full ? `${owner.name}'s team is full — it wanders off.` : `It slips away (${roll}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc}).`, { kind: 'info' });
  }
}

// One fighter uses one move on one target. Shared by 1-v-1 battles and raids. `b` only needs
// { log, round }. Returns { text } or { error, text } (an illegal move does not use up the turn).
export function execMove(b, R, rng, me, foe, moveId) {
  const move = movesFor(me).find(m => m.id === moveId); if (!move) return { error: true, text: 'Unknown move.' };
  let text;
  if (move.kind === 'guard') {
    if (me.guard >= 4) return { error: true, text: `${me.name} can't guard any harder.` };
    me.guard = Math.min(4, me.guard + 2); text = `${me.name} braces — AC ${me.ac + me.guard}.`; say(b, `${move.icon} ${text}`, { kind: 'guard', side: me.side });
  } else if (move.kind === 'mend') {
    if (me.mends <= 0) return { error: true, text: `${me.name} has no Mend left.` };
    if (me.hp >= me.hpMax && !me.status) return { error: true, text: `${me.name} is already at full health.` };
    const heal = me.hp >= me.hpMax ? 0 : Math.max(1, d(rng, 8) + mod(me.stats.wis) + Math.floor(me.level / 2)); const before = me.hp;
    me.hp = Math.min(me.hpMax, me.hp + heal); me.mends -= 1; const cured = me.status ? ` and shakes off ${STATUS[me.status.id].name.toLowerCase()}` : ''; me.status = null;
    text = `${me.name} mends ${me.hp - before} HP${cured}.`; say(b, `${move.icon} ${text}`, { kind: 'mend', side: me.side, amount: me.hp - before });
  } else {
    const roll = d(rng, 20), bonus = proficiency(me.level) + mod(me.stats[move.stat]) - hitPenalty(me) + itemBonus(me, 'hit'), targetAc = acOf(foe);
    const crit = roll === 20, hit = roll !== 1 && (crit || roll + bonus >= targetAc);
    if (!hit) { text = `${me.name} uses ${move.name} — rolls ${roll}${bonus >= 0 ? '+' : ''}${bonus} vs AC ${targetAc}: MISS.`; say(b, `${move.icon} ${text}`, { kind: 'miss', side: me.side, roll }); }
    else {
      let dice = 0; for (let i = 0; i < move.dice[0] * (crit ? 2 : 1); i++) dice += d(rng, move.dice[1]);
      const eff = effectiveness(move.element, foe.element, R);
      const dmg = Math.max(1, Math.floor((dice + Math.max(0, mod(me.stats[move.stat])) + Math.floor(me.level / 3)) * eff) + itemBonus(me, 'dmg'));
      foe.hp = Math.max(0, foe.hp - dmg);
      text = `${me.name} uses ${move.name} — rolls ${roll}${bonus >= 0 ? '+' : ''}${bonus} vs AC ${targetAc}: ${crit ? 'CRITICAL HIT' : 'hit'} for ${dmg}${eff > 1 ? ' (super effective!)' : eff < 1 ? ' (resisted)' : ''}.`;
      say(b, `${move.icon} ${text}`, { kind: crit ? 'crit' : 'hit', side: me.side, roll, dmg, eff });
      if (foe.item === 'berry' && !foe.berryUsed && foe.hp > 0 && foe.hp / foe.hpMax < 0.3) {
        const heal = Math.round(foe.hpMax * 0.3); foe.hp = Math.min(foe.hpMax, foe.hp + heal); foe.berryUsed = true;
        say(b, `🍓 ${foe.name} eats its Rally Berry: +${heal} HP.`, { kind: 'mend', side: foe.side, amount: heal });
      }
      if (move.element && foe.hp > 0) applyRider(b, rng, me, foe, move, dmg);
    }
  }
  return { text };
}

// The fighter whose turn it is uses a move. Returns { text, finished? }.
export function petBattleAction(config, state, rng, moveId) {
  const b = state.petBattle; if (!b || b.phase !== 'active') return { error: true, text: 'No pet battle is running.' };
  const R = battleRules(config), me = currentFighter(b), foe = otherFighter(b);
  const ex = execMove(b, R, rng, me, foe, moveId); if (ex.error) return ex;
  const text = ex.text;
  b.lastActionTs = Date.now();
  if (foe.hp <= 0) return { text, finished: true, ...finishPetBattle(config, state, rng, me.side, `${foe.name} faints!`) };
  // the acting fighter's status wears down at the end of its own turn
  if (me.status && me.status.id !== 'shock') { me.status.turns -= 1; if (me.status.turns <= 0) { say(b, `${me.name} is no longer ${STATUS[me.status.id].name.toLowerCase()}.`, { kind: 'info' }); me.status = null; } }
  // next turn; a full round has passed after every two moves. Start-of-turn effects (burn, shock) resolve here.
  for (let pass = 0; pass < 2; pass++) {
    b.turn = b.turn === 'a' ? 'b' : 'a';
    b.moves = (b.moves || 0) + 1;
    if (b.moves % 2 === 0) b.round += 1;
    const up = b[b.turn], other = b[b.turn === 'a' ? 'b' : 'a'];
    if (up.status?.id === 'burn') {
      const burn = d(rng, 4); up.hp = Math.max(0, up.hp - burn);
      say(b, `🔥 ${up.name} takes ${burn} burn damage.`, { kind: 'hit', side: other.side, dmg: burn });
      if (up.hp <= 0) return { text, finished: true, ...finishPetBattle(config, state, rng, other.side, `${up.name} succumbs to the burn!`) };
    }
    if (up.status?.id === 'shock') { say(b, `⚡ ${up.name} is shocked and loses its turn!`, { kind: 'miss', side: up.side }); up.status = null; continue; }
    break;
  }
  if (b.round > R.maxRounds) {
    const pa = b.a.hp / b.a.hpMax, pb = b.b.hp / b.b.hpMax;
    return { text, finished: true, ...finishPetBattle(config, state, rng, pa >= pb ? 'a' : 'b', `Time! ${pa >= pb ? b.a.name : b.b.name} is in better shape.`) };
  }
  return { text };
}

// The element move's side effect (called only when it hits and the target is still standing).
function applyRider(b, rng, me, foe, move, dmg) {
  if (move.element === 'Light') {
    const heal = Math.min(me.hpMax - me.hp, Math.max(1, Math.floor(dmg * LIGHT_DRAIN)));
    if (heal > 0) { me.hp += heal; say(b, `✨ ${me.name} basks in the light: +${heal} HP.`, { kind: 'mend', side: me.side, amount: heal }); }
    return;
  }
  const id = statusFor(move.element); if (!id) return;
  if (id === 'shock' && foe.shockedOnce) return;                         // no stun-locking
  const save = d(rng, 20), bonus = mod(foe.stats.wis), dc = saveDc(me, move.stat);
  if (save === 20 || (save !== 1 && save + bonus >= dc)) { say(b, `${foe.name} resists (WIS save ${save}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc}).`, { kind: 'info' }); return; }
  foe.status = { id, turns: STATUS[id].turns }; if (id === 'shock') foe.shockedOnce = true;
  say(b, `${STATUS[id].icon} ${foe.name} is ${STATUS[id].name.toUpperCase()} — ${STATUS[id].desc} (WIS save ${save}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc}).`, { kind: 'status', side: me.side, status: id });
}

// What a boss does on its turn: patch itself up when low, otherwise mostly its signature move.
export function bossChoice(battle, rng) {
  const me = currentFighter(battle);
  if (me.hp / me.hpMax < 0.35 && me.mends > 0 && rng.chance(0.6)) return 'mend';
  if (me.status?.id === 'burn' && me.mends > 0 && me.hp < me.hpMax && rng.chance(0.3)) return 'mend';
  if (me.guard < 2 && rng.chance(0.12)) return 'guard';
  return rng.chance(0.65) ? 'element' : 'strike';
}
// Play the boss's turn(s) until it is a player's move again (or the fight ends).
export function runBossTurns(config, state, rng) {
  const out = []; let guard = 0;
  while (state.petBattle && state.petBattle.phase === 'active' && currentFighter(state.petBattle).isBoss && guard++ < 5) {
    let r = petBattleAction(config, state, rng, bossChoice(state.petBattle, rng));
    if (r.error) r = petBattleAction(config, state, rng, 'strike');
    out.push(r);
  }
  return out;
}

function finishPetBattle(config, state, rng, winnerSide, why) {
  const b = state.petBattle, R = battleRules(config);
  const win = b[winnerSide], lose = b[winnerSide === 'a' ? 'b' : 'a'];
  b.phase = 'done'; b.winner = winnerSide; b.endedTs = Date.now();
  say(b, `🏆 ${why} ${win.name} wins!`, { kind: 'end', side: winnerSide });
  const notes = [];
  // write the fight back onto the real pets
  for (const f of [win, lose]) {
    if (f.isBoss) continue;
    const owner = state.players.find(p => p.id === f.playerId); const pet = owner && petsOf(owner).find(p => p.id === f.petId);
    if (!pet) continue;
    pet.hp = Math.max(0, Math.min(pet.hpMax, f.hp)); pet.fainted = pet.hp <= 0;
    if (f === win) pet.wins = (pet.wins || 0) + 1; else pet.losses = (pet.losses || 0) + 1;
    const xp = f === win ? R.winXpBase + R.winXpPerLevel * lose.level : R.loseXp;
    const ups = addXp(config, state, rng, owner, pet, xp);
    notes.push(`${pet.name} +${xp} XP${ups.length ? ` → level ${pet.level}!` : ''}`);
  }
  if (b.kind === 'boss' && !win.isBoss && lose.rewardGold) {
    const owner = state.players.find(p => p.id === win.playerId);
    credit(state, owner, 'Gold', lose.rewardGold, `Defeated ${lose.name}`); notes.push(`${owner.name} +${lose.rewardGold} Gold`);
  }
  if (b.kind === 'boss' && !win.isBoss && rng.chance(Number(R.dropChance ?? 0.3))) {
    const owner = state.players.find(p => p.id === win.playerId); const ids = Object.keys(PET_ITEMS); const id = ids[rng.int(0, ids.length - 1)];
    addItem(state, owner, id, `dropped by ${lose.name}`); notes.push(`${lose.name} dropped ${itemDef(id).icon} ${itemDef(id).name}!`);
  }
  if (b.kind === 'wild' && !win.isBoss) tryCapture(config, state, rng, b, state.players.find(p => p.id === win.playerId), notes);
  if (b.kind === 'pvp' && b.wager > 0) {
    const w = state.players.find(p => p.id === win.playerId), l = state.players.find(p => p.id === lose.playerId);
    credit(state, l, 'Gold', -b.wager, 'Pet battle wager'); credit(state, w, 'Gold', b.wager, 'Pet battle pot'); notes.push(`${w.name} takes ${b.wager} Gold from ${l.name}`);
  }
  b.rewards = notes;
  // playerId = the winning PLAYER (null when the boss wins) so Power accrual and stats can key off it
  log(state, 'PET_BATTLE', win.isBoss ? null : win.playerId, { battleId: b.id, kind: b.kind, boss: b.kind === 'boss', wild: b.kind === 'wild', won: !win.isBoss,
    winner: win.name, loser: lose.name, loserPlayerId: lose.playerId || null, rounds: b.round, wager: b.wager });
  return { winner: winnerSide, notes, text2: `${win.name} wins. ${notes.join(' · ')}` };
}

// GM abort / clear. An unfinished fight just ends with no result written.
export function clearPetBattle(state) { const had = !!state.petBattle; state.petBattle = null; return had; }

// Rough odds for the setup screen: how the two sides compare on the numbers that matter.
export function matchup(a, b) {
  const score = (f, foe) => {
    const best = Math.max(f.stats.str, f.stats.int), atk = proficiency(f.level) + mod(best);
    const hitChance = Math.max(0.05, Math.min(0.95, (21 + atk - foe.ac) / 20));
    const eff = effectiveness(f.element, foe.element);
    return hitChance * (5.5 + Math.max(0, mod(best)) + Math.floor(f.level / 3)) * eff / foe.hpMax;       // share of foe HP per turn
  };
  const sa = score(a, b), sb = score(b, a);
  return { a: sa / (sa + sb), b: sb / (sa + sb) };
}
export const previewFighter = (config, { player, bossId }) => player ? (activePet(player) ? fighterFromPet(player, activePet(player)) : null) : (() => { const boss = bossList(config).find(x => x.id === bossId); return boss ? fighterFromBoss(config, boss) : null; })();
