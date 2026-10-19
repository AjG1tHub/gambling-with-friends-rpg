// Encounters: monster generation from data/monsters.json, the tile hooks, boss gates, the throne, drops and tile loot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, shared, B } from './_helpers.mjs';
import { makeMap, makeCharacter, makeItem, land, slayMonster, ctxFor, COL, at, tileHooks, characterOf, currentPlayerId } from './_fixtures-economy.mjs';
import { generateMonsters, monsterAt, aliveMonsters, respawnRegion, makeMonsterItem, SPECIES, speciesInRegion } from '../../packages/shared/encounters/monsters.js';
import { openEncounter, gateBlocks, ensureShopStock } from '../../packages/shared/handlers/tiles.js';
import regionsData from '../../data/regions.json' with { type: 'json' };
import items36 from '../../data/items36.json' with { type: 'json' };

function started({ seed = 42, mode = 'ffa', tier = 1, players = names4 } = {}) {
  const r = room({ seed, mode, tier }).join(players);
  makeMap(r.state);
  for (const pid of r.state.seats) makeCharacter(r.state, pid, { pos: at('strip', COL.start) });
  r.append('RUN_START');
  return r;
}
const byRegion = (state, rid) => Object.values(state.monsters).filter(m => m.regionId === rid && !m.blocker);

test('monsters.json: every region has four commons and a boss, every table id exists, items are real, loot tables sum', () => {
  const itemIds = new Set(items36.items.map(i => i.id));
  for (const rid of ['strip', 'docks', 'blackwood', 'caldera', 'citadel']) {
    assert.ok(speciesInRegion(rid).length >= 4, `${rid} commons`);
    assert.equal(speciesInRegion(rid, 'boss').length, 1, `${rid} boss`);
  }
  assert.equal(Object.values(SPECIES).filter(s => s.role === 'raid').length, 2);
  assert.equal(Object.values(SPECIES).filter(s => s.role === 'final').length, 1);
  assert.equal(SPECIES.dungheap.role, 'blocker');
  for (const s of Object.values(SPECIES)) {
    for (const id of s.items) assert.ok(itemIds.has(id), `${s.id} item ${id}`);
    assert.ok(s.sprite === `monsters/${s.id}`, s.id);
    const w = Object.values(s.loot.rarity).reduce((a, b) => a + b, 0); assert.ok(w > 0, `${s.id} loot weights`);
    if (s.role === 'boss' || s.role === 'raid' || s.role === 'final') assert.ok(s.moods?.length >= 3, `${s.id} moods`);
  }
  for (const reg of regionsData.regions) {
    for (const id of reg.monsterTable) assert.ok(SPECIES[id], `regions.json ${reg.id} table ${id}`);
    assert.ok(SPECIES[reg.bossId], reg.bossId);
    if (reg.raidBossId) assert.ok(SPECIES[reg.raidBossId]);
    if (reg.finalBossId) assert.ok(SPECIES[reg.finalBossId]);
  }
  assert.equal(SPECIES.the_grey.special, 'mindlink'); assert.equal(SPECIES.the_litter.parts.length, 5);
  assert.equal(new Set(SPECIES.the_litter.parts.map(p => p.family)).size, 5, 'each cat its own family');
});

