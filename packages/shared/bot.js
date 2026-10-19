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
    if (pr.kind === 'portal') { const to = pr.options?.[rng.int(0, Math.max(0, (pr.options?.length || 1) - 1))] || pr.to; return to ? act('PORTAL_PICK', { regionId: to }, me) : act('TILE_LEAVE', {}, me); }
    if (pr.kind === 'spin') return act('WHEEL_SPIN', { wheel: pr.wheel, playerId: pid }, me);
    if (pr.kind === 'arena') return act('TILE_LEAVE', {}, me);
    if (pr.kind === 'callout') return null;
  }
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
  if (f && !f.done && f.kind !== 'solo' && (f.playerId === pid || f.playerIds?.includes(pid))) {
    if (f.turn !== 'player' || f.playerId !== pid) return null;
    if (f.game && !f.game.result && f.game.attackerPlayerId === pid) {
      const item = c.items?.[f.game.itemId] || Object.values(c.worn).find(it => it && it.id === f.game.itemId);
      const target = state.monsters[f.monsterId];
      const r = playRound(state, { item: item || { gameId: f.game.gameId, stake: f.game.stake, rarity: 'common', kind: 'attack' }, mode: 'health', stake: f.game.stake, attacker: c, target, rng, now });
      return act('ITEM_RESOLVE', { mult: r.mult, label: r.label, crit: r.crit }, me);
    }
    if (lowHealth(c) && hasConsumable(c, 'potion') && !c.usedThisTurn.potion) { c.usedThisTurn.potion = true; return act('CONSUMABLE_USE', { itemId: hasConsumable(c, 'potion').id }, me); }
    if (!c.usedThisTurn.attack) { const w = usable(state, c, ['attack']).sort((a, b) => (b.stake || 0) - (a.stake || 0))[0]; if (w) return act('ITEM_USE', { itemId: w.id, targetId: f.monsterId, targetKind: 'monster' }, me); }
    if (!c.usedThisTurn.spell && lowHealth(c)) { const s = usable(state, c, ['spell'])[0]; if (s) return act('ITEM_USE', { itemId: s.id, targetKind: 'self' }, me); }
    if (c.health <= 12 && hasConsumable(c, 'smokebomb')) return act('CONSUMABLE_USE', { itemId: hasConsumable(c, 'smokebomb').id }, me);
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
    if (s.atomic && s.destinations?.length) return act('MOVE_STEP', { to: s.destinations[rng.int(0, s.destinations.length - 1)] }, me);
    if (s.awaiting) return act('MOVE_STOP', {}, me);
    const steps = legalSteps(state, pid).filter(x => x.legal);
    if (!steps.length || s.movesLeft <= 0) return act('MOVE_STOP', {}, me);
    const here = state.map.hexes[c.pos];
    const want = (t) => ({ chest: 6, shop: c.gold >= 60 ? 5 : 1, inn: lowHealth(c) ? 7 : 1, wheel: 4, event: 3, encounter: c.health > 50 ? 5 : 0, bossgate: c.level >= 8 ? 6 : 0, chaos: 2, bloodbank: lowHealth(c) ? 4 : 1, arena: 2, bounty: 2, portal: 2, graveyard: 1, plain: 1, start: 0, throne: 9, courier: 2 }[t] ?? 1);
    const canStop = s.canStopAfter != null ? s.stepsTaken >= s.canStopAfter : true;
    if (canStop && here && want(here.type) >= 5 && s.stepsTaken > 0 && !s.mustWalk) return act('MOVE_STOP', {}, me);
    const visited = new Set(s.path || []);
    const scored = steps.map(x => ({ x, score: want(x.type) + rng.next() * 2 - (visited.has(x.key) ? 3 : 0) + (x.bridge ? 1 : 0) })).sort((a, b) => b.score - a.score);
    return act('MOVE_STEP', { dir: scored[0].x.dir }, me);
  }
  // 'resolve' with nothing pending (a fight that just ended, a tile hook that forgot) behaves like 'action'.
  if (state.turnPhase === 'resolve' && !(f && !f.done) && !(pr && pr.playerId === pid)) { /* fall through */ }
  else if (state.turnPhase === 'resolve') return null;
  if (state.turnPhase === 'action' || state.turnPhase === 'resolve') {
    const here = state.map?.hexes[c.pos];
    if (lowHealth(c) && hasConsumable(c, 'potion') && !c.usedThisTurn.potion) { c.usedThisTurn.potion = true; return act('CONSUMABLE_USE', { itemId: hasConsumable(c, 'potion').id }, me); }
    if (here?.type === 'shop' && c.gold >= group(state, 'shop').potion && !c.usedThisTurn.bought) { c.usedThisTurn.bought = true; return act('SHOP_BUY', { sku: 'potion' }, me); }
    if (here?.type === 'inn' && !c.usedThisTurn.rested) { c.usedThisTurn.rested = true; return act('INN_REST', {}, me); }
    if (here?.type === 'bloodbank' && lowHealth(c) && (c.pactIds?.length || 0) < 1 && !c.usedThisTurn.pact) { c.usedThisTurn.pact = true; return act('PACT_TAKE', { amount: 30 }, me); }
    if (state.tileLoot?.[c.pos]?.length && !c.usedThisTurn.looted) { c.usedThisTurn.looted = true; return act('TILE_TAKE_LOOT', { itemId: state.tileLoot[c.pos][0].id }, me); }
    // PvP: pick a fight with a non-allied player in reach when healthy and the mode allows it.
    if (state.mode !== 'pve' && !c.usedThisTurn.attack && c.health > 40 && state.gm.duelsEnabled !== false && !state.challenge && rng.chance(opts.aggression ?? 0.5)) {
      const w = usable(state, c, ['attack', 'versus'])[0];
      const foe = Object.values(state.characters).find(o => o.id !== c.id && !o.dead && o.pos && hex.distance(hex.parse(o.pos), hex.parse(c.pos)) <= 1 && state.players[o.playerId] && !state.held[o.playerId] && !allied(state, pid, o.playerId));
      if (w && foe) return act('CHALLENGE_CALL', { defenderId: foe.playerId, call: 'duel', itemId: w.id }, me);
    }
    if (rng.chance(0.08)) { const others = state.seats.filter(id => id !== pid && state.players[id] && !state.players[id].kicked); if (others.length) return act('LETTER_SEND', { toId: others[rng.int(0, others.length - 1)], text: ['Truce?', 'The Caldera is mine.', 'Watch the Whale.', 'Meet at the Inn.'][rng.int(0, 3)] }, me); }
    return act('TURN_END', {}, me);
  }
  return act('TURN_END', {}, me);
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
