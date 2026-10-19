// The purpose-built hosted duels of the Challenge Wheel (SPEC.md › PvP: the Challenge Wheel). Pure logic, no
// state access: the challenge handler seeds a game from the room's 'challenge' stream and stores it on
// state.challenge.hostedGame; a phone (or the reducer, see CHALLENGE_STEP) advances it with `act`; `done`
// says who won. Everything is deterministic from the seed and the event timestamps passed as `now`.
//
//   create(seed, entry, { aId, bId }, now, B?)   → game            B = the `challenge` balance group (defaults to shipped values)
//   act(game, playerId, action, payload, now)     → game            returns a new object; an illegal action returns the game unchanged
//   done(game)                                    → winnerId | null | 'draw'
//   result(game)                                  → { winnerId, draw, flawless } | null
//   atCap(game, now)                              → the standing result when the time cap hits (most correct / most pairs…) or null
//   phoneView(game, playerId, now)                → what that phone shows (the other side's hidden picks removed)
//   tvView(game, now)                             → what the stage shows
//
// The four Versus items (Clash, Dice Duel, Shell Game, Hold'em Duel) are not here: they run through the items
// adapter on the phones and report through CHALLENGE_REPORT.
import { makeRng } from '../rng.js';
import { B as BAL } from '../balance.js';
import triviaBank from '../../../data/trivia.json' with { type: 'json' };

export const PURPOSE_BUILT = ['quickdraw', 'speedmath', 'memorymatch', 'trivia', 'highestcard', 'typingrace', 'emojimemory'];
export const isPurposeBuilt = (gameId) => PURPOSE_BUILT.includes(gameId);

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], SUITS = ['♠', '♥', '♦', '♣'];
const SYMBOLS = ['🂡', '🎲', '🎰', '🪙', '🔔', '🍒', '💎', '👑', '🃏', '🧿'];
const EMOJI = ['🂠', '🎲', '🎰', '🪙', '🔔', '🍒', '💎', '👑', '🃏', '🧿', '🕯', '🐦', '🩸', '⚔', '🪦', '🏪'];
const SENTENCES = [
  'The house always wins but tonight the house is drunk.',
  'Never bet against a croupier with a crooked smile.',
  'Six cold dice and one warm pocket full of borrowed gold.',
  'The crow brings letters nobody wanted to read aloud.',
  'Fold early, run late, and never trust the shell on the left.',
  'A wheel of ruin spins the same for kings and cutpurses.',
  'Blood pacts are cheap on the pier and dear everywhere else.',
  'Quick hands lose slow games and slow hands lose quick ones.',
];

const clone = (g) => structuredClone(g);
const cfg = (B) => ({ ...BAL.challenge, ...(B || {}) });
const other = (g, pid) => (pid === g.aId ? g.bId : g.aId);
const isPlayer = (g, pid) => pid === g.aId || pid === g.bId;
const base = (seed, entry, ids, now) => ({ game: entry.game, entryId: entry.id, seed: seed >>> 0, aId: ids.aId, bId: ids.bId, startedAt: now, finishedAt: null, winnerId: null, draw: false, flawless: false, done: false });
function finish(g, winnerId, { flawless = false, now = null } = {}) { g.done = true; g.winnerId = winnerId; g.draw = winnerId == null; g.flawless = !!winnerId && flawless; g.finishedAt = now; return g; }
const cardOf = (rng) => { const r = rng.int(0, RANKS.length - 1), s = rng.int(0, SUITS.length - 1); return { rank: r, label: RANKS[r] + SUITS[s] }; };

