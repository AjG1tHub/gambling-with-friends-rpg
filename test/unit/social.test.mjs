// Letters (delay, limits, the courier post, Spyglass and Cutpurse interception, forging, the Visor), alliances by
// letter, chaos and table votes, emotes, side bets settled on challenge and fight ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table, makeItem, shared } from './_fixtures-social.mjs';
import { interceptable, inbox, voteView, voteHooks, settleSideBets } from '../../packages/shared/handlers/social.js';
import { letterHooks } from '../../packages/shared/hooks.js';

const B = shared.B;
const send = (t, from, to, text, extra = {}) => { t.r.append('LETTER_SEND', { toId: to, text, ...extra }, from); return t.state.letters.at(-1); };
// Every event commits a fresh copy of the state, so a letter captured before one is re-read by id.
const fresh = (t, l) => t.state.letters.find(x => x.id === l.id);
const rps = (t, a, b) => { t.until(a); t.rigEntry('rps5'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a); t.r.append('CHALLENGE_SPIN', {}, a); };

test('letters: unlimited on your turn, one off it, delivered at the start of the recipient\'s second turn', () => {
  const t = table(); const [s0, s1, s2, s3] = t.order;
  for (let i = 0; i < 3; i++) send(t, s0, s1, `note ${i}`);
  assert.equal(t.state.letters.length, 3); assert.equal(t.state.stats[s0].lettersSent, 3);
  assert.match(t.r.try('LETTER_SEND', { toId: s0, text: 'me' }, s0).message, /to yourself/);
  assert.match(t.r.try('LETTER_SEND', { toId: s1, text: '' }, s0).message, /empty/);
  send(t, s2, s1, 'psst'); assert.match(t.r.try('LETTER_SEND', { toId: s1, text: 'again' }, s2).message, /off your turn/);
  const l = t.state.letters[0]; assert.equal(l.deliveredAt, null); assert.equal(l.deliverAfterTurns, B.social.letterDelayTurns); assert.equal(l.sealed, false);
  const delivered = []; const spy = (s, c, info) => delivered.push(info.letter.id); letterHooks.onDeliver.push(spy);
  try {
    t.endTurn(); assert.equal(t.cur(), s1); assert.equal(fresh(t, l).deliveredAt, null, 'first recipient turn: not yet'); assert.deepEqual(inbox(t.state, s1), []);
    t.endTurn(); assert.equal(t.cur(), s2); assert.equal(t.state.offTurnLetters[s2], 0, 'the off-turn allowance resets on your own turn');
    t.endTurn(); t.endTurn(); assert.equal(t.cur(), s0); assert.equal(fresh(t, l).deliveredAt, null);
    t.endTurn(); assert.equal(t.cur(), s1); assert.ok(fresh(t, l).deliveredAt, 'second recipient turn: delivered'); assert.equal(inbox(t.state, s1).length, 4); assert.equal(delivered.length, 4);
    assert.ok(t.state.letters.slice(0, 3).every(x => x.deliveredAt));
  } finally { letterHooks.onDeliver.splice(letterHooks.onDeliver.indexOf(spy), 1); }
  // the text cap
  assert.equal(send(t, s1, s0, 'x'.repeat(1000)).text.length, B.social.letterMaxChars);
});

