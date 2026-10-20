// The hex overworld generator and the map queries: determinism, connectivity, counts, gates, secret colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, shared } from './_helpers.mjs';
import '../../packages/shared/handlers/movement.js';
import { generateMap, scaleFor, REGION_ORDER, REGION_TEMPLATES } from '../../packages/shared/map/generator.js';
import * as Q from '../../packages/shared/map/query.js';
import * as H from '../../packages/shared/hex.js';
import regionsRaw from '../../data/regions.json' with { type: 'json' };
import tilesRaw from '../../data/tiles.json' with { type: 'json' };

const { initialState, newPlayer, B } = shared;

function bare(seed, size = 'regular', players = 4) {
  const st = initialState({ roomId: 'r', code: 'MAPS', seed, size });
  for (let i = 0; i < players; i++) { st.players['p' + i] = newPlayer({ id: 'p' + i, name: 'P' + i }); st.seats.push('p' + i); }
  return st;
}
const land = (m) => Object.values(m.hexes).filter(h => !h.void);
// BFS over non-void hexes, optionally treating some keys as walls.
function reach(m, from, wall = () => false) {
  const seen = new Set([from]), q = [from];
  while (q.length) { const k = q.pop(); for (const n of H.neighbors(H.parse(k))) { const nk = H.key(n), h = m.hexes[nk]; if (h && !h.void && !seen.has(nk) && !wall(h)) { seen.add(nk); q.push(nk); } } }
  return seen;
}

test('map: the same seed rolls the same map; a different seed does not; generation is fast', () => {
  const a = generateMap(bare(123)), b = generateMap(bare(123)), c = generateMap(bare(124));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
  // warm the JIT, then time the best of three batches (the suite's files run in parallel, so a single cold batch
  // on a busy box says nothing about the generator)
  for (let s = 5; s <= 7; s++) generateMap(bare(s, 'long', 8));
  let per = Infinity;
  for (let batch = 0; batch < 3; batch++) { const t0 = performance.now(); for (let s = 1; s <= 10; s++) generateMap(bare(s, 'long', 8)); per = Math.min(per, (performance.now() - t0) / 10); }
  assert.ok(per < 50, `generation took ${per.toFixed(1)} ms`);
});

test('map: STATE.md shape, every hex keyed and coloured, void never carries a tile', () => {
  const m = generateMap(bare(7));
  for (const k of ['hexes', 'regions', 'start', 'throne', 'courier', 'revealed', 'size', 'seed']) assert.ok(k in m, k);
  assert.equal(m.seed, 7); assert.equal(m.size, 'regular'); assert.deepEqual(m.revealed, {});
  for (const [k, h] of Object.entries(m.hexes)) {
    assert.equal(k, `${h.q},${h.r}`); assert.equal(h.key, k);
    assert.ok(B.map.secretColours.includes(h.colour), `colour on ${k}`);
    assert.ok(tilesRaw.tiles[h.type], `tile type ${h.type}`);
    assert.ok(m.regions[h.regionId], `region ${h.regionId}`);
    if (h.void) { assert.ok(['water', 'chasm', 'wall'].includes(h.type)); assert.equal(h.bridge, false); }
    else { assert.ok(!['water', 'chasm', 'wall'].includes(h.type)); }
    for (const f of ['gate', 'monsterId', 'lootSeen', 'portalTo', 'bridge', 'void']) assert.ok(f in h, `${f} on ${k}`);
  }
  assert.equal(m.hexes[m.start].type, 'start'); assert.equal(m.hexes[m.throne].type, 'throne'); assert.equal(m.hexes[m.courier].type, 'courier');
  assert.equal(land(m).filter(h => h.type === 'courier').length, 1);
  for (const id of REGION_ORDER) { const r = m.regions[id]; assert.ok(r.hexKeys.length > 0); assert.ok(r.hexKeys.every(k => !m.hexes[k].void)); assert.equal(r.revealed, false); assert.ok(r.monsterTable.length === 4); assert.ok(r.bossId); }
});

