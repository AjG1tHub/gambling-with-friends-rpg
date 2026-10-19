// Loans + Collector timers (Phase 7). The Buy-In wheel's "Loan Shark" used to be pure GM
// adjudication; this gives it rules. A loan lives on the borrower:
//   { id, lender: 'house' | playerId, principal, owed, turnsLeft, status: 'open' | 'default', ts }
// Interest is flat and added up front. The term counts the BORROWER's own turns (jailed and
// skipped turns still count — debt doesn't sleep). Miss the deadline and the loan defaults:
// a one-time penalty is added and the Collector garnishes a fixed amount every turn until it's clear.
import { log, credit, bal } from './state.js';

export const LOAN_DEFAULTS = { enabled: true, minPrincipal: 100, maxPrincipal: 2000, interestPct: 25, termTurns: 4, penaltyPct: 20, garnishPerTurn: 150, maxOpenLoans: 2 };
export const loanRules = (config) => ({ ...LOAN_DEFAULTS, ...(config?.Loans || {}) });
export const openLoans = (player) => (player.loans || []).filter(l => l.owed > 0);
export const debtOf = (player) => openLoans(player).reduce((s, l) => s + l.owed, 0);
const lenderName = (state, l) => l.lender === 'house' ? 'the house' : (state.players.find(p => p.id === l.lender)?.name || 'a ghost');

// opts: { lender = 'house', interestPct, termTurns } — the GM may override the table terms.
export function takeLoan(config, state, borrower, principal, opts = {}) {
  const R = loanRules(config);
  if (!R.enabled) return { error: true, text: 'Loans are switched off in the config.' };
  principal = Math.round(Number(principal));
  if (!(principal >= R.minPrincipal)) return { error: true, text: `Minimum loan is ${R.minPrincipal} Gold.` };
  if (principal > R.maxPrincipal) return { error: true, text: `The most anyone lends is ${R.maxPrincipal} Gold.` };
  if (openLoans(borrower).length >= R.maxOpenLoans) return { error: true, text: `${borrower.name} already has ${R.maxOpenLoans} loans out.` };
  const lenderId = opts.lender || 'house';
  const lender = lenderId === 'house' ? null : state.players.find(p => p.id === lenderId);
  if (lenderId !== 'house') {
    if (!lender) return { error: true, text: 'No such lender.' };
    if (lender.id === borrower.id) return { error: true, text: 'You cannot lend to yourself.' };
    if (bal(lender, 'Gold') < principal) return { error: true, text: `${lender.name} only has ${bal(lender, 'Gold')} Gold to lend.` };
  }
  const pct = opts.interestPct != null && opts.interestPct !== '' ? Number(opts.interestPct) : R.interestPct;
  const term = opts.termTurns != null && opts.termTurns !== '' ? Math.round(Number(opts.termTurns)) : R.termTurns;
  if (!(pct >= 0) || !(term >= 1)) return { error: true, text: 'Interest must be 0% or more and the term at least 1 turn.' };
  const owed = Math.round(principal * (1 + pct / 100));
  borrower.loans = borrower.loans || [];
  state.loanSeq = (state.loanSeq || 0) + 1;
  const loan = { id: 'L' + state.loanSeq, lender: lenderId, principal, owed, interestPct: pct, turnsLeft: term, status: 'open', ts: Date.now() };
  borrower.loans.push(loan);
  if (lender) credit(state, lender, 'Gold', -principal, `Loan to ${borrower.name}`);
  credit(state, borrower, 'Gold', principal, `Loan from ${lenderName(state, loan)}`);
  log(state, 'LOAN', borrower.id, { loanId: loan.id, lender: lenderId, principal, owed, termTurns: term, interestPct: pct });
  return { loan, text: `${borrower.name} borrows ${principal} Gold from ${lenderName(state, loan)} — owes ${owed} within ${term} turn${term === 1 ? '' : 's'}.` };
}

// Money toward a loan (voluntary or garnished). Overpaying is capped at what is owed.
function pay(state, borrower, loan, amount, why) {
  const paid = Math.min(Math.round(amount), loan.owed);
  if (!(paid > 0)) return 0;
  credit(state, borrower, 'Gold', -paid, why);
  const lender = loan.lender === 'house' ? null : state.players.find(p => p.id === loan.lender);
  if (lender) credit(state, lender, 'Gold', paid, `Loan repaid by ${borrower.name}`);
  loan.owed -= paid;
  if (loan.owed <= 0) { loan.owed = 0; loan.status = 'paid'; loan.turnsLeft = 0; log(state, 'LOAN_PAID', borrower.id, { loanId: loan.id }); }
  return paid;
}

export function repayLoan(config, state, borrower, loanId, amount = null) {
  const loan = (borrower.loans || []).find(l => l.id === loanId);
  if (!loan || loan.owed <= 0) return { error: true, text: 'No open loan with that id.' };
  const want = amount == null || amount === '' ? loan.owed : Number(amount);
  if (!(want > 0)) return { error: true, text: 'Repayment must be positive.' };
  const paid = pay(state, borrower, loan, want, `Loan repayment (${loan.id})`);
  log(state, 'LOAN_REPAY', borrower.id, { loanId: loan.id, paid, owed: loan.owed });
  return { paid, loan, text: loan.owed ? `${borrower.name} pays ${paid} Gold — ${loan.owed} still owed.` : `${borrower.name} clears the loan (${paid} Gold). Debt free.` };
}

// Start-of-turn bookkeeping for the player whose turn it is. Returns GM-facing notes.
export function tickLoans(config, state, player) {
  const R = loanRules(config); const notes = [];
  for (const loan of openLoans(player)) {
    if (loan.status === 'open') {
      loan.turnsLeft -= 1;
      if (loan.turnsLeft <= 0) {
        const penalty = Math.round(loan.owed * R.penaltyPct / 100);
        loan.owed += penalty; loan.status = 'default'; loan.turnsLeft = 0;
        log(state, 'LOAN_DEFAULT', player.id, { loanId: loan.id, penalty, owed: loan.owed });
        notes.push(`💀 ${player.name} DEFAULTS on the loan from ${lenderName(state, loan)}: +${penalty} penalty, ${loan.owed} owed. The Collector is coming.`);
      } else if (loan.turnsLeft === 1) notes.push(`⏳ ${player.name}'s loan (${loan.owed} Gold) is due NEXT turn.`);
      continue;
    }
    if (loan.status === 'default') {
      const paid = pay(state, player, loan, R.garnishPerTurn, `Collector garnish (${loan.id})`);
      log(state, 'LOAN_GARNISH', player.id, { loanId: loan.id, paid, owed: loan.owed });
      notes.push(`🦈 The Collector garnishes ${paid} Gold from ${player.name}${loan.owed ? ` (${loan.owed} left)` : ' — debt cleared'}.`);
    }
  }
  return notes;
}

// Short tag for the leaderboard: "owes 625 · 3 turns" / "IN DEFAULT 780".
export function loanTags(player) {
  return openLoans(player).map(l => l.status === 'default' ? { text: `IN DEFAULT ${l.owed}`, bad: true } : { text: `owes ${l.owed} · ${l.turnsLeft} turn${l.turnsLeft === 1 ? '' : 's'}`, bad: l.turnsLeft <= 1 });
}
