// Mechanics SPEC.md promises that an audit could not find end to end: the Gilt and Iron four-piece bonuses and the
// Fortunate affix, the Litter's five cats, the Grey's shared Health and stolen pet, a pet's kill, pet trades by
// letter, and the event constants that have no handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, shared, B } from './_helpers.mjs';
import { makeMap, startRun, makeCharacter, makeItem, land, ctxFor, COL, at, characterOf, currentPlayerId } from './_fixtures-economy.mjs';
import { EVENTS } from '../../packages/shared/events.js';
import { hasHandler } from '../../packages/shared/reducer.js';
import { makeRng } from '../../packages/shared/rng.js';
import { makeSetPiece } from '../../packages/shared/characters/generator.js';
import { recomputeSets, hasSetBonus } from '../../packages/shared/characters/character.js';
import { rollRarity } from '../../packages/shared/handlers/wheels.js';
import { pactInterest } from '../../packages/shared/handlers/economy.js';
import { monsterHealth, playMonsterTurn, headlessCtx } from '../../packages/shared/handlers/fight.js';
import { newPet, speciesDef } from '../../packages/shared/handlers/pets.js';
import { familyOf } from '../../packages/shared/encounters/monsters.js';

function started({ seed = 42, mode = 'ffa', gold = 500 } = {}) {
  const r = room({ seed, mode }).join(names4);
  makeMap(r.state);
  for (const pid of r.state.seats) makeCharacter(r.state, pid, { pos: at('strip', COL.start), gold });
  startRun(r);
  return r;
}
const wearSet = (r, c, setId) => { ['helmet', 'torso', 'pants', 'boots'].forEach((slot, i) => { const it = makeSetPiece(r.state, setId, slot, { seed: 10 + i }); c.items[it.id] = it; c.worn[slot] = it; }); recomputeSets(r.state, ctxFor(r), c); };
const weapon = (c, { gameId = 'dice', family = 'dice', stake = 10 } = {}) => { const it = { ...makeItem({ name: `${family} blade` }), gameId, family, stake }; c.items[it.id] = it; c.worn.mainhand = it; return it; };
const swing = (r, pid, c, item, m, mult = 2) => { c.usedThisTurn.attack = 0; r.append('ITEM_USE', { itemId: item.id, targetId: m.id, targetKind: 'monster' }, pid); r.append('ITEM_RESOLVE', { mult, label: mult > 1 ? 'WIN' : 'miss' }, pid); return r.state.fight?.log.at(-1) ?? r.state.lastFight; };
const givePet = (r, c, speciesId = 'grazingmaw') => { const pet = newPet(r.state, ctxFor(r), speciesDef(speciesId)); c.pets = [pet]; c.activePetId = pet.id; c.hatching = null; return pet; };

test('events: every declared event has a handler, except the two still waiting on their feature', () => {
  assert.ok(!('TILE_RESOLVE' in EVENTS), 'tiles resolve inside the move (tileHooks), not by an event');
  assert.deepEqual(Object.keys(EVENTS).filter(t => !hasHandler(t)).sort(), ['HOF_IMPORT', 'MOVE_WHEEL_NUDGE']);
});

