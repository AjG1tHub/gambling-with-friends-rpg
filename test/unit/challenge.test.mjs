// The Challenge Wheel: calls, the spin and the GM window, every hosted entry through two bots, external entries
// through agreement / disagreement / timeout while the table keeps playing and owed turns come back in order,
// Wager and Robbery with Wanted, the Arena, team series, death by a challenge hit, the list editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table, playHosted, shared, currentPlayerId } from './_fixtures-social.mjs';
import * as hosted from '../../packages/shared/challenge/hosted.js';
import { applyChallengeHit, offScreenCard, challengeView, activeList, exportLists, VERSUS_GAMES } from '../../packages/shared/handlers/challenge.js';
import { damageHooks, deathHooks, petHooks } from '../../packages/shared/hooks.js';
import { remainingMs } from '../../packages/shared/clock.js';
import presets from '../../data/challenges.json' with { type: 'json' };

const B = shared.B;

// Start a duel between seat 0 and seat 1 on the rigged entry and spin it. Returns the fixture.
function duel(t, entryId, { call = 'duel', amount, extra = {} } = {}) {
  const [a, b] = t.order; t.until(a);
  t.rigEntry(entryId);
  t.r.append('CHALLENGE_CALL', { defenderId: b, call, amount, ...extra }, a);
  if (call === 'wager') t.r.append('CHALLENGE_ANSWER', { accept: true }, b);
  t.r.append('CHALLENGE_SPIN', {}, a);
  assert.equal(t.state.challenge.entryId, entryId, `rigged to ${entryId}`);
  return t;
}
const report = (t, by, winnerId) => t.r.append('CHALLENGE_REPORT', { winnerId }, by);

test('call: reach, turn, duels switch, held targets, PvE and teams, attack budget, wager and robbery limits', () => {
  const t = table(); const [a, b, c, d] = t.order;
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: a, call: 'duel' }, b).message, /not your turn/);
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: a, call: 'duel' }, a).message, /yourself/);
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'punch' }, a).message, /call must be/);
  t.place(b, '3,0'); assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a).message, /out of reach/); t.place(b, '1,0');
  t.char(a).worn.mainhand.reach = 3; t.place(b, '3,0'); assert.equal(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'wager', amount: 10 }, a), null, 'a weapon with reach 3 reaches'); t.r.append('CHALLENGE_ANSWER', { accept: false }, b); t.place(b, '1,0'); delete t.char(a).worn.mainhand.reach;
  assert.equal(t.char(a).usedThisTurn.attack, 0, 'a declined Wager costs nothing');
  t.state.gm.duelsEnabled = false; assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a).message, /Duels are off/); t.state.gm.duelsEnabled = true;
  t.state.held[b] = { since: 1 }; assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a).message, /away in a challenge/); delete t.state.held[b];
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'wager', amount: 500 }, a).message, /poorer player/);
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'wager' }, a).message, /name the wager/);
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'robbery', amount: 26 }, a).message, /1 to 25/);
  t.char(b).gold = 0; assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'robbery', amount: 1 }, a).message, /nothing worth robbing/); t.char(b).gold = 100;
  t.state.players[a].teamId = 'x'; t.state.players[b].teamId = 'x'; assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a).message, /inside a team/); t.state.players[a].teamId = t.state.players[b].teamId = null;
  t.state.mode = 'pve'; assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'robbery', amount: 5 }, a).message, /PvE/); assert.equal(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'wager', amount: 5 }, a), null, 'a Wager is fine in PvE'); t.r.append('CHALLENGE_ANSWER', { accept: false }, b); t.state.mode = 'ffa';
  // one attack per turn; the budget is spent by the call
  t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a); assert.equal(t.char(a).usedThisTurn.attack, 1);
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: c, call: 'duel' }, a).message, /already in progress/);
  assert.match(t.r.try('TURN_END', {}, a).message, /finish the challenge/);
  assert.match(t.r.try('CHALLENGE_ANSWER', { accept: false }, b).message, /cannot be declined/);
  t.r.append('CHALLENGE_GM_DECIDE', {}); assert.equal(t.state.challenge, null, 'the GM cancels an unspun call');
  assert.equal(t.char(a).usedThisTurn.attack, 0);
  t.char(a).usedThisTurn.attack = B.items.attacksPerTurn;
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a).message, /already attacked/);
});