// ---------------------------------------------------------------- the seven duels
const GAMES = {
  // Quick-Draw: the TV flashes at a seeded delay; the first tap after the flash wins; a tap before it is a false start.
  quickdraw: {
    create(seed, entry, ids, now, B) { const rng = makeRng(seed), C = cfg(B); return { ...base(seed, entry, ids, now), flashAt: now + rng.int(C.quickdrawMinDelayMs, C.quickdrawMaxDelayMs), flawlessMs: C.quickdrawFlawlessMs, taps: {} }; },
    act(g, pid, action, payload, now) {
      if (action !== 'tap' || g.taps[pid] != null) return g;
      g.taps[pid] = now;
      if (now < g.flashAt) return finish(g, other(g, pid), { now, flawless: false });            // false start: the other wins
      return finish(g, pid, { now, flawless: now - g.flashAt <= g.flawlessMs });
    },
    atCap() { return null; },
    phoneView(g, pid, now) { return { tapped: g.taps[pid] != null, falseStart: g.taps[pid] != null && g.taps[pid] < g.flashAt, flashed: g.done ? true : undefined, reactionMs: g.winnerId === pid ? g.taps[pid] - g.flashAt : null }; },
    tvView(g, now) { return { flash: now != null && now >= g.flashAt, flashAt: g.flashAt, taps: g.taps }; },
  },
  // Speed Math: the same N seeded sums for both; first to answer them all correctly wins, most correct at the cap.
  speedmath: {
    create(seed, entry, ids, now, B) {
      const rng = makeRng(seed), C = cfg(B), ops = ['+', '-', '×'], qs = [];
      for (let i = 0; i < C.speedMathQuestions; i++) {
        const op = rng.pick(ops); let a = rng.int(2, C.speedMathMaxOperand), b = rng.int(2, C.speedMathMaxOperand);
        if (op === '-' && b > a) [a, b] = [b, a];
        if (op === '×') b = rng.int(2, Math.max(2, Math.round(C.speedMathMaxOperand / 2)));
        qs.push({ text: `${a} ${op} ${b}`, answer: op === '+' ? a + b : op === '-' ? a - b : a * b });
      }
      return { ...base(seed, entry, ids, now), questions: qs, total: qs.length, progress: { [ids.aId]: { idx: 0, correct: 0, wrong: 0, finishedAt: null }, [ids.bId]: { idx: 0, correct: 0, wrong: 0, finishedAt: null } } };
    },
    act(g, pid, action, payload, now) {
      const p = g.progress[pid]; if (action !== 'answer' || !p || p.idx >= g.total) return g;
      if (Number(payload?.answer) === g.questions[p.idx].answer) p.correct += 1; else p.wrong += 1;
      p.idx += 1;
      if (p.correct === g.total) return finish(g, pid, { now, flawless: p.wrong === 0 });
      if (p.idx >= g.total) p.finishedAt = now;
      const q = g.progress[other(g, pid)];
      if (p.idx >= g.total && q.idx >= g.total) { const r = GAMES.speedmath.atCap(g); return finish(g, r?.winnerId ?? null, { now, flawless: !!r?.flawless }); }
      return g;
    },
    atCap(g) {
      const a = g.progress[g.aId], b = g.progress[g.bId];
      if (a.correct === b.correct) {
        if (a.finishedAt != null && b.finishedAt != null && a.finishedAt !== b.finishedAt) { const w = a.finishedAt < b.finishedAt ? g.aId : g.bId; return { winnerId: w, flawless: false }; }
        return a.correct === 0 && b.correct === 0 ? null : { winnerId: null, flawless: false };
      }
      const w = a.correct > b.correct ? g.aId : g.bId; return { winnerId: w, flawless: g.progress[w].wrong === 0 && g.progress[w].correct === g.total };
    },
    phoneView(g, pid) { const p = g.progress[pid], q = g.progress[other(g, pid)]; return { question: p.idx < g.total ? g.questions[p.idx].text : null, index: p.idx, total: g.total, correct: p.correct, opponentAnswered: q.idx, opponentCorrect: q.correct }; },
    tvView(g) { return { total: g.total, scores: { [g.aId]: g.progress[g.aId].correct, [g.bId]: g.progress[g.bId].correct } }; },
  },
  // Memory Match: a seeded 4×3 grid of six pairs; players alternate flipping two; a match keeps the turn; most pairs wins.
  memorymatch: {
    create(seed, entry, ids, now, B) {
      const rng = makeRng(seed), C = cfg(B), syms = rng.shuffle(SYMBOLS).slice(0, C.memoryPairs);
      const cards = rng.shuffle([...syms, ...syms]).map((s, i) => ({ i, s, matched: false }));
      return { ...base(seed, entry, ids, now), cards, pairs: C.memoryPairs, turn: ids.aId, faceUp: [], score: { [ids.aId]: 0, [ids.bId]: 0 }, lastFlip: [] };
    },
    act(g, pid, action, payload, now) {
      if (action !== 'flip' || g.turn !== pid) return g;
      if (g.faceUp.length === 2) g.faceUp = [];                       // the previous miss turns back over
      const i = Number(payload?.index), c = g.cards[i]; if (!c || c.matched || g.faceUp.includes(i)) return g;
      g.faceUp.push(i);
      if (g.faceUp.length === 2) {
        const [x, y] = g.faceUp; g.lastFlip = [x, y];
        if (g.cards[x].s === g.cards[y].s) { g.cards[x].matched = g.cards[y].matched = true; g.score[pid] += 1; g.faceUp = []; }
        else g.turn = other(g, pid);
        const a = g.score[g.aId], b = g.score[g.bId], left = g.pairs - a - b;
        if (left === 0 || a > g.pairs / 2 || b > g.pairs / 2) { const r = GAMES.memorymatch.atCap(g); return finish(g, r?.winnerId ?? null, { now, flawless: !!r?.flawless }); }
      }
      return g;
    },
    atCap(g) { const a = g.score[g.aId], b = g.score[g.bId]; if (a === b) return a === 0 ? null : { winnerId: null, flawless: false }; const w = a > b ? g.aId : g.bId; return { winnerId: w, flawless: g.score[other(g, w)] === 0 }; },
    phoneView(g, pid) { return { yourTurn: g.turn === pid, cards: g.cards.map(c => (c.matched || g.faceUp.includes(c.i) ? c.s : null)), score: g.score, lastFlip: g.lastFlip }; },
    tvView(g) { return { turn: g.turn, cards: g.cards.map(c => (c.matched || g.faceUp.includes(c.i) ? c.s : null)), score: g.score }; },
  },
  // Trivia: N seeded questions from the bank; both answer each; most correct, the faster total time breaks a tie.
  trivia: {
    create(seed, entry, ids, now, B, bank) {
      const rng = makeRng(seed), C = cfg(B), src = (bank && bank.length ? bank : triviaBank.questions);
      const qs = rng.shuffle(src).slice(0, Math.min(C.triviaQuestions, src.length)).map(q => ({ id: q.id, q: q.q, options: q.options, answer: q.answer }));
      return { ...base(seed, entry, ids, now), questions: qs, total: qs.length, answers: { [ids.aId]: [], [ids.bId]: [] }, time: { [ids.aId]: 0, [ids.bId]: 0 }, lastAt: { [ids.aId]: now, [ids.bId]: now } };
    },
    act(g, pid, action, payload, now) {
      const mine = g.answers[pid]; if (action !== 'answer' || !mine || mine.length >= g.total) return g;
      const q = g.questions[mine.length], choice = Number(payload?.choice);
      mine.push({ choice, correct: choice === q.answer }); g.time[pid] += Math.max(0, now - g.lastAt[pid]); g.lastAt[pid] = now;
      if (mine.length >= g.total && g.answers[other(g, pid)].length >= g.total) { const r = GAMES.trivia.atCap(g); return finish(g, r?.winnerId ?? null, { now, flawless: !!r?.flawless }); }
      return g;
    },
    atCap(g) {
      const score = (pid) => g.answers[pid].filter(a => a.correct).length, a = score(g.aId), b = score(g.bId);
      if (a === 0 && b === 0) return null;
      let w = a > b ? g.aId : b > a ? g.bId : (g.time[g.aId] < g.time[g.bId] ? g.aId : g.time[g.bId] < g.time[g.aId] ? g.bId : null);
      return { winnerId: w, flawless: !!w && score(w) === g.total };
    },
    phoneView(g, pid) { const n = g.answers[pid].length, q = g.questions[n]; return { question: q ? { q: q.q, options: q.options } : null, index: n, total: g.total, correct: g.answers[pid].filter(a => a.correct).length, opponentAnswered: g.answers[other(g, pid)].length }; },
    tvView(g) { return { total: g.total, answered: { [g.aId]: g.answers[g.aId].length, [g.bId]: g.answers[g.bId].length }, scores: g.done ? { [g.aId]: g.answers[g.aId].filter(a => a.correct).length, [g.bId]: g.answers[g.bId].filter(a => a.correct).length } : null }; },
  },
  // Highest Card: one seeded card each, ties redraw (resolved at creation so the result is fixed from the seed).
  highestcard: {
    create(seed, entry, ids, now) {
      const rng = makeRng(seed); let a, b, redraws = 0;
      do { a = cardOf(rng); b = cardOf(rng); if (a.rank === b.rank) redraws += 1; } while (a.rank === b.rank && redraws < 52);
      return { ...base(seed, entry, ids, now), cards: { [ids.aId]: a, [ids.bId]: b }, redraws, drawn: {} };
    },
    act(g, pid, action, payload, now) {
      if (action !== 'draw' || g.drawn[pid]) return g;
      g.drawn[pid] = true;
      if (g.drawn[g.aId] && g.drawn[g.bId]) { const a = g.cards[g.aId], b = g.cards[g.bId]; if (a.rank === b.rank) return finish(g, null, { now }); const w = a.rank > b.rank ? g.aId : g.bId; return finish(g, w, { now, flawless: g.cards[w].rank === RANKS.length - 1 }); }
      return g;
    },
    atCap(g) { return null; },
    phoneView(g, pid) { const both = g.drawn[g.aId] && g.drawn[g.bId]; return { drawn: !!g.drawn[pid], card: g.drawn[pid] ? g.cards[pid].label : null, opponentCard: both ? g.cards[other(g, pid)].label : null, redraws: g.redraws }; },
    tvView(g) { const both = g.drawn[g.aId] && g.drawn[g.bId]; return { cards: both ? { [g.aId]: g.cards[g.aId].label, [g.bId]: g.cards[g.bId].label } : null, drawn: g.drawn, redraws: g.redraws }; },
  },
  // Typing Race: a seeded sentence; first to submit it with at most `typingMaxErrors` errors wins; a bad submission may be retried.
  typingrace: {
    create(seed, entry, ids, now, B) { const rng = makeRng(seed), C = cfg(B); return { ...base(seed, entry, ids, now), sentence: rng.pick(SENTENCES), maxErrors: C.typingMaxErrors, attempts: { [ids.aId]: [], [ids.bId]: [] } }; },
    act(g, pid, action, payload, now) {
      if (action !== 'submit' || !g.attempts[pid]) return g;
      const errors = countErrors(g.sentence, String(payload?.text ?? '')); g.attempts[pid].push({ errors, at: now });
      if (errors <= g.maxErrors) return finish(g, pid, { now, flawless: errors === 0 });
      return g;
    },
    atCap(g) { return null; },
    phoneView(g, pid) { return { sentence: g.sentence, attempts: g.attempts[pid].length, lastErrors: g.attempts[pid].at(-1)?.errors ?? null, opponentAttempts: g.attempts[other(g, pid)].length }; },
    tvView(g) { return { sentence: g.sentence, attempts: { [g.aId]: g.attempts[g.aId].length, [g.bId]: g.attempts[g.bId].length } }; },
  },
  // Emoji Memory: a seeded sequence; each round a player recalls one more; a miss ends their run; the longest run wins.
  emojimemory: {
    create(seed, entry, ids, now, B) { const rng = makeRng(seed), C = cfg(B); const seq = Array.from({ length: C.emojiSequenceLength }, () => rng.pick(EMOJI)); return { ...base(seed, entry, ids, now), sequence: seq, runs: { [ids.aId]: { len: 1, out: false, lastAt: now }, [ids.bId]: { len: 1, out: false, lastAt: now } } }; },
    act(g, pid, action, payload, now) {
      const r = g.runs[pid]; if (action !== 'recall' || !r || r.out) return g;
      const want = g.sequence.slice(0, r.len), got = Array.isArray(payload?.sequence) ? payload.sequence : [];
      if (got.length === want.length && want.every((e, i) => e === got[i])) { r.len += 1; r.lastAt = now; if (r.len > g.sequence.length) { r.out = true; r.len = g.sequence.length + 1; } }
      else r.out = true;
      const q = g.runs[other(g, pid)];
      if (r.out && q.out) { const res = GAMES.emojimemory.atCap(g); return finish(g, res?.winnerId ?? null, { now, flawless: !!res?.flawless }); }
      return g;
    },
    atCap(g) {
      const a = g.runs[g.aId], b = g.runs[g.bId], la = a.len - 1, lb = b.len - 1;   // len-1 = longest sequence recalled
      if (la === lb) return la === 0 ? null : { winnerId: a.lastAt < b.lastAt ? g.aId : b.lastAt < a.lastAt ? g.bId : null, flawless: false };
      const w = la > lb ? g.aId : g.bId; return { winnerId: w, flawless: g.runs[w].len - 1 >= g.sequence.length };
    },
    phoneView(g, pid) { const r = g.runs[pid]; return { show: r.out ? null : g.sequence.slice(0, r.len), round: r.len, out: r.out, best: r.len - 1, opponentBest: g.runs[other(g, pid)].len - 1, opponentOut: g.runs[other(g, pid)].out }; },
    tvView(g) { return { round: { [g.aId]: g.runs[g.aId].len - 1, [g.bId]: g.runs[g.bId].len - 1 }, out: { [g.aId]: g.runs[g.aId].out, [g.bId]: g.runs[g.bId].out }, length: g.sequence.length }; },
  },
};

