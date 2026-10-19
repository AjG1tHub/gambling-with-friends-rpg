// Poker hand ranking used by the table games.
import test from 'node:test';
import assert from 'node:assert/strict';
import './_helpers.mjs';
const P = await import('../../site/js/poker.js');
const h = (s) => s.split(' ').map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const e5 = (s) => P.eval5(h(s)), e3 = (s) => P.eval3(h(s)), e2 = (s) => P.eval2(h(s));

test('five-card categories are recognised', () => {
  const cases = [['A♠ K♠ Q♠ J♠ 10♠', 8, 'Royal flush'], ['9♥ 8♥ 7♥ 6♥ 5♥', 8, 'Straight flush'], ['7♠ 7♥ 7♦ 7♣ 2♠', 7, 'Four of a kind'], ['K♠ K♥ K♦ 4♣ 4♠', 6, 'Full house'],
    ['A♦ J♦ 8♦ 4♦ 2♦', 5, 'Flush'], ['10♠ 9♥ 8♦ 7♣ 6♠', 4, 'Straight'], ['Q♠ Q♥ Q♦ 9♣ 2♠', 3, 'Three of a kind'], ['J♠ J♥ 4♦ 4♣ A♠', 2, 'Two pair'], ['10♠ 10♥ K♦ 4♣ 2♠', 1, 'Pair'], ['A♠ J♥ 8♦ 4♣ 2♠', 0, 'High card']];
  for (const [s, cat, name] of cases) { const e = e5(s); assert.equal(e.cat, cat, s); assert.equal(e.name, name, s); }
});
test('every category beats the one below it', () => {
  const ladder = ['A♠ J♥ 8♦ 4♣ 2♠', '2♠ 2♥ 5♦ 4♣ 3♠', '3♠ 3♥ 2♦ 2♣ 4♠', '2♠ 2♥ 2♦ 4♣ 3♠', 'A♠ 2♥ 3♦ 4♣ 5♠', '7♦ 5♦ 4♦ 3♦ 2♦', '2♠ 2♥ 2♦ 3♣ 3♠', '2♠ 2♥ 2♦ 2♣ 3♠', 'A♥ 2♥ 3♥ 4♥ 5♥'];
  for (let i = 1; i < ladder.length; i++) assert.ok(e5(ladder[i]).score > e5(ladder[i - 1]).score, `${ladder[i]} should beat ${ladder[i - 1]}`);
});
test('the wheel (A-2-3-4-5) is a five-high straight, below six-high', () => {
  assert.equal(e5('A♠ 2♥ 3♦ 4♣ 5♠').cat, 4); assert.equal(e5('A♠ 2♥ 3♦ 4♣ 5♠').high, 5);
  assert.ok(e5('6♠ 2♥ 3♦ 4♣ 5♠').score > e5('A♠ 2♥ 3♦ 4♣ 5♠').score);
  assert.equal(e5('Q♠ K♥ A♦ 2♣ 3♠').cat, 0, 'no wrap-around straights');
});
test('kickers break ties in order', () => {
  assert.ok(e5('K♠ K♥ A♦ 4♣ 2♠').score > e5('K♦ K♣ Q♦ J♣ 10♠').score);
  assert.ok(e5('A♠ A♥ K♦ K♣ 3♠').score > e5('A♦ A♣ Q♦ Q♣ K♠').score);
  assert.ok(e5('A♦ J♦ 8♦ 4♦ 3♦').score > e5('A♥ J♥ 8♥ 4♥ 2♥').score);
  assert.ok(e5('9♠ 9♥ 9♦ 2♣ 2♠').score > e5('8♠ 8♥ 8♦ A♣ A♠').score, 'full houses rank by the trips');
  assert.equal(e5('K♠ K♥ A♦ 4♣ 2♠').score, e5('K♦ K♣ A♠ 4♥ 2♦').score, 'suits never matter');
});
test('best five of seven', () => {
  const b = P.best5(h('A♠ K♠ Q♠ J♠ 10♠ 2♥ 2♦')); assert.equal(b.name, 'Royal flush'); assert.equal(b.cards.length, 5);
  assert.equal(P.best5(h('9♠ 9♥ 9♦ 4♣ 4♠ 4♥ K♦')).name, 'Full house');
  assert.equal(P.best5(h('9♠ 9♥ 9♦ 4♣ 4♠ 4♥ K♦')).high, 9, 'the higher trips make the full house');
  assert.equal(P.best5(h('2♠ 5♥ 9♦ J♣ K♠ 3♥ 7♦')).name, 'High card');
  assert.equal(P.best5(h('5♠ 6♥ 7♦ 8♣ 9♠ 10♥ J♦')).high, 11, 'takes the top end of a long straight');
  assert.equal(P.best5(h('A♠ K♥ Q♦ J♣ 9♠')).name, 'High card', 'five cards go straight through');
});
test('three-card ranking: straight beats flush, trips beat a straight', () => {
  assert.deepEqual(['Q♠ K♠ A♠', '7♠ 7♥ 7♦', '4♠ 5♥ 6♦', '2♠ 9♠ K♠', '5♠ 5♥ A♦', '2♠ 9♥ K♦'].map(s => e3(s).name), ['Straight flush', 'Three of a kind', 'Straight', 'Flush', 'Pair', 'High card']);
  assert.ok(e3('4♠ 5♥ 6♦').score > e3('A♠ J♠ 9♠').score);
  assert.ok(e3('2♠ 2♥ 2♦').score > e3('Q♠ K♥ A♦').score);
  assert.equal(e3('A♠ 2♥ 3♦').cat, 3); assert.ok(e3('2♠ 3♥ 4♦').score > e3('A♠ 2♥ 3♦').score, 'A-2-3 is the lowest straight');
  assert.equal(e3('K♠ A♥ 2♦').cat, 0);
});
test('two-card hands: any pair beats any two unpaired cards', () => {
  assert.ok(e2('2♠ 2♥').score > e2('A♠ K♥').score); assert.ok(e2('A♠ K♥').score > e2('A♦ Q♥').score); assert.ok(e2('K♠ 2♥').score > e2('Q♦ J♥').score);
  assert.equal(e2('A♠ K♥').score, e2('K♦ A♣').score);
});
test('a fresh deck has 52 different cards per deck', () => {
  const { R } = { R: null }; const ident = (rng, a) => a;
  const d = P.freshDeck(ident, null, 1); assert.equal(d.length, 52); assert.equal(new Set(d.map(c => c.r + c.s)).size, 52);
  assert.equal(P.freshDeck(ident, null, 6).length, 312);
});
test('hands read naturally in words', () => {
  const d5 = (s) => P.describe(e5(s)), d3 = (s) => P.describe(e3(s)), d2 = (s) => P.describe(e2(s));
  assert.deepEqual([d5('A♠ J♥ 8♦ 4♣ 2♠'), d5('10♠ 10♥ K♦ 4♣ 2♠'), d5('J♠ J♥ 4♦ 4♣ A♠'), d5('Q♠ Q♥ Q♦ 9♣ 2♠'), d5('10♠ 9♥ 8♦ 7♣ 6♠'), d5('A♦ J♦ 8♦ 4♦ 2♦'), d5('K♠ K♥ K♦ 4♣ 4♠'), d5('7♠ 7♥ 7♦ 7♣ 2♠'), d5('9♥ 8♥ 7♥ 6♥ 5♥'), d5('A♠ K♠ Q♠ J♠ 10♠')],
    ['Ace-high', 'Pair of Tens', 'Jacks and Fours', 'Three Queens', '10-high straight', 'Ace-high flush', 'Kings full of Fours', 'Four Sevens', '9-high straight flush', 'Royal flush']);
  assert.equal(d3('2♠ 9♥ K♦'), 'King-high'); assert.equal(d3('5♠ 5♥ A♦'), 'Pair of Fives'); assert.equal(d3('A♠ 2♥ 3♦'), '3-high straight');
  assert.equal(d2('A♠ K♥'), 'Ace-high'); assert.equal(d2('6♠ 6♥'), 'Pair of Sixes');
});