test('spin: seeded weighted pick from the active list, the GM window (reroll / force / too late), holds and clocks, no repeat per pair', () => {
  const t = table(); const [a, b, c] = t.order;
  t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a);
  assert.match(t.r.try('CHALLENGE_SPIN', {}, c).message, /not in this challenge/);
  const before = remainingMs(t.state, a, t.r.now());
  t.r.append('CHALLENGE_SPIN', {}, a);
  const ch = t.state.challenge; assert.ok(ch.spun && ch.entry && ch.deadline > t.r.now());
  assert.equal(ch.gmWindowUntil, t.r.now() + B.challenge.gmWindowSeconds * 1000);
  assert.equal(ch.deadline, ch.gmWindowUntil + (ch.entry.hosted ? B.challenge.hostedCapSeconds : B.challenge.externalCapSeconds) * 1000);
  assert.deepEqual(t.state.lastSpin.outcomes, activeList(t.state).filter(e => e.enabled).map(e => e.name)); assert.equal(t.state.lastSpin.wheel, 'challenge'); assert.equal(t.state.lastSpin.revealAt, ch.gmWindowUntil);
  assert.ok(t.state.held[a] && t.state.held[b], 'both seats held'); assert.equal(t.state.clocks[a].runningSince, null, 'the attacker\'s clock stopped');
  assert.ok(t.state.clocks[a].bankMs <= before);
  assert.equal(currentPlayerId(t.state), c, 'the table moved on to the next free seat'); assert.equal(t.state.turnIdx, 1);
  // GM reroll and force before the TV animation
  const firstEntry = ch.entryId;
  t.r.append('CHALLENGE_GM_SET', { reroll: true }); assert.notEqual(t.state.challenge.entryId, firstEntry); assert.equal(t.state.lastSpin.how, 'reroll');
  t.r.append('CHALLENGE_GM_SET', { entryId: 'rps5' }); assert.equal(t.state.challenge.entryId, 'rps5'); assert.equal(t.state.lastSpin.how, 'forced');
  assert.match(t.r.try('CHALLENGE_GM_SET', { entryId: 'nope' }).message, /no such entry/);
  assert.match(t.r.try('CHALLENGE_GM_SET', { entryId: 'clash' }, a).message, /GM only/);
  t.r.tick(B.challenge.gmWindowSeconds * 1000 + 1); assert.match(t.r.try('CHALLENGE_GM_SET', { entryId: 'clash' }).message, /already animated/);
  assert.deepEqual(offScreenCard(t.state), { entryName: 'Rock-Paper-Scissors (best of 5)', aId: a, bId: b, deadline: t.state.challenge.deadline, hosted: false });
  report(t, a, a); report(t, b, a);
  assert.equal(t.state.challenge, null); assert.equal(t.state.lastChallenge.winnerId, a);
  // the same pair cannot land on the same entry again while the list is long enough
  t.until(a); t.rigEntry('rps5'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a); t.r.append('CHALLENGE_SPIN', {}, a);
  assert.notEqual(t.state.challenge.entryId, 'rps5', 'no repeat within a fight between the same two');
  t.r.append('CHALLENGE_GM_DECIDE', { winnerId: 'draw' });
  // a short list repeats freely
  t.r.append('CHALLENGE_LIST', { preset: 'tiny', entries: [{ id: 'rps5', name: 'RPS', hosted: false, rules: '', weight: 1, enabled: true }, { id: 'x', name: 'X', hosted: false, rules: '', weight: 1, enabled: true }], activate: true });
  t.until(a); t.rigEntry('rps5'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a); t.r.append('CHALLENGE_SPIN', {}, a);
  assert.equal(t.state.challenge.entryId, 'rps5');
});