test('generation: counts per region, bosses on gates, raids, the Dealer on the throne, Dungheaps, deterministic by seed', () => {
  const r = started();
  const M = B.monsters, MAP = B.map;
  for (const rid of ['strip', 'docks', 'blackwood', 'caldera', 'citadel']) {
    const commons = byRegion(r.state, rid).filter(m => !m.boss);
    assert.equal(commons.length, MAP.monstersPerRegion, `${rid} commons`);
    for (const m of commons) { assert.equal(r.state.map.hexes[m.pos].type, 'encounter'); assert.equal(r.state.map.hexes[m.pos].monsterId, m.id); assert.ok(m.items.length >= M.itemsMin && m.items.length <= M.itemsMax); }
    const boss = byRegion(r.state, rid).find(m => m.boss && !m.raid && !m.final); assert.ok(boss); assert.equal(boss.pos, at(rid, COL.bossgate)); assert.equal(boss.health, Math.round(M.healthBoss * SPECIES[boss.speciesId].healthMult));
  }
  assert.equal(r.state.monsters[r.state.map.hexes[at('strip', COL.enc1)].monsterId].speciesId, 'drunk_revenant', 'the first encounter under the sign');
  const litter = Object.values(r.state.monsters).find(m => m.speciesId === 'the_litter'); assert.ok(litter.raid && litter.boss, 'a raid is a boss for the death penalty'); assert.equal(litter.pos, at('blackwood', COL.gate2)); assert.equal(litter.parts.length, 5); assert.equal(litter.parts.reduce((s, p) => s + p.health, 0), litter.health);
  const dealer = monsterAt(r.state, r.state.map.throne); assert.ok(dealer.final); assert.equal(dealer.health, M.healthFinal); assert.equal(dealer.items[0].rarity, 'legendary');
  assert.equal(Object.values(r.state.monsters).filter(m => m.blocker).length, 5);
  const grey = Object.values(r.state.monsters).find(m => m.speciesId === 'the_grey'); assert.ok(grey.linkedTo); assert.equal(r.state.monsters[grey.linkedTo].linkedTo, grey.id);
  // health formula with the difficulty tier
  const r2 = started({ tier: 3 }); const sg = Object.values(r2.state.monsters).find(m => m.speciesId === 'slot_golem');
  assert.equal(sg.health, Math.round(M.healthCommon * SPECIES.slot_golem.healthMult * (1 + M.tierScale * 2)));
  // items are the items36 shape, staked by rarity, never imported from the items module
  const it = makeMonsterItem(r.state, 'twinfang', 'rare', 7); assert.equal(it.gameId, 'baccarat'); assert.equal(it.stake, B.items.stakeRare); assert.equal(it.slot, 'weapon'); assert.equal(makeMonsterItem(r.state, 'ward', 'common', 1).slot, 'spell');
  // same seed, same monsters
  const r3 = started(); assert.equal(JSON.stringify(Object.values(r3.state.monsters).map(m => [m.speciesId, m.pos, m.health])), JSON.stringify(Object.values(r.state.monsters).map(m => [m.speciesId, m.pos, m.health])));
  const r4 = started({ seed: 7 }); assert.notEqual(JSON.stringify(Object.values(r4.state.monsters).map(m => m.pos + m.speciesId)), JSON.stringify(Object.values(r.state.monsters).map(m => m.pos + m.speciesId)));
  // more players, more monsters
  const r5 = started({ players: [...names4, 'E', 'F'] }); assert.equal(byRegion(r5.state, 'docks').filter(m => !m.boss).length, Math.round(MAP.monstersPerRegion + MAP.monstersPerExtraPlayer * 2));
  // the map may hand a scale
  const r6 = room().join(names4); makeMap(r6.state); r6.state.map.scale = { monsters: 1 }; for (const pid of r6.state.seats) makeCharacter(r6.state, pid); r6.append('RUN_START'); assert.equal(byRegion(r6.state, 'strip').filter(m => !m.boss).length, 1);
});

test('generation: PvP has no monsters and Encounter tiles become Arenas; without a map nothing happens', () => {
  const r = started({ mode: 'pvp' }); assert.equal(Object.keys(r.state.monsters).length, 0);
  const pid = currentPlayerId(r.state); land(r, pid, at('strip', COL.enc1));
  assert.equal(r.state.pendingPrompt.kind, 'arena'); assert.equal(r.state.fight, null);
  const r2 = room().join(names4); r2.append('RUN_START'); assert.equal(Object.keys(r2.state.monsters).length, 0);
});

