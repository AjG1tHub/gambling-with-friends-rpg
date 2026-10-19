// Pets + Power Level (Phase 7) — the D&D / Pokémon-style side game.
//
// POWER LEVEL (⚡, 0–1,000 per player) is the side game's currency. It is EARNED by playing the
// main game (winning minigames, battles, surviving jail, simply taking turns) and SPENT on pets:
// hatching eggs, training (XP), reviving. It never converts to Gold and never counts toward
// the leaderboard total — it is a second, parallel progression.
//
// A PET is a creature with the six D&D ability scores. Everything a battle needs derives from them:
//   STR → physical attack + damage      INT → special attack + damage     CON → hit points
//   DEX → armour class + who goes first WIS → saves vs status, healing    CHA → taming / crowd bonus
// Pet: { id, speciesId, name, element, level, xp, stats{str,dex,con,int,wis,cha}, hpMax, hp, fainted, wins, losses }
import { log, credit, bal } from './state.js';

export const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ELEMENTS = ['Fire', 'Water', 'Grass', 'Electric', 'Shadow', 'Light'];
export const POWER_MAX = 1000;

export const PET_DEFAULTS = {
  enabled: true, maxPets: 3, eggCost: 100, reviveCost: 25, xpPerPower: 2, maxLevel: 20,
  // Power earned from main-game events (see accruePower)
  gain: { turn: 2, gameWin: 10, gameBigWin: 25, battleWin: 20, jailOut: 10, jailIn: 5, petBattleWin: 30, bossWin: 60, sessionStart: 50 },
  bigWinMult: 5,
};
export const petRules = (config) => { const r = config?.Pets || {}; return { ...PET_DEFAULTS, ...r, gain: { ...PET_DEFAULTS.gain, ...(r.gain || {}) } }; };

