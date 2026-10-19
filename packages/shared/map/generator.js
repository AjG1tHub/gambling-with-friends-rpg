// The hex overworld generator (SPEC.md › Map). `generateMap(state, ctx)` rolls five region clusters from
// data/regions.json, joins neighbouring regions with bridge hexes, surrounds and pierces them with void, deals
// the tile types, and writes `state.map` in the STATE.md shape. Everything random comes from the room's `map`
// stream (layout, tiles) and `colours` stream (secret hex colours), so the same seed always rolls the same map
// and the GM can replay it. Monsters are NOT created here: encounter hexes get `monsterSlot: true` and each
// region records its `monsterTable`; the encounters module fills them.
//
// Layout: region centres sit on a fixed diamond (strip at the origin, docks NE, blackwood SE, caldera E,
// citadel further E). Each region grows inside its own Voronoi territory, kept two hexes clear of its
// neighbours, so the gaps between clusters are one to three hexes wide and that is where bridges go.
// The Citadel's bridges are gated (`map.citadelLevel` or the key item); the throne is an annex hex whose only
// land neighbour is the Citadel's Boss Gate, so it can only be reached through that gate.
//
// Extra fields beyond STATE.md (all additive): map.colourDeck (the Card boots deck, filled by movement.js),
// map.scale (what scaleFor returned), map.bounds; hex.monsterSlot / hex.bossSlot; region.centre, voidFlavour,
// bridgeKeys, portalKey, bossGateKey, raidBossId, finalBossId, look, signature.
import regionsRaw from '../../../data/regions.json' with { type: 'json' };
import tilesRaw from '../../../data/tiles.json' with { type: 'json' };
import * as H from '../hex.js';
import { streamRng } from '../rng.js';
import { group } from '../balance.js';
import { activeSeats } from '../state.js';

export const REGION_TEMPLATES = regionsRaw.regions;
export const REGION_ORDER = REGION_TEMPLATES.map(r => r.id);
export const TILE_TYPES = Object.keys(tilesRaw.tiles);
export const CITADEL_KEY_ITEM = REGION_TEMPLATES.find(r => r.id === 'citadel').gate.keyItem;

// Region centres in units of S (the centre spacing). The diamond keeps strip/docks/blackwood/caldera within
// one spacing of each other and the citadel alone beyond the caldera.
const CENTRE_UNITS = { strip: { q: 0, r: 0 }, docks: { q: 1, r: -1 }, blackwood: { q: 0, r: 1 }, caldera: { q: 1, r: 0 }, citadel: { q: 2, r: 0 } };
const MARGIN = 2;          // hexes a territory stays clear of the next centre's half-way line
const GROW_SLACK = 1.3;    // the territory ball holds this many times the cluster size
const PULL_WEIGHT = 3;     // extra growth weight on hexes that face a neighbouring region
const MAX_BRIDGE_LEN = 3;  // longest bridge, in hexes

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mapB = (state, ctx) => (ctx && ctx.B ? ctx.B('map') : group(state, 'map'));
const tableB = (state, ctx) => (ctx && ctx.B ? ctx.B('table') : group(state, 'table'));

// Guaranteed tiles for one region: the shared list plus chests, with Blackwood's Chaos multiplied.
function guaranteedFor(tpl, M) {
  const list = [];
  for (const t of tilesRaw.guaranteedPerRegion) {
    const n = (t === 'chaos' && tpl.modifier.key === 'doubleChaos') ? Math.round(M.blackwoodChaosMult) : 1;
    for (let i = 0; i < n; i++) list.push(t);
  }
  for (let i = 0; i < M.chestsPerRegion; i++) list.push('chest');
  return list;
}

