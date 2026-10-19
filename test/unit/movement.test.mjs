// Movement: every boots mode end to end from phone-style events, stop rules, rigs, swap, portal, path taps,
// refused steps, gated bridges, barefoot, boots swap, legendary uniques and movement affixes, hidden colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, shared, currentPlayerId, characterOf } from './_helpers.mjs';
import { legalSteps, cardView, moveSummary, wheelSegments, BOOTS, bootAffixes } from '../../packages/shared/handlers/movement.js';
import { tileHooks } from '../../packages/shared/hooks.js';
import * as Q from '../../packages/shared/map/query.js';
import * as H from '../../packages/shared/hex.js';

const { B } = shared;
const MV = B.movement;

// ---- fixtures -----------------------------------------------------------------------------------------------------

export function bootsItem(baseId, extra = {}) {
  const b = BOOTS.bases.find(x => x.id === baseId); if (!b && !extra.unique) throw new Error('no boots ' + baseId);
  return { id: 'it_' + baseId, baseId, name: b?.name || baseId, slot: 'boots', rarity: 'common', bootMode: b?.mode || null, die: b?.die ?? null, footprint: { ...BOOTS.footprint }, affixes: [], region: null, ...extra };
}
const affix = (id) => ({ id, kind: 'movement', target: null, value: null, text: BOOTS.affixes[id].text });
function makeChar(id, playerId, { classId = 'whale', level = 1, boots = null, gold = 0 } = {}) {
  const worn = { mainhand: null, offhand: null, spell1: null, spell2: null, helmet: null, torso: null, pants: null, gloves: null, boots, ring1: null, ring2: null, ring3: null, ring4: null, necklace: null, cape: null };
  const items = {}; if (boots) items[boots.id] = boots;
  return { id, playerId, rosterId: null, name: id, crest: '🂠', look: { body: 0, skin: 0, face: 0, hair: 0, coat: '#000' }, classId, level, xp: 0, statPoints: 0, stats: { luck: 3, nerve: 3, greed: 3, grit: 3 },
    health: 100, maxHealth: 100, shield: 0, gold, bank: 0, chips: 0, pos: null, lastSafePos: null, region: null, worn, grid: { cols: 8, rows: 6, cells: [] }, items, pets: [], activePetId: null,
    dead: false, missTurns: 0, deaths: 0, graveyardPos: null, diedTo: null, cooldowns: { active: 0 }, activeUses: 0, effects: [], pactIds: [], wanted: 0, kills: 0, titles: [], quests: [],
    usedThisTurn: { attack: 0, spell: 0, moved: false }, turnsTaken: 0, streak: 0, freeRestakeUsed: false, freeSmokeBombs: 0, buyinSpun: true, locked: true, creation: null };
}
// A playing room where every seat has a character; `boots(pid)` picks the boots per seat. The mover is whoever
// the shuffle put first; `cur` is their id and `c` their character.
function game({ seed = 42, boots = () => null, size = 'regular', fog = true, opts = () => ({}) } = {}) {
  const r = room({ seed, size }).join(names4);
  for (const pid of Object.keys(r.state.players)) { const c = makeChar('c_' + pid, pid, { boots: boots(pid), ...opts(pid) }); r.state.characters[c.id] = c; r.state.players[pid].characterId = c.id; }
  if (!fog) r.append('GM_CONFIG', { fogOfWar: false });
  r.append('RUN_START');
  const cur = currentPlayerId(r.state);
  return Object.assign(r, { cur, get c() { return characterOf(r.state, currentPlayerId(r.state)); }, me: () => characterOf(r.state, cur) });
}
const rig = (r, stream, value) => r.append('GM_RIG', { stream, value });
const legalDirs = (r, pid) => legalSteps(r.state, pid).filter(x => x.legal);
// A direction from the mover's hex whose target has no monster, so a step there does not end the move.
const freeDir = (r, pid) => legalDirs(r, pid).find(x => !x.stops);
// Put the mover somewhere specific (a GM teleport stand-in for tests).
function placeAt(r, key) { const c = r.me(); c.pos = key; c.region = r.state.map.hexes[key].regionId; }
// A land hex in a region with at least `n` passable neighbours and no special gate, for predictable walks.
function openHex(r, regionId, n = 3) {
  return Q.regionHexes(r.state, regionId).find(h => !h.gate && h.type !== 'throne' && H.neighbors(h).filter(x => Q.passable(r.state, H.key(x))).length >= n).key;
}

// ---- barefoot and dice ------------------------------------------------------------------------------------------

test('barefoot: plods movement.barefoot hexes one step at a time, resolves, then the action phase', () => {
  const r = game();
  assert.equal(r.state.turnPhase, 'move');
  r.append('MOVE_ROLL', {}, r.cur);
  const s = r.state.moveSession; assert.equal(s.mode, 'barefoot'); assert.equal(s.movesLeft, MV.barefoot); assert.equal(s.roll, MV.barefoot); assert.ok(s.legal.length);
  const d1 = freeDir(r, r.cur); r.append('MOVE_STEP', { dir: d1.dir }, r.cur);
  assert.equal(r.me().pos, d1.key); assert.equal(r.state.moveSession.movesLeft, MV.barefoot - 1); assert.equal(r.state.turnPhase, 'move');
  const d2 = freeDir(r, r.cur); r.append('MOVE_STEP', { dir: d2.dir }, r.cur);
  assert.equal(r.me().pos, d2.key); assert.equal(r.state.moveSession.done, true); assert.equal(r.state.moveSession.how, 'spent');
  assert.equal(r.state.turnPhase, 'action', 'no tile hook registered: straight to action'); assert.equal(r.me().usedThisTurn.moved, true);
  assert.match(r.try('MOVE_ROLL', {}, r.cur).message, /already moved/);
  assert.match(r.try('MOVE_STEP', { dir: 0 }, r.cur).message, /roll first/);
  r.append('TURN_END', {}, r.cur); assert.notEqual(currentPlayerId(r.state), r.cur); assert.equal(r.state.moveSession, null); assert.equal(r.state.turnPhase, 'move');
});

