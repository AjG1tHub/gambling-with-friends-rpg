// Encounters: FIGHT_START opens state.fight against a monster, the player and the monster alternate (ITEM_RESOLVE
// hands the turn to the monster, MONSTER_ACT hands it back), fights are to the death, and the monster's Health moves
// only through monsterHealth() so the ledger has every row. The TV plays the monster's item headlessly through the
// adapter (playMonsterTurn) and appends MONSTER_ACT with the result; the reducer applies it through the same payoff
// path as a player's hit (handlers/items.js › resolveHit).
import { onAfter, register, refuse, requirePhase, requireActor, requireGm } from '../reducer.js';
import { currentPlayerId, characterOf, playerOfCharacter, note, alive } from '../state.js';
import { lootHooks, levelHooks, moveHooks } from '../hooks.js';
import { hooks as runHooks } from './run.js';
import { resolveHit, inReach, stripSecret } from './items.js';
import { startRound } from '../../games/adapter.js';
import { makeRng } from '../rng.js';
import { group } from '../balance.js';

// A ctx for callers outside the reducer (the TV, bots, tests): the clock they pass and the room's balance.
export const headlessCtx = (state, now) => ({ now, actor: 'tv', isGm: false, payload: {}, B: (g) => group(state, g) });

// Monster Health: floors at 0, caps at maxHealth; one ledger row per move (kind 'monsterHealth').
export function monsterHealth(state, m, delta, why, ctx) {
  const amount = Math.round(delta), before = m.health;
  m.health = Math.max(0, Math.min(m.maxHealth || Infinity, before + amount));
  const moved = m.health - before;
  state.ledgerSeq = (state.ledgerSeq || 0) + 1;
  state.ledger.push({ n: state.ledgerSeq, ts: ctx?.now ?? state.lastEventTs ?? 0, kind: 'monsterHealth', charId: m.id, monsterId: m.id, amount, moved, why });
  if (state.ledger.length > 20000) state.ledger.splice(0, state.ledger.length - 20000);
  return moved;
}
export function makeDummy(state, ctx, { id = 'dummy', health = null, items = [] } = {}) {
  const hp = health ?? ctx.B('monsters').healthCommon;
  const m = { id, speciesId: 'dummy', name: 'Training Dummy', regionId: null, pos: null, health: hp, maxHealth: hp, stats: { luck: ctx.B('stats').neutral, nerve: ctx.B('stats').neutral, greed: ctx.B('stats').neutral, grit: ctx.B('stats').neutral }, items, boss: false, raid: false, final: false, gmControlled: false, dead: false, linkedTo: null, loot: { gold: [0, 0], items: [], egg: 0, dropChance: 0 }, dummy: true };
  state.monsters[id] = m; return m;
}
// A fight whose player ended their turn (run.js marks `passed`) stays open only for the monster's parting blow.
// If nobody delivered it before another engagement needs the slot, the player has simply walked away.
export function settleStaleFight(state, ctx) {
  const f = state.fight; if (!f || f.done || !f.passed || f.turn !== 'monster') return false;
  f.done = true; f.result = 'left'; f.endedAt = ctx.now;
  state.lastFight = { id: f.id, kind: f.kind, monsterId: f.monsterId, result: f.result, endedAt: ctx.now };
  note(state, `${characterOf(state, f.playerId)?.name || f.playerId} leaves ${state.monsters[f.monsterId]?.name || 'the fight'} behind`, 'fight', ctx.now);
  state.fight = null;
  return true;
}
export function openFight(state, ctx, pid, monsterId) {
  const m = state.monsters[monsterId]; if (!m || m.dead) refuse('no such monster', 'target');
  const c = characterOf(state, pid); if (!c) refuse('no character');
  settleStaleFight(state, ctx);
  if (state.fight && !state.fight.done && state.fight.kind !== 'solo') refuse('a fight is already open', 'busy');
  if (!inReach(state, c.id, m.pos, ctx)) refuse('the monster is not here', 'reach');
  state.fight = { id: `fight-${ctx.now.toString(36)}-${(state.eventCount || 0).toString(36)}`, kind: m.final ? 'boss' : m.raid ? 'raid' : m.boss ? 'boss' : 'encounter', monsterId, playerIds: [pid], playerId: pid, turn: 'player', game: null, log: [], done: false, result: null, startedAt: ctx.now, rig: null, fled: false };
  note(state, `${c.name} faces ${m.name} (${m.health} Health)`, 'fight', ctx.now);
  return state.fight;
}
export function monsterDied(state, ctx, m, byId) {
  m.dead = true; m.health = 0; m.diedAt = ctx.now;
  const f = state.fight;
  if (f && f.monsterId === m.id) { f.done = true; f.result = 'won'; f.endedAt = ctx.now; }
  const killer = state.characters[byId] || null, p = killer ? playerOfCharacter(state, killer.id) : null;
  if (killer) {
    killer.kills = (killer.kills || 0) + 1;
    if (p && state.stats[p.id]) { state.stats[p.id].kills += 1; if (m.boss || m.final || m.raid) state.stats[p.id].bosses += 1; }
    const X = ctx.B('xp'), amount = m.boss || m.final || m.raid ? X.boss : X.ko, why = m.boss || m.final || m.raid ? 'boss' : 'ko';
    if (levelHooks.onXp.length) { for (const h of levelHooks.onXp) h(state, ctx, { charId: killer.id, amount, why }); } else killer.xp = (killer.xp || 0) + amount;
  }
  for (const h of lootHooks.onDrop) h(state, ctx, { monsterId: m.id, byId, monster: m });
  note(state, `${m.name} is destroyed${killer ? ` by ${killer.name}` : ''}`, 'fight', ctx.now);
}
// Pick an item and play it with the smart bot. Returns the MONSTER_ACT payload (nothing is applied here).
// `rng` drives the dice (the TV uses its own clock-seeded rng: monster rounds are actor-authoritative), `pick` the bot.
export function playMonsterTurn(state, ctx, rng, { pick = null, smart = true, itemId = null, now = null } = {}) {
  if (!ctx || typeof ctx.B !== 'function') ctx = headlessCtx(state, ctx?.now ?? now ?? state.lastEventTs ?? 0);
  const f = state.fight; if (!f || f.done || f.turn !== 'monster') return null;
  const m = state.monsters[f.monsterId]; if (!m || m.dead) return null;
  const c = characterOf(state, f.playerId); if (!c) return null;
  const items = (m.items || []).filter(it => it && it.gameId && it.kind !== 'spell' && it.kind !== 'area');
  if (!items.length) return null;
  const botRng = pick || makeRng((rng.getState ? rng.getState() : 1) ^ 0x9e3779b9);
  const item = itemId ? items.find(it => it.id === itemId) : items[botRng.int(0, items.length - 1)];
  if (!item) return null;
  const stake = Math.max(1, Math.min(m.health, Math.round(item.stake * ctx.B('items').monsterStakeFraction)));
  const round = startRound(ctx, { item, mode: 'health', stake, attacker: { id: m.id, name: m.name, stats: m.stats || {} }, target: { id: c.id, name: c.name, stats: c.stats || {} }, rng, now: now ?? ctx.now, rig: f.rig && f.rig.forId === m.id ? f.rig : null });
  const o = round.play(botRng, smart);
  if (!o) return null;
  return { itemId: item.id, mult: o.mult, label: o.label, crit: o.crit, stake, snapshot: round.snapshot(), rigUsed: round.rigUsed };
}

