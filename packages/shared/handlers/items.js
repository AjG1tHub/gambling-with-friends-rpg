// Items as moves: ITEM_USE opens a round on the acting phone, ITEM_STEP mirrors its snapshots, ITEM_RESOLVE turns
// `stake × mult` into damage, healing or a shield through health.js. Area items, consumables and class actives
// live here too, with the damage pipeline (damageHooks.stake → outgoing → incoming) that other modules plug into.
//
// Payoff (ITEM_RESOLVE / MONSTER_ACT / AREA_RESOLVE all go through resolveHit). The game reports the legacy
// total-return multiple `base` (0 lose · 1 push · 2 = 1:1 win). The pipeline's info carries the PAYOUT multiple,
// as the challenge module and the gear hooks already use it:
//   info = { attackerId, attackerKind, targetId, targetKind, item, gameId, kind, crit, base, stake,
//            mult: base − 1 (0 on a loss), lost: round(stake × (1 − base)) on a loss, lossMult: 1, flat: 0, notes: [], cancel }
//   win  (base > 1): payout = round(stake × info.mult × (1 + bonusFor(rarity)) + info.flat)
//                    attack/versus → the target takes it (pets first, shield first); spell → heal or shield
//   loss (base < 1): the attacker loses round(info.lost × info.lossMult) Health (shields do not absorb a stake)
//   push / cancel: nothing moves.  Hooks scale info.mult (Whale, Chaos, affixes, Grit guards), add info.flat,
//   set info.cancel, or (Double Down) info.lossMult.
import { register, refuse, requirePhase, requireActor, requireGm } from '../reducer.js';
import { currentPlayerId, characterOf, playerOfCharacter, allied, note, alive } from '../state.js';
import { damageHooks, deathHooks, petHooks, levelHooks, classActives, consumables, runMods } from '../hooks.js';
import * as money from '../health.js';
import { bonusFor, group } from '../balance.js';
import * as hex from '../hex.js';
import { monsterHealth, openFight, monsterDied } from './fight.js';
import { hasUpgrade, effectiveStats } from '../characters/character.js';
import { setCooldown, onCooldown, cooldownKeyFor } from './classes.js';

const ATTACK_KINDS = new Set(['attack', 'versus']);
const CONSUMABLE_IDS = ['potion', 'nudge', 'reroll', 'fork', 'smokebomb', 'phoenixfeather'];
export const isWeaponOrSpell = (item) => !!item && !!item.gameId && (item.slot === 'weapon' || item.slot === 'offhand' || item.slot === 'spell');
const r0 = (v) => Math.round(v);

// ── Lookups ──────────────────────────────────────────────────────────────────────────────────────
export function findItem(c, itemId) { return (c && c.items && c.items[itemId]) || null; }
export function isWorn(c, itemId) { return !!c.worn && Object.values(c.worn).some(w => w && (w.id === itemId || w === itemId)); }
export function inGrid(c, itemId) { return !!c.grid && (c.grid.cells || []).some(cell => cell.itemId === itemId); }
export const holds = (c, itemId) => !!findItem(c, itemId) && (isWorn(c, itemId) || inGrid(c, itemId) || !c.grid);
export function hasEffect(c, id) { return !!c.effects && c.effects.some(e => e.id === id); }
export function addEffect(c, effect) { (c.effects ||= []).push({ kind: 'flag', turnsLeft: null, data: null, ...effect }); }
export function takeEffect(c, id) { const i = (c.effects || []).findIndex(e => e.id === id); if (i < 0) return null; return c.effects.splice(i, 1)[0]; }
const posOf = (x) => (x && x.pos ? (typeof x.pos === 'string' ? hex.parse(x.pos) : x.pos) : null);
const wornItems = (c) => Object.values(c.worn || {}).filter(Boolean);
const hasAffix = (c, id) => wornItems(c).some(it => (it.affixes || []).some(a => a.id === id || a.kind === id));
export function reachOf(state, ctx, c) {
  const I = ctx.B('items');
  return hasUpgrade(c, 'longarm') || hasAffix(c, 'longarm') ? I.reachLongArm : I.reachDefault;
}
// Reach check for attacks: true without a map or without positions (lobby, Lab, tests); else hex distance ≤ reach.
export function inReach(state, attackerId, targetPos, ctx = null) {
  if (!state.map) return true;
  const c = state.characters[attackerId] || (state.monsters || {})[attackerId] || null;
  const a = posOf(c), t = targetPos ? (typeof targetPos === 'string' ? hex.parse(targetPos) : targetPos) : null;
  if (!a || !t) return true;
  const B = ctx ? ctx.B : (g) => group(state, g);
  const reach = c && c.classId !== undefined ? reachOf(state, { B }, c) : B('items').reachDefault;
  return hex.distance(a, t) <= reach;
}
const regionOf = (state, pos) => { if (!state.map || !pos) return null; const h = state.map.hexes[typeof pos === 'string' ? pos : hex.key(pos)]; return h ? state.map.regions[h.regionId] || null : null; };
const isCaldera = (region) => !!region && (/caldera/i.test(region.id || '') || /caldera/i.test(region.name || '') || region.modifier === 'caldera');

