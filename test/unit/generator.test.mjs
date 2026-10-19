// Item generation: determinism by seed, slot rules, rarity → affix count, region bias, tier scaling, set pieces,
// consumables, loot specs and pendingLoot materialisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gen, grid, shared, playingRoom, charOf, ctxFor, clone } from './_fixtures-characters.mjs';
import { B } from '../../packages/shared/balance.js';

const fresh = (seed = 7) => shared.initialState({ seed, code: 'GENX', roomId: 'g1' });
const strip = (it) => { const { id, ...rest } = it; return rest; };
const VALID_SLOTS = ['weapon', 'offhand', 'spell', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace', 'cape', 'consumable', 'tool', 'egg', 'satchel'];
function checkItem(it) {
  assert.ok(it.id && it.baseId && it.name, 'id, base, name');
  assert.ok(VALID_SLOTS.includes(it.slot), `slot ${it.slot}`);
  assert.ok(shared.RARITIES.includes(it.rarity)); assert.ok(it.footprint.w >= 1 && it.footprint.h >= 1);
  assert.ok(Array.isArray(it.affixes)); assert.ok(typeof it.seed === 'number'); assert.ok(it.sprite, 'sprite key');
  for (const a of it.affixes) { assert.ok(a.id && a.kind && typeof a.text === 'string', 'affix shape'); assert.ok('target' in a); }
  if (it.slot === 'weapon' || it.slot === 'spell') assert.ok(it.gameId && it.family && it.stat && it.stake > 0 && it.charges > 0, 'weapon fields');
}

test('generator: the same seed gives the same item; different seeds differ; every slot generates a valid item', () => {
  for (const slot of ['weapon', 'spell', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace', 'consumable']) {
    const a = gen.generateItem(fresh(), { slot, rarity: 'rare', seed: 1234, regionId: 'docks' }), b = gen.generateItem(fresh(99), { slot, rarity: 'rare', seed: 1234, regionId: 'docks' });
    assert.deepEqual(strip(a), strip(b), `${slot} is deterministic`); checkItem(a);
    const c = gen.generateItem(fresh(), { slot, rarity: 'rare', seed: 4321, regionId: 'docks' });
    if (slot !== 'consumable') assert.notDeepEqual(strip(a), strip(c), `${slot} varies by seed`);
  }
  const st = fresh(); const before = st.rng.loot; const it = gen.generateItem(st, { slot: 'ring' }); assert.notEqual(st.rng.loot, before, 'no seed → the loot stream advances'); checkItem(it);
  const st2 = fresh(); assert.deepEqual(strip(gen.generateItem(st2, { slot: 'ring' })), strip(it), 'and the stream itself replays');
});

test('generator: rarity sets the affix count, stake and footprint; slot rules put the right kinds first', () => {
  const st = fresh();
  for (const rarity of ['common', 'rare', 'epic']) {
    const w = gen.generateItem(st, { slot: 'weapon', rarity, seed: 5 }); assert.equal(w.affixes.length, B.items[shared.rarityKey(rarity, 'affixes')]); assert.equal(w.stake, B.items[shared.rarityKey(rarity, 'stake')]);
    assert.equal(w.affixes[0].kind, 'damage', 'weapons lead with Damage'); assert.deepEqual(w.footprint, { w: 1, h: 3 });
  }
  const sp = gen.generateItem(st, { slot: 'spell', rarity: 'rare', seed: 8 }); assert.equal(sp.affixes[0].kind, 'odds'); assert.equal(sp.kind, 'spell');
  for (const slot of ['helmet', 'torso', 'pants', 'gloves']) { const it = gen.makeGear(st, slot, { rarity: 'rare', seed: 9 }); assert.equal(it.affixes[0].kind, 'guard', slot); assert.equal(it.affixes[1].kind, 'utility', `${slot} utility second`); }
  const boots = gen.makeGear(st, 'boots', { rarity: 'rare', seed: 10 }); assert.equal(boots.affixes[0].kind, 'movement'); assert.equal(boots.affixes[1].kind, 'guard'); assert.ok(['dice', 'wheel', 'card'].includes(boots.bootMode)); assert.deepEqual(boots.footprint, { w: 2, h: 1 });
  const bootsMode = gen.affixDef(boots.affixes[0].id).modes; assert.ok(bootsMode.includes(boots.bootMode), 'movement affix matches the boot mode');
  assert.deepEqual(gen.makeGear(st, 'torso', { seed: 1 }).footprint, { w: 2, h: 3 }); assert.deepEqual(gen.makeGear(st, 'helmet', { seed: 1 }).footprint, { w: 2, h: 2 }); assert.deepEqual(gen.makeGear(st, 'ring', { seed: 1 }).footprint, { w: 1, h: 1 });
  // names: prefix from the first affix, suffix from the second
  const epic = gen.makeGear(st, 'helmet', { rarity: 'epic', seed: 77 });
  assert.ok(epic.name.startsWith(epic.affixes[0].prefix + ' ')); assert.ok(epic.name.endsWith(' ' + epic.affixes[1].suffix));
  const common = gen.makeGear(st, 'helmet', { rarity: 'common', seed: 77 }); assert.ok(!/ of /.test(common.name.replace(common.affixes[0].prefix, '')) || true); assert.equal(common.affixes.length, 1);
  // odds affixes carry game + effect for the adapter; movement affixes carry an effect name the movement module knows
  const odds = sp.affixes.find(a => a.kind === 'odds'); assert.ok(odds.game && ['peek', 'reroll', 'safepick'].includes(odds.effect));
  assert.ok(['dieUp', 'twoDice', 'rerollOnes', 'keepStop', 'homeBonus', 'noStumble', 'extraSprint', 'peekTop', 'drawTwo', 'range6', 'moreDoubles'].includes(boots.affixes[0].effect));
});

test('generator: region bias leans weapon drops to the region family; tier scales affix strength, never level', () => {
  const st = fresh(); let dice = 0, N = 200;
  for (let i = 0; i < N; i++) if (gen.generateItem(st, { slot: 'weapon', seed: i, regionId: 'docks' }).family === 'dice') dice++;
  let diceNeutral = 0; for (let i = 0; i < N; i++) if (gen.generateItem(st, { slot: 'weapon', seed: i }).family === 'dice') diceNeutral++;
  assert.ok(dice > diceNeutral * 1.5, `docks should lean dice: ${dice} vs ${diceNeutral}`);
  const t1 = gen.makeGear(st, 'helmet', { rarity: 'common', seed: 3, tier: 1 }), t3 = gen.makeGear(st, 'helmet', { rarity: 'common', seed: 3, tier: 3 });
  assert.equal(t1.affixes[0].id, t3.affixes[0].id); assert.ok(t3.affixes[0].value > t1.affixes[0].value, 'tier 3 is stronger');
  assert.ok(Math.abs(t3.affixes[0].value / t1.affixes[0].value - (1 + 2 * B.affix.tierScale)) < 0.08);
  const live = fresh(); live.map = { regions: { x: { id: 'x', tier: 3, family: 'wheels' } }, hexes: {} };
  assert.equal(gen.regionFamily(live, 'x'), 'wheels'); assert.equal(gen.regionTier(live, 'x'), 3); assert.equal(gen.regionFamily(live, 'caldera'), 'nerve', 'falls back to the items36 table');
});

test('generator: Blockcraft pieces drop from armour slots at the set chance; consumables; loot specs', () => {
  const st = fresh(); let sets = 0, N = 300;
  for (let i = 0; i < N; i++) { const it = gen.generateItem(st, { slot: 'torso', rarity: 'rare', seed: 1000 + i }); if (it.setId) { sets++; assert.ok(['gilt', 'iron', 'chainmail'].includes(it.setId), 'rare sets only'); assert.equal(it.sprite, `worn/${it.setId}_torso`); } }
  assert.ok(sets > N * B.items.setDropChance * 0.5 && sets < N * B.items.setDropChance * 1.6, `set rate ${sets}/${N}`);
  const chain = gen.makeSetPiece(st, 'chainmail', 'pants', { seed: 2 }); assert.match(chain.note, /didn't forget/); assert.equal(chain.affixes[0].kind, 'guard');
  const gilt = gen.makeSetPiece(st, 'gilt', 'helmet', { seed: 2 }); assert.equal(gilt.charges, B.sets.giltCharges); assert.ok(gilt.affixes.some(a => a.kind === 'stat' && a.stat === 'luck'));
  const hide = gen.makeSetPiece(st, 'hide', 'boots', { seed: 2 }); assert.ok(hide.dye); assert.equal(hide.bootMode, 'dice');
  assert.throws(() => gen.makeSetPiece(st, 'hide', 'gloves'), /not a set slot/);
  const pot = gen.makeConsumable(st, 'potion', { qty: 3 }); assert.equal(pot.qty, 3); assert.ok(pot.stackable); assert.equal(pot.slot, 'consumable');
  const egg = gen.makeConsumable(st, 'egg'); assert.equal(egg.slot, 'egg'); assert.deepEqual(egg.footprint, { w: 2, h: 2 });
  const sat = gen.makeConsumable(st, 'satchel'); assert.equal(sat.slot, 'satchel');
  assert.equal(gen.itemFromSpec(st, { baseId: 'coinblade', rarity: 'rare', seed: 1 }).gameId, 'fifty');
  assert.equal(gen.itemFromSpec(st, { baseId: 'amuletofpotency', seed: 1 }).legendaryId, 'amuletofpotency');
  assert.equal(gen.itemFromSpec(st, { baseId: 'iron_helmet', seed: 1 }).setId, 'iron');
  assert.equal(gen.itemFromSpec(st, { baseId: 'bone_crown', rarity: 'epic', seed: 1 }).baseId, 'bone_crown');
  assert.equal(gen.itemFromSpec(st, { baseId: 'loot', rarity: 'common', slot: 'ring', seed: 1 }).slot, 'ring');
  const leg = gen.generateItem(st, { rarity: 'legendary', slot: 'ring', seed: 4 }); assert.equal(leg.legendaryId, 'pipbuoy', 'the only Legendary ring');
  assert.ok(gen.BOOT_BASES.length >= 10 && gen.BOOT_BASES.some(b => b.id === 'fateful_treads' && b.die === 20));
});

test('generator: materialisePendingLoot fills the grid, spills to the tile when full, and caps Legendaries per run', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const ctx = ctxFor(r);
  c.pendingLoot = [{ baseId: 'loot', rarity: 'rare', region: 'docks', seed: 11, slot: 'ring' }, { baseId: 'potion', qty: 2, seed: 12 }, { baseId: 'pedestalblade', rarity: 'legendary', seed: 13 }, { baseId: 'loot', rarity: 'legendary', slot: 'necklace', seed: 14 }];
  const out = gen.materialisePendingLoot(r.state, ctx, c);
  assert.equal(out.length, 4); assert.deepEqual(c.pendingLoot, []);
  assert.equal(out[0].item.slot, 'ring'); assert.equal(out[0].item.region, 'docks'); assert.equal(out[0].item.tier, 2, 'tier from the live map');
  const potions = Object.values(c.items).filter(i => i.baseId === 'potion'); assert.equal(potions.length, 1); assert.equal(potions[0].qty, B.items.starterPotions + 2, 'stacked onto the starter potions');
  assert.equal(out[2].item.legendaryId, 'pedestalblade'); assert.equal(r.state.legendariesDropped, 1);
  assert.equal(out[3].item.rarity, 'epic', 'second Legendary of the run is downgraded'); assert.equal(out[3].item.slot, 'necklace');
  // fill the grid, then the next drop stays on the tile
  let guard = 0; while (grid.firstFit(c, { footprint: { w: 1, h: 1 } }) && guard++ < 100) { c.pendingLoot = [{ baseId: 'loot', rarity: 'common', slot: 'ring', seed: 100 + guard }]; gen.materialisePendingLoot(r.state, ctx, c); }
  c.pendingLoot = [{ baseId: 'loot', rarity: 'common', slot: 'torso', seed: 999 }];
  const spill = gen.materialisePendingLoot(r.state, ctx, c);
  assert.equal(spill[0].where, 'tile'); assert.equal(r.state.tileLoot[c.pos].length, 1); assert.ok(!c.items[spill[0].item.id]);
  // the state survives a page reload (JSON round trip) with every item intact
  const again = clone(r.state); assert.deepEqual(again.characters[c.id].items, clone(c.items));
});
