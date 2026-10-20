// The bot. One pure policy used three ways: tools/bots.mjs plays whole runs in-process (balance, stalls, run
// length); the TV runs it for seats on autopilot (GM_AUTOPILOT) and for the table's "system" duties (monster
// turns, deadline events); the Lab uses it for dummy opponents.
//
//   nextAction(state, playerId, rng, now, opts) → { type, payload, actor } | null
//   tableDuties(state, rng, now)                → [{ type, payload, actor }]   what the TV must append (timeouts, monster turns, area/challenge resolution)
//
// Minigame rounds are played here through the items adapter (actor-authoritative, like a real phone): the bot
// emits one ITEM_RESOLVE / CHAR_STAT_GAMBLE / PET_ATTACK carrying the finished round's multiplier.
import { currentPlayerId, characterOf, allied } from './state.js';
import { group } from './balance.js';
import { remainingMs } from './clock.js';
import { startRound } from '../games/adapter.js';
import { legalSteps, cardView } from './handlers/movement.js';
import { pathTo, gateBlocks, hexAt, charactersAt } from './map/query.js';
import { slotsFor } from './handlers/inventory.js';
import { playMonsterTurn } from './handlers/fight.js';
import { challengeView } from './handlers/challenge.js';
import * as hosted from './challenge/hosted.js';
import * as hex from './hex.js';

const CLASSES = ['whale', 'pitboss', 'cutpurse', 'enforcer', 'beastmaster', 'croupier'];
const NAMES = ['Vesper', 'Ox', 'Marrow', 'Hale', 'Sable', 'Quill', 'Brisk', 'Tallow', 'Rook', 'Ember', 'Fennel', 'Grist', 'Lark', 'Moth', 'Nettle', 'Pike'];
const CRESTS = ['🂡', '🂱', '🃁', '🃑', '🎴', '🀄', '🎲', '🃏'];
const act = (type, payload = {}, actor) => ({ type, payload, actor });

export function botName(i, state) {
  const used = new Set([...(state?.wall || []), ...Object.values(state?.characters || {}).map(c => c.name)].map(n => String(n).toLowerCase()));
  for (let k = 0; k < NAMES.length; k++) { const n = NAMES[(i + k) % NAMES.length]; if (!used.has(n.toLowerCase())) return n; }
  return `${NAMES[i % NAMES.length]} ${i}`;
}

// Play a minigame round headlessly through the adapter and return its outcome.
export function playRound(state, { item, gameId, mode = 'health', stake, attacker, target, rng, now, smart = true }) {
  const round = startRound({ state, B: (g) => group(state, g) }, { item, gameId, mode, stake, attacker, target, rng, now });
  if (round.phase !== 'done') round.play(rng, smart);
  const o = round.outcome();
  return { mult: o?.mult ?? 1, label: o?.label || 'push', crit: !!o?.crit, snapshot: round.snapshot() };
}

