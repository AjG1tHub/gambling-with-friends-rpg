// Seeded item generation (SPEC.md › Gear and item generation, Named Legendaries, Blockcraft). Every drop is
// rolled from a seed: the same seed on the same balance gives the same item (ids aside), so a test can
// regenerate one and the GM can hand out a specific item by seed. Weapons and spells come from
// data/items36.json, other bases from data/bases.json (boots from data/boots.json when the map module ships it),
// affixes from data/affixes.json, Legendaries and Blockcraft sets are hand-written data.
import items36 from '../../../data/items36.json' with { type: 'json' };
import affixData from '../../../data/affixes.json' with { type: 'json' };
import bases from '../../../data/bases.json' with { type: 'json' };
import legendaryData from '../../../data/legendaries.json' with { type: 'json' };
import setsData from '../../../data/sets.json' with { type: 'json' };
import { makeRng, streamRng, hash32 } from '../rng.js';
import { group, affixCountFor, stakeFor, RARITIES } from '../balance.js';
import { note } from '../state.js';
import { insert } from './grid.js';

export const GAMES = items36.items;                       // the 36, as weapon/spell definitions
export const FAMILIES = items36.families;
export const gameById = (id) => GAMES.find(g => g.gameId === id) || null;
export const weaponDefById = (id) => GAMES.find(g => g.id === id) || null;
export const AFFIXES = affixData.affixes;
export const affixDef = (id) => AFFIXES.find(a => a.id === id) || null;
export const LEGENDARIES = legendaryData.legendaries;
export const legendaryDef = (id) => LEGENDARIES.find(l => l.id === id) || null;
export const SETS = setsData.sets;
export const setDef = (id) => SETS.find(s => s.id === id) || null;
export const FOOTPRINTS = bases.footprints;
export const CONSUMABLES = bases.consumable;
export const consumableDef = (id) => CONSUMABLES.find(c => c.id === id) || null;
export const ARMOUR_SLOTS = ['helmet', 'torso', 'pants', 'gloves', 'boots'];
export const GEAR_SLOTS = ['weapon', 'spell', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace'];

// Boots: the map module owns data/boots.json; when it is there (and lists the same ids) it wins, else our fallback.
export let BOOT_BASES = bases.boots;
try {
  const url = new URL('../../../data/boots.json', import.meta.url);
  const mod = await import(/* @vite-ignore */ url.href, { with: { type: 'json' } });
  const raw = mod.default; const list = Array.isArray(raw) ? raw : raw?.boots || raw?.bases || raw?.items || null;
  if (Array.isArray(list) && list.length) {
    const norm = list.filter(b => b && b.id && (b.bootMode || b.mode)).map(b => ({ id: b.id, name: b.name || b.id, bootMode: b.bootMode || b.mode, die: b.die ?? b.sides ?? null, sprite: b.sprite || `worn/${b.id}` }));
    if (norm.length) BOOT_BASES = norm;
  }
} catch { /* no boots.json yet: the fallback list in bases.json stands */ }

export function basesFor(slot) {
  if (slot === 'boots') return BOOT_BASES;
  if (slot === 'weapon' || slot === 'offhand') return GAMES.filter(g => g.kind !== 'spell');
  if (slot === 'spell') return GAMES.filter(g => g.kind === 'spell');
  if (slot === 'consumable') return CONSUMABLES;
  return bases[slot] || [];
}
export function footprintFor(slot, { twoHand = false } = {}) { return { ...(twoHand ? FOOTPRINTS.twohand : FOOTPRINTS[slot] || FOOTPRINTS.consumable) }; }

// Region → favoured family. Reads the live map when there is one, else the items36 table.
export function regionFamily(state, regionId) {
  if (!regionId) return null;
  const r = state?.map?.regions?.[regionId]; if (r?.family) return r.family;
  return Object.entries(FAMILIES).find(([, f]) => f.regionBias === regionId)?.[0] || null;
}
export function regionTier(state, regionId) { return state?.map?.regions?.[regionId]?.tier || 1; }

// Seeds. A spec may carry its own; otherwise the room's loot stream hands one out (and advances, so replays agree).
export function nextSeed(state, seed) { if (Number.isFinite(Number(seed))) return Number(seed) >>> 0; return streamRng(state, 'loot').int(0, 0x7fffffff); }
const nextId = (state, seed) => `i${((state.itemSeq = (state.itemSeq || 0) + 1)).toString(36)}-${(seed >>> 0).toString(36)}`;

// ── Affixes ──────────────────────────────────────────────────────
const pct = (v) => `${Math.round(v * 100)}%`;
function targetName(target) {
  if (!target) return '';
  if (target.family) return FAMILIES[target.family]?.name || target.family;
  if (target.game) return gameById(target.game)?.name || target.game;
  if (target.region) return target.region.charAt(0).toUpperCase() + target.region.slice(1);
  return '';
}
function affixText(def, value, target) {
  return def.text.replace('{pct}', pct(value)).replace('{n}', String(value)).replace('{target}', targetName(target) || 'anything');
}
function scaleValue(def, raw, tier, A) {
  const mult = 1 + A.tierScale * Math.max(0, tier - 1);
  if (def.unit === 'fraction') return Math.round(raw * mult * 100) / 100;
  if (def.unit === 'on/off') return raw;
  return Math.max(1, Math.round(raw * mult));
}
function rollValue(def, rng, tier, A) {
  if (def.valueKeys) { const [kmin, kmax] = def.valueKeys; const min = A[kmin], max = A[kmax]; const raw = def.unit === 'fraction' ? min + rng.next() * (max - min) : rng.int(min, max); return scaleValue(def, raw, tier, A); }
  if (def.valueKey) return scaleValue(def, A[def.valueKey], tier, A);
  return def.value ?? 1;
}
function rollTarget(def, rng, { gameId, family, regionId }) {
  const mode = def.target === 'familyOrGame' ? (rng.chance(0.5) ? 'game' : 'family') : def.target;
  if (!mode) return null;
  if (mode === 'game') return { game: gameId || rng.pick(GAMES).gameId };
  if (mode === 'family') return { family: family || rng.pick(affixData.families) };
  if (mode === 'region') return { region: regionId || rng.pick(affixData.regions) };
  return null;
}
export function rollAffix(state, rng, def, { tier = 1, gameId = null, family = null, regionId = null } = {}) {
  const A = group(state, 'affix');
  const target = rollTarget(def, rng, { gameId, family, regionId });
  const value = rollValue(def, rng, tier, A);
  const out = { id: def.id, kind: def.kind, target, value, text: affixText(def, value, target), prefix: rng.pick(def.prefixes), suffix: rng.pick(def.suffixes) };
  if (def.effect) out.effect = def.effect;
  if (target?.game) out.game = target.game;   // the items adapter reads Odds affixes by `game` + `effect`
  return out;
}
// Affixes for a slot: the slot's required kinds first, then the pool without repeating an id. Boots keep to
// affixes whose `modes` include their movement mode.
export function rollAffixes(state, rng, slot, count, opts = {}) {
  const pool = AFFIXES.filter(a => a.slots.includes(slot) && (!a.modes || !opts.bootMode || a.modes.includes(opts.bootMode)));
  const required = affixData.slotRules[slot] || [];
  const out = []; const used = new Set();
  const take = (candidates) => { const list = candidates.filter(a => !used.has(a.id)); if (!list.length) return false; const def = rng.pick(list); used.add(def.id); out.push(rollAffix(state, rng, def, opts)); return true; };
  for (const kind of required) { if (out.length >= count) break; take(pool.filter(a => a.kind === kind)); }
  let guard = 0;
  while (out.length < count && guard++ < 20) if (!take(pool)) break;
  return out;
}
export function nameWith(baseName, affixes) {
  const prefix = affixes[0]?.prefix, suffix = affixes[1]?.suffix;
  return [prefix, baseName, suffix].filter(Boolean).join(' ');
}

// ── Items ────────────────────────────────────────────────────────
function skeleton(state, { seed, slot, rarity, regionId, tier }) {
  return { id: nextId(state, seed), baseId: null, name: '', slot, gameId: null, kind: null, family: null, stat: null, rarity, stake: 0, charges: 0, twoHand: false,
    bootMode: null, die: null, footprint: footprintFor(slot), stackable: false, qty: 1, affixes: [], legendaryId: null, setId: null, unique: null,
    seed: seed >>> 0, region: regionId || null, tier: tier || 1, sprite: null };
}
// A weapon or spell from one of the 36. `plain` = no affixes (the starter kit).
export function makeWeapon(state, def, { rarity = 'common', seed, regionId = null, tier = 1, plain = false } = {}) {
  seed = nextSeed(state, seed); const rng = makeRng(seed);
  const slot = def.kind === 'spell' ? 'spell' : 'weapon';
  const it = skeleton(state, { seed, slot, rarity, regionId, tier });
  Object.assign(it, { baseId: def.id, gameId: def.gameId, kind: def.kind, family: def.family, stat: def.stat, stake: stakeFor(state, rarity), charges: group(state, 'items').charges, sprite: `worn/${def.id}` });
  if (def.spellEffect) it.spellEffect = def.spellEffect;
  it.affixes = plain ? [] : rollAffixes(state, rng, slot, affixCountFor(state, rarity), { tier, gameId: def.gameId, family: def.family, regionId });
  it.name = plain ? def.name : nameWith(def.name, it.affixes);
  return it;
}
// Rolled armour, rings, necklaces (the base chosen by the seed unless `baseId` is given).
export function makeGear(state, slot, { rarity = 'common', seed, regionId = null, tier = 1, baseId = null } = {}) {
  seed = nextSeed(state, seed); const rng = makeRng(seed);
  const list = basesFor(slot); if (!list.length) throw new Error(`no bases for slot ${slot}`);
  const base = (baseId && list.find(b => b.id === baseId)) || rng.pick(list);
  const it = skeleton(state, { seed, slot, rarity, regionId, tier });
  Object.assign(it, { baseId: base.id, bootMode: base.bootMode || null, die: base.die ?? null, sprite: base.sprite || `worn/${base.id}` });
  it.affixes = rollAffixes(state, rng, slot, affixCountFor(state, rarity), { tier, regionId, bootMode: base.bootMode || null, family: regionFamily(state, regionId) });
  it.name = nameWith(base.name, it.affixes);
  return it;
}
export function makeConsumable(state, baseId, { qty = 1, seed } = {}) {
  const def = consumableDef(baseId); if (!def) throw new Error(`no consumable ${baseId}`);
  seed = nextSeed(state, seed);
  const it = skeleton(state, { seed, slot: def.slot, rarity: def.id === 'satchel' || def.id === 'petrevive' || def.id === 'phoenixfeather' ? 'rare' : 'common', regionId: null, tier: 1 });
  Object.assign(it, { baseId: def.id, name: def.name, stackable: !!def.stackable, qty: def.stackable ? Math.max(1, qty) : 1, sprite: def.sprite, text: def.text, footprint: footprintFor(def.slot) });
  return it;
}
// A Blockcraft piece. Set pieces carry their set's per-piece effects as affixes so the damage hooks see one list.
export function makeSetPiece(state, setId, slot, { seed, regionId = null, tier = 1 } = {}) {
  const set = setDef(setId); if (!set) throw new Error(`no set ${setId}`);
  if (!setsData.slots.includes(slot)) throw new Error(`${slot} is not a set slot`);
  seed = nextSeed(state, seed); const rng = makeRng(seed); const SB = group(state, 'sets');
  const it = skeleton(state, { seed, slot, rarity: set.rarity, regionId, tier });
  Object.assign(it, { baseId: `${set.id}_${slot}`, name: set.pieceNames[slot], setId: set.id, sprite: `worn/${set.id}_${slot}`, flavour: set.flavour });
  it.affixes = set.perPiece.map(eff => ({ id: `set-${set.id}-${eff.kind}`, kind: eff.kind, target: eff.target || null, stat: eff.stat || null, value: Number(SB[eff.valueKey] || 0), text: eff.text, set: set.id }));
  if (slot === 'boots') { const boot = rng.pick(BOOT_BASES.filter(b => b.bootMode === 'dice')); it.bootMode = boot.bootMode; it.die = boot.die; }
  if (set.dyeable) it.dye = rng.pick(['#8b5a2b', '#c0392b', '#2e86ab', '#7d3c98', '#1e8449', '#f1c40f']);
  if (set.crumbles) it.charges = SB[set.crumbles.chargesKey];
  if (set.note) it.note = set.note;
  return it;
}
// A Named Legendary: four rolled affixes for its slot plus its unique.
export function generateLegendary(state, id, { seed, regionId = null, tier = 1 } = {}) {
  const def = legendaryDef(id); if (!def) throw new Error(`no legendary ${id}`);
  seed = nextSeed(state, seed); const rng = makeRng(seed);
  const I = group(state, 'items'), L = group(state, 'legendaries');
  const slot = def.slot;
  const it = skeleton(state, { seed, slot, rarity: 'legendary', regionId, tier });
  const game = def.gameId ? gameById(def.gameId) : null;
  Object.assign(it, {
    baseId: def.id, name: def.name, legendaryId: def.id, unique: def.id, twoHand: !!def.twoHand, footprint: { ...def.footprint },
    gameId: game?.gameId || null, kind: def.kind || game?.kind || null, family: game?.family || null, stat: game?.stat || null,
    stake: game ? (def.stakeKey ? L[def.stakeKey] : I.stakeLegendary) : 0, charges: game ? I.charges : 0,
    bootMode: def.bootMode || null, die: def.die ?? null, sprite: `legendary/${def.id}`, nodsTo: def.nodsTo, text: def.text, effect: def.effect.key,
  });
  if (def.id === 'emberflask') it.charges = L.emberCharges;
  if (def.id === 'cameraobscura') it.charges = L.cameraShots;
  const rollable = ['weapon', 'spell', 'offhand', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace'].includes(slot);
  it.affixes = rollable ? rollAffixes(state, rng, slot === 'offhand' ? 'weapon' : slot, I.affixesLegendary, { tier, gameId: it.gameId, family: it.family, regionId, bootMode: it.bootMode }) : [];
  it.affixes.push({ id: `unique-${def.id}`, kind: 'unique', target: null, value: 1, text: def.text, legendary: def.id });
  return it;
}
export const droppableLegendaries = () => LEGENDARIES.filter(l => !l.neverDrops);

// The front door: one item of a slot (random slot when omitted) at a rarity, biased to the region's family.
export function generateItem(state, { slot = null, rarity = 'common', regionId = null, tier = null, seed, baseId = null } = {}) {
  seed = nextSeed(state, seed); const rng = makeRng(seed);
  tier = tier || regionTier(state, regionId);
  if (!RARITIES.includes(rarity)) rarity = 'common';
  if (!slot) { const w = Object.entries(bases.dropWeights).map(([id, weight]) => ({ id, weight })); slot = rng.weightedPick(w).id; }
  if (rarity === 'legendary') {
    const pool = droppableLegendaries().filter(l => !slot || l.slot === slot || (slot === 'weapon' && l.slot === 'offhand'));
    const def = pool.length ? rng.pick(pool) : rng.pick(droppableLegendaries());
    return generateLegendary(state, def.id, { seed: rng.int(0, 0x7fffffff), regionId, tier });
  }
  if (slot === 'consumable') {
    const w = Object.entries(bases.consumableWeights).map(([id, weight]) => ({ id, weight }));
    return makeConsumable(state, baseId || rng.weightedPick(w).id, { seed: rng.int(0, 0x7fffffff) });
  }
  if (slot === 'weapon' || slot === 'spell' || slot === 'offhand') {
    const list = basesFor(slot); const fam = regionFamily(state, regionId); const W = group(state, 'map').regionBiasWeight;
    const def = (baseId && list.find(g => g.id === baseId)) || rng.weightedPick(list.map(g => ({ ...g, weight: fam && g.family === fam ? W : 1 })));
    return makeWeapon(state, def, { rarity, seed: rng.int(0, 0x7fffffff), regionId, tier });
  }
  if (setsData.slots.includes(slot) && !baseId && rng.chance(group(state, 'items').setDropChance)) {
    const candidates = SETS.filter(s => s.rarity === rarity) ; const set = candidates.length ? rng.pick(candidates) : rng.pick(SETS.filter(s => s.rarity !== 'epic' || rarity === 'epic'));
    return makeSetPiece(state, set.id, slot, { seed: rng.int(0, 0x7fffffff), regionId, tier });
  }
  return makeGear(state, slot, { rarity, seed: rng.int(0, 0x7fffffff), regionId, tier, baseId });
}

// A loot spec from the encounters/economy module → a real item. { baseId: 'loot' | itemId36 | consumable | legendary id
// | set piece 'hide_helmet' | base id, rarity, region, seed, slot? }.
export function itemFromSpec(state, spec) {
  const { rarity = 'common', region = null, seed, slot = null } = spec; const baseId = spec.baseId || 'loot';
  const tier = spec.tier || regionTier(state, region);
  if (baseId === 'loot') return generateItem(state, { slot, rarity, regionId: region, tier, seed });
  if (legendaryDef(baseId)) return generateLegendary(state, baseId, { seed, regionId: region, tier });
  if (consumableDef(baseId)) return makeConsumable(state, baseId, { qty: spec.qty || 1, seed });
  const w = weaponDefById(baseId) || (gameById(baseId)); if (w) return makeWeapon(state, w, { rarity, seed, regionId: region, tier });
  const m = /^([a-z]+)_(helmet|torso|pants|boots)$/.exec(baseId); if (m && setDef(m[1])) return makeSetPiece(state, m[1], m[2], { seed, regionId: region, tier });
  for (const s of ['helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace']) if (basesFor(s).some(b => b.id === baseId)) return makeGear(state, s, { rarity, seed, regionId: region, tier, baseId });
  return generateItem(state, { slot, rarity, regionId: region, tier, seed });
}

// Turn c.pendingLoot into items in the grid, or onto the tile when the grid is full. Honours the per-run
// Legendary cap (a capped Legendary spec drops as an Epic of the same slot). Returns what was materialised.
export function materialisePendingLoot(state, ctx, c) {
  if (!c?.pendingLoot?.length) return [];
  const I = group(state, 'items'), G = group(state, 'grid'); const out = [];
  const specs = c.pendingLoot.splice(0, c.pendingLoot.length);
  for (const spec of specs) {
    // A complete item (tile pickup, trade, auction lot, a worn item taken in PvP) passes straight through.
    if (spec.item) {
      const item = structuredClone(spec.item); delete item.droppedAt; delete item.round;
      const fitted = insert(c, item, { stackMax: G.stack });
      if (fitted) { note(state, `${c.name} takes ${item.name}`, 'loot', ctx.now); out.push({ item, where: 'grid' }); }
      else { delete c.items[item.id]; const key = c.pos || 'limbo'; (state.tileLoot[key] ||= []).push({ ...item, droppedAt: ctx.now, round: state.round }); note(state, `${c.name}'s grid is full: ${item.name} stays on the tile`, 'loot', ctx.now); out.push({ item, where: 'tile' }); }
      continue;
    }
    let s = { ...spec };
    const isLegendary = s.rarity === 'legendary' || legendaryDef(s.baseId);
    if (isLegendary && (state.legendariesDropped || 0) >= I.legendaryPerRun) { s = { ...s, rarity: 'epic', baseId: legendaryDef(s.baseId) ? 'loot' : s.baseId, slot: s.slot || legendaryDef(s.baseId)?.slot || null }; if (s.slot === 'cape' || s.slot === 'offhand') s.slot = 'weapon'; if (s.slot === 'consumable') s.slot = null; }
    const item = itemFromSpec(state, s);
    if (item.legendaryId) state.legendariesDropped = (state.legendariesDropped || 0) + 1;
    const fitted = insert(c, item, { stackMax: G.stack });
    if (fitted) { note(state, `${c.name} picks up ${item.name}${item.qty > 1 ? ` ×${item.qty}` : ''}`, 'loot', ctx.now); out.push({ item, where: 'grid' }); }
    else {
      delete c.items[item.id];
      const key = c.pos || 'limbo'; (state.tileLoot[key] ||= []).push({ ...item, droppedAt: ctx.now, round: state.round });
      note(state, `${c.name}'s grid is full: ${item.name} stays on the tile`, 'loot', ctx.now); out.push({ item, where: 'tile' });
    }
  }
  return out;
}
export const seedFrom = (str) => hash32(String(str));
