// Fixtures for the encounters / economy / wheels / death / quests suites. Builds characters, a small five-region
// map and fake fights directly in the STATE.md shapes, so these suites aim at fixed hexes while the whole game
// (every handler module, via _helpers → packages/shared/index.js) is registered. `startRun` is RUN_START plus
// putting the fixture map back under everyone (see there).
import { shared, applyEvent } from './_helpers.mjs';
import { generateMonsters } from '../../packages/shared/encounters/monsters.js';
import '../../packages/shared/handlers/wheels.js';
import '../../packages/shared/handlers/tiles.js';
import '../../packages/shared/handlers/death.js';
import '../../packages/shared/handlers/economy.js';
import '../../packages/shared/handlers/quests.js';
import '../../packages/shared/handlers/ledger.js';
import regionsData from '../../data/regions.json' with { type: 'json' };
import { tileHooks, deathHooks, lootHooks, damageHooks, runMods } from '../../packages/shared/hooks.js';
import { group } from '../../packages/shared/balance.js';

export { tileHooks, deathHooks, lootHooks, damageHooks, runMods };
export const { characterOf, currentPlayerId } = shared;

let itemSeq = 0;
export function makeItem({ id = null, baseId = 'coinblade', name = 'Coin Blade', slot = 'weapon', rarity = 'common', legendaryId = null, qty = 1, footprint = { w: 1, h: 3 } } = {}) {
  return { id: id || `it${++itemSeq}`, baseId, name, slot, gameId: null, kind: slot === 'spell' ? 'spell' : 'attack', family: 'wheels', stat: 'luck', rarity, stake: 10, charges: 5, twoHand: false, bootMode: null, die: null, footprint, stackable: slot === 'consumable', qty, affixes: [], legendaryId, setId: null, unique: !!legendaryId, seed: itemSeq, region: null, tier: 1, sprite: `items/${baseId}` };
}
export const EMPTY_WORN = () => ({ mainhand: null, offhand: null, spell1: null, spell2: null, helmet: null, torso: null, pants: null, gloves: null, boots: null, ring1: null, ring2: null, ring3: null, ring4: null, necklace: null, cape: null });

// A character in a seat. `grid` items go in c.items + a grid cell; `worn` is { slot: Item }.
export function makeCharacter(state, pid, { name = null, classId = 'whale', level = 1, pos = '0,0', health = 100, maxHealth = 100, gold = 0, stats = null, grid = [], worn = {}, pets = [] } = {}) {
  const p = state.players[pid]; if (!p) throw new Error(`no player ${pid}`);
  const id = `c_${pid}`;
  const c = {
    id, playerId: pid, rosterId: null, name: name || p.name, crest: '🂠', look: { body: 0, skin: 0, face: 0, hair: 0, coat: '#333' }, classId,
    level, xp: 0, statPoints: 0, stats: stats || { luck: 3, nerve: 3, greed: 3, grit: 3 },
    health, maxHealth, shield: 0, gold, bank: 0, chips: 0,
    pos, lastSafePos: pos, region: state.map?.hexes?.[pos]?.regionId ?? null,
    worn: { ...EMPTY_WORN(), ...worn }, grid: { cols: 8, rows: 6, cells: [] }, items: {}, pets, activePetId: pets[0]?.id ?? null,
    dead: false, missTurns: 0, deaths: 0, graveyardPos: null, diedTo: null,
    cooldowns: { active: 0 }, activeUses: 0, effects: [], pactIds: [], wanted: 0, kills: 0, titles: [], quests: [],
    usedThisTurn: { attack: 0, spell: 0, moved: false }, turnsTaken: 0, streak: 0, freeRestakeUsed: false, freeSmokeBombs: 0, buyinSpun: true, locked: true, creation: null,
  };
  let y = 0;
  for (const it of grid) { c.items[it.id] = it; c.grid.cells.push({ itemId: it.id, x: 0, y: y++, rot: 0, qty: it.qty || 1 }); }
  for (const it of Object.values(c.worn)) if (it) c.items[it.id] = it;
  state.characters[id] = c; p.characterId = id;
  return c;
}

