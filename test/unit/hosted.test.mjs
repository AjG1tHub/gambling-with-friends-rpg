// The seven purpose-built hosted duels: deterministic from the seed, hidden info stays off the other phone, every
// game reaches a result through the bot moves, flawless wins are flagged, the cap rule returns standing scores.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as hosted from '../../packages/shared/challenge/hosted.js';
import presets from '../../data/challenges.json' with { type: 'json' };
import trivia from '../../data/trivia.json' with { type: 'json' };

const ids = { aId: 'a', bId: 'b' };
const entry = (game) => ({ id: game, name: game, hosted: true, game, players: '1v1' });
const T0 = 1_000_000;

function playOut(game, { smartA = true, smartB = true, tick = 500 } = {}) {
  let g = game, now = g.startedAt, guard = 0;
  while (!g.done && guard++ < 300) {
    if (g.game === 'quickdraw' && now < g.flashAt) now = g.flashAt + 1;
    let moved = false;
    for (const [pid, smart] of [['a', smartA], ['b', smartB]]) {
      const act = hosted.botAction(g, pid, now, { smart }); if (!act) continue;
      g = hosted.act(g, pid, act.action, act.payload, now); now += tick; moved = true;
      if (g.done) break;
    }
    if (!moved) break;
  }
  return { g, now };
}

test('data: the three presets match the spec table and every hosted game is known; the trivia bank has 30+ questions', () => {
  const p = presets.presets;
  assert.deepEqual(Object.keys(p), ['inperson', 'discord', 'quick']);
  const hostedIds = (k) => p[k].entries.filter(e => e.hosted).map(e => e.game);
  assert.deepEqual(hostedIds('inperson'), ['clash', 'diceduel', 'shellgame', 'holdemduel', 'quickdraw', 'speedmath', 'memorymatch', 'trivia', 'highestcard']);
  assert.deepEqual(hostedIds('discord'), [...hostedIds('inperson'), 'typingrace', 'emojimemory']);
  assert.deepEqual(hostedIds('quick'), ['quickdraw', 'highestcard', 'clash', 'diceduel']);
  assert.equal(p.inperson.entries.filter(e => !e.hosted).length, 8); assert.equal(p.discord.entries.filter(e => !e.hosted).length, 7); assert.equal(p.quick.entries.filter(e => !e.hosted).length, 1);
  for (const k of Object.keys(p)) for (const e of p[k].entries) {
    assert.ok(e.id && e.name && typeof e.hosted === 'boolean' && typeof e.rules === 'string' && e.capSeconds === null && ['1v1', 'team'].includes(e.players) && e.weight > 0 && e.enabled === true, `${k}/${e.id}`);
    if (e.hosted) assert.ok(hosted.isPurposeBuilt(e.game) || ['clash', 'diceduel', 'shellgame', 'holdemduel'].includes(e.game), e.game);
    else assert.equal(e.game, null);
  }
  assert.ok(p.discord.entries.find(e => e.id === 'chess3').link.includes('lichess'));
  assert.ok(trivia.questions.length >= 30);
  for (const q of trivia.questions) assert.ok(q.options.length === 4 && q.options[q.answer] !== undefined, q.id);
});

test('determinism: the same seed builds the same game; different seeds differ', () => {
  for (const game of hosted.PURPOSE_BUILT) {
    const a = hosted.create(7, entry(game), ids, T0), b = hosted.create(7, entry(game), ids, T0);
    assert.equal(JSON.stringify(a), JSON.stringify(b), game);
  }
  assert.notEqual(hosted.create(1, entry('speedmath'), ids, T0).questions[0].text + hosted.create(1, entry('speedmath'), ids, T0).questions[1].text, hosted.create(2, entry('speedmath'), ids, T0).questions[0].text + hosted.create(2, entry('speedmath'), ids, T0).questions[1].text);
});

test('every purpose-built duel: two bots reach a result; a perfect bot against a sloppy one wins', () => {
  for (const game of hosted.PURPOSE_BUILT) {
    const { g } = playOut(hosted.create(11, entry(game), ids, T0));
    assert.ok(g.done, `${game} finished`); assert.notEqual(hosted.done(g), null);
    const r = hosted.result(g); assert.ok(r && ('winnerId' in r) && typeof r.flawless === 'boolean');
    if (game !== 'quickdraw' && game !== 'highestcard' && game !== 'memorymatch') {
      const { g: g2 } = playOut(hosted.create(11, entry(game), ids, T0), { smartB: false });
      assert.equal(hosted.done(g2), 'a', `${game}: the perfect bot wins`);
      assert.equal(hosted.result(g2).flawless, true, `${game}: a perfect game is flawless`);
    }
  }
});

