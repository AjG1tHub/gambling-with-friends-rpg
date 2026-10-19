// Every Named Legendary and every Blockcraft set exists as data, builds a valid Item, and has either an
// implementation registered in legendaryEffects or a documented owner elsewhere. Plus the effects this module owns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gen, shared, hooks, chars, playingRoom, charOf, give, stubMonster, stubFight, ctxFor } from './_fixtures-characters.mjs';
import { LEGENDARY_STUBS, LEGENDARY_OWNERS, equip } from '../../packages/shared/handlers/inventory.js';
import { B } from '../../packages/shared/balance.js';

const EXPECTED = ['pedestalblade', 'gravitygauntlet', 'pendant', 'emberflask', 'bigfancygun', 'toadstool', 'bustercleaver', 'pipbuoy', 'tamersnare', 'theshout', 'blockbreaker', 'impostorsvisor', 'thejoker', 'chickendinner', 'raillance', 'broadside', 'octanetreads', 'amuletofpotency', 'infernalmantle', 'deepseasuit', 'skatesofthesixth', 'carapace', 'ocarina', 'fairyjar', 'poolladder', 'cameraobscura', 'resetcartridge', 'croupierscoat'];

test('legendaries: all 28 rows exist with slot, nod, text, footprint and effect keys that point at real tunables', () => {
  assert.equal(gen.LEGENDARIES.length, 28);
  assert.deepEqual(gen.LEGENDARIES.map(l => l.id).sort(), EXPECTED.slice().sort());
  for (const l of gen.LEGENDARIES) {
    assert.ok(l.name && l.slot && l.nodsTo && l.text && l.footprint?.w && l.footprint?.h, l.id);
    assert.ok(l.effect?.key === l.id && l.effect.owner, `${l.id} effect`);
    for (const k of l.effect.params) assert.ok(k in B.legendaries, `${l.id} param ${k} is a legendaries tunable`);
    if (l.stakeKey) assert.ok(l.stakeKey in B.legendaries);
    if (l.gameId) assert.ok(gen.gameById(l.gameId), `${l.id} game ${l.gameId}`);
    if (l.twoHand) assert.deepEqual(l.footprint, { w: 2, h: 4 });
  }
  assert.equal(gen.legendaryDef('infernalmantle').slot, 'cape'); assert.ok(gen.legendaryDef('infernalmantle').neverDrops);
  assert.equal(gen.droppableLegendaries().length, 27);
});

test('legendaries: generateLegendary builds a valid Item for each (4 rolled affixes + the unique on wearable ones)', () => {
  const st = shared.initialState({ seed: 3, code: 'LEGX' });
  for (const l of gen.LEGENDARIES) {
    const it = gen.generateLegendary(st, l.id, { seed: 42 });
    assert.equal(it.rarity, 'legendary'); assert.equal(it.legendaryId, l.id); assert.equal(it.unique, l.id); assert.equal(it.sprite, `legendary/${l.id}`);
    assert.deepEqual(it.footprint, l.footprint); assert.equal(it.slot, l.slot);
    const unique = it.affixes.filter(a => a.kind === 'unique'); assert.equal(unique.length, 1, `${l.id} unique affix`);
    const wearable = !['consumable', 'cape'].includes(l.slot);
    if (wearable) assert.equal(it.affixes.length, B.items.affixesLegendary + 1, `${l.id} affixes`); else assert.equal(it.affixes.length, 1);
    if (it.gameId) { assert.ok(it.stake > 0 && it.charges > 0 && it.family, `${l.id} plays a game`); }
    const again = gen.generateLegendary(shared.initialState({ seed: 99, code: 'LEGY' }), l.id, { seed: 42 }); const strip = ({ id, ...r }) => r; assert.deepEqual(strip(again), strip(it), `${l.id} deterministic`);
  }
  assert.equal(gen.generateLegendary(st, 'bigfancygun').stake, B.legendaries.bigGunStake);
  assert.equal(gen.generateLegendary(st, 'raillance').stake, B.legendaries.railStake);
  assert.equal(gen.generateLegendary(st, 'theshout').stake, B.legendaries.shoutStake);
  assert.equal(gen.generateLegendary(st, 'bustercleaver').stake, B.items.stakeLegendary);
  assert.equal(gen.generateLegendary(st, 'emberflask').charges, B.legendaries.emberCharges);
});