// The computed sizes for this room: hexes per region, monster target, chests. Other modules and BALANCE.md read
// this instead of re-deriving it. `hexesPerRegion` is what the size table asks for; `regionHexes` is what each
// region actually gets, which can be larger when the guaranteed tiles plus the monster target would not fit.
export function scaleFor(state, ctx = null) {
  const M = mapB(state, ctx), T = tableB(state, ctx);
  const size = state.size || 'regular';
  const players = activeSeats(state).length;
  const extraPlayers = Math.max(0, players - T.tunedMin);
  const requestedHexes = M[`regionHexes${cap(size)}`] + M.hexesPerExtraPlayer * extraPlayers;
  const monstersPerRegion = Math.round(M.monstersPerRegion + M.monstersPerExtraPlayer * extraPlayers);
  const regionHexes = {}, minHexes = {};
  for (const tpl of REGION_TEMPLATES) {
    minHexes[tpl.id] = guaranteedFor(tpl, M).length + (tpl.id === REGION_ORDER[0] ? 1 : 0) + monstersPerRegion;
    regionHexes[tpl.id] = Math.max(requestedHexes, minHexes[tpl.id]);
  }
  const landHexes = Object.values(regionHexes).reduce((a, b) => a + b, 0);
  return { size, players, extraPlayers, hexesPerRegion: requestedHexes, requestedHexes, regionHexes, minHexes, monstersPerRegion,
    monstersTotal: monstersPerRegion * REGION_TEMPLATES.length, chestsPerRegion: M.chestsPerRegion, bridgesPerPair: M.bridgesPerPair,
    regions: REGION_TEMPLATES.length, landHexes };
}

// ---- geometry helpers -------------------------------------------------------------------------------------------

function layoutFor(maxN) {
  let r = 1; while (3 * r * r + 3 * r + 1 < maxN * GROW_SLACK) r++;   // literal: hexes in a filled hexagon of radius r
  const S = 2 * r + 2;   // even, so the half-way line between two centres falls on a hex row that belongs to nobody
  const centres = {};
  for (const id of REGION_ORDER) { const u = CENTRE_UNITS[id]; centres[id] = { q: u.q * S, r: u.r * S }; }
  return { radius: r + 1, spacing: S, centres };
}

function nearestRegion(h, centres) {
  let best = null, bd = Infinity;
  for (const id of REGION_ORDER) { const d = H.distance(h, centres[id]); if (d < bd) { bd = d; best = id; } }
  return best;
}

// Hexes a region may grow into: within `radius` of its centre and MARGIN closer to it than to any other centre.
function territoryOf(id, centres, radius) {
  const out = new Set();
  for (const h of H.range(centres[id], radius)) {
    const d = H.distance(h, centres[id]);
    let ok = true;
    for (const o of REGION_ORDER) { if (o !== id && d + MARGIN > H.distance(h, centres[o])) { ok = false; break; } }
    if (ok) out.add(H.key(h));
  }
  return out;
}

function connected(keys, dropKey = null) {
  const set = new Set(keys); if (dropKey) set.delete(dropKey);
  const [first] = set; if (!first) return true;
  const seen = new Set([first]), q = [first];
  while (q.length) { const k = q.pop(); for (const n of H.neighbors(H.parse(k))) { const nk = H.key(n); if (set.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); } } }
  return seen.size === set.size;
}

function clusterNeighbourCount(k, cluster) { let n = 0; for (const nb of H.neighbors(H.parse(k))) if (cluster.has(H.key(nb))) n++; return n; }

