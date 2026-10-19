// Characters: shape, class bonus, XP curve and level-ups, stat points, level loss, effective stats, set
// bookkeeping, passives, titles, the levelHooks.onXp consumer, and the sprite layer model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chars, sprites, gen, hooks, shared, playingRoom, creationRoom, charOf, give, ctxFor, clone } from './_fixtures-characters.mjs';
import { equip } from '../../packages/shared/handlers/inventory.js';
import { B } from '../../packages/shared/balance.js';

test('characters: newCharacter follows STATE.md, the class bonus moves with the class, looks are cleaned', () => {
  const st = shared.initialState({ seed: 1, code: 'CHAR' }); const ctx = { now: 5, B: (g) => shared.group(st, g) };
  const c = chars.newCharacter(st, ctx, { playerId: 'p0', name: 'Grim', look: { body: 9, skin: -1, face: 3, hair: 11, coat: 'red' }, classId: 'whale' });
  for (const k of ['id', 'playerId', 'rosterId', 'name', 'crest', 'look', 'classId', 'level', 'xp', 'statPoints', 'stats', 'health', 'maxHealth', 'shield', 'gold', 'bank', 'chips', 'pos', 'lastSafePos', 'region', 'worn', 'grid', 'items', 'pets', 'activePetId', 'dead', 'missTurns', 'deaths', 'graveyardPos', 'diedTo', 'cooldowns', 'activeUses', 'effects', 'pactIds', 'wanted', 'kills', 'titles', 'quests', 'usedThisTurn', 'turnsTaken', 'streak', 'freeRestakeUsed', 'freeSmokeBombs', 'buyinSpun', 'locked', 'creation']) assert.ok(k in c, `field ${k}`);
  assert.deepEqual(Object.keys(c.worn), chars.WORN_SLOTS); assert.equal(chars.WORN_SLOTS.length, 15); assert.ok(chars.WORN_SLOTS.includes('cape'));
  assert.deepEqual(c.look, { body: 2, skin: 0, face: 3, hair: 11, coat: chars.defaultLook().coat });
  assert.equal(c.maxHealth, B.health.maxAtLevel1); assert.equal(c.chips, B.creation.chips); assert.deepEqual([c.grid.cols, c.grid.rows], [B.grid.cols, B.grid.rows]);
  assert.deepEqual(c.stats, { luck: 3, nerve: 4, greed: 3, grit: 3 }, 'Whale: +1 Nerve');
  chars.setClass(st, ctx, c, 'pitboss'); assert.deepEqual(c.stats, { luck: 3, nerve: 3, greed: 3, grit: 4 }, 'the bonus moves');
  for (const def of chars.CLASSES) assert.ok(def.active?.id && def.upgrades.length === 4 && def.startWeapon, def.id);
});

