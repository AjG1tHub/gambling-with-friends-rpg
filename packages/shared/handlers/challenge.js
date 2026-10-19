// The Challenge Wheel (SPEC.md › PvP: the Challenge Wheel, GM controls, Interrupts). Players never roll against
// each other: a Duel, Wager or Robbery spins the wheel, the two play the entry it lands on (hosted on the phones
// or away from the system), the winner is settled, and the table never waits for them.
//
// Flow of events:
//   CHALLENGE_CALL    { attackerId?, defenderId, call: 'duel'|'wager'|'robbery', itemId?, amount?, callOut? }
//   CHALLENGE_ANSWER  { accept?, itemId? }            defender: accept/decline a Wager, pick a weapon
//   CHALLENGE_SPIN    {}                              weighted seeded draw; holds both seats; the GM window opens
//   CHALLENGE_GM_SET  { entryId } | { reroll: true }  GM, before the TV animation (within challenge.gmWindowSeconds)
//   CHALLENGE_STEP    { action, payload } | { game }  purpose-built hosted duel moves (hosted.js); auto-settles when done
//   CHALLENGE_REPORT  { winnerId | 'draw', flawless? } hosted: one report settles; external: both must agree
//   CHALLENGE_GM_DECIDE { winnerId | 'draw' }          the GM's "Drop Back In": settles (or cancels an unspun call)
//   CHALLENGE_TIMEOUT {}                              the TV at the deadline: standing result or both take timeoutDamage
//   CHALLENGE_LIST    { preset, name?, entries?, activate?, remove?, presets?, trivia? }   the GM list editor
//
// Held turns (DECISIONS.md 7): at the spin both players go into state.held and their clocks stop; currentPlayerId
// skips them by derivation. If the spin happens on one of their turns that turn is finished (the attack was the
// turn). A seat whose slot is passed over while held is owed a turn: see the owed-turn mechanism at the bottom.
import { register, refuse, requireGm, requirePhase, requireActor, requireNotPaused, requirePlayer } from '../reducer.js';
import { activeSeats, currentPlayerId, characterOf, sameTeam, note } from '../state.js';
import { hooks as runHooks, beginTurn, finishTurn } from './run.js';
import { stopClock } from '../clock.js';
import { streamRng, rigAwareWeightedIndex } from '../rng.js';
import * as hex from '../hex.js';
import { health, gold, power } from '../health.js';
import { damageHooks, deathHooks, petHooks, heldHooks, runMods } from '../hooks.js';
import * as hosted from '../challenge/hosted.js';
import presetsData from '../../../data/challenges.json' with { type: 'json' };

export const VERSUS_GAMES = ['clash', 'diceduel', 'shellgame', 'holdemduel'];
export const CALLS = ['duel', 'wager', 'robbery'];
const SERIES_MAX_ROUNDS = 3;      // "best-of-three": structural, not a tunable
const TIMEOUT_SLACK_MS = 250;     // same slack as TURN_TIMEOUT in run.js

// Hooks other modules may push: fired when a challenge settles (side bets, quests, recap).
export const challengeHooks = { onSettle: [] };   // (state, ctx, { challenge, winnerId, loserId, flawless, how })

// ---------------------------------------------------------------- lists
export function activeList(state) {
  const id = state.gm.challengePreset || 'inperson';
  const room = state.gm.challengeLists?.[id];
  return room?.entries || presetsData.presets[id]?.entries || presetsData.presets.inperson.entries;
}
export function exportLists(state) {
  const presets = {};
  for (const [id, p] of Object.entries(presetsData.presets)) presets[id] = { name: p.name, entries: structuredClone(p.entries) };
  for (const [id, p] of Object.entries(state.gm.challengeLists || {})) presets[id] = { name: p.name || id, entries: structuredClone(p.entries) };
  return { presets, active: state.gm.challengePreset };
}
export function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) return 'entries must be a non-empty list';
  const seen = new Set();
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || !e.id) return 'every entry needs an id';
    if (seen.has(e.id)) return `duplicate entry id ${e.id}`; seen.add(e.id);
    if (typeof e.name !== 'string' || !e.name) return `${e.id}: name required`;
    if (typeof e.hosted !== 'boolean') return `${e.id}: hosted must be true or false`;
    if (e.hosted && !(hosted.isPurposeBuilt(e.game) || VERSUS_GAMES.includes(e.game))) return `${e.id}: unknown hosted game ${e.game}`;
    if (e.players && !['1v1', 'team'].includes(e.players)) return `${e.id}: players must be 1v1 or team`;
    if (!(Number(e.weight) >= 0)) return `${e.id}: weight must be a number`;
    if (e.capSeconds != null && !(Number(e.capSeconds) > 0)) return `${e.id}: capSeconds must be positive or null`;
  }
  return null;
}
const normEntry = (e) => ({ id: e.id, name: e.name, hosted: !!e.hosted, game: e.hosted ? e.game : null, link: e.link || null, rules: String(e.rules || ''), capSeconds: e.capSeconds == null ? null : Number(e.capSeconds), players: e.players === 'team' ? 'team' : '1v1', weight: Number(e.weight) || 0, enabled: e.enabled !== false });
export const capSecondsOf = (entry, CH) => entry.capSeconds ?? (entry.hosted ? CH.hostedCapSeconds : CH.externalCapSeconds);
export const pairKey = (a, b) => [a, b].sort().join('|');