const usable = (state, c, kinds) => Object.values(c.worn || {}).filter(it => it && it.gameId && kinds.includes(it.kind) && (it.charges ?? 1) > 0 && (it.stake || 0) <= c.health);
const gridItems = (c) => (c.grid?.cells || []).map(cell => c.items?.[cell.itemId]).filter(Boolean);
const hasConsumable = (c, baseId) => gridItems(c).find(it => it.baseId === baseId && (it.qty ?? 1) > 0);
const lowHealth = (c) => c.health / c.maxHealth < 0.4;
// A grid weapon worth equipping when nothing worn can attack (spent charges, a versus-only main hand, nothing at all).
function gridWeapon(state, c) {
  return gridItems(c).filter(it => it.gameId && it.kind === 'attack' && (it.charges ?? 1) > 0 && (it.stake || 0) <= c.health).sort((a, b) => (b.stake || 0) - (a.stake || 0))[0] || null;
}
function reequip(state, c, me) {
  if (c.usedThisTurn.reequipped) return null;
  if (!usable(state, c, ['attack']).length) { const w = gridWeapon(state, c); if (w) { c.usedThisTurn.reequipped = true; return act('GRID_EQUIP', { itemId: w.id, slot: 'mainhand' }, me); } }
  // Dice boots steer; swap out card or wheel boots when a dice pair sits on the grid.
  if (c.worn?.boots && c.worn.boots.bootMode !== 'dice') { const d = gridItems(c).find(it => it && it.slot === 'boots' && it.bootMode === 'dice'); if (d) { c.usedThisTurn.reequipped = true; return act('GRID_EQUIP', { itemId: d.id, slot: 'boots' }, me); } }
  // Fill empty slots from the grid: boots first (movement), then armour, jewelry, a spell.
  for (const it of gridItems(c)) {
    if (!it || it.gameId && it.kind === 'attack') continue;
    let slots = []; try { slots = slotsFor(it); } catch { slots = []; }
    if (it.slot === 'consumable' || it.slot === 'tool' || it.slot === 'egg' || it.slot === 'satchel') continue;
    const free = slots.find(sl => !c.worn[sl]);
    if (free && !(it.kind === 'versus' && free === 'mainhand')) { c.usedThisTurn.reequipped = true; return act('GRID_EQUIP', { itemId: it.id, slot: free }, me); }
  }
  return null;
}