test('characters: XP curve is perLevelBase × level, levels add a stat point, max Health, grid rows and class upgrades, capped at 20', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const ctx = ctxFor(r);
  const hp0 = c.maxHealth, rows0 = c.grid.rows;
  assert.equal(chars.xpToNext(1, B.xp), B.xp.perLevelBase); assert.equal(chars.xpToNext(7, B.xp), 7 * B.xp.perLevelBase);
  assert.equal(chars.giveXp(r.state, ctx, c, B.xp.perLevelBase - 1, 'test'), 0); assert.equal(c.level, 1);
  assert.equal(chars.giveXp(r.state, ctx, c, 1, 'test'), 1); assert.equal(c.level, 2); assert.equal(c.xp, 0); assert.equal(c.statPoints, B.xp.statPointsPerLevel); assert.equal(c.maxHealth, hp0 + B.health.maxPerLevel);
  // 200 + 300 + 400 → level 5: a grid row and the first class upgrade
  chars.giveXp(r.state, ctx, c, 200 + 300 + 400, 'test'); assert.equal(c.level, 5); assert.equal(c.grid.rows, rows0 + 1);
  const def = chars.classDef(c.classId); assert.ok(chars.hasUpgrade(c, def.upgrades[0].id)); assert.ok(!chars.hasUpgrade(c, def.upgrades[1].id));
  const gritBefore = c.stats.grit; assert.equal(chars.spendStatPoint(r.state, ctx, c, 'grit'), gritBefore + 1); assert.equal(c.statPoints, 3);
  assert.throws(() => { c.statPoints = 0; chars.spendStatPoint(r.state, ctx, c, 'luck'); }, /no stat points/);
  chars.giveXp(r.state, ctx, c, 1e9, 'test'); assert.equal(c.level, B.xp.levelCap); assert.equal(c.xp, 0); assert.equal(c.upgrades.length, 4); assert.equal(c.grid.rows, rows0 + 4);
  assert.equal(c.maxHealth, hp0 + (B.xp.levelCap - 1) * B.health.maxPerLevel);
  // level loss: upgrade and max Health go, an unspent point is taken
  c.statPoints = 2; chars.loseLevel(r.state, ctx, c, 1); assert.equal(c.level, 19); assert.equal(c.statPoints, 1); assert.equal(c.upgrades.length, 3); assert.equal(c.grid.rows, rows0 + 3, 'the empty row is taken back');
  // the onXp hook list is how other modules award XP
  const lvl = c.level; for (const h of hooks.levelHooks.onXp) h(r.state, ctx, { charId: c.id, amount: 19 * B.xp.perLevelBase, why: 'boss' }); assert.equal(c.level, lvl + 1);
  const onLevel = []; hooks.levelHooks.onLevel.push((s, x, info) => onLevel.push(info.level)); chars.giveXp(r.state, ctx, c, 1e6, 'test'); assert.ok(onLevel.length === 0 && c.level === 20);
  // a Studious necklace boosts XP
  const c2 = charOf(r, r.state.seats[1]); const neck = give(r, r.state.seats[1], gen.makeGear(r.state, 'necklace', { rarity: 'common', seed: 6, baseId: 'chip_chain' }));
  neck.affixes = [{ id: 'studious', kind: 'economy', effect: 'xp', target: null, value: 0.5, text: '+50% XP' }]; equip(r.state, ctx, c2, neck, 'necklace');
  chars.giveXp(r.state, ctx, c2, 60, 'test'); assert.equal(c2.xp, 90);
});

test('characters: effective stats add set pieces and the amulet, clamp to the range; sets and passives recompute on worn changes', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const ctx = ctxFor(r); const st = r.state;
  const base = { ...c.stats };
  for (const slot of ['helmet', 'torso', 'pants', 'boots']) equip(st, ctx, c, give(r, pid, gen.makeSetPiece(st, 'gem', slot, { seed: 1 })), slot);
  assert.deepEqual(c.setBonuses, { gem: { pieces: 4, complete: true } }); assert.ok(chars.hasSetBonus(c, 'gem')); assert.deepEqual(c.passives.sets, ['gem']);
  assert.equal(chars.effectiveStats(st, c).grit, Math.min(B.stats.max, base.grit + 4 * B.sets.gemGrit));
  equip(st, ctx, c, give(r, pid, gen.makeSetPiece(st, 'hide', 'helmet', { seed: 2 })), 'helmet');
  assert.equal(c.setBonuses.gem.pieces, 3); assert.ok(!c.setBonuses.gem.complete); assert.equal(c.setBonuses.hide.pieces, 1);
  for (const slot of ['torso', 'pants', 'boots']) equip(st, ctx, c, give(r, pid, gen.makeSetPiece(st, 'hide', slot, { seed: 3 })), slot);
  assert.equal(c.passives.moveBonus, B.sets.hideMove, 'Hide four-piece: movement +1');
  const helm = give(r, pid, gen.makeGear(st, 'helmet', { rarity: 'rare', seed: 4 })); helm.affixes = [{ id: 'nerveseconds', kind: 'utility', effect: 'nerveSeconds', target: null, value: 5, text: '' }, { id: 'quick', kind: 'tempo', target: null, value: 2, text: '' }];
  equip(st, ctx, c, helm, 'helmet'); assert.equal(c.passives.clockSeconds, 5); assert.equal(c.passives.tempo, 2); assert.equal(c.passives.reach, B.items.reachDefault);
  const hp = c.maxHealth; const torso = give(r, pid, gen.makeGear(st, 'torso', { rarity: 'rare', seed: 5 })); torso.affixes = [{ id: 'stout', kind: 'utility', effect: 'maxHealth', target: null, value: 10, text: '' }];
  equip(st, ctx, c, torso, 'torso'); assert.equal(c.maxHealth, hp + 10, 'torso utility adds max Health while worn');
  r.append('GRID_UNEQUIP', { slot: 'torso' }, pid); assert.equal(c.maxHealth, hp);
  c.upgrades.push('longarm'); chars.recomputePassives(st, ctx, c); assert.equal(c.passives.reach, B.items.reachLongArm);
});