test('dice: a rigged d6 roll, MOVE_STOP whenever (d4/d6), moves-left bookkeeping, TV summary shows the roll', () => {
  const r = game({ boots: () => bootsItem('loaded_boots') });
  rig(r, 'dice', 4); r.append('MOVE_ROLL', {}, r.cur);
  const s = r.state.moveSession; assert.equal(s.mode, 'dice'); assert.equal(s.roll, 4); assert.deepEqual(s.dice, [6]); assert.equal(s.canStopAfter, 0); assert.equal(s.mustWalk, false);
  r.append('MOVE_STEP', { dir: freeDir(r, r.cur).dir }, r.cur);
  r.append('MOVE_STOP', {}, r.cur);
  assert.equal(r.state.moveSession.done, true); assert.equal(r.state.moveSession.how, 'stop'); assert.equal(r.state.moveSession.stepsTaken, 1); assert.equal(r.state.moveSession.unused, 3);
  const sum = moveSummary(r.state); assert.equal(sum.roll, 4); assert.equal(sum.path.length, 1); assert.equal(sum.endKey, r.me().pos);
  assert.ok(!JSON.stringify(sum).includes('colour'));
});

test('dice: d8/d10 may stop only after half the roll; d12/d20 walk it all unless blocked', () => {
  const r = game({ boots: () => bootsItem('knucklebone_greaves') });
  rig(r, 'dice', 6); r.append('MOVE_ROLL', {}, r.cur);
  assert.equal(r.state.moveSession.canStopAfter, 3);
  assert.match(r.try('MOVE_STOP', {}, r.cur).message, /walk at least 3/);
  for (let i = 0; i < 3; i++) r.append('MOVE_STEP', { dir: freeDir(r, r.cur).dir }, r.cur);
  r.append('MOVE_STOP', {}, r.cur); assert.equal(r.state.moveSession.how, 'stop'); assert.equal(r.state.moveSession.stepsTaken, 3);

  const r2 = game({ boots: () => bootsItem('dodeca_sabatons') });
  rig(r2, 'dice', 5); r2.append('MOVE_ROLL', {}, r2.cur);
  assert.equal(r2.state.moveSession.mustWalk, true); assert.equal(r2.state.moveSession.canStopAfter, 5);
  for (let i = 0; i < 4; i++) { assert.match(r2.try('MOVE_STOP', {}, r2.cur).message, /walk the full 5/); r2.append('MOVE_STEP', { dir: freeDir(r2, r2.cur).dir }, r2.cur); }
  assert.equal(r2.state.moveSession.done, false); r2.append('MOVE_STEP', { dir: freeDir(r2, r2.cur).dir }, r2.cur);
  assert.equal(r2.state.moveSession.done, true); assert.equal(r2.state.moveSession.how, 'spent');
  // blocked: wall the mover in and the big die lets go
  const r3 = game({ boots: () => bootsItem('fateful_treads') });
  rig(r3, 'dice', 9); r3.append('MOVE_ROLL', {}, r3.cur);
  const d = freeDir(r3, r3.cur); r3.append('MOVE_STEP', { dir: d.dir }, r3.cur);
  for (const n of H.neighbors(H.parse(r3.me().pos))) { const h = r3.state.map.hexes[H.key(n)]; if (h && !h.void) r3.state.monsters['mm' + h.key] = { id: 'mm' + h.key, name: 'wall of croupiers', pos: h.key, dead: false }; }
  // the player is surrounded by monsters: stepping onto one ends the move there, or MOVE_STOP is honoured as blocked
  const s = r3.state.moveSession; s.legal = []; // (legal is recomputed per step; simulate the blocked state the phone would show)
  r3.append('MOVE_STOP', {}, r3.cur); assert.equal(r3.state.moveSession.done, true);
});