// Character errors between what was asked and what was typed: mismatches position by position plus the length difference.
export function countErrors(want, got) {
  const a = String(want), b = String(got).replace(/\s+/g, ' ').trim(); let e = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) e += 1;
  return e;
}

// ---------------------------------------------------------------- the contract
export function create(seed, entry, ids, now, B, extra) {
  const def = GAMES[entry.game]; if (!def) throw new Error(`no hosted duel ${entry.game}`);
  return def.create(seed, entry, ids, now, B, extra);
}
export function act(game, playerId, action, payload = {}, now = 0) {
  if (!game || game.done || !isPlayer(game, playerId)) return game;
  const def = GAMES[game.game]; if (!def) return game;
  const next = def.act(clone(game), playerId, action, payload, now);
  return JSON.stringify(next) === JSON.stringify(game) ? game : next;   // an illegal move hands back the same object
}
export function done(game) { if (!game?.done) return null; return game.winnerId ?? 'draw'; }
export function result(game) { if (!game?.done) return null; return { winnerId: game.winnerId ?? null, draw: !!game.draw, flawless: !!game.flawless }; }
export function atCap(game, now) { if (!game) return null; if (game.done) return result(game); const r = GAMES[game.game]?.atCap(game, now); return r || null; }
// Force a result at the cap: standing scores decide, else a draw with no winner.
export function capped(game, now) { const g = clone(game); if (g.done) return g; const r = atCap(g, now); return finish(g, r?.winnerId ?? null, { now, flawless: !!r?.flawless }); }
export function phoneView(game, playerId, now) {
  if (!game) return null; const def = GAMES[game.game]; if (!def) return null;
  return { game: game.game, you: playerId, opponent: isPlayer(game, playerId) ? other(game, playerId) : null, done: game.done, winnerId: game.winnerId, draw: game.draw, flawless: game.flawless, ...def.phoneView(game, playerId, now) };
}
export function tvView(game, now) {
  if (!game) return null; const def = GAMES[game.game]; if (!def) return null;
  return { game: game.game, aId: game.aId, bId: game.bId, done: game.done, winnerId: game.winnerId, draw: game.draw, flawless: game.flawless, ...def.tvView(game, now) };
}
// Bot moves for tests and autopilot: a legal action for `playerId` at `now`, or null when it has nothing to do.
export function botAction(game, playerId, now, { smart = true } = {}) {
  if (!game || game.done || !isPlayer(game, playerId)) return null;
  switch (game.game) {
    case 'quickdraw': return game.taps[playerId] == null && now >= game.flashAt ? { action: 'tap', payload: {} } : null;
    case 'speedmath': { const p = game.progress[playerId]; if (p.idx >= game.total) return null; const q = game.questions[p.idx]; return { action: 'answer', payload: { answer: smart ? q.answer : q.answer + 1 } }; }
    case 'memorymatch': {
      if (game.turn !== playerId) return null;
      const open = game.cards.filter(c => !c.matched && !game.faceUp.includes(c.i));
      if (game.faceUp.length === 1 && smart) { const s = game.cards[game.faceUp[0]].s; const m = open.find(c => c.s === s); if (m) return { action: 'flip', payload: { index: m.i } }; }
      return open.length ? { action: 'flip', payload: { index: open[0].i } } : null;
    }
    case 'trivia': { const n = game.answers[playerId].length; if (n >= game.total) return null; const q = game.questions[n]; return { action: 'answer', payload: { choice: smart ? q.answer : (q.answer + 1) % q.options.length } }; }
    case 'highestcard': return game.drawn[playerId] ? null : { action: 'draw', payload: {} };
    case 'typingrace': return { action: 'submit', payload: { text: smart ? game.sentence : game.sentence.slice(0, -5) + 'xxxxx' } };
    case 'emojimemory': { const r = game.runs[playerId]; if (r.out) return null; return { action: 'recall', payload: { sequence: smart ? game.sequence.slice(0, r.len) : [] } }; }
    default: return null;
  }
}
export { GAMES };
