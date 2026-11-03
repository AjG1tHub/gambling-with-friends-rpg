// The tutorial opening (handlers/ramp.js): stages per own turn, every locked event refused with code 'locked' and
// allowed once its turn comes, monsters asleep then awake, the Arena prompt skipped, the Chaos cap, skip for one
// seat or the table, ramp off = everything allowed, the room default by tier, and a bot that never proposes a
// locked action over a whole ramp run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table, makeItem, shared, characterOf } from './_fixtures-social.mjs';
import { room } from './_helpers.mjs';
import { rampStage, unlocked, rampLine, lockMessage, LOCKS, FEATURES, STEP_FEATURES } from '../../packages/shared/handlers/ramp.js';
import { legalSteps } from '../../packages/shared/handlers/movement.js';
import { segmentsFor, spinWheel } from '../../packages/shared/handlers/wheels.js';
import { ensureShopStock } from '../../packages/shared/handlers/tiles.js';
import { rampBanner } from '../../packages/ui/tutorial.js';
import { nextAction, tableDuties } from '../../packages/shared/bot.js';
import { makeRng } from '../../packages/shared/rng.js';
import { runGame } from '../../tools/bots.mjs';

const B = shared.B;
const ctxFor = (r, actor = 'gm') => ({ now: r.now(), actor, isGm: actor === 'gm' || actor === 'system', payload: {}, B: (g) => shared.group(r.state, g), event: { id: `t${r.now()}` } });
// A monster next door at 1,0 and the seats spread out so only the mover is beside it.
const rampTable = (extra = {}) => table({ ramp: true, map: { encounters: ['1,0', '-2,2'] }, positions: ['0,0', '0,2', '-2,0', '2,-2'], ...extra });
const code = (e) => e?.code || null;
// One full lap of the table: every seat ends a plain turn once.
const lap = (t) => { for (let i = 0; i < t.order.length; i++) t.endTurn(); };
// What every feature's sample event looks like from `pid` (the mover) against `other`.
function samples(t, pid, other) {
  const c = t.char(pid), oc = t.char(other);
  return {
    gear: [['GRID_SORT', {}], ['SHOP_BUY', { sku: 'potion' }], ['INN_REST', {}], ['BANK_DEPOSIT', { amount: 10 }], ['TILE_TAKE_LOOT', { itemId: 'x' }], ['CONSUMABLE_USE', { itemId: 'x' }], ['PACT_TAKE', { amount: 10 }]],
    fight: [['ITEM_USE', { itemId: c.worn.mainhand.id, targetId: oc.id, targetKind: 'character' }], ['AREA_OPEN', { itemId: c.worn.mainhand.id }], ['PET_ATTACK', { petId: 'x', attackIndex: 0, mult: 1, label: 'x' }], ['FIGHT_START', { monsterId: 'm-1,0' }]],
    challenge: [['CHALLENGE_CALL', { defenderId: other, call: 'duel', itemId: c.worn.mainhand.id }], ['BOUNTY_PLACE', { targetId: other, gold: 100 }]],
    social: [['LETTER_SEND', { toId: other, text: 'hi' }], ['ALLIANCE_PROPOSE', { toId: other }], ['VOTE_OPEN', { kind: 'table', question: 'q', options: [other] }], ['TRADE_OFFER', { toId: other, give: { gold: 1 }, want: {} }], ['AUCTION_OPEN', { itemId: 'x', minBid: 1 }]],
    class: [['CLASS_ACTIVE', { activeId: 'doubledown' }]],
    pets: [['PET_BATTLE_START', { opponentId: other, wager: 0 }]],
  };
}

