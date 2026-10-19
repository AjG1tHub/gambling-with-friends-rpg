// Death: what stops it, what it costs, the Graveyard wake, PvP worn-item choice, bounties, reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, B } from './_helpers.mjs';
import { makeMap, makeCharacter, makeItem, land, slayCharacter, ctxFor, COL, at, characterOf, currentPlayerId, deathHooks } from './_fixtures-economy.mjs';
import { reviveAtGraveyard, killCharacter, nearestGraveyard, gridItems } from '../../packages/shared/handlers/death.js';
import * as hexm from '../../packages/shared/hex.js';

function started({ seed = 42, mode = 'ffa' } = {}) {
  const r = room({ seed, mode }).join(names4); makeMap(r.state);
  for (const pid of r.state.seats) makeCharacter(r.state, pid, { pos: at('strip', COL.start), gold: 100, level: 3, maxHealth: 120, health: 120 });
  r.append('RUN_START'); return r;
}
const kit = () => ({ grid: [makeItem({ name: 'Potion', baseId: 'potion', slot: 'consumable', qty: 2 }), makeItem({ name: 'Spare Blade' })], worn: { mainhand: makeItem({ name: 'Coin Blade' }), helmet: makeItem({ name: 'Cap', slot: 'helmet' }), boots: makeItem({ name: 'Slippers', slot: 'boots' }) } });

