import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, mkGame, fixedRng, gold, events } from './_helpers.mjs';

const run = (ctx, verb, params = {}, player = ctx.p, rng = ctx.rng) =>
  E.executeVerb(ctx.config, ctx.state, rng, { verb, params, label: verb }, player);

test('GOLD_DELTA adds and subtracts; Gold may go negative', () => {
  const c = mkGame(); run(c, 'GOLD_DELTA', { amount: 200 }); assert.equal(gold(c.p), 700);
  run(c, 'GOLD_DELTA', { amount: -900 }); assert.equal(gold(c.p), -200);
});

test('PCT_GOLD takes a rounded percentage of current Gold', () => {
  const c = mkGame(); c.p.balances.Gold = 333;
  run(c, 'PCT_GOLD', { pct: -10 }); assert.equal(gold(c.p), 300);
});

test('GO_TO_JAIL jails at tier 1 on the nearest JAIL tile, unless a Pardon burns', () => {
  const c = mkGame(); c.p.pos = 33;
  run(c, 'GO_TO_JAIL'); assert.equal(c.p.jailTier, 1); assert.equal(c.p.pos, 32);
  c.q.pardons = 1; run(c, 'GO_TO_JAIL', {}, c.q);
  assert.equal(c.q.jailTier, 0); assert.equal(c.q.pardons, 0); assert.equal(events(c.state, 'PARDON_USED').length, 1);
});

test('JAIL_ESCALATE caps at tier 4', () => {
  const c = mkGame(); c.p.jailTier = 3;
  run(c, 'JAIL_ESCALATE'); assert.equal(c.p.jailTier, 4);
  run(c, 'JAIL_ESCALATE'); assert.equal(c.p.jailTier, 4);
});

test('JAIL_TIER_DOWN drops a tier and frees from tier 1', () => {
  const c = mkGame(); c.p.jailTier = 2;
  run(c, 'JAIL_TIER_DOWN'); assert.equal(c.p.jailTier, 1);
  run(c, 'JAIL_TIER_DOWN'); assert.equal(c.p.jailTier, 0); assert.equal(events(c.state, 'JAIL_OUT').length, 1);
});

test('JAIL_RELEASE, JAIL_SKIP_SPIN, JAIL_SPIN_TWICE, SKIP_TURN set their flags', () => {
  const c = mkGame(); c.p.jailTier = 3;
  run(c, 'JAIL_SKIP_SPIN'); assert.equal(c.p.jailSkipNextSpin, true);
  run(c, 'JAIL_SPIN_TWICE'); assert.equal(c.p.jailSpinsNextTurn, 2);
  run(c, 'SKIP_TURN'); assert.equal(c.p.skipTurns, 1);
  run(c, 'JAIL_RELEASE'); assert.equal(c.p.jailTier, 0); assert.equal(c.p.jailSkipNextSpin, false); assert.equal(c.p.jailSpinsNextTurn, 1);
});

test('COMMISSARY and SHAKEDOWN scale with jail tier', () => {
  const c = mkGame(); c.p.jailTier = 1;
  run(c, 'COMMISSARY', { t12: 100, t34: 200 }); assert.equal(gold(c.p), 600);
  c.p.jailTier = 3; run(c, 'COMMISSARY', { t12: 100, t34: 200 }); assert.equal(gold(c.p), 800);
  run(c, 'SHAKEDOWN', { t12: -100, t3: -200 }); assert.equal(gold(c.p), 600);
  c.p.jailTier = 2; run(c, 'SHAKEDOWN', { t12: -100, t3: -200 }); assert.equal(gold(c.p), 500);
});

test('SHAKEDOWN at tier 4 takes the most valuable secondary stack, not Gold', () => {
  const c = mkGame(); c.p.jailTier = 4;
  c.p.balances.Gems = 3; c.p.balances.Bananas = 100;      // 15g vs 10g
  run(c, 'SHAKEDOWN', { t12: -100, t3: -200 });
  assert.equal(c.p.balances.Gems, 0); assert.equal(c.p.balances.Bananas, 100); assert.equal(gold(c.p), 500);
});

test('BUFF_NEXT_WIN and PARDON_GRANT', () => {
  const c = mkGame(); run(c, 'BUFF_NEXT_WIN', { mult: 2 }); assert.deepEqual(c.p.winMult, { mult: 2 });
  run(c, 'PARDON_GRANT'); run(c, 'PARDON_GRANT'); assert.equal(c.p.pardons, 2);
});

test('SECONDARY_RANDOM_GAIN gives an active non-Gold currency', () => {
  const c = mkGame(); run(c, 'SECONDARY_RANDOM_GAIN', { units: 5 });
  const gained = Object.entries(c.p.balances).filter(([k, v]) => k !== 'Gold' && v > 0);
  assert.equal(gained.length, 1); assert.equal(gained[0][1], 5);
});

