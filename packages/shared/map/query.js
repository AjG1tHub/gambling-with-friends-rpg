// Read-only helpers over `state.map` (SPEC.md › Map, Boots and movement modes). Nothing here mutates state
// except `reveal`, which movement.js and the GM console call from inside handlers. Rules encoded here:
//   - void hexes (water / chasm / wall) and blockers are impassable;
//   - a hex holding a living monster can be entered but ends the move there (`stopsHere`);
//   - a gated hex (Citadel bridge, Boss Gate, the throne) needs the level, the key item or the toll (`gateBlocks`);
//   - the throne also needs the final boss dead.
// Distances are walking distances over passable hexes, so a chasm between you and a hex counts.
import tilesRaw from '../../../data/tiles.json' with { type: 'json' };
import * as H from '../hex.js';

export const TILES = tilesRaw.tiles;
export const SAFE_TILES = tilesRaw.safeTiles;

export const hexAt = (state, key) => state.map?.hexes?.[key] || null;
export const regionOf = (state, key) => { const h = hexAt(state, key); return h ? state.map.regions[h.regionId] || null : null; };
export const tileLabel = (type) => TILES[type]?.name || type;
export const tileGlyph = (type) => TILES[type]?.glyph || '?';
export const isSafeTile = (type) => SAFE_TILES.includes(type);

export function livingMonsterAt(state, key) {
  for (const m of Object.values(state.monsters || {})) if (m.pos === key && !m.dead) return m;
  return null;
}
// A hex you may enter but not pass through.
export const stopsHere = (state, key) => !!livingMonsterAt(state, key);

export function charactersAt(state, key, exceptId = null) {
  return Object.values(state.characters || {}).filter(c => c.pos === key && !c.dead && c.id !== exceptId && Object.values(state.players).some(p => p.characterId === c.id && !p.kicked));
}

function holdsItem(c, itemId) {
  if (!itemId || !c) return false;
  return Object.values(c.items || {}).some(it => it.id === itemId || it.baseId === itemId || it.legendaryId === itemId || it.unique === itemId);
}

// Why a character may not enter a gated hex, or null when the gate opens. `c` may be null (a pure map query).
export function gateBlocks(state, c, hex) {
  if (!hex) return 'no such hex';
  if (hex.type === 'throne') {
    // The Dealer sits on the throne: walking onto it while he lives is the fight (a monster hex ends the move
    // there); the throne only counts as reached once he is dead. Nothing blocks the step itself.
  }
  const g = hex.gate; if (!g) return null;
  if (!c) return 'gated';
  if (g.keyItem && holdsItem(c, g.keyItem)) return null;
  if (g.level != null && (c.level || 0) >= g.level) return null;
  if (g.toll != null && (c.gold || 0) >= g.toll) return null;
  const needs = [];
  if (g.level != null) needs.push(`level ${g.level}`);
  if (g.keyItem) needs.push(`the ${g.keyItem.replace(/_/g, ' ')}`);
  if (g.toll != null) needs.push(`${g.toll} Gold toll`);
  return `the gate needs ${needs.join(' or ')}`;
}
// Whether the gate will take a toll from this character on entry (level or key open it for free).
export function tollDue(c, hex) {
  const g = hex?.gate; if (!g || g.toll == null) return 0;
  if (g.keyItem && holdsItem(c, g.keyItem)) return 0;
  if (g.level != null && (c.level || 0) >= g.level) return 0;
  return g.toll;
}

// May this character step onto the hex at all? (Monster hexes count as passable; they just end the move.)
// Without a charId it is a terrain question: void and blockers are impassable, gates are ignored.
export function passable(state, key, charId = null) {
  const h = hexAt(state, key); if (!h || h.void || h.type === 'blocker') return false;
  if (!charId) return true;
  const c = state.characters[charId]; if (!c) return true;
  if (h.gate || h.type === 'throne') { if (gateBlocks(state, c, h)) return false; }
  return true;
}
// Why a step onto `key` is refused, or null. Used by the phone to grey out directions with a reason.
export function blockReason(state, key, charId = null) {
  const h = hexAt(state, key); if (!h) return 'off the map';
  if (h.void) return tileLabel(h.type);
  if (h.type === 'blocker') return 'blocked';
  const c = charId ? state.characters[charId] : null;
  return gateBlocks(state, c, h);
}