export function nextAction(state, pid, rng, now, opts = {}) {
  const p = state.players[pid]; if (!p || p.kicked) return null;
  const c = characterOf(state, pid);
  const me = pid;
  // ── lobby / creation ──
  if (state.phase === 'lobby' || state.phase === 'creation') {
    if (!p.ready && !c) return act('PLAYER_READY', { playerId: pid, ready: true }, me);
    if (state.phase === 'creation') {
      if (!c) return act('CHAR_LOOK', { name: opts.name || botName(state.seats.indexOf(pid), state), crest: CRESTS[state.seats.indexOf(pid) % CRESTS.length], look: { body: rng.int(0, 2), skin: rng.int(0, 3), face: rng.int(0, 7), hair: rng.int(0, 11), coat: '#5a1218' } }, me);
      if (!c.classId) return act('CHAR_CLASS', { classId: opts.classId || CLASSES[state.seats.indexOf(pid) % CLASSES.length] }, me);
      if (!c.locked) {
        const Cr = group(state, 'creation'), gambles = c.creation?.gambles?.length || 0;
        if (c.chips > 0 && gambles < 3 && rng.chance(0.8)) {
          const stat = ['luck', 'nerve', 'greed', 'grit'][rng.int(0, 3)], chips = Math.min(c.chips, rng.int(Cr.minStake, Cr.maxStake));
          const gameId = (Cr.gambleGames || ['fifty', 'dice', 'hilo']).filter(g => g !== 'buyin')[rng.int(0, 2)] || 'fifty';
          const r = playRound(state, { gameId, mode: 'chips', stake: chips, attacker: c, rng, now });
          return act('CHAR_STAT_GAMBLE', { stat, chips, mult: r.mult, gameId }, me);
        }
        // Safe money: unstaked chips become points, spread over stats still under the creation cap.
        const S = group(state, 'stats'), alloc = {}; let left = c.chips; const stats = ['luck', 'nerve', 'greed', 'grit'];
        for (let guard = 0; left > 0 && guard < 100; guard++) { const open = stats.filter(k => (c.stats[k] || 0) + (alloc[k] || 0) < S.creationCap); if (!open.length) break; const k = open[rng.int(0, open.length - 1)]; alloc[k] = (alloc[k] || 0) + 1; left--; }
        return act('CHAR_LOCK', { alloc }, me);
      }
      if (c.hatching) return act('PET_HATCH_PICK', { index: rng.int(0, 2) }, me);
      if (!p.ready) return act('PLAYER_READY', { playerId: pid, ready: true }, me);
    }
    return null;
  }
  if (state.phase === 'ended') {
    if (c && !c.vaulted) { const G = group(state, 'grid'); const cap = c.dead ? G.vaultDead : G.vaultSurvivor; const ids = [...Object.values(c.worn || {}).filter(Boolean), ...gridItems(c)].filter(it => it.rarity !== 'common').slice(0, cap).map(it => it.id); return act('VAULT_BANK', { playerId: pid, itemIds: ids }, me); }
    return null;
  }
  if (state.phase !== 'playing' || !c || state.gm.paused) return null;
  // ── things that can happen on anyone's turn ──
  if (c.hatching) return act('PET_HATCH_PICK', { index: rng.int(0, 2) }, me);
  const pr = state.pendingPrompt;
  if (pr && pr.playerId === pid) {
    if (pr.kind === 'takeWorn') return act('TILE_TAKE_LOOT', { itemId: pr.options?.[0] || null }, me);
    if (pr.kind === 'portal') {
      // Take the portal only toward the goal's region (or anywhere new when there is no goal); otherwise stay put.
      const goal = chooseGoal(state, c, rng); const goalRegion = goal ? hexAt(state, goal.key)?.regionId : null;
      const options = pr.options || (pr.to ? [pr.to] : []);
      if (goalRegion && options.includes(goalRegion) && goalRegion !== c.region) return act('PORTAL_PICK', { regionId: goalRegion }, me);
      if (!goal && options.length) { const fresh = options.filter(r => !(c.visitedRegions || []).includes(r) && r !== c.region); const to = (fresh.length ? fresh : options)[rng.int(0, (fresh.length ? fresh : options).length - 1)]; if (to !== c.region) return act('PORTAL_PICK', { regionId: to }, me); }
      return act('TILE_LEAVE', {}, me);
    }
    if (pr.kind === 'spin') return act('WHEEL_SPIN', { wheel: pr.wheel, playerId: pid }, me);
    if (pr.kind === 'arena') return act('TILE_LEAVE', {}, me);
    if (pr.kind === 'callout') return null;
  }
  const v = state.votes;
  if (v && !v.closed && v.eligible?.includes(pid) && v.ballots?.[pid] === undefined) { const opts = v.options.filter(o => o !== pid); return act('VOTE_CAST', { choice: opts.length ? opts[rng.int(0, opts.length - 1)] : v.options[0] }, me); }
  const ch = state.challenge;
  if (ch && !ch.done && (ch.attackerId === pid || ch.defenderId === pid)) {
    const v = challengeView(state, pid, now);
    if (v.canAnswer) return act('CHALLENGE_ANSWER', { accept: true }, me);
    if (v.needsWeapon) { const w = usable(state, c, ['attack', 'versus'])[0]; return act('CHALLENGE_ANSWER', { itemId: w?.id || null }, me); }
    if (!ch.spun && pid === ch.attackerId && !(ch.call === 'wager' && !ch.accepted) && (ch.defenderItemId || ch.defenderAnswered || ch.call === 'wager')) return act('CHALLENGE_SPIN', {}, me);
    if (v.phase === 'playing') {
      if (v.hosted && ch.hostedGame && !hosted.done(ch.hostedGame)) { const a = hosted.botAction(ch.hostedGame, pid, now); if (a) return act('CHALLENGE_STEP', { action: a.action, payload: a.payload || {} }, me); }
      else if (!ch.hostedGame && v.reportButtons.length && v.myReport == null) {
        // Versus items and external entries: the bot resolves them with a seeded coin, both phones agreeing.
        const winner = ch.botWinner || (rng.chance(0.5) ? ch.attackerId : ch.defenderId);
        return act('CHALLENGE_REPORT', { winnerId: winner }, me);
      }
    }
    return null;
  }
  if (state.area && !state.area.done && state.area.hexKey === c.pos && !state.area.stakes?.[c.id] && state.area.attackerId !== c.id && c.health > 10) return act('AREA_STAKE', { stake: Math.min(10, c.health - 1) }, me);
  // ── my turn ──
  if (currentPlayerId(state) !== pid) return null;
  if (c.dead) return act('TURN_END', {}, me);
  const f = state.fight;
  // A solo round (a hit on a player, a spell on yourself) waits for its attacker's result.
  if (f && !f.done && f.kind === 'solo' && f.game && !f.game.result && f.game.attackerPlayerId === pid) {
    const item = c.items?.[f.game.itemId] || Object.values(c.worn).find(it => it && it.id === f.game.itemId);
    const target = f.game.targetKind === 'monster' ? state.monsters[f.game.targetId] : state.characters[f.game.targetId];
    const r = playRound(state, { item: item || { gameId: f.game.gameId, stake: f.game.stake, rarity: 'common', kind: 'attack' }, mode: 'health', stake: f.game.stake, attacker: c, target, rng, now });
    return act('ITEM_RESOLVE', { mult: r.mult, label: r.label, crit: r.crit }, me);
  }
  if (f && !f.done && f.kind !== 'solo' && (f.playerId === pid || f.playerIds?.includes(pid))) {
    if (f.turn !== 'player' || f.playerId !== pid) return null;
    if (f.game && !f.game.result && f.game.attackerPlayerId === pid) {
      const item = c.items?.[f.game.itemId] || Object.values(c.worn).find(it => it && it.id === f.game.itemId);
      const target = state.monsters[f.monsterId];
      const r = playRound(state, { item: item || { gameId: f.game.gameId, stake: f.game.stake, rarity: 'common', kind: 'attack' }, mode: 'health', stake: f.game.stake, attacker: c, target, rng, now });
      return act('ITEM_RESOLVE', { mult: r.mult, label: r.label, crit: r.crit }, me);
    }
    if (lowHealth(c) && hasConsumable(c, 'potion') && !c.usedThisTurn.potion) { c.usedThisTurn.potion = true; return act('CONSUMABLE_USE', { itemId: hasConsumable(c, 'potion').id }, me); }
    const re = reequip(state, c, me); if (re) return re;
    if (!c.usedThisTurn.attack) { const w = usable(state, c, ['attack']).sort((a, b) => (b.stake || 0) - (a.stake || 0))[0]; if (w) return act('ITEM_USE', { itemId: w.id, targetId: f.monsterId, targetKind: 'monster' }, me); }
    if (!c.usedThisTurn.spell && lowHealth(c)) { const s = usable(state, c, ['spell'])[0]; if (s) return act('ITEM_USE', { itemId: s.id, targetKind: 'self' }, me); }
    if (c.health <= 12 && hasConsumable(c, 'smokebomb')) return act('CONSUMABLE_USE', { itemId: hasConsumable(c, 'smokebomb').id }, me);
    if (!usable(state, c, ['attack']).length && !f.calledOut && !c.usedThisTurn.fled) { c.usedThisTurn.fled = true; return act('FIGHT_FLEE', {}, me); }
    return act('TURN_END', {}, me);
  }
  if (f && !f.done && f.kind === 'solo' && f.game && !f.game.result && f.game.attackerPlayerId === pid) {
    const item = Object.values(c.worn).find(it => it && it.id === f.game.itemId) || c.items?.[f.game.itemId];
    const r = playRound(state, { item, mode: 'health', stake: f.game.stake, attacker: c, rng, now });
    return act('ITEM_RESOLVE', { mult: r.mult, label: r.label, crit: r.crit }, me);
  }
  if (state.turnPhase === 'move') {
    const s = state.moveSession;
    if (!s || s.done || s.playerId !== pid) { if (c.usedThisTurn?.moved) return act('TURN_END', {}, me); return act('MOVE_ROLL', {}, me); }
    if (s.atomic && s.destinations?.length) return act('MOVE_STEP', { to: pickDestination(state, c, s.destinations, rng) }, me);
    if (s.awaiting) return act('MOVE_STOP', {}, me);
    const steps = legalSteps(state, pid).filter(x => x.legal);
    if (!steps.length || s.movesLeft <= 0) return act('MOVE_STOP', {}, me);
    const here = hexAt(state, c.pos);
    const canStop = (s.canStopAfter != null ? s.stepsTaken >= s.canStopAfter : true) && !s.mustWalk;
    const goal = chooseGoal(state, c, rng);
    if (goal && goal.key === c.pos && canStop && s.stepsTaken > 0) return act('MOVE_STOP', {}, me);
    if (canStop && s.stepsTaken > 0 && here && (here.type === 'chest' || here.type === 'wheel') && !here.lootSeen && !here.spun) return act('MOVE_STOP', {}, me);
    if (goal) {
      const path = pathTo(state, c.pos, goal.key, c.id, 96, true);
      // Steps still owed before you may stop (full-walk dice, the half rule). When the goal is nearer than that,
      // burn steps on neighbours that keep the goal within the moves left, so the walk ends on it.
      const owed = s.mustWalk ? s.movesLeft : Math.max(0, (s.canStopAfter ?? 0) - s.stepsTaken);
      const d = path ? path.length : 99;
      if (path && owed > d) {
        let best = null;
        for (const x of steps) { const q = pathTo(state, x.key, goal.key, c.id, 96, true); const dq = q ? q.length : 99; if (dq > owed - 1) continue; const score = dq + rng.next() * 0.5; if (!best || score > best.score) best = { x, score }; }
        if (best) return act('MOVE_STEP', { dir: best.x.dir }, me);
      }
      const next = path && path[0]; const step = next && steps.find(x => x.key === next);
      if (step) return act('MOVE_STEP', { dir: step.dir }, me);
    }
    const visited = new Set(s.path || []);
    const scored = steps.map(x => ({ x, score: tileWant(state, c, x.type) + rng.next() * 2 - (visited.has(x.key) ? 3 : 0) + (x.bridge ? 1 : 0) })).sort((a, b) => b.score - a.score);
    return act('MOVE_STEP', { dir: scored[0].x.dir }, me);
  }
  // 'resolve' with nothing pending (a fight that just ended, a tile hook that forgot) behaves like 'action'.
  if (state.turnPhase === 'resolve' && !(f && !f.done) && !(pr && pr.playerId === pid)) { /* fall through */ }
  else if (state.turnPhase === 'resolve') return null;
  if (state.turnPhase === 'action' || state.turnPhase === 'resolve') {
    const here = state.map?.hexes[c.pos];
    const re = reequip(state, c, me); if (re) return re;
    if (c.health / c.maxHealth < 0.6 && hasConsumable(c, 'potion') && (c.usedThisTurn.potion || 0) < 4) { c.usedThisTurn.potion = (c.usedThisTurn.potion || 0) + 1; return act('CONSUMABLE_USE', { itemId: hasConsumable(c, 'potion').id }, me); }
    if (here?.type === 'shop') {
      const SH = group(state, 'shop'), shelf = state.shops?.[c.pos]?.stock || [];
      const weaponless = !usable(state, c, ['attack']).length;
      const bestStake = Math.max(0, ...usable(state, c, ['attack']).map(it => it.stake || 0));
      const weakArm = !weaponless && (bestStake < group(state, 'items').stakeCommon || usable(state, c, ['attack']).every(it => (it.charges ?? 99) <= 3));
      if (!c.usedThisTurn.bought && (weaponless || weakArm) && c.gold >= SH.itemCommon && shelf.some(e => e.sku === 'weapon' && e.qty > 0)) { c.usedThisTurn.bought = true; return act('SHOP_BUY', { sku: 'weapon' }, me); }
      if (!c.usedThisTurn.bought && (!c.worn?.boots || c.worn.boots.bootMode !== 'dice') && !gridItems(c).some(it => it && it.slot === 'boots' && it.bootMode === 'dice') && c.gold >= SH.itemCommon && shelf.some(e => e.sku === 'boots' && e.qty > 0)) { c.usedThisTurn.bought = true; return act('SHOP_BUY', { sku: 'boots' }, me); }
      const potions = gridItems(c).filter(it => it.baseId === 'potion').reduce((n, it) => n + (it.qty || 1), 0);
      const wantPotions = c.health / c.maxHealth < 0.6 ? 5 : 3;
      if (c.gold >= SH.potion && shelf.some(e => e.sku === 'potion' && e.qty > 0) && potions < wantPotions && (potions === 0 || c.gold >= SH.potion * 3) && (c.usedThisTurn.potionsBought || 0) < 5) { c.usedThisTurn.potionsBought = (c.usedThisTurn.potionsBought || 0) + 1; return act('SHOP_BUY', { sku: 'potion' }, me); }
    }
    if (here?.type === 'inn' && !c.usedThisTurn.rested) { c.usedThisTurn.rested = true; return act('INN_REST', {}, me); }
    if (here?.type === 'bloodbank' && c.health / c.maxHealth < 0.5 && c.health > 40 && (c.pactIds?.length || 0) < 1 && !c.usedThisTurn.pact) { c.usedThisTurn.pact = true; return act('PACT_TAKE', { amount: 30 }, me); }
    if (state.tileLoot?.[c.pos]?.length && !c.usedThisTurn.looted) { c.usedThisTurn.looted = true; return act('TILE_TAKE_LOOT', { itemId: state.tileLoot[c.pos][0].id }, me); }
    // PvP: hit a non-allied player in reach (one attack a turn), or call a duel, when healthy and the mode allows it.
    if (state.mode !== 'pve' && c.health > 40 && !(f && !f.done)) {
      const foe = Object.values(state.characters).find(o => o.id !== c.id && !o.dead && o.pos && hex.distance(hex.parse(o.pos), hex.parse(c.pos)) <= 1 && state.players[o.playerId] && !state.held[o.playerId] && !allied(state, pid, o.playerId));
      const hot = state.mode === 'pvp' || state.mode === 'royale' ? 0.9 : (opts.aggression ?? 0.5);
      if (foe && !c.usedThisTurn.attack && rng.chance(hot)) { const w = usable(state, c, ['attack']).sort((a, b) => (b.stake || 0) - (a.stake || 0))[0]; if (w) return act('ITEM_USE', { itemId: w.id, targetId: foe.id, targetKind: 'character' }, me); }
      if (foe && !c.usedThisTurn.attack && state.gm.duelsEnabled !== false && !state.challenge && !c.usedThisTurn.duelled && rng.chance(opts.aggression ?? 0.5)) { const w = usable(state, c, ['attack', 'versus'])[0]; if (w) { c.usedThisTurn.duelled = true; return act('CHALLENGE_CALL', { defenderId: foe.playerId, call: 'duel', itemId: w.id }, me); } }
    }
    if (rng.chance(0.08)) { const others = state.seats.filter(id => id !== pid && state.players[id] && !state.players[id].kicked); if (others.length) return act('LETTER_SEND', { toId: others[rng.int(0, others.length - 1)], text: ['Truce?', 'The Caldera is mine.', 'Watch the Whale.', 'Meet at the Inn.'][rng.int(0, 3)] }, me); }
    return act('TURN_END', {}, me);
  }
  return act('TURN_END', {}, me);
}