// ---------------------------------------------------------------- small helpers
const charOf = (state, pid) => characterOf(state, pid);
const hasUpgrade = (c, id) => Array.isArray(c?.upgrades) ? c.upgrades.includes(id) : !!c?.upgrades?.[id];
function weaponOf(c, itemId) {
  if (!c) return null;
  if (itemId) { const it = c.items?.[itemId] || Object.values(c.worn || {}).find(w => w && w.id === itemId); return it && Number.isFinite(Number(it.stake)) ? it : null; }
  return c.worn?.mainhand || c.worn?.offhand || Object.values(c.items || {}).find(it => it && it.slot === 'weapon' && Number.isFinite(Number(it.stake))) || null;
}
function reachOf(state, c, item, I) {
  if (item && Number.isFinite(Number(item.reach))) return Number(item.reach);
  return hasUpgrade(c, 'longarm') ? I.reachLongArm : I.reachDefault;
}
function distanceBetween(a, b) { if (!a?.pos || !b?.pos) return Infinity; return hex.distance(hex.parse(a.pos), hex.parse(b.pos)); }
const stat = (state, pid, k, n = 1) => { const s = state.stats[pid]; if (s) s[k] = (s[k] || 0) + n; };
const active = (state) => (state.challenge && !state.challenge.done ? state.challenge : null);
const isParty = (ch, pid) => pid === ch.attackerId || pid === ch.defenderId;
const otherOf = (ch, pid) => (pid === ch.attackerId ? ch.defenderId : ch.attackerId);
const nameOf = (state, pid) => state.players[pid]?.name || pid;

// ---------------------------------------------------------------- the hit
// The winner's weapon hits once for stake × multiplier, no roll (crit on a flawless win). Runs the same pipeline
// the items module uses: damageHooks.stake → outgoing → petHooks.beforeCharacterHit → incoming → health() →
// afterHit → deathHooks.onZero / onDeath. Returns { dmg, killed, prevented, redirected, info }.
// `info` follows the items module's shape (attackerId / targetId are character ids; the player ids ride along as
// attackerPlayerId / targetPlayerId) so every module's damage mods see the same fields whichever path hit.
export function applyChallengeHit(state, ctx, winnerId, loserId, item, { crit = false, why = 'challenge' } = {}) {
  const atk = charOf(state, winnerId), tgt = charOf(state, loserId);
  if (!tgt) refuse('no target character');
  const CH = ctx.B('challenge');
  const stake = Number(item?.stake) || 0;
  const info = { attackerId: atk?.id || null, attackerKind: 'character', attackerPlayerId: winnerId, targetId: tgt.id, targetPlayerId: loserId, attacker: atk, target: tgt, targetKind: 'character', item: item || null, gameId: item?.gameId || null, kind: 'challenge', challenge: true, crit: !!crit, base: stake, stake, mult: crit ? CH.critMult : CH.winMult, flat: 0, notes: [], cancel: false, prevented: false, redirectToPet: null };
  runMods(damageHooks.stake, state, ctx, info);
  runMods(damageHooks.outgoing, state, ctx, info);
  runMods(petHooks.beforeCharacterHit, state, ctx, info);
  runMods(damageHooks.incoming, state, ctx, info);
  if (info.cancel) { runMods(damageHooks.afterMiss, state, ctx, info); return { dmg: 0, killed: false, prevented: false, redirected: false, info }; }
  const dmg = Math.max(0, Math.round(info.stake * info.mult + info.flat));
  info.dmg = dmg;
  if (info.redirectToPet) {
    const pet = (tgt.pets || []).find(p => p.id === info.redirectToPet);
    if (pet) { power(state, pet, -dmg, `${why}:${item?.name || 'hit'}`, ctx); if (pet.power <= 0) pet.fainted = true; runMods(damageHooks.afterHit, state, ctx, info); note(state, `${nameOf(state, loserId)}'s ${pet.name} takes the ${dmg}`, 'fight', ctx.now); return { dmg, killed: false, prevented: false, redirected: true, info }; }
  }
  health(state, tgt, -dmg, `${why}:${item?.name || 'hit'}`, ctx);
  stat(state, winnerId, 'hits'); if (crit) stat(state, winnerId, 'crits'); stat(state, winnerId, 'damageDealt', dmg); stat(state, loserId, 'damageTaken', dmg);
  runMods(damageHooks.afterHit, state, ctx, info);
  let killed = false;
  if (tgt.health <= 0 && !tgt.dead) {
    // The death hooks' contract (death.js, items.js characterZero): { charId, killerId, killerKind, byId, byKind }.
    // byKind set tells death.js the kill is already credited here; it pays gold.perKO and the penalties once.
    const zi = { ...info, charId: tgt.id, killerId: atk?.id || null, killerKind: 'player', byId: atk?.id || null, byKind: 'player', info, prevented: false };
    runMods(deathHooks.onZero, state, ctx, zi);
    info.prevented = !!zi.prevented;
    if (!zi.prevented) {
      tgt.dead = true; tgt.diedTo = 'player'; tgt.deaths = (tgt.deaths || 0) + 1;
      if (atk) atk.kills = (atk.kills || 0) + 1;
      stat(state, winnerId, 'kills'); stat(state, loserId, 'deaths');
      runMods(deathHooks.onDeath, state, ctx, zi);
      killed = true;
    }
  }
  return { dmg, killed, prevented: !!info.prevented, redirected: false, info };
}
// A flat penalty (time-outs, the circle): through health(), with the death hooks but no damage mods. Nobody is
// credited; death.js treats a killer-less death as the minor (monster-style) penalty, as items.js does.
export function applyPenalty(state, ctx, pid, amount, why) {
  const c = charOf(state, pid); if (!c || c.dead || amount <= 0) return false;
  health(state, c, -amount, why, ctx); stat(state, pid, 'damageTaken', amount);
  if (c.health <= 0 && !c.dead) {
    const info = { charId: c.id, killerId: null, byId: null, attackerId: null, targetId: c.id, targetPlayerId: pid, target: c, targetKind: 'character', kind: 'penalty', why, prevented: false, dmg: amount };
    runMods(deathHooks.onZero, state, ctx, info);
    if (!info.prevented) { c.dead = true; c.diedTo = null; c.deaths = (c.deaths || 0) + 1; stat(state, pid, 'deaths'); runMods(deathHooks.onDeath, state, ctx, info); return true; }
  }
  return false;
}