test('dying to a monster: the grid and one worn item fall on the tile, one turn missed, no level lost, wake at the nearest Graveyard at half', () => {
  const r = started(); const pid = currentPlayerId(r.state); const k = kit();
  const c = makeCharacter(r.state, pid, { pos: at('docks', COL.enc2), level: 3, maxHealth: 120, health: 40, gold: 30, ...k });
  const gy = nearestGraveyard(r.state, c.pos); assert.equal(gy, at('docks', COL.graveyard));
  const revived = []; deathHooks.onRevive.push((s, ctx, info) => revived.push(info.charId));
  const info = slayCharacter(r, c.id, { killerId: 'm1_x', killerKind: 'monster' });
  assert.equal(info.prevented, false); assert.ok(c.dead); assert.equal(c.diedTo, 'monster'); assert.equal(c.deaths, 1); assert.equal(r.state.stats[pid].deaths, 1);
  const tile = r.state.tileLoot[at('docks', COL.enc2)]; assert.equal(tile.length, 2 + B.death.wornDropsOnMonsterDeath);
  assert.equal(gridItems(c).length, 0); assert.equal(Object.values(c.worn).filter(Boolean).length, 3 - B.death.wornDropsOnMonsterDeath); assert.equal(Object.keys(c.items).length, 3 - B.death.wornDropsOnMonsterDeath);
  assert.ok(tile.every(e => e.by === c.id && e.round === r.state.round && e.id && e.name), 'flat item entries, as the inventory module writes them');
  assert.equal(c.missTurns, B.death.monsterMissTurns); assert.equal(c.level, 3); assert.equal(c.maxHealth, 120); assert.equal(c.gold, 30, 'Gold is not dropped');
  assert.equal(c.pos, gy); assert.equal(c.graveyardPos, gy);
  // their next turn is spent in the Graveyard, the one after they wake and play
  r.append('TURN_END', {}, pid);
  for (let i = 0; i < 3; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.ok(c.dead); assert.equal(c.missTurns, 0); assert.notEqual(currentPlayerId(r.state), pid);
  for (let i = 0; i < 3; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(currentPlayerId(r.state), pid); assert.ok(!c.dead); assert.equal(c.health, Math.round(120 * B.death.wakeFraction)); assert.equal(c.pos, gy); assert.equal(c.lastSafePos, gy); assert.deepEqual(revived, [c.id]);
  assert.equal(r.state.turnPhase, 'move', 'they play this turn');
  deathHooks.onRevive.length = 0;
});

test('dying to a player: the killer chooses a worn item, two turns missed (Enforcer one), a level lost, KO Gold and bounties to the killer', () => {
  const r = started(); const [a, b] = r.state.seats;
  const ca = characterOf(r.state, a); const cb = makeCharacter(r.state, b, { pos: at('strip', COL.plain), level: 3, maxHealth: 120, health: 50, gold: 10, ...kit() });
  r.state.bounties.push({ id: 'b1', targetId: b, byId: 'house', gold: 40, placedAt: 0 }, { id: 'b2', targetId: a, byId: 'house', gold: 999, placedAt: 0 });
  const g = ca.gold;
  slayCharacter(r, cb.id, { killerId: ca.id, killerKind: 'player' });
  assert.deepEqual(r.state.pendingPrompt, { playerId: a, kind: 'takeWorn', victimId: cb.id, options: ['Coin Blade', 'Cap', 'Slippers'].map(n => Object.values(cb.worn).find(i => i?.name === n).id) });
  assert.equal(Object.values(cb.worn).filter(Boolean).length, 3, 'nothing taken until the killer chooses');
  assert.equal(r.state.tileLoot[at('strip', COL.plain)].length, 2, 'the grid dropped');
  assert.equal(cb.missTurns, B.death.playerMissTurns); assert.equal(cb.level, 3 - B.death.playerKillLevelLoss); assert.equal(cb.maxHealth, 120 - B.health.maxPerLevel * B.death.playerKillLevelLoss); assert.equal(cb.levelLossPending, 1);
  assert.equal(ca.gold, g + B.gold.perKO + 40); assert.equal(ca.kills, 1); assert.equal(r.state.stats[a].kills, 1); assert.deepEqual(r.state.bounties.map(x => x.id), ['b2']); assert.equal(ca.questCounters.bountiesCollected, 1); assert.ok(ca.questCounters.killed[b]);
  // the choice
  const helmetId = cb.worn.helmet.id;
  assert.match(r.try('TILE_TAKE_LOOT', { itemId: helmetId }, b).message, /cannot act/);
  assert.match(r.try('TILE_TAKE_LOOT', { itemId: 'nope' }, a).message, /not a worn item/);
  r.append('TILE_TAKE_LOOT', { itemId: helmetId }, a);
  assert.equal(r.state.pendingPrompt, null); assert.equal(cb.worn.helmet, null); assert.equal(cb.items[helmetId], undefined); assert.equal(ca.pendingLoot.at(-1).item.id, helmetId);
  // an Enforcer misses one less; a level-1 character has no level to lose; the killer may decline
  const c3 = makeCharacter(r.state, r.state.seats[2], { pos: at('strip', COL.plain), level: 1, classId: 'enforcer', worn: { mainhand: makeItem() } });
  slayCharacter(r, c3.id, { killerId: a, killerKind: 'player' });
  assert.equal(c3.missTurns, B.death.playerMissTurns - 1); assert.equal(c3.level, 1); assert.equal(ca.kills, 2);
  r.append('TILE_TAKE_LOOT', { itemId: null }, a); assert.equal(r.state.pendingPrompt, null); assert.ok(c3.worn.mainhand);
  // a boss kill is the major penalty too, with no Gold to anyone
  const c4 = characterOf(r.state, r.state.seats[3]); slayCharacter(r, c4.id, { killerId: 'm9', killerKind: 'boss' });
  assert.equal(c4.missTurns, B.death.playerMissTurns); assert.equal(c4.level, 2); assert.equal(r.state.pendingPrompt, null);
});

test('what stops a death: the Pendant (destroyed, 1 Health), the Fairy in a Jar (half, no penalty), the Toadstool (a free death), a Phoenix already used', () => {
  const r = started(); const [a, b, c, d] = r.state.seats;
  const pendant = makeItem({ name: 'Weighted Companion Pendant', slot: 'necklace', legendaryId: 'pendant', rarity: 'legendary' });
  const ca = makeCharacter(r.state, a, { pos: at('strip', COL.plain), worn: { necklace: pendant } });
  let info = slayCharacter(r, ca.id, { killerKind: 'player', killerId: b });
  assert.equal(info.prevented, true); assert.equal(info.preventedBy, 'pendant'); assert.ok(!ca.dead); assert.equal(ca.health, 1); assert.equal(ca.worn.necklace, null); assert.equal(ca.items[pendant.id], undefined); assert.equal(ca.missTurns, 0);
  const fairy = makeItem({ name: 'Fairy in a Jar', slot: 'consumable', legendaryId: 'fairy', footprint: { w: 1, h: 1 } });
  const cb = makeCharacter(r.state, b, { pos: at('strip', COL.plain), maxHealth: 120, health: 120, grid: [fairy, makeItem()] });
  info = slayCharacter(r, cb.id, { killerKind: 'monster' });
  assert.equal(info.preventedBy, 'fairy'); assert.ok(!cb.dead); assert.equal(cb.health, Math.round(120 * B.legendaries.fairyRevive)); assert.equal(cb.items[fairy.id], undefined); assert.equal(cb.grid.cells.length, 1); assert.equal(r.state.tileLoot[cb.pos], undefined);
  const cc = makeCharacter(r.state, c, { pos: at('strip', COL.plain), level: 3, grid: [makeItem()], worn: { mainhand: makeItem() } }); cc.bankedLife = true;
  info = slayCharacter(r, cc.id, { killerKind: 'player', killerId: a });
  assert.equal(info.prevented, false); assert.equal(info.softDeath, true); assert.ok(cc.dead); assert.equal(cc.bankedLife, false);
  assert.equal(Object.keys(cc.items).length, 2, 'no drops'); assert.equal(cc.missTurns, 0, 'no turns'); assert.equal(cc.level, 3, 'no level'); assert.equal(r.state.pendingPrompt, null); assert.equal(r.state.tileLoot[at('strip', COL.plain)], undefined);
  assert.equal(characterOf(r.state, a).kills, 1, 'the killer is still paid');
  // Phoenix Feather: the items module sets prevented before our hook; we do nothing
  const cd = makeCharacter(r.state, d, { pos: at('strip', COL.plain), worn: { necklace: makeItem({ slot: 'necklace', legendaryId: 'pendant' }) } });
  const pre = { charId: cd.id, killerId: null, killerKind: 'monster', prevented: true };
  for (const h of deathHooks.onZero) h(r.state, ctxFor(r), pre); assert.ok(cd.worn.necklace, 'the pendant is kept');
});

test('an early revive, the Reset Cartridge and a GM wound to zero', () => {
  const r = started({ mode: 'pve' }); const [a, b] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b);
  slayCharacter(r, ca.id, { killerKind: 'boss' }); assert.equal(ca.missTurns, B.death.playerMissTurns);
  assert.equal(reviveAtGraveyard(r.state, ctxFor(r), ca.id, { byId: cb.id }), true); assert.ok(!ca.dead); assert.equal(ca.missTurns, 0); assert.equal(ca.health, Math.round(ca.maxHealth * B.death.wakeFraction)); assert.equal(ca.pos, ca.graveyardPos);
  assert.equal(reviveAtGraveyard(r.state, ctxFor(r), ca.id), false, 'not dead');
  // reset
  cb.effects.push({ id: 'curse', kind: 'curse', turnsLeft: 3, data: {} }); cb.gridEffects = [{ kind: 'scramble' }]; cb.lastSafePos = at('strip', COL.inn); cb.pos = at('caldera', COL.plain);
  cb.pos = at('docks', COL.bloodbank); r.append('PACT_TAKE', { amount: 40, playerId: b }, 'gm'); const pact = r.state.pacts[cb.pactIds[0]]; assert.ok(pact.owed > 40);
  assert.match(r.try('GM_RESET_CHAR', { playerId: b }, a).message, /GM only/);
  r.append('GM_RESET_CHAR', { playerId: b });
  assert.deepEqual(cb.effects, []); assert.deepEqual(cb.gridEffects, []); assert.equal(cb.pos, at('strip', COL.inn)); assert.equal(pact.owed, 40, 'interest forgiven, principal stands');
  // GM_HEALTH to zero runs the death chain with the minor penalty
  r.append('GM_HEALTH', { playerId: b, amount: -999 }); assert.ok(cb.dead); assert.equal(cb.diedTo, 'gm'); assert.equal(cb.missTurns, B.death.monsterMissTurns); assert.equal(cb.level, 3);
  // killCharacter is the one-call version siblings may use
  const c3 = characterOf(r.state, r.state.seats[2]); const info = killCharacter(r.state, ctxFor(r), c3, { killerKind: 'monster' }); assert.ok(c3.dead); assert.equal(info.charId, c3.id);
  // the dead cannot be killed twice
  const d = c3.deaths; for (const h of deathHooks.onDeath) h(r.state, ctxFor(r), { charId: c3.id, killerKind: 'monster' }); assert.equal(c3.deaths, d);
  assert.equal(hexm.distance(hexm.parse(c3.pos), hexm.parse(at('strip', COL.graveyard))), 0);
});