// ── Stake ────────────────────────────────────────────────────────────────────────────────────────
export function effectiveStake(state, ctx, c, item) {
  const info = { attackerId: c.id, item, kind: item.kind, stake: item.stake, notes: [] };
  runMods(damageHooks.stake, state, ctx, info);
  return Math.max(1, r0(info.stake));
}
export const canOverstake = (c) => hasUpgrade(c, 'overstake');

// ── Payoff ───────────────────────────────────────────────────────────────────────────────────────
function xp(state, ctx, charId, amount, why) {
  if (!amount) return;
  const info = { charId, amount, why };
  if (levelHooks.onXp.length) { for (const h of levelHooks.onXp) h(state, ctx, info); return; }
  const c = state.characters[charId]; if (c) c.xp = (c.xp || 0) + amount;   // no level module registered yet: keep the count
}
const statsOf = (state, charId) => { const p = playerOfCharacter(state, charId); return p ? state.stats[p.id] : null; };
const nameOf = (state, id, kind) => (kind === 'monster' ? state.monsters[id]?.name : state.characters[id]?.name) || id;

export function characterZero(state, ctx, c, info) {
  // A self-inflicted death (a lost stake, a fizzled spell) counts as the minor, monster-style penalty.
  const byKind = info.attackerKind === 'character' ? 'player' : (state.monsters[info.attackerId]?.boss ? 'boss' : 'monster');
  const killerId = info.attackerKind === 'self' ? null : info.attackerId;
  // The death module's contract: { charId, killerId, killerKind, prevented }; byId/byKind are kept as aliases.
  const zi = { charId: c.id, killerId, killerKind: byKind, byId: killerId, byKind, info, prevented: false };
  for (const h of deathHooks.onZero) h(state, ctx, zi);
  if (zi.prevented || c.health > 0 || c.dead) return zi;
  for (const h of deathHooks.onDeath) h(state, ctx, zi);
  if (!c.dead) {   // no death module registered: the minimal record so the fight can end
    c.dead = true; c.diedTo = byKind; c.deaths = (c.deaths || 0) + 1; c.diedAt = ctx.now;
    const s = statsOf(state, c.id); if (s) s.deaths += 1;
    const k = info.attackerKind === 'character' ? state.characters[info.attackerId] : null;
    if (k && k.id !== c.id) { k.kills = (k.kills || 0) + 1; const ks = statsOf(state, k.id); if (ks) ks.kills += 1; }
  }
  if (info.attackerKind === 'character' && info.attackerId !== c.id) xp(state, ctx, info.attackerId, ctx.B('xp').ko, 'ko');
  const p = playerOfCharacter(state, c.id);
  if (state.fight && p && (state.fight.playerId === p.id || (state.fight.playerIds || []).includes(p.id)) && !state.fight.done) { state.fight.done = true; state.fight.result = 'lost'; state.fight.endedAt = ctx.now; }
  note(state, `${c.name} falls to ${nameOf(state, info.attackerId, info.attackerKind)}`, 'death', ctx.now);
  return zi;
}
function dealDamage(state, ctx, info, dmg) {
  if (dmg <= 0) return 0;
  if (info.targetKind === 'monster') {
    const m = state.monsters[info.targetId]; if (!m) refuse('no such monster');
    const moved = -monsterHealth(state, m, -dmg, `${info.item?.name || info.gameId} hit`, ctx);
    info.damage = moved;
    if (m.health <= 0 && !m.dead) monsterDied(state, ctx, m, info.attackerId);
    return moved;
  }
  const c = state.characters[info.targetId]; if (!c) refuse('no such character');
  for (const h of petHooks.beforeCharacterHit) h(state, ctx, info);
  if (info.redirectToPet) {
    const pet = (c.pets || []).find(p => p.id === info.redirectToPet);
    if (pet) { const moved = -money.power(state, pet, -dmg, `${info.item?.name || info.gameId} hit (pet)`, ctx); info.damage = moved; info.petHit = pet.id; if (pet.power <= 0) pet.fainted = true; return moved; }
  }
  const moved = -money.health(state, c, -dmg, `${info.item?.name || info.gameId} hit by ${nameOf(state, info.attackerId, info.attackerKind)}`, ctx);
  info.damage = dmg; info.healthLost = moved;
  const ts = statsOf(state, c.id); if (ts) ts.damageTaken += dmg;
  if (c.health <= 0) characterZero(state, ctx, c, info);
  return dmg;
}
// The one payoff path. Returns the info object with damage / healed / shielded / loss filled in.
export function resolveHit(state, ctx, { attackerId, attackerKind = 'character', targetId, targetKind, item, stake, mult, label = '', crit = false }) {
  if (!Number.isFinite(Number(mult))) refuse('mult must be a number');
  const base = Number(mult), won = base > 1, lost = base < 1;
  const info = { attackerId, attackerKind, targetId, targetKind, item, gameId: item?.gameId, kind: item?.kind || 'attack', crit: !!crit, base, stake, mult: won ? base - 1 : 0, lost: lost ? r0(stake * (1 - base)) : 0, lossMult: 1, flat: 0, notes: [], label, cancel: false, damage: 0, healed: 0, shielded: 0, loss: 0, redirectToPet: null };
  if (attackerKind === 'character') runMods(damageHooks.outgoing, state, ctx, info);
  if (info.kind !== 'spell' && targetKind !== 'self') runMods(damageHooks.incoming, state, ctx, info);
  const attacker = attackerKind === 'monster' ? state.monsters[attackerId] : state.characters[attackerId];
  const who = nameOf(state, attackerId, attackerKind);
  if (info.cancel) { info.notes.push('cancelled'); note(state, `${who}'s ${item?.name || info.gameId}: ${info.cancelText || 'voided'}`, 'fight', ctx.now); return info; }
  const payout = won ? Math.max(0, r0(info.stake * info.mult * (1 + bonusFor(state, item?.rarity || 'common')) + info.flat)) : 0;
  info.payout = payout;
  if (info.kind === 'spell') {
    const t = state.characters[targetKind === 'self' ? attackerId : targetId] || attacker;
    if (won) {
      if (item?.spellEffect === 'shield') { info.shielded = money.shield(state, t, payout, `${item.name}`, ctx); note(state, `${who} casts ${item.name}: ${label} — ${t.name} gains a ${info.shielded} shield`, 'fight', ctx.now); }
      else { info.healed = money.health(state, t, payout, `${item?.name || 'spell'}`, ctx); note(state, `${who} casts ${item?.name || 'a spell'}: ${label} — ${t.name} heals ${info.healed}`, 'fight', ctx.now); }
      for (const h of damageHooks.afterHit) h(state, ctx, info);
    } else if (lost) {
      info.loss = info.lost = r0(info.lost * info.lossMult);
      money.health(state, attacker, -info.loss, `${item?.name || 'spell'} fizzles`, ctx, { ignoreShield: true });
      note(state, `${who}'s ${item?.name || 'spell'} fizzles: ${label} — loses ${info.loss}`, 'fight', ctx.now);
      for (const h of damageHooks.afterMiss) h(state, ctx, info);
      if (attacker.health <= 0) characterZero(state, ctx, attacker, { ...info, attackerId, attackerKind: 'self', targetId: attackerId });
    } else note(state, `${who}'s ${item?.name || 'spell'} pushes`, 'fight', ctx.now);
    return info;
  }
  if (won) {
    dealDamage(state, ctx, info, payout);
    const s = attackerKind === 'character' ? statsOf(state, attackerId) : null;
    if (s) { s.hits += 1; if (info.crit) s.crits += 1; s.damageDealt += info.damage || 0; }
    if (attackerKind === 'character') { const c = state.characters[attackerId]; if (c) c.streak = (c.streak || 0) + 1; xp(state, ctx, attackerId, ctx.B('xp').hit + (info.crit ? ctx.B('xp').crit : 0), info.crit ? 'crit' : 'hit'); }
    note(state, `${who} hits ${nameOf(state, targetId, targetKind)} with ${item?.name || info.gameId}: ${label} — ${info.petHit ? 'the pet takes ' : ''}${info.damage}${info.crit ? ' CRIT' : ''}`, 'fight', ctx.now);
    for (const h of damageHooks.afterHit) h(state, ctx, info);
  } else if (lost) {
    info.loss = info.lost = r0(info.lost * info.lossMult);
    if (attackerKind === 'monster') monsterHealth(state, attacker, -info.loss, `${item?.name || info.gameId} miss`, ctx);
    else { money.health(state, attacker, -info.loss, `${item?.name || info.gameId} miss`, ctx, { ignoreShield: true }); attacker.streak = 0; const s = statsOf(state, attackerId); if (s) s.damageTaken += info.loss; }
    note(state, `${who} misses with ${item?.name || info.gameId}: ${label} — loses ${info.loss}`, 'fight', ctx.now);
    for (const h of damageHooks.afterMiss) h(state, ctx, info);
    if (attackerKind !== 'monster' && attacker.health <= 0) characterZero(state, ctx, attacker, { ...info, attackerKind: targetKind === 'monster' ? 'monster' : 'character', attackerId: targetId, targetId: attackerId });
  } else { if (attackerKind === 'character') { const c = state.characters[attackerId]; if (c) c.streak = 0; } note(state, `${who}'s ${item?.name || info.gameId} pushes: ${label}`, 'fight', ctx.now); }
  return info;
}

