// The grid inventory and the paper doll (SPEC.md › Inventory grid), plus the gear effects that hang off worn
// items: affix damage hooks, Blockcraft set bonuses and the Named Legendaries this module owns.
//
// Events: GRID_MOVE {itemId, x, y, rot}  GRID_EQUIP {itemId, slot}  GRID_UNEQUIP {slot}  GRID_DROP {itemId}
//         GRID_SORT {}  GRID_RESIZE {playerId, cols, rows} (GM). All take an optional playerId (GM acting for a seat).
// Contracts with sibling modules:
//   - encounters/economy put loot specs on c.pendingLoot; this module materialises them at turn start/end and
//     before every GRID_* event (materialisePendingLoot in characters/generator.js).
//   - Chaos sets c.gridEffects = ['scramble' | 'shrink' | 'steal']; applied at that character's next turn start.
//   - legendaryEffects[id] = { onEquip, onUnequip, onUse(state, ctx, c, payload, item), onZero(state, ctx, c, info) };
//     the items module calls onUse for Legendary consumables and tools and passes the item.
//   - consumables.satchel is registered here (adds a column).
import { register, refuse, requireGm, requirePhase, requireActor } from '../reducer.js';
import { characterOf, note, livingCharacters } from '../state.js';
import { hooks as runHooks } from './run.js';
import { damageHooks, deathHooks, legendaryEffects, consumables } from '../hooks.js';
import { health, maxHealth as moveMaxHealth, gold } from '../health.js';
import { streamRng } from '../rng.js';
import { group } from '../balance.js';
import * as hex from '../hex.js';
import * as G from '../characters/grid.js';
import { WORN_SLOTS, recomputeSets, recomputePassives, wornItems, wornAffixes, hasSetBonus, effectiveStats } from '../characters/character.js';
import { materialisePendingLoot, legendaryDef, LEGENDARIES } from '../characters/generator.js';

// ── helpers ──────────────────────────────────────────────────────
export function actingCharacter(state, ctx, payload = ctx.payload) {
  const pid = payload.playerId || ctx.actor; requireActor(state, ctx, pid);
  const c = characterOf(state, pid); if (!c) refuse('no character for this seat', 'character');
  return { pid, c };
}
const RING_SLOTS = ['ring1', 'ring2', 'ring3', 'ring4'];
export function slotsFor(item) {
  switch (item?.slot) {
    case 'weapon': return ['mainhand', 'offhand'];
    case 'offhand': return ['offhand'];
    case 'spell': return ['spell1', 'spell2'];
    case 'ring': return RING_SLOTS;
    case 'helmet': case 'torso': case 'pants': case 'gloves': case 'boots': case 'necklace': return [item.slot];
    case 'cape': return ['cape'];
    default: return [];
  }
}
export const wornSlotOf = (c, itemId) => WORN_SLOTS.find(s => c.worn[s]?.id === itemId) || null;
export function findItem(c, itemId) { const it = c.items[itemId]; if (!it) refuse('no such item', 'item'); return it; }
export function removeItem(state, c, item) {
  const slot = wornSlotOf(c, item.id); if (slot) c.worn[slot] = null;
  G.remove(c, item.id, { forget: true });
}
// Consume one unit of a consumable (or the whole item when it does not stack).
export function consumeOne(state, c, item) {
  if (item.stackable && (item.qty || 1) > 1) { item.qty -= 1; const cell = G.cellOf(c, item.id); if (cell) cell.qty = item.qty; return false; }
  removeItem(state, c, item); return true;
}
function dropToTile(state, ctx, c, item, why = 'dropped') {
  const key = c.pos || 'start';
  (state.tileLoot[key] ||= []).push({ ...item, droppedAt: ctx.now, round: state.round, by: c.id });
  note(state, `${c.name} ${why} ${item.name}`, 'loot', ctx.now);
}

// After any change to c.worn: sets, passives, the torso max-Health utility, legendary hooks.
export function afterWornChange(state, ctx, c) {
  recomputeSets(state, ctx, c);
  const bonus = wornAffixes(c).filter(a => a.kind === 'utility' && a.effect === 'maxHealth').reduce((s, a) => s + Number(a.value || 0), 0);
  const had = c.flags.wornMaxHealth || 0;
  if (bonus !== had) { moveMaxHealth(state, c, bonus - had, 'worn gear', ctx); if (bonus > had) health(state, c, bonus - had, 'worn gear', ctx); c.flags.wornMaxHealth = bonus; }
  recomputePassives(state, ctx, c);
}

