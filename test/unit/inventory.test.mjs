// The GRID_* events: move, rotate, stack, equip rules (hands, spells, rings, two-handers, cape), swap refusal
// when the grid is full, unequip needs room, drop to the tile, sort, GM resize, Chaos grid effects, pendingLoot
// through the GRID_* path, the affix damage hooks, Gilt crumbling and the class hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gen, grid as G, chars, hooks, shared, playingRoom, charOf, give, stubMonster, stubFight, ctxFor, clone } from './_fixtures-characters.mjs';
import { slotsFor } from '../../packages/shared/handlers/inventory.js';
import { setCooldown } from '../../packages/shared/handlers/classes.js';
import { B } from '../../packages/shared/balance.js';

const occupiedBy = (c, id) => G.cellOf(c, id);

test('inventory: GRID_MOVE places, rotates and refuses bad spots; consumables merge onto a stack; only your own seat', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const st = r.state;
  const sword = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('bonetoss'), { seed: 1 }));
  r.append('GRID_MOVE', { itemId: sword.id, x: 5, y: 0, rot: 1 }, pid); assert.deepEqual([occupiedBy(c, sword.id).x, occupiedBy(c, sword.id).rot], [5, 1]);
  assert.match(r.try('GRID_MOVE', { itemId: sword.id, x: 7, y: 0, rot: 1 }, pid).message, /does not fit/);
  assert.match(r.try('GRID_MOVE', { itemId: 'nope', x: 0, y: 0 }, pid).message, /no such item/);
  assert.match(r.try('GRID_MOVE', { itemId: sword.id, x: 0, y: 0, playerId: pid }, r.state.seats[1]).message, /cannot act/);
  const potions = Object.values(c.items).find(i => i.baseId === 'potion'); const cell = occupiedBy(c, potions.id);
  const more = give(r, pid, gen.makeConsumable(st, 'potion', { qty: 2 }));
  r.append('GRID_MOVE', { itemId: more.id, x: cell.x, y: cell.y }, pid); assert.equal(potions.qty, B.items.starterPotions + 2); assert.ok(!c.items[more.id], 'merged away');
  const lots = give(r, pid, gen.makeConsumable(st, 'potion', { qty: 5 }));
  r.append('GRID_MOVE', { itemId: lots.id, x: cell.x, y: cell.y }, pid); assert.equal(potions.qty, B.grid.stack); assert.equal(lots.qty, 5 - (B.grid.stack - B.items.starterPotions - 2)); assert.ok(occupiedBy(c, lots.id), 'the remainder stays where it was');
  r.append('GRID_MOVE', { itemId: sword.id, x: 0, y: 3, rot: 0 }, pid); assert.deepEqual([occupiedBy(c, sword.id).x, occupiedBy(c, sword.id).y], [0, 3]);
});

