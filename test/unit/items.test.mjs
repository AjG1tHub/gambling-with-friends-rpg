// Items: definitions and the factory; ITEM_USE / ITEM_STEP / ITEM_RESOLVE through the reducer; the payoff maths
// (win, loss, push, crit, rarity bonus, heal, shield, pet redirect, Grit, class passives, Double Down, Phoenix);
// the Area window; consumables; class actives and cooldowns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playingRoom, mkCharacter, mkMonster, mkPet, give, hit, makeItem, makeConsumable, starterKit, B, shared } from './_fixtures.mjs';
import { ITEMS, ITEM_DEFS, byGame, GAME_IDS, CLASSES, isTwoHand } from '../../packages/games/items.js';
import { inReach, effectiveStake, resolveHit, useActive, isWeaponOrSpell } from '../../packages/shared/handlers/items.js';
import { damageHooks, deathHooks, petHooks, levelHooks, consumables, classActives } from '../../packages/shared/hooks.js';

const { hex } = shared;
const last = (r) => r.state.log.at(-1).text;
const ledgerKinds = (r) => r.state.ledger.map(x => x.kind);
const err = (r, type, payload, actor) => { const e = r.try(type, payload, actor); assert.ok(e, `${type} should have been refused`); return e; };
// With the whole game registered, every character's Grit cuts damage taken by health.gritReducePerPoint a point
// (handlers/inventory.js), applied to the multiplier before the single rounding in resolveHit. `taken(c, raw)` is
// what a hit worth `raw` (stake × (mult − 1) × class and rarity bonuses) costs character `c`.
const gritMult = (c) => 1 - c.stats.grit * B.health.gritReducePerPoint;
const taken = (c, raw) => Math.round(raw * gritMult(c));

test('items36: 36 definitions, one per game, four kinds, five families, every one with a lever line; byGame mirrors ITEMS', () => {
  assert.equal(ITEM_DEFS.length, 36); assert.equal(Object.keys(ITEMS).length, 36); assert.equal(Object.keys(byGame).length, 36);
  const kinds = { attack: 0, spell: 0, area: 0, versus: 0 };
  for (const d of ITEM_DEFS) { kinds[d.kind]++; assert.ok(['dice', 'cards', 'wheels', 'nerve', 'picks'].includes(d.family), d.id); assert.ok(d.lever.length > 5, d.id); assert.equal(byGame[d.gameId], d); if (d.kind === 'spell') assert.ok(['heal', 'shield'].includes(d.spellEffect), d.id); }
  assert.deepEqual(kinds, { attack: 25, spell: 5, area: 2, versus: 4 });
  for (const c of Object.values(CLASSES)) assert.ok(ITEMS[c.startWeapon], `${c.id} start weapon`);
});
test('makeItem builds the STATE.md Item shape: stake by rarity, charges, footprint 1×3 / 2×4, sprite key, deterministic id by seed', () => {
  const it = makeItem(null, { baseId: 'coinblade', rarity: 'common', seed: 5 });
  assert.equal(it.baseId, 'coinblade'); assert.equal(it.gameId, 'fifty'); assert.equal(it.slot, 'weapon'); assert.equal(it.kind, 'attack'); assert.equal(it.family, 'wheels'); assert.equal(it.stat, 'luck');
  assert.equal(it.stake, B.items.stakeCommon); assert.equal(it.charges, B.items.charges); assert.deepEqual(it.footprint, { w: 1, h: 3 }); assert.equal(it.twoHand, false); assert.equal(it.sprite, 'items/coinblade'); assert.equal(it.seed, 5);
  for (const [rar, key] of [['rare', 'stakeRare'], ['epic', 'stakeEpic'], ['legendary', 'stakeLegendary']]) assert.equal(makeItem(null, { gameId: 'dice', rarity: rar }).stake, B.items[key]);
  const big = makeItem(null, { gameId: 'bigwheel' }); assert.ok(big.twoHand && isTwoHand('bigwheel')); assert.deepEqual(big.footprint, { w: 2, h: 4 });
  const spell = makeItem(null, { baseId: 'ward' }); assert.equal(spell.slot, 'spell'); assert.equal(spell.spellEffect, 'shield'); assert.equal(makeItem(null, { baseId: 'mend' }).spellEffect, 'heal');
  assert.notEqual(makeItem(null, { baseId: 'coinblade', seed: 5 }).id, it.id, 'ids are unique even with the same seed');
  assert.ok(makeItem(null, { baseId: 'coinblade', seed: 5 }).id.startsWith('coinblade-5-'));
  assert.throws(() => makeItem(null, { baseId: 'nope' }));
  const state = { balance: { items: { stakeCommon: 12 } } }; assert.equal(makeItem(state, { baseId: 'coinblade' }).stake, 12, 'room overrides apply');
  for (const id of GAME_IDS) assert.ok(isWeaponOrSpell(makeItem(null, { gameId: id })));
  const potion = makeConsumable(null, 'potion', 2); assert.equal(potion.slot, 'consumable'); assert.ok(potion.stackable && potion.qty === 2); assert.deepEqual(potion.footprint, { w: 1, h: 1 }); assert.ok(!isWeaponOrSpell(potion));
});
test('starterKit: Coin Blade, Loaded Dice, Mend, the class weapon and the Potions, all Common', () => {
  for (const cls of Object.values(CLASSES)) {
    const kit = starterKit(null, cls.id, 3);
    const bases = kit.map(i => i.baseId);
    assert.deepEqual(bases.slice(0, 3), ['coinblade', 'loadeddice', 'mend']); assert.equal(bases[3], cls.startWeapon); assert.equal(kit.at(-1).baseId, 'potion'); assert.equal(kit.at(-1).qty, B.items.starterPotions);
    assert.ok(kit.every(i => i.rarity === 'common')); assert.equal(kit.length, 5);
  }
});

