// The 36 minigames as item definitions (data/items36.json) and the Item factory (STATE.md › Item).
// A weapon or spell is one legacy game plus a stake, charges and a footprint; the adapter plays it.
import raw from '../../data/items36.json' with { type: 'json' };
import classesRaw from '../../data/classes.json' with { type: 'json' };
import { group, stakeFor } from '../shared/balance.js';
import { hash32 } from '../shared/rng.js';

export const ITEM_DEFS = raw.items;                                   // the 36 rows, in spec order
export const ITEMS = Object.fromEntries(ITEM_DEFS.map(d => [d.id, d]));  // by item id (coinblade, ward, …)
export const byGame = Object.fromEntries(ITEM_DEFS.map(d => [d.gameId, d])); // by legacy game id (fifty, …)
export const FAMILIES = raw.families;
export const STAT_FAMILIES = raw.statFamilies;
export const GAME_IDS = ITEM_DEFS.map(d => d.gameId);
export const CLASSES = Object.fromEntries(classesRaw.classes.map(c => [c.id, c]));
export const STARTER_KIT = classesRaw.starterKit;
export const KINDS = ['attack', 'spell', 'area', 'versus'];

// Spells and one-hand weapons take a 1×3 column in the grid; two-hand weapons (the big picks/wheels rigs) 2×4.
const TWO_HAND = new Set(['bigwheel', 'roulette', 'plinko', 'pachinko', 'race', 'tower', 'slots', 'keno', 'crash']);
export const isTwoHand = (gameId) => TWO_HAND.has(gameId);
const slotFor = (def) => (def.kind === 'spell' ? 'spell' : 'weapon');

let counter = 0;
const nextId = (prefix, seed) => `${prefix}-${(seed >>> 0).toString(36)}-${(counter++).toString(36)}`;

// Build an Item for a weapon or spell. `state` only supplies balance overrides (stake per rarity).
// `seed` makes the id reproducible; the same seed twice gives the same id (callers pass loot-stream draws).
export function makeItem(state, { baseId, gameId, rarity = 'common', seed = null, charges = null, name = null, affixes = [] } = {}) {
  const def = baseId ? ITEMS[baseId] : byGame[gameId];
  if (!def) throw new Error(`unknown item ${baseId || gameId}`);
  const items = group(state, 'items');
  const s = seed == null ? hash32(`${def.id}:${rarity}:${counter}`) : seed >>> 0;
  const twoHand = isTwoHand(def.gameId);
  return {
    id: nextId(def.id, s), baseId: def.id, name: name || def.name, slot: slotFor(def),
    gameId: def.gameId, kind: def.kind, family: def.family, stat: def.stat, spellEffect: def.spellEffect || null,
    rarity, stake: stakeFor(state, rarity), charges: charges == null ? items.charges : charges, twoHand,
    bootMode: null, die: null,
    footprint: twoHand ? { w: 2, h: 4 } : { w: 1, h: 3 }, stackable: false, qty: 1,
    affixes: affixes.slice(), legendaryId: null, setId: null, unique: false,
    seed: s, region: null, tier: 1, sprite: `items/${def.id}`,
  };
}
// Consumables are 1×1 stackable items; qty is the stack.
export function makeConsumable(state, baseId, qty = 1, seed = null) {
  const names = { potion: 'Potion', nudge: 'Nudge', reroll: 'Reroll', fork: 'Fork', smokebomb: 'Smoke Bomb', phoenixfeather: 'Phoenix Feather' };
  if (!names[baseId]) throw new Error(`unknown consumable ${baseId}`);
  const s = seed == null ? hash32(`${baseId}:${counter}`) : seed >>> 0;
  return {
    id: nextId(baseId, s), baseId, name: names[baseId], slot: 'consumable', gameId: null, kind: null, family: null, stat: null,
    rarity: 'common', stake: 0, charges: 0, twoHand: false, bootMode: null, die: null,
    footprint: { w: 1, h: 1 }, stackable: true, qty, affixes: [], legendaryId: null, setId: null, unique: false,
    seed: s, region: null, tier: 1, sprite: `items/${baseId}`,
  };
}
// The shared starter kit plus the class start weapon, all Common: Coin Blade, Loaded Dice, Mend, N Potions.
export function starterKit(state, classId, seed = 1) {
  const items = group(state, 'items');
  const out = STARTER_KIT.map((id, i) => makeItem(state, { baseId: id, rarity: 'common', seed: hash32(`${seed}:kit:${i}`) }));
  const cls = CLASSES[classId];
  // "on top of the shared starter kit": Beastmaster and Enforcer get a second Mend / Loaded Dice (more charges).
  if (cls) out.push(makeItem(state, { baseId: cls.startWeapon, rarity: 'common', seed: hash32(`${seed}:class`) }));
  if (items.starterPotions > 0) out.push(makeConsumable(state, 'potion', items.starterPotions, hash32(`${seed}:potions`)));
  return out;
}
export const isWeaponOrSpell = (item) => !!item && (item.slot === 'weapon' || item.slot === 'offhand' || item.slot === 'spell') && !!item.gameId;
export const isConsumable = (item) => !!item && item.slot === 'consumable';
export const statLabel = (stat) => classesRaw.statNames[stat] || stat;