test('ramp: stages per own turn, the teaser line, the lock message, and the ramp is over after the list', () => {
  const t = rampTable(); const [s0, s1] = t.order;
  const st = rampStage(t.state, s0);
  assert.equal(st.on, true); assert.equal(st.turn, 1); assert.equal(st.step, 'move'); assert.equal(st.index, 0); assert.equal(st.done, false);
  assert.deepEqual([...st.unlocked], ['move']); assert.deepEqual(st.next, { feature: 'gear', onTurn: 2 });
  assert.deepEqual(st.locked.map(l => `${l.feature}@${l.onTurn}`), ['gear@2', 'fight@3', 'challenge@4', 'social@5', 'class@5', 'pets@5', 'chaos@5']);
  assert.equal(rampLine(t.state, s0), 'Next turn: shops and your Cage unlock');
  assert.equal(lockMessage(t.state, s0, 'fight'), 'Fights unlock on your turn 3');
  // s1 has not had a turn yet: treated as turn 1
  assert.equal(rampStage(t.state, s1).turn, 1); assert.equal(unlocked(t.state, s1, 'gear'), false);
  lap(t); assert.equal(t.cur(), s0); assert.equal(t.state.turnCounts[s0], 2);
  let s = rampStage(t.state, s0); assert.equal(s.step, 'gear'); assert.ok(s.unlocked.has('gear') && s.unlocked.has('move') && !s.unlocked.has('fight')); assert.equal(rampLine(t.state, s0), 'Next turn: fights unlock — the monsters wake');
  lap(t); s = rampStage(t.state, s0); assert.equal(s.step, 'fight'); assert.ok(s.unlocked.has('fight') && !s.unlocked.has('challenge'));
  lap(t); s = rampStage(t.state, s0); assert.equal(s.step, 'challenge'); assert.deepEqual(s.next, { feature: 'all', onTurn: 5 }); assert.equal(rampLine(t.state, s0), 'Next turn: everything unlocks — letters, alliances, votes, pacts, pets, class actives');
  lap(t); s = rampStage(t.state, s0); assert.equal(s.step, 'all'); assert.equal(s.done, true); assert.equal(s.unlocked.size, FEATURES.length); assert.equal(s.next, null); assert.equal(rampLine(t.state, s0), '');
  lap(t); s = rampStage(t.state, s0); assert.equal(s.turn, 6); assert.equal(s.done, true);
  // the other seats ramp on their own turns, not the table's
  assert.equal(rampStage(t.state, t.order[3]).turn, 5);
});

test('ramp: every locked event is refused with code locked on turn 1 and no longer locked once its turn comes', () => {
  const t = rampTable(); const [s0, s1] = t.order;
  const all = samples(t, s0, s1);
  for (const [type] of Object.values(all).flat()) assert.ok(LOCKS[type], `${type} is in LOCKS`);
  for (const [feature, list] of Object.entries(all)) for (const [type, payload] of list) {
    const e = t.r.try(type, payload, s0); assert.equal(code(e), 'locked', `${type} locked on turn 1`); assert.match(e.message, /unlock on your turn \d/);
    assert.equal(LOCKS[type], feature);
  }
  // a GM action that is not a seat's (no playerId) is never ramp-locked
  assert.notEqual(code(t.r.try('VOTE_OPEN', { kind: 'table', question: 'q', options: [s0, s1] }, 'gm')), 'locked');
  // the GM proxying a phone is that seat
  assert.equal(code(t.r.try('GRID_SORT', { playerId: s0 }, 'gm')), 'locked');
  for (let turn = 2; turn <= 5; turn++) {
    lap(t); assert.equal(t.cur(), s0); assert.equal(rampStage(t.state, s0).turn, turn);
    const now = samples(t, s0, s1);
    for (const [feature, list] of Object.entries(now)) for (const [type, payload] of list) {
      const e = t.r.try(type, payload, s0); const open = unlocked(t.state, s0, feature);
      if (open) assert.notEqual(code(e), 'locked', `${type} open on turn ${turn}`); else assert.equal(code(e), 'locked', `${type} still locked on turn ${turn}`);
    }
    // the exact schedule
    const st = rampStage(t.state, s0);
    assert.deepEqual([...st.unlocked].sort(), [...new Set(B.ramp.steps.slice(0, turn).flatMap(s => STEP_FEATURES[s]))].sort());
  }
  // a real action goes through once open: the Cage sorts on turn 2 and a letter flies on turn 5
  assert.equal(code(t.r.try('GRID_SORT', {}, s0)), null); t.r.append('LETTER_SEND', { toId: s1, text: 'free at last' }, s0); assert.equal(t.state.letters.at(-1).text, 'free at last');
});