test('map: every land hex is reachable from start; every region has an entry; the throne only through the Citadel gate', () => {
  for (const seed of [1, 2, 3, 42, 777, 2026]) for (const size of ['short', 'regular', 'long']) {
    const m = generateMap(bare(seed, size, seed % 2 ? 4 : 7));
    const all = reach(m, m.start);
    assert.equal(all.size, land(m).length, `seed ${seed} ${size}: ${land(m).length - all.size} land hexes cut off`);
    const gate = m.regions.citadel.bossGateKey;
    const without = reach(m, m.start, h => h.key === gate);
    assert.ok(!without.has(m.throne), `seed ${seed} ${size}: throne reachable around the gate`);
    assert.ok(H.neighbors(H.parse(m.throne)).every(n => { const h = m.hexes[H.key(n)]; return !h || h.void || h.key === gate; }), 'throne annex');
    // the Citadel is only entered over gated bridges
    const citadelLand = land(m).filter(h => h.regionId === 'citadel');
    const entries = citadelLand.filter(h => H.neighbors(h).some(n => { const o = m.hexes[H.key(n)]; return o && !o.void && o.regionId !== 'citadel'; }));
    assert.ok(entries.length > 0); for (const e of entries) assert.ok(e.bridge && e.gate && e.gate.level === B.map.citadelLevel && e.gate.keyItem === 'citadel_key', `citadel entry ${e.key} ungated`);
    const noCitadel = reach(m, m.start, h => h.regionId === 'citadel');
    assert.ok(!noCitadel.has(m.throne) && !citadelLand.some(h => noCitadel.has(h.key)));
  }
});

test('map: sizes and player counts scale the regions; each region holds its guaranteed tiles', () => {
  const M = B.map;
  for (const [size, players] of [['short', 4], ['regular', 4], ['long', 4], ['regular', 6], ['long', 8]]) {
    const st = bare(11, size, players), sc = scaleFor(st), m = generateMap(st);
    const extra = Math.max(0, players - B.table.tunedMin);
    assert.equal(sc.requestedHexes, M[`regionHexes${size[0].toUpperCase()}${size.slice(1)}`] + M.hexesPerExtraPlayer * extra);
    assert.equal(sc.monstersPerRegion, Math.round(M.monstersPerRegion + M.monstersPerExtraPlayer * extra));
    assert.deepEqual(m.scale, sc);
    let bossgates = 0, portals = 0;
    for (const id of REGION_ORDER) {
      const hx = land(m).filter(h => h.regionId === id);
      const cluster = hx.filter(h => !h.bridge && h.type !== 'throne');
      assert.equal(cluster.length, sc.regionHexes[id], `${size}/${players} ${id} cluster`);
      assert.ok(sc.regionHexes[id] >= sc.requestedHexes);
      const n = (t) => hx.filter(h => h.type === t).length;
      for (const t of ['inn', 'shop', 'graveyard', 'bloodbank']) assert.ok(n(t) >= 1, `${id} lacks ${t}`);
      assert.equal(n('bossgate'), 1, `${id} bossgates`); assert.equal(n('portal'), 1, `${id} portals`);
      assert.ok(n('chest') >= M.chestsPerRegion, `${id} chests`);
      assert.ok(n('chaos') >= (id === 'blackwood' ? M.blackwoodChaosMult : 1), `${id} chaos`);
      assert.ok(n('encounter') >= sc.monstersPerRegion, `${id} encounter hexes for the monster target`);
      assert.ok(hx.filter(h => h.type === 'encounter').every(h => h.monsterSlot === true));
      assert.ok(hx.find(h => h.type === 'bossgate').bossSlot === true);
      assert.equal(m.regions[id].portalKey, hx.find(h => h.type === 'portal').key);
      assert.equal(m.regions[id].bossGateKey, hx.find(h => h.type === 'bossgate').key);
      bossgates += n('bossgate'); portals += n('portal');
      // the cluster itself is connected
      const first = cluster[0].key, seen = new Set([first]), q = [first]; const cl = new Set(cluster.map(h => h.key));
      while (q.length) { const k = q.pop(); for (const nb of H.neighbors(H.parse(k))) { const nk = H.key(nb); if (cl.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); } } }
      assert.equal(seen.size, cl.size, `${id} cluster split`);
    }
    assert.equal(bossgates, 5); assert.equal(portals, 5);
    // bridges per neighbouring pair: at least one, aiming for bridgesPerPair
    for (const tpl of REGION_TEMPLATES) for (const nb of tpl.neighbours) {
      const bridgesBetween = land(m).filter(h => h.bridge && H.neighbors(h).some(n => { const o = m.hexes[H.key(n)]; return o && !o.void && !o.bridge && [tpl.id, nb].includes(o.regionId) && o.regionId !== h.regionId; }));
      assert.ok(bridgesBetween.length >= 1, `${tpl.id}-${nb} unbridged`);
    }
    assert.ok(land(m).some(h => h.regionId === 'strip' && h.type === 'start'));
  }
});

