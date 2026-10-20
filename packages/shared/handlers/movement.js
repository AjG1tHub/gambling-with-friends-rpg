// Movement (SPEC.md › Boots and movement modes, A turn). The boots on your feet when you start the move decide
// the mode: Dice (roll, then step up to the roll with the die's stop rule), Wheel (spin the movement wheel: 1–6,
// Sprint, Stumble, Teleport to a Portal, Swap with the nearest player) or Card (draw a colour and jump to the
// nearest hex of that colour in range). Barefoot plods `movement.barefoot`.
//
// Events (the mover's phone, or the GM for a proxied seat):
//   MOVE_ROLL {mode?}           roll / spin / draw; opens state.moveSession
//   MOVE_STEP {dir 0-5 | to}    one hex; in Card mode `to` = a lit destination completes the whole move
//   MOVE_STOP                   stop early where the die's stop rule allows
//   MOVE_PATH {to}              walk the shortest path towards `to`, as far as the moves left allow
//   MOVE_SWAP_BOOTS {itemId}    change boots instead of moving (costs the turn's move)
//   PORTAL_PICK {regionId}      answer a portal prompt (the wheel's Teleport, or a Portal tile hook's prompt)
//
// When a move ends (stop, out of moves, a monster hex, a Card jump) the character's pos/region are final, the
// region is revealed, lastSafePos is updated on safe tiles, turnPhase becomes 'resolve' and the tile hook for the
// hex type runs: `tileHooks[hex.type](state, ctx, playerId, hex)` (hooks.js; registered by the tiles/encounters
// module). The hook may set turnPhase 'action' itself, or leave it 'resolve' while a fight or pendingPrompt is
// open; when it does neither (or no hook exists) movement sets 'action'.
//
// Hidden information: the colour card and the hexes' colours only ever appear in `cardView` (the mover's
// phone). `moveSummary` is what the TV may show: the roll, the wheel stop, or just where a Card mover ended.
import { register, refuse, requirePhase, requireActor, requireNotPaused } from '../reducer.js';
import { currentPlayerId, characterOf, activeSeats, note } from '../state.js';
import { streamRng, rigAwareInt, rigAwareWeightedIndex, rigged } from '../rng.js';
import { hooks as runHooks } from './run.js';
import { tileHooks, moveHooks } from '../hooks.js';
import { gold } from '../health.js';
import { group } from '../balance.js';
import * as H from '../hex.js';
import { generateMap, REGION_ORDER } from '../map/generator.js';
import * as Q from '../map/query.js';
import bootsRaw from '../../../data/boots.json' with { type: 'json' };

export const BOOTS = bootsRaw;
const BASES = Object.fromEntries(bootsRaw.bases.map(b => [b.id, b]));
const MODES = ['dice', 'wheel', 'card'];
const DIE_SIZES = bootsRaw.dieSizes;

// ---- boots introspection ------------------------------------------------------------------------------------------