test('dice: refusals — void, off-map, non-adjacent, bad dir, wrong seat, paused, dead', () => {
  const r = game({ boots: () => bootsItem('loaded_boots') });
  rig(r, 'dice', 6); r.append('MOVE_ROLL', {}, r.cur);
  const steps = legalSteps(r.state, r.cur); assert.equal(steps.length, 6);
  const wall = steps.find(x => !x.legal); assert.ok(wall, 'start has a void neighbour'); assert.ok(wall.reason);
  assert.match(r.try('MOVE_STEP', { dir: wall.dir }, r.cur).message, /impassable|off the map|blocked/);
  assert.match(r.try('MOVE_STEP', { dir: 9 }, r.cur).message, /dir must be/);
  assert.match(r.try('MOVE_STEP', { to: '99,99' }, r.cur).message, /off the map|not adjacent/);
  assert.match(r.try('MOVE_STEP', { to: r.me().pos }, r.cur).message, /not adjacent/);
  const other = Object.keys(r.state.players).find(p => p !== r.cur);
  assert.match(r.try('MOVE_STEP', { dir: 0 }, other).message, /cannot act/);
  assert.match(r.try('MOVE_ROLL', {}, other).message, /cannot act/);
  r.append('GM_PAUSE'); assert.match(r.try('MOVE_STEP', { dir: freeDir(r, r.cur).dir }, r.cur).message, /paused/); r.append('GM_RESUME');
  r.me().dead = true; assert.match(r.try('MOVE_STEP', { dir: 0 }, r.cur).message, /dead/); r.me().dead = false;
  const snap = JSON.stringify(r.state); r.try('MOVE_STEP', { dir: wall.dir }, r.cur); assert.equal(JSON.stringify(r.state), snap, 'a refused step changes nothing');
});

test('dice: a monster hex ends the move there; MOVE_PATH walks the shortest path and a wrong tap only costs the leftover', () => {
  const r = game({ boots: () => bootsItem('loaded_boots') });
  rig(r, 'dice', 6); r.append('MOVE_ROLL', {}, r.cur);
  const d = freeDir(r, r.cur);
  r.state.monsters.m1 = { id: 'm1', speciesId: 'card_shark', name: 'Card Shark', pos: d.key, dead: false, regionId: 'strip' };
  assert.ok(legalSteps(r.state, r.cur).find(x => x.key === d.key).stops);
  r.append('MOVE_STEP', { dir: d.dir }, r.cur);
  assert.equal(r.state.moveSession.done, true); assert.equal(r.state.moveSession.how, 'monster'); assert.equal(r.me().pos, d.key); assert.equal(r.state.turnPhase, 'action');
  // path tap
  const r2 = game({ boots: () => bootsItem('loaded_boots') });
  rig(r2, 'dice', 5); r2.append('MOVE_ROLL', {}, r2.cur);
  const two = Q.reachableFrom(r2.state, r2.me().pos, 2, r2.me().id).find(x => x.dist === 2);
  r2.append('MOVE_PATH', { to: two.key }, r2.cur);
  assert.equal(r2.me().pos, two.key); assert.equal(r2.state.moveSession.stepsTaken, 2); assert.equal(r2.state.moveSession.done, true); assert.equal(r2.state.moveSession.how, 'path');
  assert.match(r2.try('MOVE_PATH', { to: two.key }, r2.cur).message, /roll first/);
  // a tap further than the roll walks as far as it goes
  const r3 = game({ boots: () => bootsItem('loaded_boots') });
  rig(r3, 'dice', 2); r3.append('MOVE_ROLL', {}, r3.cur);
  const far = Q.reachableFrom(r3.state, r3.me().pos, 5, r3.me().id).filter(x => x.dist >= 4).at(-1); assert.ok(far);
  r3.append('MOVE_PATH', { to: far.key }, r3.cur);
  assert.equal(r3.state.moveSession.done, true); assert.equal(r3.state.moveSession.how, 'spent'); assert.equal(r3.state.moveSession.stepsTaken, 2); assert.equal(Q.pathTo(r3.state, r3.me().pos, far.key, r3.me().id).length, far.dist - 2, 'walked two steps of the shortest path');
  assert.match(r3.try('MOVE_PATH', { to: '99,99' }, r3.cur).message, /roll first/);
  // d12: a short tap does not end the move
  const r4 = game({ boots: () => bootsItem('dodeca_sabatons') });
  rig(r4, 'dice', 8); r4.append('MOVE_ROLL', {}, r4.cur);
  const one = Q.reachableFrom(r4.state, r4.me().pos, 1, r4.me().id)[0];
  r4.append('MOVE_PATH', { to: one.key }, r4.cur);
  assert.equal(r4.state.moveSession.done, false); assert.equal(r4.state.moveSession.movesLeft, 7);
  assert.match(r4.try('MOVE_PATH', { to: '99,99' }, r4.cur).message, /no path/);
});

test('gated bridge: level or key opens the Citadel; a toll gate takes Gold', () => {
  const r = game({ boots: () => bootsItem('fateful_treads') });
  const m = r.state.map;
  const gateHex = Object.values(m.hexes).find(h => h.bridge && h.gate && H.neighbors(h).some(n => { const o = m.hexes[H.key(n)]; return o && !o.void && !o.gate; }));
  const outside = H.neighbors(gateHex).map(n => m.hexes[H.key(n)]).find(o => o && !o.void && !o.gate);
  placeAt(r, outside.key);
  rig(r, 'dice', 3); r.append('MOVE_ROLL', {}, r.cur);
  const step = legalSteps(r.state, r.cur).find(x => x.key === gateHex.key);
  assert.equal(step.legal, false); assert.match(step.reason, /level 10|citadel key/);
  assert.match(r.try('MOVE_STEP', { to: gateHex.key }, r.cur).message, /gate needs level 10 or the citadel key/);
  assert.match(r.try('MOVE_PATH', { to: gateHex.key }, r.cur).message, /no path/);
  r.me().level = B.map.citadelLevel; r.append('MOVE_STEP', { to: gateHex.key }, r.cur);
  assert.equal(r.me().pos, gateHex.key); assert.equal(r.me().region, 'citadel');
  // key item instead of level
  const r2 = game({ boots: () => bootsItem('fateful_treads') }); placeAt(r2, outside.key);
  r2.me().items.key1 = { id: 'key1', baseId: 'citadel_key', name: 'Citadel Key', slot: 'tool' };
  rig(r2, 'dice', 3); r2.append('MOVE_ROLL', {}, r2.cur); r2.append('MOVE_STEP', { to: gateHex.key }, r2.cur); assert.equal(r2.me().pos, gateHex.key);
  // toll gate
  const r3 = game({ boots: () => bootsItem('loaded_boots') });
  rig(r3, 'dice', 2); r3.append('MOVE_ROLL', {}, r3.cur);
  const d = freeDir(r3, r3.cur); r3.state.map.hexes[d.key].gate = { level: null, keyItem: null, toll: 20 };
  assert.match(r3.try('MOVE_STEP', { dir: d.dir }, r3.cur).message, /20 Gold toll/);
  r3.me().gold = 25; r3.append('MOVE_STEP', { dir: d.dir }, r3.cur); assert.equal(r3.me().gold, 5); assert.ok(r3.state.ledger.some(x => x.why === 'gate toll'));
});