test('interception: the courier post reads everything in transit; pass lets it through, destroy swallows it', () => {
  const t = table(); const [s0, s1, s2, s3] = t.order;
  const a = send(t, s0, s1, 'meet at the inn'), b = send(t, s0, s3, 'kill nick');
  assert.deepEqual(interceptable(t.state, s2), [], 'not on the post, no glass');
  t.place(s2, t.state.map.courier);
  assert.deepEqual(interceptable(t.state, s2).map(l => l.id), [a.id, b.id]);
  assert.deepEqual(interceptable(t.state, s1).map(l => l.id), [], 'the recipient does not intercept their own mail'); t.place(s1, '1,0');
  assert.match(t.r.try('LETTER_INTERCEPT', { letterId: a.id, action: 'pass' }, s3).message, /not passing your way/);
  assert.match(t.r.try('LETTER_INTERCEPT', { letterId: a.id, action: 'eat' }, s2).message, /pass, destroy or forge/);
  const seen = []; const spy = (s, c, info) => seen.push(info.action); letterHooks.onIntercept.push(spy);
  try {
    t.r.append('LETTER_INTERCEPT', { letterId: a.id, action: 'pass' }, s2);
    t.r.append('LETTER_INTERCEPT', { letterId: b.id, action: 'destroy' }, s2);
  } finally { letterHooks.onIntercept.splice(letterHooks.onIntercept.indexOf(spy), 1); }
  assert.deepEqual(seen, ['pass', 'destroy']);
  assert.deepEqual(fresh(t, a).intercepted, { byId: s2, action: 'pass', at: t.r.now(), forgedText: null }); assert.equal(fresh(t, b).destroyed, true);
  assert.deepEqual(interceptable(t.state, s2), [], 'a letter is read once on the way');
  assert.match(t.r.try('LETTER_INTERCEPT', { letterId: a.id, action: 'destroy' }, s2).message, /not passing/);
  for (let i = 0; i < 8; i++) t.endTurn();
  assert.ok(fresh(t, a).deliveredAt, 'passed: delivered'); assert.equal(fresh(t, b).deliveredAt, null, 'destroyed: never arrives'); assert.deepEqual(inbox(t.state, s3), []);
  assert.match(t.r.try('LETTER_INTERCEPT', { letterId: a.id, action: 'pass' }, s2).message, /not passing/);
});

test('forging needs a level-5 Cutpurse; the Impostor\'s Visor seals a sender\'s letters', () => {
  const t = table({ char: (pid) => (pid === 'p2' ? { classId: 'cutpurse', level: 1 } : {}) }); const [s0, s1] = t.order;
  const cut = 'p2'; t.place(cut, t.state.map.courier);
  const l = send(t, s0, s1, 'attack vin next round');
  assert.ok(interceptable(t.state, cut).length, 'a Cutpurse on the post reads it');
  assert.match(t.r.try('LETTER_INTERCEPT', { letterId: l.id, action: 'forge', forgedText: 'x' }, cut).message, /level 5/);
  t.char(cut).level = 5;
  assert.match(t.r.try('LETTER_INTERCEPT', { letterId: l.id, action: 'forge' }, cut).message, /forgedText required/);
  t.r.append('LETTER_INTERCEPT', { letterId: l.id, action: 'forge', forgedText: 'attack sam next round' }, cut);
  assert.equal(fresh(t, l).text, 'attack sam next round'); assert.equal(fresh(t, l).originalText, 'attack vin next round'); assert.equal(fresh(t, l).intercepted.action, 'forge');
  // a whale with the forge upgrade flag is still not a Cutpurse; a level-1 Cutpurse with the upgrade can forge
  const t2 = table({ char: (pid) => (pid === 'p2' ? { classId: 'cutpurse', upgrades: ['forge'] } : { upgrades: ['forge'] }) }); const [u0, u1] = t2.order;
  const l2 = send(t2, u0, u1, 'hi'); const notCut = t2.order.find(id => id !== u0 && id !== u1 && id !== 'p2');
  t2.place(notCut, t2.state.map.courier); assert.match(t2.r.try('LETTER_INTERCEPT', { letterId: l2.id, action: 'forge', forgedText: 'bye' }, notCut).message, /Cutpurse/); t2.place(notCut, '2,-1');
  t2.place('p2', t2.state.map.courier); assert.equal(t2.r.try('LETTER_INTERCEPT', { letterId: l2.id, action: 'forge', forgedText: 'bye' }, 'p2'), null);
  // the Visor
  const t3 = table(); const [v0, v1, v2] = t3.order;
  t3.char(v0).worn.helmet = makeItem({ id: 'visor', name: "Impostor's Visor", slot: 'helmet', legendaryId: 'impostorsvisor' });
  const sealed = send(t3, v0, v1, 'nobody reads this');
  assert.equal(sealed.sealed, true); t3.place(v2, t3.state.map.courier); assert.deepEqual(interceptable(t3.state, v2), []);
  assert.match(t3.r.try('LETTER_INTERCEPT', { letterId: sealed.id, action: 'destroy' }, v2).message, /not passing/);
  t3.char(v0).worn.helmet = null; assert.equal(send(t3, v0, v1, 'now you can').sealed, false, 'sealing is decided when the crow leaves');
});