export const bootsOf = (c) => c?.worn?.boots || null;
const baseOf = (item) => (item ? BASES[item.baseId] || BASES[item.id] || null : null);
// Movement affixes on a boots item: { id, kind: 'movement' } (the id is one of data/boots.json › affixes).
export function bootAffixes(item) {
  const out = new Set();
  for (const a of item?.affixes || []) { if (a.kind !== 'movement') continue; const id = bootsRaw.affixes[a.id] ? a.id : (bootsRaw.affixes[a.value] ? a.value : null); if (id) out.add(id); }
  return out;
}
// Which mode these boots move in; `choosemode` boots take it from the event payload.
export function bootMode(item, payload = {}) {
  if (!item) return 'barefoot';
  if (item.unique === 'choosemode') { if (!MODES.includes(payload.mode)) refuse('choose a mode: dice, wheel or card', 'mode'); return payload.mode; }
  if (item.unique === 'skates') return 'dice';
  if (item.unique === 'octane') return 'wheel';
  return item.bootMode || baseOf(item)?.mode || 'dice';
}
const dieUp = (d) => DIE_SIZES[Math.min(DIE_SIZES.length - 1, Math.max(0, DIE_SIZES.indexOf(d)) + 1)] || d;
const dieDown = (d) => DIE_SIZES[Math.max(0, DIE_SIZES.indexOf(d) - 1)] || d;
export function bootDie(item, affixes = bootAffixes(item)) {
  let d = item?.die || baseOf(item)?.die || bootsRaw.defaults.chooseModeDie;
  if (affixes.has('dieUp')) d = dieUp(d);
  return d;
}
// any | half | never, from the die size and the balance lists.
export function stopRuleFor(die, item, affixes, MV) {
  if (item?.unique === 'skates') return 'never';
  if (affixes.has('keepStop')) return 'any';
  if (MV.fullWalkDice.includes(die)) return 'never';
  if (MV.halfStopDice.includes(die)) return 'half';
  return 'any';
}
// The movement wheel for these boots (Octane and the wheel affixes reshape it).
export function wheelSegments(item, affixes, MV) {
  let segs = bootsRaw.wheel.segments.map(s => ({ ...s, steps: s.stepsKey ? MV[s.stepsKey] : s.steps }));
  if (item?.unique === 'octane' || affixes.has('noStumble')) segs = segs.filter(s => s.id !== 'stumble');
  if (item?.unique === 'octane') { const b = bootsRaw.wheel.boost; const boost = { ...b, steps: MV[b.stepsKey], label: `${b.label} ${MV[b.stepsKey]}` }; segs.push({ ...boost, id: 'boost1' }, { ...boost, id: 'boost2' }); }
  if (affixes.has('extraSprint')) { const s = segs.find(x => x.id === 'sprint'); segs.push({ ...s, id: 'sprint2' }); }
  return segs.map(s => (s.steps != null && !/\d/.test(s.label) ? { ...s, label: `${s.label} ${s.steps}` } : s));
}
const broadsidePenalty = (c, ctx) => (c.worn?.mainhand?.unique === 'broadside' ? ctx.B('legendaries').broadsideMovePenalty : 0);

// ---- the colour deck (Card boots) ----------------------------------------------------------------------------------

function refillDeck(state, M, MV, affixes) {
  const cards = [];
  for (const colour of M.secretColours) for (let i = 0; i < bootsRaw.colourDeck.perColour; i++) cards.push({ colour, double: false });
  const doubles = MV.colourDoubles * (affixes.has('moreDoubles') ? 2 : 1);
  for (let i = 0; i < doubles; i++) cards.push({ colour: M.secretColours[i % M.secretColours.length], double: true });
  state.map.colourDeck = streamRng(state, 'colours').shuffle(cards);
}
// Draw the top card. A GM rig on the 'colours' stream names a colour ('Brass', or 'Brass!' for the double).
function drawCard(state, M, MV, affixes) {
  if (!state.map.colourDeck.length) refillDeck(state, M, MV, affixes);
  const deck = state.map.colourDeck;
  const r = rigged(state, 'colours');
  if (r) {
    const want = String(r.value), dbl = want.endsWith('!'), colour = want.replace(/!$/, '');
    let i = deck.findIndex(cd => cd.colour === colour && cd.double === dbl); if (i < 0) i = deck.findIndex(cd => cd.colour === colour);
    if (i >= 0) return deck.splice(i, 1)[0];
  }
  return deck.pop();
}

// ---- sessions ------------------------------------------------------------------------------------------------------

function legalKeys(state, c) {
  const out = [];
  for (const n of H.neighbors(H.parse(c.pos))) { const k = H.key(n); if (Q.passable(state, k, c.id)) out.push(k); }
  return out;
}
function newSession(pid, c, mode, extra = {}) {
  return { playerId: pid, charId: c.id, mode, roll: 0, movesLeft: 0, stepsTaken: 0, path: [], from: c.pos, mustWalk: false, canStopAfter: 0,
    legal: [], card: null, cards: null, destinations: null, atomic: false, dice: null, die: null, wheel: null, slide: false, octane: false, lastDir: null, awaiting: null, done: false, how: null, endKey: null, ...extra };
}
function requireMover(state, ctx) {
  requirePhase(state, 'playing'); requireNotPaused(state, ctx);
  const pid = currentPlayerId(state); if (!pid) refuse('nobody to move');
  requireActor(state, ctx, pid);
  const c = characterOf(state, pid); if (!c) refuse('no character');
  if (c.dead) refuse('the dead do not move', 'dead');
  if (!state.map || !c.pos) refuse('not on the map');
  c.usedThisTurn ||= { attack: 0, spell: 0, moved: false };
  return { pid, c };
}
function requireSession(state, ctx) {
  const { pid, c } = requireMover(state, ctx);
  const s = state.moveSession; if (!s || s.done || s.playerId !== pid) refuse('roll first', 'nosession');
  if (s.awaiting) refuse(`answer the ${s.awaiting} prompt first`, 'prompt');
  return { pid, c, s };
}
function nearestOtherCharacter(state, c) {
  let best = null, bd = Infinity;
  for (const pid of activeSeats(state)) {
    const o = characterOf(state, pid); if (!o || o.id === c.id || o.dead || !o.pos) continue;
    const d = Q.hexDistance(c.pos, o.pos); if (d < bd) { bd = d; best = o; }
  }
  return best;
}
const nameOf = (state, pid) => state.players[pid]?.name || pid;