// Five regions, one row of hexes each (rows are hex-adjacent), every tile type in a fixed column so tests can
// aim: COL.shop etc. Region tiers / tables come from data/regions.json.
export const COL = { start: 0, enc1: 1, enc2: 2, enc3: 3, wheel: 4, shop: 5, inn: 6, bloodbank: 7, graveyard: 8, chaos: 9, chest: 10, event: 11, bossgate: 12, portal: 13, arena: 14, bounty: 15, plain: 16, courier: 17, wall: 18, blocker: 19, throne: 20, chest2: 21, gate2: 22, enc4: 23 };
const typeOfCol = (k) => k === 'gate2' ? 'bossgate' : k.startsWith('enc') ? 'encounter' : k.replace(/\d$/, '');
const TYPE_AT = Object.fromEntries(Object.entries(COL).map(([k, v]) => [v, typeOfCol(k)]));
export const REGION_ROW = { strip: 0, docks: 1, blackwood: 2, caldera: 3, citadel: 4 };
export const at = (regionId, col) => `${col},${REGION_ROW[regionId]}`;

export function makeMap(state, { regions = ['strip', 'docks', 'blackwood', 'caldera', 'citadel'], scale = null } = {}) {
  const hexes = {}, regs = {};
  for (const rid of regions) {
    const def = regionsData.regions.find(r => r.id === rid); const r = REGION_ROW[rid];
    regs[rid] = { id: rid, name: def.name, tier: def.tier, family: def.family, accent: def.accent, modifier: def.modifier, hexKeys: [], monsterTable: def.monsterTable, bossId: def.bossId, raidBossId: def.raidBossId, finalBossId: def.finalBossId || null, revealed: rid === 'strip' };
    for (let q = 0; q <= Math.max(...Object.values(COL)); q++) {
      let type = TYPE_AT[q] || 'plain';
      if (type === 'start' && rid !== 'strip') type = 'plain';
      if (type === 'throne' && rid !== 'citadel') type = 'plain';
      if (type === 'bossgate' && q === COL.gate2 && rid !== 'blackwood' && rid !== 'citadel') type = 'plain';
      const key = `${q},${r}`;
      const h = { q, r, key, regionId: rid, type, colour: 'Bone', void: type === 'wall', bridge: false, gate: null, monsterId: null, lootSeen: false, portalTo: null };
      if (type === 'bossgate' && q === COL.bossgate && rid === 'caldera') h.gate = { level: 5, keyItem: null };
      if (type === 'bossgate' && q === COL.bossgate && rid === 'citadel') h.gate = { level: 10, keyItem: 'citadel_key' };
      if (type === 'portal') h.portalTo = rid === 'strip' ? 'citadel' : 'strip';
      hexes[key] = h; regs[rid].hexKeys.push(key);
    }
  }
  state.map = { hexes, regions: regs, start: at('strip', COL.start), throne: regions.includes('citadel') ? at('citadel', COL.throne) : null, courier: at('strip', COL.courier), revealed: { strip: true }, size: state.size, seed: state.seed, fixture: true };
  if (scale) state.map.scale = scale;
  return state.map;
}

// RUN_START with the full reducer, then the fixture map back in place. The movement module's runStart hook rolls
// a real map over whatever `state.map` held (movement.js › runHooks.runStart) and seats everyone on its start
// hex, and the encounters hook then populates that map. These suites aim at fixed columns, so when the fixture
// map was replaced we put it back, re-seat every character on its start and roll the monsters on it again from
// the stream positions the real roll started at (so a seed places the same monsters it always did).
export function startRun(r, mapOpts = {}) {
  const before = { ...r.state.rng }, scale = r.state.map?.scale || null;
  r.append('RUN_START');
  const state = r.state;
  if (state.map?.fixture) return state;
  for (const s of ['map', 'colours', 'monsters']) if (before[s] != null) state.rng[s] = before[s];
  makeMap(state, { scale, ...mapOpts });
  const start = state.map.start, region = state.map.hexes[start].regionId;
  for (const c of Object.values(state.characters)) { c.pos = start; c.lastSafePos = start; c.region = region; c.prevPos = null; }
  state.monsters = {}; state.monsterSeq = 0; state.shops = {}; state.tileLoot = {};
  for (const h of Object.values(state.map.hexes)) h.monsterId = null;
  generateMonsters(state, ctxFor(r, 'system'));
  return state;
}

