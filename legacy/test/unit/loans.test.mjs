import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, mkGame, gold, events } from './_helpers.mjs';
const LN = await import('../../site/js/loans.js');
const ST = await import('../../site/js/stats.js');

const turn = (c, player = c.p) => LN.tickLoans(c.config, c.state, player);

test('a house loan pays out the principal and books flat interest up front', () => {
  const c = mkGame(); const r = LN.takeLoan(c.config, c.state, c.p, 1000);
  assert.equal(r.error, undefined); assert.equal(gold(c.p), 1500);
  assert.deepEqual([r.loan.principal, r.loan.owed, r.loan.turnsLeft, r.loan.status, r.loan.lender], [1000, 1250, 4, 'open', 'house']);
  assert.equal(LN.debtOf(c.p), 1250); assert.equal(events(c.state, 'LOAN').length, 1);
});

test('the GM can override interest and term per loan', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400, { interestPct: 0, termTurns: 1 });
  assert.deepEqual([loan.owed, loan.turnsLeft], [400, 1]);
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 400, { interestPct: -5 }).error, true);
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 400, { termTurns: 0 }).error, true);
});

test('blank override fields fall back to the table terms', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400, { interestPct: '', termTurns: '' });
  assert.deepEqual([loan.owed, loan.turnsLeft], [500, 4]);
});

test('limits: minimum, maximum, and loans per player', () => {
  const c = mkGame();
  assert.match(LN.takeLoan(c.config, c.state, c.p, 50).text, /Minimum/);
  assert.match(LN.takeLoan(c.config, c.state, c.p, 2001).text, /most anyone lends/);
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 'abc').error, true);
  LN.takeLoan(c.config, c.state, c.p, 100); LN.takeLoan(c.config, c.state, c.p, 100);
  assert.match(LN.takeLoan(c.config, c.state, c.p, 100).text, /already has 2 loans/);
  assert.equal(gold(c.p), 700);
});

test('loans can be switched off in the config', () => {
  const c = mkGame(['A', 'B'], 1, (cfg) => { cfg.Loans.enabled = false; });
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 500).error, true); assert.equal(gold(c.p), 500);
});

test('a missing Loans tab (older Sheet) uses the built-in rules', () => {
  const c = mkGame(['A', 'B'], 1, (cfg) => { delete cfg.Loans; });
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 500).loan.owed, 625);
});

test('player-to-player loans move the lender\'s Gold and repay the lender', () => {
  const c = mkGame();
  const { loan } = LN.takeLoan(c.config, c.state, c.p, 400, { lender: c.q.id });
  assert.equal(gold(c.q), 100); assert.equal(gold(c.p), 900);
  LN.repayLoan(c.config, c.state, c.p, loan.id);
  assert.equal(gold(c.q), 600); assert.equal(gold(c.p), 400); assert.equal(loan.status, 'paid');
});

test('player lenders need the Gold; no self-loans; unknown lenders rejected', () => {
  const c = mkGame();
  assert.match(LN.takeLoan(c.config, c.state, c.p, 600, { lender: c.q.id }).text, /only has 500/);
  assert.match(LN.takeLoan(c.config, c.state, c.p, 100, { lender: c.p.id }).text, /yourself/);
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 100, { lender: 'ghost' }).error, true);
  assert.equal(gold(c.p), 500);
});

test('repaying: partial, capped at what is owed, and closing the loan', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400);        // owes 500
  assert.equal(LN.repayLoan(c.config, c.state, c.p, loan.id, 200).paid, 200); assert.equal(loan.owed, 300);
  const r = LN.repayLoan(c.config, c.state, c.p, loan.id, 9999);
  assert.equal(r.paid, 300); assert.equal(loan.owed, 0); assert.equal(gold(c.p), 400);
  assert.equal(LN.repayLoan(c.config, c.state, c.p, loan.id).error, true);
  assert.equal(LN.repayLoan(c.config, c.state, c.p, 'nope').error, true);
  assert.equal(LN.openLoans(c.p).length, 0); assert.equal(events(c.state, 'LOAN_PAID').length, 1);
});

test('repayment amounts must be positive', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400);
  assert.equal(LN.repayLoan(c.config, c.state, c.p, loan.id, 0).error, true);
  assert.equal(LN.repayLoan(c.config, c.state, c.p, loan.id, -50).error, true);
  assert.equal(loan.owed, 500);
});

test('the term counts down on the borrower\'s turns, with a warning the turn before it is due', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400);
  assert.deepEqual(turn(c), []); assert.equal(loan.turnsLeft, 3);
  turn(c, c.q); assert.equal(loan.turnsLeft, 3);                              // someone else's turn doesn't count
  turn(c); assert.match(turn(c)[0], /due NEXT turn/); assert.equal(loan.turnsLeft, 1);
});

