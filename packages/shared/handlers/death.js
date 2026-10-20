// Death and the Graveyard. The fight module brings a character to 0 and calls deathHooks.onZero (anything that
// may prevent the death: Phoenix Feather is the items module's, the Pendant / Fairy / Toadstool are handled here),
// then deathHooks.onDeath when nothing did. Penalties (SPEC.md › Health economy): drops, missed turns, a level
// lost to a player or boss, Gold to the killer, bounties collected; the runStart/turnStart hook counts the missed
// turns down and wakes the character at the nearest Graveyard at death.wakeFraction.
//
// Events: GM_RESET_CHAR { playerId | charId }  Reset Cartridge from the console (the items module calls
//         resetCharacter() for the consumable).
// Exports for siblings: killCharacter(state, ctx, c, { killerId, killerKind }) runs the whole chain;
//   reviveAtGraveyard(state, ctx, charId) for an early Phoenix revive by a teammate; resetCharacter(state, ctx, c).
// Prompt opened here: { playerId: killer, kind: 'takeWorn', victimId, options: [itemId] } answered by TILE_TAKE_LOOT.
// Level loss is applied here (c.level and c.maxHealth by health.maxPerLevel) and also counted in
// c.levelLossPending for the characters module to reconcile XP thresholds / stat points.
import { register, refuse, requireGm } from '../reducer.js';
import { deathHooks } from '../hooks.js';
import { characterOf, note } from '../state.js';
import { health, maxHealth, gold } from '../health.js';
import { streamRng } from '../rng.js';
import * as hexm from '../hex.js';
import { hooks as runHooks } from './run.js';
import { dropOnTile } from './tiles.js';
import { counter } from './wheels.js';

export const resolveCharacter = (state, id) => (id && state.characters[id]) || characterOf(state, id) || null;
const wornIds = (c) => new Set(Object.values(c.worn || {}).filter(Boolean).map(i => i.id));
export const isWorn = (c, itemId) => wornIds(c).has(itemId);
export const gridItems = (c) => { const w = wornIds(c); return Object.values(c.items || {}).filter(i => !w.has(i.id)); };
export function removeItem(c, itemId) {
  if (c.items) delete c.items[itemId];
  if (c.grid?.cells) c.grid.cells = c.grid.cells.filter(cell => cell.itemId !== itemId);
  for (const s of Object.keys(c.worn || {})) if (c.worn[s]?.id === itemId) c.worn[s] = null;
}
export function nearestGraveyard(state, pos) {
  const hexes = Object.values(state.map?.hexes || {}).filter(h => h.type === 'graveyard');
  if (!hexes.length) return state.map?.start || pos;
  if (!pos) return hexes[0].key;
  const p = hexm.parse(pos), here = state.map?.hexes?.[pos]?.regionId ?? null;
  // nearest by hex distance; a tie goes to a Graveyard in the region you died in
  const rank = (h) => hexm.distance(p, h) * 2 + (h.regionId === here ? 0 : 1);
  return hexes.slice().sort((a, b) => rank(a) - rank(b))[0].key;
}

// ---- onZero: things that stop a death ---------------------------------------------------------------------
// (The inventory module registers the same three through its legendary table; whichever runs first wins and the
// other sees info.prevented. Both set the same flags: prevented / noDrops / noMissTurns / noLevelLoss.)
deathHooks.onZero.push((state, ctx, info) => {
  if (info.prevented) return;
  const c = state.characters[info.charId]; if (!c) return;
  const L = ctx.B('legendaries');
  const neck = c.worn?.necklace;
  if (neck && neck.legendaryId === 'pendant') {
    removeItem(c, neck.id); health(state, c, 1 - c.health, 'Weighted Companion Pendant', ctx, { ignoreShield: true });
    info.prevented = true; info.preventedBy = 'pendant';
    note(state, `${c.name}'s Weighted Companion Pendant is destroyed. It never said goodbye.`, 'death', ctx.now); return;
  }
  const fairy = gridItems(c).find(it => it.legendaryId === 'fairy' || it.legendaryId === 'fairyjar');
  if (fairy) {
    removeItem(c, fairy.id); health(state, c, Math.round(c.maxHealth * L.fairyRevive) - c.health, 'Fairy in a Jar', ctx, { ignoreShield: true });
    info.prevented = true; info.preventedBy = 'fairy'; info.noDrops = true; info.noMissTurns = true;
    note(state, `The jar breaks and ${c.name} stands back up`, 'death', ctx.now); return;
  }
  if (c.bankedLife) { c.bankedLife = false; info.softDeath = true; info.noDrops = true; info.noMissTurns = true; info.noLevelLoss = true; note(state, `${c.name}'s banked life is spent: no drops, no turns lost`, 'death', ctx.now); }
});