test('ITEM_USE: refusals — unknown item, no charges, stake over Health, not your turn, a consumable, an Area item, a second attack, a dead target', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar(), other = r.char(r.cur() === 'p0' ? 1 : 0);
  const blade = r.itemOf(c, 'coinblade');
  err(r, 'ITEM_USE', { itemId: 'nope', targetId: other.id }, pid);
  err(r, 'ITEM_USE', { itemId: r.itemOf(c, 'potion').id, targetId: other.id }, pid);
  const notMe = Object.keys(r.state.players).find(p => p !== pid); err(r, 'ITEM_USE', { itemId: blade.id, targetId: other.id }, notMe);
  blade.charges = 0; err(r, 'ITEM_USE', { itemId: blade.id, targetId: other.id }, pid); blade.charges = 5;
  c.health = 5; assert.match(err(r, 'ITEM_USE', { itemId: blade.id, targetId: other.id }, pid).message, /exceeds/); c.health = 100;
  const area = give(c, makeItem(r.state, { baseId: 'roulettestorm' })); assert.match(err(r, 'ITEM_USE', { itemId: area.id }, pid).message, /AREA_OPEN/);
  other.dead = true; err(r, 'ITEM_USE', { itemId: blade.id, targetId: other.id }, pid); other.dead = false;
  err(r, 'ITEM_USE', { itemId: blade.id, targetId: c.id }, pid);                                  // not yourself
  r.append('ITEM_USE', { itemId: blade.id, targetId: other.id }, pid);
  assert.ok(r.state.fight && r.state.fight.kind === 'solo' && r.state.fight.game.itemId === blade.id);
  assert.match(err(r, 'ITEM_USE', { itemId: r.itemOf(c, 'loadeddice').id, targetId: other.id }, pid).message, /finish the round/);
  r.append('ITEM_RESOLVE', { mult: 0, label: 'LOSE' }, pid);
  assert.match(err(r, 'ITEM_USE', { itemId: r.itemOf(c, 'loadeddice').id, targetId: other.id }, pid).message, /one attack/);
  // a spell still goes (one attack + one spell per turn), and a second spell does not
  const mend = r.itemOf(c, 'mend'); r.append('ITEM_USE', { itemId: mend.id }, pid); assert.equal(r.state.fight.game.targetKind, 'self'); r.append('ITEM_RESOLVE', { mult: 2, label: 'heal' }, pid);
  assert.match(err(r, 'ITEM_USE', { itemId: mend.id }, pid).message, /one spell/);
  // an item lying outside the grid and not worn cannot be used
  const loose = makeItem(r.state, { baseId: 'coinblade' }); c.items[loose.id] = loose; err(r, 'ITEM_USE', { itemId: loose.id, targetId: other.id }, pid);
  // ITEM_STEP / ITEM_RESOLVE need an open round; a stranger cannot step it
  err(r, 'ITEM_RESOLVE', { mult: 2 }, pid); err(r, 'ITEM_STEP', { game: {} }, pid);
});
test('ITEM_STEP stores a secret-free snapshot; ITEM_RESOLVE validates the multiplier and consumes a charge; the TV never sees hidden picks', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar(), other = r.char(pid === 'p0' ? 1 : 0), blade = r.itemOf(c, 'coinblade');
  r.append('ITEM_USE', { itemId: blade.id, targetId: other.id }, pid);
  const notMe = Object.keys(r.state.players).find(p => p !== pid);
  err(r, 'ITEM_STEP', { game: { phase: 'running' } }, notMe);
  r.append('ITEM_STEP', { game: { id: 'mines', phase: 'running', view: { revealed: [3], nested: { secret: { mines: [1] } } }, secret: { mines: [1, 2, 3] }, pending: null }, text: 'Safe.' }, pid);
  const g = r.state.fight.game; assert.ok(!JSON.stringify(g).includes('secret')); assert.equal(g.phase, 'running'); assert.deepEqual(g.view.revealed, [3]); assert.equal(g.lastText, 'Safe.');
  err(r, 'ITEM_RESOLVE', { mult: 'x' }, pid); err(r, 'ITEM_RESOLVE', { mult: 99999 }, pid); err(r, 'ITEM_RESOLVE', { mult: 2 }, notMe);
  const before = other.health; r.append('ITEM_RESOLVE', { mult: 2, label: 'WIN', game: { secret: { x: 1 }, phase: 'done' } }, pid);
  const d = taken(other, 10);
  assert.equal(other.health, before - d); assert.equal(blade.charges, B.items.charges - 1); assert.equal(r.state.fight.game, null); assert.ok(r.state.fight.done && r.state.fight.lastGame.result.damage === d);
  assert.ok(!JSON.stringify(r.state.fight.lastGame).includes('secret'));
  err(r, 'ITEM_RESOLVE', { mult: 2 }, pid);
});