test('sets: the Gilt four-piece and a Fortunate affix lift loot rarity; the Iron four-piece halves Blood Pact interest', () => {
  const r = started(); const pid = currentPlayerId(r.state), c = characterOf(r.state, pid), ctx = ctxFor(r);
  const roll = (regionId, charId = c.id) => { r.append('GM_RIG', { stream: 'loot', value: 'common' }); return rollRarity(r.state, ctxFor(r), { regionId, charId }); };
  assert.equal(roll('strip'), 'common');
  wearSet(r, c, 'gilt'); assert.ok(hasSetBonus(c, 'gilt'));
  assert.equal(roll('strip'), 'rare', 'one rarity higher'); assert.equal(roll('citadel'), 'epic', 'on top of the Citadel');
  assert.equal(roll('strip', null), 'common', 'a roll for nobody (the Shop shelf) is not lifted');
  // through a Chest: the wheel lands on Item, the rarity roll on Common, and a Rare comes out
  land(r, pid, at('strip', COL.chest)); r.append('GM_RIG', { stream: 'wheels', value: 'Item' }); r.append('GM_RIG', { stream: 'loot', value: 'common' });
  r.append('WHEEL_SPIN', { wheel: 'loot' }, pid); assert.equal(c.pendingLoot.at(-1).rarity, 'rare');
  // three pieces are not a set
  c.worn.boots = null; recomputeSets(r.state, ctx, c); assert.equal(roll('strip'), 'common');
  // Fortunate: its value, in the region it names and nowhere else
  const neck = { ...makeItem({ name: 'Fortunate Chain', slot: 'necklace' }), affixes: [{ id: 'fortunate', kind: 'economy', effect: 'rarity', target: { region: 'docks' }, value: B.affix.economyRarity }] };
  c.items[neck.id] = neck; c.worn.necklace = neck;
  assert.equal(roll('docks'), 'rare'); assert.equal(roll('strip'), 'common');
  // Iron, in the shape the characters module really writes ({ iron: { pieces, complete } })
  for (const s of ['helmet', 'torso', 'pants']) c.worn[s] = null;
  wearSet(r, c, 'iron'); assert.deepEqual(c.setBonuses, { iron: { pieces: B.sets.pieces, complete: true } });
  assert.equal(pactInterest(r.state, ctx, c, 'strip'), B.bloodPact.interest * B.bloodPact.ironSetFraction);
  land(r, pid, at('strip', COL.bloodbank)); c.health = 40; r.append('PACT_TAKE', { amount: 40 }, pid);
  assert.equal(r.state.pacts[c.pactIds[0]].owed, Math.round(40 * (1 + B.bloodPact.interest * B.bloodPact.ironSetFraction)));
});

test('the Litter: each cat is hurt only by its own game family; the fifth cat down ends the raid, here by a pet', () => {
  const r = started(); const [a, , other] = r.state.seats; const c = characterOf(r.state, a), ctx = ctxFor(r);
  const litter = Object.values(r.state.monsters).find(m => m.speciesId === 'the_litter');
  characterOf(r.state, other).pos = litter.pos; land(r, a, litter.pos); assert.equal(r.state.fight.kind, 'raid');
  const cat = (fam) => litter.parts.find(p => p.family === fam), each = cat('cards').maxHealth, sum = () => litter.parts.reduce((s, p) => s + p.health, 0);
  assert.equal(familyOf({ gameId: 'dice' }), 'dice'); assert.equal(familyOf({ gameId: 'dice', family: 'cards' }), 'cards'); assert.equal(familyOf(null), null);
  // a cards weapon through the item events: Deuce takes it, the other four do not
  const blade = weapon(c, { family: 'cards' }); const hit = swing(r, a, c, blade, litter);
  assert.ok(hit.damage > 0); assert.equal(cat('cards').health, each - hit.damage);
  for (const f of ['picks', 'dice', 'wheels', 'nerve']) assert.equal(cat(f).health, each, f);
  assert.equal(litter.health, 5 * each - hit.damage, 'the bar is the sum');
  // damage does not spill past the cat; a dead cat's family, or no family at all, hurts nobody
  assert.equal(monsterHealth(r.state, litter, -9999, 'test', ctx, { family: 'cards' }), -(each - hit.damage)); assert.ok(cat('cards').dead); assert.equal(litter.health, 4 * each);
  assert.equal(monsterHealth(r.state, litter, -50, 'test', ctx, { family: 'cards' }), 0); assert.match(r.state.log.at(-1).text, /No cat/);
  assert.equal(monsterHealth(r.state, litter, -50, 'test', ctx), 0);
  // the Litter's own missed stake comes off the cat that swung (or the first standing) and never takes its last point
  const own = litter.items[0], payer = litter.parts.find(p => !p.dead && p.family === own.family) || litter.parts.find(p => !p.dead);
  payer.health = 3; litter.health = sum(); r.state.fight.turn = 'monster';
  r.append('MONSTER_ACT', { itemId: own.id, mult: 0, label: 'miss', stake: 40 }, 'tv');
  assert.equal(payer.health, 1); assert.ok(!payer.dead && !litter.dead); assert.equal(litter.health, sum()); assert.equal(r.state.fight.turn, 'player');
  // three more by their families, then the dice cat by a pet's Chomp (a dice game): loot, the kill, the fight won
  for (const f of ['picks', 'wheels', 'nerve']) monsterHealth(r.state, litter, -9999, 'test', ctx, { family: f });
  assert.equal(litter.health, cat('dice').health); assert.ok(!litter.dead);
  givePet(r, c); const gold = c.gold;
  r.append('PET_ATTACK', { attackIndex: 0, mult: 20 }, a); assert.ok(!litter.dead, 'Bait is a picks game: Thimble is already down');
  c.usedThisTurn.petAttack = false; r.append('PET_ATTACK', { attackIndex: 1, mult: 20 }, a);
  assert.ok(litter.dead && litter.parts.every(p => p.dead)); assert.equal(r.state.fight.result, 'won'); assert.ok(c.gold > gold); assert.equal(r.state.stats[a].bosses, 1);
});