// ---------------------------------------------------------------- holds and the turn around them
export function holdSeat(state, ctx, pid, challengeId) {
  if (state.held[pid]) return;
  state.held[pid] = { since: ctx.now, challengeId, missedTurn: false };
  stopClock(state, pid, ctx.now);
  runMods(heldHooks.onHold, state, ctx, { playerId: pid, challengeId });
}
export function releaseSeat(state, ctx, pid) {
  const h = state.held[pid]; if (!h || h.owedWait) return;
  delete state.held[pid];
  state.owedTurns ||= [];
  for (const at of h.misses || []) state.owedTurns.push({ playerId: pid, at });
  state.owedTurns.sort((a, b) => a.at - b.at);
  runMods(heldHooks.onRelease, state, ctx, { playerId: pid, challengeId: h.challengeId, missedTurn: !!h.missedTurn, missed: (h.misses || []).length });
}
// Mirrors run.js finishTurn for the turn a challenge interrupts (the attack was the turn). Kept in step with it;
// if run.js exports finishTurn later, use that instead.
function finishInterruptedTurn(state, ctx, pid) {
  finishTurn(state, ctx, pid, 'challenge');
  resumeTable(state, ctx);
}
// Start the next turn unless every seat is away in the challenge, in which case the table idles until a release.
function resumeTable(state, ctx) {
  if (state.phase !== 'playing') return;
  const free = activeSeats(state).some(id => !state.held[id] || state.held[id].owedWait);
  if (!free) { state.tableIdle = true; state.turnStartedAt = null; return; }
  state.tableIdle = false; placeOwedTurn(state, ctx); beginTurn(state, ctx);
}