// ---- wheel ---------------------------------------------------------------------------------------------------------

test('wheel: rigged segments — a number, Sprint, Stumble; the TV sees the spin', () => {
  const r = game({ boots: () => bootsItem('croupiers_heels') });
  rig(r, 'wheels', '3'); r.append('MOVE_ROLL', {}, r.cur);
  assert.equal(r.state.moveSession.mode, 'wheel'); assert.equal(r.state.moveSession.movesLeft, 3); assert.equal(r.state.lastSpin.wheel, 'movement'); assert.equal(r.state.lastSpin.outcomes.length, 10);
  assert.equal(moveSummary(r.state).wheel, '3');
  r.append('MOVE_STOP', {}, r.cur); assert.equal(r.state.moveSession.done, true);
  r.append('TURN_END', {}, r.cur);
  const p2 = currentPlayerId(r.state);
  rig(r, 'wheels', 'sprint'); r.append('MOVE_ROLL', {}, p2);
  assert.equal(r.state.moveSession.movesLeft, MV.wheelSprint); assert.match(r.state.moveSession.wheel, /Sprint/);
  r.append('MOVE_STOP', {}, p2); r.append('TURN_END', {}, p2);
  const p3 = currentPlayerId(r.state);
  rig(r, 'wheels', 'stumble'); r.append('MOVE_ROLL', {}, p3);
  assert.equal(r.state.moveSession.done, true); assert.equal(r.state.moveSession.how, 'stay'); assert.equal(characterOf(r.state, p3).pos, r.state.map.start); assert.equal(r.state.turnPhase, 'action');
});

test('wheel: Swap trades places with the nearest player; an Enforcer cannot be swapped', () => {
  const r = game({ boots: () => bootsItem('croupiers_heels') });
  const others = Object.keys(r.state.players).filter(p => p !== r.cur);
  const spot = Q.reachableFrom(r.state, r.state.map.start, 3).find(x => x.dist === 3).key;
  const near = Q.reachableFrom(r.state, r.state.map.start, 1)[0].key;
  characterOf(r.state, others[0]).pos = spot; characterOf(r.state, others[1]).pos = near; characterOf(r.state, others[2]).pos = spot;
  rig(r, 'wheels', 'swap'); r.append('MOVE_ROLL', {}, r.cur);
  assert.equal(r.me().pos, near); assert.equal(characterOf(r.state, others[1]).pos, r.state.map.start); assert.equal(r.state.moveSession.how, 'swap'); assert.equal(moveSummary(r.state).swappedWith, others[1]);
  // enforcer target refuses
  const r2 = game({ boots: () => bootsItem('croupiers_heels'), opts: (pid) => ({ classId: 'enforcer' }) });
  const o = Object.keys(r2.state.players).filter(p => p !== r2.cur); for (const p of o) characterOf(r2.state, p).pos = spot;
  r2.me().classId = 'whale';
  rig(r2, 'wheels', 'swap'); r2.append('MOVE_ROLL', {}, r2.cur);
  assert.equal(r2.me().pos, r2.state.map.start); assert.equal(r2.state.moveSession.how, 'stay'); assert.ok(r2.state.log.some(l => /cannot be swapped/.test(l.text)));
});