test('inventory: equip rules — hands, two spells, four rings, two-handers take both hands, cape only for the Mantle, boots any time', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const st = r.state;
  assert.deepEqual(slotsFor({ slot: 'weapon' }), ['mainhand', 'offhand']); assert.deepEqual(slotsFor({ slot: 'ring' }), ['ring1', 'ring2', 'ring3', 'ring4']); assert.deepEqual(slotsFor({ slot: 'consumable' }), []);
  const w2 = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('houndsnap'), { seed: 2 }));
  r.append('GRID_EQUIP', { itemId: w2.id, slot: 'offhand' }, pid); assert.equal(c.worn.offhand.id, w2.id); assert.ok(!occupiedBy(c, w2.id), 'worn items leave the grid');
  assert.match(r.try('GRID_EQUIP', { itemId: w2.id, slot: 'helmet' }, pid).message, /does not go in helmet/);
  const rings = [1, 2, 3, 4, 5].map(i => give(r, pid, gen.makeGear(st, 'ring', { seed: 10 + i })));
  for (const ring of rings.slice(0, 4)) r.append('GRID_EQUIP', { itemId: ring.id }, pid);
  assert.deepEqual(['ring1', 'ring2', 'ring3', 'ring4'].map(s => c.worn[s].id), rings.slice(0, 4).map(x => x.id), 'rings fill the first free ring slot');
  r.append('GRID_EQUIP', { itemId: rings[4].id }, pid); assert.equal(c.worn.ring1.id, rings[4].id); assert.ok(occupiedBy(c, rings[0].id), 'the displaced ring is back in the grid');
  r.append('GRID_EQUIP', { itemId: rings[0].id, slot: 'ring3' }, pid); assert.equal(c.worn.ring3.id, rings[0].id); assert.ok(occupiedBy(c, rings[2].id));
  const spellA = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('twinward'), { seed: 3 })), spellB = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('briefcase'), { seed: 4 }));
  r.append('GRID_EQUIP', { itemId: spellA.id }, pid); r.append('GRID_EQUIP', { itemId: spellB.id }, pid);
  assert.ok([c.worn.spell1, c.worn.spell2].filter(Boolean).length === 2); assert.match(r.try('GRID_EQUIP', { itemId: spellA.id, slot: 'mainhand' }, pid).message, /does not go in mainhand/);
  const buster = give(r, pid, gen.generateLegendary(st, 'bustercleaver', { seed: 5 }));
  const main = c.worn.mainhand; r.append('GRID_EQUIP', { itemId: buster.id, slot: 'offhand' }, pid);
  assert.equal(c.worn.mainhand.id, buster.id); assert.equal(c.worn.offhand, null); assert.ok(occupiedBy(c, main.id) && occupiedBy(c, w2.id), 'both hands emptied into the grid');
  const dagger = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('coinblade'), { seed: 6 }));
  r.append('GRID_EQUIP', { itemId: dagger.id, slot: 'offhand' }, pid); assert.equal(c.worn.offhand.id, dagger.id); assert.equal(c.worn.mainhand, null, 'an off-hand pick puts the two-hander down'); assert.ok(occupiedBy(c, buster.id));
  const cape = give(r, pid, gen.makeGear(st, 'torso', { seed: 7 })); assert.match(r.try('GRID_EQUIP', { itemId: cape.id, slot: 'cape' }, pid).message, /does not go in cape/);
  const boots = give(r, pid, gen.makeGear(st, 'boots', { seed: 8 })); c.usedThisTurn.moved = true; r.append('GRID_EQUIP', { itemId: boots.id }, pid); assert.equal(c.worn.boots.id, boots.id);
  const pedestal = give(r, pid, gen.generateLegendary(st, 'pedestalblade', { seed: 9 })); assert.match(r.try('GRID_EQUIP', { itemId: pedestal.id }, pid).message, /under level/);
  c.level = B.legendaries.pedestalLevel; r.append('GRID_EQUIP', { itemId: pedestal.id }, pid); assert.equal(c.worn.mainhand.id, pedestal.id); assert.equal(c.passives.reach, B.legendaries.pedestalReach, 'full Health: reach 3');
  c.health = 10; chars.recomputePassives(st, ctxFor(r), c); assert.equal(c.passives.reach, B.items.reachDefault);
});