// BFS over passable hexes where a monster hex is terminal. Returns Map(key → {dist, prev}) excluding the start.
function walk(state, fromKey, maxSteps, charId, through = false) {
  const out = new Map([[fromKey, { dist: 0, prev: null }]]);
  const queue = [fromKey];
  while (queue.length) {
    const k = queue.shift(), d = out.get(k).dist;
    if (d >= maxSteps) continue;
    if (!through && k !== fromKey && stopsHere(state, k)) continue;
    for (const n of H.neighbors(H.parse(k))) {
      const nk = H.key(n); if (out.has(nk) || !passable(state, nk, charId)) continue;
      out.set(nk, { dist: d + 1, prev: k }); queue.push(nk);
    }
  }
  out.delete(fromKey);
  return out;
}
// Hexes reachable within `steps`: [{ key, dist, stops }] sorted by distance then key.
export function reachableFrom(state, key, steps, charId = null) {
  return [...walk(state, key, steps, charId)].map(([k, v]) => ({ key: k, dist: v.dist, stops: stopsHere(state, k) })).sort((a, b) => a.dist - b.dist || (a.key < b.key ? -1 : 1));
}
// Shortest walking path from → to as keys (excluding from), or null. Monster hexes may only be the last step,
// unless `through` is set (route planning: the monsters on the way are fights, not walls).
export function pathTo(state, from, to, charId = null, maxSteps = 64, through = false) {
  if (from === to) return [];
  const w = walk(state, from, maxSteps, charId, through); if (!w.has(to)) return null;
  const out = []; let cur = to; while (cur && cur !== from) { out.unshift(cur); cur = w.get(cur)?.prev; }
  return out;
}
// Hexes of a colour within walking range, grouped by distance: [{ dist, keys: [] }, …] nearest first.
export function colourRanks(state, from, colour, range, charId = null) {
  const byDist = new Map();
  for (const [k, v] of walk(state, from, range, charId)) {
    const h = hexAt(state, k); if (!h || h.colour !== colour) continue;
    if (!byDist.has(v.dist)) byDist.set(v.dist, []); byDist.get(v.dist).push(k);
  }
  return [...byDist].sort((a, b) => a[0] - b[0]).map(([dist, keys]) => ({ dist, keys: keys.sort() }));
}
// The nearest hexes of a colour (a list: ties are the player's choice). `rank` 1 = second-nearest (a double card).
export function nearestOfColour(state, from, colour, range, charId = null, rank = 0) {
  const ranks = colourRanks(state, from, colour, range, charId);
  return ranks[rank]?.keys || [];
}
// Hex distance ignoring terrain (for reach checks and the TV).
export const hexDistance = (a, b) => H.distance(H.parse(a), H.parse(b));

export function reveal(state, regionId) {
  const r = state.map?.regions?.[regionId]; if (!r) return false;
  const was = !!state.map.revealed[regionId];
  state.map.revealed[regionId] = true; r.revealed = true;
  return !was;
}
export const isRevealed = (state, regionId) => !!state.map?.revealed?.[regionId];

// Every land hex of a region (no void), optionally only of one type.
export function regionHexes(state, regionId, type = null) {
  const r = state.map?.regions?.[regionId]; if (!r) return [];
  return r.hexKeys.map(k => state.map.hexes[k]).filter(h => h && !h.void && (!type || h.type === type));
}
export const portalKeys = (state) => Object.values(state.map?.regions || {}).map(r => r.portalKey).filter(Boolean);