// One validated step. Returns why the move ended ('monster' | 'spent' | 'blocked') or null to keep going.
function stepTo(state, ctx, pid, c, key) {
  const s = state.moveSession, from = c.pos, h = Q.hexAt(state, key);
  if (!h) refuse('off the map');
  if (H.distance(H.parse(from), H.parse(key)) !== 1) refuse('not adjacent');
  if (h.void) refuse(`${Q.tileLabel(h.type)} is impassable`, 'void');
  if (h.type === 'blocker') refuse('the way is blocked', 'void');
  const why = Q.gateBlocks(state, c, h); if (why) refuse(why, 'gate');
  if (s.movesLeft <= 0) refuse('no moves left');
  const toll = Q.tollDue(c, h); if (toll) gold(state, c, -toll, 'gate toll', ctx);
  c.pos = key; c.region = h.regionId; s.path.push(key); s.movesLeft -= 1; s.stepsTaken += 1; s.lastDir = H.dirIndex(H.parse(from), H.parse(key));
  for (const hk of moveHooks.afterStep) hk(state, ctx, pid, h);
  if (Q.stopsHere(state, key)) return 'monster';
  if (s.movesLeft === 0) return 'spent';
  s.legal = legalKeys(state, c);
  if (!s.legal.length) return 'blocked';
  return null;
}
// Skates of the Sixth: one extra hex in the last direction once the roll is spent.
function slide(state, ctx, pid, c) {
  const s = state.moveSession; if (!s.slide || s.lastDir == null || s.slid) return;
  const k = H.key(H.neighbor(H.parse(c.pos), s.lastDir)); const h = Q.hexAt(state, k);
  if (!h || !Q.passable(state, k, c.id)) return;
  s.slid = true; c.pos = k; c.region = h.regionId; s.path.push(k);
  note(state, `${nameOf(state, pid)} slides one more`, 'move', ctx.now);
}
// Octane Treads: ending next to a player bumps them one hex away.
function octaneBump(state, ctx, pid, c) {
  const here = H.parse(c.pos);
  for (const seat of activeSeats(state)) {
    const o = characterOf(state, seat); if (!o || o.id === c.id || o.dead || !o.pos) continue;
    const there = H.parse(o.pos); if (H.distance(here, there) !== 1) continue;
    const dir = H.dirIndex(here, there); const k = H.key(H.neighbor(there, dir)); const h = Q.hexAt(state, k);
    if (!h || !Q.passable(state, k, o.id) || Q.stopsHere(state, k)) continue;
    o.pos = k; o.region = h.regionId;
    note(state, `${nameOf(state, pid)} bumps ${nameOf(state, seat)} a hex`, 'move', ctx.now);
  }
}