// ---------------------------------------------------------------- settlement
function settleRound(state, ctx, winnerId, { flawless = false, how = 'report', final = false } = {}) {
  const ch = state.challenge; if (!ch || ch.done) return;
  ch.usedEntryIds ||= []; if (ch.entryId && !ch.usedEntryIds.includes(ch.entryId)) ch.usedEntryIds.push(ch.entryId);
  (state.challengeHistory ||= {})[pairKey(ch.attackerId, ch.defenderId)] = ch.usedEntryIds.slice();
  if (ch.series && !final) {
    const s = ch.series; s.round += 1;
    if (winnerId) s.wins[winnerId] = (s.wins[winnerId] || 0) + 1;
    s.log.push({ entryId: ch.entryId, winnerId: winnerId || null, flawless: !!flawless });
    const leader = Object.entries(s.wins).sort((a, b) => b[1] - a[1])[0];
    const decided = leader && leader[1] >= s.target, over = s.round > s.maxRounds;
    if (!decided && !over) {   // next round of the same entry, fresh seed, no GM window
      const CH = ctx.B('challenge');
      ch.reports = {}; ch.gmPending = false; ch.spunAt = ctx.now; ch.gmWindowUntil = ctx.now; ch.deadline = ctx.now + ch.entry.capSeconds * 1000;
      if (ch.entry.hosted && hosted.isPurposeBuilt(ch.entry.game)) { ch.seed = streamRng(state, 'challenge').int(0, 0x7fffffff); ch.hostedGame = hosted.create(ch.seed, ch.entry, { aId: ch.attackerId, bId: ch.defenderId }, ctx.now, CH, state.gm.triviaBank); }
      note(state, `${winnerId ? nameOf(state, winnerId) : 'Nobody'} takes round ${s.round - 1}: ${s.wins[ch.attackerId] || 0}–${s.wins[ch.defenderId] || 0}. Round ${s.round} of ${ch.entry.name}.`, 'challenge', ctx.now);
      return;
    }
    const a = s.wins[ch.attackerId] || 0, b = s.wins[ch.defenderId] || 0;
    winnerId = a === b ? null : a > b ? ch.attackerId : ch.defenderId;
    flawless = !!winnerId && (s.wins[otherOf(ch, winnerId)] || 0) === 0 && s.log.filter(r => r.winnerId === winnerId).every(r => r.flawless);
  }
  finalize(state, ctx, winnerId, { flawless, how });
}
function finalize(state, ctx, winnerId, { flawless = false, how = 'report' } = {}) {
  const ch = state.challenge; if (!ch || ch.done) return;
  const G = ctx.B('gold');
  ch.done = true; ch.winnerId = winnerId || null; ch.endedAt = ctx.now; ch.how = how; ch.flawless = !!(winnerId && flawless);
  const loserId = winnerId ? otherOf(ch, winnerId) : null;
  const atk = charOf(state, ch.attackerId), def = charOf(state, ch.defenderId);
  let hit = null;
  if (winnerId) {
    const w = charOf(state, winnerId), l = charOf(state, loserId);
    if (ch.call === 'duel') {
      const item = weaponOf(w, winnerId === ch.attackerId ? ch.attackerItemId : ch.defenderItemId);
      if (item && l) {
        hit = applyChallengeHit(state, ctx, winnerId, loserId, item, { crit: ch.flawless });
        note(state, `${nameOf(state, winnerId)} wins ${ch.entry?.name || 'the challenge'}${ch.flawless ? ' flawlessly' : ''}: ${item.name} hits ${nameOf(state, loserId)} for ${hit.dmg}${hit.killed ? ' — a kill' : ''}`, 'challenge', ctx.now);
        if (hit.killed && l.wanted > 0) {
          const bounty = Math.max(0, Math.round(l.wantedBounty || 0));
          if (bounty > 0) { gold(state, w, bounty, 'bounty', ctx); stat(state, winnerId, 'goldEarned', bounty); }
          l.wanted = 0; l.wantedBounty = 0;
          note(state, `${nameOf(state, winnerId)} claims the bounty on ${nameOf(state, loserId)}: ${bounty} Gold`, 'gold', ctx.now);
        }
      } else note(state, `${nameOf(state, winnerId)} wins but has no weapon to swing`, 'challenge', ctx.now);
    } else if (ch.call === 'wager') {
      const pay = Math.min(ch.amount, l?.gold || 0);
      if (pay > 0 && w && l) { gold(state, l, -pay, 'wager', ctx); gold(state, w, pay, 'wager', ctx); stat(state, winnerId, 'goldEarned', pay); }
      note(state, `${nameOf(state, winnerId)} wins the wager: ${pay} Gold from ${nameOf(state, loserId)}`, 'gold', ctx.now);
    } else if (ch.call === 'robbery') {
      if (winnerId === ch.attackerId) {
        const take = Math.min(ch.amount, def?.gold || 0);
        if (take > 0) { gold(state, def, -take, 'robbed', ctx); gold(state, atk, take, 'robbery', ctx); stat(state, winnerId, 'goldEarned', take); }
        note(state, `${nameOf(state, ch.attackerId)} robs ${nameOf(state, ch.defenderId)} of ${take} Gold`, 'gold', ctx.now);
      } else {
        const pay = Math.min(ch.amount, atk?.gold || 0);
        if (pay > 0) { gold(state, atk, -pay, 'failed robbery', ctx); gold(state, def, pay, 'failed robbery', ctx); stat(state, ch.defenderId, 'goldEarned', pay); }
        if (atk) { atk.wanted = G.wantedTurns; atk.wantedBounty = ch.amount; }
        note(state, `${nameOf(state, ch.attackerId)}'s robbery fails: pays ${pay} Gold and is Wanted for ${G.wantedTurns} turns (bounty ${ch.amount})`, 'gold', ctx.now);
      }
    }
    if ((ch.pot > 0 || ch.arena) && w) { const bonus = ch.arena ? G.arenaCrowdBonus : 0; gold(state, w, ch.pot + bonus, 'arena', ctx); stat(state, winnerId, 'goldEarned', ch.pot + bonus); note(state, `The crowd pays ${nameOf(state, winnerId)} the ${ch.pot} pot${bonus ? ` and ${bonus} bonus` : ''}`, 'gold', ctx.now); ch.pot = 0; }
    stat(state, winnerId, 'challengesWon'); stat(state, loserId, 'challengesLost');
  } else {
    if (ch.pot > 0) { const half = Math.floor(ch.pot / 2); if (atk) gold(state, atk, half, 'arena refund', ctx); if (def) gold(state, def, ch.pot - half, 'arena refund', ctx); ch.pot = 0; }
    note(state, `${ch.entry?.name || 'The challenge'} between ${nameOf(state, ch.attackerId)} and ${nameOf(state, ch.defenderId)} ends with no winner (${how})`, 'challenge', ctx.now);
  }
  ch.hit = hit ? { dmg: hit.dmg, killed: hit.killed, redirected: hit.redirected } : null;
  for (const h of challengeHooks.onSettle) h(state, ctx, { challenge: ch, winnerId: ch.winnerId, loserId, flawless: ch.flawless, how });
  if (state.fight && state.fight.calledOut) delete state.fight.calledOut;
  releaseSeat(state, ctx, ch.attackerId); releaseSeat(state, ctx, ch.defenderId);
  state.lastChallenge = ch; state.challenge = null;
  if (state.tableIdle) resumeTable(state, ctx);
}
function cancelCall(state, ctx, why) {
  const ch = state.challenge; if (!ch) return;
  const atk = charOf(state, ch.attackerId); if (atk?.usedThisTurn && atk.usedThisTurn.attack > 0) atk.usedThisTurn.attack -= 1;   // a declined Wager costs nothing
  if (ch.arenaPrompt) state.pendingPrompt = { ...ch.arenaPrompt };
  note(state, why, 'challenge', ctx.now);
  state.challenge = null;
}