// A reducer-shaped ctx for calling hooks directly from a test.
export const ctxFor = (r, actor = 'gm') => ({ now: r.now(), actor, isGm: actor === 'gm' || actor === 'system', payload: {}, B: (g) => group(r.state, g), event: { id: `t${r.now()}` } });

// Put a character on a hex and resolve it the way the movement module does.
export function land(r, pid, hexKey, actor = 'gm') {
  const c = characterOf(r.state, pid); const hex = r.state.map.hexes[hexKey]; if (!hex) throw new Error(`no hex ${hexKey}`);
  c.prevPos = c.pos; c.pos = hexKey; r.state.turnPhase = 'resolve';
  // Like movement's finishMove: a type with no hook (void kinds, plain ground) just moves on to the action phase.
  const fn = tileHooks[hex.type]; if (fn) fn(r.state, ctxFor(r, actor), pid, hex);
  if (r.state.turnPhase === 'resolve' && !(r.state.fight && !r.state.fight.done) && !r.state.pendingPrompt) r.state.turnPhase = 'action';
  return r.state;
}

// The fight module's side of a kill: the monster at 0, then lootHooks.onDrop.
export function slayMonster(r, monsterId, byPid) {
  const m = r.state.monsters[monsterId]; m.health = 0;
  const ctx = ctxFor(r);
  for (const h of lootHooks.onDrop) h(r.state, ctx, { monsterId, byId: byPid });
  if (r.state.fight && r.state.fight.monsterId === monsterId) { r.state.fight.done = true; r.state.fight = null; r.state.turnPhase = 'action'; }
  return m;
}
// The fight module's side of a character death: health to 0, onZero, then onDeath unless prevented.
export function slayCharacter(r, charId, { killerId = null, killerKind = 'monster' } = {}) {
  const c = r.state.characters[charId]; const ctx = ctxFor(r);
  shared.money.health(r.state, c, -c.health - c.shield, 'test kill', ctx, { ignoreShield: false });
  const info = { charId, killerId, killerKind, prevented: false };
  for (const h of deathHooks.onZero) h(r.state, ctx, info);
  if (!info.prevented) for (const h of deathHooks.onDeath) h(r.state, ctx, info);
  return info;
}
// A hit landing, as the fight module reports it.
// A hit landing, with the items module's info shape (mult = the game's multiplier, damageMult = the damage scale).
export function landHit(r, attackerId, targetId, targetKind = 'monster', { kind = 'attack' } = {}) {
  const attackerKind = r.state.monsters[attackerId] ? 'monster' : 'character';
  const info = { attackerId, attackerKind, targetId, targetKind, kind, stake: 10, mult: 2, flat: 0, damageMult: 1, lossMult: 1, notes: [] };
  if (attackerKind === 'character') runMods(damageHooks.outgoing, r.state, ctxFor(r), info);
  if (kind !== 'spell' && targetKind !== 'self') runMods(damageHooks.incoming, r.state, ctxFor(r), info);
  runMods(damageHooks.afterHit, r.state, ctxFor(r), info);
  return info;
}
// Apply an event type that is not (yet) in EVENTS (QUEST_TAKE) straight through the reducer.
export function rawEvent(r, type, payload = {}, actor = 'gm') {
  const ev = { id: `raw${r.now()}`, seq: null, type, roomId: 'r1', actor, ts: r.now(), payload };
  return applyEvent(r.state, ev, { clone: false, strict: true });
}
// Take a whole lap of TURN_ENDs.
export function endTurnsUntil(r, pred, max = 64) { let n = 0; while (!pred(r.state) && n++ < max && r.state.phase === 'playing') r.append('TURN_END', {}, currentPlayerId(r.state)); return n; }
