// Monsters: species from data/monsters.json become living monsters at RUN_START (runHooks.runStart, registered
// after the map hook so `state.map` exists). One monster per chosen encounter hex, the region boss on its Boss
// Gate, raid bosses where regions.json asks, the Dealer on the throne, a Dungheap on every blocker hex.
//
// Monster shape (docs/STATE.md): { id, speciesId, name, regionId, pos, health, maxHealth, stats, items: [Item],
//   boss, raid, final, blocker, gmControlled, dead, linkedTo, loot: { gold, items, egg }, mood, parts?, special? }
// Contracts for the fight module:
//   - `items` are full Item records (built here from items36.json, never imported from the items module); the
//     monster stakes from its own Health.
//   - `linkedTo` (The Grey): the two monsters share Health — a hit on one is mirrored to the other.
//     `special: 'mindlink'` also lets it control the player's active pet for one attack on its turn.
//   - `parts` (The Litter): five cats, each with its own health; an item only hurts the part whose `family`
//     matches, and the monster dies when every part is dead. `health` is the sum, kept for the TV bar.
//   - `special: 'passive'` (Dungheap) never attacks; `special: 'hightable'` makes every player at the table stake.
//   - monsters.tierScale is applied to Health here and to monster damage by the chaos outgoing mod in
//     handlers/wheels.js, so the fight module must not scale it again.
import raw from '../../../data/monsters.json' with { type: 'json' };
import items36 from '../../../data/items36.json' with { type: 'json' };
import { streamRng, hash32 } from '../rng.js';
import { stakeFor } from '../balance.js';
import { note } from '../state.js';
import * as hex from '../hex.js';
import { hooks as runHooks } from '../handlers/run.js';

export const SPECIES = Object.fromEntries(raw.species.map(s => [s.id, s]));
export const speciesOf = (id) => SPECIES[id] || null;
export const speciesInRegion = (regionId, role = 'common') => raw.species.filter(s => s.regionId === regionId && s.role === role);
const ITEM36 = Object.fromEntries(items36.items.map(i => [i.id, i]));
const LANDABLE_FALLBACK = ['plain', 'arena', 'wheel', 'event'];
const WEAPON_FOOTPRINT = { w: 1, h: 3 };       // one-hand weapons and spells are 1×3 in the grid (SPEC › Inventory grid)

// The Item shape (docs/STATE.md › Item) for a weapon or spell a monster fights with. Deterministic from the
// seed so every client builds the same record.
export function makeMonsterItem(state, itemId, rarity = 'common', seed = 0) {
  const base = ITEM36[itemId]; if (!base) throw new Error(`unknown item ${itemId}`);
  const spell = base.kind === 'spell';
  return {
    id: `mi_${itemId}_${(seed >>> 0).toString(36)}`, baseId: itemId, name: base.name, slot: spell ? 'spell' : 'weapon',
    gameId: base.gameId, kind: base.kind, family: base.family, stat: base.stat, rarity,
    stake: stakeFor(state, rarity), charges: Infinity, twoHand: false, bootMode: null, die: null,
    footprint: { ...WEAPON_FOOTPRINT }, stackable: false, qty: 1, affixes: [], legendaryId: null, setId: null, unique: false,
    seed: seed >>> 0, region: null, tier: state.tier || 1, sprite: `items/${itemId}`, monsterItem: true,
  };
}

export function monsterBaseHealth(ctx, role) {
  const M = ctx.B('monsters');
  return role === 'final' ? M.healthFinal : role === 'raid' ? M.healthRaid : role === 'boss' ? M.healthBoss : M.healthCommon;
}
export function monsterHealthFor(state, ctx, species) {
  const M = ctx.B('monsters');
  const tier = Math.max(1, Number(state.tier) || 1);
  return Math.max(1, Math.round(monsterBaseHealth(ctx, species.role) * (species.healthMult || 1) * (1 + M.tierScale * (tier - 1))));
}

// Rarity of a monster's weapons: bosses carry Rare, raids Epic, the Dealer Legendary stakes; commons stake Common.
const itemRarityFor = (role) => role === 'final' ? 'legendary' : role === 'raid' ? 'epic' : role === 'boss' ? 'rare' : 'common';