test('SECONDARY_LOSE_RANDOM never takes more than is held, and is a no-op with none', () => {
  const c = mkGame(); assert.match(run(c, 'SECONDARY_LOSE_RANDOM', { units: 5 }).text, /no secondaries/);
  c.p.balances.Gems = 2; run(c, 'SECONDARY_LOSE_RANDOM', { units: 5 }); assert.equal(c.p.balances.Gems, 0);
});

test('STEAL_FROM_RICHEST and PAY_TO_POOREST move Gold between the right players', () => {
  const c = mkGame(['A', 'B', 'C']); const [a, b, d] = c.players;
  b.balances.Gold = 900; d.balances.Gold = 100;
  run(c, 'STEAL_FROM_RICHEST', { amount: 100 }, a); assert.equal(gold(a), 600); assert.equal(gold(b), 800);
  run(c, 'PAY_TO_POOREST', { amount: 50 }, a); assert.equal(gold(a), 550); assert.equal(gold(d), 150);
});

test('richest / poorest never pick the acting player', () => {
  const c = mkGame(['A', 'B']); c.p.balances.Gold = 5000;
  run(c, 'STEAL_FROM_RICHEST', { amount: 100 }); assert.equal(gold(c.q), 400); assert.equal(gold(c.p), 5100);
});

test('COLLECTOR sets the drain timer', () => {
  const c = mkGame(); run(c, 'COLLECTOR', { perTurn: 50, turns: 3 });
  assert.deepEqual(c.p.collector, { perTurn: 50, turnsLeft: 3 });
});

test('follow-up verbs return the right instruction flags', () => {
  const c = mkGame();
  assert.equal(run(c, 'SPIN_METHOD_AGAIN').spinMethodAgain, true);
  assert.equal(run(c, 'TELEPORT_CHOICE').gmPickTile, true);
  assert.equal(run(c, 'FORCED_MARCH', { steps: 3 }).forcedMarch, 3);
  assert.equal(run(c, 'SOMETHING_NEW').adjudicate, true);
  assert.match(run(c, 'NOTHING').text, /Nothing/);
});

test('TELEPORT_RANDOM moves the player and asks for a tile resolution', () => {
  const c = mkGame(); const r = run(c, 'TELEPORT_RANDOM', {}, c.p, fixedRng([0.25]));
  assert.equal(c.p.pos, 10); assert.equal(r.resolveTile, true);
});

test('Void verbs: Exile goes to the farthest tile, Rewind returns to the move start, Long Way flips', () => {
  const c = mkGame(); c.p.pos = 0;
  run(c, 'VOID_EXILE'); assert.equal(E.torusDist(c.config, 0, c.p.pos), 6);
  c.state.move = { startPos: 5, done: false, reversed: false }; c.p.pos = 9;
  run(c, 'VOID_LONG_WAY'); assert.equal(c.state.move.reversed, true);
  run(c, 'VOID_REWIND'); assert.equal(c.p.pos, 5); assert.equal(c.state.move.done, true);
});

test('GOOD / BAD / START wheels execute the outcome they land on', () => {
  const c = mkGame();
  const r = E.spinGoodBad(c.config, c.state, fixedRng([0]), 'good', c.p);        // Payday +200
  assert.equal(r.outcome.label, 'Payday'); assert.equal(gold(c.p), 700);
  assert.equal(c.state.lastSpin.wheel, 'GOOD Wheel'); assert.match(c.state.lastSpin.effect, /\+200/);
  const b = E.spinGoodBad(c.config, c.state, fixedRng([0]), 'bad', c.q);         // Go to Jail
  assert.equal(b.outcome.verb, 'GO_TO_JAIL'); assert.equal(c.q.jailTier, 1);
  const s = E.spinStartWheel(c.config, c.state, fixedRng([0]), c.p);             // Welcome Home +150
  assert.equal(s.outcome.label, 'Welcome Home'); assert.equal(gold(c.p), 850);
});

test('every wheel in the default config sums to a positive weight and uses a known verb', () => {
  const c = mkGame();
  for (const tab of ['Wheel_Good', 'Wheel_Bad', 'Wheel_Void', 'Wheel_Start']) {
    for (const row of c.config[tab]) {
      const ctx = mkGame(); ctx.p.jailTier = 1; ctx.state.move = { startPos: 0, done: false };
      const r = E.executeVerb(ctx.config, ctx.state, ctx.rng, row, ctx.p);
      assert.notEqual(r.adjudicate, true, `${tab} → ${row.label} uses unhandled verb ${row.verb}`);
    }
    assert.ok(c.config[tab].reduce((s, r) => s + r.weight, 0) > 0);
  }
});
