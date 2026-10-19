import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, mkGame, fixedRng, gold, events } from './_helpers.mjs';

test('sendToJail hauls the player to the nearest JAIL tile and ends their move', () => {
  const c = mkGame(); c.p.pos = 24; c.state.move = { done: false };
  E.sendToJail(c.config, c.state, c.p, 'test');
  assert.equal(c.p.jailTier, 1); assert.equal(c.state.board[c.p.pos].type, 'JAIL'); assert.equal(c.state.move.done, true);
  assert.equal(events(c.state, 'JAIL_IN').length, 1);
});

test('sendToJail on an already-jailed player changes nothing (no entry above tier 1 from the board)', () => {
  const c = mkGame(); c.p.jailTier = 3;
  E.sendToJail(c.config, c.state, c.p, 'again');
  assert.equal(c.p.jailTier, 3); assert.equal(events(c.state, 'JAIL_IN').length, 0);
});

test('buyout fees follow the config per tier: 200 / 400 / 800 / 1600', () => {
  const c = mkGame();
  [200, 400, 800, 1600].forEach((fee, i) => { c.p.jailTier = i + 1; assert.equal(E.jailBuyoutFee(c.config, c.p), fee); });
});

test('buyout is always available — it can push Gold negative — and frees the player', () => {
  const c = mkGame(); c.p.jailTier = 4;
  E.jailBuyout(c.config, c.state, c.p);
  assert.equal(gold(c.p), -1100); assert.equal(c.p.jailTier, 0);
  assert.deepEqual(events(c.state, 'JAIL_BUYOUT').map(e => [e.tier, e.fee]), [[4, 1600]]);
});

test('Bribe halves the next buyout and is consumed', () => {
  const c = mkGame(); c.p.jailTier = 2; c.p.heldPowerUps.push({ id: 'bribe', name: 'Bribe' });
  assert.equal(E.jailBuyoutFee(c.config, c.p), 200);
  E.jailBuyout(c.config, c.state, c.p);
  assert.equal(gold(c.p), 300); assert.equal(c.p.heldPowerUps.length, 0);
});

test('Skill Check: win frees, loss costs the fixed stake and keeps the tier', () => {
  const c = mkGame(); c.p.jailTier = 2;
  E.jailSkillCheck(c.config, c.state, c.rng, c.p, false);
  assert.equal(gold(c.p), 400); assert.equal(c.p.jailTier, 2);
  E.jailSkillCheck(c.config, c.state, c.rng, c.p, true);
  assert.equal(c.p.jailTier, 0); assert.equal(gold(c.p), 400);
});

test('Double-or-Detain: win frees and pays the wager, loss takes it and adds a tier', () => {
  const c = mkGame(); c.p.jailTier = 1;
  E.jailRiskCheck(c.config, c.state, fixedRng([0.9]), c.p, 300);         // lose
  assert.equal(gold(c.p), 200); assert.equal(c.p.jailTier, 2);
  E.jailRiskCheck(c.config, c.state, fixedRng([0.1]), c.p, 300);         // win
  assert.equal(gold(c.p), 500); assert.equal(c.p.jailTier, 0);
});

test('Double-or-Detain rejects wagers under the minimum and caps escalation at tier 4', () => {
  const c = mkGame(); c.p.jailTier = 4;
  assert.equal(E.jailRiskCheck(c.config, c.state, fixedRng([0.9]), c.p, 50).error, true);
  assert.equal(gold(c.p), 500);
  E.jailRiskCheck(c.config, c.state, fixedRng([0.9]), c.p, 100);
  assert.equal(c.p.jailTier, 4);
});

test('Social Barter: payer covers the fee; prisoner skips a turn or owes 25% of 3 wins', () => {
  const c = mkGame(); c.p.jailTier = 2;
  E.jailSocialBarter(c.config, c.state, c.q, c.p, 'skip');
  assert.equal(gold(c.q), 100); assert.equal(c.p.jailTier, 0); assert.equal(c.p.skipTurns, 1);
  c.p.jailTier = 1;
  E.jailSocialBarter(c.config, c.state, c.q, c.p, 'cut');
  assert.equal(gold(c.q), -100);
  assert.deepEqual({ ...c.p.debuffs[0], tag: undefined }, { tag: undefined, winsLeft: 3, payeeId: c.q.id, cut: 0.25 });
});

test('Jail Wheel weights sum to 100 for every tier', () => {
  const c = mkGame();
  for (const tier of [1, 2, 3, 4]) assert.equal(c.config.Wheel_Jail.reduce((s, r) => s + r.weights[tier], 0), 100, `tier ${tier}`);
});

test('Jail Wheel uses the tier column: Solitary only at tier 4', () => {
  const idx = (c, label) => c.config.Wheel_Jail.findIndex(r => r.label === label);
  for (const tier of [1, 2, 3]) {
    const c = mkGame(); c.p.jailTier = tier;
    for (let i = 0; i < 400; i++) { c.p.jailTier = tier; const { outcome } = E.spinJailWheel(c.config, c.state, c.rng, c.p); assert.notEqual(outcome.label, 'Solitary'); }
  }
  const c = mkGame(); c.p.jailTier = 4;
  const before = c.config.Wheel_Jail.slice(0, idx(c, 'Solitary')).reduce((s, r) => s + r.weights[4], 0);
  const { outcome } = E.spinJailWheel(c.config, c.state, fixedRng([(before + 1) / 100]), c.p);
  assert.equal(outcome.label, 'Solitary'); assert.equal(c.p.jailSpinsNextTurn, 2);
});

test('Escape comes up at roughly the configured rate (25% at tier 1)', () => {
  const c = mkGame(); let esc = 0; const N = 8000;
  for (let i = 0; i < N; i++) { c.p.jailTier = 1; c.p.balances.Gold = 500; if (E.spinJailWheel(c.config, c.state, c.rng, c.p).outcome.label === 'Escape') esc++; c.state.ledger.length = 0; }
  assert.ok(Math.abs(esc / N - 0.25) < 0.02, `escape rate ${esc / N}`);
});

test('Lockpick adds 15 Escape weight for one spin and is consumed', () => {
  const c = mkGame(); c.p.jailTier = 1; c.p.heldPowerUps.push({ id: 'lockpick', name: 'Lockpick' });
  // total weight 115, Escape = 40 → a roll at 39/115 escapes (without Lockpick, 39/100 would be Reduced Sentence… also free at T1, so check the label)
  const { outcome } = E.spinJailWheel(c.config, c.state, fixedRng([39.5 / 115]), c.p);
  assert.equal(outcome.label, 'Escape'); assert.equal(c.p.heldPowerUps.length, 0);
  assert.equal(events(c.state, 'POWERUP_USED')[0].id, 'lockpick');
});

test('jail is a player state: a jailed player keeps their tier through endTurn / beginTurn', () => {
  const c = mkGame(['A', 'B']); c.p.jailTier = 2;
  assert.equal(E.beginTurn(c.config, c.state).kind, 'jail');
  E.endTurn(c.state); E.endTurn(c.state);
  assert.equal(c.p.jailTier, 2);
});