register({
  FIGHT_START(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const c = characterOf(state, pid); if (!c || c.dead) refuse('no living character', 'player');
    if (!ctx.isGm && currentPlayerId(state) !== pid) refuse('not your turn', 'turn');
    let monsterId = ctx.payload.monsterId;
    if (ctx.payload.opponent === 'dummy' || monsterId === 'dummy') { const d = state.monsters.dummy && !state.monsters.dummy.dead ? state.monsters.dummy : makeDummy(state, ctx, { items: ctx.payload.items || [] }); monsterId = d.id; }
    if (state.fight && !state.fight.done && state.fight.kind === 'solo') state.fight = null;
    openFight(state, ctx, pid, monsterId);
  },
  MONSTER_ACT(state, ev, ctx) {
    requirePhase(state, 'playing');
    if (!(ctx.isGm || ctx.actor === 'tv')) refuse('the TV or the GM plays the monster', 'forbidden');
    const f = state.fight; if (!f || f.done) refuse('no fight', 'nogame');
    if (f.turn !== 'monster') refuse('not the monster\'s turn', 'turn');
    const m = state.monsters[f.monsterId]; if (!m || m.dead) refuse('the monster is gone', 'target');
    const c = characterOf(state, f.playerId); if (!c || c.dead) { f.done = true; f.result = 'lost'; return; }
    const { itemId, mult, label = '', crit = false, snapshot = null, gmPick = null, rigUsed = false } = ctx.payload;
    const item = (m.items || []).find(it => it.id === itemId) || (m.items || [])[0]; if (!item) refuse('the monster has no items', 'item');
    if (!Number.isFinite(Number(mult)) || Number(mult) < -8 || Number(mult) > 10001) refuse('bad multiplier', 'mult');
    const stake = Math.max(1, Math.min(m.health, Math.round(Number(ctx.payload.stake ?? item.stake * ctx.B('items').monsterStakeFraction))));
    if (rigUsed) f.rig = null;
    const info = resolveHit(state, ctx, { attackerId: m.id, attackerKind: 'monster', targetId: c.id, targetKind: 'character', item, stake, mult: Number(mult), label, crit: !!crit });
    f.log.push({ ts: ctx.now, by: m.id, itemId: item.id, gameId: item.gameId, mult: Number(mult), label, crit: !!crit, damage: info.damage, loss: info.loss, gmPick: m.gmControlled ? gmPick : null });
    f.lastGame = { itemId: item.id, gameId: item.gameId, kind: item.kind, mode: 'health', stake, attackerId: m.id, targetId: c.id, targetKind: 'character', phase: 'done', result: { mult: Number(mult), label, crit: !!crit, damage: info.damage, loss: info.loss }, legacy: snapshot ? stripSecret(snapshot) : null, startedTs: ctx.now };
    if (m.health <= 0 && !m.dead) monsterDied(state, ctx, m, c.id);
    // Back to the player: a new combat turn (one attack + one spell) inside the same table turn.
    if (!f.done) { f.turn = 'player'; f.exchanges = (f.exchanges || 0) + 1; if (c.usedThisTurn) { c.usedThisTurn.attack = 0; c.usedThisTurn.spell = 0; } }
    // A player who ended their turn mid-fight has walked away once the monster's parting blow lands.
    if (!f.done && f.passed && currentPlayerId(state) !== f.playerId) { f.done = true; f.result = 'left'; f.endedAt = ctx.now; note(state, `${c.name} leaves ${m.name} behind`, 'fight', ctx.now); }
  },
  FIGHT_FLEE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const f = state.fight; if (!f || f.done) refuse('no fight', 'nogame');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    if (f.playerId !== pid && !ctx.isGm) refuse('not your fight', 'forbidden');
    if (f.game && !f.game.result) refuse('finish the round first', 'busy');
    if (f.turn !== 'player' && !ctx.isGm) refuse('the monster is acting', 'turn');
    if (f.calledOut) refuse('you were called out', 'calledout');
    f.done = true; f.fled = true; f.result = 'fled'; f.endedAt = ctx.now;
    note(state, `${characterOf(state, pid)?.name || pid} backs away from the fight`, 'fight', ctx.now);
  },
  FIGHT_END(state, ev, ctx) {
    const f = state.fight; if (!f) return;
    if (!f.done && !ctx.isGm) refuse('the fight is not over', 'busy');
    if (!ctx.isGm) { const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid); if (f.playerId !== pid && !(f.playerIds || []).includes(pid)) refuse('not your fight', 'forbidden'); }
    if (!f.done) { f.done = true; f.result = f.result || 'ended'; }
    state.lastFight = { id: f.id, kind: f.kind, monsterId: f.monsterId, result: f.result, endedAt: ctx.now };
    state.fight = null;
  },
  GM_TAKEOVER(state, ev, ctx) {
    requireGm(ctx);
    const m = state.monsters[ctx.payload.monsterId]; if (!m) refuse('no such monster');
    m.gmControlled = ctx.payload.on !== false;
    note(state, `The GM ${m.gmControlled ? 'takes over' : 'releases'} ${m.name}`, 'gm', ctx.now);
  },
});