test('every hosted entry: two bots play each purpose-built duel through CHALLENGE_STEP; the versus items settle on a report', () => {
  for (const game of hosted.PURPOSE_BUILT) {
    const t = table({ seed: 7 }); const [a, b] = t.order;
    t.r.append('CHALLENGE_LIST', { preset: 'discord' });
    duel(t, game);
    const ch = t.state.challenge; assert.ok(ch.hostedGame && ch.hostedGame.game === game); assert.equal(ch.hostedGame.startedAt, ch.gmWindowUntil, 'play starts when the animation ends');
    const view = challengeView(t.state, a, t.r.now()); assert.equal(view.phase, 'spinning'); assert.equal(view.role, 'attacker'); assert.ok(view.hosted && view.hosted.game === game); assert.deepEqual(view.reportButtons, [], 'purpose-built duels report themselves');
    assert.match(t.r.try('CHALLENGE_STEP', { action: 'x' }, t.order[2]).message, /not in this challenge/);
    t.r.tick(B.challenge.gmWindowSeconds * 1000);
    const steps = playHosted(t, hosted, { smartB: game === 'quickdraw' || game === 'highestcard' || game === 'memorymatch' });
    assert.ok(steps > 0, `${game}: bots moved`); assert.equal(t.state.challenge, null, `${game}: settled`);
    const last = t.state.lastChallenge; assert.equal(last.how, 'hosted');
    assert.ok(!t.state.held[a] && !t.state.held[b], `${game}: both released`);
    if (last.winnerId) {
      const loser = last.winnerId === a ? b : a;
      const dmg = last.flawless ? 10 * B.challenge.critMult : 10 * B.challenge.winMult;
      assert.equal(t.char(loser).health, 100 - dmg, `${game}: the loser took stake × ${last.flawless ? 'crit' : 'win'} (${dmg})`);
      assert.equal(t.char(last.winnerId).health, 100);
      assert.equal(t.state.stats[last.winnerId].challengesWon, 1); assert.equal(t.state.stats[loser].challengesLost, 1);
    }
    if (game !== 'quickdraw' && game !== 'highestcard' && game !== 'memorymatch') { assert.equal(last.winnerId, a, `${game}: the perfect bot wins`); assert.equal(last.flawless, true); }
  }
  // the four versus items are hosted by the items adapter: one report from the hosting phone settles
  for (const game of VERSUS_GAMES) {
    const t = table(); const [a, b] = t.order; duel(t, game);
    assert.equal(t.state.challenge.hostedGame, null); assert.ok(challengeView(t.state, b).reportButtons.length === 3);
    report(t, b, b);
    assert.equal(t.state.challenge, null); assert.equal(t.state.lastChallenge.winnerId, b); assert.equal(t.char(a).health, 90, `${game}: defender's weapon hits the attacker`);
  }
  // a phone may publish the whole game object too (actor-authoritative), and a stale one is refused
  const t = table(); const [a, b] = t.order; duel(t, 'highestcard'); t.r.tick(B.challenge.gmWindowSeconds * 1000);
  const g1 = hosted.act(t.state.challenge.hostedGame, a, 'draw', {}, t.r.now()); t.r.append('CHALLENGE_STEP', { game: g1 }, a);
  assert.match(t.r.try('CHALLENGE_STEP', { game: { ...g1, seed: 1 } }, b).message, /different game/);
  t.r.append('CHALLENGE_STEP', { game: hosted.act(t.state.challenge.hostedGame, b, 'draw', {}, t.r.now()) }, b);
  assert.equal(t.state.challenge, null);
});