// Species: base = ability scores at level 1 before the roll; grow = which stats level-ups favour.
export const DEFAULT_SPECIES = [
  { id: 'emberfox',  name: 'Emberfox',  emoji: '🦊', element: 'Fire',     rarity: 'common',   base: { str: 12, dex: 14, con: 10, int: 12, wis: 9,  cha: 11 }, grow: ['dex', 'int'], evolves: [{ level: 8, name: 'Pyrewolf', emoji: '🐺' }, { level: 16, name: 'Solar Kitsune', emoji: '🦁' }] },
  { id: 'tidepup',   name: 'Tidepup',   emoji: '🦭', element: 'Water',    rarity: 'common',   base: { str: 11, dex: 10, con: 14, int: 11, wis: 12, cha: 10 }, grow: ['con', 'wis'], evolves: [{ level: 8, name: 'Surfseal', emoji: '🐬' }, { level: 16, name: 'Leviathan', emoji: '🐋' }] },
  { id: 'sprigbun',  name: 'Sprigbun',  emoji: '🐇', element: 'Grass',    rarity: 'common',   base: { str: 9,  dex: 13, con: 11, int: 10, wis: 13, cha: 12 }, grow: ['wis', 'dex'], evolves: [{ level: 8, name: 'Thornhare', emoji: '🦌' }, { level: 16, name: 'Elderstag', emoji: '🫎' }] },
  { id: 'zapmouse',  name: 'Zapmouse',  emoji: '🐭', element: 'Electric', rarity: 'common',   base: { str: 8,  dex: 15, con: 9,  int: 14, wis: 10, cha: 12 }, grow: ['dex', 'int'], evolves: [{ level: 8, name: 'Voltrat', emoji: '🐿️' }, { level: 16, name: 'Thunderlynx', emoji: '🐆' }] },
  { id: 'gloomcat',  name: 'Gloomcat',  emoji: '🐈‍⬛', element: 'Shadow',   rarity: 'uncommon', base: { str: 13, dex: 15, con: 10, int: 12, wis: 8,  cha: 12 }, grow: ['dex', 'str'], evolves: [{ level: 8, name: 'Shadeprowler', emoji: '🦝' }, { level: 16, name: 'Umbra Tiger', emoji: '🐅' }] },
  { id: 'dawnowl',   name: 'Dawnowl',   emoji: '🦉', element: 'Light',    rarity: 'uncommon', base: { str: 9,  dex: 12, con: 11, int: 14, wis: 15, cha: 10 }, grow: ['wis', 'int'], evolves: [{ level: 8, name: 'Suncrest', emoji: '🦩' }, { level: 16, name: 'Seraph Owl', emoji: '🕊️' }] },
  { id: 'boulderox', name: 'Boulderox', emoji: '🐂', element: 'Grass',    rarity: 'uncommon', base: { str: 16, dex: 8,  con: 15, int: 8,  wis: 10, cha: 9  }, grow: ['str', 'con'], evolves: [{ level: 8, name: 'Granitebull', emoji: '🦬' }, { level: 16, name: 'Mountain Titan', emoji: '🦣' }] },
  { id: 'stormhawk', name: 'Stormhawk', emoji: '🦅', element: 'Electric', rarity: 'rare',     base: { str: 14, dex: 16, con: 11, int: 13, wis: 11, cha: 12 }, grow: ['dex', 'str'], evolves: [{ level: 8, name: 'Squallwing', emoji: '🦜' }, { level: 16, name: 'Thunder Roc', emoji: '🦤' }] },
  { id: 'lavatoad',  name: 'Lavatoad',  emoji: '🐸', element: 'Fire',     rarity: 'rare',     base: { str: 13, dex: 9,  con: 16, int: 14, wis: 12, cha: 10 }, grow: ['con', 'int'], evolves: [{ level: 8, name: 'Magmander', emoji: '🦎' }, { level: 16, name: 'Calderasaur', emoji: '🦖' }] },
  { id: 'voidling',  name: 'Voidling',  emoji: '👾', element: 'Shadow',   rarity: 'epic',     base: { str: 14, dex: 14, con: 13, int: 16, wis: 12, cha: 13 }, grow: ['int', 'dex'], evolves: [{ level: 8, name: 'Riftstalker', emoji: '👽' }, { level: 16, name: 'Null Sovereign', emoji: '👹' }] },
  { id: 'sundrake',  name: 'Sundrake',  emoji: '🐉', element: 'Light',    rarity: 'epic',     base: { str: 16, dex: 12, con: 15, int: 14, wis: 13, cha: 14 }, grow: ['str', 'con'], evolves: [{ level: 8, name: 'Solar Wyrm', emoji: '🐲' }, { level: 16, name: 'Dawn Sovereign', emoji: '🦕' }] },
  { id: 'goldengoose', name: 'Golden Goose', emoji: '🪿', element: 'Light', rarity: 'legendary', base: { str: 12, dex: 13, con: 14, int: 15, wis: 16, cha: 18 }, grow: ['cha', 'wis'], evolves: [{ level: 8, name: 'Gilded Swan', emoji: '🦢' }, { level: 16, name: 'Aurum Phoenix', emoji: '🦚' }] },
];
export const RARITY_WEIGHT = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
export function speciesList(config) { const s = config?.PetSpecies; return Array.isArray(s) && s.length ? s : DEFAULT_SPECIES; }
export const speciesOf = (config, id) => speciesList(config).find(s => s.id === id) || null;

// ── D&D maths ────────────────────────────────────────────────────
export const mod = (score) => Math.floor((Number(score) - 10) / 2);
export const proficiency = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
export const xpToNext = (level) => 50 * level;                       // 50, 100, 150 …
export function maxHp(stats, level) { return Math.max(1, 10 + 2 * mod(stats.con) + level * (4 + Math.max(0, mod(stats.con)))); }
export const armorClass = (pet) => 10 + mod(pet.stats.dex) + Math.floor(pet.level / 5);
export const petPower = (pet) => STATS.reduce((s, k) => s + pet.stats[k], 0) + pet.level * 4;      // one-number strength, for matchmaking