test('missing the deadline defaults the loan: one-time penalty, then the Collector garnishes each turn', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400);          // owes 500
  for (let i = 0; i < 3; i++) turn(c);
  const notes = turn(c);
  assert.match(notes[0], /DEFAULTS/); assert.equal(loan.status, 'default'); assert.equal(loan.owed, 600);
  assert.equal(gold(c.p), 900);                                               // nothing taken on the default turn itself
  turn(c); assert.equal(loan.owed, 450); assert.equal(gold(c.p), 750);
  turn(c); turn(c); assert.equal(loan.owed, 150);
  const last = turn(c); assert.match(last[0], /debt cleared/);
  assert.equal(loan.owed, 0); assert.equal(loan.status, 'paid'); assert.equal(gold(c.p), 300);
  assert.deepEqual(turn(c), []);                                              // no penalty twice, nothing more taken
  assert.equal(events(c.state, 'LOAN_DEFAULT').length, 1); assert.equal(events(c.state, 'LOAN_GARNISH').length, 4);
});

test('garnished Gold goes to a player lender and can push the borrower negative', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400, { lender: c.q.id, termTurns: 1 });
  c.p.balances.Gold = 20;
  turn(c); turn(c);
  assert.equal(gold(c.p), -130); assert.equal(gold(c.q), 250); assert.equal(loan.owed, 450);
});

test('paying off before the deadline avoids the default entirely', () => {
  const c = mkGame(); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400, { termTurns: 2 });
  turn(c); LN.repayLoan(c.config, c.state, c.p, loan.id);
  assert.deepEqual(turn(c), []); assert.equal(events(c.state, 'LOAN_DEFAULT').length, 0);
});

test('beginTurn ticks loans even on skipped and jailed turns', () => {
  const c = mkGame(['A', 'B']); const { loan } = LN.takeLoan(c.config, c.state, c.p, 400, { termTurns: 3 });
  c.p.skipTurns = 1; assert.equal(E.beginTurn(c.config, c.state).kind, 'skip'); assert.equal(loan.turnsLeft, 2);
  c.p.jailTier = 1; assert.equal(E.beginTurn(c.config, c.state).kind, 'jail'); assert.equal(loan.turnsLeft, 1);
  const r = E.beginTurn(c.config, c.state); assert.ok(r.notes.some(n => /DEFAULTS/.test(n)));
});

test('net worth subtracts unpaid loans, so borrowing never climbs the leaderboard', () => {
  const c = mkGame(['A', 'B']);
  LN.takeLoan(c.config, c.state, c.p, 2000);
  assert.equal(S.goldValue(c.config, c.p), 2500); assert.equal(S.netWorth(c.config, c.p), 0); assert.equal(S.debtOwed(c.p), 2500);
  const table = ST.standings(c.config, c.state);
  assert.deepEqual(table.map(s => [s.name, s.value, s.debt]), [['B', 500, 0], ['A', 0, 2500]]);
  assert.equal(S.richest(c.config, c.state).name, 'B'); assert.equal(S.poorest(c.config, c.state).name, 'A');
});

test('leaderboard tags: countdown, last-turn warning, default', () => {
  const c = mkGame(); LN.takeLoan(c.config, c.state, c.p, 400, { termTurns: 2 });
  assert.deepEqual(LN.loanTags(c.p), [{ text: 'owes 500 · 2 turns', bad: false }]);
  turn(c); assert.deepEqual(LN.loanTags(c.p), [{ text: 'owes 500 · 1 turn', bad: true }]);
  turn(c); assert.deepEqual(LN.loanTags(c.p), [{ text: 'IN DEFAULT 600', bad: true }]);
  assert.deepEqual(LN.loanTags(c.q), []);
});

test('stats count loans and defaults, and award the Deadbeat', () => {
  const c = mkGame(); LN.takeLoan(c.config, c.state, c.p, 400, { termTurns: 1 }); turn(c);
  const st = ST.sessionStats(c.config, c.state);
  assert.deepEqual([st.players[c.p.id].loans, st.players[c.p.id].borrowed, st.players[c.p.id].defaults, st.totals.loans, st.totals.defaults], [1, 400, 1, 1, 1]);
  assert.equal(st.awards.find(a => a.key === 'deadbeat').name, 'Aj');
});

test('players saved before loans existed (no loans array) still work', () => {
  const c = mkGame(); delete c.p.loans;
  assert.equal(LN.debtOf(c.p), 0); assert.deepEqual(turn(c), []); assert.equal(S.netWorth(c.config, c.p), 500);
  assert.equal(LN.takeLoan(c.config, c.state, c.p, 100).error, undefined); assert.equal(c.p.loans.length, 1);
});