// ── Fight bookkeeping shared with fight.js ───────────────────────────────────────────────────────
export function soloFight(state, ctx, pid) {
  return { id: `fight-${ctx.now.toString(36)}-${(state.eventCount || 0).toString(36)}`, kind: 'solo', monsterId: null, playerIds: [pid], playerId: pid, turn: 'player', game: null, log: [], done: false, result: null, startedAt: ctx.now, rig: null };
}
function requireMyTurn(state, ctx, pid) {
  if (ctx.isGm) return;
  if (currentPlayerId(state) !== pid) refuse('not your turn', 'turn');
  if (state.gm.paused) refuse('paused', 'paused');
}
function actorFor(state, ctx) { const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid); const c = characterOf(state, pid); if (!c) refuse('no character', 'player'); if (c.dead) refuse('you are dead', 'dead'); return { pid, c }; }

// ── Handlers ─────────────────────────────────────────────────────────────────────────────────────
register({
  ITEM_USE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actorFor(state, ctx); requireMyTurn(state, ctx, pid);
    const { itemId, targetId = null } = ctx.payload; let { targetKind = null } = ctx.payload;
    const item = findItem(c, itemId); if (!item || !isWeaponOrSpell(item)) refuse('no such weapon or spell', 'item');
    if (!holds(c, itemId)) refuse('that item is not worn or in your grid', 'item');
    if (!(item.charges > 0)) refuse(`${item.name} has no charges left`, 'charges');
    if (item.kind === 'area') refuse('Area items open a window: send AREA_OPEN', 'kind');
    const I = ctx.B('items');
    const f = state.fight && !state.fight.done ? state.fight : null;
    if (f && f.game && !f.game.result) refuse('finish the round in progress', 'busy');
    if (f && f.kind !== 'solo' && !(f.playerId === pid || (f.playerIds || []).includes(pid))) refuse('someone else is in a fight', 'busy');
    if (f && f.kind !== 'solo' && f.turn !== 'player') refuse('the monster is acting', 'turn');
    const stake = effectiveStake(state, ctx, c, item);
    if (stake > c.health && !canOverstake(c)) refuse(`stake ${stake} exceeds your Health (${c.health})`, 'stake');
    const used = c.usedThisTurn || (c.usedThisTurn = { attack: 0, spell: 0, moved: false });
    const spellCap = I.spellsPerTurn + (hasUpgrade(c, 'twospells') ? 1 : 0);
    if (ATTACK_KINDS.has(item.kind) && used.attack >= I.attacksPerTurn) refuse('one attack per turn', 'limit');
    if (item.kind === 'spell' && used.spell >= spellCap) refuse(`${spellCap === 1 ? 'one spell' : spellCap + ' spells'} per turn`, 'limit');
    // Target rules per kind.
    if (item.kind === 'spell') {
      if (!targetId || targetId === c.id) targetKind = 'self';
      else { const t = state.characters[targetId]; if (!t || !alive(t)) refuse('no such ally', 'target'); const tp = playerOfCharacter(state, targetId); if (!tp || !allied(state, pid, tp.id)) refuse('spells target yourself or an ally', 'target'); if (!inReach(state, c.id, t.pos, ctx)) refuse('ally out of reach', 'reach'); targetKind = 'character'; }
    } else if (targetKind === 'monster' || (!targetKind && state.monsters[targetId])) {
      targetKind = 'monster';
      const m = state.monsters[targetId]; if (!m || m.dead) refuse('no such monster', 'target');
      if (f && f.kind !== 'solo' && f.monsterId !== targetId) refuse('you are fighting something else', 'target');
      if (!inReach(state, c.id, m.pos, ctx)) refuse('monster out of reach', 'reach');
      if (item.kind === 'versus') refuse('versus items need a player', 'target');
      if (!f || f.kind === 'solo') openFight(state, ctx, pid, targetId);
    } else {
      targetKind = 'character';
      const t = state.characters[targetId]; if (!t || !alive(t) || t.id === c.id) refuse('no such target', 'target');
      if (f && f.kind !== 'solo') refuse('finish the monster first', 'busy');
      if (!inReach(state, c.id, t.pos, ctx)) refuse('target out of reach', 'reach');
    }
    if (!state.fight || state.fight.done) state.fight = soloFight(state, ctx, pid);
    const fight = state.fight;
    const rig = fight.rig || null; fight.rig = null;
    fight.game = { itemId, gameId: item.gameId, kind: item.kind, mode: 'health', stake, attackerId: c.id, attackerPlayerId: pid, targetId: targetKind === 'self' ? c.id : targetId, targetKind, phase: 'ready', view: {}, result: null, pending: null, pendingChoice: null, rig, startedTs: ctx.now, legacy: null, lastText: '' };
    if (ATTACK_KINDS.has(item.kind)) used.attack += 1; else used.spell += 1;
    note(state, `${c.name} readies ${item.name} (${stake} Health)${targetKind === 'self' ? '' : ' on ' + nameOf(state, fight.game.targetId, targetKind)}`, 'fight', ctx.now);
  },
  ITEM_STEP(state, ev, ctx) {
    const f = state.fight, g = f && f.game; if (!g) refuse('no round open', 'nogame');
    if (!ctx.isGm && ctx.actor !== g.attackerPlayerId) refuse('not your round', 'forbidden');
    const snap = ctx.payload.game ? stripSecret(ctx.payload.game) : null;
    if (snap) { g.legacy = snap; g.phase = snap.phase || g.phase; g.view = snap.view || g.view; g.pending = snap.pending || null; g.forkOptions = snap.forkOptions || null; }
    if (ctx.payload.text) g.lastText = String(ctx.payload.text).slice(0, 200);
    g.stepTs = ctx.now;
  },
  ITEM_RESOLVE(state, ev, ctx) {
    const f = state.fight, g = f && f.game; if (!g) refuse('no round open', 'nogame');
    if (!ctx.isGm && ctx.actor !== g.attackerPlayerId) refuse('not your round', 'forbidden');
    if (g.result) refuse('already resolved', 'done');
    const { mult, label = '', crit = false, game: snap = null } = ctx.payload;
    if (!Number.isFinite(Number(mult)) || Number(mult) < -8 || Number(mult) > 10001) refuse('bad multiplier', 'mult');
    const c = state.characters[g.attackerId]; const item = findItem(c, g.itemId); if (!item) refuse('the item is gone', 'item');
    if (snap) g.legacy = stripSecret(snap);
    const info = resolveHit(state, ctx, { attackerId: c.id, attackerKind: 'character', targetId: g.targetId, targetKind: g.targetKind, item, stake: g.stake, mult: Number(mult), label, crit: !!crit });
    item.charges = Math.max(0, (item.charges || 0) - 1);
    g.result = { mult: Number(mult), label, crit: !!crit, damage: info.damage, healed: info.healed, shielded: info.shielded, loss: info.loss }; g.phase = 'done'; g.resolvedTs = ctx.now;
    f.log.push({ ts: ctx.now, by: c.id, itemId: item.id, gameId: item.gameId, mult: Number(mult), label, crit: !!crit, damage: info.damage, loss: info.loss, healed: info.healed, shielded: info.shielded });
    f.lastGame = g; f.game = null;
    if (f.kind === 'solo') { f.done = true; f.result = 'resolved'; }
    else if (!f.done && f.monsterId && state.monsters[f.monsterId] && !state.monsters[f.monsterId].dead) f.turn = 'monster';
  },
  // ── Area items: a window in which every character on the hex may stake on the same game ─────────
  AREA_OPEN(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actorFor(state, ctx); requireMyTurn(state, ctx, pid);
    const item = findItem(c, ctx.payload.itemId); if (!item || item.kind !== 'area') refuse('not an Area item', 'item');
    if (!holds(c, item.id)) refuse('that item is not worn or in your grid', 'item');
    if (!(item.charges > 0)) refuse(`${item.name} has no charges left`, 'charges');
    if (state.area && !state.area.done) refuse('an Area window is already open', 'busy');
    const used = c.usedThisTurn || (c.usedThisTurn = { attack: 0, spell: 0, moved: false });
    if (used.attack >= ctx.B('items').attacksPerTurn) refuse('one attack per turn', 'limit');
    const stake = effectiveStake(state, ctx, c, item);
    if (stake > c.health && !canOverstake(c)) refuse(`stake ${stake} exceeds your Health (${c.health})`, 'stake');
    used.attack += 1;
    state.area = { id: `area-${ctx.now.toString(36)}`, itemId: item.id, gameId: item.gameId, attackerId: c.id, attackerPlayerId: pid, hexKey: c.pos || null, opensAt: ctx.now, deadline: ctx.now + ctx.B('items').areaWindowSeconds * 1000,
      stakes: { [c.id]: { stake, pick: ctx.payload.pick ?? null, playerId: pid } }, done: false, results: null, monsterId: state.fight && !state.fight.done && state.fight.kind !== 'solo' ? state.fight.monsterId : null };
    note(state, `${c.name} opens ${item.name}: ${ctx.B('items').areaWindowSeconds}s to stake`, 'fight', ctx.now);
  },
  AREA_STAKE(state, ev, ctx) {
    const a = state.area; if (!a || a.done) refuse('no Area window', 'nogame');
    const { pid, c } = actorFor(state, ctx);
    if (ctx.now > a.deadline) refuse('the window has closed', 'late');
    if (a.hexKey && c.pos && c.pos !== a.hexKey) refuse('you are not on that hex', 'reach');
    const stake = Math.max(1, r0(Number(ctx.payload.stake ?? ctx.B('items').stakeCommon)));
    if (stake > c.health) refuse(`stake ${stake} exceeds your Health (${c.health})`, 'stake');
    a.stakes[c.id] = { stake, pick: ctx.payload.pick ?? null, playerId: pid };
  },
  AREA_RESOLVE(state, ev, ctx) {
    const a = state.area; if (!a || a.done) refuse('no Area window', 'nogame');
    const onHex = Object.values(state.characters).filter(x => alive(x) && (!a.hexKey || x.pos === a.hexKey));
    const everyone = onHex.every(x => a.stakes[x.id]);
    if (!ctx.isGm && ctx.actor !== a.attackerPlayerId) refuse('only the attacker or the TV resolves', 'forbidden');
    if (ctx.now < a.deadline && !everyone && !ctx.isGm) refuse('the window is still open', 'early');
    const results = ctx.payload.results || {}; const attacker = state.characters[a.attackerId]; const item = findItem(attacker, a.itemId) || { name: a.gameId, gameId: a.gameId, kind: 'area', rarity: 'common' };
    const foes = onHex.filter(x => x.id !== a.attackerId && !allied(state, a.attackerPlayerId, playerOfCharacter(state, x.id)?.id));
    a.results = {}; a.done = true; a.resolvedAt = ctx.now;
    for (const [charId, s] of Object.entries(a.stakes)) {
      const r = results[charId]; if (!r || !Number.isFinite(Number(r.mult))) continue;
      const mult = Number(r.mult), ch = state.characters[charId]; if (!ch) continue;
      const isAttacker = charId === a.attackerId, ally = isAttacker || allied(state, a.attackerPlayerId, playerOfCharacter(state, charId)?.id);
      a.results[charId] = { mult, label: r.label || '', crit: !!r.crit, damage: 0, loss: 0 };
      if (mult > 1) {
        // Winners strike: the attacker and their allies hit every foe on the hex (and the fight's monster); foes hit the attacker back.
        const targets = ally ? [...foes.map(x => ({ id: x.id, kind: 'character' })), ...(a.monsterId && state.monsters[a.monsterId] && !state.monsters[a.monsterId].dead ? [{ id: a.monsterId, kind: 'monster' }] : [])] : [{ id: a.attackerId, kind: 'character' }];
        for (const t of targets) { if (t.kind === 'character' && !alive(state.characters[t.id])) continue; const info = resolveHit(state, ctx, { attackerId: charId, targetId: t.id, targetKind: t.kind, item, stake: s.stake, mult, label: r.label || '', crit: !!r.crit }); a.results[charId].damage += info.damage || 0; }
        if (!targets.length) note(state, `${ch.name} wins the ${item.name} round but nobody is in range`, 'fight', ctx.now);
      } else if (mult < 1) {
        const loss = r0(s.stake * (1 - mult)); a.results[charId].loss = loss;
        money.health(state, ch, -loss, `${item.name} (Area) miss`, ctx, { ignoreShield: true }); ch.streak = 0;
        if (ch.health <= 0) characterZero(state, ctx, ch, { attackerId: a.attackerId, attackerKind: 'character', targetId: ch.id, targetKind: 'character', item });
      }
    }
    if (item.charges > 0) item.charges -= 1;
    note(state, `${item.name} resolves for ${Object.keys(a.results).length} staker(s)`, 'fight', ctx.now);
  },
  // ── Consumables ───────────────────────────────────────────────────────────────────────────────
  CONSUMABLE_USE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actorFor(state, ctx);
    const { itemId = null } = ctx.payload; let baseId = ctx.payload.baseId || null;
    let item = itemId ? findItem(c, itemId) : null;
    if (item) { if (item.slot !== 'consumable') refuse('not a consumable', 'item'); baseId = item.baseId; }
    if (!baseId) refuse('itemId required', 'item');
    const free = baseId === 'smokebomb' && !item && (c.freeSmokeBombs || 0) > 0;
    if (!item && !free) refuse('you do not have that', 'item');
    const fn = consumables[baseId] || BUILTIN_CONSUMABLES[baseId]; if (!fn) refuse(`unknown consumable ${baseId}`, 'item');
    fn(state, ctx, c, { ...ctx.payload, pid, item });
    if (free) c.freeSmokeBombs -= 1; else consumeOne(c, item);
  },
  // ── Class actives ─────────────────────────────────────────────────────────────────────────────
  CLASS_ACTIVE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actorFor(state, ctx);
    const { activeId } = ctx.payload; if (!activeId) refuse('activeId required');
    const fn = classActives[activeId] || BUILTIN_ACTIVES[activeId]; if (!fn) refuse(`unknown active ${activeId}`, 'active');
    checkActive(state, ctx, c, activeId);                   // validate first: a refused active must not start its cooldown
    fn(state, ctx, c, { ...ctx.payload, pid });
    setCooldown(state, ctx, c, cooldownKeyFor(c.classId));
  },
});

