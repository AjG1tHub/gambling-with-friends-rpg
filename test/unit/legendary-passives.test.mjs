// The derived passives (characters/character.js › recomputePassives) that were computed but never read: each one
// is checked here where it bites. moveBonus, waterWalk and digs in movement; calderaImmune in the damage hooks;
// pipBuoy through exactHealthVisible; swingsLast in ITEM_USE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gen, shared, hooks, chars, playingRoom, charOf, give, ctxFor } from './_fixtures-characters.mjs';
import { equip } from '../../packages/shared/handlers/inventory.js';
import { legalSteps, cardView } from '../../packages/shared/handlers/movement.js';
import * as Q from '../../packages/shared/map/query.js';
import { B } from '../../packages/shared/balance.js';

// A playing room on the stub map (a radius-3 blob of plain hexes, everyone on 0,0) with no monsters; `c` is the mover.
function setup() {
  const r = playingRoom(); r.state.monsters = {};
  const pid = shared.currentPlayerId(r.state), c = charOf(r, pid), other = charOf(r, r.state.seats.find(s => s !== pid));
  return { r, st: r.state, pid, c, other, ctx: ctxFor(r) };
}
const legendary = (t, id, slot, who = t.c) => { const it = give(t.r, who.playerId, gen.generateLegendary(t.st, id, { seed: 9 })); equip(t.st, t.ctx, who, it, slot); return it; };
const voidHex = (st, key, type) => Object.assign(st.map.hexes[key], { void: true, type, colour: null });
// Open the move phase again for the same mover (a stand-in for their next turn).
const again = (t) => { t.st.moveSession = null; t.st.turnPhase = 'move'; t.c.usedThisTurn = { attack: 0, spell: 0, moved: false }; };
const stepLegal = (t, key) => legalSteps(t.st, t.pid).find(x => x.key === key).legal;

test('moveBonus: the Hide four-piece adds sets.hideMove hexes to a dice roll, a plod, a wheel number and the Card range; the Broadside counts once', () => {
  const t = setup(); const { r, st, pid, c, ctx } = t;
  for (const slot of ['helmet', 'torso', 'pants', 'boots']) equip(st, ctx, c, give(r, pid, gen.makeSetPiece(st, 'hide', slot, { seed: 3 })), slot);
  assert.equal(c.passives.moveBonus, B.sets.hideMove);
  c.worn.boots.bootMode = 'dice'; r.append('GM_RIG', { stream: 'dice', value: 3 }); r.append('MOVE_ROLL', {}, pid);
  assert.equal(st.moveSession.roll, 3 + B.sets.hideMove, 'dice'); assert.equal(st.moveSession.movesLeft, 3 + B.sets.hideMove);
  // Wheel: a numbered segment gains the bonus, a Stumble stays 0.
  again(t); c.worn.boots.bootMode = 'wheel'; r.append('GM_RIG', { stream: 'wheels', value: '3' }); r.append('MOVE_ROLL', {}, pid);
  assert.equal(st.moveSession.roll, 3 + B.sets.hideMove, 'wheel');
  again(t); r.append('GM_RIG', { stream: 'wheels', value: 'stumble' }); r.append('MOVE_ROLL', {}, pid); assert.equal(st.moveSession.segment, 'stumble'); assert.equal(st.moveSession.roll, 0, 'a Stumble is still a Stumble');
  // Card: the range the card looks in is wider, on the session and on the phone's view before the draw.
  again(t); c.worn.boots.bootMode = 'card'; st.map.colourDeck = []; assert.equal(cardView(st, pid).range, B.movement.cardRange + B.sets.hideMove);
  // Barefoot, with the passive fed by something else; and the Broadside's penalty is taken once, not twice.
  again(t); c.worn.boots = null; c.passives.moveBonus = 2; r.append('MOVE_ROLL', {}, pid); assert.equal(st.moveSession.roll, B.movement.barefoot + 2, 'barefoot');
  const u = setup(); u.c.worn.boots = null; legendary(u, 'broadside', 'mainhand'); assert.equal(u.c.passives.moveBonus, -B.legendaries.broadsideMovePenalty);
  u.r.append('MOVE_ROLL', {}, u.pid); assert.equal(u.st.moveSession.roll, B.movement.barefoot - B.legendaries.broadsideMovePenalty);
});