test('external entry: the table keeps playing; agreement settles; disagreement waits for the GM; timeout costs both; owed turns come back in order', () => {
  // agreement
  let t = table(); let [s0, s1, s2, s3] = t.order;
  duel(t, 'rps5');
  assert.equal(t.cur(), s2);
  t.endTurn(); assert.equal(t.cur(), s2, 's2 plays the held slot and then its own'); t.endTurn(); assert.equal(t.cur(), s3);
  assert.equal(t.state.held[s1].missedTurn, true); assert.equal(t.state.held[s0].missedTurn, false);
  report(t, s0, s0); assert.ok(t.state.challenge && !t.state.challenge.done); assert.equal(challengeView(t.state, s0).myReport, s0);
  report(t, s1, s0);
  assert.equal(t.state.challenge, null); assert.equal(t.char(s1).health, 90); assert.deepEqual(t.state.owedTurns.map(o => o.playerId), [s1]);
  const seq = []; for (let i = 0; i < 8; i++) { t.endTurn(); seq.push(t.cur()); }
  assert.deepEqual(seq, [s1, s0, s1, s3, s0, s1, s2, s3], 'the owed turn is inserted and the borrowed one repaid; then the order is as it was');
  assert.deepEqual(t.state.owedTurns, []); assert.deepEqual(Object.values(t.state.turnCredits).filter(Boolean), []);
  // disagreement → GM decides (Drop Back In)
  t = table(); [s0, s1, s2, s3] = t.order; duel(t, 'rps5');
  report(t, s0, s0); report(t, s1, s1);
  assert.equal(t.state.challenge.gmPending, true); assert.equal(challengeView(t.state, s2).gmPending, true);
  assert.match(t.r.try('CHALLENGE_GM_DECIDE', { winnerId: s1 }, s1).message, /GM only/);
  t.r.append('CHALLENGE_GM_DECIDE', { winnerId: s1 });
  assert.equal(t.state.challenge, null); assert.equal(t.state.lastChallenge.how, 'gm'); assert.equal(t.char(s0).health, 90);
  assert.ok(!t.state.held[s0] && !t.state.held[s1]);
  // timeout while two full laps went by: both take timeoutDamage, every missed slot is owed back, oldest first
  t = table(); [s0, s1, s2, s3] = t.order; duel(t, 'rps5');
  assert.match(t.r.try('CHALLENGE_TIMEOUT', {}, 'system').message, /cap has not passed/);
  for (let i = 0; i < 4; i++) t.endTurn();           // slots 1..4: s2 (borrowed), s2, s3, s2 (borrowed s0's) → s2 is now borrowing slot 5 from s1
  assert.equal(t.state.turnIdx, 5); assert.deepEqual(t.state.held[s0].misses, [4]); assert.deepEqual(t.state.held[s1].misses, [1, 5]);
  t.r.tick(B.challenge.externalCapSeconds * 1000 + B.challenge.gmWindowSeconds * 1000);
  t.r.append('CHALLENGE_TIMEOUT', {}, 'system');
  assert.equal(t.state.challenge, null); assert.equal(t.state.lastChallenge.how, 'timeout');
  assert.equal(t.char(s0).health, 100 - B.challenge.timeoutDamage); assert.equal(t.char(s1).health, 100 - B.challenge.timeoutDamage);
  assert.deepEqual(t.state.owedTurns.map(o => o.playerId), [s1, s0, s1], 'owed in the order the slots were missed');
  const seq2 = []; for (let i = 0; i < 13; i++) { t.endTurn(); seq2.push(t.cur()); }
  assert.deepEqual(seq2, [s1, s0, s1, s3, s0, s1, s3, s0, s1, s3, s0, s1, s2], 'the three owed turns are inserted and s2 sits out the three it borrowed');
  const counts = {}; for (const id of seq2) counts[id] = (counts[id] || 0) + 1;
  assert.deepEqual(counts, { [s0]: 4, [s1]: 5, [s2]: 1, [s3]: 3 });
});

test('two-player table: the whole table is in the challenge, idles, and resumes on the next seat when it settles', () => {
  const t = table({ names: ['Aj', 'Nick'] }); const [a, b] = t.order;
  duel(t, 'rps5');
  assert.equal(t.state.tableIdle, true); assert.equal(t.state.turnIdx, 1); assert.equal(t.state.turnStartedAt, null);
  assert.match(t.r.try('TURN_END', {}, a).message, /finish the challenge|cannot act/);
  report(t, a, b); report(t, b, b);
  assert.equal(t.state.tableIdle, false); assert.equal(t.cur(), b); assert.notEqual(t.state.clocks[b].runningSince, null, 'b\'s clock runs again');
  assert.deepEqual(t.state.owedTurns, []);
});