function finishMove(state, ctx, pid, c, how, { skipTile = false } = {}) {
  const s = state.moveSession, hex = Q.hexAt(state, c.pos);
  if (s) { s.done = true; s.how = how; s.endKey = c.pos; s.legal = []; s.awaiting = null; s.unused = s.movesLeft; s.movesLeft = 0; }
  c.region = hex.regionId;
  if (Q.reveal(state, hex.regionId)) note(state, `${nameOf(state, pid)} enters ${state.map.regions[hex.regionId].name}`, 'map', ctx.now);
  if (Q.isSafeTile(hex.type)) c.lastSafePos = c.pos;
  c.usedThisTurn.moved = true; c.usedThisTurn.moves = (c.usedThisTurn.moves || 0) + 1;
  if (s?.octane) octaneBump(state, ctx, pid, c);
  note(state, `${nameOf(state, pid)} ${how === 'stay' ? 'stays' : 'lands'} on ${Q.tileLabel(hex.type)}`, 'move', ctx.now);
  state.turnPhase = 'resolve';
  for (const hk of moveHooks.afterMove) hk(state, ctx, pid, hex);
  if (skipTile) { state.turnPhase = 'action'; return; }
  const hook = tileHooks[hex.type];
  if (hook) hook(state, ctx, pid, hex);
  if (state.turnPhase === 'resolve' && !(state.fight && !state.fight.done) && !state.pendingPrompt) state.turnPhase = 'action';
}
function endIfOver(state, ctx, pid, c, end) {
  if (!end) return false;
  if (end === 'spent') slide(state, ctx, pid, c);
  finishMove(state, ctx, pid, c, end);
  return true;
}
// Complete an atomic Card jump to a lit destination.
function jumpTo(state, ctx, pid, c, to) {
  const s = state.moveSession;
  if (!s.destinations.includes(to)) refuse('not one of the lit hexes', 'card');
  const range = s.range;
  const path = Q.pathTo(state, c.pos, to, c.id, range) || [to];
  const h = Q.hexAt(state, to); const toll = Q.tollDue(c, h); if (toll) gold(state, c, -toll, 'gate toll', ctx);
  if (s.cards) s.card = s.cards.find(cd => cd.destinations.includes(to))?.card || s.card;
  c.pos = to; s.path = path; s.stepsTaken = path.length; s.movesLeft = 0;
  finishMove(state, ctx, pid, c, 'card');
}

// ---- handlers ------------------------------------------------------------------------------------------------------

