// Fixtures for the challenge / social / modes suites: a seated table run through the full reducer (RUN_START with
// every module active), then dressed for the suites: the fixture's characters (same ids as the defaults creation
// makes, so nothing is orphaned), hand-built weapons and Gold, and a small hex map with known keys per docs/STATE.md
// in place of the generated one, so the tests can reason about reach, tiles and the Royale circle by hand.
import { room, shared, currentPlayerId, characterOf } from './_helpers.mjs';
import '../../packages/shared/handlers/challenge.js';
import '../../packages/shared/handlers/social.js';
import '../../packages/shared/handlers/modes.js';
import { convertForPvp } from '../../packages/shared/handlers/modes.js';
import * as hex from '../../packages/shared/hex.js';

export { room, shared, currentPlayerId, characterOf, hex };

// The suites count damage in round stakes (a 10-stake hit lands for 10). Grit trims every hit by
// health.gritReducePerPoint per point and the default class (Whale) discounts stakes and adds damage, so those
// three knobs are zeroed per room; a test that wants the real numbers passes `neutral: false`.
export const NEUTRAL_BALANCE = { health: { gritReducePerPoint: 0 }, classes: { whaleStakeDiscount: 0, whaleDamageBonus: 0 } };
const mergeBalance = (a, b) => { const out = structuredClone(a || {}); for (const [g, keys] of Object.entries(b || {})) out[g] = { ...(out[g] || {}), ...keys }; return out; };