export function equip(state, ctx, c, item, slot) {
  const legal = slotsFor(item); if (!legal.length) refuse(`${item.name} cannot be worn`, 'slot');
  if (item.twoHand) slot = 'mainhand';
  if (!slot) slot = legal.find(s => !c.worn[s]) || legal[0];
  if (!legal.includes(slot)) refuse(`${item.name} does not go in ${slot}`, 'slot');
  if (slot === 'cape' && item.legendaryId !== 'infernalmantle') refuse('only the Infernal Mantle opens the cape slot', 'slot');
  const L = ctx.B('legendaries');
  if (item.legendaryId === 'pedestalblade' && c.level < L.pedestalLevel) refuse(`the Pedestal Blade cannot be drawn under level ${L.pedestalLevel}`, 'level');
  const from = wornSlotOf(c, item.id); const fromCell = G.cellOf(c, item.id);
  if (!from && !fromCell) refuse('item is not yours to equip', 'item');
  const displaced = [];
  if (c.worn[slot] && c.worn[slot].id !== item.id) displaced.push({ slot, item: c.worn[slot] });
  if (item.twoHand && c.worn.offhand) displaced.push({ slot: 'offhand', item: c.worn.offhand });
  if (slot === 'offhand' && c.worn.mainhand?.twoHand) displaced.push({ slot: 'mainhand', item: c.worn.mainhand });
  // Lift the item, then find room for everything it pushes out; roll back if anything will not fit.
  if (from) c.worn[from] = null; else G.remove(c, item.id);
  const placed = [];
  for (const d of displaced) {
    c.worn[d.slot] = null;
    const spot = G.firstFit(c, d.item);
    if (!spot) { for (const p of placed) G.remove(c, p.id); for (const d2 of displaced) c.worn[d2.slot] = d2.item; if (from) c.worn[from] = item; else G.place(c, item, fromCell.x, fromCell.y, fromCell.rot); refuse(`no room in the grid for ${d.item.name}`, 'room'); }
    G.place(c, d.item, spot.x, spot.y, spot.rot); placed.push(d.item);
  }
  c.worn[slot] = item; c.items[item.id] = item;
  for (const d of displaced) legendaryEffects[d.item.legendaryId]?.onUnequip?.(state, ctx, c, d.item);
  legendaryEffects[item.legendaryId]?.onEquip?.(state, ctx, c, item);
  afterWornChange(state, ctx, c);
  return { slot, displaced: displaced.map(d => d.item) };
}
export function unequip(state, ctx, c, slot, at = null) {
  const item = c.worn[slot]; if (!item) refuse(`nothing in ${slot}`, 'slot');
  c.worn[slot] = null;
  const spot = at && G.fits(c, item, at.x, at.y, at.rot || 0) ? at : G.firstFit(c, item);
  if (!spot) { c.worn[slot] = item; refuse(`no room in the grid for ${item.name}`, 'room'); }
  G.place(c, item, spot.x, spot.y, spot.rot || 0);
  legendaryEffects[item.legendaryId]?.onUnequip?.(state, ctx, c, item);
  afterWornChange(state, ctx, c);
  return item;
}

// Chaos effects on the grid, applied at the owner's next turn start.
export function applyGridEffects(state, ctx, c) {
  const W = ctx.B('wheels');
  for (const eff of c.gridEffects || []) {
    if (eff === 'scramble') { G.scramble(c, streamRng(state, 'misc')); note(state, `Chaos scrambles ${c.name}'s grid`, 'chaos', ctx.now); }
    else if (eff === 'shrink') { const dropped = G.shrinkRow(c); for (const it of dropped) { delete c.items[it.id]; dropToTile(state, ctx, c, it, 'loses'); } c.effects.push({ id: 'gridshrink', kind: 'grid', turnsLeft: W.chaosGridShrinkRounds, data: {} }); note(state, `Chaos shrinks ${c.name}'s grid by a row`, 'chaos', ctx.now); }
    else if (eff === 'steal') { const items = G.gridItems(c); if (items.length) { const it = streamRng(state, 'misc').pick(items); delete c.items[it.id]; G.remove(c, it.id); note(state, `Chaos steals ${it.name} from ${c.name}'s grid`, 'chaos', ctx.now); } }
  }
  c.gridEffects = [];
}
function tickGridEffects(state, ctx, c) {
  for (const e of c.effects.filter(e => e.id === 'gridshrink')) { e.turnsLeft -= 1; if (e.turnsLeft <= 0) { c.grid.rows += 1; c.effects.splice(c.effects.indexOf(e), 1); note(state, `${c.name}'s grid is whole again`, 'chaos', ctx.now); } }
}