test('ramp: the monsters are asleep until turn 3 — a step onto a monster hex is refused, not lit, then the fight opens', () => {
  const t = rampTable(); const [s0] = t.order; const c = t.char(s0); assert.equal(c.pos, '0,0');
  assert.ok(t.state.monsters['m-1,0'] && !t.state.monsters['m-1,0'].dead);
  t.r.append('MOVE_ROLL', {}, s0); assert.equal(t.state.moveSession.mode, 'barefoot');
  const steps = legalSteps(t.state, s0); const toMonster = steps.find(x => x.key === '1,0');
  assert.equal(toMonster.legal, false); assert.match(toMonster.reason, /asleep/); assert.ok(steps.some(x => x.legal), 'other hexes are open');
  const e = t.r.try('MOVE_STEP', { to: '1,0' }, s0); assert.equal(code(e), 'locked'); assert.equal(e.message, 'the monsters are asleep until your turn 3');
  assert.equal(c.pos, '0,0'); assert.equal(t.state.fight, null);
  assert.equal(code(t.r.try('MOVE_PATH', { to: '1,0' }, s0)), 'locked');
  t.r.append('MOVE_STEP', { to: '0,1' }, s0); t.r.append('MOVE_STOP', {}, s0); assert.equal(t.state.turnPhase, 'action'); assert.equal(c.pos, '0,1');
  // the TV banner names the mover's step on the turn it unlocks
  assert.deepEqual(rampBanner(t.state), { playerId: s0, turn: 1, step: 'move', text: `${c.name}'s turn 1 — you move: roll, step, stop, end the turn` });
  t.place(s0, '0,0'); lap(t); lap(t); assert.equal(t.cur(), s0); assert.equal(rampStage(t.state, s0).step, 'fight');
  assert.equal(rampBanner(t.state).text, `${c.name}'s turn 3 — fights unlock — the monsters wake`);
  t.r.append('MOVE_ROLL', {}, s0); assert.ok(legalSteps(t.state, s0).find(x => x.key === '1,0').legal);
  t.r.append('MOVE_STEP', { to: '1,0' }, s0);
  assert.ok(t.state.fight && !t.state.fight.done && t.state.fight.monsterId === 'm-1,0' && t.state.fight.playerId === s0, 'the monster wakes: the fight opens on the step');
  // and the monster may act on them now: the table duty is a MONSTER_ACT for this fight (not a refusal to touch a ramp-locked seat)
  t.r.append('ITEM_USE', { itemId: c.worn.mainhand.id, targetId: 'm-1,0', targetKind: 'monster' }, s0);
  t.r.append('ITEM_RESOLVE', { mult: 0, label: 'miss' }, s0); assert.equal(t.state.fight.turn, 'monster');
});

test('ramp: a ramp-locked player walks past the Arena, and never meets a monster through a Card jump', () => {
  const t = rampTable(); const [s0] = t.order; const c = t.char(s0);
  t.state.map.hexes['0,1'].type = 'arena';
  t.r.append('MOVE_ROLL', {}, s0); t.r.append('MOVE_STEP', { to: '0,1' }, s0); t.r.append('MOVE_STOP', {}, s0);
  assert.equal(t.state.pendingPrompt, null, 'no Arena prompt on turn 1'); assert.equal(t.state.turnPhase, 'action'); assert.match(t.state.log.at(-1).text, /walks past the Arena/);
  t.place(s0, '0,0'); for (let i = 0; i < 3; i++) lap(t); assert.ok(unlocked(t.state, s0, 'challenge'));
  t.r.append('MOVE_ROLL', {}, s0); t.r.append('MOVE_STEP', { to: '0,1' }, s0); t.r.append('MOVE_STOP', {}, s0);
  assert.equal(t.state.pendingPrompt?.kind, 'arena', 'turn 4: the Arena asks');
  // Card boots on a fresh ramp table: a monster hex of the drawn colour is never lit while fights are locked
  const t2 = rampTable(); const [a] = t2.order; const ca = t2.char(a);
  const boots = makeItem({ id: 'cb', name: 'Card Boots', slot: 'boots', kind: null, gameId: null, baseId: 'card_boots', extra: { bootMode: 'card', die: null } });
  ca.items[boots.id] = boots; ca.worn.boots = boots; for (const h of Object.values(t2.state.map.hexes)) h.colour = 'Bone'; t2.state.map.colourDeck = [{ colour: 'Bone' }, { colour: 'Bone' }];
  t2.r.append('MOVE_ROLL', {}, a); const s = t2.state.moveSession; assert.equal(s.mode, 'card');
  assert.ok(!(s.destinations || []).includes('1,0'), 'the sleeping monster hex is not a destination');
});

