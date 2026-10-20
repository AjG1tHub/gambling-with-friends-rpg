// Game modes, end conditions, placings, difficulty tiers, the vault, veterans, seasons and Royale
// (SPEC.md › Runs, game modes and meta progression; End of the run; Between runs; DECISIONS.md 11).
//
// Hooks this module pushes:
//   runHooks.runStart (unshifted, so it runs first)  state.modeAdjust = modeAdjust(state) for the map/monster generators
//   runHooks.runStart (pushed, runs after map+monsters) PvP only: Encounter hexes become Arenas, monsters go
//   damageHooks.outgoing                              PvE: no character→character damage; Teams: none inside a team
//   runHooks.endCheck                                 the mode's end condition
//   runHooks.roundEnd / turnStart                     Royale: the circle shrinks; outside it you bleed
//   onAfter                                           Hall of Fame rows and the season counter once the run has ended
// Events: VAULT_BANK { playerId, itemIds }, VETERAN_SAVE { playerId } (both after phase 'ended').
import { register, refuse, onAfter } from '../reducer.js';
import { activeSeats, characterOf, playerOfCharacter, teamOf, sameTeam, note } from '../state.js';
import { hooks as runHooks } from './run.js';
import * as hex from '../hex.js';
import { health } from '../health.js';
import { damageHooks, consumables } from '../hooks.js';
import { B as BAL } from '../balance.js';
import { applyPenalty } from './challenge.js';

const charOf = (state, pid) => characterOf(state, pid);
const nameOf = (state, pid) => state.players[pid]?.name || pid;
const seatsWithCharacter = (state) => activeSeats(state).filter(id => charOf(state, id));
// Standing = still in the run: alive, or dead but due to wake at the Graveyard. Only `eliminated` (a player kill in
// pvp/teams/royale, set by death.js) or a kicked seat takes a character out.
export const standing = (state, pid) => { const p = state.players[pid], c = charOf(state, pid); return !!(p && !p.kicked && !p.spectator && c && !c.eliminated && (!c.dead || (c.missTurns || 0) >= 0)); };
export const finalBossDead = (state) => Object.values(state.monsters || {}).some(m => m && (m.final || m.id === 'the_dealer') && m.dead);
const VOID = new Set(['blocker', 'water', 'chasm', 'wall']);

// ---------------------------------------------------------------- scaling per mode
// Multipliers the map and monster generators read from state.modeAdjust (set at the very start of RUN_START).
export function modeAdjust(state, R) {
  R ||= BAL.runs;
  const base = { mode: state.mode, monsters: true, monsterMult: 1, extraMonstersPerRegion: 0, bossHealthMult: 1, chestMult: 1, lootMult: 1, encountersBecomeArenas: false };
  switch (state.mode) {
    case 'pvp': return { ...base, monsters: false, monsterMult: 0, chestMult: R.pvpChestMult, encountersBecomeArenas: true };
    case 'pve': return { ...base, extraMonstersPerRegion: R.pveExtraMonsters, bossHealthMult: R.pveBossMult };
    default: return base;   // ffa, teams, royale: as Free-for-all
  }
}
export function convertForPvp(state, ctx) {
  if (state.mode !== 'pvp' || !state.map) return false;
  let n = 0;
  for (const h of Object.values(state.map.hexes)) { if (h.type === 'encounter') { h.type = 'arena'; n += 1; } if (h.monsterId) delete h.monsterId; }
  state.monsters = {};
  if (state.modeAdjust) state.modeAdjust.pvpConverted = true;
  note(state, `PvP only: ${n} Encounter tile(s) become Arenas; the monsters stay home`, 'start', ctx.now);
  return true;
}