// Grow a compact, slightly ragged blob of `n` hexes from the centre, inside the territory, then punch holes.
// `pull` is the list of neighbouring centres: hexes on the near side towards a neighbour weigh more, so the
// clusters reach for each other and the gaps the bridges cross stay short.
function growCluster(rng, centreKey, territory, n, pull, spacing) {
  const holesWanted = Math.max(1, Math.floor(n / 8));   // literal: one hole per eight cluster hexes (shape, not a tunable)
  const cluster = new Set([centreKey]);
  const target = Math.min(n + holesWanted, territory.size);
  while (cluster.size < target) {
    const cands = [];
    for (const k of cluster) for (const nb of H.neighbors(H.parse(k))) {
      const nk = H.key(nb); if (cluster.has(nk) || !territory.has(nk)) continue;
      if (cands.some(c => c.k === nk)) continue;
      const touching = clusterNeighbourCount(nk, cluster);
      const reach = pull.filter(p => H.distance(nb, p) < spacing - MARGIN).length;
      cands.push({ k: nk, weight: touching * touching + 1 + reach * PULL_WEIGHT });
    }
    if (!cands.length) break;
    cluster.add(rng.weightedPick(cands).k);
  }
  // Holes: interior hexes whose removal keeps the blob connected.
  const holes = [];
  let interior = rng.shuffle([...cluster].filter(k => k !== centreKey && clusterNeighbourCount(k, cluster) >= 3));   // literal: an interior hex touches at least three of its cluster
  for (const k of interior) {
    if (holes.length >= holesWanted || cluster.size <= n) break;
    if (!connected(cluster, k)) continue;
    cluster.delete(k); holes.push(k);
  }
  // Trim leaves back to exactly n.
  let guard = 0;
  while (cluster.size > n && guard++ < 500) {
    const leaves = rng.shuffle([...cluster].filter(k => k !== centreKey && clusterNeighbourCount(k, cluster) <= 2 && connected(cluster, k)));
    if (!leaves.length) break;
    cluster.delete(leaves[0]);
  }
  return { cluster, holes };
}

// Shortest bridge of gap hexes from any hex of A to any hex of B. `gapOk(k)` says whether a hex may carry a bridge.
function findBridge(rng, clusterA, clusterB, gapOk) {
  const prev = new Map(), depth = new Map(), queue = [];
  const offset = rng.int(0, 5);   // literal: one of the six hex directions
  for (const k of rng.shuffle([...clusterA])) { depth.set(k, 0); queue.push(k); }
  while (queue.length) {
    const k = queue.shift(), d = depth.get(k);
    if (d >= MAX_BRIDGE_LEN) continue;
    const h = H.parse(k);
    for (let i = 0; i < 6; i++) {   // literal: the six hex directions
      const nb = H.neighbor(h, i + offset), nk = H.key(nb);
      if (depth.has(nk) || clusterA.has(nk)) continue;
      if (clusterB.has(nk)) { if (d === 0) continue; const out = []; let cur = k; while (depth.get(cur) > 0) { out.unshift(cur); cur = prev.get(cur); } return out; }
      if (!gapOk(nk)) continue;
      depth.set(nk, d + 1); prev.set(nk, k); queue.push(nk);
    }
  }
  return null;
}

function nearestPair(clusterA, clusterB) {
  let best = null, bd = Infinity;
  for (const a of clusterA) for (const b of clusterB) { const d = H.distance(H.parse(a), H.parse(b)); if (d < bd) { bd = d; best = [a, b]; } }
  return best;
}

// ---- the generator ----------------------------------------------------------------------------------------------

function makeHex(h, regionId, type, extra = {}) {
  return { q: h.q, r: h.r, key: H.key(h), regionId, type, colour: null, void: false, bridge: false, gate: null, monsterId: null, lootSeen: false, portalTo: null, ...extra };
}