// ── Power Level ──────────────────────────────────────────────────
// Trainer rank: a title earned from LIFETIME Power (spending never demotes you). Higher ranks
// hatch eggs cheaper and get more XP out of training.
export const RANKS = [
  { id: 'rookie',   name: 'Rookie',   icon: '🥚', earned: 0,    eggDiscount: 0,    xpBonus: 0 },
  { id: 'trainer',  name: 'Trainer',  icon: '🎒', earned: 250,  eggDiscount: 0.05, xpBonus: 0 },
  { id: 'ace',      name: 'Ace',      icon: '⭐', earned: 750,  eggDiscount: 0.10, xpBonus: 0.10 },
  { id: 'champion', name: 'Champion', icon: '🏅', earned: 1500, eggDiscount: 0.15, xpBonus: 0.20 },
  { id: 'legend',   name: 'Legend',   icon: '👑', earned: 3000, eggDiscount: 0.20, xpBonus: 0.30 },
];
export const powerEarned = (player) => Math.max(0, Math.round(player.powerEarned || 0));
export function rankOf(player) { const e = powerEarned(player); return [...RANKS].reverse().find(r => e >= r.earned) || RANKS[0]; }
export function nextRank(player) { const r = rankOf(player); return RANKS[RANKS.indexOf(r) + 1] || null; }
export const eggCostFor = (config, player) => Math.round(petRules(config).eggCost * (1 - rankOf(player).eggDiscount));

export const powerOf = (player) => Math.max(0, Math.min(POWER_MAX, Math.round(player.power || 0)));
export function gainPower(state, player, amount, why) {
  const before = powerOf(player); const after = Math.max(0, Math.min(POWER_MAX, before + Math.round(amount)));
  player.power = after;
  if (amount > 0 && why !== 'GM adjustment') {                  // lifetime total drives the trainer rank (counts even past the 1,000 cap)
    const was = rankOf(player); player.powerEarned = powerEarned(player) + Math.round(amount);
    const now = rankOf(player); if (now.id !== was.id) log(state, 'RANK_UP', player.id, { rank: now.id, name: now.name });
  }
  if (after !== before) log(state, 'POWER', player.id, { amount: after - before, power: after, why });
  return after - before;
}
export function spendPower(state, player, amount, why) {
  amount = Math.round(amount);
  if (!(amount > 0)) return { error: true, text: 'Nothing to spend.' };
  if (powerOf(player) < amount) return { error: true, text: `${player.name} needs ${amount} ⚡ and has ${powerOf(player)}.` };
  gainPower(state, player, -amount, why);
  return { spent: amount };
}

// Turn main-game ledger rows into Power. Idempotent: remembers the last row it has paid out for,
// so the GM window can call it after every action.
export function accruePower(config, state) {
  const R = petRules(config); if (!R.enabled) return 0;
  const from = state.powerSeq || 0; let last = from, total = 0;
  const rows = state.ledger.filter(r => r.n != null && r.n > from);
  for (const r of rows) {
    last = Math.max(last, r.n);
    const p = r.playerId ? state.players.find(x => x.id === r.playerId) : null;
    let amt = 0, why = '';
    switch (r.type) {
      case 'GAME': if (p && r.won === true) { const big = Number(r.mult) >= R.bigWinMult; amt = big ? R.gain.gameBigWin : R.gain.gameWin; why = big ? 'Big game win' : 'Game win'; } break;
      case 'BATTLE': if (p && r.won) { amt = R.gain.battleWin; why = 'Battle won'; } break;
      case 'JAIL_OUT': if (p) { amt = R.gain.jailOut; why = 'Out of jail'; } break;
      case 'JAIL_IN': if (p) { amt = R.gain.jailIn; why = 'Hard time'; } break;
      case 'PET_BATTLE': if (p && r.won) { amt = r.boss ? R.gain.bossWin : R.gain.petBattleWin; why = r.boss ? 'Boss defeated' : 'Pet battle won'; } break;
      case 'TURN_END': {                                              // the player who just finished a turn
        const order = state.turnOrder; if (!order.length || r.next == null) break;
        const who = state.players.find(x => x.id === order[(r.next - 1 + order.length * 1000) % order.length]);
        if (who) total += gainPower(state, who, R.gain.turn, 'Turn played');
        break;
      }
      case 'SESSION_START': for (const pl of state.players) total += gainPower(state, pl, R.gain.sessionStart, 'Session start'); break;
    }
    if (p && amt) total += gainPower(state, p, amt, why);
  }
  // rows we just logged ourselves (POWER) are newer than `last` — skip past them too
  state.powerSeq = Math.max(last, state.ledgerSeq || 0);
  return total;
}