// ---------------------------------------------------------------- end conditions and placings
export function placings(state, G, R) {
  G ||= BAL.gold; R ||= BAL.runs;
  const rows = seatsWithCharacter(state).map(pid => { const c = charOf(state, pid); return { playerId: pid, characterId: c.id, name: nameOf(state, pid), teamId: teamOf(state, pid), standing: standing(state, pid), score: Math.round((c.gold || 0) + (c.kills || 0) * G.scorePerKill + (c.health || 0) * R.scorePerHealth), kills: c.kills || 0, level: c.level || 1, gold: c.gold || 0, health: c.health || 0 }; });
  const cmp = (a, b) => (b.standing - a.standing) || (b.score - a.score) || (b.kills - a.kills) || a.name.localeCompare(b.name);
  if (state.mode === 'teams') {
    const teams = {};
    for (const r of rows) { const t = teams[r.teamId ?? r.playerId] ||= { teamId: r.teamId, standing: false, score: 0, kills: 0, name: state.gm.teams?.[r.teamId]?.name || r.name }; t.standing = t.standing || r.standing; t.score += r.score; t.kills += r.kills; }
    const order = Object.values(teams).sort(cmp); order.forEach((t, i) => { t.place = i + 1; });
    rows.sort((a, b) => (teams[a.teamId ?? a.playerId].place - teams[b.teamId ?? b.playerId].place) || cmp(a, b));
    rows.forEach((r, i) => { r.place = i + 1; r.teamPlace = teams[r.teamId ?? r.playerId].place; });
    return rows;
  }
  rows.sort(cmp); rows.forEach((r, i) => { r.place = i + 1; });
  return rows;
}
export function endCheck(state, ctx) {
  if (state.phase !== 'playing') return null;
  const G = ctx.B('gold'), R = ctx.B('runs');
  const seats = seatsWithCharacter(state); if (!seats.length) return null;
  const up = seats.filter(id => standing(state, id));
  // Last Call: whatever the mode, a run that outlives table.lastCallMinutes ends on placings so the night ends on time.
  const L = ctx.B('table').lastCallMinutes;
  if (L > 0 && state.startedAt && ctx.now - state.startedAt >= L * 60000) { const top = placings(state, G, R)[0]; return { winner: state.mode === 'teams' ? (top?.teamId ?? top?.playerId ?? null) : (top?.playerId || null), reason: 'Last Call: the House closed' }; }
  const lastStanding = () => (seats.length >= 2 && up.length <= 1 ? { winner: up[0] || null, reason: up.length ? `${nameOf(state, up[0])} is the last one standing` : 'everyone fell' } : null);
  switch (state.mode) {
    case 'pvp': return lastStanding();
    case 'pve': {
      if (finalBossDead(state)) { state.cleared = true; return { winner: placings(state, G, R)[0]?.playerId || null, reason: 'The Dealer is dead' }; }
      if (!up.length) return { winner: null, reason: 'everyone fell to the House' };
      return null;
    }
    case 'teams': {
      if (finalBossDead(state)) { state.cleared = true; const top = placings(state, G, R)[0]; return { winner: top?.teamId ?? top?.playerId ?? null, reason: 'The Dealer is dead' }; }
      const teamsIn = new Set(seats.map(id => teamOf(state, id) ?? id)), teamsUp = new Set(up.map(id => teamOf(state, id) ?? id));
      if (teamsIn.size >= 2 && teamsUp.size <= 1) return { winner: [...teamsUp][0] ?? null, reason: teamsUp.size ? `${state.gm.teams?.[[...teamsUp][0]]?.name || [...teamsUp][0]} is the last team standing` : 'every team fell' };
      return null;
    }
    default: {   // ffa, royale
      if (state.throneReachedBy && standing(state, state.throneReachedBy)) return { winner: state.throneReachedBy, reason: `${nameOf(state, state.throneReachedBy)} reached the throne` };
      return lastStanding();
    }
  }
}