let spawnSeq = 0;
export function spawnMonster(state, ctx, speciesId, hexKey, { name = null, gmControlled = false } = {}) {
  const sp = speciesOf(speciesId); if (!sp) throw new Error(`unknown species ${speciesId}`);
  const h = state.map?.hexes?.[hexKey] || null;
  state.monsterSeq = (state.monsterSeq || 0) + 1;
  const id = `m${state.monsterSeq}_${sp.id}`;
  const maxHealth = monsterHealthFor(state, ctx, sp);
  const M = ctx.B('monsters');
  const rng = streamRng(state, 'monsters');
  const count = Math.min(sp.items.length, Math.max(M.itemsMin, Math.min(M.itemsMax, sp.items.length)));
  const picks = sp.items.length > count ? rng.shuffle(sp.items).slice(0, count) : sp.items.slice();
  const items = picks.map((itemId, i) => makeMonsterItem(state, itemId, itemRarityFor(sp.role), hash32(`${state.seed}:${id}:${itemId}:${i}`)));
  const m = {
    id, speciesId: sp.id, name: name || sp.name, regionId: h?.regionId ?? sp.regionId ?? null, pos: hexKey,
    health: maxHealth, maxHealth, stats: { ...sp.stats }, items,
    boss: sp.role === 'boss' || sp.role === 'raid' || sp.role === 'final', raid: sp.role === 'raid', final: sp.role === 'final', blocker: sp.role === 'blocker',   // raids and the Dealer count as bosses (major death penalty)
    gmControlled, dead: false, linkedTo: null, mood: null, special: sp.special || null,
    loot: { gold: sp.loot.gold.slice(), rarity: { ...sp.loot.rarity }, egg: sp.loot.egg, dropChance: sp.loot.dropChance },
    sprite: sp.sprite, token: sp.token, tier: sp.tier,
  };
  if (sp.parts) {
    const each = Math.max(1, Math.round(maxHealth / sp.parts.length));
    m.parts = sp.parts.map(p => ({ ...p, health: each, maxHealth: each, dead: false }));
    m.maxHealth = m.health = each * sp.parts.length;
  }
  state.monsters[id] = m;
  if (h) h.monsterId = id;
  return m;
}

const hexesOfRegion = (state, region) => (region.hexKeys?.length ? region.hexKeys.map(k => state.map.hexes[k]).filter(Boolean) : Object.values(state.map.hexes).filter(h => h.regionId === region.id));
const isFree = (h) => h && !h.void && !h.monsterId;

// How many monsters a region gets: the map may have written state.map.scale.monsters; otherwise the map group's
// per-region count plus the per-extra-player bump.
export function monstersPerRegion(state, ctx) {
  const sc = state.map?.scale; if (sc && (sc.monstersPerRegion ?? sc.monsters) != null) return Math.max(0, Math.round(sc.monstersPerRegion ?? sc.monsters));
  const T = ctx.B('table'), M = ctx.B('map');
  const players = state.seats.filter(id => state.players[id] && !state.players[id].kicked && !state.players[id].spectator).length;
  return Math.max(0, Math.round(M.monstersPerRegion + M.monstersPerExtraPlayer * Math.max(0, players - T.tunedMin)));
}

