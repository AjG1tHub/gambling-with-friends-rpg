// Fixtures for the characters module suites: a room with locked-in characters, a stub map, stub monsters,
// and direct item placement. Importing this file registers the module's handlers on top of the core.
import { room, names4, shared } from './_helpers.mjs';
import '../../packages/shared/handlers/creation.js';
import '../../packages/shared/handlers/inventory.js';
import '../../packages/shared/handlers/roster.js';
import '../../packages/shared/handlers/pets.js';
import '../../packages/shared/handlers/classes.js';
import * as gen from '../../packages/shared/characters/generator.js';
import * as grid from '../../packages/shared/characters/grid.js';
import * as chars from '../../packages/shared/characters/character.js';
import * as sprites from '../../packages/shared/characters/sprites.js';
import { hooks as runHooks } from '../../packages/shared/handlers/run.js';
import * as hooks from '../../packages/shared/hooks.js';

export { room, names4, shared, gen, grid, chars, sprites, runHooks, hooks };
export const CLASS_IDS = chars.CLASS_IDS;
export const charOf = (r, pid) => shared.characterOf(r.state, pid);

// Make a character for every seat: look, class, lock (no gambling unless `gamble` is given per seat).
export function creationRoom({ names = names4, classes = CLASS_IDS, seed = 42, gamble = null, open = true, ...opts } = {}) {
  const r = room({ seed, ...opts }).join(names);
  if (open) r.append('CREATION_OPEN');
  names.forEach((n, i) => {
    const pid = 'p' + i;
    r.append('CHAR_LOOK', { name: `${n}-${i}`, crest: '🂠', look: { body: i % 3, skin: i % 4, face: i % 8, hair: i % 12, coat: '#223344' } }, pid);
    r.append('CHAR_CLASS', { classId: classes[i % classes.length] }, pid);
    if (gamble) for (const g of gamble(pid, i) || []) r.append('CHAR_STAT_GAMBLE', g, pid);
    r.append('CHAR_LOCK', {}, pid);
  });
  return r;
}
export function playingRoom(opts = {}) { const r = creationRoom(opts); r.append('RUN_START'); stubMap(r); return r; }

// A tiny map: a 3-radius hex blob split into two regions, everybody at the start hex.
export function stubMap(r, { radius = 3 } = {}) {
  const hexes = {}; const regions = { strip: { id: 'strip', name: 'Casino Strip', tier: 1, family: 'picks', hexKeys: [] }, docks: { id: 'docks', name: 'The Docks', tier: 2, family: 'dice', hexKeys: [] } };
  for (const h of shared.hex.range({ q: 0, r: 0 }, radius)) { const key = shared.hex.key(h); const regionId = h.q >= 2 ? 'docks' : 'strip'; hexes[key] = { q: h.q, r: h.r, key, regionId, type: 'plain', colour: 'Bone', void: false }; regions[regionId].hexKeys.push(key); }
  r.state.map = { hexes, regions, start: '0,0', throne: '3,0', revealed: { strip: true }, size: r.state.size, seed: r.state.seed };
  for (const c of Object.values(r.state.characters)) { c.pos = '0,0'; c.lastSafePos = '0,0'; c.region = 'strip'; }
  return r.state.map;
}
export function stubMonster(r, { id = 'm1', name = 'Dock Rat', health = 60, pos = '0,0', regionId = 'strip', speciesId = 'dockrat', items = [] } = {}) {
  const m = { id, speciesId, name, regionId, pos, health, maxHealth: health, stats: { luck: 3, nerve: 3, greed: 3, grit: 3 }, items, boss: false, raid: false, final: false, gmControlled: false, dead: false, linkedTo: null, loot: { gold: 0, items: [], egg: false } };
  r.state.monsters[id] = m; return m;
}
export function stubFight(r, pid, monsterId = 'm1') { r.state.fight = { id: `f-${monsterId}-${r.state.turnIdx}`, kind: 'encounter', monsterId, playerIds: [pid], playerId: pid, turn: 'player', game: null, log: [], done: false, result: null, startedAt: r.now() }; return r.state.fight; }

// Put an item straight into a character's grid (or hand it over unplaced).
export function give(r, pid, item, { place = true } = {}) {
  const c = charOf(r, pid); c.items[item.id] = item;
  if (place) { const spot = grid.firstFit(c, item); if (!spot) throw new Error(`no room for ${item.name}`); grid.place(c, item, spot.x, spot.y, spot.rot); }
  return item;
}
export const ctxFor = (r) => ({ now: r.now(), actor: 'system', isGm: true, payload: {}, B: (g) => shared.group(r.state, g) });
export const clone = (v) => JSON.parse(JSON.stringify(v));