// ── Pets ─────────────────────────────────────────────────────────
export const petsOf = (player) => player.pets || (player.pets = []);
export const activePet = (player) => petsOf(player).find(p => p.id === player.activePetId) || petsOf(player)[0] || null;

// Roll a level-1 pet of a species: each score = species base + (2d4 − 5), i.e. −3…+3 around the base.
export function rollPet(config, state, rng, species, name = null) {
  const stats = {};
  for (const k of STATS) stats[k] = Math.max(3, Math.min(20, Number(species.base[k]) + rng.int(1, 4) + rng.int(1, 4) - 5));
  state.petSeq = (state.petSeq || 0) + 1;
  const pet = { id: 'pet' + state.petSeq, speciesId: species.id, name: name || species.name, emoji: species.emoji, element: species.element, rarity: species.rarity,
    level: 1, xp: 0, stats, hpMax: 0, hp: 0, fainted: false, wins: 0, losses: 0 };
  pet.hpMax = maxHp(stats, 1); pet.hp = pet.hpMax;
  return pet;
}

export function pickSpecies(config, rng) {
  const list = speciesList(config).map(s => ({ ...s, weight: Number(RARITY_WEIGHT[s.rarity] ?? 10) }));
  const total = list.reduce((s, x) => s + x.weight, 0);
  let roll = rng.next() * total;
  for (const s of list) { roll -= s.weight; if (roll < 0) return speciesOf(config, s.id); }
  return speciesOf(config, list.at(-1).id);
}

// Hatch an egg: costs Power, random species by rarity. opts.free = GM gift; opts.speciesId = GM picks.
export function hatchEgg(config, state, rng, player, opts = {}) {
  const R = petRules(config);
  if (!R.enabled) return { error: true, text: 'Pets are switched off in the config.' };
  if (petsOf(player).length >= R.maxPets) return { error: true, text: `${player.name} already has ${R.maxPets} pets.` };
  const species = opts.speciesId ? speciesOf(config, opts.speciesId) : pickSpecies(config, rng);
  if (!species) return { error: true, text: 'No such species.' };
  if (!opts.free) { const pay = spendPower(state, player, eggCostFor(config, player), 'Hatched an egg'); if (pay.error) return pay; }
  const pet = rollPet(config, state, rng, species, opts.name);
  petsOf(player).push(pet);
  if (!player.activePetId) player.activePetId = pet.id;
  log(state, 'PET_HATCH', player.id, { petId: pet.id, species: species.id, rarity: species.rarity, free: !!opts.free });
  return { pet, text: `${player.name} hatches a ${species.rarity} ${species.emoji} ${species.name}!` };
}