// ---------------------------------------------------------------- tiers, vault, veterans, seasons
// A veteran's level puts it in a band of runs.tierLevelBand levels per tier; it cannot enter a tier below its
// band, and a tier opens only once the one before was cleared (entry.tierCleared = deepest tier cleared).
export function tierAllowed(state, entry, R) {
  R ||= BAL.runs;
  const level = Number(entry?.level ?? entry?.character?.level ?? 1) || 1;
  const cleared = Number(entry?.tierCleared ?? entry?.deepestTierCleared ?? entry?.character?.tierCleared ?? 0) || 0;
  const minTier = Math.min(R.tiers, Math.floor((level - 1) / R.tierLevelBand) + 1), maxTier = Math.min(R.tiers, cleared + 1);
  if (state.tier < minTier) return { ok: false, reason: `a level ${level} veteran cannot enter tier ${state.tier} (band starts at tier ${minTier})`, minTier, maxTier };
  if (state.tier > maxTier) return { ok: false, reason: `tier ${state.tier} is locked until tier ${state.tier - 1} is cleared`, minTier, maxTier };
  return { ok: true, minTier, maxTier };
}
// Season end: level and quests reset; pets, titles, equipment, vault and Hall of Fame carry over.
export function seasonRollover(entry) {
  const reset = (c) => (c ? { ...c, level: 1, xp: 0, statPoints: 0, quests: [], titles: c.titles || [], pets: c.pets || [], worn: c.worn || {}, items: c.items || {} } : c);
  return { ...entry, level: 1, xp: 0, statPoints: 0, quests: [], character: reset(entry.character), seasonsPlayed: (entry.seasonsPlayed || 0) + 1 };
}
export const vaultCap = (c, GR) => ((c.dead ? GR.vaultDead : GR.vaultSurvivor) + (c.vaultBonus || 0));

function recordRun(state, ctx) {
  const G = ctx.B('gold'), R = ctx.B('runs');
  state.season ||= { id: 1, nights: 0 };
  const rows = placings(state, G, R), byGm = /GM called it/i.test(state.endReason || '');
  for (const r of rows) {
    const c = state.characters[r.characterId], s = state.stats[r.playerId] || {};
    const teamWon = state.mode === 'teams' && r.teamId != null && state.winner === r.teamId;
    const cleared = !byGm && !!(state.cleared || state.winner === r.playerId || teamWon);
    // `survived` is "ended the run alive" (as the metagame ledger and the recap read it), not `standing`: a character
    // lying in the Graveyard at the end still stands in the run but did not survive it.
    state.hallOfFame.push({ ts: ctx.now, roomId: state.roomId, seasonId: state.season.id, playerId: r.playerId, characterId: r.characterId, rosterId: c.rosterId || null, name: c.name || r.name, classId: c.classId || null, mode: state.mode, tier: state.tier, placing: r.place, survived: r.standing && !c.dead, tierCleared: cleared ? state.tier : 0, kills: r.kills, level: r.level, bosses: s.bosses || 0, petsCaught: s.petsCaught || 0, turns: s.turns || 0, deaths: c.deaths || 0 });
  }
  state.season.nights += 1;
  if (state.season.nights >= R.seasonNights) { state.season = { id: state.season.id + 1, nights: 0 }; state.seasonEnded = true; note(state, `Season ${state.season.id - 1} ends: levels and quests reset for the roster; pets, titles and gear carry over`, 'end', ctx.now); }
  state.runRecorded = true;
}