test('a Spyglass or the Cutpurse passive reads letters crossing your tile: sender or recipient on or next to you', () => {
  const t = table(); const [s0, s1, s2, s3] = t.order;
  t.char(s3).items.spy = makeItem({ id: 'spy', name: 'Spyglass', slot: 'tool', baseId: 'spyglass' });
  t.place(s0, '0,0'); t.place(s1, '0,1'); t.place(s3, '-3,3');
  const l = send(t, s0, s1, 'far away');
  assert.deepEqual(interceptable(t.state, s3), [], 'nobody near the glass');
  t.place(s3, '1,-1'); assert.deepEqual(interceptable(t.state, s3).map(x => x.id), [l.id], 'next to the sender');
  t.place(s3, '-1,2'); assert.deepEqual(interceptable(t.state, s3).map(x => x.id), [l.id], 'next to the recipient');
  t.place(s3, '2,-2'); assert.deepEqual(interceptable(t.state, s3), []);
  assert.deepEqual(interceptable(t.state, s2), [], 'no glass, no passive');
  t.char(s2).classId = 'cutpurse'; t.place(s2, '1,0'); assert.deepEqual(interceptable(t.state, s2).map(x => x.id), [l.id], 'the Cutpurse reads what crosses their tile');
  t.char(s2).dead = true; assert.deepEqual(interceptable(t.state, s2), []);
});

test('alliances travel by letter and are accepted on arrival; allies read as allied(); either side can break it', () => {
  const t = table(); const [s0, s1, s2] = t.order;
  t.r.append('ALLIANCE_PROPOSE', { toId: s1 }, s0); const prop = t.state.letters.at(-1);
  assert.equal(prop.kind, 'alliance'); assert.ok(prop.text.length);
  assert.match(t.r.try('ALLIANCE_ANSWER', { letterId: prop.id, accept: true }, s1).message, /not arrived/);
  assert.match(t.r.try('ALLIANCE_ANSWER', { letterId: prop.id, accept: true }, s2).message, /not addressed to you/);
  for (let i = 0; i < 5; i++) t.endTurn(); assert.ok(fresh(t, prop).deliveredAt);
  assert.equal(shared.allied(t.state, s0, s1), false);
  t.r.append('ALLIANCE_ANSWER', { letterId: prop.id, accept: true }, s1);
  assert.equal(t.state.alliances.length, 1); assert.deepEqual(t.state.alliances[0].members, [s0, s1]); assert.equal(shared.allied(t.state, s0, s1), true); assert.equal(shared.allied(t.state, s0, s2), false);
  assert.match(t.r.try('ALLIANCE_ANSWER', { letterId: prop.id, accept: true }, s1).message, /already answered/);
  send(t, s1, s0, 'again?', { kind: 'alliance' }); const p2 = t.state.letters.at(-1); p2.deliveredAt = 1;
  assert.match(t.r.try('ALLIANCE_ANSWER', { letterId: p2.id, accept: true }, s0).message, /already allied/);
  assert.match(t.r.try('ALLIANCE_ANSWER', { allianceId: t.state.alliances[0].id, accept: false }, s2).message, /not your alliance/);
  t.r.append('ALLIANCE_ANSWER', { allianceId: t.state.alliances[0].id, accept: false }, s0);
  assert.equal(t.state.alliances[0].active, false); assert.equal(shared.allied(t.state, s0, s1), false);
  // a declined proposal
  send(t, s2, s0, '', { kind: 'alliance' }); const p3 = t.state.letters.at(-1); p3.deliveredAt = 1;
  t.r.append('ALLIANCE_ANSWER', { letterId: p3.id, accept: false }, s0); assert.equal(fresh(t, p3).accepted, false); assert.equal(t.state.alliances.length, 1);
});