test('wager: accept and decline; a hosted entry decides it; the pot moves', () => {
  const t = table(); const [a, b] = t.order;
  t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'wager', amount: 40 }, a);
  assert.match(t.r.try('CHALLENGE_SPIN', {}, a).message, /not accepted/);
  assert.equal(challengeView(t.state, b).canAnswer, true); assert.equal(challengeView(t.state, b).phase, 'answer');
  assert.match(t.r.try('CHALLENGE_ANSWER', { accept: true }, a).message, /cannot act/);
  t.r.append('CHALLENGE_ANSWER', { accept: false }, b); assert.equal(t.state.challenge, null); assert.equal(t.char(a).gold, 100); assert.equal(t.char(b).gold, 100);
  duel(t, 'speedmath', { call: 'wager', amount: 40 }); t.r.tick(B.challenge.gmWindowSeconds * 1000);
  playHosted(t, hosted, { smartB: false });
  assert.equal(t.state.lastChallenge.winnerId, a); assert.equal(t.char(a).gold, 140); assert.equal(t.char(b).gold, 60);
  assert.equal(t.char(a).health, 100); assert.equal(t.char(b).health, 100, 'a Wager draws no blood');
});

test('robbery: success takes the Gold; failure pays it back and makes the robber Wanted; a Duel kill claims the bounty', () => {
  let t = table(); let [a, b] = t.order;
  duel(t, 'rps5', { call: 'robbery', amount: 25 }); report(t, a, a); report(t, b, a);
  assert.equal(t.char(a).gold, 125); assert.equal(t.char(b).gold, 75); assert.equal(t.char(a).wanted, 0);
  // failure
  t = table(); [a, b] = t.order; const c = t.order[2];
  duel(t, 'rps5', { call: 'robbery', amount: 20 }); report(t, a, b); report(t, b, b);
  assert.equal(t.char(a).gold, 80); assert.equal(t.char(b).gold, 120); assert.equal(t.char(a).wanted, B.gold.wantedTurns); assert.equal(t.char(a).wantedBounty, 20);
  // the bounty: c duels a and kills them
  t.char(a).health = 5; t.place(c, '0,1');
  t.until(a); assert.equal(t.char(a).wanted, B.gold.wantedTurns - 1, 'Wanted counts down on the robber\'s own turns');
  t.endTurn(); t.until(c);
  t.rigEntry('rps5'); t.r.append('CHALLENGE_CALL', { defenderId: a, call: 'duel' }, c); t.r.append('CHALLENGE_SPIN', {}, c);
  report(t, c, c); report(t, a, c);
  assert.equal(t.char(a).dead, true); assert.equal(t.char(a).diedTo, 'player'); assert.equal(t.char(a).wanted, 0);
  assert.equal(t.char(c).gold, 100 + B.gold.perKO + 20, 'KO pay plus the bounty'); assert.equal(t.char(c).kills, 1); assert.equal(t.state.stats[c].kills, 1);
  // Wanted expires on its own
  t = table(); [a, b] = t.order; duel(t, 'rps5', { call: 'robbery', amount: 10 }); report(t, a, b); report(t, b, b);
  for (let i = 0; i < 3; i++) { t.until(a); t.endTurn(); }
  assert.equal(t.char(a).wanted, 0); assert.equal(t.char(a).wantedBounty, 0);
});