test('waterWalk: the Deep-Sea Suit opens water void to its wearer only, and the first surfacing of the run brings up a Rare item', () => {
  const t = setup(); const { r, st, pid, c, other } = t; c.worn.boots = null;
  voidHex(st, '1,0', 'water'); voidHex(st, '0,1', 'chasm');
  r.append('MOVE_ROLL', {}, pid); assert.equal(stepLegal(t, '1,0'), false);
  assert.match(r.try('MOVE_STEP', { to: '1,0' }, pid).message, /impassable/);
  legendary(t, 'deepseasuit', 'torso'); assert.ok(c.passives.waterWalk);
  assert.equal(Q.passable(st, '1,0', c.id), true); assert.equal(Q.passable(st, '1,0', other.id), false, 'only the wearer'); assert.equal(Q.passable(st, '1,0'), false, 'still void as terrain');
  assert.equal(Q.passable(st, '0,1', c.id), false, 'a chasm is not water'); assert.equal(stepLegal(t, '1,0'), true);
  st.moveSession.legal = []; r.append('MOVE_STEP', { to: '1,0' }, pid); assert.equal(c.pos, '1,0'); assert.equal(st.map.hexes['1,0'].void, true, 'the water stays water');
  assert.equal(c.pendingLoot.length, 0, 'nothing until you surface');
  r.append('MOVE_STEP', { to: '2,0' }, pid); assert.equal(c.pos, '2,0'); assert.ok(c.flags.deepSeaSurfaced);
  assert.deepEqual(c.pendingLoot.map(x => x.rarity), ['rare']);
  const got = gen.materialisePendingLoot(st, t.ctx, c); assert.equal(got.length, 1); assert.equal(got[0].item.rarity, 'rare');
  // Once per run: a second dip pays nothing.
  again(t); r.append('MOVE_ROLL', {}, pid); r.append('MOVE_STEP', { to: '1,0' }, pid); r.append('MOVE_STEP', { to: '0,0' }, pid);
  assert.equal(c.pos, '0,0'); assert.equal(c.pendingLoot.length, 0);
  // MOVE_PATH routes through the water for the wearer.
  again(t); voidHex(st, '1,-1', 'wall'); voidHex(st, '0,1', 'wall'); r.append('MOVE_ROLL', {}, pid); r.append('MOVE_PATH', { to: '2,0' }, pid); assert.equal(c.pos, '2,0');
});

test('digs: the Blockbreaker Pick walks into one void hex a turn; the hex is dug and stays open for everyone', () => {
  const t = setup(); const { r, st, pid, c, other } = t; c.worn.boots = null;
  voidHex(st, '-1,0', 'wall'); voidHex(st, '-2,0', 'wall'); voidHex(st, '0,-1', 'chasm'); st.map.hexes['0,-2'].type = 'throne';
  legendary(t, 'blockbreaker', 'offhand'); assert.equal(c.passives.digs, 1);
  r.append('MOVE_ROLL', {}, pid);
  assert.equal(stepLegal(t, '-1,0'), true); assert.ok(st.moveSession.legal.includes('-1,0'));
  assert.equal(stepLegal(t, '0,-1'), false, 'void beside the throne cannot be dug'); assert.match(r.try('MOVE_STEP', { to: '0,-1' }, pid).message, /impassable/);
  assert.equal(Q.passable(st, '-1,0', c.id), false, 'paths never route through rock');
  r.append('MOVE_STEP', { to: '-1,0' }, pid);
  assert.equal(c.pos, '-1,0'); assert.equal(st.map.hexes['-1,0'].void, false); assert.equal(st.map.hexes['-1,0'].type, 'plain'); assert.equal(c.usedThisTurn.digs, 1); assert.equal(st.map.dug, 1);
  assert.equal(Q.passable(st, '-1,0', other.id), true, 'open for everyone'); assert.equal(Q.passable(st, '-1,0'), true);
  assert.equal(stepLegal(t, '-2,0'), false, 'one a turn'); assert.match(r.try('MOVE_STEP', { to: '-2,0' }, pid).message, /impassable/);
  assert.equal(st.map.hexes['-2,0'].void, true);
  // Next turn the pick swings again; a tap on the rock next to you (MOVE_PATH) digs too.
  again(t); r.append('MOVE_ROLL', {}, pid); r.append('MOVE_PATH', { to: '-2,0' }, pid); assert.equal(c.pos, '-2,0'); assert.equal(st.map.hexes['-2,0'].void, false); assert.equal(st.map.dug, 2);
  // Without the pick the same step is refused and nothing changes.
  const u = setup(); u.c.worn.boots = null; voidHex(u.st, '-1,0', 'wall'); u.r.append('MOVE_ROLL', {}, u.pid);
  assert.match(u.r.try('MOVE_STEP', { to: '-1,0' }, u.pid).message, /impassable/); assert.equal(u.st.map.hexes['-1,0'].void, true); assert.match(u.r.try('MOVE_PATH', { to: '-1,0' }, u.pid).message, /no path/);
});