test('a pet\'s kill is a kill: the fight is won, the loot drops, the kill is counted once', () => {
  const r = started(); const pid = currentPlayerId(r.state), c = characterOf(r.state, pid);
  const m = Object.values(r.state.monsters).find(x => x.regionId === 'strip' && !x.boss && !x.blocker && !x.linkedTo);
  land(r, pid, m.pos); assert.equal(r.state.fight.monsterId, m.id);
  const pet = givePet(r, c); m.health = 5; const gold = c.gold, kills = r.state.stats[pid].kills;
  r.append('PET_ATTACK', { attackIndex: 1, mult: 2, label: 'Chomp' }, pid);
  assert.ok(m.dead); assert.equal(r.state.fight.done, true); assert.equal(r.state.fight.result, 'won');
  assert.equal(r.state.stats[pid].kills, kills + 1); assert.equal(c.kills, 1); assert.ok(c.gold >= gold + m.loot.gold[0], 'the Gold spilled');
  assert.equal(r.state.lastDrop.monsterId, m.id); assert.ok(pet.power > B.pets.startPower);
});

test('the Grey: its link is one pool of Health in two bodies, and it never links to a boss', () => {
  for (const seed of [1, 2, 3, 42, 99]) { const r = started({ seed }); for (const m of Object.values(r.state.monsters)) if (m.linkedTo) { const o = r.state.monsters[m.linkedTo]; assert.ok(!m.boss && !o.boss && !m.blocker && !o.blocker, `seed ${seed}`); assert.equal(o.linkedTo, m.id); } }
  const r = started(); const pid = currentPlayerId(r.state), c = characterOf(r.state, pid), ctx = ctxFor(r);
  const [x, y] = Object.values(r.state.monsters).filter(m => m.regionId === 'docks' && !m.boss && !m.dead); x.linkedTo = y.id; y.linkedTo = x.id;
  const hx = x.health, hy = y.health, rows = r.state.ledger.length;
  assert.equal(monsterHealth(r.state, x, -10, 'test', ctx), -10); assert.equal(x.health, hx - 10); assert.equal(y.health, hy - 10, 'mirrored');
  assert.deepEqual(r.state.ledger.slice(rows).map(l => [l.monsterId, l.moved]), [[x.id, -10], [y.id, -10]]);
  assert.equal(monsterHealth(r.state, y, 4, 'test', ctx), 4); assert.equal(x.health, hx - 6, 'both ways, heals too');
  // the other body empties first: both are empty, and a hit through the events kills the pair and pays out once
  y.health = 3; land(r, pid, x.pos); const blade = weapon(c); const gold = c.gold;
  swing(r, pid, c, blade, x);
  assert.ok(x.dead && y.dead); assert.equal(x.health, 0); assert.equal(r.state.fight.result, 'won'); assert.ok(c.gold > gold); assert.equal(r.state.stats[pid].kills, 1);
  assert.ok(r.state.log.some(l => /dies with its link/.test(l.text)));
});