test('legendaries: every effect key is implemented here or owned by a named sibling module', () => {
  const owners = new Set(['characters', 'items', 'movement', 'map', 'encounters', 'social', 'modes', 'economy']);
  for (const l of gen.LEGENDARIES) {
    assert.ok(owners.has(l.effect.owner), `${l.id} owner ${l.effect.owner}`);
    if (l.effect.owner === 'characters') assert.ok(hooks.legendaryEffects[l.id], `${l.id} registered in legendaryEffects`);
    else assert.ok(LEGENDARY_STUBS.includes(l.id), `${l.id} is a documented stub`);
  }
  assert.equal(LEGENDARY_OWNERS.octanetreads, 'movement'); assert.equal(LEGENDARY_OWNERS.bigfancygun, 'items');
  assert.ok(hooks.legendaryEffects.tamersnare?.onUse, 'the snare is registered by the pets handler');
});

test('sets: the five Blockcraft sets exist with per-piece tunables, a four-piece bonus and the chainmail note', () => {
  assert.deepEqual(gen.SETS.map(s => s.id), ['hide', 'gilt', 'iron', 'gem', 'chainmail']);
  for (const s of gen.SETS) {
    assert.ok(s.name && s.rarity && s.flavour && s.bonus?.key && s.bonus.text, s.id);
    for (const e of s.perPiece) { assert.ok(e.valueKey in B.sets, `${s.id} ${e.valueKey}`); assert.ok(e.text); }
    for (const slot of ['helmet', 'torso', 'pants', 'boots']) { assert.ok(s.pieceNames[slot]); const it = gen.makeSetPiece(shared.initialState({ seed: 1, code: 'SETX' }), s.id, slot, { seed: 5 }); assert.equal(it.setId, s.id); assert.equal(it.slot, slot); assert.equal(it.rarity, s.rarity); }
  }
  const chain = gen.setDef('chainmail'); assert.equal(chain.note, "I didn't forget about you, but you're still terrible."); assert.equal(chain.bonus.key, 'nothing'); assert.ok(chain.foundOnly);
  assert.ok(gen.setDef('hide').dyeable); assert.equal(gen.setDef('gilt').crumbles.chargesKey, 'giltCharges');
});