export function generateMap(state, ctx = null) {
  const M = mapB(state, ctx);
  const rng = streamRng(state, 'map');
  const scale = scaleFor(state, ctx);
  const maxN = Math.max(...Object.values(scale.regionHexes));
  const { radius, spacing, centres } = layoutFor(maxN);
  const citadelGate = { level: M.citadelLevel, keyItem: CITADEL_KEY_ITEM, toll: null };
  const tplOf = Object.fromEntries(REGION_TEMPLATES.map(t => [t.id, t]));
  const tierOf = (id) => tplOf[id].tier;
  const orderOf = (id) => REGION_ORDER.indexOf(id);

  // 1. Territories and clusters.
  const territories = {}, clusters = {}, holes = {}, holeSet = new Set();
  for (const id of REGION_ORDER) territories[id] = territoryOf(id, centres, radius);
  for (const id of REGION_ORDER) {
    const g = growCluster(rng, H.key(centres[id]), territories[id], scale.regionHexes[id], tplOf[id].neighbours.map(n => centres[n]), spacing);
    clusters[id] = g.cluster; holes[id] = g.holes;
  }
  const land = new Map();   // key → regionId for every cluster hex and bridge hex
  for (const id of REGION_ORDER) { for (const k of clusters[id]) land.set(k, id); for (const k of holes[id]) holeSet.add(k); }

  // 2. Bridges between neighbouring regions. A bridge belongs to the deeper region (higher tier, later in order).
  const bridges = {};       // key → { regionId, pair }
  const pairs = [];
  for (const tpl of REGION_TEMPLATES) for (const nb of tpl.neighbours) { const pr = [tpl.id, nb].sort((a, b) => orderOf(a) - orderOf(b)); if (!pairs.some(p => p[0] === pr[0] && p[1] === pr[1])) pairs.push(pr); }
  const owner = (a, b) => (tierOf(a) === tierOf(b) ? (orderOf(a) > orderOf(b) ? a : b) : (tierOf(a) > tierOf(b) ? a : b));
  for (const [a, b] of pairs) {
    const own = owner(a, b);
    let made = 0;
    for (let i = 0; i < M.bridgesPerPair; i++) {
      const free = (k) => !land.has(k) && !holeSet.has(k) && !bridges[k];
      // Prefer a bridge that does not touch another one; take a touching one if that is all the gap allows.
      const path = findBridge(rng, clusters[a], clusters[b], (k) => free(k) && !H.neighbors(H.parse(k)).some(n => bridges[H.key(n)]))
        || findBridge(rng, clusters[a], clusters[b], free);
      if (!path) break;
      for (const k of path) { bridges[k] = { regionId: own, pair: [a, b] }; land.set(k, own); }
      made++;
    }
    if (!made) {   // the territories never found a clean gap: cut a straight causeway between the nearest hexes
      const [ka, kb] = nearestPair(clusters[a], clusters[b]);
      for (const h of H.line(H.parse(ka), H.parse(kb))) { const k = H.key(h); if (!land.has(k)) { bridges[k] = { regionId: own, pair: [a, b] }; land.set(k, own); } }
    }
  }

  // 3. Hex records for land.
  const hexes = {};
  for (const id of REGION_ORDER) for (const k of clusters[id]) hexes[k] = makeHex(H.parse(k), id, 'plain');
  for (const [k, b] of Object.entries(bridges)) hexes[k] = makeHex(H.parse(k), b.regionId, 'plain', { bridge: true, gate: tplOf[b.regionId].gate ? { ...citadelGate } : null });

  // 4. Regions, tiles and the special hexes.
  const regions = {};
  const start = H.key(centres[REGION_ORDER[0]]);
  let throne = null, courier = null;
  const freeFill = [];      // hexes dealt by weight (courier candidates)
  for (const tpl of REGION_TEMPLATES) {
    const id = tpl.id;
    const bridgeKeys = Object.keys(bridges).filter(k => bridges[k].regionId === id);
    const entryKeys = Object.keys(bridges).filter(k => bridges[k].pair.includes(id));
    const required = guaranteedFor(tpl, M);
    for (let i = 0; i < scale.monstersPerRegion; i++) required.push('encounter');
    const pool = rng.shuffle([...clusters[id]].filter(k => k !== start));
    let bossGateKey = null, portalKey = null;
    if (id === 'citadel') {
      // The Boss Gate opens on the throne: pick a cluster hex with a free neighbour whose other neighbours are all void,
      // as far from the Citadel's entry bridges as possible.
      const entries = entryKeys.map(H.parse);
      const scored = [];
      for (const k of pool) {
        const h = H.parse(k);
        for (const n of H.neighbors(h)) {
          const nk = H.key(n); if (land.has(nk)) continue;
          if (H.neighbors(n).some(x => { const xk = H.key(x); return xk !== k && land.has(xk); })) continue;
          const far = entries.length ? Math.min(...entries.map(e => H.distance(h, e))) : 0;
          scored.push({ k, nk, far });
        }
      }
      scored.sort((x, y) => y.far - x.far);
      const pick = scored.length ? rng.pick(scored.filter(s => s.far === scored[0].far)) : null;
      if (pick) {
        bossGateKey = pick.k; throne = pick.nk;
        pool.splice(pool.indexOf(pick.k), 1);
        hexes[throne] = makeHex(H.parse(throne), id, 'throne', { gate: { ...citadelGate } });
        land.set(throne, id);
      } else { bossGateKey = pool.pop(); }   // cannot happen on a sane layout; the throne then shares the gate hex
      hexes[bossGateKey].type = 'bossgate'; hexes[bossGateKey].gate = { ...citadelGate }; hexes[bossGateKey].bossSlot = true;
      required.splice(required.indexOf('bossgate'), 1);
      if (!throne) throne = bossGateKey;
    }
    for (const t of required) {
      const k = pool.pop(); if (!k) break;
      hexes[k].type = t;
      if (t === 'bossgate') { bossGateKey = k; hexes[k].bossSlot = true; }
      if (t === 'portal') portalKey = k;
      if (t === 'encounter') hexes[k].monsterSlot = true;
    }
    // Whatever is left is dealt by the region's weights.
    const weights = Object.entries(tpl.tiles).map(([type, w]) => ({ type, weight: type === 'chaos' && tpl.modifier.key === 'doubleChaos' ? w * M.blackwoodChaosMult : w }));
    while (pool.length) {
      const k = pool.pop(), t = rng.weightedPick(weights).type;
      hexes[k].type = t; if (t === 'encounter') hexes[k].monsterSlot = true;
      freeFill.push(k);
    }
    regions[id] = {
      id, name: tpl.name, tier: tpl.tier, family: tpl.family, accent: tpl.accent, modifier: { ...tpl.modifier },
      hexKeys: [], monsterTable: [...tpl.monsterTable], bossId: tpl.bossId, raidBossId: tpl.raidBossId || null, finalBossId: tpl.finalBossId || null,
      revealed: false, gate: tpl.gate ? { ...citadelGate } : null, centre: H.key(centres[id]), voidFlavour: tpl.voidFlavour, bridgeKeys, entryKeys, portalKey, bossGateKey, look: tpl.look, signature: tpl.signature,
    };
  }
  hexes[start].type = 'start';

  // 5. The courier post: one on the map, on a dealt hex (or a bridge when the regions are packed tight).
  const courierPool = freeFill.length ? freeFill : Object.keys(bridges).filter(k => !hexes[k].gate);
  courier = rng.pick(courierPool);
  hexes[courier].type = 'courier'; delete hexes[courier].monsterSlot;

  // 6. Void: every non-land neighbour of a land hex, flavoured by the nearest region. Holes are covered by this.
  for (const k of Object.keys(hexes)) {
    for (const n of H.neighbors(H.parse(k))) {
      const nk = H.key(n); if (hexes[nk]) continue;
      const rid = nearestRegion(n, centres);
      hexes[nk] = makeHex(n, rid, tplOf[rid].voidFlavour, { void: true });
    }
  }

  // 7. Secret colours (own stream) and bookkeeping.
  const crng = streamRng(state, 'colours');
  const bounds = { minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity };
  for (const h of Object.values(hexes)) {
    h.colour = crng.pick(M.secretColours);
    regions[h.regionId].hexKeys.push(h.key);
    bounds.minQ = Math.min(bounds.minQ, h.q); bounds.maxQ = Math.max(bounds.maxQ, h.q); bounds.minR = Math.min(bounds.minR, h.r); bounds.maxR = Math.max(bounds.maxR, h.r);
  }
  for (const r of Object.values(regions)) r.hexKeys = r.hexKeys.filter(k => !hexes[k].void);

  state.map = { hexes, regions, start, throne, courier, revealed: {}, size: state.size, seed: state.seed, colourDeck: [], scale, bounds, spacing };
  return state.map;
}