test('ramp: Chaos spins at tier 1 for a ramp-locked spinner, the full wheel once chaos unlocks', () => {
  const t = rampTable(); const [s0] = t.order; t.state.chaos.tier = 4;
  const low = segmentsFor(t.state, 'chaos', { playerId: s0 }).length, full = segmentsFor(t.state, 'chaos').length; assert.ok(low < full, `${low} < ${full}`);
  const r1 = spinWheel(t.state, ctxFor(t.r), 'chaos', s0); assert.equal(t.state.lastSpin.outcomes.length, low); assert.ok(r1.seg);
  for (let i = 0; i < 4; i++) lap(t); assert.ok(unlocked(t.state, s0, 'chaos'));
  t.state.chaos.tier = 4; spinWheel(t.state, ctxFor(t.r), 'chaos', s0); assert.equal(t.state.lastSpin.outcomes.length, full);
});

test('ramp: skip for one seat, skip for everyone, GM_CONFIG toggles it, and the room default follows the tier', () => {
  const t = rampTable(); const [s0, s1] = t.order;
  t.r.append('GM_RAMP_SKIP', { playerId: s1 });
  assert.equal(rampStage(t.state, s1).done, true); assert.equal(rampStage(t.state, s0).done, false); assert.equal(t.state.gm.ramp.skipped[s1], true);
  assert.notEqual(code(t.r.try('LETTER_SEND', { toId: s0, text: 'skipped' }, s1)), 'locked');
  assert.equal(code(t.r.try('LETTER_SEND', { toId: s1, text: 'not me' }, s0)), 'locked');
  assert.match(t.r.try('GM_RAMP_SKIP', { playerId: 'nobody' }).message, /no such player/);
  assert.equal(code(t.r.try('GM_RAMP_SKIP', {}, s0)), 'forbidden');
  t.r.append('GM_RAMP_SKIP', {}); assert.equal(t.state.gm.ramp.on, false); assert.equal(rampStage(t.state, s0).done, true); assert.equal(rampStage(t.state, s0).on, false);
  assert.notEqual(code(t.r.try('LETTER_SEND', { toId: s1, text: 'free' }, s0)), 'locked');
  t.r.append('GM_CONFIG', { ramp: true }); assert.equal(t.state.gm.ramp.on, true); assert.equal(code(t.r.try('CLASS_ACTIVE', { activeId: 'doubledown' }, s0)), 'locked');
  t.r.append('GM_CONFIG', { rampSteps: ['move', 'all'] }); assert.deepEqual(t.state.gm.ramp.steps, ['move', 'all']); assert.deepEqual(rampStage(t.state, s0).next, { feature: 'all', onTurn: 2 });
  t.r.append('GM_CONFIG', { rampSteps: [] }); assert.equal(t.state.gm.ramp.steps, null, 'an empty list goes back to the balance default');
  t.r.append('GM_CONFIG', { ramp: false }); assert.equal(t.state.gm.ramp.on, false);
  // room defaults: tier 1 on, tier 2 off, the payload wins, and its own step list rides along
  assert.equal(room({ ramp: null }).state.gm.ramp.on, true);
  assert.equal(room({ tier: 2, ramp: null }).state.gm.ramp.on, false);
  assert.equal(room({ tier: 2, ramp: true }).state.gm.ramp.on, true);
  assert.equal(room({ ramp: false }).state.gm.ramp.on, false);
  assert.deepEqual(room({ ramp: true, rampSteps: ['move', 'fight'] }).state.gm.ramp.steps, ['move', 'fight']);
  assert.deepEqual(room().state.gm.ramp, { on: false, steps: null, skipped: {} });
});

test('ramp off: nothing is locked on turn 1, the monsters are awake and the Arena asks', () => {
  const t = table({ map: { encounters: ['1,0'] }, positions: ['0,0', '0,2', '-2,0', '2,-2'] }); const [s0, s1] = t.order;
  assert.equal(t.state.gm.ramp.on, false); assert.equal(rampStage(t.state, s0).done, true); assert.equal(rampLine(t.state, s0), '');
  assert.equal(rampBanner(t.state), null);
  t.r.append('MOVE_ROLL', {}, s0); assert.ok(legalSteps(t.state, s0).find(x => x.key === '1,0').legal); t.r.append('MOVE_STEP', { to: '1,0' }, s0); assert.ok(t.state.fight && t.state.fight.monsterId === 'm-1,0');
  for (const [type, payload] of Object.values(samples(t, s0, s1)).flat()) assert.notEqual(code(t.r.try(type, payload, s0)), 'locked', type);
});