// ---------------------------------------------------------------- Royale
export function royaleCenter(state) {
  const m = state.map; if (!m) return null;
  if (m.throne && m.hexes[m.throne]) return hex.parse(m.throne);
  if (m.start && m.hexes[m.start]) return hex.parse(m.start);
  const hs = Object.values(m.hexes).filter(h => !h.void && !VOID.has(h.type)); if (!hs.length) return null;
  return { q: Math.round(hs.reduce((s, h) => s + h.q, 0) / hs.length), r: Math.round(hs.reduce((s, h) => s + h.r, 0) / hs.length) };
}
function shrink(state, ctx) {
  const RY = ctx.B('royale'), center = royaleCenter(state); if (!center) return;
  state.royale ||= { shrinks: 0, radius: null, maxRadius: null };
  const hs = Object.values(state.map.hexes).filter(h => !h.void && !VOID.has(h.type));
  if (state.royale.maxRadius == null) state.royale.maxRadius = Math.max(0, ...hs.map(h => hex.distance(center, h)));
  const radius = Math.max(RY.minRadius, state.royale.maxRadius - state.royale.shrinks - 1);
  if (radius >= (state.royale.radius ?? Infinity)) return;
  state.royale.shrinks += 1; state.royale.radius = radius; state.royale.center = hex.key(center);
  let n = 0; for (const h of hs) if (hex.distance(center, h) > radius) { if (!h.outside) n += 1; h.outside = true; }
  note(state, `The circle closes: ${n} more hex(es) fall outside it (radius ${radius})`, 'royale', ctx.now);
}
export const isOutside = (state, c) => !!(state.mode === 'royale' && c?.pos && state.map?.hexes[c.pos]?.outside);
export function lastStanding(state, pid) { const seats = seatsWithCharacter(state); return seats.length >= 2 && standing(state, pid) && seats.every(id => id === pid || !standing(state, id)); }
export const canUseChickenDinner = (state, pid) => state.mode === 'royale' && lastStanding(state, pid);
consumables.chickendinner = (state, ctx, c) => {
  const pid = playerOfCharacter(state, c.id)?.id;
  if (!canUseChickenDinner(state, pid)) refuse('the Chicken Dinner Platter is for the last one standing in Royale');
  health(state, c, c.maxHealth - c.health, 'chicken dinner', ctx); c.vaultBonus = (c.vaultBonus || 0) + 1;
  note(state, `Winner winner: ${nameOf(state, pid)} eats the Chicken Dinner Platter`, 'royale', ctx.now);
};

// ---------------------------------------------------------------- handlers
// VAULT_BANK and VETERAN_SAVE are registered by roster.js (the fuller version: removes vaulted items, honours extraVault/vaultBonus).

// ---------------------------------------------------------------- hooks
runHooks.runStart.unshift((state, ctx) => { state.modeAdjust = modeAdjust(state, ctx.B('runs')); if (state.mode === 'royale') state.royale = { shrinks: 0, radius: null, maxRadius: null }; });
runHooks.runStart.push((state, ctx) => { if (state.mode === 'pvp' && !convertForPvp(state, ctx)) state.modeAdjust.pvpPending = true; });
runHooks.turnStart.push((state, ctx, pid) => {
  if (state.modeAdjust?.pvpPending && convertForPvp(state, ctx)) state.modeAdjust.pvpPending = false;
  const c = charOf(state, pid);
  if (c && !c.dead && isOutside(state, c)) { const RY = ctx.B('royale'); applyPenalty(state, ctx, pid, RY.outsideDamage, 'outside the circle'); note(state, `${nameOf(state, pid)} bleeds ${RY.outsideDamage} outside the circle`, 'royale', ctx.now); }
});
runHooks.roundEnd.push((state, ctx) => { if (state.mode === 'royale' && state.map && (state.round - 1) % ctx.B('royale').shrinkEveryRounds === 0) shrink(state, ctx); });
damageHooks.outgoing.push((state, ctx, info) => {
  if (info.cancel || !['character', 'pet'].includes(info.targetKind)) return;
  if (info.kind === 'spell') return;   // heals and shields on an ally are never friendly fire
  const a = info.attackerId ? (state.players[info.attackerId] ? info.attackerId : playerOfCharacter(state, info.attackerId)?.id) : null;
  const t = info.targetId ? (state.players[info.targetId] ? info.targetId : playerOfCharacter(state, info.targetId)?.id) : (info.targetCharId ? playerOfCharacter(state, info.targetCharId)?.id : null);
  if (!a || !t || a === t) return;
  if (state.mode === 'pve') { info.cancel = true; info.notes.push('PvE: players cannot hurt each other'); }
  else if (state.mode === 'teams' && sameTeam(state, a, t)) { info.cancel = true; info.notes.push('no friendly fire inside a team'); }
});
runHooks.endCheck.push(endCheck);
onAfter((state, ev, ctx) => { if (state.phase === 'ended' && !state.runRecorded) recordRun(state, ctx); });