test('calderaImmune: the Infernal Mantle wearer does not take the Caldera\'s doubled damage', () => {
  const t = setup(); const { st, c, other, ctx } = t;
  st.map.regions.caldera = { id: 'caldera', name: 'The Caldera', tier: 2, family: 'nerve', hexKeys: ['1,0'] }; st.map.hexes['1,0'].regionId = 'caldera'; c.pos = other.pos = '1,0';
  const incoming = (target) => { const info = { attackerId: 'nobody', targetId: target.id, targetKind: 'character', item: null, gameId: 'dice', kind: 'attack', stake: 10, mult: 1, flat: 0, notes: [] }; for (const h of hooks.damageHooks.incoming) h(st, ctx, info); return info; };
  legendary(t, 'infernalmantle', 'cape'); assert.ok(c.passives.calderaImmune);
  const immune = incoming(c); assert.ok(!immune.notes.includes('Caldera'));
  c.passives.calderaImmune = false; const exposed = incoming(c); assert.ok(exposed.notes.includes('Caldera'));
  assert.ok(Math.abs(exposed.mult - immune.mult * B.map.calderaDamageMult) < 1e-9);
  assert.ok(incoming(other).notes.includes('Caldera'), 'everyone else still burns');
});

test('pipBuoy: exactHealthVisible is true for the wearer within legendaries.pipBuoyRange, and for nobody else', () => {
  const t = setup(); const { st, c, other } = t; const R = B.legendaries.pipBuoyRange;
  c.pos = '0,0'; other.pos = '1,0';
  assert.equal(chars.exactHealthVisible(st, c.id, other.id), false, 'no ring, no numbers'); assert.equal(chars.exactHealthVisible(st, c.id, c.id), true, 'your own Health is always exact');
  legendary(t, 'pipbuoy', 'ring1'); assert.equal(c.passives.pipBuoy, R);
  other.pos = `${R},0`; assert.equal(chars.exactHealthVisible(st, c.id, other.id), true); assert.equal(chars.exactHealthVisible(st, other.id, c.id), false, 'the wearer is not exposed');
  other.pos = `${R + 1},0`; assert.equal(chars.exactHealthVisible(st, c.id, other.id), false, 'out of range');
  other.pos = '1,0'; other.dead = true; assert.equal(chars.exactHealthVisible(st, c.id, other.id), false); other.dead = false;
  assert.equal(chars.exactHealthVisible(st, c.id, 'nobody'), false); assert.equal(chars.exactHealthVisible(st, 'nobody', other.id), false);
});

test('swingsLast: after the Buster Cleaver swings, no other weapon or spell may be used that turn; a spell before it is fine', () => {
  const t = setup(); const { r, st, pid, c, other } = t; st.turnPhase = 'action'; c.health = c.maxHealth = 200;
  const buster = legendary(t, 'bustercleaver', 'mainhand');
  const spell = give(r, pid, gen.makeWeapon(st, gen.GAMES.find(g => g.kind === 'spell'), { seed: 4 }));
  r.append('ITEM_USE', { itemId: spell.id }, pid); assert.ok(!c.usedThisTurn.swungLast); r.append('ITEM_RESOLVE', { mult: 0, label: 'LOSE' }, pid);
  r.append('ITEM_USE', { itemId: buster.id, targetId: other.id }, pid); assert.equal(c.usedThisTurn.swungLast, true); r.append('ITEM_RESOLVE', { mult: 0, label: 'LOSE' }, pid);
  c.usedThisTurn.spell = 0; c.usedThisTurn.attack = 0;   // lift the ordinary per-turn caps: only the cleaver's weight is left to refuse
  assert.match(r.try('ITEM_USE', { itemId: spell.id }, pid).message, /swings last/);
  assert.match(r.try('ITEM_USE', { itemId: buster.id, targetId: other.id }, pid).message, /swings last/);
});