test('map: regions carry the template data; blackwood doubles chaos; void flavour follows the region', () => {
  const m = generateMap(bare(99, 'long', 6));
  for (const tpl of regionsRaw.regions) {
    const r = m.regions[tpl.id];
    assert.equal(r.name, tpl.name); assert.equal(r.tier, tpl.tier); assert.equal(r.family, tpl.family); assert.equal(r.accent, tpl.accent);
    assert.deepEqual(r.modifier, tpl.modifier); assert.deepEqual(r.monsterTable, tpl.monsterTable); assert.equal(r.bossId, tpl.bossId);
    assert.equal(r.raidBossId, tpl.raidBossId || null);
    const voids = Object.values(m.hexes).filter(h => h.void && h.regionId === tpl.id);
    assert.ok(voids.length > 0); assert.ok(voids.every(h => h.type === tpl.voidFlavour));
  }
  assert.equal(m.regions.citadel.finalBossId, 'the_dealer'); assert.equal(m.regions.blackwood.raidBossId, 'the_litter'); assert.equal(m.regions.citadel.raidBossId, 'high_table');
  const chaos = (id) => land(m).filter(h => h.regionId === id && h.type === 'chaos').length;
  assert.ok(chaos('blackwood') >= 2 && chaos('blackwood') >= chaos('strip'));
  // every void hex touches land (the halo), and some holes sit inside clusters
  for (const h of Object.values(m.hexes).filter(h => h.void)) assert.ok(H.neighbors(h).some(n => m.hexes[H.key(n)] && !m.hexes[H.key(n)].void), `stray void ${h.key}`);
  const holes = Object.values(m.hexes).filter(h => h.void && H.neighbors(h).filter(n => { const o = m.hexes[H.key(n)]; return o && !o.void; }).length >= 4);
  assert.ok(holes.length >= 1, 'no interior holes');
});