export function consumeOne(c, item) {
  if (!item) return;
  item.qty = Math.max(0, (item.qty || 1) - 1);
  if (item.qty > 0) return;
  delete c.items[item.id];
  if (c.grid && c.grid.cells) c.grid.cells = c.grid.cells.filter(cell => cell.itemId !== item.id);
}
const CLASS_ACTIVE_IDS = { whale: 'doubledown', pitboss: 'houserules', cutpurse: 'sleight', enforcer: 'callout', beastmaster: 'rally', croupier: 'rigthedeck' };
// Cooldown bookkeeping is shared with handlers/classes.js: setCooldown applies Tempo and the level-20 upgrade,
// and its turnStart hook counts c.cooldowns.active down in the owner's own turns. This module never decrements it.
export function checkActive(state, ctx, c, activeId) {
  if (CLASS_ACTIVE_IDS[c.classId] !== activeId) refuse(`${activeId} is not your class active`, 'active');
  c.cooldowns ||= { active: 0 };
  if (onCooldown(c)) refuse(`${activeId} is on cooldown (${c.cooldowns.active} turns)`, 'cooldown');
}
export function useActive(state, ctx, c, activeId) {
  checkActive(state, ctx, c, activeId);
  return setCooldown(state, ctx, c, cooldownKeyFor(c.classId));
}
const BUILTIN_ACTIVES = {
  doubledown(state, ctx, c) { if (hasEffect(c, 'doubledown')) refuse('Double Down is already armed', 'active'); addEffect(c, { id: 'doubledown' }); note(state, `${c.name} doubles down: the next hit is ×2, win or lose`, 'class', ctx.now); },
  rigthedeck(state, ctx, c, p) {
    const outcome = p.outcome === 'lose' ? 'lose' : 'win';
    const f = state.fight && !state.fight.done ? state.fight : null; if (!f) refuse('Rig the Deck needs a fight', 'active');
    f.rig = { outcome, by: c.id, forId: p.targetId || null };
    if (f.game && !f.game.result) f.game.rig = f.rig;
    note(state, `${c.name} rigs the deck: the next binary outcome is a ${outcome.toUpperCase()}`, 'class', ctx.now);
  },
};
const BUILTIN_CONSUMABLES = {
  potion(state, ctx, c) { const h = money.health(state, c, ctx.B('health').potionHeal, 'Potion', ctx); note(state, `${c.name} drinks a Potion (+${h})`, 'item', ctx.now); },
  nudge(state, ctx, c, p) { const g = roundFor(state, c, 'nudge'); if (!['dice', 'wheels'].includes(g.family || itemFamily(c, g))) refuse('Nudge works on dice and wheel items', 'kind'); if (g.pending || g.result) refuse('too late to nudge', 'late'); g.pendingChoice = { kind: 'nudge', label: p.label || null, by: c.id, ts: ctx.now }; },
  reroll(state, ctx, c, p) { const g = roundFor(state, c, 'reroll'); if ((g.family || itemFamily(c, g)) !== 'cards' && !(c.classId === 'croupier')) refuse('Reroll works on card items', 'kind'); if (g.result) refuse('already resolved', 'late'); g.pendingChoice = { kind: 'reroll', by: c.id, ts: ctx.now }; },
  fork(state, ctx, c, p) { const g = roundFor(state, c, 'fork'); if (g.result) refuse('already resolved', 'late'); g.pendingChoice = { kind: 'fork', by: c.id, ts: ctx.now, choice: p.choice ?? null }; },
  smokebomb(state, ctx, c) {
    const f = state.fight; if (!f || f.done || f.kind === 'solo') refuse('no fight to leave', 'nogame');
    if (f.calledOut) refuse('you were called out: no Smoke Bomb', 'calledout');
    f.done = true; f.fled = true; f.result = 'fled'; f.game = null; f.endedAt = ctx.now;
    note(state, `${c.name} vanishes in smoke`, 'item', ctx.now);
  },
  phoenixfeather(state, ctx, c) { if (hasEffect(c, 'phoenix')) refuse('a Phoenix Feather is already burning', 'item'); addEffect(c, { id: 'phoenix' }); note(state, `${c.name} holds a Phoenix Feather ready`, 'item', ctx.now); },
};
function roundFor(state, c, what) {
  const g = state.fight && !state.fight.done ? state.fight.game : null; if (!g) refuse(`no round to ${what}`, 'nogame');
  const mine = g.attackerId === c.id || (hasUpgrade(c, 'rerollfoe') && what === 'reroll');
  if (!mine) refuse('not your round', 'forbidden');
  return g;
}
const itemFamily = (c, g) => { const owner = c.id === g.attackerId ? c : null; const it = owner && findItem(owner, g.itemId); return it ? it.family : null; };
export const CONSUMABLE_BASE_IDS = CONSUMABLE_IDS;

