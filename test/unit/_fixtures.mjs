// Fixtures for the items / fight suites: characters and monsters in the STATE.md shapes, a room that is already
// playing with one character per seat, and a tiny event driver for a fight. No creation module exists yet, so the
// tests write characters straight into the state before RUN_START (the way the creation handlers will).
import { room, names4, B } from './_helpers.mjs';
import * as shared from '../../packages/shared/index.js';
import '../../packages/shared/handlers/items.js';
import '../../packages/shared/handlers/fight.js';
import { makeItem, makeConsumable, starterKit } from '../../packages/games/items.js';
import { makeRng } from '../../packages/shared/rng.js';
import { unlockUpgrades } from '../../packages/shared/characters/character.js';

export { room, names4, B, shared, makeItem, makeConsumable, starterKit, makeRng };

const EMPTY_WORN = () => ({ mainhand: null, offhand: null, spell1: null, spell2: null, helmet: null, torso: null, pants: null, gloves: null, boots: null, ring1: null, ring2: null, ring3: null, ring4: null, necklace: null, cape: null });

export function mkCharacter({ id, playerId, name = 'Hero', classId = 'cutpurse', level = 1, stats = null, health = null, maxHealth = null, items = [], worn = {}, pos = null, pets = [], gold = 0 } = {}) {
  const max = maxHealth ?? B.health.maxAtLevel1 + (level - 1) * B.health.maxPerLevel;
  const c = {
    id, playerId, rosterId: null, name, crest: '🂠', look: { body: 0, skin: 0, face: 0, hair: 0, coat: '#333' }, classId,
    level, xp: 0, statPoints: 0, stats: stats || { luck: B.stats.neutral, nerve: B.stats.neutral, greed: B.stats.neutral, grit: B.stats.neutral },
    health: health ?? max, maxHealth: max, shield: 0, gold, bank: 0, chips: 0,
    pos, lastSafePos: pos, region: null,
    worn: { ...EMPTY_WORN(), ...worn }, grid: { cols: B.grid.cols, rows: B.grid.rows, cells: [] }, items: {},
    pets, activePetId: pets[0]?.id || null,
    dead: false, missTurns: 0, deaths: 0, graveyardPos: null, diedTo: null,
    cooldowns: { active: 0 }, activeUses: {}, effects: [], pactIds: [], wanted: 0, kills: 0, titles: [], quests: [], upgrades: [],
    setBonuses: {}, passives: {}, flags: {}, pendingLoot: [], gridEffects: [], hatching: null, questCounters: {},
    usedThisTurn: { attack: 0, spell: 0, moved: false }, turnsTaken: 0, streak: 0,
    freeRestakeUsed: false, freeSmokeBombs: classId === 'cutpurse' ? B.social.smokeBombFree : 0, buyinSpun: true, locked: true, creation: null,
  };
  for (const it of items) give(c, it);
  for (const it of Object.values(c.worn)) if (it) c.items[it.id] = it;
  unlockUpgrades(c, B.xp);
  return c;
}
// Put an item in the grid (first free column) and the item table.
export function give(c, item, { wear = null } = {}) {
  c.items[item.id] = item;
  if (wear) { c.worn[wear] = item; return item; }
  const used = new Set(c.grid.cells.map(cell => cell.x));
  let x = 0; while (used.has(x) && x < 100) x++;
  c.grid.cells.push({ itemId: item.id, x, y: 0, rot: 0, qty: item.qty || 1 });
  return item;
}
export function mkMonster({ id = 'm1', name = 'Pit Hound', health = null, stats = null, items = [], boss = false, pos = null } = {}) {
  const hp = health ?? B.monsters.healthCommon;
  return { id, speciesId: 'pithound', name, regionId: null, pos, health: hp, maxHealth: hp, stats: stats || { luck: 3, nerve: 3, greed: 3, grit: 3 }, items, boss, raid: false, final: false, gmControlled: false, dead: false, linkedTo: null, loot: { gold: [0, 0], items: [], egg: 0, dropChance: 0 } };   // the monsters.json loot shape: nothing drops
}
export function mkPet({ id = 'pet1', name = 'Muckling', power = 40 } = {}) {
  return { id, speciesId: 'muckling', name, element: 'muck', stage: 1, power, maxPower: power, attacks: [{ gameId: 'fifty', name: 'Nip', stake: 5 }], heldItem: null, fainted: false, bodies: 1, caughtAt: 0 };
}
// A room that is playing, with one character per name. opts.chars: per-index overrides for mkCharacter.
export function playingRoom({ names = names4, chars = [], seed = 42, kits = true, ...roomOpts } = {}) {
  const r = room({ seed, ...roomOpts }); r.join(names);
  names.forEach((n, i) => {
    const pid = 'p' + i, cid = 'c' + i, o = chars[i] || {};
    const c = mkCharacter({ id: cid, playerId: pid, name: n, ...o });
    if (kits && !o.items) for (const it of starterKit(r.state, c.classId, seed + i)) { if (it.slot === 'consumable') give(c, it); else if (it.baseId === (o.wear || 'coinblade') && !c.worn.mainhand) give(c, it, { wear: 'mainhand' }); else if (it.slot === 'spell' && !c.worn.spell1) give(c, it, { wear: 'spell1' }); else give(c, it); }
    r.state.characters[cid] = c; r.state.players[pid].characterId = cid;
  });
  r.append('RUN_START', {}, 'gm');
  r.char = (i) => r.state.characters['c' + i];
  r.cur = () => shared.currentPlayerId(r.state);
  r.curChar = () => shared.characterOf(r.state, r.cur());
  r.itemOf = (c, baseId) => Object.values(c.items).find(it => it.baseId === baseId);
  return r;
}
// Drive one player's item round through events: ITEM_USE → ITEM_RESOLVE with the given result (no phone needed).
export function hit(r, { pid, itemId, targetId = null, targetKind = null, mult, label = 'test', crit = false }) {
  r.append('ITEM_USE', { playerId: pid, itemId, targetId, targetKind }, pid);
  return r.append('ITEM_RESOLVE', { mult, label, crit }, pid);
}