export function generateMonsters(state, ctx) {
  if (!state.map || !state.map.hexes) return;
  if (state.mode === 'pvp') return;                       // PvP only: no monsters; Encounter tiles act as Arenas
  const rng = streamRng(state, 'monsters');
  const n = monstersPerRegion(state, ctx);
  const startHex = state.map.start ? hex.parse(state.map.start) : null;
  for (const region of Object.values(state.map.regions || {})) {
    const hexes = hexesOfRegion(state, region);
    let encounters = rng.shuffle(hexes.filter(h => h.type === 'encounter' && isFree(h)));
    const table = (region.monsterTable || []).filter(id => SPECIES[id]);
    const pool = table.length ? table : speciesInRegion(region.id).map(s => s.id);
    if (pool.length && encounters.length) {
      let placed = 0;
      // The first Encounter of the start region is the drunk revenant under the sign (nearest to the start).
      if (startHex && state.map.hexes[state.map.start]?.regionId === region.id && pool.includes('drunk_revenant') && n > 0) {
        encounters.sort((a, b) => hex.distance(a, startHex) - hex.distance(b, startHex));
        spawnMonster(state, ctx, 'drunk_revenant', encounters.shift().key); placed = 1;
      }
      const order = rng.shuffle(pool);
      for (let i = 0; placed < n && encounters.length; i++, placed++) spawnMonster(state, ctx, order[i % order.length], encounters.shift().key);
    }
    const gates = hexes.filter(h => h.type === 'bossgate' && isFree(h));
    const bossId = region.bossId && SPECIES[region.bossId] ? region.bossId : speciesInRegion(region.id, 'boss')[0]?.id;
    if (bossId && gates.length) spawnMonster(state, ctx, bossId, gates.shift().key);
    const raidId = region.raidBossId && SPECIES[region.raidBossId] ? region.raidBossId : null;
    if (raidId) {
      const spot = gates.shift() || encounters.shift() || rng.shuffle(hexes.filter(h => LANDABLE_FALLBACK.includes(h.type) && isFree(h)))[0];
      if (spot) spawnMonster(state, ctx, raidId, spot.key);
    }
  }
  // The Dealer on the throne.
  const throne = state.map.throne && state.map.hexes[state.map.throne];
  if (throne && isFree(throne)) {
    const finalId = Object.values(state.map.regions || {}).find(r => r.finalBossId && SPECIES[r.finalBossId])?.finalBossId || 'the_dealer';
    spawnMonster(state, ctx, finalId, throne.key);
  }
  // Dungheaps on blocker hexes.
  for (const h of Object.values(state.map.hexes)) if (h.type === 'blocker' && !h.monsterId) spawnMonster(state, ctx, 'dungheap', h.key);
  // The Grey mind-links with another monster of its region (or anywhere, if alone).
  for (const m of Object.values(state.monsters)) {
    if (m.special !== 'mindlink' || m.linkedTo) continue;
    const others = Object.values(state.monsters).filter(o => o.id !== m.id && !o.dead && !o.linkedTo && !o.final && !o.blocker && o.special !== 'mindlink');
    const same = others.filter(o => o.regionId === m.regionId);
    const pick = (same.length ? rng.pick(same) : others.length ? rng.pick(others) : null);
    if (pick) { m.linkedTo = pick.id; pick.linkedTo = m.id; }
  }
  const total = Object.values(state.monsters).filter(m => !m.blocker).length;
  note(state, `${total} monsters stir across the map`, 'start', ctx.now);
}

export function monsterAt(state, hexKey) {
  const h = state.map?.hexes?.[hexKey];
  const byHex = h?.monsterId ? state.monsters[h.monsterId] : null;
  if (byHex && !byHex.dead && byHex.pos === hexKey) return byHex;
  return Object.values(state.monsters).find(m => !m.dead && m.pos === hexKey) || null;
}
export const aliveMonsters = (state) => Object.values(state.monsters).filter(m => !m.dead);
export const monsterAlive = (state, id) => { const m = state.monsters[id]; return !!m && !m.dead; };

// Marks a monster dead and frees its hex for walking (the Dungheap's hex becomes open ground).
export function markMonsterDead(state, m) {
  m.dead = true; m.health = 0;
  if (m.parts) for (const p of m.parts) { p.dead = true; p.health = 0; }
  const h = state.map?.hexes?.[m.pos];
  if (h && m.blocker) { h.type = 'plain'; h.void = false; h.monsterId = null; }
}

// Ember Flask rest: every common monster of the region stands back up at full Health.
export function respawnRegion(state, regionId) {
  let n = 0;
  for (const m of Object.values(state.monsters)) {
    if (m.regionId !== regionId || m.boss || m.raid || m.final || m.blocker) continue;
    if (m.dead) n += 1;
    m.dead = false; m.health = m.maxHealth;
    if (m.parts) for (const p of m.parts) { p.dead = false; p.health = p.maxHealth; }
    const h = state.map?.hexes?.[m.pos]; if (h) h.monsterId = m.id;
  }
  return n;
}

runHooks.runStart.push(generateMonsters);