test('wheel: Teleport prompts PORTAL_PICK; gated regions are not on offer; the arrival does not re-resolve the portal', () => {
  const r = game({ boots: () => bootsItem('croupiers_heels') });
  let hookCalls = 0; tileHooks.portal = () => { hookCalls++; };
  try {
    rig(r, 'wheels', 'teleport'); r.append('MOVE_ROLL', {}, r.cur);
    assert.equal(r.state.pendingPrompt.kind, 'portal'); assert.equal(r.state.pendingPrompt.playerId, r.cur); assert.ok(!r.state.pendingPrompt.options.includes('citadel')); assert.ok(r.state.pendingPrompt.options.includes('docks'));
    assert.match(r.try('MOVE_STEP', { dir: 0 }, r.cur).message, /portal prompt/);
    assert.match(r.try('PORTAL_PICK', { regionId: 'citadel' }, r.cur).message, /level 10/);
    assert.match(r.try('PORTAL_PICK', { regionId: 'nowhere' }, r.cur).message, /no such portal/);
    r.append('PORTAL_PICK', { regionId: 'docks' }, r.cur);
    assert.equal(r.me().pos, r.state.map.regions.docks.portalKey); assert.equal(r.me().region, 'docks'); assert.equal(r.state.pendingPrompt, null);
    assert.equal(r.state.moveSession.done, true); assert.equal(r.state.moveSession.how, 'portal'); assert.equal(r.state.turnPhase, 'action'); assert.equal(hookCalls, 0);
    assert.equal(r.state.map.revealed.docks, true, 'fog lifts on arrival');
    // a Portal tile's own prompt (set by the tiles module) is answered by the same event
    r.append('TURN_END', {}, r.cur); const p2 = currentPlayerId(r.state);
    r.state.pendingPrompt = { playerId: p2, kind: 'portal', options: ['blackwood'] }; r.state.turnPhase = 'resolve';
    r.append('PORTAL_PICK', { regionId: 'blackwood' }, p2);
    assert.equal(characterOf(r.state, p2).pos, r.state.map.regions.blackwood.portalKey); assert.equal(r.state.turnPhase, 'action');
    const r10 = game({ boots: () => bootsItem('croupiers_heels'), opts: () => ({ level: 10 }) });
    rig(r10, 'wheels', 'teleport'); r10.append('MOVE_ROLL', {}, r10.cur); assert.ok(r10.state.pendingPrompt.options.includes('citadel'));
  } finally { delete tileHooks.portal; }
});

// ---- card ----------------------------------------------------------------------------------------------------------

test('card: draw a colour, the phone sees colours and lit hexes, the TV sees only the end hex; a tap completes the move', () => {
  const r = game({ boots: (pid) => bootsItem('dyers_boots') });
  const me = r.me();
  const target = Q.reachableFrom(r.state, me.pos, 2, me.id).find(x => x.dist === 2);
  const colour = r.state.map.hexes[target.key].colour;
  rig(r, 'colours', colour); r.append('MOVE_ROLL', {}, r.cur);
  const s = r.state.moveSession; assert.equal(s.mode, 'card'); assert.equal(s.card.colour, colour); assert.equal(s.atomic, true);
  const expected = Q.nearestOfColour(r.state, me.pos, colour, MV.cardRange, me.id); assert.deepEqual(s.destinations, expected);
  assert.equal(r.state.map.colourDeck.length, B.map.secretColours.length * BOOTS.colourDeck.perColour + MV.colourDoubles - 1);
  const view = cardView(r.state, r.cur); assert.equal(view.card.colour, colour); assert.deepEqual(view.destinations, expected); assert.ok(view.hexes.every(h => B.map.secretColours.includes(h.colour))); assert.equal(view.range, MV.cardRange);
  const other = Object.keys(r.state.players).find(p => p !== r.cur);
  const otherView = cardView(r.state, other); assert.equal(otherView.card, null); assert.deepEqual(otherView.destinations, [], 'another Card wearer sees their own colours but not this card');
  characterOf(r.state, other).worn.boots = null; assert.equal(cardView(r.state, other), null, 'no Card boots, no card view');
  const tv = JSON.stringify(moveSummary(r.state)); for (const c of B.map.secretColours) assert.ok(!tv.includes(c), 'TV summary leaks ' + c); assert.ok(!tv.includes('destinations') && !tv.includes('"card":') && !tv.includes('peek'));
  assert.ok(legalSteps(r.state, r.cur).every(x => !x.legal));
  assert.match(r.try('MOVE_STEP', { dir: 0 }, r.cur).message, /lit hexes/); assert.match(r.try('MOVE_STOP', {}, r.cur).message, /cannot stop short/);
  assert.match(r.try('MOVE_STEP', { to: '99,99' }, r.cur).message, /not one of the lit/);
  r.append('MOVE_STEP', { to: expected[0] }, r.cur);
  assert.equal(r.me().pos, expected[0]); assert.equal(r.state.moveSession.done, true); assert.equal(r.state.moveSession.how, 'card'); assert.equal(moveSummary(r.state).endKey, expected[0]); assert.equal(moveSummary(r.state).path, null);
});

test('card: a double goes to the second-nearest; no match in range steps cardNoMatchStep; the deck reshuffles when empty and is rig-aware', () => {
  const r = game({ boots: () => bootsItem('dyers_boots') });
  const me = r.me(); const colour = B.map.secretColours[0];
  // paint: nearest at 1, second-nearest at 2, nothing else of that colour in range
  for (const x of Q.reachableFrom(r.state, me.pos, MV.cardRange + 1)) if (r.state.map.hexes[x.key].colour === colour) r.state.map.hexes[x.key].colour = B.map.secretColours[1];
  const one = Q.reachableFrom(r.state, me.pos, 1, me.id)[0].key, two = Q.reachableFrom(r.state, me.pos, 2, me.id).find(x => x.dist === 2).key;
  r.state.map.hexes[one].colour = colour; r.state.map.hexes[two].colour = colour;
  rig(r, 'colours', colour + '!'); r.append('MOVE_ROLL', {}, r.cur);
  assert.equal(r.state.moveSession.card.double, true); assert.deepEqual(r.state.moveSession.destinations, [two]);
  r.append('MOVE_PATH', { to: two }, r.cur); assert.equal(r.me().pos, two); assert.equal(r.state.moveSession.done, true);
  // no match
  r.append('TURN_END', {}, r.cur); const p2 = currentPlayerId(r.state); const c2 = characterOf(r.state, p2);
  const none = B.map.secretColours[2]; for (const x of Q.reachableFrom(r.state, c2.pos, MV.cardRange)) if (r.state.map.hexes[x.key].colour === none) r.state.map.hexes[x.key].colour = B.map.secretColours[3];
  rig(r, 'colours', none); r.append('MOVE_ROLL', {}, p2);
  assert.equal(r.state.moveSession.atomic, false); assert.equal(r.state.moveSession.movesLeft, MV.cardNoMatchStep); assert.equal(cardView(r.state, p2).noMatch, true);
  r.append('MOVE_STEP', { dir: freeDir(r, p2).dir }, p2); assert.equal(r.state.moveSession.done, true);
  // reshuffle: empty the deck and draw
  r.append('TURN_END', {}, p2); const p3 = currentPlayerId(r.state);
  r.state.map.colourDeck = []; r.append('MOVE_ROLL', {}, p3);
  assert.equal(r.state.map.colourDeck.length, B.map.secretColours.length * BOOTS.colourDeck.perColour + MV.colourDoubles - 1);
});