// ── events ───────────────────────────────────────────────────────
register({
  GRID_MOVE(state, ev, ctx) {
    requirePhase(state, 'creation', 'playing', 'ended');
    const { c } = actingCharacter(state, ctx); materialisePendingLoot(state, ctx, c);
    const { itemId, x, y, rot = 0 } = ctx.payload; const item = findItem(c, itemId);
    const slot = wornSlotOf(c, itemId);
    if (slot) { unequip(state, ctx, c, slot, { x, y, rot }); return; }
    // Dropping a consumable onto a stack of the same base merges it.
    const occ = G.occupancy(c, itemId); const under = occ.get(G.cellKey(x, y)); const target = under ? c.items[under] : null;
    if (target && item.stackable && target.baseId === item.baseId) { const merged = G.stack(c, item, ctx.B('grid').stack); if (merged && item.qty <= 0) { G.remove(c, item.id, { forget: true }); return; } if (merged) { G.cellOf(c, item.id).qty = item.qty; return; } }
    if (!G.fits(c, item, x, y, rot)) refuse('does not fit there', 'fit');
    G.place(c, item, x, y, rot);
  },
  GRID_EQUIP(state, ev, ctx) {
    requirePhase(state, 'creation', 'playing');
    const { c } = actingCharacter(state, ctx); materialisePendingLoot(state, ctx, c);
    const item = findItem(c, ctx.payload.itemId);
    const r = equip(state, ctx, c, item, ctx.payload.slot || null);
    note(state, `${c.name} equips ${item.name}`, 'gear', ctx.now);
    return r;
  },
  GRID_UNEQUIP(state, ev, ctx) {
    requirePhase(state, 'creation', 'playing');
    const { c } = actingCharacter(state, ctx); materialisePendingLoot(state, ctx, c);
    if (!WORN_SLOTS.includes(ctx.payload.slot)) refuse('no such slot', 'slot');
    unequip(state, ctx, c, ctx.payload.slot);
  },
  GRID_DROP(state, ev, ctx) {
    requirePhase(state, 'creation', 'playing');
    const { c } = actingCharacter(state, ctx); materialisePendingLoot(state, ctx, c);
    const item = findItem(c, ctx.payload.itemId);
    if (wornSlotOf(c, item.id)) refuse('unequip it first', 'worn');
    G.remove(c, item.id, { forget: true });
    if (state.phase === 'playing' && c.pos) dropToTile(state, ctx, c, item, 'drops'); else note(state, `${c.name} discards ${item.name}`, 'loot', ctx.now);
  },
  GRID_SORT(state, ev, ctx) { const { c } = actingCharacter(state, ctx); materialisePendingLoot(state, ctx, c); G.autoSort(c); },
  GRID_RESIZE(state, ev, ctx) {
    requireGm(ctx); const c = characterOf(state, ctx.payload.playerId); if (!c) refuse('no character');
    const Gb = ctx.B('grid');
    try { G.resize(c, ctx.payload.cols ?? c.grid.cols, ctx.payload.rows ?? c.grid.rows, { maxCols: Gb.maxCols }); } catch (e) { refuse(e.message, 'room'); }
    note(state, `GM resized ${c.name}'s grid to ${c.grid.cols}×${c.grid.rows}`, 'gm', ctx.now);
  },
});

consumables.satchel = (state, ctx, c, payload, item) => {
  const Gb = ctx.B('grid'); if (c.grid.cols >= Gb.maxCols) refuse(`the grid is already ${Gb.maxCols} wide`, 'room');
  c.grid.cols += 1; if (item) consumeOne(state, c, item);
  note(state, `${c.name}'s satchel adds a column (${c.grid.cols}×${c.grid.rows})`, 'gear', ctx.now);
};