test('encounter tile: a living monster opens the fight with allies on the hex; a dead one is empty ground; raids need players', () => {
  const r = started(); const [a, b, c] = r.state.seats; const hex = at('strip', COL.enc2);
  const m = monsterAt(r.state, hex); assert.ok(m);
  characterOf(r.state, b).pos = hex; characterOf(r.state, c).pos = hex;
  r.state.alliances.push({ id: 'al1', members: [a, b], active: true });
  land(r, a, hex);
  assert.equal(r.state.fight.kind, 'encounter'); assert.equal(r.state.fight.monsterId, m.id); assert.deepEqual(r.state.fight.playerIds, [a, b], 'the ally joins, the stranger does not');
  assert.equal(r.state.fight.playerId, a); assert.equal(r.state.fight.turn, 'player'); assert.equal(r.state.fight.done, false); assert.equal(r.state.turnPhase, 'resolve');
  slayMonster(r, m.id, a); assert.equal(r.state.fight, null);
  land(r, a, hex); assert.equal(r.state.fight, null); assert.equal(r.state.turnPhase, 'action'); assert.match(r.state.log.at(-1).text, /Nothing stirs/);
  // raid on an encounter-type position needs raidMinPlayers
  const litter = Object.values(r.state.monsters).find(m => m.speciesId === 'the_litter');
  land(r, a, litter.pos); assert.equal(r.state.fight, null); assert.equal(r.state.turnPhase, 'action');
  characterOf(r.state, c).pos = litter.pos; land(r, a, litter.pos); assert.equal(r.state.fight.kind, 'raid'); assert.ok(litter.mood, 'the boss wheel set a mood'); assert.deepEqual(r.state.fight.playerIds, [a], 'a stranger on the tile is not in the party unless allied');
  // openEncounter on a blocker hex (the movement module calls this when walked into)
  r.state.fight = null; const heap = monsterAt(r.state, at('strip', COL.blocker));
  assert.ok(openEncounter(r.state, ctxFor(r), a, r.state.map.hexes[heap.pos])); assert.equal(r.state.fight.monsterId, heap.id);
  assert.equal(tileHooks.blocker, undefined, 'blocker is not a registered tile hook (the mover owns passability)');
});

test('boss gate: under level bounces back along the way you came, a key opens it, the Boss Wheel sets the mood, the fight is kind boss', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  const gate = at('caldera', COL.bossgate);
  assert.equal(gateBlocks(r.state, c, r.state.map.hexes[gate]), true);
  c.pos = at('caldera', COL.chaos); land(r, pid, gate);
  assert.equal(r.state.fight, null); assert.equal(c.pos, at('caldera', COL.chaos), `bounced ${B.movement.bossGateBounce} hexes back along the line (clamped to where you came from)`);
  c.pos = at('caldera', COL.start); land(r, pid, gate); assert.equal(c.pos, at('caldera', COL.bossgate - B.movement.bossGateBounce));
  // no prevPos: turned away in place
  c.pos = gate; c.prevPos = null; tileHooks.bossgate(r.state, ctxFor(r), pid, r.state.map.hexes[gate]); assert.equal(c.pos, gate); assert.equal(r.state.turnPhase, 'action');
  // level opens it
  c.level = 5; const boss = monsterAt(r.state, gate); const hp = boss.health;
  land(r, pid, gate); assert.equal(r.state.fight.kind, 'boss'); assert.equal(r.state.fight.monsterId, boss.id); assert.ok(boss.mood); assert.equal(r.state.lastSpin.wheel, 'boss'); assert.equal(boss.health, Math.round(hp * boss.mood.healthMult));
  assert.ok(SPECIES.boss_caldera.moods.some(m => m.name === r.state.lastSpin.outcomes[r.state.lastSpin.index]));
  // the citadel gate wants level 10 or the key item
  r.state.fight = null; const cg = r.state.map.hexes[at('citadel', COL.bossgate)]; assert.equal(gateBlocks(r.state, c, cg), true);
  const key = makeItem({ baseId: 'citadel_key', name: 'Citadel Key', slot: 'tool' }); c.items[key.id] = key; assert.equal(gateBlocks(r.state, c, cg), false);
  // a gate whose boss is dead stands open
  slayMonster(r, boss.id, pid); land(r, pid, gate); assert.equal(r.state.fight, null); assert.equal(r.state.turnPhase, 'action');
  // a rigged boss wheel
  const r2 = started(); const p2 = currentPlayerId(r2.state); characterOf(r2.state, p2).level = 20; r2.append('GM_RIG', { stream: 'wheels', value: 'White Hot' });
  land(r2, p2, at('caldera', COL.bossgate)); assert.equal(monsterAt(r2.state, at('caldera', COL.bossgate)).mood.id, 'whitehot');
});