test('the hit runs the damage pipeline and the death hooks; a flawless win is a crit; pets take it first', () => {
  const t = table(); const [a, b] = t.order;
  const ctx = (now) => ({ now, B: (g) => shared.group(t.state, g) });
  // info carries character ids like the items pipeline; the death hooks get { charId, killerId, killerKind }
  const seen = []; const out = (s, c, info) => { seen.push(info.kind); info.mult += 0.5; }; const died = []; const onDeath = (s, c, info) => died.push([info.charId, info.killerId, info.killerKind]);
  damageHooks.outgoing.push(out); deathHooks.onDeath.push(onDeath);
  try {
    let r = applyChallengeHit(t.state, ctx(1), a, b, t.char(a).worn.mainhand, { crit: false });
    assert.equal(r.dmg, 15); assert.equal(t.char(b).health, 85); assert.deepEqual(seen, ['challenge']);
    assert.equal(r.info.attackerId, t.char(a).id); assert.equal(r.info.targetId, t.char(b).id); assert.equal(r.info.targetPlayerId, b);
    r = applyChallengeHit(t.state, ctx(2), a, b, t.char(a).worn.mainhand, { crit: true });
    assert.equal(r.dmg, 25, 'crit: stake × (critMult + 0.5)');
    t.char(b).shield = 10; r = applyChallengeHit(t.state, ctx(3), a, b, t.char(a).worn.mainhand); assert.equal(t.char(b).health, 60 - 5, 'shield absorbs first');
    t.char(b).health = 4; r = applyChallengeHit(t.state, ctx(4), a, b, t.char(a).worn.mainhand);
    assert.equal(r.killed, true); assert.deepEqual(died, [[t.char(b).id, t.char(a).id, 'player']]); assert.equal(t.char(b).dead, true);
    // death.js's penalties ran: KO Gold paid once, turns missed, the body at the Graveyard (the start here), the killer offered the worn gear
    assert.equal(t.char(a).gold, 100 + B.gold.perKO); assert.equal(t.char(a).kills, 1); assert.equal(t.state.stats[a].kills, 1); assert.equal(t.state.stats[b].deaths, 1);
    assert.equal(t.char(b).missTurns, B.death.playerMissTurns); assert.equal(t.char(b).pos, t.state.map.start); assert.equal(t.state.pendingPrompt?.kind, 'takeWorn'); assert.equal(t.state.pendingPrompt.playerId, a);
    assert.ok(t.state.wall.includes(t.char(b).name), 'the name goes on the Wall');
    // a pet in front takes the hit
    const c = t.order[2]; t.char(c).pets = [{ id: 'pet1', name: 'Mucky', power: 30, fainted: false }];
    const redirect = (s, cx, info) => { if (info.targetPlayerId === c) info.redirectToPet = 'pet1'; };
    petHooks.beforeCharacterHit.push(redirect);
    try { r = applyChallengeHit(t.state, ctx(5), a, c, t.char(a).worn.mainhand); assert.equal(r.redirected, true); assert.equal(t.char(c).pets[0].power, 15); assert.equal(t.char(c).health, 100); }
    finally { petHooks.beforeCharacterHit.splice(petHooks.beforeCharacterHit.indexOf(redirect), 1); }
  } finally { damageHooks.outgoing.splice(damageHooks.outgoing.indexOf(out), 1); deathHooks.onDeath.splice(deathHooks.onDeath.indexOf(onDeath), 1); }
  // the real pets module redirects to the active pet on its own
  const d = t.order[3]; t.char(d).pets = [{ id: 'pet2', name: 'Chips', power: 40, maxPower: 40, fainted: false, attacks: [] }]; t.char(d).activePetId = 'pet2';
  const rp = applyChallengeHit(t.state, ctx(6), a, d, t.char(a).worn.mainhand); assert.equal(rp.redirected, true); assert.equal(t.char(d).pets[0].power, 30); assert.equal(t.char(d).health, 100);
  // with the table's neutralisers off, the other modules' mods apply: the Whale's stake discount and damage bonus, the target's Grit
  const live = table({ neutral: false }); const [x, y] = live.order;
  const rl = applyChallengeHit(live.state, { now: 7, B: (g) => shared.group(live.state, g) }, x, y, live.char(x).worn.mainhand);
  assert.equal(rl.dmg, Math.round(10 * (1 - B.classes.whaleStakeDiscount) * (1 + B.classes.whaleDamageBonus) * (1 - live.char(y).stats.grit * B.health.gritReducePerPoint)));
  assert.ok(rl.info.notes.includes('Whale') && rl.info.notes.some(n => /grit/.test(n)), rl.info.notes.join('; '));
});