// ---- onDeath: the penalties -------------------------------------------------------------------------------
// info arrives in two spellings: ours { charId, killerId, killerKind } and the items module's
// { charId, byId, byKind, info } (which has already set c.dead / c.deaths / stats and credited the killer's kills).
deathHooks.onDeath.push((state, ctx, info) => {
  const c = state.characters[info.charId]; if (!c) return;
  const alreadyCounted = !!c.dead;
  if (alreadyCounted && (c.deathsPenalised || 0) >= (c.deaths || 0)) return;      // penalties for this death were applied
  const D = ctx.B('death'), G = ctx.B('gold'), H = ctx.B('health');
  const kind = info.killerKind || info.byKind || 'monster';
  const killerId = info.killerId ?? info.byId ?? null;
  const killer = resolveCharacter(state, killerId); const byPlayer = kind === 'player' && killer && killer.id !== c.id;
  const pid = c.playerId, pos = c.pos;
  if (!alreadyCounted) { c.dead = true; c.deaths = (c.deaths || 0) + 1; if (state.stats[pid]) state.stats[pid].deaths += 1; }
  c.deathsPenalised = c.deaths; c.diedTo = kind; c.diedAt = ctx.now;
  const noDrops = info.softDeath || info.noDrops, noMiss = info.softDeath || info.noMissTurns, noLevel = info.softDeath || info.noLevelLoss;
  if (!noDrops) {
    for (const it of gridItems(c)) { if (it.quest || it.baseId === 'citadel_key') continue; removeItem(c, it.id); if (pos) dropOnTile(state, ctx, pos, it, c.id); }   // quest items (the Citadel Key) stay
    const worn = Object.entries(c.worn || {}).filter(([, it]) => it);
    if (byPlayer && worn.length) state.pendingPrompt = { playerId: killer.playerId, kind: 'takeWorn', victimId: c.id, options: worn.map(([, it]) => it.id) };
    else if (worn.length && D.wornDropsOnMonsterDeath > 0) {
      for (const [slot, it] of streamRng(state, 'loot').shuffle(worn).slice(0, D.wornDropsOnMonsterDeath)) { c.worn[slot] = null; delete c.items[it.id]; if (pos) dropOnTile(state, ctx, pos, it, c.id); note(state, `${c.name} drops ${it.name}`, 'death', ctx.now); }
    }
  }
  if (!noMiss) {
    let miss = (kind === 'player' || kind === 'boss') ? D.playerMissTurns : D.monsterMissTurns;
    if (c.classId === 'enforcer') miss = Math.max(0, miss - 1);
    c.missTurns = (c.missTurns || 0) + miss;
  }
  if (!noLevel && (kind === 'player' || kind === 'boss') && D.playerKillLevelLoss > 0) {
    const lose = Math.min(D.playerKillLevelLoss, (c.level || 1) - 1);
    if (lose > 0) { c.level -= lose; maxHealth(state, c, -H.maxPerLevel * lose, 'level lost', ctx); c.levelLossPending = (c.levelLossPending || 0) + lose; note(state, `${c.name} loses a level`, 'death', ctx.now); }
  }
  if (killer && killer.id !== c.id) {
    if (info.byKind == null) { killer.kills = (killer.kills || 0) + 1; if (state.stats[killer.playerId]) state.stats[killer.playerId].kills += 1; }   // the items module credits kills itself
    gold(state, killer, G.perKO, `KO ${c.name}`, ctx); if (state.stats[killer.playerId]) state.stats[killer.playerId].goldEarned += G.perKO;
    counter(killer, 'playerKills'); (killer.questCounters.killed ||= {})[pid] = true;
    const owed = state.bounties.filter(b => b.targetId === pid);
    if (owed.length) {
      const total = owed.reduce((s, b) => s + b.gold, 0);
      gold(state, killer, total, `bounty on ${c.name}`, ctx); state.bounties = state.bounties.filter(b => b.targetId !== pid);
      counter(killer, 'bountiesCollected'); if (state.stats[killer.playerId]) state.stats[killer.playerId].goldEarned += total;
      note(state, `${killer.name} collects ${total} Gold in bounties on ${c.name}`, 'death', ctx.now);
    }
  }
  c.graveyardPos = nearestGraveyard(state, pos);
  c.pos = c.graveyardPos; c.region = state.map?.hexes?.[c.pos]?.regionId ?? c.region;
  // In the player-versus-player modes a kill by a player is final: the loser is out of the run (the mode ends on
  // the last one standing). In Free-for-all and PvE the Graveyard gives everyone back, and the throne ends the run.
  if (kind === 'player' && ['pvp', 'teams', 'royale'].includes(state.mode)) { c.eliminated = true; note(state, `${c.name} is out of the run`, 'death', ctx.now); }
  note(state, `${c.name} is dead (${kind === 'player' ? `killed by ${killer?.name || 'a player'}` : kind}); ${c.missTurns ? `misses ${c.missTurns} turn${c.missTurns === 1 ? '' : 's'}` : 'wakes next turn'}`, 'death', ctx.now);
});

