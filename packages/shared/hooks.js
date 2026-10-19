// Extension points shared between handler modules, so that modules built separately plug together without
// importing each other. Every list is called in registration order; every function is (state, ctx, …).
//
// Module ownership (who pushes where):
//   map/movement   → tileHooks (resolving a tile type), moveHooks
//   items/fight    → calls damageHooks + deathHooks; exposes useItem via events
//   encounters     → tileHooks for encounter/boss, deathHooks (penalties), lootHooks
//   characters     → damageHooks (affixes, class passives, sets, legendaries), levelHooks
//   challenge      → heldHooks
//   social/modes   → runHooks.endCheck (in run.js), letterHooks
export const tileHooks = {};        // { [tileType]: (state, ctx, playerId, hex) => void }  — register one per type
export const moveHooks = { beforeMove: [], afterStep: [], afterMove: [] };
// Damage pipeline. Each mod is (state, ctx, info) → void and may change info.stake / info.mult / info.flat / info.cancel.
//   info = { attackerId, targetId, targetKind: 'character'|'monster'|'pet', item, gameId, kind, crit, base, stake, mult, flat: 0, damageMult: 1, notes: [] }
//   attackerId/targetId are CHARACTER ids (monster ids for monsters); player ids ride along as attackerPlayerId/targetPlayerId.
//   `mult` is the payout multiple (legacy total return − 1); `damageMult` scales the final payout (Chaos, region, boss mood).
export const damageHooks = { stake: [], outgoing: [], incoming: [], afterHit: [], afterMiss: [] };
export const deathHooks = { onZero: [], onDeath: [], onRevive: [] };     // onZero may set info.prevented = true (Phoenix Feather, pendant)
export const lootHooks = { rarity: [], onDrop: [] };                       // rarity mods: (state, ctx, info{rarityIndex, regionId, charId})
export const levelHooks = { onLevel: [], onXp: [] };
export const heldHooks = { onHold: [], onRelease: [] };
export const letterHooks = { onDeliver: [], onIntercept: [] };
export const petHooks = { beforeCharacterHit: [] };                        // pets fight first: may redirect a hit (info.redirectToPet = petId)
export const classActives = {};     // { [activeId]: (state, ctx, character, payload) => void }
export const consumables = {};      // { [consumableId]: (state, ctx, character, payload) => void }
export const legendaryEffects = {}; // { [legendaryId]: { onEquip?, onUnequip?, onUse?, mods? } }

export function registerTile(type, fn) { if (tileHooks[type]) throw new Error(`tile ${type} registered twice`); tileHooks[type] = fn; }
export function runMods(list, state, ctx, info) { for (const fn of list) fn(state, ctx, info); return info; }