test('the Grey takes the active pet for one attack, once a fight: a win bites the trainer, a loss burns the pet\'s Power', () => {
  const open = () => {
    const r = started(); const pid = currentPlayerId(r.state), c = characterOf(r.state, pid);
    r.append('GM_SPAWN', { speciesId: 'the_grey', hex: at('strip', COL.plain) }); const grey = Object.values(r.state.monsters).find(m => m.speciesId === 'the_grey' && m.pos === at('strip', COL.plain));
    c.pos = grey.pos; r.append('FIGHT_START', { monsterId: grey.id }, pid); r.state.fight.turn = 'monster';
    return { r, pid, c, grey, pet: givePet(r, c) };
  };
  let { r, pid, c, grey, pet } = open();
  // the headless turn (the TV, the bot, the GM's "let it fight itself") chooses the pet, and only a biting attack
  const payload = playMonsterTurn(r.state, headlessCtx(r.state, r.now()), makeRng(7));
  assert.equal(payload.petControl.petId, pet.id); assert.equal(payload.itemId, null); assert.ok([0, 1, 3].includes(payload.petControl.attackIndex), 'never Milk of Grief');
  assert.match(r.try('MONSTER_ACT', { petControl: { petId: pet.id, attackIndex: 2 }, mult: 2 }, 'tv').message, /no such attack/);
  assert.match(r.try('MONSTER_ACT', { petControl: { petId: 'nope', attackIndex: 1 }, mult: 2 }, 'tv').message, /no pet to take/);
  const hp = c.health, power = pet.power, greyHp = grey.health;
  r.append('MONSTER_ACT', { petControl: { petId: pet.id, attackIndex: 1 }, mult: 2, label: 'exact 7' }, 'tv');   // Chomp, stake 12
  assert.equal(c.health, hp - 24, 'stake × mult, straight to the trainer'); assert.equal(pet.power, power, 'the pet does not soak its own bite'); assert.equal(grey.health, greyHp);
  assert.equal(r.state.fight.turn, 'player'); assert.equal(r.state.fight.petTaken, true); assert.equal(r.state.fight.lastGame.petControl, pet.id); assert.equal(r.state.fight.log.at(-1).damage, 24);
  assert.equal(r.state.stats[pid].damageTaken, 24);
  // once a fight: the next turn is the Grey's own item
  r.state.fight.turn = 'monster';
  assert.match(r.try('MONSTER_ACT', { petControl: { petId: pet.id, attackIndex: 1 }, mult: 2 }, 'tv').message, /already taken/);
  const next = playMonsterTurn(r.state, headlessCtx(r.state, r.now()), makeRng(7)); assert.ok(next.itemId); assert.ok(!next.petControl);
  // a loss costs the pet, a push nothing; a fainted pet cannot be taken; other monsters cannot do it at all
  ({ r, pid, c, grey, pet } = open());
  r.append('MONSTER_ACT', { petControl: { petId: pet.id, attackIndex: 1 }, mult: 0 }, 'tv'); assert.equal(pet.power, B.pets.startPower - 12); assert.equal(c.health, 100);
  ({ r, pid, c, grey, pet } = open());
  pet.fainted = true; pet.power = 0; assert.ok(playMonsterTurn(r.state, headlessCtx(r.state, r.now()), makeRng(7)).itemId, 'no pet standing: an ordinary move');
  ({ r, pid, c, grey, pet } = open()); grey.special = null;
  assert.match(r.try('MONSTER_ACT', { petControl: { petId: pet.id, attackIndex: 1 }, mult: 2 }, 'tv').message, /cannot take a pet/);
  // the bite can kill: the usual death path, the fight is lost
  ({ r, pid, c, grey, pet } = open()); c.health = 10;
  r.append('MONSTER_ACT', { petControl: { petId: pet.id, attackIndex: 1 }, mult: 2 }, 'tv'); assert.ok(c.dead); assert.equal(c.diedTo, 'monster');
});