// ---------------------------------------------------------------- views
export function offScreenCard(state) {
  const ch = active(state); if (!ch || !ch.spun || ch.entry?.hosted) return null;
  return { entryName: ch.entry.name, aId: ch.attackerId, bId: ch.defenderId, deadline: ch.deadline, hosted: false };
}
export function challengeView(state, playerId, now = state.lastEventTs) {
  const ch = state.challenge; if (!ch) return null;
  const role = playerId === ch.attackerId ? 'attacker' : playerId === ch.defenderId ? 'defender' : 'spectator';
  const phase = ch.done ? 'done' : !ch.spun ? (ch.call === 'wager' && !ch.accepted ? 'answer' : 'ready') : now < (ch.gmWindowUntil || 0) ? 'spinning' : 'playing';
  const game = ch.hostedGame;
  return {
    id: ch.id, call: ch.call, role, phase, attackerId: ch.attackerId, defenderId: ch.defenderId, amount: ch.amount, arena: !!ch.arena, pot: ch.pot || 0,
    entry: ch.entry ? { id: ch.entry.id, name: ch.entry.name, hosted: ch.entry.hosted, game: ch.entry.game, link: ch.entry.link, rules: ch.entry.rules, players: ch.entry.players } : null,
    deadline: ch.deadline, secondsLeft: ch.deadline ? Math.max(0, Math.ceil((ch.deadline - now) / 1000)) : null,
    canAnswer: role === 'defender' && !ch.spun && ch.call === 'wager' && !ch.accepted,
    needsWeapon: role === 'defender' && !ch.spun && ch.call !== 'wager' && !ch.defenderItemId && !ch.defenderAnswered,
    hosted: game ? hosted.phoneView(game, playerId, now) : null,
    reportButtons: ch.spun && !ch.done && !(game && hosted.isPurposeBuilt(ch.entry.game)) && role !== 'spectator' ? [ch.attackerId, ch.defenderId].map(id => ({ winnerId: id, name: nameOf(state, id) })).concat([{ winnerId: 'draw', name: 'Draw' }]) : [],
    myReport: ch.reports?.[playerId] ?? null, reports: ch.entry && !ch.entry.hosted ? ch.reports : undefined,
    gmPending: !!ch.gmPending, series: ch.series ? { round: ch.series.round, wins: ch.series.wins, target: ch.series.target } : null, calledOut: !!ch.calledOut,
    winnerId: ch.winnerId || null, flawless: !!ch.flawless,
  };
}