// A mover landing on a tile (tiles.js may open an encounter there) finds the slot free of a walked-away fight.
moveHooks.afterMove.push((state, ctx) => { settleStaleFight(state, ctx); });

// End of turn: a solo (PvP) fight is spent; a done encounter is cleared; an open encounter hands the monster its move
// (run.js already marks fight.passed) and the fight ends after that blow if its player is no longer up.
runHooks.turnEnd.push((state, ctx, pid) => {
  const f = state.fight; if (!f) return;
  if (f.kind === 'solo' || f.done) { state.lastFight = { id: f.id, kind: f.kind, monsterId: f.monsterId, result: f.result, endedAt: ctx.now }; state.fight = null; return; }
  if (f.playerId === pid && f.turn === 'player') {
    if (f.game && !f.game.result) { f.game.abandoned = true; f.game = null; }
    const m = state.monsters[f.monsterId];
    if (m && !m.dead && alive(characterOf(state, pid))) f.turn = 'monster';
    else { f.done = true; f.result = f.result || 'left'; }
  }
});

// When the mover's fight ends (won, fled, left, lost) while the tile is still resolving, the turn moves on to the
// action phase so the phone shows Shop/Bag/End turn instead of waiting on a finished fight.
onAfter((state) => {
  const f = state.fight; if (!f || !f.done || state.phase !== 'playing') return;
  if (state.turnPhase === 'resolve' && !state.pendingPrompt && (f.playerId === currentPlayerId(state) || f.kind === 'solo')) state.turnPhase = 'action';
});