test('pet trading by letter: the offer rides the crow, opens when it lands, settles like any trade; a destroyed letter is no offer', () => {
  const r = started(); const [a, b, d] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b), cd = characterOf(r.state, d);
  const pet = givePet(r, cb); ca.pets = []; ca.activePetId = null;
  const laps = (n) => { for (let i = 0; i < n * r.state.seats.length; i++) r.append('TURN_END', {}, currentPlayerId(r.state)); };
  assert.match(r.try('LETTER_SEND', { toId: b, kind: 'trade', trade: {} }, a).message, /empty trade/);
  assert.match(r.try('LETTER_SEND', { toId: b, kind: 'trade', trade: { give: { gold: 50 }, want: { petIds: ['nope'] } } }, a).message, /has no pet/);
  assert.match(r.try('LETTER_SEND', { toId: b, kind: 'trade', trade: { give: { gold: 99999 }, want: { petIds: [pet.id] } } }, a).message, /not enough Gold/);
  r.append('LETTER_SEND', { toId: b, kind: 'trade', trade: { give: { gold: 50 }, want: { petIds: [pet.id] } } }, a);
  const l = r.state.letters.at(-1); assert.equal(l.kind, 'trade'); assert.deepEqual(l.trade, { give: { gold: 50, itemIds: [], petIds: [] }, want: { gold: 0, itemIds: [], petIds: [pet.id] } }); assert.ok(l.text);
  assert.equal((r.state.trades || []).length, 0, 'nothing on the table while the crow flies');
  laps(B.social.letterDelayTurns); assert.ok(l.deliveredAt);
  const t = r.state.trades[0]; assert.deepEqual([t.status, t.fromId, t.toId, t.letterId], ['offered', a, b, l.id]);
  assert.ok(!r.state.log.some(x => x.kind === 'trade' && x.text.includes(ca.name)), 'the log does not name the sender');
  r.append('TRADE_ANSWER', { tradeId: t.id, accept: true }, b); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t.status, 'settled'); assert.deepEqual(ca.pets.map(p => p.id), [pet.id]); assert.equal(ca.activePetId, pet.id); assert.deepEqual(cb.pets, []); assert.equal(cb.activePetId, null);
  assert.equal(ca.gold, 450); assert.equal(cb.gold, 550);
  // destroyed on the way by someone at the courier post: never an offer
  cd.pos = r.state.map.courier;
  r.append('LETTER_SEND', { toId: a, kind: 'trade', text: 'I want it back', trade: { give: { gold: 60 }, want: { petIds: [pet.id] } } }, b);
  const l2 = r.state.letters.at(-1); r.append('LETTER_INTERCEPT', { letterId: l2.id, action: 'destroy' }, d);
  laps(B.social.letterDelayTurns + 1); assert.equal(r.state.trades.length, 1);
  // a full team has no room: the trade falls through at settlement and nothing moves
  const extra = givePet(r, cb); ca.pets = Array.from({ length: B.pets.teamMax }, (_, i) => ({ ...pet, id: `full${i}` }));
  r.append('TRADE_OFFER', { toId: a, give: { petIds: [extra.id] }, want: { gold: 10 } }, b); const t2 = r.state.trades.at(-1);
  r.append('TRADE_ANSWER', { tradeId: t2.id, accept: true }, a); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t2.status, 'failed'); assert.equal(ca.pets.length, B.pets.teamMax); assert.deepEqual(cb.pets.map(p => p.id), [extra.id]);
  // a swap leaves the count where it was, so it goes through
  r.append('TRADE_OFFER', { toId: a, give: { petIds: [extra.id] }, want: { petIds: ['full0'] } }, b); const t3 = r.state.trades.at(-1);
  r.append('TRADE_ANSWER', { tradeId: t3.id, accept: true }, a); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t3.status, 'settled'); assert.ok(ca.pets.some(p => p.id === extra.id)); assert.deepEqual(cb.pets.map(p => p.id), ['full0']);
});