test('throne: the Dealer guards it; killing him on the throne wins ffa; pve leaves the end to the modes module', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  land(r, pid, r.state.map.throne); assert.equal(r.state.fight.kind, 'boss'); const dealer = r.state.monsters[r.state.fight.monsterId]; assert.ok(dealer.final); assert.ok(dealer.mood);
  slayMonster(r, dealer.id, pid); assert.equal(r.state.finalBossDeadBy, pid); assert.equal(r.state.throneReachedBy, pid); assert.ok(c.gold >= SPECIES.the_dealer.loot.gold[0]);
  const r2 = started({ mode: 'pve' }); const p2 = currentPlayerId(r2.state); land(r2, p2, r2.state.map.throne); slayMonster(r2, r2.state.fight.monsterId, p2);
  assert.equal(r2.state.finalBossDeadBy, p2); assert.equal(r2.state.throneReachedBy, undefined);
  land(r2, p2, r2.state.map.throne); assert.equal(r2.state.throneReachedBy, undefined); assert.equal(r2.state.turnPhase, 'action');
  const r3 = started({ mode: 'pvp' }); const p3 = currentPlayerId(r3.state); land(r3, p3, r3.state.map.throne); assert.equal(r3.state.throneReachedBy, p3);
});

test('drops: Gold to the killer (split across a raid party), an item spec into pendingLoot, counters, linked monsters die together, Dungheaps open the hex', () => {
  const r = started({ seed: 3 }); const [a, b] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b);
  const m = monsterAt(r.state, at('docks', COL.enc1));
  r.append('GM_RIG', { stream: 'loot', value: 'epic' });
  slayMonster(r, m.id, a);
  assert.ok(m.dead); assert.ok(ca.gold >= m.loot.gold[0] && ca.gold <= m.loot.gold[1]); assert.equal(ca.questCounters.monsterKills, 1);
  assert.equal(r.state.stats[a].goldEarned, ca.gold);
  const spec = (ca.pendingLoot || []).find(s => s.baseId === 'loot'); if (spec) { assert.equal(spec.region, 'docks'); assert.ok(['common', 'rare', 'epic', 'legendary'].includes(spec.rarity)); assert.equal(typeof spec.seed, 'number'); }
  // the killer may be named by player id or character id
  const m2 = monsterAt(r.state, at('docks', COL.enc2)); const g = ca.gold; slayMonster(r, m2.id, ca.id); assert.ok(ca.gold > g);
  // raid party split: both on the tile and allied
  const litter = Object.values(r.state.monsters).find(x => x.speciesId === 'the_litter');
  ca.pos = cb.pos = litter.pos; r.state.alliances.push({ id: 'x', members: [a, b], active: true }); land(r, a, litter.pos);
  assert.deepEqual(r.state.fight.playerIds, [a, b]);
  const ga = ca.gold, gb = cb.gold; slayMonster(r, litter.id, a);
  assert.ok(ca.gold - ga > 0 && cb.gold - gb > 0); assert.equal(ca.gold - ga, cb.gold - gb, 'shared reward'); assert.equal(ca.questCounters.bosses, 1); assert.equal(cb.questCounters.bosses, 1); assert.equal(r.state.stats[a].bosses, 1);
  // a mind-linked pair dies together (set the link by hand: this seed's citadel table may not have rolled the Grey)
  const [x, y] = aliveMonsters(r.state).filter(m => m.regionId === 'citadel' && !m.boss); x.linkedTo = y.id; y.linkedTo = x.id;
  slayMonster(r, x.id, a); assert.ok(y.dead);
  // Dungheap
  const heap = monsterAt(r.state, at('strip', COL.blocker)); const g2 = ca.gold; slayMonster(r, heap.id, a);
  assert.equal(r.state.map.hexes[heap.pos].type, 'plain'); assert.equal(r.state.map.hexes[heap.pos].monsterId, null); assert.ok(ca.gold > g2);
  assert.equal(aliveMonsters(r.state).length, 28 - 6);
  // respawn (Ember Flask rest) brings the commons of a region back, never bosses
  const boss = monsterAt(r.state, at('docks', COL.bossgate)); slayMonster(r, boss.id, a);
  assert.equal(respawnRegion(r.state, 'docks'), 2); assert.ok(!m.dead && m.health === m.maxHealth); assert.ok(boss.dead);
});