// ── turn hooks: loot, Chaos grid effects ─────────────────────────
runHooks.turnStart.push((state, ctx, pid) => {
  const c = characterOf(state, pid); if (!c) return;
  tickGridEffects(state, ctx, c);
  if (c.gridEffects?.length) applyGridEffects(state, ctx, c);
  materialisePendingLoot(state, ctx, c);
  // Pool Ladder: whoever is trapped bleeds at the start of their turn.
  const pooled = c.effects.find(e => e.id === 'pooled');
  if (pooled) { health(state, c, -ctx.B('legendaries').poolDamage, 'the pool', ctx); pooled.turnsLeft -= 1; if (pooled.turnsLeft <= 0) c.effects.splice(c.effects.indexOf(pooled), 1); }
  for (const e of c.effects.filter(e => e.id === 'impostor')) { e.turnsLeft -= 1; if (e.turnsLeft <= 0) c.effects.splice(c.effects.indexOf(e), 1); }
});
runHooks.turnEnd.push((state, ctx, pid) => { const c = characterOf(state, pid); if (c) materialisePendingLoot(state, ctx, c); });

// ── damage hooks: affixes, sets, legendaries ─────────────────────
const charOfInfo = (state, id) => state.characters[id] || Object.values(state.characters).find(c => c.playerId === id) || null;
const isMonster = (state, id) => !!state.monsters?.[id];
const matches = (a, info) => !a.target ? true : a.target.game ? a.target.game === info.gameId : a.target.family ? a.target.family === (info.item?.family || info.family) : false;
const clampReduce = (v) => Math.max(0, Math.min(0.9, v));