export function setActivePet(state, player, petId) {
  const pet = petsOf(player).find(p => p.id === petId);
  if (!pet) return { error: true, text: 'No such pet.' };
  player.activePetId = pet.id;
  return { pet, text: `${pet.name} is now ${player.name}'s active pet.` };
}
export function renamePet(player, petId, name) {
  const pet = petsOf(player).find(p => p.id === petId); const clean = String(name || '').trim().slice(0, 24);
  if (!pet || !clean) return { error: true, text: 'Give the pet a name.' };
  pet.name = clean; return { pet, text: `Renamed to ${clean}.` };
}
export function releasePet(state, player, petId) {
  const list = petsOf(player); const i = list.findIndex(p => p.id === petId);
  if (i < 0) return { error: true, text: 'No such pet.' };
  const [pet] = list.splice(i, 1);
  if (player.activePetId === pet.id) player.activePetId = list[0]?.id || null;
  log(state, 'PET_RELEASE', player.id, { petId: pet.id, species: pet.speciesId });
  return { text: `${pet.name} returns to the wild.` };
}

// Level-ups: +1 to a favoured stat each level, +1 to a random other stat every 4th level; HP grows and tops up.
export function addXp(config, state, rng, player, pet, xp) {
  const R = petRules(config); const sp = speciesOf(config, pet.speciesId); const ups = [];
  pet.xp += Math.max(0, Math.round(xp * (1 + itemBonus(pet, 'xp'))));
  while (pet.level < R.maxLevel && pet.xp >= xpToNext(pet.level)) {
    pet.xp -= xpToNext(pet.level); pet.level += 1;
    const fav = sp?.grow?.length ? sp.grow[(pet.level - 2) % sp.grow.length] : STATS[rng.int(0, 5)];
    const gained = [fav];
    if (pet.level % 4 === 0) gained.push(STATS[rng.int(0, 5)]);
    for (const k of gained) pet.stats[k] = Math.min(24, pet.stats[k] + 1);
    const before = pet.hpMax; pet.hpMax = maxHp(pet.stats, pet.level);
    if (!pet.fainted) pet.hp = Math.min(pet.hpMax, pet.hp + (pet.hpMax - before));
    const evolved = evolveIfReady(config, state, player, pet);
    ups.push({ level: pet.level, gained, evolved });
    log(state, 'PET_LEVEL', player.id, { petId: pet.id, level: pet.level, gained });
  }
  if (pet.level >= R.maxLevel) pet.xp = Math.min(pet.xp, xpToNext(pet.level) - 1);
  return ups;
}

// ── Evolution ────────────────────────────────────────────────────
// Species list their later forms: evolves: [{ level, name, emoji }, …]. Reaching the level changes the
// pet's look and species name, and adds +2 to both favoured stats. A nickname the player chose is kept.
export function formOf(config, pet) {
  const sp = speciesOf(config, pet.speciesId); const stage = pet.stage || 0;
  if (!sp) return { name: pet.name, emoji: pet.emoji };
  return stage > 0 && sp.evolves?.[stage - 1] ? sp.evolves[stage - 1] : { name: sp.name, emoji: sp.emoji };
}
function evolveIfReady(config, state, player, pet) {
  const sp = speciesOf(config, pet.speciesId); if (!sp?.evolves?.length) return null;
  let result = null;
  while ((pet.stage || 0) < sp.evolves.length && pet.level >= Number(sp.evolves[pet.stage || 0].level)) {
    const before = formOf(config, pet); const next = sp.evolves[pet.stage || 0];
    pet.stage = (pet.stage || 0) + 1;
    if (pet.name === before.name) pet.name = next.name;            // untouched default name follows the form
    pet.emoji = next.emoji;
    for (const k of (sp.grow?.length ? sp.grow : ['str', 'con'])) pet.stats[k] = Math.min(24, pet.stats[k] + 2);
    const hpBefore = pet.hpMax; pet.hpMax = maxHp(pet.stats, pet.level); if (!pet.fainted) pet.hp = Math.min(pet.hpMax, pet.hp + (pet.hpMax - hpBefore));
    log(state, 'PET_EVOLVE', player.id, { petId: pet.id, from: before.name, to: next.name, stage: pet.stage });
    result = { from: before.name, to: next.name, emoji: next.emoji };
  }
  return result;
}