test('votes: a Chaos vote is secret, closes when all have voted or at the deadline, majority wins, ties go to the seeded pick', () => {
  const t = table(); const [s0, s1, s2, s3] = t.order;
  assert.match(t.r.try('VOTE_OPEN', { kind: 'chaos', options: [s0, s1] }, s0).message, /GM only/);
  t.r.append('VOTE_OPEN', { kind: 'chaos', options: [s0, s1, s2] });
  assert.match(t.r.try('VOTE_OPEN', { kind: 'chaos', options: [s0, s1] }).message, /already open/);
  const closed = []; const spy = (s, c, v) => closed.push(v.result); voteHooks.onClose.push(spy);
  try {
    t.r.append('VOTE_CAST', { choice: s1 }, s0); t.r.append('VOTE_CAST', { choice: s1 }, s2);
    assert.match(t.r.try('VOTE_CAST', { choice: s3 }, s0).message, /not an option/);
    assert.match(t.r.try('VOTE_CAST', { choice: s1 }, 'nobody').message, /not eligible/);
    const tv = voteView(t.state); assert.equal(tv.cast, 2); assert.equal(tv.eligible, 4); assert.equal(tv.myChoice, undefined, 'the TV sees counts only');
    assert.equal(voteView(t.state, s0).myChoice, s1);
    assert.match(t.r.try('VOTE_CLOSE', {}, s0).message, /still open/);
    t.r.append('VOTE_CAST', { choice: s0 }, s1); t.r.append('VOTE_CAST', { choice: s2 }, s3);
    t.r.append('VOTE_CLOSE', {}, s0);   // everyone voted: anyone may close
    assert.equal(t.state.votes, null); assert.equal(t.state.lastVote.result, s1); assert.deepEqual(closed, [s1]); assert.equal(t.state.lastVote.closedBy, 'all voted');
    // a tie at the deadline
    t.r.append('VOTE_OPEN', { kind: 'chaos', options: [s0, s1] });
    t.r.append('VOTE_CAST', { choice: s0 }, s2); t.r.append('VOTE_CAST', { choice: s1 }, s3);
    t.r.tick(B.social.voteSeconds * 1000 + 1); t.r.append('VOTE_CLOSE', {}, s1);
    assert.ok([s0, s1].includes(t.state.lastVote.result)); assert.equal(t.state.lastVote.closedBy, 'deadline'); assert.equal(closed.length, 2);
    // the GM may close early, even with no ballots
    t.r.append('VOTE_OPEN', { kind: 'chaos', options: [s0, s1], deadline: t.r.now() + 99_999 }); t.r.append('VOTE_CLOSE', {});
    assert.equal(t.state.lastVote.result, null);
  } finally { voteHooks.onClose.splice(voteHooks.onClose.indexOf(spy), 1); }
});

test('table vote: once a night, the victim goes to the Graveyard with the monster penalty', () => {
  const t = table(); const [s0, s1, s2, s3] = t.order;
  t.r.append('VOTE_OPEN', { kind: 'table' }, s0);
  assert.deepEqual(t.state.votes.options, t.order, 'defaults to every living seat'); assert.equal(t.state.votes.kind, 'table');
  for (const id of [s0, s2, s3]) t.r.append('VOTE_CAST', { choice: s1 }, id);
  t.r.append('VOTE_CAST', { choice: s0 }, s1);
  t.r.append('VOTE_CLOSE', {}, 'system');
  const v = t.char(s1); assert.equal(v.dead, true); assert.equal(v.missTurns, B.death.monsterMissTurns); assert.equal(v.diedTo, null); assert.equal(v.deaths, 1);
  assert.match(t.r.try('VOTE_OPEN', { kind: 'table' }, s2).message, /already voted/);
  assert.match(t.r.try('VOTE_OPEN', { kind: 'table', options: [s0, s2] }, s0).message, /already voted/);
});

test('emotes float over the avatar and only the last few are kept', () => {
  const t = table(); const [s0] = t.order;
  assert.match(t.r.try('EMOTE', {}, s0).message, /nothing to say/);
  for (let i = 0; i < 25; i++) t.r.append('EMOTE', { emoji: '😈', text: `taunt ${i}` }, s0);
  assert.equal(t.state.emotes.length, B.social.emoteKeep); assert.equal(t.state.emotes.at(-1).text, 'taunt 24'); assert.equal(t.state.emotes[0].playerId, s0);
  assert.match(t.r.try('EMOTE', { emoji: '😈' }, 'ghost').message, /no such player/);
});