test('map: queries — passable, gates, monsters stop, reachability, paths, colours, reveal', () => {
  const st = bare(31); const m = generateMap(st);
  st.characters.c1 = { id: 'c1', level: 1, gold: 0, items: {}, pos: m.start, dead: false }; st.players.p0.characterId = 'c1';
  assert.equal(Q.hexAt(st, m.start).type, 'start'); assert.equal(Q.hexAt(st, 'nope'), null);
  assert.equal(Q.regionOf(st, m.start).id, 'strip');
  const voidKey = Object.values(m.hexes).find(h => h.void).key;
  assert.equal(Q.passable(st, voidKey), false); assert.equal(Q.passable(st, m.start), true); assert.equal(Q.passable(st, 'nope'), false);
  assert.match(Q.blockReason(st, voidKey), /Wall|Water|Chasm/);
  // the citadel gate
  const gateHex = Object.values(m.hexes).find(h => h.bridge && h.gate);
  assert.match(Q.gateBlocks(st, st.characters.c1, gateHex), /level 10/); assert.equal(Q.passable(st, gateHex.key, 'c1'), false); assert.equal(Q.passable(st, gateHex.key), true, 'ungated map query');
  st.characters.c1.level = 10; assert.equal(Q.gateBlocks(st, st.characters.c1, gateHex), null); st.characters.c1.level = 1;
  st.characters.c1.items.k = { id: 'k', baseId: 'citadel_key', slot: 'tool' }; assert.equal(Q.gateBlocks(st, st.characters.c1, gateHex), null); delete st.characters.c1.items.k;
  assert.match(Q.gateBlocks(st, st.characters.c1, { gate: { toll: 25 } }), /25 Gold/); st.characters.c1.gold = 30; assert.equal(Q.gateBlocks(st, st.characters.c1, { gate: { toll: 25 } }), null); assert.equal(Q.tollDue(st.characters.c1, { gate: { toll: 25 } }), 25);
  // the throne waits for the Dealer: nothing gates the step itself; while he lives his hex is a monster hex, so it ends the move (the fight)
  st.monsters.d = { id: 'd', name: 'The Dealer', final: true, dead: false, pos: m.throne };
  assert.match(Q.gateBlocks(st, st.characters.c1, m.hexes[m.throne]), /level 10/, 'the throne hex carries the Citadel gate');
  assert.equal(Q.gateBlocks(st, { level: 20, items: {} }, m.hexes[m.throne]), null, 'nothing else gates the step while the Dealer lives'); assert.equal(Q.stopsHere(st, m.throne), true);
  st.monsters.d.dead = true; assert.equal(Q.stopsHere(st, m.throne), false); assert.equal(Q.gateBlocks(st, { level: 20, items: {} }, m.hexes[m.throne]), null);
  // monsters stop you: reachable within 3 never passes through one
  const near = Q.reachableFrom(st, m.start, 1).map(x => x.key); assert.ok(near.length >= 2);
  st.monsters.m = { id: 'm', name: 'Croupier', pos: near[0], dead: false };
  const r3 = Q.reachableFrom(st, m.start, 3, 'c1');
  assert.ok(r3.find(x => x.key === near[0]).stops);
  const far = r3.filter(x => x.dist >= 2).map(x => x.key);
  for (const k of far) { const p = Q.pathTo(st, m.start, k, 'c1'); assert.ok(p && p.at(-1) === k && !p.slice(0, -1).includes(near[0]), `path to ${k} walks through the monster`); }
  assert.deepEqual(Q.pathTo(st, m.start, m.start), []); assert.equal(Q.pathTo(st, m.start, voidKey), null);
  // the monster hex is still a legal end hex
  assert.deepEqual(Q.pathTo(st, m.start, near[0], 'c1'), [near[0]]);
  // route planning may walk through monsters (`through`): never longer than the walk around, and the default is unchanged
  for (const k of far) { const p = Q.pathTo(st, m.start, k, 'c1', 64, true), q = Q.pathTo(st, m.start, k, 'c1'); assert.ok(p && p.at(-1) === k && p.length <= q.length, `through-path to ${k}`); }
  delete st.monsters.m;
  // colours: nearest and ties, ranks by walking distance
  const ranks = Q.colourRanks(st, m.start, m.hexes[near[1]].colour, 4, 'c1');
  assert.equal(ranks[0].dist, 1); assert.ok(ranks[0].keys.includes(near[1]));
  assert.deepEqual(Q.nearestOfColour(st, m.start, m.hexes[near[1]].colour, 4, 'c1'), ranks[0].keys);
  assert.deepEqual(Q.nearestOfColour(st, m.start, m.hexes[near[1]].colour, 4, 'c1', 1), ranks[1]?.keys || []);
  assert.deepEqual(Q.colourRanks(st, m.start, 'Chartreuse', 4), []);
  // labels and reveal
  assert.equal(Q.tileLabel('bloodbank'), 'Blood Bank'); assert.equal(Q.tileLabel('mystery'), 'mystery');
  assert.equal(Q.reveal(st, 'docks'), true); assert.equal(Q.reveal(st, 'docks'), false); assert.equal(st.map.revealed.docks, true); assert.equal(st.map.regions.docks.revealed, true); assert.equal(Q.reveal(st, 'nowhere'), false);
  assert.ok(Q.portalKeys(st).length === 5); assert.ok(Q.regionHexes(st, 'strip', 'inn').length >= 1);
});

test('map: RUN_START rolls the map through the hook, seats everyone on the start hex and reveals the Strip', () => {
  const r = room({ seed: 9 }).join(names4);
  for (const pid of ['p0', 'p1']) { r.state.characters['c_' + pid] = { id: 'c_' + pid, playerId: pid, pos: null, region: null, dead: false, worn: {}, items: {}, usedThisTurn: { attack: 0, spell: 0, moved: false } }; r.state.players[pid].characterId = 'c_' + pid; }
  r.append('RUN_START');
  assert.ok(r.state.map); assert.equal(r.state.map.seed, 9);
  for (const pid of ['p0', 'p1']) { const c = r.state.characters['c_' + pid]; assert.equal(c.pos, r.state.map.start); assert.equal(c.region, 'strip'); assert.equal(c.lastSafePos, r.state.map.start); }
  assert.deepEqual(r.state.map.revealed, { strip: true });
  const r2 = room({ seed: 9 }).join(names4); r2.append('GM_CONFIG', { fogOfWar: false }); r2.append('RUN_START');
  assert.equal(Object.keys(r2.state.map.revealed).length, 5, 'fog off reveals everything');
  assert.equal(JSON.stringify(r2.state.map.hexes), JSON.stringify(r.state.map.hexes), 'same seed, same map through the room');
});