// ---- boots swap, uniques and affixes --------------------------------------------------------------------------------

test('MOVE_SWAP_BOOTS: changing boots costs the move; refused after rolling or out of phase', () => {
  const r = game({ boots: () => bootsItem('loaded_boots') });
  const me = r.me(); const spare = bootsItem('dyers_boots'); me.items[spare.id] = spare; me.grid.cells.push({ itemId: spare.id, x: 0, y: 0, rot: 0, qty: 1 });
  assert.match(r.try('MOVE_SWAP_BOOTS', { itemId: 'nope' }, r.cur).message, /no such item/);
  r.append('MOVE_SWAP_BOOTS', { itemId: spare.id }, r.cur);
  assert.equal(me.worn.boots.id, spare.id); assert.equal(me.grid.cells[0].itemId, 'it_loaded_boots'); assert.equal(me.usedThisTurn.moved, true); assert.equal(r.state.turnPhase, 'action'); assert.equal(me.pos, r.state.map.start);
  assert.match(r.try('MOVE_ROLL', {}, r.cur).message, /already moved|not the move phase/);
  assert.equal(moveSummary(r.state).mode, 'swapboots');
  r.append('TURN_END', {}, r.cur); const p2 = currentPlayerId(r.state); const c2 = characterOf(r.state, p2);
  const sp2 = bootsItem('croupiers_heels'); c2.items[sp2.id] = sp2;
  rig(r, 'dice', 2); r.append('MOVE_ROLL', {}, p2);
  assert.match(r.try('MOVE_SWAP_BOOTS', { itemId: sp2.id }, p2).message, /already rolled/);
});

test('uniques: choosemode picks the mode per turn, movetwice allows a second roll, skates roll 2d6 and slide, octane reshapes the wheel and bumps', () => {
  // choosemode
  const r = game({ boots: () => bootsItem('loaded_boots', { id: 'it_leg', baseId: 'legendary_choose', unique: 'choosemode', die: 8, name: 'Seven-League Loafers' }) });
  assert.match(r.try('MOVE_ROLL', {}, r.cur).message, /choose a mode/);
  rig(r, 'wheels', '2'); r.append('MOVE_ROLL', { mode: 'wheel' }, r.cur); assert.equal(r.state.moveSession.mode, 'wheel'); assert.equal(r.state.moveSession.movesLeft, 2);
  r.append('MOVE_STOP', {}, r.cur); r.append('TURN_END', {}, r.cur);
  const p2 = currentPlayerId(r.state); rig(r, 'dice', 7); r.append('MOVE_ROLL', { mode: 'dice' }, p2); assert.equal(r.state.moveSession.roll, 7); assert.deepEqual(r.state.moveSession.dice, [8]);
  // movetwice
  const r2 = game({ boots: () => bootsItem('loaded_boots', { unique: 'movetwice' }) });
  rig(r2, 'dice', 1); r2.append('MOVE_ROLL', {}, r2.cur); r2.append('MOVE_STEP', { dir: freeDir(r2, r2.cur).dir }, r2.cur);
  assert.equal(r2.state.turnPhase, 'action');
  rig(r2, 'dice', 1); r2.append('MOVE_ROLL', {}, r2.cur); assert.equal(r2.state.turnPhase, 'move'); assert.equal(r2.state.moveSession.done, false);
  r2.append('MOVE_STEP', { dir: freeDir(r2, r2.cur).dir }, r2.cur); assert.equal(r2.me().usedThisTurn.moves, 2);
  assert.match(r2.try('MOVE_ROLL', {}, r2.cur).message, /already moved|not the move phase/);
  // skates
  const r3 = game({ boots: () => bootsItem('loaded_boots', { unique: 'skates', name: 'Skates of the Sixth' }) });
  placeAt(r3, openHex(r3, 'strip', 4));
  rig(r3, 'dice', 1); rig(r3, 'dice', 1); r3.append('MOVE_ROLL', {}, r3.cur);
  const s3 = r3.state.moveSession; assert.deepEqual(s3.dice, [6, 6]); assert.equal(s3.roll, 2); assert.equal(s3.mustWalk, true); assert.equal(s3.slide, true);
  assert.match(r3.try('MOVE_STOP', {}, r3.cur).message, /full 2/);
  // walk two in a straight line where a third hex is free, expect the slide
  const start3 = H.parse(r3.me().pos);
  const dir = [0, 1, 2, 3, 4, 5].find(d => [1, 2, 3].every(i => { const k = H.key(H.add(start3, { q: H.DIRS[d].q * i, r: H.DIRS[d].r * i })); return Q.passable(r3.state, k, r3.me().id) && !Q.stopsHere(r3.state, k); }));
  if (dir != null) {
    r3.append('MOVE_STEP', { dir }, r3.cur); r3.append('MOVE_STEP', { dir }, r3.cur);
    assert.equal(r3.state.moveSession.done, true); assert.equal(r3.state.moveSession.slid, true); assert.equal(r3.state.moveSession.path.length, 3);
    assert.equal(r3.me().pos, H.key(H.add(start3, { q: H.DIRS[dir].q * 3, r: H.DIRS[dir].r * 3 })));
  }
  // octane
  const oct = bootsItem('croupiers_heels', { unique: 'octane', name: 'Octane Treads' });
  const segs = wheelSegments(oct, bootAffixes(oct), MV);
  assert.ok(!segs.some(s => s.id === 'stumble')); assert.equal(segs.filter(s => /Boost/.test(s.label) && s.steps === MV.wheelSprint).length, 2);
  const r4 = game({ boots: (pid) => bootsItem('croupiers_heels', { unique: 'octane' }) });
  const other = Object.keys(r4.state.players).find(p => p !== r4.cur), oc = characterOf(r4.state, other);
  const near2 = Q.reachableFrom(r4.state, r4.me().pos, 2, r4.me().id).find(x => x.dist === 2).key; oc.pos = near2;
  const stepKey = Q.pathTo(r4.state, r4.me().pos, near2)[0];
  rig(r4, 'wheels', '1'); r4.append('MOVE_ROLL', {}, r4.cur); r4.append('MOVE_STEP', { to: stepKey }, r4.cur);
  const away = H.key(H.neighbor(H.parse(near2), H.dirIndex(H.parse(stepKey), H.parse(near2))));
  if (Q.passable(r4.state, away)) { assert.equal(oc.pos, away, 'bumped one hex away'); } else assert.equal(oc.pos, near2);
});

