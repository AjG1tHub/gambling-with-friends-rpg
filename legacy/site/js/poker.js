// Poker hand ranking (pure). Cards are { r: 'A'|'2'…'K', s: '♠♥♦♣' }. Used by the table games in games-table.js.
// Every evaluator returns { cat, name, score } where a higher score always beats a lower one within the same game.
export const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const rv = (c) => RANK_ORDER.indexOf(c.r) + 2;              // 2..14, ace high
const pack = (cat, ks) => ks.reduce((s, k) => s * 15 + k, cat);     // category first, then kickers in order (always 5 kickers for 5-card hands)
const pad = (ks, n) => { const a = ks.slice(0, n); while (a.length < n) a.push(0); return a; };

export const CAT5 = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
// Highest card of a straight in `vals` (distinct, descending), or 0. The wheel A-2-3-4-5 counts as 5-high.
function straightHigh(vals, len) {
  if (vals.length !== len) return 0;
  if (vals[0] - vals[len - 1] === len - 1) return vals[0];
  if (vals[0] === 14 && vals[1] === len && vals[len - 1] === 2) return len;          // ace plays low
  return 0;
}
function groups(cards) {
  const count = new Map(); for (const c of cards) count.set(rv(c), (count.get(rv(c)) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);            // [value, count], biggest group first then highest rank
}

export function eval5(cards) {
  const g = groups(cards), vals = g.map(x => x[0]), counts = g.map(x => x[1]);
  const flush = cards.every(c => c.s === cards[0].s);
  const sh = straightHigh([...new Set(cards.map(rv))].sort((a, b) => b - a), 5);
  let cat, ks;
  if (flush && sh) { cat = 8; ks = [sh]; }
  else if (counts[0] === 4) { cat = 7; ks = vals; }
  else if (counts[0] === 3 && counts[1] === 2) { cat = 6; ks = vals; }
  else if (flush) { cat = 5; ks = cards.map(rv).sort((a, b) => b - a); }
  else if (sh) { cat = 4; ks = [sh]; }
  else if (counts[0] === 3) { cat = 3; ks = vals; }
  else if (counts[0] === 2 && counts[1] === 2) { cat = 2; ks = vals; }
  else if (counts[0] === 2) { cat = 1; ks = vals; }
  else { cat = 0; ks = vals; }
  const royal = cat === 8 && sh === 14;
  return { cat, royal, name: royal ? 'Royal flush' : CAT5[cat], score: pack(cat, pad(ks, 5)), high: ks[0], kickers: ks };
}

// Best five of any 5–7 cards.
export function best5(cards) {
  if (cards.length === 5) return { ...eval5(cards), cards: cards.slice() };
  let best = null; const n = cards.length;
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++) for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
    const hand = [cards[a], cards[b], cards[c], cards[d], cards[e]], ev = eval5(hand);
    if (!best || ev.score > best.score) best = { ...ev, cards: hand };
  }
  return best;
}

// Three Card Poker ranks differently: a straight beats a flush, trips beat a straight.
export const CAT3 = ['High card', 'Pair', 'Flush', 'Straight', 'Three of a kind', 'Straight flush'];
export function eval3(cards) {
  const g = groups(cards), vals = g.map(x => x[0]), counts = g.map(x => x[1]);
  const flush = cards.every(c => c.s === cards[0].s);
  const sh = straightHigh([...new Set(cards.map(rv))].sort((a, b) => b - a), 3);
  let cat, ks;
  if (flush && sh) { cat = 5; ks = [sh]; }
  else if (counts[0] === 3) { cat = 4; ks = vals; }
  else if (sh) { cat = 3; ks = [sh]; }
  else if (flush) { cat = 2; ks = vals; }
  else if (counts[0] === 2) { cat = 1; ks = vals; }
  else { cat = 0; ks = vals; }
  return { cat, name: CAT3[cat], score: pack(cat, pad(ks, 3)), high: ks[0], kickers: ks };
}

// Two-card hand (Pai Gow low hand): a pair beats any two unpaired cards.
export function eval2(cards) {
  const a = rv(cards[0]), b = rv(cards[1]);
  return a === b ? { cat: 1, name: 'Pair', score: pack(1, [a, 0]), high: a, kickers: [a] } : { cat: 0, name: 'High card', score: pack(0, [Math.max(a, b), Math.min(a, b)]), high: Math.max(a, b), kickers: [Math.max(a, b), Math.min(a, b)] };
}

export const cmp = (x, y) => Math.sign(x.score - y.score);
const CARD_WORD = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack' };
export const cardWord = (v) => CARD_WORD[v] || String(v);
// A hand in words: "Pair of Kings", "Queen-high", "Jacks full of Fours".
export function describe(e) {
  const k = e.kickers || [], hi = cardWord(e.high);
  switch (e.name) {
    case 'High card': return `${hi}-high`;
    case 'Pair': return `Pair of ${rankWord(e.high)}`;
    case 'Two pair': return `${rankWord(k[0])} and ${rankWord(k[1])}`;
    case 'Three of a kind': return `Three ${rankWord(e.high)}`;
    case 'Straight': return `${hi}-high straight`;
    case 'Flush': return `${hi}-high flush`;
    case 'Full house': return `${rankWord(k[0])} full of ${rankWord(k[1])}`;
    case 'Four of a kind': return `Four ${rankWord(e.high)}`;
    case 'Straight flush': return `${hi}-high straight flush`;
    default: return e.name;
  }
}
export const rankWord = (v) => ({ 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens', 9: 'Nines', 8: 'Eights', 7: 'Sevens', 6: 'Sixes', 5: 'Fives', 4: 'Fours', 3: 'Threes', 2: 'Twos' }[v] || String(v));

// Fresh shuffled deck(s). Each card gets no timing — the games stamp `t` as they deal.
export function freshDeck(shuffleFn, rng, decks = 1) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const s of ['♠', '♥', '♦', '♣']) for (const r of RANK_ORDER) cards.push({ r, s });
  return shuffleFn(rng, cards);
}