test('payoff maths: win = stake × (mult − 1) × (1 + rarity bonus); loss = stake × (1 − mult) off the attacker (shields do not absorb it); push nothing; crit counts', () => {
  const r = playingRoom({ chars: [{ classId: 'cutpurse' }, { classId: 'cutpurse' }, { classId: 'cutpurse' }, { classId: 'cutpurse' }] });
  const pid = r.cur(), c = r.curChar(), t = r.char(pid === 'p0' ? 1 : 0);
  const epic = give(c, makeItem(r.state, { baseId: 'wheelofruin', rarity: 'epic' })), stats = r.state.stats[pid];
  hit(r, { pid, itemId: epic.id, targetId: t.id, mult: 3, label: '3×' });
  const d1 = taken(t, 35 * 2 * (1 + B.items.bonusEpic)); assert.equal(d1, Math.round(88 * gritMult(t)), 'epic bonus on a 35 stake');
  assert.equal(t.health, 100 - d1); assert.equal(stats.hits, 1); assert.equal(stats.damageDealt, d1); assert.equal(c.xp, B.xp.hit); assert.equal(c.streak, 1);
  r.append('TURN_END', {}, pid);
  // next player: a loss costs the stake fraction, even through a shield; a push moves nothing
  const pid2 = r.cur(), c2 = r.curChar(), t2 = r.char(pid2 === 'p0' ? 1 : 0); c2.shield = 50; const h0 = c2.health;
  const rare = give(c2, makeItem(r.state, { baseId: 'coinblade', rarity: 'rare' }));
  hit(r, { pid: pid2, itemId: rare.id, targetId: t2.id, mult: 0.5, label: 'half' });
  assert.equal(c2.health, h0 - 10); assert.equal(c2.shield, 50); assert.equal(c2.streak, 0); assert.equal(r.state.stats[pid2].damageTaken, 10);
  const mend = r.itemOf(c2, 'mend'); r.append('ITEM_USE', { itemId: mend.id }, pid2); r.append('ITEM_RESOLVE', { mult: 1, label: 'push' }, pid2);
  assert.equal(c2.health, h0 - 10); assert.match(last(r), /push/);
  r.append('TURN_END', {}, pid2);
  // a crit: +crit XP and the crits counter
  const pid3 = r.cur(), c3 = r.curChar(), t3 = r.char(pid3 === 'p0' ? 1 : 0);
  hit(r, { pid: pid3, itemId: r.itemOf(c3, 'coinblade').id, targetId: t3.id, mult: 2, label: 'WIN', crit: true });
  assert.equal(r.state.stats[pid3].crits, 1); assert.equal(c3.xp, B.xp.hit + B.xp.crit); assert.equal(ledgerKinds(r).filter(k => k === 'health').length >= 3, true);
});
test('spells heal or shield the caster or an ally for the payout and fizzle at the caster\'s cost; a Ward shield absorbs the next hit first', () => {
  const r = playingRoom({ chars: [{ classId: 'pitboss' }, { classId: 'pitboss' }, { classId: 'pitboss' }, { classId: 'pitboss' }] });
  const pid = r.cur(), c = r.curChar(); c.health = 50;
  const mend = r.itemOf(c, 'mend'); r.append('ITEM_USE', { itemId: mend.id }, pid); r.append('ITEM_RESOLVE', { mult: 3, label: 'Cashed out at 3×' }, pid);
  assert.equal(c.health, 50 + Math.round(10 * 2 * (1 + B.classes.pitBossHealBonus)), 'Pit Boss healing +50% (handlers/classes.js) rides the payout multiple'); assert.equal(c.usedThisTurn.spell, 1);
  r.append('TURN_END', {}, pid);
  const pid2 = r.cur(), c2 = r.curChar(); const ward = r.itemOf(c2, 'ward') || give(c2, makeItem(r.state, { baseId: 'ward' }), { wear: 'spell2' });
  r.append('ITEM_USE', { itemId: ward.id }, pid2); r.append('ITEM_RESOLVE', { mult: 2.5, label: 'BLACKJACK' }, pid2);
  assert.equal(c2.shield, 15); assert.equal(c2.health, 100);
  // the shield is spent before Health when someone hits them
  const blade = r.itemOf(c2, 'coinblade'); const victim = r.char(pid2 === 'p0' ? 1 : 0);
  hit(r, { pid: pid2, itemId: blade.id, targetId: victim.id, mult: 2 }); r.append('TURN_END', {}, pid2);
  let guard = 0; while (r.cur() !== victim.playerId && guard++ < 8) r.append('TURN_END', {}, r.cur());
  hit(r, { pid: victim.playerId, itemId: r.itemOf(victim, 'coinblade').id, targetId: c2.id, mult: 3 });
  assert.equal(c2.shield, 0); assert.equal(c2.health, 100 - (taken(c2, 20) - 15), 'the 15 shield goes first, the rest comes off Health');
  // an ally may be the spell's target; a stranger may not; a fizzle costs the caster. (An alliance rather than a
  // team: modes.js's friendly-fire cancel does not exempt spells yet, so a team-mate's heal would be voided.)
  const r2 = playingRoom(); r2.state.alliances.push({ id: 'al1', active: true, members: ['p0', 'p1'] });
  guard = 0; while (r2.cur() !== 'p0' && guard++ < 8) r2.append('TURN_END', {}, r2.cur());
  const c0 = r2.char(0), c1 = r2.char(1); c1.health = 40;
  err(r2, 'ITEM_USE', { itemId: r2.itemOf(c0, 'mend').id, targetId: 'c2' }, 'p0');
  r2.append('ITEM_USE', { itemId: r2.itemOf(c0, 'mend').id, targetId: c1.id }, 'p0'); r2.append('ITEM_RESOLVE', { mult: 2, label: 'heal' }, 'p0'); assert.equal(c1.health, 50);
  r2.append('TURN_END', {}, 'p0'); guard = 0; while (r2.cur() !== 'p1' && guard++ < 8) r2.append('TURN_END', {}, r2.cur());
  r2.append('ITEM_USE', { itemId: r2.itemOf(c1, 'mend').id }, 'p1'); r2.append('ITEM_RESOLVE', { mult: 0, label: 'bust' }, 'p1'); assert.equal(c1.health, 40);
});
test('pets fight first: a pet hook may redirect a hit to the pet\'s Power; death at zero runs deathHooks.onZero and the Phoenix Feather cancels it', () => {
  const pet = mkPet({ power: 30 });
  const r = playingRoom({ chars: [{}, { pets: [pet] }, {}, {}] }); let guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
  const c0 = r.char(0), c1 = r.char(1);
  const redirect = (state, ctx, info) => { if (info.targetId === c1.id && !c1.pets[0].fainted) info.redirectToPet = c1.pets[0].id; };
  petHooks.beforeCharacterHit.push(redirect);
  const power0 = pet.power;                                   // pets.js tops Power up at RUN_START (session bonus)
  try {
    hit(r, { pid: 'p0', itemId: r.itemOf(c0, 'coinblade').id, targetId: c1.id, mult: 3 });
    assert.equal(pet.power, power0 - taken(c1, 20)); assert.equal(c1.health, 100); assert.ok(ledgerKinds(r).includes('power'));
  } finally { petHooks.beforeCharacterHit.splice(petHooks.beforeCharacterHit.indexOf(redirect), 1); }
  // death: onZero sees it; without a feather the character dies and the fight is lost
  const seen = []; const spy = (state, ctx, zi) => seen.push(zi.charId); deathHooks.onZero.push(spy);
  try {
    r.append('TURN_END', {}, 'p0'); guard = 0; while (r.cur() !== 'p2' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    const c2 = r.char(2), c3 = r.char(3); c3.health = 5; c3.effects.push({ id: 'phoenix', kind: 'flag', turnsLeft: null, data: null });
    hit(r, { pid: 'p2', itemId: r.itemOf(c2, 'coinblade').id, targetId: c3.id, mult: 2 });
    assert.equal(c3.health, 1); assert.ok(!c3.dead); assert.equal(c3.effects.length, 0); assert.deepEqual(seen, [c3.id]); assert.match(r.state.log.map(l => l.text).join('\n'), /Phoenix/);
    r.append('TURN_END', {}, 'p2'); guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    hit(r, { pid: 'p0', itemId: r.itemOf(c0, 'coinblade').id, targetId: c3.id, mult: 2 });
    assert.ok(c3.dead && c3.health === 0 && c3.diedTo === 'player' && c3.deaths === 1); assert.equal(c0.kills, 1); assert.equal(r.state.stats.p0.kills, 1); assert.equal(c0.xp, B.xp.hit * 2 + B.xp.ko);
    err(r, 'ITEM_USE', { itemId: r.itemOf(c3, 'coinblade').id, targetId: c0.id }, 'p3');
  } finally { deathHooks.onZero.splice(deathHooks.onZero.indexOf(spy), 1); }
});
test('damage pipeline: Whale +15% and a stake discount, Enforcer +25% vs players (classes.js), Greed streak, Double Down ×2 win or lose, levelHooks.onXp receives the XP', () => {
  const r = playingRoom({ chars: [{ classId: 'whale', stats: { luck: 3, nerve: 3, greed: 3, grit: 3 } }, { classId: 'enforcer', stats: { luck: 3, nerve: 3, greed: 6, grit: 3 } }, { classId: 'cutpurse', stats: { luck: 3, nerve: 3, greed: 3, grit: 8 } }, { classId: 'croupier' }] });
  let guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
  const whale = r.char(0), enforcer = r.char(1), gritty = r.char(2), croupier = r.char(3);
  const K = B.classes;
  assert.equal(effectiveStake(r.state, { B: (g) => B[g] }, whale, r.itemOf(whale, 'coinblade')), Math.round(10 * (1 - K.whaleStakeDiscount)));
  assert.equal(effectiveStake(r.state, { B: (g) => B[g] }, croupier, r.itemOf(croupier, 'mend')), Math.round(10 * (1 - K.croupierSpellDiscount)));
  assert.equal(effectiveStake(r.state, { B: (g) => B[g] }, whale, r.itemOf(whale, 'mend')), 10);
  const xps = []; const onXp = (s, ctx, info) => { xps.push(info); }; levelHooks.onXp.push(onXp);
  try {
    // Whale: stake 8 (discount), payout 8 × 1 × 1.15 = 9.2, then the target's Grit 8 guard (handlers/inventory.js)
    hit(r, { pid: 'p0', itemId: r.itemOf(whale, 'coinblade').id, targetId: gritty.id, mult: 2 });
    assert.equal(r.state.fight.lastGame.stake, 8); assert.equal(gritty.health, 100 - taken(gritty, 8 * 1 * (1 + K.whaleDamageBonus)));
    assert.deepEqual(xps.map(x => x.why), ['hit']); assert.equal(whale.xp, B.xp.hit);
    r.append('TURN_END', {}, 'p0'); guard = 0; while (r.cur() !== 'p1' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    // Enforcer vs a player: +25%; then on a streak, Greed 6 adds 3 × 5%
    hit(r, { pid: 'p1', itemId: r.itemOf(enforcer, 'coinblade').id, targetId: croupier.id, mult: 2 });
    const e1 = taken(croupier, 10 * (1 + B.challenge.enforcerPvpBonus)); assert.equal(croupier.health, 100 - e1);
    r.append('TURN_END', {}, 'p1'); guard = 0; while (r.cur() !== 'p1' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    hit(r, { pid: 'p1', itemId: r.itemOf(enforcer, 'coinblade').id, targetId: croupier.id, mult: 2 });
    assert.equal(croupier.health, 100 - e1 - taken(croupier, 10 * (1 + B.challenge.enforcerPvpBonus) * (1 + B.health.greedStreakBonus * 3)));
    // Double Down: the whale's next hit is ×2 — and a loss costs double
    r.append('TURN_END', {}, 'p1'); guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    r.append('CLASS_ACTIVE', { activeId: 'doubledown' }, 'p0'); assert.ok(whale.effects.some(e => e.id === 'doubledown')); assert.equal(whale.cooldowns.active, K.whaleCooldown);
    assert.match(err(r, 'CLASS_ACTIVE', { activeId: 'doubledown' }, 'p0').message, /armed|cooldown/);
    const h = whale.health; hit(r, { pid: 'p0', itemId: r.itemOf(whale, 'coinblade').id, targetId: croupier.id, mult: 0 });
    assert.equal(whale.health, h - 16); assert.equal(whale.effects.length, 0);
    r.append('TURN_END', {}, 'p0'); guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    assert.equal(whale.cooldowns.active, K.whaleCooldown - 1, 'cooldowns count own turns');
    assert.match(err(r, 'CLASS_ACTIVE', { activeId: 'doubledown' }, 'p0').message, /cooldown/);
    assert.match(err(r, 'CLASS_ACTIVE', { activeId: 'sleight' }, 'p0').message, /not your class|unknown/);
    whale.cooldowns.active = 0; r.append('CLASS_ACTIVE', { activeId: 'doubledown' }, 'p0'); const ch = croupier.health;
    hit(r, { pid: 'p0', itemId: r.itemOf(whale, 'coinblade').id, targetId: croupier.id, mult: 2 });
    assert.equal(croupier.health, ch - taken(croupier, 8 * (1 + K.whaleDamageBonus) * 2));
  } finally { levelHooks.onXp.splice(levelHooks.onXp.indexOf(onXp), 1); }
});
test('reach: without a map everything is in reach; with one, attacks need the target within items.reachDefault (Long Arm / Enforcer 15: reachLongArm)', () => {
  const r = playingRoom(); const state = r.state;
  state.map = null; assert.equal(inReach(state, 'c0', '5,5'), true);
  state.map = { hexes: {}, regions: {}, start: '0,0' };
  const c0 = r.char(0), c1 = r.char(1); c0.pos = '0,0'; c1.pos = '2,0';
  assert.equal(inReach(state, c0.id, c1.pos), false); c1.pos = '1,0'; assert.equal(inReach(state, c0.id, c1.pos), true);
  c1.pos = '2,0'; c0.upgrades.push('longarm'); assert.equal(inReach(state, c0.id, c1.pos), true); c0.upgrades.pop(); assert.equal(inReach(state, c0.id, c1.pos), false);
  c0.worn.ring1 = { id: 'ring', affixes: [{ id: 'longarm', kind: 'reach', value: 1 }] }; assert.equal(inReach(state, c0.id, c1.pos), true); c0.worn.ring1 = null;
  let guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
  assert.match(err(r, 'ITEM_USE', { itemId: r.itemOf(c0, 'coinblade').id, targetId: c1.id }, 'p0').message, /reach/);
  c1.pos = '1,-1'; r.append('ITEM_USE', { itemId: r.itemOf(c0, 'coinblade').id, targetId: c1.id }, 'p0');
  // Caldera doubles damage both ways: a target standing in the Caldera takes ×2
  state.map.hexes['1,-1'] = { q: 1, r: -1, key: '1,-1', regionId: 'caldera' }; state.map.regions.caldera = { id: 'caldera', name: 'The Caldera', tier: 2, family: 'nerve' };
  r.append('ITEM_RESOLVE', { mult: 2, label: 'WIN' }, 'p0'); assert.equal(c1.health, 100 - taken(c1, 10 * B.map.calderaDamageMult));
});

test('Area items: AREA_OPEN opens a window, characters on the hex stake, AREA_RESOLVE after the deadline hits every foe and never an ally', () => {
  const r = playingRoom({ mode: 'teams' }); const st = r.state; st.players.p0.teamId = 'A'; st.players.p1.teamId = 'A'; st.players.p2.teamId = 'B'; st.players.p3.teamId = 'B';
  let guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
  const c0 = r.char(0), c1 = r.char(1), c2 = r.char(2), c3 = r.char(3);
  const storm = give(c0, makeItem(st, { baseId: 'roulettestorm' }));
  err(r, 'AREA_OPEN', { itemId: r.itemOf(c0, 'coinblade').id }, 'p0');
  r.append('AREA_OPEN', { itemId: storm.id, pick: { type: 'red' } }, 'p0');
  const a = st.area; assert.ok(a && !a.done && a.deadline === r.now() + B.items.areaWindowSeconds * 1000 && a.stakes[c0.id].stake === 10);
  assert.match(err(r, 'AREA_OPEN', { itemId: storm.id }, 'p0').message, /already open|one attack/);
  r.append('AREA_STAKE', { stake: 20, pick: { type: 'black' } }, 'p2'); r.append('AREA_STAKE', { stake: 5, pick: { type: 'red' } }, 'p1');
  err(r, 'AREA_STAKE', { stake: 500 }, 'p3');
  assert.match(err(r, 'AREA_RESOLVE', { results: {} }, 'p0').message, /still open/);
  err(r, 'AREA_RESOLVE', { results: {} }, 'p2');
  r.tick(B.items.areaWindowSeconds * 1000 + 1);
  err(r, 'AREA_STAKE', { stake: 5 }, 'p3');
  r.append('AREA_RESOLVE', { results: { [c0.id]: { mult: 2, label: 'red' }, [c2.id]: { mult: 0, label: 'red' }, [c1.id]: { mult: 2, label: 'red' } } }, 'p0');
  assert.ok(st.area.done);
  // c0 (10) and ally c1 (5) hit both foes c2 and c3; c2 lost its 20 stake; c3 staked nothing and is hit by both
  assert.equal(c3.health, 100 - taken(c3, 10) - taken(c3, 5)); assert.equal(c2.health, 100 - 20 - taken(c2, 10) - taken(c2, 5)); assert.equal(c1.health, 100); assert.equal(c0.health, 100);
  const h3 = c3.health;
  assert.equal(storm.charges, B.items.charges - 1); assert.equal(st.area.results[c2.id].loss, 20);
  // a foe who wins strikes the attacker back
  r.append('TURN_END', {}, 'p0'); guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
  r.append('AREA_OPEN', { itemId: storm.id }, 'p0'); r.append('AREA_STAKE', { stake: 10 }, 'p3'); r.tick(30_000);
  r.append('AREA_RESOLVE', { results: { [c0.id]: { mult: 0, label: 'miss' }, [c3.id]: { mult: 3, label: 'hit' } } }, 'gm');
  assert.equal(c0.health, 100 - 10 - taken(c0, 20)); assert.equal(c3.health, h3, 'the winner takes nothing');
});
test('consumables: Potion heals, Nudge/Reroll/Fork record a pending choice on the open round, Smoke Bomb ends an encounter (not when called out), Phoenix Feather arms; stacks shrink and vanish', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar(), other = r.char(pid === 'p0' ? 1 : 0);
  const potion = r.itemOf(c, 'potion'); c.health = 60;
  r.append('CONSUMABLE_USE', { itemId: potion.id }, pid); assert.equal(c.health, 60 + B.health.potionHeal); assert.equal(potion.qty, B.items.starterPotions - 1);
  r.append('CONSUMABLE_USE', { itemId: potion.id }, pid); assert.ok(!c.items[potion.id] && !c.grid.cells.some(x => x.itemId === potion.id), 'the stack is gone');
  err(r, 'CONSUMABLE_USE', { itemId: potion.id }, pid);
  const nudge = give(c, makeConsumable(r.state, 'nudge')), reroll = give(c, makeConsumable(r.state, 'reroll')), fork = give(c, makeConsumable(r.state, 'fork')), feather = give(c, makeConsumable(r.state, 'phoenixfeather')), bomb = give(c, makeConsumable(r.state, 'smokebomb'));
  assert.match(err(r, 'CONSUMABLE_USE', { itemId: nudge.id }, pid).message, /no round/);
  r.append('ITEM_USE', { itemId: r.itemOf(c, 'coinblade').id, targetId: other.id }, pid);
  r.append('CONSUMABLE_USE', { itemId: nudge.id, label: 'WIN' }, pid); assert.deepEqual(r.state.fight.game.pendingChoice.kind, 'nudge'); assert.equal(r.state.fight.game.pendingChoice.label, 'WIN'); assert.ok(!c.items[nudge.id]);
  assert.match(err(r, 'CONSUMABLE_USE', { itemId: reroll.id }, pid).message, /card/);
  r.append('CONSUMABLE_USE', { itemId: fork.id }, pid); assert.equal(r.state.fight.game.pendingChoice.kind, 'fork');
  assert.match(err(r, 'CONSUMABLE_USE', { itemId: bomb.id }, pid).message, /no fight|leave/i);   // a solo PvP round is not an encounter you flee... it is a fight though: allowed below
  r.append('ITEM_RESOLVE', { mult: 2 }, pid);
  r.append('CONSUMABLE_USE', { itemId: feather.id }, pid); assert.ok(c.effects.some(e => e.id === 'phoenix')); err(r, 'CONSUMABLE_USE', { baseId: 'phoenixfeather' }, pid);
  // Smoke Bomb against a monster; refused when called out
  r.state.monsters.m1 = mkMonster({ id: 'm1', items: [makeItem(r.state, { gameId: 'fifty' })] });
  r.append('TURN_END', {}, pid); const pid2 = r.cur(), c2 = r.curChar(); const bomb2 = give(c2, makeConsumable(r.state, 'smokebomb', 2));
  r.append('FIGHT_START', { monsterId: 'm1' }, pid2); r.state.fight.calledOut = true;
  assert.match(err(r, 'CONSUMABLE_USE', { itemId: bomb2.id }, pid2).message, /called out/); r.state.fight.calledOut = false;
  r.append('CONSUMABLE_USE', { itemId: bomb2.id }, pid2); assert.ok(r.state.fight.done && r.state.fight.fled); assert.equal(bomb2.qty, 1);
  // the Cutpurse's free Smoke Bomb needs no item
  const r2 = playingRoom({ chars: [{ classId: 'cutpurse' }, { classId: 'cutpurse' }, { classId: 'cutpurse' }, { classId: 'cutpurse' }] }); const p = r2.cur(), cc = r2.curChar();
  r2.state.monsters.m1 = mkMonster({ id: 'm1', items: [makeItem(r2.state, { gameId: 'fifty' })] }); r2.append('FIGHT_START', { monsterId: 'm1' }, p);
  r2.append('CONSUMABLE_USE', { baseId: 'smokebomb' }, p); assert.equal(cc.freeSmokeBombs, B.social.smokeBombFree - 1); assert.ok(r2.state.fight.fled);
  // a registered consumable from another module wins over the built-in
  consumables.potion = (state, ctx, ch) => { ch.health = 1; };
  try { const r3 = playingRoom(); const p3 = r3.cur(), c3 = r3.curChar(); r3.append('CONSUMABLE_USE', { itemId: r3.itemOf(c3, 'potion').id }, p3); assert.equal(c3.health, 1); } finally { delete consumables.potion; }
});
test("Croupier: Rig the Deck stores the rig on the fight and hands it to the next round; classActives from other modules dispatch; useActive honours Tempo and the level-20 cooldown", () => {
  const r = playingRoom({ chars: [{ classId: 'croupier' }, { classId: 'whale', level: 20 }, { classId: 'cutpurse' }, {}] });
  let guard = 0; while (r.cur() !== 'p0' && guard++ < 8) r.append('TURN_END', {}, r.cur());
  const croup = r.char(0), whale = r.char(1), cut = r.char(2);
  assert.match(err(r, 'CLASS_ACTIVE', { activeId: 'rigthedeck' }, 'p0').message, /fight/);
  r.state.monsters.m1 = mkMonster({ id: 'm1', items: [makeItem(r.state, { gameId: 'fifty' })] }); r.append('FIGHT_START', { monsterId: 'm1' }, 'p0');
  r.append('CLASS_ACTIVE', { activeId: 'rigthedeck', outcome: 'win' }, 'p0'); assert.deepEqual(r.state.fight.rig, { outcome: 'win', by: croup.id, forId: null });
  r.append('ITEM_USE', { itemId: r.itemOf(croup, 'coinblade').id, targetId: 'm1', targetKind: 'monster' }, 'p0');
  assert.deepEqual(r.state.fight.game.rig.outcome, 'win'); assert.equal(r.state.fight.rig, null, 'the rig is handed to the round');
  r.append('ITEM_RESOLVE', { mult: 2, label: 'WIN (rigged)' }, 'p0'); assert.equal(r.state.monsters.m1.health, B.monsters.healthCommon - 10);
  // another module's active
  classActives.sleight = (state, ctx, c, p) => { c.titles.push('sly'); };
  try {
    guard = 0; r.append('FIGHT_END', {}, 'gm'); r.append('TURN_END', {}, 'p0'); while (r.cur() !== 'p2' && guard++ < 8) r.append('TURN_END', {}, r.cur());
    r.append('CLASS_ACTIVE', { activeId: 'sleight' }, 'p2'); assert.deepEqual(cut.titles, ['sly']); assert.equal(cut.cooldowns.active, B.classes.cutpurseCooldown);
  } finally { delete classActives.sleight; }
  const ctx = { B: (g) => B[g], now: 0 };
  assert.equal(useActive(r.state, ctx, whale, 'doubledown'), B.classes.upgradedCooldown, 'level 20 Whale');
  whale.cooldowns.active = 0; whale.passives.tempo = 2;                                   // Tempo affixes are summed into c.passives.tempo by the gear module
  assert.equal(useActive(r.state, ctx, whale, 'doubledown'), Math.max(1, B.classes.upgradedCooldown - 2));
  assert.throws(() => useActive(r.state, ctx, whale, 'rigthedeck'), /not your class/);
});
test('resolveHit directly: a monster attacker pays its own misses from its Health; hooks may cancel a hit', () => {
  const r = playingRoom(); const st = r.state, c = r.char(0); const m = mkMonster({ id: 'm1', items: [makeItem(st, { gameId: 'fifty' })] }); st.monsters.m1 = m;
  const ctx = { now: r.now(), B: (g) => B[g], isGm: true, actor: 'tv', payload: {} };
  const miss = resolveHit(st, ctx, { attackerId: 'm1', attackerKind: 'monster', targetId: c.id, targetKind: 'character', item: m.items[0], stake: 10, mult: 0, label: 'LOSE' });
  assert.equal(miss.loss, 10); assert.equal(m.health, B.monsters.healthCommon - 10); assert.equal(st.ledger.at(-1).kind, 'monsterHealth');
  const cancel = (s, cx, info) => { if (info.attackerId === 'm1') { info.cancel = true; info.cancelText = 'House Rules'; } }; damageHooks.incoming.push(cancel);
  try { const h = resolveHit(st, ctx, { attackerId: 'm1', attackerKind: 'monster', targetId: c.id, targetKind: 'character', item: m.items[0], stake: 10, mult: 2, label: 'WIN' }); assert.ok(h.cancel && c.health === 100); assert.match(last(r), /House Rules/); }
  finally { damageHooks.incoming.splice(damageHooks.incoming.indexOf(cancel), 1); }
  assert.throws(() => resolveHit(st, ctx, { attackerId: 'm1', attackerKind: 'monster', targetId: c.id, targetKind: 'character', item: m.items[0], stake: 10, mult: 'x' }));
});