test('affixes: dieUp, twoDice, rerollOnes, keepStop, homeBonus, noStumble, extraSprint, peekTop, drawTwo, range6, moreDoubles', () => {
  const with_ = (base, ...ids) => bootsItem(base, { affixes: ids.map(affix) });
  // dieUp: d6 → d8 (and so the half rule)
  let r = game({ boots: () => with_('loaded_boots', 'dieUp') }); rig(r, 'dice', 8); r.append('MOVE_ROLL', {}, r.cur); assert.deepEqual(r.state.moveSession.dice, [8]); assert.equal(r.state.moveSession.roll, 8); assert.equal(r.state.moveSession.canStopAfter, 4);
  // twoDice: d8 → 2d6, rule of the d8
  r = game({ boots: () => with_('knucklebone_greaves', 'twoDice') }); rig(r, 'dice', 3); rig(r, 'dice', 4); r.append('MOVE_ROLL', {}, r.cur); assert.deepEqual(r.state.moveSession.dice, [6, 6]); assert.deepEqual(r.state.moveSession.rolls, [3, 4]); assert.equal(r.state.moveSession.roll, 7); assert.equal(r.state.moveSession.canStopAfter, 4);
  // rerollOnes
  r = game({ boots: () => with_('loaded_boots', 'rerollOnes') }); rig(r, 'dice', 1); rig(r, 'dice', 5); r.append('MOVE_ROLL', {}, r.cur); assert.equal(r.state.moveSession.roll, 5);
  // keepStop on a d20
  r = game({ boots: () => with_('fateful_treads', 'keepStop') }); rig(r, 'dice', 13); r.append('MOVE_ROLL', {}, r.cur); assert.equal(r.state.moveSession.canStopAfter, 0); r.append('MOVE_STOP', {}, r.cur); assert.equal(r.state.moveSession.done, true);
  // homeBonus: +1 in the region the boots came from
  r = game({ boots: () => bootsItem('loaded_boots', { affixes: [affix('homeBonus')], region: 'strip' }) }); rig(r, 'dice', 2); r.append('MOVE_ROLL', {}, r.cur); assert.equal(r.state.moveSession.roll, 3);
  r = game({ boots: () => bootsItem('loaded_boots', { affixes: [affix('homeBonus')], region: 'docks' }) }); rig(r, 'dice', 2); r.append('MOVE_ROLL', {}, r.cur); assert.equal(r.state.moveSession.roll, 2);
  // wheel affixes
  const w = with_('croupiers_heels', 'noStumble', 'extraSprint'); const segs = wheelSegments(w, bootAffixes(w), MV);
  assert.ok(!segs.some(s => s.id === 'stumble')); assert.equal(segs.filter(s => /Sprint/.test(s.label)).length, 2); assert.equal(segs.length, 10);
  // card affixes
  r = game({ boots: () => with_('dyers_boots', 'peekTop', 'drawTwo', 'range6', 'moreDoubles') });
  r.state.map.colourDeck = []; r.append('MOVE_ROLL', {}, r.cur);
  const s = r.state.moveSession; assert.equal(s.range, MV.cardRangeExtended); assert.equal(s.cards.length, 2); assert.ok(s.peek && s.peek.colour);
  assert.equal(r.state.map.colourDeck.length, B.map.secretColours.length * BOOTS.colourDeck.perColour + MV.colourDoubles * 2 - 2);
  const v = cardView(r.state, r.cur); assert.equal(v.cards.length, 2); assert.equal(v.peek.colour, r.state.map.colourDeck.at(-1).colour); assert.equal(v.range, MV.cardRangeExtended);
  if (s.atomic) { r.append('MOVE_STEP', { to: s.destinations[0] }, r.cur); assert.equal(r.state.moveSession.done, true); }
});