damageHooks.stake.push((state, ctx, info) => {
  const a = charOfInfo(state, info.attackerId); const t = info.targetKind === 'character' ? charOfInfo(state, info.targetId) : null;
  if (a) {
    const disc = wornAffixes(a).filter(x => x.kind === 'stake' && matches(x, info)).reduce((s, x) => s + Number(x.value || 0), 0);
    if (disc) { info.stake = Math.max(1, Math.round(info.stake * (1 - clampReduce(disc)))); info.notes.push(`stake −${Math.round(disc * 100)}% (affix)`); }
  }
  if (t?.passives?.minStakeAgainst && info.stake < t.passives.minStakeAgainst) { info.stake = t.passives.minStakeAgainst; info.notes.push(`The Croupier's Coat: stake at least ${info.stake}`); }
});
damageHooks.outgoing.push((state, ctx, info) => {
  const a = charOfInfo(state, info.attackerId); if (!a) return;
  const L = ctx.B('legendaries');
  let mult = 1;
  const dmg = wornAffixes(a).filter(x => x.kind === 'damage' && matches(x, info)).reduce((s, x) => s + Number(x.value || 0), 0);
  if (dmg) { mult *= 1 + dmg; info.notes.push(`+${Math.round(dmg * 100)}% damage (affix)`); }
  if (wornItems(a).some(it => it.legendaryId === 'amuletofpotency')) { mult *= 1 + L.potencyDamage; info.notes.push('Amulet of Potency'); }
  if (info.item?.legendaryId === 'bustercleaver') { mult *= 1 + L.busterDamage; info.notes.push('Buster Cleaver'); }
  if (mult !== 1) info.mult = info.mult * mult;
});
// Guard affixes, set guard and Grit (class guards live in handlers/classes.js).
damageHooks.incoming.push((state, ctx, info) => {
  if (info.targetKind !== 'character') return;
  const t = charOfInfo(state, info.targetId); if (!t) return;
  const H = ctx.B('health');
  let reduce = wornAffixes(t).filter(x => x.kind === 'guard' && matches(x, info)).reduce((s, x) => s + Number(x.value || 0), 0);
  const grit = effectiveStats(state, t).grit * H.gritReducePerPoint; reduce += grit;
  if (hasSetBonus(t, 'gem') && state.fight && t.flags.gemFight !== state.fight.id) { t.flags.gemFight = state.fight.id; info.cancel = true; info.notes.push('Gem set: the first hit glances off'); return; }
  if (reduce) { info.mult = info.mult * (1 - clampReduce(reduce)); info.notes.push(`−${Math.round(clampReduce(reduce) * 100)}% taken (guard ${Math.round((reduce - grit) * 100)}%, grit ${Math.round(grit * 100)}%)`); }
});
function giltWear(state, ctx, c) {
  if (!c || !state.fight || c.flags.giltFight === state.fight.id) return;
  c.flags.giltFight = state.fight.id; let changed = false;
  for (const slot of WORN_SLOTS) { const it = c.worn[slot]; if (it?.setId === 'gilt') { it.charges = (it.charges || 0) - 1; if (it.charges <= 0) { c.worn[slot] = null; delete c.items[it.id]; note(state, `${c.name}'s ${it.name} crumbles to dust`, 'gear', ctx.now); changed = true; } } }
  if (changed) afterWornChange(state, ctx, c);
}
damageHooks.afterHit.push((state, ctx, info) => { giltWear(state, ctx, charOfInfo(state, info.attackerId)); if (info.targetKind === 'character') giltWear(state, ctx, charOfInfo(state, info.targetId)); });
damageHooks.afterMiss.push((state, ctx, info) => {
  const a = charOfInfo(state, info.attackerId); if (!a) return;
  giltWear(state, ctx, a); if (info.targetKind === 'character') giltWear(state, ctx, charOfInfo(state, info.targetId));
  const lost = Number(info.lost ?? info.stake) || 0; if (!lost) return;
  // Rail Lance lock: the loss becomes a push.
  const lock = a.effects.find(e => e.id === 'raillock' && e.data?.fightId === state.fight?.id && e.data?.targetId === info.targetId);
  if (lock && info.item?.legendaryId === 'raillance') { health(state, a, lost, 'Rail Lance: a push', ctx); a.effects.splice(a.effects.indexOf(lock), 1); info.notes.push('Rail Lance: cannot miss'); return; }
  const ward = wornAffixes(a).filter(x => x.kind === 'ward' && matches(x, info)).reduce((s, x) => s + Number(x.value || 0), 0);
  if (ward) { const back = Math.round(lost * Math.min(1, ward)); if (back) { health(state, a, back, 'ward refund', ctx); info.notes.push(`ward refunds ${back}`); } }
  const cap = a.passives?.stakeCap; if (cap && lost > cap) { health(state, a, lost - cap, 'stake cap', ctx); info.notes.push(`stake capped at ${cap}`); }
});
// Death: the pendant, the fairy, the toadstool. info = { charId, killerId, cause, prevented?, noDrops?, noMissTurns? }.
deathHooks.onZero.push((state, ctx, info) => {
  const c = state.characters[info.charId]; if (!c || info.prevented) return;
  const L = ctx.B('legendaries');
  const pendantSlot = WORN_SLOTS.find(s => c.worn[s]?.legendaryId === 'pendant');
  if (pendantSlot) { const p = c.worn[pendantSlot]; c.worn[pendantSlot] = null; delete c.items[p.id]; health(state, c, 1 - c.health, 'the pendant', ctx, { overheal: false }); afterWornChange(state, ctx, c); info.prevented = true; note(state, `${c.name}'s Weighted Companion Pendant is destroyed. It never said goodbye.`, 'death', ctx.now); return; }
  const jar = G.gridItems(c).find(it => it.legendaryId === 'fairyjar');
  if (jar) { G.remove(c, jar.id, { forget: true }); health(state, c, Math.round(c.maxHealth * L.fairyRevive) - c.health, 'Fairy in a Jar', ctx); info.prevented = true; info.noDrops = true; info.noMissTurns = true; note(state, `The jar breaks: ${c.name} stands back up`, 'death', ctx.now); return; }
  const life = c.effects.find(e => e.id === 'extralife');
  if (life) { c.effects.splice(c.effects.indexOf(life), 1); info.noDrops = true; info.noMissTurns = true; info.noLevelLoss = true; note(state, `${c.name} spends an extra life`, 'death', ctx.now); }
});
// Economy affix: Gold from KOs. info = { charId (the dead), killerId }.
deathHooks.onDeath.push((state, ctx, info) => {
  const killerId = info.killerId ?? info.byId ?? null; const k = killerId ? charOfInfo(state, killerId) : null; if (!k) return;
  const bonus = wornAffixes(k).filter(x => x.kind === 'economy' && x.effect === 'gold').reduce((s, x) => s + Number(x.value || 0), 0);
  if (bonus) gold(state, k, Math.round(ctx.B('gold').perKO * bonus), 'greedy affix', ctx);
});