test('characters: titles come from the recap counters and stick', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const ctx = ctxFor(r); const s = r.state.stats[pid];
  assert.ok(chars.TITLES.length >= 8);
  assert.deepEqual(chars.titleCheck(r.state, ctx, c), []);
  s.bosses = B.xp.titleBosses; s.kills = B.xp.titleKills; s.crits = B.xp.titleCrits; assert.deepEqual(chars.titleCheck(r.state, ctx, c).sort(), ['Dragon Slayer', 'Headhunter', 'Sharpshooter']);
  s.turns = B.xp.titleTurns; assert.deepEqual(chars.titleCheck(r.state, ctx, c), ['Undying']);
  s.deaths = 1; s.damageDealt = B.xp.titleDamage; assert.deepEqual(chars.titleCheck(r.state, ctx, c), ['Glass Cannon']); assert.ok(c.titles.includes('Undying'), 'earned titles stay');
  s.petsCaught = B.xp.titlePets; s.goldEarned = B.xp.titleGold; s.challengesWon = B.xp.titleChallenges; s.damageTaken = B.xp.titleDamage; s.deaths = B.xp.titleDeaths;
  chars.giveXp(r.state, ctx, c, 1, 'tick'); for (const t of ['Tamer', 'Tycoon', 'Duelist', 'Punching Bag', 'Lazarus']) assert.ok(c.titles.includes(t), t);
  assert.equal(c.titles.length, 10);
});

test('sprites: layersFor is ordered by z, uses the key scheme, shows class outfit where slots are empty, and tells the lantern', () => {
  const r = playingRoom(); const pid = r.state.seats[0]; const c = charOf(r, pid); const ctx = ctxFor(r); const st = r.state;
  const layers = sprites.layersFor(c, B.health);
  for (let i = 1; i < layers.length; i++) assert.ok(layers[i].z >= layers[i - 1].z, 'sorted by z');
  const keys = layers.map(l => l.key);
  assert.ok(keys.includes(`body/${c.look.body}_${c.look.skin}`)); assert.ok(keys.includes(`face/${c.look.face}`)); assert.ok(keys.includes(`hair/${c.look.hair}`));
  assert.equal(layers.filter(l => l.key === `outfit/${c.classId}`).length, 3, 'pants, boots, torso fall back to the class outfit');
  assert.ok(keys.includes('lantern/high')); assert.ok(layers.find(l => l.slot === 'mainhand' || l.slot === 'spell'), 'the starting weapon is drawn');
  equip(st, ctx, c, give(r, pid, gen.makeGear(st, 'helmet', { rarity: 'epic', seed: 1 })), 'helmet');
  const l2 = sprites.layersFor(c, B.health); assert.ok(!l2.some(l => l.key.startsWith('hair/')), 'a helmet hides the hair'); assert.equal(l2.find(l => l.slot === 'helmet').trim, 'gold');
  equip(st, ctx, c, give(r, pid, gen.generateLegendary(st, 'infernalmantle', { seed: 1 })), 'cape');
  const cape = sprites.layersFor(c, B.health).find(l => l.slot === 'cape'); assert.equal(cape.key, 'legendary/infernalmantle'); assert.ok(cape.burning); assert.equal(cape.z, sprites.Z.cape);
  c.health = Math.floor(c.maxHealth * 0.2); assert.equal(sprites.lanternKey(c, B.health), 'lantern/low'); c.dead = true; assert.equal(sprites.lanternKey(c, B.health), 'lantern/dead'); c.dead = false;
  assert.deepEqual(sprites.POSES, { idle: 4, attack: 6, hit: 2, death: 6, step: 4 }); assert.deepEqual(sprites.FRAME, { w: 64, h: 96 });
  assert.equal(sprites.petTokenKey({ speciesId: 'gloomcat', stage: 2 }), 'pet/gloomcat_2'); assert.equal(sprites.itemSpriteKey(gen.makeConsumable(st, 'potion')), 'item/potion');
  const all = sprites.allBaseKeys({ classIds: chars.CLASS_IDS, legendaryIds: gen.LEGENDARIES.map(l => l.id), speciesIds: ['gloomcat'] }); assert.ok(all.includes('outfit/whale') && all.includes('legendary/thejoker') && all.includes('pet/gloomcat_1') && all.includes('body/2_3'));
  const tok = sprites.tokenFor(c, B.health); assert.ok(tok.layers.length && tok.crest.startsWith('crest/'));
  // a page reload keeps the layer model identical
  assert.deepEqual(sprites.layersFor(clone(c), B.health), sprites.layersFor(c, B.health));
});