test('quickdraw: a tap before the flash is a false start; a fast tap after it is flawless; views hide the delay', () => {
  const g = hosted.create(3, entry('quickdraw'), ids, T0, { quickdrawMinDelayMs: 1000, quickdrawMaxDelayMs: 1000, quickdrawFlawlessMs: 300 });
  assert.equal(g.flashAt, T0 + 1000);
  assert.equal(hosted.phoneView(g, 'a', T0).flashAt, undefined, 'the phone never learns when the flash comes');
  assert.equal(hosted.tvView(g, T0).flash, false); assert.equal(hosted.tvView(g, T0 + 1000).flash, true);
  const early = hosted.act(g, 'a', 'tap', {}, T0 + 500); assert.equal(hosted.done(early), 'b'); assert.equal(hosted.phoneView(early, 'a').falseStart, true);
  const fast = hosted.act(g, 'b', 'tap', {}, T0 + 1200); assert.equal(hosted.done(fast), 'b'); assert.equal(hosted.result(fast).flawless, true);
  const slow = hosted.act(g, 'b', 'tap', {}, T0 + 1900); assert.equal(hosted.result(slow).flawless, false);
  assert.equal(hosted.act(fast, 'a', 'tap', {}, T0 + 1200), fast, 'a finished game ignores actions');
  assert.equal(hosted.atCap(g), null, 'no standing result before anyone taps');
});

test('speedmath: first to all correct wins at once; at the cap the higher count wins, then the earlier finish', () => {
  let g = hosted.create(5, entry('speedmath'), ids, T0);
  assert.equal(g.total, 5);
  for (const q of g.questions) assert.equal(eval(q.text.replace('×', '*')), q.answer);
  // a answers 3 right, b answers 3 right faster → b at the cap only if both finished; with equal counts and unfinished → draw
  for (let i = 0; i < 3; i++) { g = hosted.act(g, 'a', 'answer', { answer: g.questions[i].answer }, T0 + i); g = hosted.act(g, 'b', 'answer', { answer: g.questions[i].answer }, T0 + i); }
  assert.deepEqual(hosted.atCap(g), { winnerId: null, flawless: false });
  g = hosted.act(g, 'a', 'answer', { answer: -1 }, T0 + 10);
  assert.equal(hosted.atCap(g).winnerId, null, 'still 3–3');
  g = hosted.act(g, 'b', 'answer', { answer: g.questions[3].answer }, T0 + 11); assert.equal(hosted.atCap(g).winnerId, 'b');
  const v = hosted.phoneView(g, 'a'); assert.equal(v.opponentCorrect, 4); assert.equal(v.question, g.questions[4].text);
  g = hosted.act(g, 'b', 'answer', { answer: g.questions[4].answer }, T0 + 12); assert.equal(hosted.done(g), 'b'); assert.equal(g.flawless, true);
  const capped = hosted.capped(hosted.create(5, entry('speedmath'), ids, T0), T0); assert.equal(capped.done, true); assert.equal(capped.winnerId, null);
});

test('memorymatch: a match keeps the turn, a miss passes it; phones only see face-up and matched cards', () => {
  let g = hosted.create(9, entry('memorymatch'), ids, T0);
  assert.equal(g.cards.length, 12); assert.equal(g.turn, 'a');
  assert.ok(hosted.phoneView(g, 'a').cards.every(c => c === null), 'all face down');
  assert.equal(hosted.act(g, 'b', 'flip', { index: 0 }, T0), g, 'not b\'s turn');
  const first = g.cards[0], mate = g.cards.find(c => c.i !== 0 && c.s === first.s), miss = g.cards.find(c => c.s !== first.s);
  g = hosted.act(g, 'a', 'flip', { index: 0 }, T0); g = hosted.act(g, 'a', 'flip', { index: miss.i }, T0);
  assert.equal(g.turn, 'b'); assert.equal(hosted.phoneView(g, 'b').cards.filter(Boolean).length, 2, 'the two face-up cards show until the next flip');
  g = hosted.act(g, 'b', 'flip', { index: 0 }, T0); g = hosted.act(g, 'b', 'flip', { index: mate.i }, T0);
  assert.equal(g.turn, 'b'); assert.equal(g.score.b, 1); assert.equal(hosted.atCap(g).winnerId, 'b');
  const { g: end } = playOut(g); assert.ok(end.done); assert.equal(end.score.a + end.score.b <= 6, true);
});

test('trivia: questions come from the bank (or the GM\'s), most correct wins, speed breaks ties, 5/5 is flawless', () => {
  let g = hosted.create(2, entry('trivia'), ids, T0);
  assert.equal(g.total, 5); for (const q of g.questions) assert.ok(trivia.questions.find(t => t.id === q.id));
  const gm = hosted.create(2, entry('trivia'), ids, T0, null, [{ id: 'x1', q: 'Q?', options: ['a', 'b'], answer: 1 }, { id: 'x2', q: 'R?', options: ['a', 'b'], answer: 0 }]);
  assert.equal(gm.total, 2); assert.deepEqual(gm.questions.map(q => q.id).sort(), ['x1', 'x2']);
  assert.equal(hosted.phoneView(g, 'a').question.options.length, 4); assert.equal(hosted.phoneView(g, 'a').question.answer, undefined, 'the answer never reaches the phone');
  // both answer everything right; a is faster overall
  for (let i = 0; i < 5; i++) { g = hosted.act(g, 'a', 'answer', { choice: g.questions[i].answer }, T0 + 1000 * (i + 1)); g = hosted.act(g, 'b', 'answer', { choice: g.questions[i].answer }, T0 + 1500 * (i + 1)); }
  assert.equal(hosted.done(g), 'a'); assert.equal(g.flawless, true);
  assert.deepEqual(hosted.tvView(g).scores, { a: 5, b: 5 });
});