let n = 0;
export function makeItem({ id, name = 'Loaded Dice', stake = 10, kind = 'attack', gameId = 'dice', rarity = 'common', slot = 'weapon', reach = null, baseId = 'loadeddice', legendaryId = null, extra = {} } = {}) {
  id ||= `it${++n}`;
  return { id, baseId, name, slot, gameId, kind, family: 'dice', stat: 'grit', rarity, stake, charges: 5, twoHand: false, bootMode: null, die: null, footprint: { w: 1, h: 2 }, stackable: false, qty: 1, affixes: [], legendaryId, setId: null, unique: false, seed: 1, region: 'strip', tier: 1, sprite: 'items/loadeddice', ...(reach != null ? { reach } : {}), ...extra };
}
export function makeCharacter(pid, { name = pid, classId = 'whale', pos = '0,0', gold = 100, health = 100, maxHealth = 100, level = 1, stake = 10, upgrades = [], items = [], helmet = null } = {}) {
  const weapon = makeItem({ id: `${pid}-weapon`, stake });
  const all = { [weapon.id]: weapon }; for (const it of items) all[it.id] = it; if (helmet) all[helmet.id] = helmet;
  return shared.ensureCharacterShape({
    id: `c-${pid}`, playerId: pid, rosterId: `r-${pid}`, name, crest: '🂠', look: { body: 0, skin: 0, face: 0, hair: 0, coat: '#000' }, classId, level, xp: 0, statPoints: 0, stats: { luck: 3, nerve: 3, greed: 3, grit: 3 },
    health, maxHealth, shield: 0, gold, bank: 0, chips: 0, pos, lastSafePos: pos, region: 'strip',
    worn: { mainhand: weapon, offhand: null, spell1: null, spell2: null, helmet, torso: null, pants: null, gloves: null, boots: null, ring1: null, ring2: null, ring3: null, ring4: null, necklace: null, cape: null },
    grid: { cols: 8, rows: 6, cells: [] }, items: all, pets: [], activePetId: null,
    dead: false, missTurns: 0, deaths: 0, graveyardPos: null, diedTo: null, cooldowns: { active: 0 }, activeUses: {}, effects: [], pactIds: [], wanted: 0, kills: 0, titles: [], quests: [], upgrades,
    usedThisTurn: { attack: 0, spell: 0, moved: false }, turnsTaken: 0, streak: 0, freeRestakeUsed: false, freeSmokeBombs: 0, buyinSpun: true, locked: true, creation: null,
  });
}
// A filled hexagon of radius `radius` around 0,0: plain hexes, a few encounters, the courier post, start and throne.
export function makeMap({ radius = 3, courier = '2,0', start = '0,0', throne = '-3,0', encounters = ['1,1', '-1,-1', '2,-2'] } = {}) {
  const hexes = {};
  for (const h of hex.range({ q: 0, r: 0 }, radius)) {
    const k = hex.key(h);
    hexes[k] = { q: h.q, r: h.r, key: k, regionId: 'strip', type: k === courier ? 'courier' : k === start ? 'start' : k === throne ? 'throne' : encounters.includes(k) ? 'encounter' : 'plain', colour: 'Bone', void: false, bridge: false, gate: null, monsterId: encounters.includes(k) ? `m-${k}` : undefined, lootSeen: false, portalTo: null };
  }
  return { hexes, regions: { strip: { id: 'strip', name: 'Casino Strip', tier: 1, family: 'picks', accent: '#f0f', modifier: 'start', hexKeys: Object.keys(hexes), monsterTable: [], bossId: 'boss_strip', revealed: true } }, start, throne, courier, revealed: { strip: true }, size: 'short', seed: 1 };
}
// Four seats, characters placed by seat order after RUN_START so seat 0 and seat 1 are adjacent:
// positions default to 0,0 / 1,0 / 0,1 / 1,-1 (every pair within 2, the first two adjacent).
// `map`: options for makeMap, or 'generated' to keep the map RUN_START built. `neutral: false` keeps Grit and the
// Whale's stake/damage passives live (see NEUTRAL_BALANCE).
export function table({ names = ['Aj', 'Nick', 'Sam', 'Vin'], mode = 'ffa', seed = 42, tier = 1, size = 'regular', gold = 100, start = true, positions = ['0,0', '1,0', '0,1', '1,-1', '-1,1', '2,-1', '-1,0', '0,-1'], char = {}, balance = null, map = {}, neutral = true } = {}) {
  const r = room({ seed, mode, tier, size, balance: neutral ? mergeBalance(NEUTRAL_BALANCE, balance) : balance }).join(names);
  const ids = names.map((_, i) => 'p' + i);
  if (start) r.append('RUN_START');   // the whole game starts: seats, default characters, the generated map, monsters, quests
  const order = start ? r.state.seats.slice() : ids.slice();
  // The hand-built map replaces the generated one (and in PvP is converted the way the game converts a late map).
  if (map !== 'generated') {
    r.state.map = makeMap(map); r.state.monsters = {};
    for (const h of Object.values(r.state.map.hexes)) if (h.monsterId) r.state.monsters[h.monsterId] = { id: h.monsterId, speciesId: 'card_shark', name: 'Card Shark', regionId: 'strip', pos: h.key, health: 60, maxHealth: 60, stats: {}, items: [], boss: false, raid: false, final: false, gmControlled: false, dead: false, linkedTo: null, loot: {} };
    if (start && mode === 'pvp') convertForPvp(r.state, { now: r.now(), B: (g) => shared.group(r.state, g) });
  }
  for (const pid of ids) {
    const c = makeCharacter(pid, { name: r.state.players[pid].name, gold, pos: positions[order.indexOf(pid)] || '0,0', ...(typeof char === 'function' ? char(pid) : char) });
    r.state.characters[c.id] = c; r.state.players[pid].characterId = c.id;
  }
  const api = {
    r, ids, order, get state() { return r.state; },
    char: (pid) => characterOf(r.state, pid),
    cur: () => currentPlayerId(r.state),
    endTurn: () => r.append('TURN_END', {}, currentPlayerId(r.state)),
    // Play plain turns until `pid` is the current player (bounded).
    until: (pid) => { for (let i = 0; i < 32 && currentPlayerId(r.state) !== pid; i++) api.endTurn(); if (currentPlayerId(r.state) !== pid) throw new Error(`never reached ${pid}'s turn`); return api; },
    place: (pid, pos) => { api.char(pid).pos = pos; return api; },
    rigEntry: (entryId) => r.append('GM_RIG', { stream: 'challenge', value: entryId }),
  };
  return api;
}
// Drive a purpose-built hosted duel with the two bots until it settles. Returns the number of steps taken.
export function playHosted(t, hostedMod, { smartA = true, smartB = true, maxSteps = 200, oneRound = false } = {}) {
  let steps = 0; const startRound = t.state.challenge?.series?.round;
  while (t.state.challenge && !t.state.challenge.done && steps < maxSteps && !(oneRound && t.state.challenge.series?.round !== startRound)) {
    const ch = t.state.challenge, g = ch.hostedGame; if (!g) break;
    if (g.game === 'quickdraw' && t.r.now() < g.flashAt) t.r.tick(g.flashAt - t.r.now() + 100);
    let moved = false;
    for (const [pid, smart] of [[ch.attackerId, smartA], [ch.defenderId, smartB]]) {
      if (!t.state.challenge || t.state.challenge.done) break;
      const a = hostedMod.botAction(t.state.challenge.hostedGame, pid, t.r.now(), { smart });
      if (!a) continue;
      t.r.append('CHALLENGE_STEP', { action: a.action, payload: a.payload }, pid); moved = true; steps += 1; t.r.tick(700);
    }
    if (!moved) break;
  }
  return steps;
}