// ---- tile hook contract, safe tiles, fog, determinism -------------------------------------------------------------

test('tile hook: receives (state, ctx, playerId, hex); may leave resolve open with a prompt; lastSafePos on safe tiles; fog lifts', () => {
  const r = game({ boots: () => bootsItem('fateful_treads') });
  const inn = Q.regionHexes(r.state, 'strip', 'inn')[0];
  const path = Q.pathTo(r.state, r.state.map.start, inn.key, r.me().id);
  const calls = [];
  tileHooks.inn = (state, ctx, pid, hex) => { calls.push({ pid, key: hex.key, phase: state.turnPhase, now: ctx.now }); state.pendingPrompt = { playerId: pid, kind: 'inn' }; };
  try {
    rig(r, 'dice', path.length); r.append('MOVE_ROLL', {}, r.cur);
    r.append('MOVE_PATH', { to: inn.key }, r.cur);
    assert.equal(r.me().pos, inn.key); assert.deepEqual(calls, [{ pid: r.cur, key: inn.key, phase: 'resolve', now: r.now() }]);
    assert.equal(r.state.turnPhase, 'resolve', 'the hook left a prompt open'); assert.equal(r.me().lastSafePos, inn.key);
  } finally { delete tileHooks.inn; }
  // a hook that finishes sets action itself (or leaves it to movement)
  const r2 = game({ boots: () => bootsItem('fateful_treads') });
  const shop = Q.regionHexes(r2.state, 'strip', 'shop')[0]; const p2 = Q.pathTo(r2.state, r2.state.map.start, shop.key, r2.me().id);
  tileHooks.shop = (state) => { state.turnPhase = 'action'; };
  try { rig(r2, 'dice', p2.length); r2.append('MOVE_ROLL', {}, r2.cur); r2.append('MOVE_PATH', { to: shop.key }, r2.cur); assert.equal(r2.state.turnPhase, 'action'); assert.equal(r2.me().lastSafePos, r2.state.map.start, 'a shop is not a safe tile'); }
  finally { delete tileHooks.shop; }
  // fog: walking into the Docks reveals it
  const r3 = game({ boots: () => bootsItem('fateful_treads') });
  const docksHex = Q.regionHexes(r3.state, 'docks').find(h => !h.bridge); const edge = Object.values(r3.state.map.hexes).find(h => !h.void && h.regionId === 'strip' && H.neighbors(h).some(n => r3.state.map.hexes[H.key(n)]?.regionId === 'docks' && !r3.state.map.hexes[H.key(n)].void));
  placeAt(r3, edge.key); assert.equal(r3.state.map.revealed.docks, undefined);
  const into = H.neighbors(edge).map(n => r3.state.map.hexes[H.key(n)]).find(h => h && !h.void && h.regionId === 'docks');
  rig(r3, 'dice', 1); r3.append('MOVE_ROLL', {}, r3.cur); r3.append('MOVE_STEP', { to: into.key }, r3.cur);
  assert.equal(r3.state.map.revealed.docks, true); assert.equal(r3.me().region, 'docks'); assert.ok(docksHex);
});

test('determinism: the same seed and events replay to the same state, and the map stream is untouched by movement', () => {
  const play = () => {
    const r = game({ seed: 77, boots: (pid) => (pid === 'p0' ? bootsItem('dyers_boots') : pid === 'p1' ? bootsItem('croupiers_heels') : bootsItem('knucklebone_greaves')) });
    for (let t = 0; t < 8; t++) {
      const pid = currentPlayerId(r.state);
      r.append('MOVE_ROLL', {}, pid);
      let guard = 0;
      while (!r.state.moveSession.done && guard++ < 30) {
        const s = r.state.moveSession;
        if (s.awaiting === 'portal') { r.append('PORTAL_PICK', { regionId: r.state.pendingPrompt.options[0] }, pid); break; }
        if (s.atomic) { r.append('MOVE_STEP', { to: s.destinations[0] }, pid); break; }
        const d = legalDirs(r, pid)[0]; if (!d) { r.append('MOVE_STOP', {}, pid); break; }
        r.append('MOVE_STEP', { dir: d.dir }, pid);
      }
      r.tick(1000); r.append('TURN_END', {}, pid);
    }
    return r.state;
  };
  const a = play(), b = play();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.rng.map, shared.rngx.makeStreams(77).map === a.rng.map ? a.rng.map : a.rng.map, 'map stream position is whatever generation left');
  const fresh = room({ seed: 77 }).join(names4); fresh.append('RUN_START'); assert.equal(a.rng.map, fresh.state.rng.map, 'movement never draws from the map stream');
  assert.ok(a.round >= 2);
});