register({
  MOVE_ROLL(state, ev, ctx) {
    const { pid, c } = requireMover(state, ctx);
    const M = ctx.B('map'), MV = ctx.B('movement');
    const item = bootsOf(c), affixes = bootAffixes(item);
    const secondMove = item?.unique === 'movetwice' && (c.usedThisTurn.moves || 0) === 1 && state.turnPhase === 'action';
    if (state.moveSession && !state.moveSession.done && state.moveSession.playerId === pid) refuse('already rolled: step or stop', 'rolled');
    if (!secondMove) { if (c.usedThisTurn.moved) refuse('already moved this turn', 'moved'); if (state.turnPhase !== 'move') refuse(`not the move phase (${state.turnPhase})`, 'phase'); }
    if (state.fight && !state.fight.done && (state.fight.playerIds || []).includes(pid)) refuse('finish the fight first', 'fight');
    if (state.pendingPrompt) refuse('answer the prompt first', 'prompt');
    const mode = bootMode(item, ctx.payload);
    const who = nameOf(state, pid), pen = broadsidePenalty(c, ctx);
    state.turnPhase = 'move';

    if (mode === 'barefoot' || mode === 'dice') {
      let dice, die = null, rule = 'any';
      if (mode === 'barefoot') { dice = []; }
      else {
        die = bootDie(item, affixes); rule = stopRuleFor(die, item, affixes, MV);
        if (item.unique === 'skates') dice = Array.from({ length: bootsRaw.defaults.skatesDice }, () => bootsRaw.defaults.skatesDie);
        else if (affixes.has('twoDice')) dice = [dieDown(die), dieDown(die)];
        else dice = [die];
      }
      const rolls = dice.map(d => { let v = rigAwareInt(state, 'dice', 1, d); if (v === 1 && affixes.has('rerollOnes')) v = rigAwareInt(state, 'dice', 1, d); return v; });
      let total = mode === 'barefoot' ? MV.barefoot : rolls.reduce((a, b) => a + b, 0);
      if (mode === 'dice' && affixes.has('homeBonus') && item.region && item.region === c.region) total += 1;
      total = Math.max(0, total - pen);
      const s = state.moveSession = newSession(pid, c, mode, { roll: total, movesLeft: total, dice, rolls, die, stopRule: rule, slide: item?.unique === 'skates',
        mustWalk: rule === 'never', canStopAfter: rule === 'any' ? 0 : rule === 'half' ? Math.ceil(total / 2) : total });
      s.legal = legalKeys(state, c);
      note(state, mode === 'barefoot' ? `${who} plods ${total}` : `${who} rolls ${rolls.join('+')}${rolls.length > 1 ? ` = ${total}` : ''}`, 'move', ctx.now);
      if (total === 0 || !s.legal.length) finishMove(state, ctx, pid, c, total === 0 ? 'stay' : 'blocked');
      return;
    }

    if (mode === 'wheel') {
      const segs = wheelSegments(item, affixes, MV);
      const i = rigAwareWeightedIndex(state, 'wheels', segs), seg = segs[i];
      state.lastSpin = { wheel: 'movement', outcomes: segs.map(x => x.label), weights: segs.map(x => Number(x.weight ?? 1) || 0), index: i, playerId: pid, ts: ctx.now };
      const s = state.moveSession = newSession(pid, c, 'wheel', { wheel: seg.label, segment: seg.id, octane: item?.unique === 'octane' });
      note(state, `${who} spins ${seg.label}`, 'wheel', ctx.now);
      if (seg.special === 'teleport') {
        const options = portalOptions(state, c);
        s.awaiting = 'portal';
        state.pendingPrompt = { playerId: pid, kind: 'portal', options, source: 'wheel' };
        return;
      }
      if (seg.special === 'swap') {
        const other = nearestOtherCharacter(state, c);
        if (!other) { note(state, `nobody to swap with`, 'move', ctx.now); finishMove(state, ctx, pid, c, 'stay'); return; }
        const otherPid = Object.values(state.players).find(p => p.characterId === other.id)?.id;
        if (c.classId === 'enforcer' || other.classId === 'enforcer') { note(state, `${c.classId === 'enforcer' ? who : nameOf(state, otherPid)} cannot be swapped`, 'move', ctx.now); finishMove(state, ctx, pid, c, 'stay'); return; }
        const mine = c.pos; c.pos = other.pos; other.pos = mine; other.region = Q.hexAt(state, mine).regionId;
        s.path = [c.pos]; s.swappedWith = otherPid;
        note(state, `${who} swaps places with ${nameOf(state, otherPid)}`, 'move', ctx.now);
        finishMove(state, ctx, pid, c, 'swap');
        return;
      }
      const total = Math.max(0, seg.steps - pen);
      s.roll = total; s.movesLeft = total; s.legal = legalKeys(state, c);
      if (total === 0 || !s.legal.length) finishMove(state, ctx, pid, c, total === 0 ? 'stay' : 'blocked');
      return;
    }

    // Card boots
    const range = affixes.has('range6') ? MV.cardRangeExtended : MV.cardRange;
    const draws = affixes.has('drawTwo') ? 2 : 1;
    const cards = [];
    for (let i = 0; i < draws; i++) {
      const card = drawCard(state, M, MV, affixes);
      const ranks = Q.colourRanks(state, c.pos, card.colour, range, c.id);
      const destinations = card.double ? (ranks[1]?.keys || ranks[0]?.keys || []) : (ranks[0]?.keys || []);
      cards.push({ card, destinations });
    }
    const destinations = [...new Set(cards.flatMap(x => x.destinations))];
    const s = state.moveSession = newSession(pid, c, 'card', { card: cards[0].card, cards: draws > 1 ? cards : null, destinations, range, atomic: destinations.length > 0 });
    if (affixes.has('peekTop')) s.peek = state.map.colourDeck.at(-1) || null;
    note(state, `${who} draws a card`, 'move', ctx.now);
    if (!destinations.length) {
      // No hex of that colour in range: step cardNoMatchStep instead.
      s.roll = Math.max(0, MV.cardNoMatchStep - pen); s.movesLeft = s.roll; s.legal = legalKeys(state, c); s.atomic = false; s.destinations = null;
      if (s.movesLeft === 0 || !s.legal.length) finishMove(state, ctx, pid, c, 'stay');
    }
  },

  MOVE_STEP(state, ev, ctx) {
    const { pid, c, s } = requireSession(state, ctx);
    const { dir, to } = ctx.payload;
    if (s.atomic) { if (to == null) refuse('tap one of the lit hexes', 'card'); jumpTo(state, ctx, pid, c, to); return; }
    let key = to;
    if (key == null) { if (!(Number.isInteger(dir) && dir >= 0 && dir < 6)) refuse('dir must be 0-5'); key = H.key(H.neighbor(H.parse(c.pos), dir)); }
    const end = stepTo(state, ctx, pid, c, key);
    endIfOver(state, ctx, pid, c, end);
  },

  MOVE_STOP(state, ev, ctx) {
    const { pid, c, s } = requireSession(state, ctx);
    if (s.atomic) refuse('a Card move cannot stop short: tap a lit hex', 'card');
    const blocked = !s.legal.length;
    if (!blocked && s.stepsTaken < s.canStopAfter) refuse(s.mustWalk ? `these boots walk the full ${s.roll}` : `walk at least ${s.canStopAfter} of ${s.roll} first`, 'muststep');
    finishMove(state, ctx, pid, c, blocked && s.stepsTaken < s.canStopAfter ? 'blocked' : 'stop');
  },

  MOVE_PATH(state, ev, ctx) {
    const { pid, c, s } = requireSession(state, ctx);
    const { to } = ctx.payload; if (!to) refuse('to required');
    if (s.atomic) { jumpTo(state, ctx, pid, c, to); return; }
    if (to === c.pos) refuse('already there');
    const path = Q.pathTo(state, c.pos, to, c.id); if (!path) refuse('no path there', 'nopath');
    const steps = Math.min(path.length, s.movesLeft);
    let end = null;
    for (let i = 0; i < steps && !end; i++) end = stepTo(state, ctx, pid, c, path[i]);
    if (endIfOver(state, ctx, pid, c, end)) return;
    // Arrived with moves to spare: the tap was the destination, so stop if the stop rule allows.
    if (s.stepsTaken >= s.canStopAfter) finishMove(state, ctx, pid, c, 'path');
  },

  MOVE_SWAP_BOOTS(state, ev, ctx) {
    const { pid, c } = requireMover(state, ctx);
    if (state.turnPhase !== 'move') refuse('boots change only before the move', 'phase');
    if (state.moveSession && !state.moveSession.done && state.moveSession.playerId === pid) refuse('already rolled', 'rolled');
    if (c.usedThisTurn.moved) refuse('already moved this turn', 'moved');
    const { itemId } = ctx.payload; const item = c.items?.[itemId];
    if (!item) refuse('no such item'); if (item.slot !== 'boots') refuse('not boots'); if (c.worn.boots?.id === itemId) refuse('already wearing them');
    const old = c.worn.boots || null;
    const cell = c.grid?.cells?.find(x => x.itemId === itemId);
    if (cell) { if (old) cell.itemId = old.id; else c.grid.cells.splice(c.grid.cells.indexOf(cell), 1); }
    c.worn.boots = item;
    c.usedThisTurn.moved = true; c.usedThisTurn.moves = (c.usedThisTurn.moves || 0) + 1;
    state.moveSession = { ...newSession(pid, c, 'swapboots'), done: true, how: 'swapboots', endKey: c.pos, itemId };
    state.turnPhase = 'action';
    note(state, `${nameOf(state, pid)} laces up ${item.name} instead of moving`, 'move', ctx.now);
  },

  PORTAL_PICK(state, ev, ctx) {
    const { pid, c } = requireMover(state, ctx);
    const pr = state.pendingPrompt;
    if (!pr || pr.kind !== 'portal' || pr.playerId !== pid) refuse('no portal to pick', 'prompt');
    const { regionId } = ctx.payload; const region = state.map.regions[regionId];
    if (!region || !region.portalKey) refuse('no such portal');
    if (pr.options && !pr.options.includes(regionId)) refuse(portalBlockReason(state, c, region) || 'that portal is not open to you', 'gate');
    const from = c.pos;
    c.pos = region.portalKey;
    state.pendingPrompt = null;
    note(state, `${nameOf(state, pid)} steps through a portal to ${region.name}`, 'move', ctx.now);
    const s = state.moveSession;
    if (s && !s.done && s.playerId === pid) { s.path = [c.pos]; s.stepsTaken = 1; s.from = from; finishMove(state, ctx, pid, c, 'portal', { skipTile: true }); return; }
    // A Portal tile's own prompt (after the move already resolved): just arrive.
    c.region = region.id; Q.reveal(state, region.id);
    if (state.turnPhase === 'resolve') state.turnPhase = 'action';
  },
});