test('ramp: a bot seat never proposes a locked action over a whole ramp run, and the run still ends', () => {
  const r = runGame({ bots: 4, mode: 'ffa', seed: 3, ramp: true, maxEvents: 6000 });
  assert.ok(r.ramp && r.turns >= 40, `${r.turns} turns`);
  const locked = Object.keys(r.refusals).filter(k => /unlock on your turn|asleep/.test(k));
  assert.deepEqual(locked, [], `locked refusals: ${locked.join(' | ')}`);
  assert.equal(r.stalls, 0); assert.ok(!(r.ended || '').includes('runner cap'), r.ended);
  // and the policy itself, asked turn by turn on a hand-built table, stays inside the unlocked set
  const t = rampTable(); const rng = makeRng(7); const [s0] = t.order; const seen = new Set();
  for (let guard = 0; guard < 400 && t.state.phase === 'playing' && rampStage(t.state, s0).turn <= 5; guard++) {
    for (const a of tableDuties(t.state, rng, t.r.now())) t.r.append(a.type, a.payload, a.actor, { strict: false });
    const pid = t.cur(); const a = nextAction(t.state, pid, rng, t.r.now()); if (!a) { t.endTurn(); continue; }
    if (LOCKS[a.type]) { seen.add(a.type); assert.ok(unlocked(t.state, pid, LOCKS[a.type]), `${a.type} proposed while ${LOCKS[a.type]} is locked on ${pid}'s turn ${rampStage(t.state, pid).turn}`); }
    t.r.append(a.type, a.payload, a.actor, { strict: false }); assert.notEqual(code(t.state.lastError), 'locked', `${a.type}: ${t.state.lastError?.message}`);
    t.r.tick(2000);
  }
  assert.ok(rampStage(t.state, s0).turn >= 5, `reached turn ${rampStage(t.state, s0).turn}`);
});

test('ramp: the Coach shows the step card on the player\'s turn, the help sheet lists what is still locked', async () => {
  const { coachStep, situation, rampLocks } = await import('../../apps/phone/coach.js');
  const t = rampTable(); const [s0, s1] = t.order; const none = new Set();
  assert.equal(situation(t.state, s0, { tab: 'play', dismissed: none }), 'move.roll');
  const card = coachStep(t.state, s0, { tab: 'play', dismissed: none });
  assert.equal(card.id, 'ramp.move'); assert.equal(card.ramp, 'move'); assert.match(card.text, /monsters are asleep/); assert.match(card.text, /Next turn: shops and your Cage unlock/);
  assert.equal(coachStep(t.state, s0, { tab: 'play', dismissed: new Set(['ramp.move']) }).id, 'move.roll', 'dismissed: the plain card is back');
  assert.equal(coachStep(t.state, s0, { tab: 'play', dismissed: new Set(['ramp.move']), tutorial: true }).id, 'ramp.move', 'never dismissed in the practice run');
  assert.equal(coachStep(t.state, s1, { tab: 'play', dismissed: none }).id, 'waiting', 'not their turn: no ramp card');
  assert.equal(coachStep(t.state, s0, { tab: 'cage', dismissed: none }).id, 'tab.cage');
  assert.deepEqual(rampLocks(t.state, s0).map(l => `${l.feature}@${l.onTurn}`), ['gear@2', 'fight@3', 'challenge@4', 'social@5', 'class@5', 'pets@5', 'chaos@5']);
  assert.match(rampLocks(t.state, s0)[1].label, /Fights/);
  lap(t); lap(t); assert.equal(coachStep(t.state, s0, { tab: 'play', dismissed: none }).id, 'ramp.fight');
  lap(t); lap(t); assert.equal(coachStep(t.state, s0, { tab: 'play', dismissed: none }).id, 'ramp.all'); assert.deepEqual(rampLocks(t.state, s0), []);
  lap(t); assert.equal(coachStep(t.state, s0, { tab: 'play', dismissed: none }).id, 'move.roll', 'the ramp is over: plain cards');
  t.r.append('GM_RAMP_SKIP', { playerId: s1 }); t.until(s1); assert.equal(coachStep(t.state, s1, { tab: 'play', dismissed: none }).id, 'move.roll', 'a skipped seat gets no ramp card');
});