// ── goals ──
function tileWant(state, c, t) {
  const low = lowHealth(c);
  return { chest: 6, shop: c.gold >= group(state, 'shop').potion ? 5 : 1, inn: low ? 8 : 1, wheel: 4, event: 3, encounter: c.health > 50 ? 5 : 0, bossgate: c.level >= 3 && c.health > 60 ? 6 : 0, chaos: 2, bloodbank: low ? 4 : 1, arena: 2, bounty: 2, portal: 2, graveyard: 1, plain: 1, start: 0, throne: 9, courier: 2 }[t] ?? 1;
}
const hasKey = (c) => Object.values(c.items || {}).some(it => it.baseId === 'citadel_key');
function nearest(state, c, keys) {
  let best = null;
  for (const k of keys) { const p = pathTo(state, c.pos, k, c.id, 96, true); if (p && (!best || p.length < best.dist)) best = { key: k, dist: p.length }; }
  return best;
}
// Where the bot wants to go this turn: heal when low, the throne once the gate will open, else a fair monster,
// a boss when strong, else loot. Cached per turn on the character.
function chooseGoal(state, c, rng) {
  if (c.__goalTurn === state.turnIdx && c.__goal) return c.__goal;
  const M = state.map; if (!M) return null;
  const hexes = Object.values(M.hexes), H = group(state, 'health'), SH = group(state, 'shop');
  const frac = c.health / c.maxHealth;
  const armed = Object.values(c.worn || {}).some(it => it && it.gameId && it.kind === 'attack' && (it.charges ?? 1) > 0) || !!gridWeapon(state, c);
  const canBuyPotion = c.gold >= SH.potion, canBuyWeapon = c.gold >= SH.itemCommon;
  const restedHere = c.innVisit && c.innSafeRound === state.round;
  let goal = null;
  const gateOpen = hasKey(c) || c.level >= group(state, 'map').citadelLevel;
  const dealerUp = Object.values(state.monsters).some(m => m.final && !m.dead && m.pos);
  // 1. hurt: an Inn you have not rested at this round, or a Shop for potions when rich; a potion in hand is drunk by
  //    the action phase. A key holder heals up properly before the throne run.
  if (frac < (gateOpen && dealerUp ? 0.6 : 0.4) && !hasConsumable(c, 'potion')) {
    goal = nearest(state, c, hexes.filter(h => h.type === 'inn' && !(restedHere && c.innVisit.hexKey === h.key)).map(h => h.key));
    if (canBuyPotion) { const shop = nearest(state, c, hexes.filter(h => h.type === 'shop').map(h => h.key)); if (shop && (!goal || shop.dist < goal.dist)) goal = shop; }
  }
  // 2. unarmed: a Shop when you can afford a weapon; otherwise loot
  if (!goal && !armed && canBuyWeapon) goal = nearest(state, c, hexes.filter(h => h.type === 'shop').map(h => h.key));
  // 2b. barefoot with money to spare: the Shop sells Common boots
  if (!goal && !c.worn?.boots && !gridItems(c).some(it => it && it.slot === 'boots') && c.gold >= SH.itemCommon + SH.potion) goal = nearest(state, c, hexes.filter(h => h.type === 'shop').map(h => h.key));
  // 3. armed and not too hurt: fight — regular monsters first, then bosses, then the Dealer
  if (!goal && armed && frac >= 0.35) {
    // A monster hex you already stand on is no goal (the fight opens on arrival, so you must step off and back);
    // a raid boss only once enough other players are already on its tile.
    const need = group(state, 'monsters').raidMinPlayers || 2;
    const alive = Object.values(state.monsters).filter(m => !m.dead && m.pos && m.pos !== c.pos && (!m.raid || charactersAt(state, m.pos, c.id).length >= need - 1));
    const regular = alive.filter(m => !m.boss && !m.raid && !m.final);
    const bosses = alive.filter(m => (m.boss || m.raid) && !m.final);
    const finals = alive.filter(m => m.final);
    // With the gate open and some Health, the throne run comes first; otherwise a region boss (for the key) once
    // levelled a little, else a regular monster you can take.
    if (finals.length && gateOpen && frac >= 0.5) goal = nearest(state, c, finals.map(m => m.pos));
    if (!goal && bosses.length && frac >= 0.5 && (c.level >= 2 || !regular.length)) goal = nearest(state, c, bosses.filter(m => !m.raid).map(m => m.pos)) || nearest(state, c, bosses.map(m => m.pos));
    if (!goal) goal = nearest(state, c, regular.filter(m => m.health <= c.health * 1.6).map(m => m.pos)) || nearest(state, c, regular.map(m => m.pos));
    if (!goal && bosses.length && frac >= 0.5) goal = nearest(state, c, bosses.map(m => m.pos));
    if (!goal && finals.length && (gateOpen || c.region === 'citadel')) goal = nearest(state, c, finals.map(m => m.pos));
  }
  // 3b. players-only modes: hunt the nearest enemy when armed and healthy
  if (!goal && armed && frac >= 0.5 && (state.mode === 'pvp' || state.mode === 'royale')) {
    const foes = Object.values(state.characters).filter(o => o.id !== c.id && !o.dead && !o.eliminated && o.pos && o.pos !== c.pos && state.players[o.playerId] && !state.players[o.playerId].kicked && !allied(state, c.playerId, o.playerId));
    goal = nearest(state, c, foes.map(o => o.pos));
  }
  // 4. the throne once the way is open and the Dealer is gone
  if (!goal && M.throne && !Object.values(state.monsters).some(m => m.final && !m.dead) && (hasKey(c) || c.level >= group(state, 'map').citadelLevel)) goal = nearest(state, c, [M.throne]);
  // 5. loot: unopened chests, wheels and events anywhere but here
  if (!goal) goal = nearest(state, c, hexes.filter(h => ['chest', 'wheel', 'event'].includes(h.type) && h.key !== c.pos && !h.lootSeen).map(h => h.key).slice(0, 40));
  if (!goal) goal = nearest(state, c, hexes.filter(h => ['inn', 'shop', 'arena', 'bounty'].includes(h.type) && h.key !== c.pos).map(h => h.key));
  c.__goalTurn = state.turnIdx; c.__goal = goal;
  return goal;
}
function pickDestination(state, c, dests, rng) {
  const goal = chooseGoal(state, c, rng);
  if (goal) { let best = null; for (const d of dests) { const p = pathTo(state, d, goal.key, c.id, 96, true); const dist = p ? p.length : 99; if (!best || dist < best.dist) best = { d, dist }; } if (best) return best.d; }
  return dests[rng.int(0, dests.length - 1)];
}