// Regions whose portal this character may step out of (the Citadel's gate applies to its portal too).
function portalBlockReason(state, c, region) { return region.gate ? Q.gateBlocks(state, c, { type: 'portal', gate: region.gate }) : null; }
export function portalOptions(state, c) {
  return Object.values(state.map.regions).filter(r => r.portalKey && !portalBlockReason(state, c, r)).map(r => r.id);
}

// ---- run start: roll the map and seat everyone on the start hex --------------------------------------------------

runHooks.runStart.push((state, ctx) => {
  // A map that already exists (a GM restore, an imported room, a test fixture) is kept.
  if (!state.map?.hexes || !Object.keys(state.map.hexes).length) generateMap(state, ctx);
  const startRegion = state.map.hexes[state.map.start].regionId;
  for (const pid of activeSeats(state)) { const c = characterOf(state, pid); if (!c) continue; c.pos = state.map.start; c.region = startRegion; c.lastSafePos = state.map.start; }
  Q.reveal(state, startRegion);
  if (!state.gm.fogOfWar) for (const id of REGION_ORDER) Q.reveal(state, id);
});

// ---- phone and TV derivations -----------------------------------------------------------------------------------

// The six directions for the rosette: which are legal right now and why not.
export function legalSteps(state, playerId) {
  const c = characterOf(state, playerId); if (!c?.pos || !state.map) return [];
  const s = state.moveSession, active = !!s && !s.done && s.playerId === playerId && !s.atomic && !s.awaiting && s.movesLeft > 0;
  return H.DIRS.map((d, dir) => {
    const key = H.key(H.neighbor(H.parse(c.pos), dir)), h = Q.hexAt(state, key);
    const reason = !active ? (s && !s.done ? 'tap a lit hex' : 'roll first') : Q.blockReason(state, key, c.id);
    return { dir, name: d.name, key, type: h?.type || null, label: h ? Q.tileLabel(h.type) : 'off the map', legal: active && !reason, reason, bridge: !!h?.bridge, stops: h ? Q.stopsHere(state, key) : false };
  });
}
// What a Card boots wearer sees: the colours around them, the card(s) drawn, the lit destinations.
export function cardView(state, playerId) {
  const c = characterOf(state, playerId); if (!c?.pos || !state.map) return null;
  const item = bootsOf(c), affixes = bootAffixes(item), MV = group(state, 'movement');
  const s = state.moveSession && state.moveSession.playerId === playerId ? state.moveSession : null;
  const isCard = s?.mode === 'card' || (item && (item.unique === 'choosemode' || bootMode(item, { mode: 'card' }) === 'card'));
  if (!isCard) return null;
  const range = s?.range || (affixes.has('range6') ? MV.cardRangeExtended : MV.cardRange);
  const here = Q.hexAt(state, c.pos);
  const hexes = [{ key: c.pos, colour: here.colour, dist: 0, type: here.type }, ...Q.reachableFrom(state, c.pos, range, c.id).map(x => ({ key: x.key, colour: Q.hexAt(state, x.key).colour, dist: x.dist, type: Q.hexAt(state, x.key).type }))];
  return { range, hexes, card: s?.card || null, cards: s?.cards?.map(x => x.card) || null, destinations: s?.atomic ? s.destinations : [], peek: s?.peek || null, deckLeft: state.map.colourDeck.length, noMatch: !!s && s.mode === 'card' && !s.atomic };
}
// What the room may see of the current move: the roll or the wheel stop, the path for dice/wheel, and for Card
// boots only where the mover ended. Never the card, the colours or the lit destinations.
export function moveSummary(state) {
  const s = state.moveSession; if (!s) return null;
  const base = { playerId: s.playerId, mode: s.mode, done: s.done, how: s.how, endKey: s.endKey, stepsTaken: s.stepsTaken, movesLeft: s.movesLeft, unused: s.unused || 0, from: s.from };
  if (s.mode === 'dice' || s.mode === 'barefoot') return { ...base, roll: s.roll, dice: s.dice, rolls: s.rolls, path: s.path, canStopAfter: s.canStopAfter, mustWalk: s.mustWalk };
  if (s.mode === 'wheel') return { ...base, roll: s.roll, wheel: s.wheel, path: s.path, swappedWith: s.swappedWith || null };
  if (s.mode === 'card') return { ...base, path: null, stepsTaken: null, movesLeft: null, unused: 0 };
  return base;
}