// ── Hooks this module contributes ────────────────────────────────────────────────────────────────
damageHooks.stake.push((state, ctx, info) => {
  const c = state.characters[info.attackerId]; if (!c || !info.item) return;
  const K = ctx.B('classes');
  if (c.classId === 'whale' && info.item.kind !== 'spell') { info.stake *= 1 - K.whaleStakeDiscount; info.notes.push('Whale stake'); }
  if (c.classId === 'croupier' && info.item.kind === 'spell') { info.stake *= 1 - K.croupierSpellDiscount; info.notes.push('Croupier spell stake'); }
});
damageHooks.outgoing.push((state, ctx, info) => {
  const c = state.characters[info.attackerId]; if (!c) return;
  const K = ctx.B('classes'), H = ctx.B('health'), S = ctx.B('stats');
  if (c.classId === 'whale' && info.kind !== 'spell') { info.mult *= 1 + K.whaleDamageBonus; info.notes.push('Whale'); }
  const greed = (effectiveStats(state, c).greed ?? S.neutral) - S.neutral;
  if (greed > 0 && (c.streak || 0) > 0 && info.kind !== 'spell') { info.mult *= 1 + H.greedStreakBonus * greed; info.notes.push('Greed streak'); }
  if (hasEffect(c, 'doubledown')) {
    if (info.kind !== 'spell') { takeEffect(c, 'doubledown'); info.mult *= 2; info.lossMult *= 2; info.notes.push('Double Down'); }
    else if (hasUpgrade(c, 'healdouble')) { takeEffect(c, 'doubledown'); info.mult *= 2; info.lossMult *= 2; info.notes.push('Double Down (heal)'); }
  }
});
// Grit, guard affixes and the class guards are applied by handlers/inventory.js and handlers/classes.js; here only
// the Caldera, which doubles damage both ways for anyone standing in it.
damageHooks.incoming.push((state, ctx, info) => {
  if (info.targetKind === 'character') {
    const t = state.characters[info.targetId]; if (!t) return;
    if (isCaldera(regionOf(state, t.pos))) { info.mult *= ctx.B('map').calderaDamageMult; info.notes.push('Caldera'); }
  } else if (info.targetKind === 'monster') {
    const m = state.monsters[info.targetId]; if (m && isCaldera(regionOf(state, m.pos))) { info.mult *= ctx.B('map').calderaDamageMult; info.notes.push('Caldera'); }
  }
});
// Phoenix Feather: consumed at the killing blow, the character stays at 1 instead of dying.
deathHooks.onZero.push((state, ctx, zi) => {
  const c = state.characters[zi.charId]; if (!c || zi.prevented || !hasEffect(c, 'phoenix')) return;
  takeEffect(c, 'phoenix'); money.health(state, c, 1 - c.health, 'Phoenix Feather', ctx, { ignoreShield: true }); zi.prevented = true; zi.by = 'phoenix';
  note(state, `${c.name}'s Phoenix Feather burns: death cancelled`, 'item', ctx.now);
});

export function stripSecret(obj) {
  if (Array.isArray(obj)) return obj.map(stripSecret);
  if (obj && typeof obj === 'object') { const out = {}; for (const [k, v] of Object.entries(obj)) { if (k === 'secret') continue; out[k] = stripSecret(v); } return out; }
  return obj;
}
