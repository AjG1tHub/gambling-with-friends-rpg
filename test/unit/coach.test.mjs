// The phone's Coach (apps/phone/coach.js) and the practice goals (apps/phone/practice.js), pure parts only: the
// situation ids through lobby → creation → first turn → a challenge with held seats → owed turns, the waiting
// screen's order line, and the 📖 broadcast parser. Reducer-only rooms; no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, currentPlayerId } from './_helpers.mjs';
import { table } from './_fixtures-social.mjs';
import { situation, coachStep, turnOrderLine, parseRuleBroadcast, isRuleBroadcast, STEP_IDS } from '../../apps/phone/coach.js';
import { practiceGoal, GOAL_IDS } from '../../apps/phone/practice.js';

const none = new Set();
const sit = (state, me, extra = {}) => situation(state, me, { tab: 'play', dismissed: none, now: state.lastEventTs, ...extra });

test('lobby and creation: one step per stage, in order, each dismissible and every id has a card', () => {
  const r = room().join(names4);
  assert.equal(sit(r.state, 'p0'), 'lobby');
  assert.equal(sit(r.state, 'p0', { dismissed: new Set(['lobby']) }), 'bug');
  assert.equal(coachStep(r.state, 'p0', { tab: 'play', dismissed: new Set(['lobby', 'bug']) }), null, 'both dismissed: nothing');
  assert.equal(sit(r.state, 'p0', { tab: 'cage' }), 'tab.cage');
  r.append('CREATION_OPEN');
  assert.equal(sit(r.state, 'p0'), 'creation.look');
  r.append('CHAR_LOOK', { name: 'Grim', crest: '🦊', look: { body: 1, hair: 4 } }, 'p0');
  assert.equal(sit(r.state, 'p0'), 'creation.class');
  r.append('CHAR_CLASS', { classId: 'whale' }, 'p0');
  assert.equal(sit(r.state, 'p0'), 'creation.gamble');
  const gamble = coachStep(r.state, 'p0', { tab: 'play', dismissed: none });
  assert.match(gamble.text, /10 chips, every stat starts at 3/);
  assert.match(gamble.text, /stake 1–5/);
  assert.match(gamble.text, /Under 3 a stat is a debuff; 10 is the cap/);
  assert.ok(gamble.auto, 'doing the thing dismisses it');
  r.append('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 2, mult: 2, gameId: 'fifty' }, 'p0');
  assert.equal(sit(r.state, 'p0'), 'creation.blood');
  r.append('CHAR_LOCK', { alloc: {} }, 'p0');
  assert.equal(sit(r.state, 'p0'), 'creation.ready');
  r.append('PLAYER_READY', { playerId: 'p0', ready: true }, 'p0');
  assert.equal(sit(r.state, 'p0'), 'creation.wait');
  assert.equal(coachStep(r.state, 'p0', { tab: 'play', dismissed: new Set(['creation.wait']), tutorial: true })?.id, 'creation.wait', 'tutorial mode ignores dismissals');
  for (const id of STEP_IDS) assert.ok(id.length, id);
});

test('first turn: roll → step → action for the mover; waiting with the order line for everyone else', () => {
  const t = table(); const [a, b, c, d] = t.order;
  assert.equal(sit(t.state, a), 'move.roll');
  const roll = coachStep(t.state, a, { tab: 'play', dismissed: none });
  assert.match(roll.text, /Barefoot means you plod 2/);
  assert.equal(sit(t.state, b), 'waiting');
  const w = coachStep(t.state, b, { tab: 'play', dismissed: none });
  assert.match(w.text, /The boxed line below says why/);
  const line = turnOrderLine(t.state, b);
  assert.match(line, new RegExp(`^Order: ${t.char(a).name} → ${t.char(b).name} \\(you\\) → ${t.char(c).name} → ${t.char(d).name}\\. You are next\\.$`));
  assert.doesNotMatch(turnOrderLine(t.state, c), /You are next/);
  t.r.append('MOVE_ROLL', {}, a);
  assert.equal(sit(t.state, a), 'move.step');
  t.r.append('MOVE_STOP', {}, a);
  assert.ok(['action', 'resolve'].includes(sit(t.state, a)), `after the move: ${sit(t.state, a)}`);
  if (sit(t.state, a) === 'action') assert.match(coachStep(t.state, a, { tab: 'play', dismissed: none }).text, /END TURN is the button that passes play/);
  t.endTurn();
  assert.equal(currentPlayerId(t.state), b); assert.equal(sit(t.state, b), 'move.roll');
  assert.equal(sit(t.state, a), 'waiting');
});

test('a challenge: attacker and defender steps, held seats and owed turns in the order line', () => {
  const t = table(); const [a, b, c, d] = t.order; const N = (id) => t.char(id).name;
  t.rigEntry('rps5');
  t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a);
  assert.equal(sit(t.state, a), 'challenge.attacker.ready');
  assert.equal(sit(t.state, b), 'challenge.defender');
  assert.match(coachStep(t.state, b, { tab: 'play', dismissed: none }).text, new RegExp(`${N(a)} called you to a duel`));
  t.r.append('CHALLENGE_ANSWER', { itemId: null }, b);
  assert.equal(sit(t.state, b), 'challenge.defender.wait');
  t.r.append('CHALLENGE_SPIN', {}, a);
  assert.equal(currentPlayerId(t.state), c, 'the table plays on with the next free seat');
  assert.equal(sit(t.state, c), 'move.roll');
  // the spinning window, then the external entry
  assert.equal(sit(t.state, a), 'challenge.spinning');
  t.r.tick(10000);
  assert.equal(sit(t.state, a, { now: t.r.now() }), 'challenge.play.external');
  assert.match(coachStep(t.state, a, { tab: 'play', dismissed: none, now: t.r.now() }).text, /both phones tap who won/);
  // d waits: the line names the held pair and who plays their slot
  const line = turnOrderLine(t.state, d);
  assert.match(line, new RegExp(`^Held in a challenge: ${N(a)} and ${N(b)} — ${N(c)} plays their slot\\.`));
  assert.match(line, new RegExp(`Order: ${N(c)} → ${N(d)} \\(you\\)\\.`));
  assert.match(line, /You are next\./);
  // the held player's own line
  assert.match(turnOrderLine(t.state, b), new RegExp(`^Held in a challenge: ${N(a)} and you\\. ${N(c)} plays your slot; you rejoin when it settles\\.`));
  // two turns go by (b's slot is borrowed), then both report and b is owed a turn
  t.endTurn(); t.endTurn();
  t.r.append('CHALLENGE_REPORT', { winnerId: a }, a); t.r.append('CHALLENGE_REPORT', { winnerId: a }, b);
  assert.equal(t.state.challenge, null);
  assert.deepEqual(t.state.owedTurns.map(o => o.playerId), [b]);
  assert.match(turnOrderLine(t.state, b), /^You are owed a turn from slot \d; it comes right after this one\./);
  assert.match(turnOrderLine(t.state, a), new RegExp(`^${N(b)} is owed a turn; it comes right after this one\\.`));
  assert.ok(!['held'].includes(sit(t.state, b)), 'released: no Held card');
  t.endTurn();
  assert.equal(currentPlayerId(t.state), b, 'the owed turn is inserted');
  assert.equal(sit(t.state, b), 'move.roll');
  assert.equal(sit(t.state, a), 'waiting', 'an owedWait hold is not a Held card');
});