test('Enforcer Call Out reaches three hexes and marks the challenge; a non-Enforcer cannot', () => {
  const t = table({ char: (pid) => ({ classId: pid === 'p0' ? 'enforcer' : 'whale' }) });
  const enf = 'p0'; const other = t.order.find(id => id !== enf);
  t.until(enf); t.place(enf, '0,0'); t.place(other, '3,0');
  assert.match(t.r.try('CHALLENGE_CALL', { defenderId: other, call: 'duel' }, enf).message, /out of reach/);
  t.r.append('CHALLENGE_CALL', { defenderId: other, call: 'duel', callOut: true }, enf);
  assert.equal(t.state.challenge.calledOut, true); assert.equal(challengeView(t.state, other).calledOut, true);
  t.r.append('CHALLENGE_GM_DECIDE', {});
  t.place(other, '4,-1'); assert.match(t.r.try('CHALLENGE_CALL', { defenderId: other, call: 'duel', callOut: true }, enf).message, /too far to Call Out/);
  t.char(enf).upgrades = ['regioncall']; assert.equal(t.r.try('CHALLENGE_CALL', { defenderId: other, call: 'duel', callOut: true }, enf), null, 'level 20: the whole region'); t.r.append('CHALLENGE_GM_DECIDE', {});
  const t2 = table(); const [a, b] = t2.order; t2.place(b, '3,0');
  assert.match(t2.r.try('CHALLENGE_CALL', { defenderId: b, call: 'duel', callOut: true }, a).message, /only an Enforcer/);
});