// Spend Power on training: xpPerPower XP for each ⚡.
export function trainPet(config, state, rng, player, petId, power) {
  const R = petRules(config); const pet = petsOf(player).find(p => p.id === petId);
  if (!pet) return { error: true, text: 'No such pet.' };
  if (pet.level >= R.maxLevel) return { error: true, text: `${pet.name} is already level ${R.maxLevel}.` };
  const pay = spendPower(state, player, power, `Trained ${pet.name}`); if (pay.error) return pay;
  const xp = Math.round(pay.spent * R.xpPerPower * (1 + rankOf(player).xpBonus));
  const ups = addXp(config, state, rng, player, pet, xp);
  return { pet, ups, xp, text: ups.length ? `${pet.name} trains hard and reaches level ${pet.level}!${ups.some(u => u.evolved) ? ` It evolved into ${pet.emoji} ${formOf(config, pet).name}!` : ''}` : `${pet.name} trains (+${xp} XP, ${xpToNext(pet.level) - pet.xp} to level ${pet.level + 1}).` };
}

export function revivePet(config, state, player, petId, { free = false } = {}) {
  const R = petRules(config); const pet = petsOf(player).find(p => p.id === petId);
  if (!pet) return { error: true, text: 'No such pet.' };
  if (!pet.fainted && pet.hp >= pet.hpMax) return { error: true, text: `${pet.name} is already at full health.` };
  if (!free) { const pay = spendPower(state, player, R.reviveCost, `Healed ${pet.name}`); if (pay.error) return pay; }
  pet.fainted = false; pet.hp = pet.hpMax;
  return { pet, text: `${pet.name} is back to full health.` };
}
// Everyone's pets rest between sessions.
export function restAllPets(state) { let n = 0; for (const pl of state.players) for (const pet of petsOf(pl)) { if (pet.fainted || pet.hp < pet.hpMax) n++; pet.fainted = false; pet.hp = pet.hpMax; } return n; }

// One-line stat block: "STR 14 (+2) · DEX 16 (+3) …"
export function statLine(pet) { return STATS.map(k => `${k.toUpperCase()} ${pet.stats[k]} (${mod(pet.stats[k]) >= 0 ? '+' : ''}${mod(pet.stats[k])})`).join(' · '); }

// ── Held items (gear). One slot per pet; spares sit in the owner's bag (player.petItems). ──
export const PET_ITEMS = {
  fang:  { id: 'fang',  name: 'Sharp Fang',   icon: '🦷', price: 300, desc: '+2 damage on every hit' },
  shell: { id: 'shell', name: 'Hard Shell',   icon: '🐚', price: 300, desc: '+1 AC' },
  focus: { id: 'focus', name: 'Focus Band',   icon: '🎗️', price: 300, desc: '+1 to hit' },
  berry: { id: 'berry', name: 'Rally Berry',  icon: '🍓', price: 250, desc: 'Once per fight: heals 30% when dropped under 30% HP' },
  charm: { id: 'charm', name: 'Lucky Charm',  icon: '🍀', price: 350, desc: '+3 on befriending rolls and +10% XP' },
};
export const itemDef = (id) => PET_ITEMS[id] || null;
export const bagOf = (player) => player.petItems || (player.petItems = {});
export function addItem(state, player, itemId, why = 'found') {
  if (!itemDef(itemId)) return { error: true, text: 'No such item.' };
  bagOf(player)[itemId] = (bagOf(player)[itemId] || 0) + 1;
  log(state, 'PET_ITEM', player.id, { item: itemId, why });
  return { text: `${player.name} gets ${itemDef(itemId).icon} ${itemDef(itemId).name}.` };
}
// Give a pet an item from the bag; whatever it was holding goes back in. itemId = null just unequips.
export function equipItem(state, player, petId, itemId) {
  const pet = petsOf(player).find(p => p.id === petId); if (!pet) return { error: true, text: 'No such pet.' };
  const bag = bagOf(player);
  if (itemId) { if (!itemDef(itemId)) return { error: true, text: 'No such item.' }; if (!(bag[itemId] > 0)) return { error: true, text: `${player.name} has no ${itemDef(itemId).name} in the bag.` }; }
  if (pet.item) bag[pet.item] = (bag[pet.item] || 0) + 1;
  if (itemId) { bag[itemId] -= 1; if (bag[itemId] <= 0) delete bag[itemId]; }
  pet.item = itemId || null;
  return { pet, text: itemId ? `${pet.name} now holds ${itemDef(itemId).icon} ${itemDef(itemId).name}.` : `${pet.name} holds nothing.` };
}
export const itemBonus = (holder, key) => {
  const id = holder?.item; if (!id) return 0;
  return ({ fang: { dmg: 2 }, shell: { ac: 1 }, focus: { hit: 1 }, charm: { capture: 3, xp: 0.10 } }[id] || {})[key] || 0;
};