// ---------------------------------------------------------------- the handlers
register({
  CHALLENGE_CALL(state, ev, ctx) {
    requirePhase(state, 'playing'); requireNotPaused(state, ctx);
    const p = ctx.payload, attackerId = p.attackerId || ctx.actor, defenderId = p.defenderId, call = p.call;
    requireActor(state, ctx, attackerId); requirePlayer(state, attackerId); requirePlayer(state, defenderId);
    if (!CALLS.includes(call)) refuse(`call must be one of ${CALLS.join('/')}`);
    if (active(state)) refuse('a challenge is already in progress', 'busy');
    if (attackerId === defenderId) refuse('you cannot challenge yourself');
    if (currentPlayerId(state) !== attackerId) refuse('not your turn', 'turn');
    if (state.held[defenderId] && !state.held[defenderId].owedWait) refuse(`${nameOf(state, defenderId)} is away in a challenge`, 'held');
    if (state.players[defenderId].spectator) refuse('spectators cannot be challenged');
    const atk = charOf(state, attackerId), def = charOf(state, defenderId);
    if (!atk || !def) refuse('both players need a character');
    if (atk.dead) refuse('the dead do not duel'); if (def.dead) refuse(`${nameOf(state, defenderId)} is dead`);
    const hostile = call !== 'wager';
    if (hostile && state.mode === 'pve') refuse('players cannot hurt each other in PvE', 'mode');
    if (hostile && sameTeam(state, attackerId, defenderId)) refuse('no fighting inside a team', 'mode');
    if (call === 'duel' && !state.gm.duelsEnabled) refuse('Duels are off tonight', 'mode');
    const I = ctx.B('items'), G = ctx.B('gold'), CH = ctx.B('challenge');
    if ((atk.usedThisTurn?.attack || 0) >= I.attacksPerTurn) refuse('you already attacked this turn', 'used');
    const item = weaponOf(atk, p.itemId); if (call === 'duel' && !item) refuse('pick a weapon');
    if (p.itemId && !item) refuse('no such weapon');
    const arenaPrompt = state.pendingPrompt?.kind === 'arena' && state.pendingPrompt.playerId === attackerId ? state.pendingPrompt : null;
    // Reach: hex distance against the weapon's reach, unless the Enforcer calls the target out.
    let calledOut = false;
    const effect = (atk.effects || []).find(e => e.id === 'calledout' && (!e.data?.targetId || e.data.targetId === defenderId));
    if (p.callOut || effect) {
      if (atk.classId !== 'enforcer' && !effect) refuse('only an Enforcer can Call Out');
      const d = distanceBetween(atk, def), inRegion = hasUpgrade(atk, 'regioncall') && atk.region && atk.region === def.region;
      if (!(d <= CH.callOutRange || inRegion)) refuse('too far to Call Out', 'reach');
      calledOut = true;
    } else if (!arenaPrompt) {
      const d = distanceBetween(atk, def);
      if (!(d <= reachOf(state, atk, item, I))) refuse(`${nameOf(state, defenderId)} is out of reach`, 'reach');
    }
    // What is on the line.
    let amount = Math.max(0, Math.round(Number(p.amount) || 0));
    if (call === 'wager') { if (amount <= 0) refuse('name the wager'); if (amount > Math.min(atk.gold || 0, def.gold || 0)) refuse('wager is more than the poorer player holds', 'gold'); }
    if (call === 'robbery') { const cap = Math.floor((def.gold || 0) * G.robberyMaxFraction); if (cap <= 0) refuse(`${nameOf(state, defenderId)} has nothing worth robbing`, 'gold'); if (amount <= 0 || amount > cap) refuse(`a robbery names 1 to ${cap} Gold`, 'gold'); }
    let arenaWager = 0;
    if (arenaPrompt) { arenaWager = Math.max(0, Math.round(Number(p.arenaWager ?? (call === 'duel' ? p.amount : 0)) || 0)); if (arenaWager > Math.min(atk.gold || 0, def.gold || 0)) refuse('arena wager is more than the poorer player holds', 'gold'); }
    atk.usedThisTurn ||= { attack: 0, spell: 0, moved: false }; atk.usedThisTurn.attack += 1;
    state.challenge = {
      id: ev.id, call, attackerId, defenderId, attackerItemId: item?.id || null, defenderItemId: weaponOf(def)?.id || null, amount: call === 'wager' || call === 'robbery' ? amount : 0,
      arena: !!arenaPrompt, arenaWager, arenaPrompt: arenaPrompt ? { ...arenaPrompt } : null, pot: 0, accepted: call !== 'wager', calledOut,
      entryId: null, entry: null, spun: false, spunAt: null, deadline: null, gmWindowUntil: null, reports: {}, winnerId: null, done: false, hostedGame: null, gmPending: false, startedAt: ctx.now,
      series: null, usedEntryIds: (state.challengeHistory?.[pairKey(attackerId, defenderId)] || []).slice(), seed: null,
    };
    if (arenaPrompt) state.pendingPrompt = null;
    if (calledOut && state.fight && [attackerId, defenderId].includes(state.fight.playerId)) state.fight.calledOut = true;
    const what = call === 'duel' ? `a Duel with ${item.name}` : call === 'wager' ? `a ${amount} Gold Wager` : `a Robbery of ${amount} Gold`;
    note(state, `${nameOf(state, attackerId)} calls ${nameOf(state, defenderId)} to ${what}${calledOut ? ' (Called Out)' : ''}${arenaPrompt ? ' in the Arena' : ''}`, 'challenge', ctx.now);
  },

  CHALLENGE_ANSWER(state, ev, ctx) {
    const ch = active(state); if (!ch) refuse('no challenge to answer');
    requireActor(state, ctx, ch.defenderId);
    if (ch.spun) refuse('the wheel already spun');
    const def = charOf(state, ch.defenderId), p = ctx.payload;
    if (p.accept != null && ch.call !== 'wager') refuse(p.accept ? 'nothing to accept' : 'a Duel or Robbery cannot be declined');
    // itemId: an id picks the weapon; null means bare hands (a defender who dropped everything still plays — a win
    // just lands no hit); undefined leaves the default (main hand) in place.
    const it = p.itemId ? weaponOf(def, p.itemId) : null; if (p.itemId && !it) refuse('no such weapon');
    if (it) ch.defenderItemId = it.id; else if (p.itemId === null) { ch.defenderItemId = null; ch.defenderBareHands = true; }
    ch.defenderAnswered = true;
    if (p.accept === false) { cancelCall(state, ctx, `${nameOf(state, ch.defenderId)} declines the wager`); return; }
    if (p.accept === true) { ch.accepted = true; note(state, `${nameOf(state, ch.defenderId)} accepts the wager`, 'challenge', ctx.now); }
  },

  CHALLENGE_SPIN(state, ev, ctx) {
    requirePhase(state, 'playing');
    const ch = active(state); if (!ch) refuse('no challenge to spin for');
    if (!ctx.isGm && !isParty(ch, ctx.actor)) refuse('not in this challenge', 'forbidden');
    if (ch.spun) refuse('already spun');
    if (!ch.accepted) refuse('the defender has not accepted', 'answer');
    const CH = ctx.B('challenge');
    const list = activeList(state).filter(e => e.enabled && e.weight > 0);
    if (!list.length) refuse('the challenge list is empty');
    let pool = list;
    if (list.length >= CH.noRepeatMinEntries && ch.usedEntryIds?.length) { pool = list.filter(e => !ch.usedEntryIds.includes(e.id)); if (!pool.length) { ch.usedEntryIds = []; pool = list; } }
    const i = rigAwareWeightedIndex(state, 'challenge', pool);
    const first = !ch.spunOnce;
    placeEntry(state, ctx, pool[i], pool, i, CH);
    if (first) {
      const atk = charOf(state, ch.attackerId), def = charOf(state, ch.defenderId);
      if (ch.arena && ch.arenaWager > 0) { const w = Math.min(ch.arenaWager, atk?.gold || 0, def?.gold || 0); if (w > 0) { gold(state, atk, -w, 'arena stake', ctx); gold(state, def, -w, 'arena stake', ctx); ch.pot = w * 2; } }
      const cur = currentPlayerId(state);
      holdSeat(state, ctx, ch.attackerId, ch.id); holdSeat(state, ctx, ch.defenderId, ch.id);
      if (cur === ch.attackerId || cur === ch.defenderId) finishInterruptedTurn(state, ctx, cur);
    }
    ch.spunOnce = true;
  },

  CHALLENGE_GM_SET(state, ev, ctx) {
    requireGm(ctx);
    const ch = active(state); if (!ch || !ch.spun) refuse('nothing spun');
    if (ctx.now > ch.gmWindowUntil) refuse('the TV already animated the spin', 'late');
    if (Object.keys(ch.reports).length || ch.hostedGame?.acted) refuse('play has started');
    const CH = ctx.B('challenge'), list = activeList(state).filter(e => e.enabled);
    if (ctx.payload.reroll) {
      const pool = list.filter(e => e.weight > 0 && e.id !== ch.entryId); if (!pool.length) refuse('nothing else on the wheel');
      const i = rigAwareWeightedIndex(state, 'challenge', pool); placeEntry(state, ctx, pool[i], pool, i, CH, 'reroll');
      return;
    }
    const e = list.find(x => x.id === ctx.payload.entryId); if (!e) refuse('no such entry on the active list');
    placeEntry(state, ctx, e, list, list.indexOf(e), CH, 'forced');
  },

  CHALLENGE_STEP(state, ev, ctx) {
    const ch = active(state); if (!ch || !ch.spun) refuse('no hosted duel running');
    if (!ctx.isGm && !isParty(ch, ctx.actor)) refuse('not in this challenge', 'forbidden');
    if (!ch.hostedGame || !hosted.isPurposeBuilt(ch.entry.game)) refuse('this entry is not a purpose-built duel');
    const p = ctx.payload; let game;
    if (p.game) {
      if (p.game.game !== ch.hostedGame.game || p.game.aId !== ch.hostedGame.aId || p.game.bId !== ch.hostedGame.bId || p.game.seed !== ch.hostedGame.seed) refuse('that is a different game');
      game = structuredClone(p.game);
    } else {
      const pid = p.playerId || ctx.actor; if (!isParty(ch, pid)) refuse('playerId must be a player in the duel');
      game = hosted.act(ch.hostedGame, pid, p.action, p.payload || {}, ctx.now);
    }
    game.acted = true; ch.hostedGame = game;
    const r = hosted.result(game);
    if (r) settleRound(state, ctx, r.winnerId, { flawless: r.flawless, how: 'hosted' });
  },

  CHALLENGE_REPORT(state, ev, ctx) {
    const ch = active(state); if (!ch || !ch.spun) refuse('nothing to report');
    const party = isParty(ch, ctx.actor);
    if (!ctx.isGm && !party) refuse('not in this challenge', 'forbidden');
    const w = ctx.payload.winnerId; if (w !== 'draw' && !isParty(ch, w)) refuse('winnerId must be a player in the challenge or "draw"');
    const winnerId = w === 'draw' ? null : w;
    if (ch.entry.hosted || ctx.isGm) { settleRound(state, ctx, winnerId, { flawless: !!ctx.payload.flawless, how: ctx.isGm ? 'gm' : 'hosted' }); return; }
    ch.reports[ctx.actor] = w;
    const a = ch.reports[ch.attackerId], b = ch.reports[ch.defenderId];
    if (a === undefined || b === undefined) { note(state, `${nameOf(state, ctx.actor)} reports: ${w === 'draw' ? 'a draw' : nameOf(state, w) + ' won'}`, 'challenge', ctx.now); return; }
    if (a === b) { settleRound(state, ctx, winnerId, { flawless: !!ctx.payload.flawless, how: 'agreed' }); return; }
    ch.gmPending = true;
    note(state, `${nameOf(state, ch.attackerId)} and ${nameOf(state, ch.defenderId)} disagree on who won — the GM decides`, 'challenge', ctx.now);
  },

  CHALLENGE_GM_DECIDE(state, ev, ctx) {
    requireGm(ctx);
    const ch = active(state); if (!ch) refuse('no challenge');
    if (!ch.spun) { cancelCall(state, ctx, 'The GM cancels the challenge'); return; }
    const w = ctx.payload.winnerId; if (w !== 'draw' && w != null && !isParty(ch, w)) refuse('winnerId must be a player in the challenge or "draw"');
    settleRound(state, ctx, w === 'draw' || w == null ? null : w, { flawless: !!ctx.payload.flawless, how: 'gm', final: true });
  },

  CHALLENGE_TIMEOUT(state, ev, ctx) {
    requireGm(ctx);
    const ch = active(state); if (!ch || !ch.spun) refuse('no running challenge');
    if (ctx.now + TIMEOUT_SLACK_MS < ch.deadline) refuse('the cap has not passed', 'early');
    const CH = ctx.B('challenge');
    if (ch.hostedGame && hosted.isPurposeBuilt(ch.entry.game)) {
      const r = hosted.atCap(ch.hostedGame, ctx.now);
      if (r?.winnerId) { ch.hostedGame = hosted.capped(ch.hostedGame, ctx.now); settleRound(state, ctx, r.winnerId, { flawless: r.flawless, how: 'cap' }); return; }
    }
    for (const pid of [ch.attackerId, ch.defenderId]) applyPenalty(state, ctx, pid, CH.timeoutDamage, 'challenge timeout');
    note(state, `Time! No result: ${nameOf(state, ch.attackerId)} and ${nameOf(state, ch.defenderId)} both take ${CH.timeoutDamage}`, 'challenge', ctx.now);
    finalize(state, ctx, null, { how: 'timeout' });
  },

  CHALLENGE_LIST(state, ev, ctx) {
    requireGm(ctx);
    const p = ctx.payload; state.gm.challengeLists ||= {};
    if (p.presets) {   // JSON import, the data file's shape
      for (const [id, pr] of Object.entries(p.presets)) { const bad = validateEntries(pr?.entries); if (bad) refuse(`${id}: ${bad}`); }
      for (const [id, pr] of Object.entries(p.presets)) state.gm.challengeLists[id] = { name: String(pr.name || id).slice(0, 40), entries: pr.entries.map(normEntry) };
      note(state, `GM imported ${Object.keys(p.presets).length} challenge list(s)`, 'gm', ctx.now);
    }
    if (p.trivia) { if (!Array.isArray(p.trivia)) refuse('trivia must be a list'); state.gm.triviaBank = p.trivia.filter(q => q && q.q && Array.isArray(q.options) && q.options.length > 1 && Number.isInteger(q.answer)).map((q, i) => ({ id: q.id || `gm${i}`, q: q.q, options: q.options, answer: q.answer })); }
    if (p.preset) {
      if (p.remove) { delete state.gm.challengeLists[p.preset]; if (state.gm.challengePreset === p.preset && !presetsData.presets[p.preset]) state.gm.challengePreset = 'inperson'; return; }
      if (p.entries) { const bad = validateEntries(p.entries); if (bad) refuse(bad); state.gm.challengeLists[p.preset] = { name: String(p.name || state.gm.challengeLists[p.preset]?.name || presetsData.presets[p.preset]?.name || p.preset).slice(0, 40), entries: p.entries.map(normEntry) }; note(state, `GM saved challenge list "${p.preset}" (${p.entries.length} entries)`, 'gm', ctx.now); }
      if (p.activate || !p.entries) { if (!state.gm.challengeLists[p.preset] && !presetsData.presets[p.preset]) refuse(`no challenge list ${p.preset}`); state.gm.challengePreset = p.preset; note(state, `Challenge list: ${state.gm.challengeLists[p.preset]?.name || presetsData.presets[p.preset].name}`, 'gm', ctx.now); }
    }
  },
});