test('side bets: only when on, only from outside the fight, even money in Health, settled when the challenge ends', () => {
  let t = table(); let [s0, s1, s2, s3] = t.order;
  rps(t, s0, s1);
  assert.match(t.r.try('SIDE_BET', { onId: s0, amount: 5 }, s2).message, /off tonight/);
  t = table({ balance: { social: { sideBetsOn: 1 } } }); [s0, s1, s2, s3] = t.order;
  t.r.append('PLAYER_JOIN', { playerId: 'spec', name: 'Watcher', deviceId: 'w', spectator: true }, 'system');
  assert.match(t.r.try('SIDE_BET', { onId: s0, amount: 5 }, s2).message, /no such challenge/);
  rps(t, s0, s1);
  assert.match(t.r.try('SIDE_BET', { onId: s0, amount: 5 }, s0).message, /you are in this fight/);
  assert.match(t.r.try('SIDE_BET', { onId: s2, amount: 5 }, s2).message, /side in the fight/);
  assert.match(t.r.try('SIDE_BET', { onId: s0, amount: 99 }, s2).message, /1 to 20/);
  t.char(s2).health = 6; assert.match(t.r.try('SIDE_BET', { onId: s0, amount: 6 }, s2).message, /last Health/); t.char(s2).health = 100;
  t.r.append('SIDE_BET', { onId: s0, amount: 10 }, s2); t.r.append('SIDE_BET', { onId: s1, amount: 15 }, s3); t.r.append('SIDE_BET', { onId: s0, amount: 5 }, 'spec');
  assert.equal(t.state.sideBets.length, 3);
  t.char(s2).health = 95;
  t.r.append('CHALLENGE_REPORT', { winnerId: s0 }, s0); t.r.append('CHALLENGE_REPORT', { winnerId: s0 }, s1);
  assert.ok(t.state.sideBets.every(b => b.settled));
  assert.equal(t.char(s2).health, 100, 'won 10, capped at max'); assert.equal(t.char(s3).health, 85, 'lost 15');
  assert.equal(t.state.sideBets[2].won, true); assert.equal(t.state.sideBets[2].recordOnly, true, 'a spectator has no Health to move');
  // a draw voids the bets
  rps(t, s0, s1); t.r.append('SIDE_BET', { onId: s1, amount: 5 }, s3); t.r.append('CHALLENGE_GM_DECIDE', { winnerId: 'draw' });
  assert.equal(t.state.sideBets.at(-1).settled, true); assert.equal(t.state.sideBets.at(-1).won, null); assert.equal(t.char(s3).health, 85);
  // a fight: settled from fight.result.winnerId once the fight is done; voided if the fight vanishes
  t.state.fight = { id: 'f1', kind: 'encounter', monsterId: 'm-1,1', playerIds: [s0], playerId: s0, turn: 'player', game: null, log: [], done: false, result: null, startedAt: 1 };
  t.r.append('SIDE_BET', { fightId: 'f1', onId: 'm-1,1', amount: 10 }, s2); t.r.append('SIDE_BET', { fightId: 'f1', onId: s0, amount: 10 }, s3);
  t.state.fight.done = true; t.state.fight.result = { winnerId: s0 }; t.r.append('EMOTE', { emoji: '👀' }, s2);   // any event after the fight ends settles
  assert.equal(t.char(s2).health, 90); assert.equal(t.char(s3).health, 95);
  t.state.fight = { id: 'f2', kind: 'encounter', monsterId: 'm-1,1', playerIds: [s0], done: false, result: null };
  t.r.append('SIDE_BET', { fightId: 'f2', onId: s0, amount: 10 }, s2); t.state.fight = null; t.r.append('EMOTE', { emoji: '👀' }, s2);
  assert.equal(t.state.sideBets.at(-1).won, null); assert.equal(t.char(s2).health, 90);
  // settleSideBets is exposed for the fight module to call directly
  t.state.fight = { id: 'f3', playerIds: [s0], monsterId: 'm', done: false }; t.r.append('SIDE_BET', { fightId: 'f3', onId: s0, amount: 3 }, s2);
  settleSideBets(t.state, { now: 5, B: (g) => B[g] }, 'fight', 'f3', s0); assert.equal(t.char(s2).health, 93);
});