test('arena: the prompt lets the mover challenge anyone on the map; both stake the wager and the crowd pays the winner', () => {
  const t = table(); const [a, b] = t.order; t.place(b, '3,0');
  t.state.pendingPrompt = { kind: 'arena', playerId: a };
  t.rigEntry('rps5'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel', arenaWager: 30 }, a);
  assert.equal(t.state.pendingPrompt, null); assert.equal(t.state.challenge.arena, true);
  t.r.append('CHALLENGE_SPIN', {}, a);
  assert.equal(t.char(a).gold, 70); assert.equal(t.char(b).gold, 70); assert.equal(t.state.challenge.pot, 60);
  report(t, a, b); report(t, b, b);
  assert.equal(t.char(b).gold, 70 + 60 + B.gold.arenaCrowdBonus); assert.equal(t.char(a).gold, 70); assert.equal(t.char(a).health, 90);
  // a draw refunds the stakes
  t.until(a); t.state.pendingPrompt = { kind: 'arena', playerId: a }; t.rigEntry('armwrestle'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel', arenaWager: 10 }, a); t.r.append('CHALLENGE_SPIN', {}, a);
  t.r.append('CHALLENGE_GM_DECIDE', { winnerId: 'draw' }); assert.equal(t.char(a).gold, 70); assert.equal(t.char(b).gold, 155);
});

test('team entries are best-of-three of the same game; the series ends at two wins or after three rounds', () => {
  const t = table(); const [a, b] = t.order;
  duel(t, 'freethrows');
  assert.deepEqual(t.state.challenge.series, { target: 2, maxRounds: 3, round: 1, wins: { [a]: 0, [b]: 0 }, log: [] });
  report(t, a, a); report(t, b, a);
  assert.ok(t.state.challenge, 'still on'); assert.equal(t.state.challenge.series.round, 2); assert.equal(t.state.challenge.entryId, 'freethrows'); assert.deepEqual(t.state.challenge.reports, {});
  assert.ok(t.state.held[a] && t.state.held[b], 'still held between rounds');
  report(t, a, b); report(t, b, b); assert.equal(t.state.challenge.series.round, 3);
  report(t, a, b); report(t, b, b);
  assert.equal(t.state.challenge, null); assert.equal(t.state.lastChallenge.winnerId, b); assert.equal(t.char(a).health, 90); assert.equal(t.char(b).health, 100, 'one hit for the series, not per round');
  // a purpose-built team series reseeds each round; the GM's decision ends the whole series
  t.r.append('CHALLENGE_LIST', { preset: 'teams', entries: [{ id: 'sm', name: 'Speed Math relay', hosted: true, game: 'speedmath', rules: '', players: 'team', weight: 1, enabled: true }], activate: true });
  t.until(a); t.rigEntry('sm'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a); t.r.append('CHALLENGE_SPIN', {}, a);
  const seed1 = t.state.challenge.seed; t.r.tick(B.challenge.gmWindowSeconds * 1000); playHosted(t, hosted, { smartB: false, oneRound: true });
  assert.ok(t.state.challenge); assert.equal(t.state.challenge.series.wins[a], 1); assert.notEqual(t.state.challenge.seed, seed1); assert.equal(t.state.challenge.hostedGame.done, false);
  t.r.append('CHALLENGE_GM_DECIDE', { winnerId: b }); assert.equal(t.state.challenge, null); assert.equal(t.state.lastChallenge.winnerId, b);
});

test('timeout on a purpose-built duel takes the standing score; with no score both bleed', () => {
  let t = table(); let [a, b] = t.order; duel(t, 'speedmath'); t.r.tick(B.challenge.gmWindowSeconds * 1000);
  const g = t.state.challenge.hostedGame; t.r.append('CHALLENGE_STEP', { action: 'answer', payload: { answer: g.questions[0].answer } }, a);
  t.r.tick(B.challenge.hostedCapSeconds * 1000); t.r.append('CHALLENGE_TIMEOUT', {}, 'system');
  assert.equal(t.state.lastChallenge.winnerId, a); assert.equal(t.state.lastChallenge.how, 'cap'); assert.equal(t.char(b).health, 90);
  t = table(); [a, b] = t.order; duel(t, 'quickdraw'); t.r.tick((B.challenge.gmWindowSeconds + B.challenge.hostedCapSeconds) * 1000); t.r.append('CHALLENGE_TIMEOUT', {}, 'system');
  assert.equal(t.state.lastChallenge.winnerId, null); assert.equal(t.char(a).health, 90); assert.equal(t.char(b).health, 90);
});

test('list editor: save and activate presets, import/export the data shape, validate entries, GM trivia bank', () => {
  const t = table({ start: false });
  assert.equal(activeList(t.state), presets.presets.inperson.entries);
  t.r.append('CHALLENGE_LIST', { preset: 'quick' }); assert.equal(t.state.gm.challengePreset, 'quick'); assert.equal(activeList(t.state).length, 5);
  assert.match(t.r.try('CHALLENGE_LIST', { preset: 'nope' }).message, /no challenge list/);
  assert.match(t.r.try('CHALLENGE_LIST', { preset: 'bad', entries: [{ id: 'x', name: 'X', hosted: true, game: 'chess', weight: 1 }] }).message, /unknown hosted game/);
  assert.match(t.r.try('CHALLENGE_LIST', { preset: 'bad', entries: [{ id: 'x', name: 'X', hosted: false, weight: 1 }, { id: 'x', name: 'Y', hosted: false, weight: 1 }] }).message, /duplicate/);
  assert.match(t.r.try('CHALLENGE_LIST', { preset: 'quick' }, 'p0').message, /GM only/);
  const mine = [{ id: 'arm', name: 'Arm', hosted: false, rules: 'Pull.', weight: 2, enabled: true, players: '1v1' }, { id: 'qd', name: 'Quick', hosted: true, game: 'quickdraw', rules: 'Tap.', weight: 1, enabled: false }];
  t.r.append('CHALLENGE_LIST', { preset: 'latenight', name: 'Late Night', entries: mine, activate: true });
  assert.equal(t.state.gm.challengePreset, 'latenight'); assert.equal(activeList(t.state)[1].capSeconds, null); assert.equal(activeList(t.state)[1].enabled, false);
  const ex = exportLists(t.state); assert.deepEqual(Object.keys(ex.presets), ['inperson', 'discord', 'quick', 'latenight']); assert.equal(ex.presets.latenight.name, 'Late Night'); assert.equal(ex.active, 'latenight');
  const t2 = table({ start: false }); t2.r.append('CHALLENGE_LIST', { presets: { latenight: ex.presets.latenight }, preset: 'latenight', activate: true });
  assert.deepEqual(activeList(t2.state), activeList(t.state));
  // editing the built-in In Person list overrides it for this room only
  t.r.append('CHALLENGE_LIST', { preset: 'inperson', entries: presets.presets.inperson.entries.map(e => ({ ...e, enabled: e.id === 'rps5' })) , activate: true });
  assert.equal(activeList(t.state).filter(e => e.enabled).length, 1);
  t.r.append('CHALLENGE_LIST', { preset: 'inperson', remove: true }); assert.equal(activeList(t.state), presets.presets.inperson.entries);
  t.r.append('CHALLENGE_LIST', { trivia: [{ id: 'g1', q: 'Who is the GM?', options: ['Aj', 'Nick'], answer: 0 }, { bad: true }] });
  assert.equal(t.state.gm.triviaBank.length, 1);
});