test('tiles: shop shelf, chest once, inn visit, portal and arena prompts, safe tiles set lastSafePos, tile loot pickup and the round sweep', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  land(r, pid, at('docks', COL.shop)); assert.equal(r.state.turnPhase, 'action'); const shop = r.state.shops[at('docks', COL.shop)];
  assert.ok(shop); assert.equal(shop.stock.length, 9 + B.shop.stock); assert.ok(shop.stock.every(e => e.priceKey in B.shop)); assert.ok(shop.stock.some(e => e.spec.baseId === 'loot')); assert.ok(!shop.stock.some(e => e.spec.rarity === 'legendary'));
  assert.equal(ensureShopStock(r.state, ctxFor(r), at('docks', COL.shop)), shop, 'the shelf persists');
  assert.equal(c.lastSafePos, at('docks', COL.shop)); assert.deepEqual(Object.keys(c.visitedRegions), ['docks']);
  land(r, pid, at('docks', COL.chest)); assert.deepEqual(r.state.pendingPrompt, { playerId: pid, kind: 'spin', wheel: 'loot', hexKey: at('docks', COL.chest) }); assert.equal(r.state.turnPhase, 'resolve');
  r.append('WHEEL_SPIN', { wheel: 'loot' }, pid); assert.equal(r.state.pendingPrompt, null); assert.equal(r.state.turnPhase, 'action'); assert.ok(r.state.map.hexes[at('docks', COL.chest)].lootSeen); assert.equal(c.questCounters.openChests, 1);
  land(r, pid, at('docks', COL.chest)); assert.equal(r.state.pendingPrompt, null); assert.match(r.state.log.at(-1).text, /empty/);
  land(r, pid, at('docks', COL.inn)); assert.equal(c.innSafeRound, r.state.round); assert.deepEqual(c.innVisit, { hexKey: at('docks', COL.inn), turn: c.turnsTaken, rests: 0 });
  land(r, pid, at('docks', COL.portal)); assert.deepEqual(r.state.pendingPrompt, { playerId: pid, kind: 'portal', from: at('docks', COL.portal), to: 'strip' });
  r.append('TILE_LEAVE', {}, pid); assert.equal(r.state.pendingPrompt, null); assert.equal(r.state.turnPhase, 'action');
  land(r, pid, at('docks', COL.arena)); assert.equal(r.state.pendingPrompt.kind, 'arena');
  r.state.pendingPrompt = null;
  for (const t of ['wheel', 'event', 'chaos']) { land(r, pid, at('docks', COL[t])); assert.equal(r.state.pendingPrompt.wheel, { wheel: 'fortune', event: 'fate', chaos: 'chaos' }[t]); r.state.pendingPrompt = null; }
  for (const t of ['plain', 'courier', 'bounty', 'graveyard', 'bloodbank']) { land(r, pid, at('docks', COL[t])); assert.equal(r.state.turnPhase, 'action', t); assert.equal(r.state.pendingPrompt, null); }
  // tile loot
  const it = makeItem({ name: 'Lost Ring', slot: 'ring' }); r.state.tileLoot[at('docks', COL.plain)] = [{ ...it, round: r.state.round, droppedAt: 0, by: null }];
  land(r, pid, at('docks', COL.plain));
  assert.match(r.try('TILE_TAKE_LOOT', { itemId: 'nope' }, pid).message, /nothing like that/);
  r.append('TILE_TAKE_LOOT', { itemId: it.id }, pid); assert.equal(r.state.tileLoot[at('docks', COL.plain)], undefined); assert.deepEqual(c.pendingLoot.at(-1), { item: it });
  r.state.tileLoot['5,5'] = [{ ...makeItem(), round: r.state.round, droppedAt: 0, by: null }];
  for (let i = 0; i < 4 * (B.death.tileLootRounds + 1); i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.tileLoot['5,5'], undefined, 'swept after death.tileLootRounds rounds');
});