test('inventory: a full grid refuses swaps and unequips; drop goes to the tile; sort; GM resize; satchel', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const st = r.state;
  // fill every free cell with rings
  let n = 0; while (G.firstFit(c, { footprint: { w: 1, h: 1 } }) && n++ < 100) give(r, pid, gen.makeGear(st, 'ring', { seed: 500 + n }));
  assert.equal(G.freeCells(c), 0);
  assert.match(r.try('GRID_UNEQUIP', { slot: 'mainhand' }, pid).message, /no room/);
  const helm = c.worn.helmet; assert.equal(helm, null);
  const ringInGrid = G.gridItems(c).find(i => i.slot === 'ring'); r.append('GRID_EQUIP', { itemId: ringInGrid.id, slot: 'ring1' }, pid); assert.equal(c.worn.ring1.id, ringInGrid.id);
  const other = G.gridItems(c).find(i => i.slot === 'ring'); r.append('GRID_EQUIP', { itemId: other.id, slot: 'ring1' }, pid); assert.ok(occupiedBy(c, ringInGrid.id), 'a 1x1 swap fits back into the freed cell');
  const wep = c.worn.mainhand; const bigSword = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('bonecage'), { seed: 2 }), { place: false });
  // put the big sword where the 1x1 just went? it cannot: refuse and keep everything as it was
  const snapshot = clone({ worn: c.worn, cells: c.grid.cells });
  const ring2 = G.gridItems(c).find(i => i.slot === 'ring'); assert.match(r.try('GRID_EQUIP', { itemId: bigSword.id, slot: 'mainhand' }, pid).message, /not yours to equip|no room/);
  assert.deepEqual(clone({ worn: c.worn, cells: c.grid.cells }), snapshot, 'nothing changed on the refusal'); delete c.items[bigSword.id];
  const dropMe = G.gridItems(c).find(i => i.slot === 'ring'); r.append('GRID_DROP', { itemId: dropMe.id }, pid);
  assert.ok(!c.items[dropMe.id]); assert.equal(st.tileLoot[c.pos].at(-1).id, dropMe.id); assert.equal(st.tileLoot[c.pos].at(-1).round, st.round);
  assert.match(r.try('GRID_DROP', { itemId: wep.id }, pid).message, /unequip it first/);
  assert.match(r.try('GRID_UNEQUIP', { slot: 'mainhand' }, pid).message, /no room/, 'one free cell is not three');
  for (let i = 0; i < 2; i++) r.append('GRID_DROP', { itemId: G.gridItems(c).find(x => x.slot === 'ring').id }, pid);
  r.append('GRID_SORT', {}, pid); const ids = c.grid.cells.map(x => x.itemId).sort(); assert.equal(new Set(ids).size, ids.length);
  r.append('GRID_UNEQUIP', { slot: 'mainhand' }, pid); assert.equal(c.worn.mainhand, null); assert.ok(occupiedBy(c, wep.id), 'after a sort the three free cells line up');
  assert.match(r.try('GRID_RESIZE', { playerId: pid, cols: 2, rows: 2 }).message, /cannot shrink/);
  assert.match(r.try('GRID_RESIZE', { playerId: pid, cols: 9 }, pid).message, /GM only/);
  r.append('GRID_RESIZE', { playerId: pid, cols: 9 }); assert.equal(c.grid.cols, 9);
  c.grid.cols = B.grid.maxCols; assert.throws(() => hooks.consumables.satchel(st, ctxFor(r), c, {}, null), /already/);
  c.grid.cols = 8; hooks.consumables.satchel(st, ctxFor(r), c, {}, null); assert.equal(c.grid.cols, 9);
});

test('inventory: Chaos grid effects apply at the owner\'s turn start; the shrunk row comes back; pendingLoot lands on the GRID_* path', () => {
  const r = playingRoom(); const st = r.state; const cur = shared.currentPlayerId(st); const next = st.seats[(st.seats.indexOf(cur) + 1) % st.seats.length]; const c = charOf(r, next);
  const rows = c.grid.rows; const before = clone(c.grid.cells);
  c.gridEffects = ['scramble', 'shrink', 'steal']; const itemsBefore = Object.keys(c.items).length;
  r.append('TURN_END', {}, cur); assert.equal(shared.currentPlayerId(st), next);
  assert.deepEqual(c.gridEffects, []); assert.equal(c.grid.rows, rows - 1); assert.ok(c.effects.some(e => e.id === 'gridshrink'));
  assert.equal(Object.keys(c.items).length, itemsBefore - 1, 'one cell stolen'); assert.ok(JSON.stringify(c.grid.cells) !== JSON.stringify(before), 'scrambled');
  for (let i = 0; i < st.seats.length; i++) r.append('TURN_END', {}, shared.currentPlayerId(st));
  assert.equal(shared.currentPlayerId(st), next); assert.equal(c.grid.rows, rows, 'back after a round'); assert.ok(!c.effects.some(e => e.id === 'gridshrink'));
  // pendingLoot through a GRID_* event, and through the turn hooks
  c.pendingLoot = [{ baseId: 'loot', rarity: 'common', slot: 'ring', seed: 77 }];
  r.append('GRID_SORT', {}, next); assert.deepEqual(c.pendingLoot, []); assert.ok(Object.values(c.items).some(i => i.seed === 77 || i.slot === 'ring'));
  const c2 = charOf(r, st.seats[(st.seats.indexOf(next) + 1) % st.seats.length]); c2.pendingLoot = [{ baseId: 'potion', qty: 1, seed: 1 }];
  r.append('TURN_END', {}, next); assert.deepEqual(c2.pendingLoot, []);
});