test('death, the end of the run and the practice goals', () => {
  const t = table(); const [a, b] = t.order;
  t.char(a).dead = true; t.char(a).missTurns = 2;
  assert.equal(sit(t.state, a), 'dead');
  assert.match(coachStep(t.state, a, { tab: 'play', dismissed: none }).text, /You miss 2 turns/);
  t.char(a).dead = false;
  // practice goals walk in order from the state and the progress record
  assert.deepEqual(GOAL_IDS.slice(0, 3), ['gamble', 'lock', 'ready']);
  const r = room().join(['You', 'Bot']); r.append('CREATION_OPEN');
  r.append('CHAR_LOOK', { name: 'Me', crest: '🦊', look: {} }, 'p0'); r.append('CHAR_CLASS', { classId: 'whale' }, 'p0');
  assert.equal(practiceGoal(r.state, 'p0', {}).id, 'gamble');
  r.append('CHAR_STAT_GAMBLE', { stat: 'luck', chips: 2, mult: 0, gameId: 'fifty' }, 'p0');
  assert.equal(practiceGoal(r.state, 'p0', {}).id, 'lock');
  r.append('CHAR_LOCK', { alloc: {} }, 'p0');
  assert.equal(practiceGoal(r.state, 'p0', {}).id, 'ready');
  r.append('PLAYER_READY', { playerId: 'p0', ready: true }, 'p0');
  assert.equal(practiceGoal(r.state, 'p0', {}).id, 'move');
  assert.equal(practiceGoal(r.state, 'p0', { moved: true }).id, 'end');
  assert.equal(practiceGoal(r.state, 'p0', { turnsEnded: 1 }).id, 'gear');
  assert.equal(practiceGoal(r.state, 'p0', { turnsEnded: 1, geared: true }).id, 'fight');
  assert.equal(practiceGoal(r.state, 'p0', { turnsEnded: 1, skipped: { gear: true, fight: true } }).id, 'duel');
  assert.equal(practiceGoal(r.state, 'p0', { turnsEnded: 1, bought: true, attacked: true, duelCalled: true }).id, 'result');
  const done = practiceGoal(r.state, 'p0', { turnsEnded: 1, bought: true, attacked: true, duelCalled: true, duelSettled: true });
  assert.equal(done.id, 'done'); assert.equal(done.index, GOAL_IDS.length - 1);
  t.r.append('GM_END_RUN', { reason: 'test' });
  assert.equal(sit(t.state, b), 'ended');
  assert.match(coachStep(t.state, b, { tab: 'play', dismissed: none }).text, /Pick up to 3 items to vault/);
});

test('📖 broadcasts: recognised and split into title and text', () => {
  assert.ok(isRuleBroadcast({ to: null, text: '📖 A turn: Roll, step, resolve, End turn.' }));
  assert.ok(!isRuleBroadcast({ to: null, text: 'Pizza is here' }));
  assert.ok(!isRuleBroadcast({ to: 'p1', text: '📖 whisper' }));
  assert.deepEqual(parseRuleBroadcast('📖 A turn: Roll, step: then End turn.'), { title: 'A turn', text: 'Roll, step: then End turn.' });
  assert.deepEqual(parseRuleBroadcast('📖 Just text'), { title: 'From the GM', text: 'Just text' });
});