// What the table (the TV, or the runner acting as the TV) must do regardless of whose turn it is.
export function tableDuties(state, rng, now) {
  const out = [];
  if (state.phase !== 'playing') return out;
  const f = state.fight;
  if (f && !f.done && f.turn === 'monster' && state.monsters[f.monsterId] && !state.monsters[f.monsterId].dead) {
    const res = playMonsterTurn(state, { now, B: (g) => group(state, g) }, rng, { now });
    if (res) out.push(act('MONSTER_ACT', { itemId: res.itemId, mult: res.mult, label: res.label, crit: !!res.crit, stake: res.stake, snapshot: res.snapshot || null }, 'system'));
    else out.push(act('FIGHT_END', { reason: 'monster has nothing to fight with' }, 'system'));
  }
  if (state.area && !state.area.done && now >= state.area.deadline) {
    const results = {}; for (const [cid, st] of Object.entries(state.area.stakes || {})) { const c = state.characters[cid]; const r = playRound(state, { gameId: state.area.gameId, mode: 'health', stake: st.stake ?? st, attacker: c, rng, now }); results[cid] = { mult: r.mult, label: r.label, crit: r.crit }; }
    out.push(act('AREA_RESOLVE', { results }, 'system'));
  }
  const ch = state.challenge;
  if (ch && !ch.done && ch.spun && ch.deadline && now >= ch.deadline) out.push(act('CHALLENGE_TIMEOUT', {}, 'system'));
  if (ch && !ch.done && ch.gmPending) out.push(act('CHALLENGE_GM_DECIDE', { winnerId: rng.chance(0.5) ? ch.attackerId : ch.defenderId }, 'gm'));
  if (state.votes && !state.votes.closed && state.votes.deadline && now >= state.votes.deadline) out.push(act('VOTE_CLOSE', {}, 'system'));
  const pid = currentPlayerId(state);
  if (pid && !state.gm.paused && state.clocks[pid]?.runningSince != null && remainingMs(state, pid, now) <= 0) out.push(act('TURN_TIMEOUT', {}, 'system'));
  return out;
}