test('inventory hooks: stake discounts, damage affixes, guard + grit, ward refunds, stake cap, Gem first-hit immunity, Gilt crumbles, Greedy KO gold', () => {
  const r = playingRoom(); const st = r.state; const ctx = ctxFor(r); const pid = st.seats[0], tid = st.seats[1]; const a = charOf(r, pid), t = charOf(r, tid);
  const m = stubMonster(r); stubFight(r, pid);
  const sword = give(r, pid, gen.makeWeapon(st, gen.weaponDefById('bonetoss'), { rarity: 'rare', seed: 1 })); sword.affixes = [{ id: 'cruel', kind: 'damage', target: { family: 'dice' }, value: 0.2, text: '' }, { id: 'keen', kind: 'damage', target: { game: 'fifty' }, value: 0.9, text: '' }];
  r.append('GRID_EQUIP', { itemId: sword.id, slot: 'mainhand' }, pid);
  const pants = give(r, pid, gen.makeGear(st, 'pants', { seed: 2 })); pants.affixes = [{ id: 'thrifty', kind: 'stake', target: { family: 'dice' }, value: 0.3, text: '' }, { id: 'stakecap', kind: 'utility', effect: 'stakeCap', target: null, value: 6, text: '' }]; r.append('GRID_EQUIP', { itemId: pants.id }, pid);
  const torso = give(r, pid, gen.makeGear(st, 'torso', { seed: 3 })); torso.affixes = [{ id: 'mirrored', kind: 'ward', target: { family: 'dice' }, value: 0.5, text: '' }]; r.append('GRID_EQUIP', { itemId: torso.id }, pid);
  const mk = (over = {}) => ({ attackerId: a.id, targetId: t.id, targetKind: 'character', item: sword, gameId: sword.gameId, kind: 'attack', crit: false, stake: sword.stake, mult: 2, flat: 0, notes: [], ...over });
  const s1 = mk(); for (const h of hooks.damageHooks.stake) h(st, ctx, s1); assert.equal(s1.stake, Math.round(sword.stake * 0.7), 'Thrifty pants: dice stakes 30% less');
  const o1 = mk(); for (const h of hooks.damageHooks.outgoing) h(st, ctx, o1); assert.ok(Math.abs(o1.mult - 2 * 1.2) < 1e-9, 'only the matching damage affix applies');
  const i1 = mk(); for (const h of hooks.damageHooks.incoming) h(st, ctx, i1);
  const grit = chars.effectiveStats(st, t).grit * B.health.gritReducePerPoint; assert.ok(Math.abs(i1.mult - 2 * (1 - grit)) < 1e-9, 'Grit reduces damage taken');
  const helm = give(r, tid, gen.makeGear(st, 'helmet', { seed: 4 })); helm.affixes = [{ id: 'stone', kind: 'guard', target: { family: 'dice' }, value: 0.25, text: '' }]; r.append('GRID_EQUIP', { itemId: helm.id }, tid);
  const i2 = mk(); for (const h of hooks.damageHooks.incoming) h(st, ctx, i2); assert.ok(Math.abs(i2.mult - 2 * (1 - grit - 0.25)) < 1e-9, 'guard stacks with grit');
  const hp = a.health; const miss = mk({ lost: 20 }); for (const h of hooks.damageHooks.afterMiss) h(st, ctx, miss);
  assert.equal(a.health, Math.min(a.maxHealth, hp + 10 + 14), 'ward refunds half, the cap refunds the rest above 6');
  // Gem set: the first hit of every fight glances off
  for (const slot of ['helmet', 'torso', 'pants', 'boots']) r.append('GRID_EQUIP', { itemId: give(r, tid, gen.makeSetPiece(st, 'gem', slot, { seed: 5 })).id }, tid);
  const g1 = mk(); for (const h of hooks.damageHooks.incoming) h(st, ctx, g1); assert.ok(g1.cancel); const g2 = mk(); for (const h of hooks.damageHooks.incoming) h(st, ctx, g2); assert.ok(!g2.cancel, 'only the first');
  st.fight.id = 'f-next'; const g3 = mk(); for (const h of hooks.damageHooks.incoming) h(st, ctx, g3); assert.ok(g3.cancel, 'a new fight, a new glance');
  // Gilt: a charge per fight, crumbles at 0
  const gilt = give(r, pid, gen.makeSetPiece(st, 'gilt', 'helmet', { seed: 6 })); r.append('GRID_EQUIP', { itemId: gilt.id }, pid); assert.equal(gilt.charges, B.sets.giltCharges);
  for (let i = 0; i < B.sets.giltCharges; i++) { st.fight.id = 'gf' + i; for (const h of hooks.damageHooks.afterHit) h(st, ctx, mk({ targetKind: 'monster', targetId: m.id })); }
  assert.equal(a.worn.helmet, null, 'crumbled'); assert.ok(!a.items[gilt.id]);
  // Greedy necklace pays extra Gold on a KO; Enforcer kill heal
  const neck = give(r, pid, gen.makeGear(st, 'necklace', { seed: 7 })); neck.affixes = [{ id: 'greedy', kind: 'economy', effect: 'gold', target: null, value: 0.5, text: '' }]; r.append('GRID_EQUIP', { itemId: neck.id }, pid);
  // death.js pays the bank's KO Gold on the same hook; the Greedy necklace adds its 50% on top
  const gold0 = a.gold; for (const h of hooks.deathHooks.onDeath) h(st, ctx, { charId: t.id, killerId: a.id, cause: 'player' }); assert.equal(a.gold, gold0 + B.gold.perKO + Math.round(B.gold.perKO * 0.5)); assert.ok(st.wall.includes(t.name), 'the Wall');
  a.classId = 'enforcer'; a.upgrades.push('killheal'); a.health = 10; for (const h of hooks.deathHooks.onDeath) h(st, ctx, { charId: t.id, killerId: a.id }); assert.equal(a.health, 10 + B.classes.enforcerKillHeal);
  // class hooks: enforcer vs players, first hit; pit boss heal and monster guard; croupier cards
  a.upgrades.push('firsthit'); st.fight.id = 'pvp1'; const e1 = mk(); for (const h of hooks.damageHooks.outgoing) h(st, ctx, e1); assert.ok(Math.abs(e1.mult - 2 * 1.2 * (1 + B.challenge.enforcerPvpBonus) ** 2) < 1e-9, 'pvp + first hit');
  const e2 = mk(); for (const h of hooks.damageHooks.outgoing) h(st, ctx, e2); assert.ok(Math.abs(e2.mult - 2 * 1.2 * (1 + B.challenge.enforcerPvpBonus)) < 1e-9, 'first hit only once');
  t.classId = 'pitboss'; const pb = mk({ attackerId: m.id, item: { family: 'cards' }, gameId: 'war' }); for (const h of hooks.damageHooks.incoming) h(st, ctx, pb); assert.ok(pb.notes.some(n => /Pit Boss/.test(n)));
  const heal = { attackerId: t.id, targetId: t.id, targetKind: 'character', item: { family: 'cards', spellEffect: 'heal' }, gameId: 'hilo', kind: 'spell', stake: 10, mult: 2, flat: 0, notes: [] }; for (const h of hooks.damageHooks.outgoing) h(st, ctx, heal); assert.ok(Math.abs(heal.mult - 2 * (1 + B.classes.pitBossHealBonus)) < 1e-9);
  t.classId = 'croupier'; t.upgrades.push('cardsplus'); const cr = { ...heal, item: { family: 'cards' }, kind: 'attack', mult: 1, notes: [] }; for (const h of hooks.damageHooks.outgoing) h(st, ctx, cr); assert.ok(Math.abs(cr.mult - (1 + B.classes.croupierCardsBonus)) < 1e-9);
  // cooldowns tick only at the owner's turn start
  a.cooldowns.active = 0; setCooldown(st, ctx, a, 'enforcerCooldown'); assert.equal(a.cooldowns.active, B.classes.enforcerCooldown);
  const cur = shared.currentPlayerId(st); let laps = 0; while (shared.currentPlayerId(st) !== pid || laps === 0) { r.append('TURN_END', {}, shared.currentPlayerId(st)); laps++; if (laps > 10) break; }
  assert.equal(a.cooldowns.active, B.classes.enforcerCooldown - 1, 'one own turn passed');
});