// ── Legendary effects owned by this module ───────────────────────
const posOf = (c) => c?.pos ? hex.parse(c.pos) : null;
const dist = (a, b) => (posOf(a) && posOf(b)) ? hex.distance(posOf(a), posOf(b)) : Infinity;
const onceUse = (c, key, max = 1) => { c.activeUses[key] = (c.activeUses[key] || 0) + 1; if (c.activeUses[key] > max) { c.activeUses[key] -= 1; refuse(`${key} is spent for this run`, 'uses'); } };
// Free-for-all score (SPEC.md › End of the run): Gold + 50 per kill + Health remaining.
export function scoreOf(state, c) { return (c.gold || 0) + (c.kills || 0) * group(state, 'gold').scorePerKill + (c.health || 0); }

Object.assign(legendaryEffects, {
  pedestalblade: { onEquip(state, ctx, c) { recomputePassives(state, ctx, c); } },
  gravitygauntlet: { onUse(state, ctx, c, payload) {
    const t = charOfInfo(state, payload.targetId); if (!t || t.id === c.id) refuse('pick a player', 'target');
    if (dist(c, t) > ctx.B('legendaries').gravityRange) refuse('out of range', 'range');
    onceUse(c, 'gravitygauntlet'); t.pos = c.pos; note(state, `${c.name}'s Gravity Gauntlet pulls ${t.name} in`, 'legendary', ctx.now);
  } },
  pendant: { viaDeathHook: true },
  emberflask: { onUse(state, ctx, c, payload, item) { if (!item || item.charges <= 0) refuse('the flask is empty', 'charges'); item.charges -= 1; health(state, c, ctx.B('legendaries').emberHeal, 'Ember Flask', ctx); }, innRefill: true },
  toadstool: { onUse(state, ctx, c, payload, item) { c.effects.push({ id: 'extralife', kind: 'legendary', turnsLeft: -1, data: {} }); if (item) consumeOne(state, c, item); note(state, `${c.name} banks an extra life`, 'legendary', ctx.now); } },
  bustercleaver: { swingsLast: true },
  pipbuoy: {},
  impostorsvisor: { onUse(state, ctx, c, payload) {
    const t = charOfInfo(state, payload.asPlayerId || payload.targetId); if (!t || t.id === c.id) refuse('pick a player to look like', 'target');
    c.effects = c.effects.filter(e => e.id !== 'impostor'); c.effects.push({ id: 'impostor', kind: 'legendary', turnsLeft: ctx.B('social').impostorTurns, data: { asPlayerId: t.playerId } });
  }, lettersSafe: true },
  chickendinner: { onUse(state, ctx, c, payload, item) {
    if (state.mode !== 'royale') refuse('only in Royale', 'mode');
    if (livingCharacters(state).some(o => o.id !== c.id)) refuse('only the last player standing may eat', 'mode');
    health(state, c, c.maxHealth - c.health, 'Chicken Dinner', ctx); c.flags.extraVault = (c.flags.extraVault || 0) + 1; if (item) consumeOne(state, c, item);
  } },
  raillance: { onUse(state, ctx, c, payload) {
    if (!state.fight) refuse('not in a fight', 'fight');
    if (c.effects.some(e => e.id === 'raillock' && e.data.fightId === state.fight.id) || c.flags.railFight === state.fight.id) refuse('one lock per fight', 'uses');
    const t = charOfInfo(state, payload.targetId) || (state.monsters[payload.targetId] ? { id: payload.targetId, pos: state.monsters[payload.targetId].pos, name: state.monsters[payload.targetId].name } : null);
    if (!t) refuse('pick a target', 'target'); if (dist(c, t) > ctx.B('legendaries').railRange) refuse('out of range', 'range');
    c.flags.railFight = state.fight.id; c.effects.push({ id: 'raillock', kind: 'legendary', turnsLeft: -1, data: { fightId: state.fight.id, targetId: payload.targetId } });
    note(state, `${c.name} locks the Rail Lance on ${t.name}`, 'legendary', ctx.now);
  } },
  amuletofpotency: {},
  infernalmantle: { opensSlot: 'cape' },
  carapace: { onUse(state, ctx, c, payload, item) {
    const others = livingCharacters(state).filter(o => o.id !== c.id); if (!others.length) refuse('nobody to hit', 'target');
    const leader = others.slice().sort((a, b) => scoreOf(state, b) - scoreOf(state, a))[0];
    health(state, leader, -ctx.B('legendaries').carapaceDamage, 'Spiny Blue Carapace', ctx, { ignoreShield: true }); if (item) consumeOne(state, c, item);
    note(state, `A blue shell finds ${leader.name}`, 'legendary', ctx.now);
  } },
  ocarina: { onUse(state, ctx, c, payload) {
    const song = payload.song; if (!['inn', 'chaos', 'pet'].includes(song)) refuse('unknown song', 'song');
    const used = c.activeUses.ocarina || (c.activeUses.ocarina = {}); if (used[song]) refuse(`that song is sung for this run`, 'uses'); used[song] = 1;
    if (song === 'inn') { if (!c.lastInnPos) refuse('you have not visited an Inn', 'target'); c.pos = c.lastInnPos; }
    if (song === 'chaos') c.effects.push({ id: 'skipchaos', kind: 'legendary', turnsLeft: 1, data: {} });
    if (song === 'pet') { const pet = c.pets.find(p => p.fainted); if (!pet) refuse('no fainted pet', 'target'); pet.fainted = false; pet.faintedAt = null; pet.power = 1; }
    note(state, `${c.name} plays the ${song} song`, 'legendary', ctx.now);
  } },
  fairyjar: { passiveInGrid: true },
  poolladder: { onUse(state, ctx, c, payload) {
    const L = ctx.B('legendaries'); const key = payload.hexKey || c.pos; if (!key) refuse('pick a hex', 'target');
    state.pools ||= {}; const act = payload.action || 'place';
    if (act === 'place') state.pools[key] = { ownerId: c.id, open: true };
    else if (act === 'take') { const pool = state.pools[key]; if (!pool) refuse('no pool there', 'target'); pool.open = false; for (const o of Object.values(state.characters)) if (o.pos === key && o.id !== c.id && !o.effects.some(e => e.id === 'pooled')) o.effects.push({ id: 'pooled', kind: 'legendary', turnsLeft: L.poolTurns, data: { hexKey: key } }); }
    else if (act === 'return') { const pool = state.pools[key]; if (pool) pool.open = true; for (const o of Object.values(state.characters)) o.effects = o.effects.filter(e => !(e.id === 'pooled' && e.data.hexKey === key)); }
    else refuse('place, take or return', 'action');
  } },
  cameraobscura: { onUse(state, ctx, c, payload, item) {
    const L = ctx.B('legendaries'); const shots = c.activeUses.cameraobscura || 0; if (shots >= L.cameraShots) refuse('out of film', 'uses'); c.activeUses.cameraobscura = shots + 1;
    const t = charOfInfo(state, payload.targetId);
    if (t) { c.flags.photos ||= {}; c.flags.photos[t.id] = { health: t.health, worn: Object.fromEntries(WORN_SLOTS.map(s => [s, t.worn[s]?.name || null])), ts: ctx.now }; note(state, `${c.name} photographs ${t.name}`, 'legendary', ctx.now); return; }
    const m = state.monsters[payload.targetId]; if (!m) refuse('pick a target', 'target');
    const before = m.health; m.health = Math.max(0, m.health - L.cameraDamage); m.pinnedTurns = 1;
    state.ledgerSeq = (state.ledgerSeq || 0) + 1; state.ledger.push({ n: state.ledgerSeq, ts: ctx.now, kind: 'monsterHealth', charId: m.id, amount: -L.cameraDamage, moved: m.health - before, why: 'Camera Obscura' });
    if (m.health <= 0) m.dead = true;
  } },
  resetcartridge: { onUse(state, ctx, c, payload, item) {
    c.effects = []; c.flags.pactInterestCleared = true; c.wanted = 0; if (c.lastSafePos) c.pos = c.lastSafePos;
    if (state.pools) for (const p of Object.values(state.pools)) p.open = true;
    if (item) consumeOne(state, c, item); note(state, `${c.name} resets to a clean state`, 'legendary', ctx.now);
  } },
  croupierscoat: {},
});
legendaryEffects.fairyjar.viaDeathHook = true;   // the pendant and the fairy act through deathHooks.onZero above

// Which Legendary effects are implemented here vs. owned by another module (documented stubs).
export const LEGENDARY_OWNERS = Object.fromEntries(LEGENDARIES.map(l => [l.id, l.effect.owner]));
export const LEGENDARY_STUBS = LEGENDARIES.filter(l => l.effect.owner !== 'characters').map(l => l.id);
export { legendaryDef };