// Put an entry on the wheel: the TV animation, the GM window, the deadline, and a fresh hosted game if needed.
function placeEntry(state, ctx, entry, pool, index, CH, how = 'spin') {
  const ch = state.challenge;
  ch.entryId = entry.id; ch.entry = { id: entry.id, name: entry.name, hosted: !!entry.hosted, game: entry.game || null, link: entry.link || null, rules: entry.rules || '', capSeconds: capSecondsOf(entry, CH), players: entry.players || '1v1', team: entry.players === 'team' };
  ch.spun = true; ch.spunAt = ctx.now; ch.gmWindowUntil = ctx.now + CH.gmWindowSeconds * 1000; ch.deadline = ch.gmWindowUntil + ch.entry.capSeconds * 1000; ch.reports = {}; ch.gmPending = false;
  ch.series = ch.entry.team ? { target: CH.seriesWins, maxRounds: SERIES_MAX_ROUNDS, round: 1, wins: { [ch.attackerId]: 0, [ch.defenderId]: 0 }, log: [] } : null;
  if (entry.hosted && hosted.isPurposeBuilt(entry.game)) {
    ch.seed = streamRng(state, 'challenge').int(0, 0x7fffffff);
    ch.hostedGame = hosted.create(ch.seed, ch.entry, { aId: ch.attackerId, bId: ch.defenderId }, ch.gmWindowUntil, CH, state.gm.triviaBank);
  } else ch.hostedGame = null;
  state.lastSpin = { wheel: 'challenge', outcomes: pool.map(e => e.name), index, playerId: ch.attackerId, ts: ctx.now, revealAt: ch.gmWindowUntil, challengeId: ch.id, how };
  note(state, how === 'spin' ? `The Challenge Wheel lands on ${entry.name}` : how === 'reroll' ? `The GM rerolls: ${entry.name}` : `The GM forces ${entry.name}`, how === 'spin' ? 'wheel' : 'gm', ctx.now);
}