test('inventory bot: every worn slot (all 16) takes a generated item at least once, across every class; a reload keeps it all', () => {
  const r = playingRoom({ names: ['A', 'B', 'C', 'D', 'E', 'F'] }); const st = r.state;
  for (const pid of st.seats) {
    const c = charOf(r, pid); for (const s of ['ring1', 'ring2', 'ring3', 'ring4', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'necklace']) {
      const slot = s.startsWith('ring') ? 'ring' : s; const it = give(r, pid, gen.generateItem(st, { slot, rarity: ['common', 'rare', 'epic'][st.seats.indexOf(pid) % 3], regionId: 'docks' }));
      r.append('GRID_EQUIP', { itemId: it.id, slot: s }, pid); assert.equal(c.worn[s].id, it.id, `${c.classId} ${s}`);
    }
    r.append('GRID_EQUIP', { itemId: give(r, pid, gen.generateItem(st, { slot: 'weapon', rarity: 'rare' })).id, slot: 'mainhand' }, pid);
    r.append('GRID_EQUIP', { itemId: give(r, pid, gen.generateItem(st, { slot: 'weapon', rarity: 'rare' })).id, slot: 'offhand' }, pid);
    r.append('GRID_EQUIP', { itemId: give(r, pid, gen.generateItem(st, { slot: 'spell', rarity: 'rare' })).id, slot: 'spell1' }, pid);
    r.append('GRID_EQUIP', { itemId: give(r, pid, gen.generateItem(st, { slot: 'spell', rarity: 'epic' })).id, slot: 'spell2' }, pid);
    r.append('GRID_EQUIP', { itemId: give(r, pid, gen.generateLegendary(st, 'infernalmantle')).id, slot: 'cape' }, pid);
    for (const s of chars.WORN_SLOTS) assert.ok(c.worn[s], `${c.classId} ${s} filled`);
    assert.equal(Object.values(c.items).filter(i => chars.WORN_SLOTS.some(s => c.worn[s]?.id === i.id)).length, 15);
    for (const cell of c.grid.cells) assert.ok(c.items[cell.itemId], 'every cell points at a held item');
    assert.ok(!c.grid.cells.some(cell => chars.WORN_SLOTS.some(s => c.worn[s]?.id === cell.itemId)), 'worn items are never in the grid');
  }
  const again = clone(st); assert.deepEqual(again, JSON.parse(JSON.stringify(st)));
  for (const pid of st.seats) assert.deepEqual(again.characters[charOf(r, pid).id].worn, charOf(r, pid).worn);
});