// Runs the whole chain for a character at 0 (the fight module does this itself; GM_HEALTH and the Collector use it).
export function killCharacter(state, ctx, c, { killerId = null, killerKind = 'monster' } = {}) {
  const info = { charId: c.id, killerId, killerKind, prevented: false };
  for (const h of deathHooks.onZero) h(state, ctx, info);
  if (!info.prevented) for (const h of deathHooks.onDeath) h(state, ctx, info);
  return info;
}

// ---- waking -----------------------------------------------------------------------------------------------
export function wake(state, ctx, c, why = 'wakes at the Graveyard') {
  const D = ctx.B('death');
  c.dead = false; c.missTurns = 0; c.diedTo = null;
  c.pos = c.graveyardPos || c.pos; c.lastSafePos = c.pos; c.region = state.map?.hexes?.[c.pos]?.regionId ?? c.region;
  health(state, c, Math.round(c.maxHealth * D.wakeFraction) - c.health, 'Graveyard', ctx, { ignoreShield: true });
  for (const h of deathHooks.onRevive) h(state, ctx, { charId: c.id });
  note(state, `${c.name} ${why} (${c.health} Health)`, 'death', ctx.now);
}
export function reviveAtGraveyard(state, ctx, charId, { byId = null } = {}) {
  const c = state.characters[charId]; if (!c || !c.dead) return false;
  wake(state, ctx, c, byId ? `is revived by ${state.characters[byId]?.name || 'a friend'}` : 'is revived');
  return true;
}
runHooks.turnStart.push((state, ctx, pid) => {
  { const c0 = characterOf(state, pid); if (c0?.eliminated) return 'skip'; }
  const c = characterOf(state, pid); if (!c) return;
  if (c.dead) {
    if ((c.missTurns || 0) > 0) { c.missTurns -= 1; note(state, `${c.name} lies in the Graveyard${c.missTurns ? ` (${c.missTurns} more)` : ''}`, 'death', ctx.now); return 'skip'; }
    wake(state, ctx, c); return;
  }
  if ((c.missTurns || 0) > 0) { c.missTurns -= 1; note(state, `${c.name} sits this turn out`, 'turn', ctx.now); return 'skip'; }
});

// ---- Reset Cartridge --------------------------------------------------------------------------------------
export function resetCharacter(state, ctx, c) {
  c.effects = []; c.gridEffects = []; delete c.pool; delete c.pooledBy;
  for (const id of c.pactIds || []) { const p = state.pacts[id]; if (p && p.owed > 0) { p.owed = Math.max(0, p.principal - (p.paid || 0)); p.interest = 0; p.status = 'open'; p.overdueTurns = 0; } }
  if (c.lastSafePos && state.map?.hexes?.[c.lastSafePos]) { c.prevPos = c.pos; c.pos = c.lastSafePos; c.region = state.map.hexes[c.pos].regionId; }
  note(state, `${c.name} is reset to a clean state`, 'gm', ctx.now);
}
register({
  GM_RESET_CHAR(state, ev, ctx) {
    requireGm(ctx);
    const c = resolveCharacter(state, ctx.payload.charId || ctx.payload.playerId); if (!c) refuse('no such character');
    resetCharacter(state, ctx, c);
  },
});