test('legendaries owned here: pendant saves you once, fairy jar from the grid, toadstool, amulet stats, potency and buster damage, coat min stake', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const ctx = ctxFor(r); const st = r.state;
  const pendant = give(r, pid, gen.generateLegendary(st, 'pendant', { seed: 1 })); equip(st, ctx, c, pendant, 'necklace');
  c.health = 0; const info = { charId: c.id, killerId: null, cause: 'monster' }; for (const h of hooks.deathHooks.onZero) h(st, ctx, info);
  assert.ok(info.prevented); assert.equal(c.health, 1); assert.equal(c.worn.necklace, null, 'the pendant is destroyed'); assert.ok(!st.items?.[pendant.id]);
  const jar = give(r, pid, gen.generateLegendary(st, 'fairyjar', { seed: 2 })); c.health = 0; const info2 = { charId: c.id };
  for (const h of hooks.deathHooks.onZero) h(st, ctx, info2); assert.ok(info2.prevented && info2.noDrops && info2.noMissTurns); assert.equal(c.health, Math.round(c.maxHealth * B.legendaries.fairyRevive)); assert.ok(!c.items[jar.id]);
  const shroom = give(r, pid, gen.generateLegendary(st, 'toadstool', { seed: 3 })); hooks.legendaryEffects.toadstool.onUse(st, ctx, c, {}, shroom);
  assert.ok(c.effects.some(e => e.id === 'extralife')); assert.ok(!c.items[shroom.id]); c.health = 0; const info3 = { charId: c.id };
  for (const h of hooks.deathHooks.onZero) h(st, ctx, info3); assert.ok(!info3.prevented && info3.noDrops && info3.noLevelLoss); assert.ok(!c.effects.some(e => e.id === 'extralife')); c.health = 50;
  const base = { ...c.stats };
  const amulet = give(r, pid, gen.generateLegendary(st, 'amuletofpotency', { seed: 4 })); equip(st, ctx, c, amulet, 'necklace');
  const { effectiveStats } = chars; const es = effectiveStats(st, c); for (const s of ['luck', 'nerve', 'greed', 'grit']) assert.equal(es[s], Math.min(B.stats.max, base[s] + B.legendaries.potencyStats), s);
  const out = { attackerId: c.id, targetId: 'm1', targetKind: 'monster', item: c.worn.mainhand, gameId: c.worn.mainhand.gameId, kind: 'attack', stake: 10, mult: 2, flat: 0, notes: [] };
  for (const h of hooks.damageHooks.outgoing) h(st, ctx, out); assert.ok(Math.abs(out.mult - 2 * (1 + B.legendaries.potencyDamage)) < 1e-9, 'amulet +6%');
  const buster = give(r, pid, gen.generateLegendary(st, 'bustercleaver', { seed: 5 })); equip(st, ctx, c, buster, 'mainhand'); assert.equal(c.worn.offhand, null); assert.equal(c.worn.mainhand.id, buster.id);
  const out2 = { attackerId: c.id, targetId: 'm1', targetKind: 'monster', item: buster, gameId: buster.gameId, kind: 'attack', stake: 50, mult: 2, flat: 0, notes: [] };
  for (const h of hooks.damageHooks.outgoing) h(st, ctx, out2);
  const affixBonus = chars.wornAffixes(c).filter(a => a.kind === 'damage' && (a.target?.game === buster.gameId || a.target?.family === buster.family)).reduce((s, a) => s + a.value, 0);
  assert.ok(Math.abs(out2.mult - 2 * (1 + affixBonus) * (1 + B.legendaries.potencyDamage) * (1 + B.legendaries.busterDamage)) < 1e-9, 'buster +50% on top of affixes and the amulet');
  // the Croupier's Coat on a defender raises the attacker's stake
  const other = charOf(r, r.state.seats[1]); const coat = give(r, r.state.seats[1], gen.generateLegendary(st, 'croupierscoat', { seed: 6 })); equip(st, ctx, other, coat, 'torso');
  const stakeInfo = { attackerId: c.id, targetId: other.id, targetKind: 'character', item: c.worn.mainhand, gameId: c.worn.mainhand.gameId, kind: 'attack', stake: 10, mult: 1, flat: 0, notes: [] };
  for (const h of hooks.damageHooks.stake) h(st, ctx, stakeInfo); assert.equal(stakeInfo.stake, B.legendaries.coatMinStake);
  // the mantle opens the cape slot and gives Grit; nothing else fits the cape
  const mantle = give(r, pid, gen.generateLegendary(st, 'infernalmantle', { seed: 7 })); equip(st, ctx, c, mantle, 'cape'); assert.equal(c.worn.cape.id, mantle.id); assert.ok(c.passives.calderaImmune);
  assert.equal(effectiveStats(st, c).grit, Math.min(B.stats.max, base.grit + B.legendaries.potencyStats + B.legendaries.mantleGrit));
  assert.throws(() => equip(st, ctx, c, give(r, pid, gen.makeGear(st, 'torso', { seed: 8 })), 'cape'), /does not go in cape/);
  // the snare catches a weak monster as a pet
  const m = stubMonster(r, { health: 100 }); m.health = 10; stubFight(r, pid); const snare = give(r, pid, gen.generateLegendary(st, 'tamersnare', { seed: 9 }));
  const petsBefore = c.pets.length; hooks.legendaryEffects.tamersnare.onUse(st, ctx, c, { monsterId: 'm1' }, snare);
  assert.equal(c.pets.length, petsBefore + 1); assert.ok(m.dead && m.caught); assert.ok(!c.items[snare.id]); assert.ok(st.fight.done);
  m.health = 50; m.dead = false; assert.throws(() => hooks.legendaryEffects.tamersnare.onUse(st, ctx, c, { monsterId: 'm1' }, null), /not weak enough/);
});