test('highestcard: the seed fixes both cards, ties are redrawn at creation, an Ace wins flawlessly', () => {
  for (let seed = 0; seed < 40; seed++) { const g = hosted.create(seed, entry('highestcard'), ids, T0); assert.notEqual(g.cards.a.rank, g.cards.b.rank, 'no tie survives creation'); }
  let g = hosted.create(4, entry('highestcard'), ids, T0);
  g = hosted.act(g, 'a', 'draw', {}, T0);
  assert.equal(hosted.phoneView(g, 'a').opponentCard, null, 'the other card stays hidden until both draw'); assert.equal(hosted.phoneView(g, 'b').card, null);
  g = hosted.act(g, 'b', 'draw', {}, T0);
  const w = hosted.done(g); assert.ok(w === 'a' || w === 'b'); assert.equal(g.cards[w].rank > g.cards[w === 'a' ? 'b' : 'a'].rank, true);
  assert.equal(g.flawless, g.cards[w].label.startsWith('A'));
});

test('typingrace: first to finish within two errors wins, a bad attempt may be retried, zero errors is flawless', () => {
  let g = hosted.create(6, entry('typingrace'), ids, T0);
  assert.equal(hosted.countErrors('abc', 'abc'), 0); assert.equal(hosted.countErrors('abcd', 'abxd'), 1); assert.equal(hosted.countErrors('abcd', 'ab'), 2); assert.equal(hosted.countErrors('abcd', 'xbcde'), 2);
  g = hosted.act(g, 'a', 'submit', { text: 'nothing like it' }, T0 + 1); assert.equal(g.done, false); assert.equal(g.attempts.a.length, 1);
  const two = g.sentence.slice(0, -2) + '??';
  g = hosted.act(g, 'b', 'submit', { text: two }, T0 + 2); assert.equal(hosted.done(g), 'b'); assert.equal(g.flawless, false);
  const g2 = hosted.act(hosted.create(6, entry('typingrace'), ids, T0), 'a', 'submit', { text: hosted.create(6, entry('typingrace'), ids, T0).sentence }, T0); assert.equal(g2.flawless, true);
});

test('emojimemory: a correct recall lengthens the run, a miss ends it, the longest run wins, the full sequence is flawless', () => {
  let g = hosted.create(8, entry('emojimemory'), ids, T0);
  assert.equal(g.sequence.length, 10); assert.deepEqual(hosted.phoneView(g, 'a').show, g.sequence.slice(0, 1));
  g = hosted.act(g, 'a', 'recall', { sequence: g.sequence.slice(0, 1) }, T0 + 1); assert.equal(g.runs.a.len, 2);
  g = hosted.act(g, 'a', 'recall', { sequence: ['🐦', '🐦'] }, T0 + 2); assert.equal(g.runs.a.out, true); assert.equal(hosted.phoneView(g, 'a').best, 1);
  g = hosted.act(g, 'b', 'recall', { sequence: g.sequence.slice(0, 1) }, T0 + 3); g = hosted.act(g, 'b', 'recall', { sequence: g.sequence.slice(0, 2) }, T0 + 4);
  assert.equal(hosted.atCap(g).winnerId, 'b');
  g = hosted.act(g, 'b', 'recall', { sequence: [] }, T0 + 5); assert.equal(hosted.done(g), 'b'); assert.equal(g.flawless, false);
  const { g: perfect } = playOut(hosted.create(8, entry('emojimemory'), ids, T0), { smartB: false }); assert.equal(perfect.flawless, true);
});

test('contract: unknown players, finished games and unknown games are ignored; views carry the common fields', () => {
  const g = hosted.create(1, entry('highestcard'), ids, T0);
  assert.equal(hosted.act(g, 'zz', 'draw', {}, T0), g);
  assert.equal(hosted.phoneView(null, 'a'), null); assert.equal(hosted.tvView(null), null); assert.equal(hosted.done(null), null);
  assert.throws(() => hosted.create(1, entry('nope'), ids, T0), /no hosted duel/);
  const pv = hosted.phoneView(g, 'a'); assert.equal(pv.game, 'highestcard'); assert.equal(pv.opponent, 'b'); assert.equal(pv.done, false);
  const tv = hosted.tvView(g); assert.equal(tv.aId, 'a'); assert.equal(tv.bId, 'b');
});