// ── Pet goods at the Shop tile (Gold → side game). The only bridge from Gold into pets. ──
export const DEFAULT_PET_SHOP = [
  { id: 'egg',    name: 'Pet Egg',  icon: '🥚', price: 400, desc: 'Hatches a random pet (same odds as a Power egg)' },
  { id: 'potion', name: 'Potion',   icon: '🧪', price: 100, desc: 'Fully heals (or revives) your active pet' },
  { id: 'candy',  name: 'XP Candy', icon: '🍬', price: 150, desc: '+60 XP for your active pet' },
];
export function petShop(config) {
  const s = config?.PetShop; if (Array.isArray(s) && s.length) return s;
  return [...DEFAULT_PET_SHOP, ...Object.values(PET_ITEMS).map(i => ({ id: i.id, name: i.name, icon: i.icon, price: i.price, desc: `Held item — ${i.desc}`, gear: true }))];
}
export function buyPetGood(config, state, rng, player, itemId) {
  const R = petRules(config); if (!R.enabled) return { error: true, text: 'Pets are switched off in the config.' };
  const item = petShop(config).find(i => i.id === itemId); if (!item) return { error: true, text: 'The shop does not sell that.' };
  const price = Number(item.price) || 0;
  if (bal(player, 'Gold') < price) return { error: true, text: `Need ${price} Gold for ${item.name}.` };
  const pet = activePet(player); let result;
  if (itemDef(item.id)) {                                         // gear goes into the bag; equip it from the Pets panel
    credit(state, player, 'Gold', -price, `Shop: ${item.name}`); log(state, 'SHOP_BUY_PET', player.id, { id: item.id, price });
    const got = addItem(state, player, item.id, 'bought');
    return { ...got, text: `${player.name} buys ${item.icon || ''} ${item.name} for ${price} Gold — it's in the bag.` };
  }
  if (item.id === 'egg') { result = hatchEgg(config, state, rng, player, { free: true }); if (result.error) return result; }
  else if (!pet) return { error: true, text: `${player.name} has no pet to use that on.` };
  else if (item.id === 'potion') { result = revivePet(config, state, player, pet.id, { free: true }); if (result.error) return result; }
  else if (item.id === 'candy') { if (pet.level >= R.maxLevel) return { error: true, text: `${pet.name} is already level ${R.maxLevel}.` }; const ups = addXp(config, state, rng, player, pet, Number(item.xp) || 60); result = { text: ups.length ? `${pet.name} gobbles the candy and reaches level ${pet.level}!` : `${pet.name} gobbles the candy (+${Number(item.xp) || 60} XP).` }; }
  else return { error: true, text: `${item.name} has no effect defined.` };
  credit(state, player, 'Gold', -price, `Shop: ${item.name}`);
  log(state, 'SHOP_BUY_PET', player.id, { id: item.id, price });
  return { ...result, text: `${player.name} buys ${item.icon || ''} ${item.name} for ${price} Gold. ${result.text}` };
}