// ---- second review of the spec-verify merge (19 Nov) ------------------------------------------------------------
test('a trade that names the same item or pet twice moves it once', () => {
  const r = started(); const [a, b] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b);
  const pet = givePet(r, ca); const other = givePet(r, cb);
  r.append('TRADE_OFFER', { toId: b, give: { petIds: [pet.id, pet.id] }, want: { petIds: [other.id, other.id] } }, a);
  const t = r.state.trades.at(-1); assert.deepEqual(t.give.petIds, [pet.id]); assert.deepEqual(t.want.petIds, [other.id]);
  r.append('TRADE_ANSWER', { tradeId: t.id, accept: true }, b); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t.status, 'settled'); assert.deepEqual(cb.pets.map(p => p.id), [pet.id]); assert.deepEqual(ca.pets.map(p => p.id), [other.id]);
  const it = makeItem({ name: 'spare ring' }); ca.items[it.id] = it; const count = () => Object.keys(ca.items).length + Object.keys(cb.items).length + (ca.pendingLoot?.length || 0) + (cb.pendingLoot?.length || 0);
  const n = count();
  r.append('TRADE_OFFER', { toId: b, give: { itemIds: [it.id, it.id, it.id] }, want: {} }, a); const t2 = r.state.trades.at(-1); assert.deepEqual(t2.give.itemIds, [it.id]);
  r.append('TRADE_ANSWER', { tradeId: t2.id, accept: true }, b); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t2.status, 'settled'); assert.equal(count(), n, 'nothing minted'); assert.ok(!ca.items[it.id]);
});

test('one open offer per pet, by hand or by crow; an egg on the wheels holds its place on the team', () => {
  const r = started(); const [a, b, c3] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b);
  const pet = givePet(r, ca);
  r.append('TRADE_OFFER', { toId: b, give: { petIds: [pet.id] }, want: { gold: 5 } }, a);
  assert.match(r.try('TRADE_OFFER', { toId: c3, give: { petIds: [pet.id] }, want: { gold: 5 } }, a).message, /already on offer/);
  assert.match(r.try('LETTER_SEND', { toId: c3, kind: 'trade', trade: { give: { petIds: [pet.id] }, want: { gold: 5 } } }, a).message, /already on offer/);
  // b's team is one short of full and an egg is hatching: the pet has nowhere to go
  const t = r.state.trades.at(-1); cb.pets = Array.from({ length: B.pets.teamMax - 1 }, (_, i) => ({ ...pet, id: `f${i}` })); cb.hatching = { wheels: [], regionId: 'strip' };
  r.append('TRADE_ANSWER', { tradeId: t.id, accept: true }, b); r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(t.status, 'failed'); assert.deepEqual(ca.pets.map(p => p.id), [pet.id]); assert.equal(cb.pets.length, B.pets.teamMax - 1);
});

test('Camera Obscura hurts a monster through monsterHealth: the Grey\'s other body feels it', async () => {
  const { legendaryEffects } = await import('../../packages/shared/hooks.js');
  const r = started(); const pid = currentPlayerId(r.state), c = characterOf(r.state, pid), ctx = ctxFor(r);
  const [x, y] = Object.values(r.state.monsters).filter(m => m.regionId === 'docks' && !m.boss && !m.dead); x.linkedTo = y.id; y.linkedTo = x.id;
  x.health = x.maxHealth = 500; y.health = y.maxHealth = 500; c.activeUses ||= {}; c.flags ||= {};
  legendaryEffects.cameraobscura.onUse(r.state, ctx, c, { targetId: x.id }, null);
  assert.equal(x.health, 500 - B.legendaries.cameraDamage); assert.equal(y.health, x.health, 'mirrored'); assert.equal(x.pinnedTurns, 1);
});