// ---------------------------------------------------------------- owed turns
// Held seats are skipped by derivation, so the next free seat plays in a held player's slot and that player's
// own slot comes round again later: the free seat "borrowed" a turn. When the held player comes back with
// missedTurn set they are owed one per slot missed (held[pid].misses): state.owedTurns = [{ playerId, at }] queues
// them in the order the slots were missed, and at the next end of turn every other seat is put on a one-slot
// `owedWait` hold so derivation picks the owed player first. Whoever owned the slot they took
// repays a borrow if they have one (state.turnCredits), otherwise they are owed in turn — the shift walks round
// the table until it reaches the borrower, and the order settles back exactly as it was.
function placeOwedTurn(state, ctx) {
  state.owedTurns ||= [];
  const seats = activeSeats(state);
  const head = state.owedTurns.find(o => seats.includes(o.playerId) && !(state.held[o.playerId] && !state.held[o.playerId].owedWait))?.playerId;
  if (!head) return;
  for (const id of seats) if (id !== head && !state.held[id]) state.held[id] = { since: ctx.now, owedWait: true, forId: head };
  state.owedInsert = head;
}
function clearOwedWait(state) { for (const [id, h] of Object.entries(state.held)) if (h.owedWait) delete state.held[id]; }

runHooks.turnEnd.push((state, ctx) => { clearOwedWait(state); state.owedInsert = null; if (state.phase === 'playing') placeOwedTurn(state, ctx); });
runHooks.turnStart.push((state, ctx, pid) => {
  state.owedTurns ||= []; state.turnCredits ||= {};
  const wasInsert = state.owedInsert === pid;   // the owedWait holds stay on for this whole turn: derivation must keep picking pid
  if (wasInsert) { const i = state.owedTurns.findIndex(o => o.playerId === pid); if (i >= 0) state.owedTurns.splice(i, 1); }
  const seats = activeSeats(state), owner = seats.length ? seats[state.turnIdx % seats.length] : null;
  if (owner && owner !== pid) {
    if (state.held[owner] && !state.held[owner].owedWait) { const h = state.held[owner]; h.missedTurn = true; (h.misses ||= []).push(state.turnIdx); if (!wasInsert) state.turnCredits[pid] = (state.turnCredits[pid] || 0) + 1; }
    else if ((state.turnCredits[owner] || 0) > 0) state.turnCredits[owner] -= 1;
    else state.owedTurns.push({ playerId: owner, at: state.turnIdx });
  }
  // Wanted counts down on the wanted player's own turns.
  const c = charOf(state, pid);
  if (c && c.wanted > 0) { c.wanted -= 1; if (c.wanted === 0) { c.wantedBounty = 0; note(state, `${nameOf(state, pid)} is no longer Wanted`, 'info', ctx.now); } }
});
