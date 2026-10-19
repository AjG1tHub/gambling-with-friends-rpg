import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, mkGame, fixedRng, card } from './_helpers.mjs';
const SND = await import('../../site/js/sound.js');

const act = (c, action, payload, rng = c.rng) => G.gameAction(c.config, c.state, rng, action, payload);
const start = (c, id, rng = c.rng) => G.startGame(c.config, c.state, rng, id, c.p, [{ amount: 100, cur: 'Gold' }]);
// rng.int(0,12) → rank index, rng.int(0,3) → suit. Script a card by rank index.
const draw = (...rankIdx) => fixedRng(rankIdx.flatMap(i => [(i + 0.5) / 13, 0]));
const setTop = (c, r) => { c.state.game.view.cards = [{ ...card(r), t: 0 }]; };

test('Hi-Lo step multipliers are fair odds less the edge, and impossible calls pay nothing', () => {
  const odds = { houseEdge: 0.03 };
  assert.equal(G.hiloStepMult(odds, '7', 'higher'), 0.97 * 12 / 6); assert.equal(G.hiloStepMult(odds, '7', 'lower'), 0.97 * 12 / 6);
  assert.ok(Math.abs(G.hiloStepMult(odds, 'A', 'higher') - 0.97) < 1e-9);                   // a sure thing pays under 1×
  assert.equal(G.hiloStepMult(odds, 'K', 'higher'), 0); assert.equal(G.hiloStepMult(odds, 'A', 'lower'), 0);
  assert.ok(Math.abs(G.hiloStepMult(odds, 'Q', 'higher') - 11.64) < 1e-9);
});

test('Hi-Lo: every call has the same expected value (1 − edge), whatever the card', () => {
  for (const [r, v] of Object.entries(G.RANK_VALUE)) for (const dir of ['higher', 'lower']) {
    const ways = dir === 'higher' ? 13 - v : v - 1; if (!ways) continue;
    assert.ok(Math.abs(G.hiloStepMult({ houseEdge: 0.03 }, r, dir) * ways / 12 - 0.97) < 1e-9, `${r} ${dir}`);
  }
});

test('Hi-Lo starts with one card at 1× and cashing out untouched is a push', () => {
  const c = mkGame(); start(c, 'hilo'); const g = c.state.game;
  assert.equal(g.view.cards.length, 1); assert.equal(g.view.mult, 1); assert.equal(g.phase, 'running');
  const r = act(c, 'cashout'); assert.deepEqual([r.done, r.mult], [true, 1]); assert.match(g.result.label, /push/);
});

test('Hi-Lo: a correct call multiplies the pot; cash out banks it', () => {
  const c = mkGame(); start(c, 'hilo'); setTop(c, '7');
  const r = act(c, 'higher', {}, draw(9));                                      // 10 > 7
  assert.equal(r.done, undefined); assert.equal(c.state.game.view.mult, 1.94); assert.equal(c.state.game.view.steps, 1);
  act(c, 'lower', {}, draw(1));                                                // 2 < 10 → × 0.97×12/9
  assert.equal(c.state.game.view.mult, 2.5);                                   // floor(1.94 × 1.2933 × 100)/100
  const out = act(c, 'cashout'); assert.equal(out.mult, 2.5); assert.match(c.state.game.result.label, /2 calls/);
});

test('Hi-Lo: a wrong call loses everything', () => {
  const c = mkGame(); start(c, 'hilo'); setTop(c, '7');
  const r = act(c, 'higher', {}, draw(2));                                      // 3 is not higher
  assert.deepEqual([r.done, r.mult], [true, 0]); assert.equal(c.state.game.view.bust, true);
  assert.match(act(c, 'higher').text, /Nothing to do/);
});

test('Hi-Lo: an equal card is a free redraw — no win, no loss', () => {
  const c = mkGame(); start(c, 'hilo'); setTop(c, '7');
  const r = act(c, 'higher', {}, draw(6));                                      // another 7
  assert.match(r.text, /free redraw/); assert.equal(c.state.game.view.mult, 1); assert.equal(c.state.game.view.steps, 0); assert.equal(c.state.game.phase, 'running');
});

test('Hi-Lo refuses HIGHER on a King and LOWER on an Ace without drawing', () => {
  const c = mkGame(); start(c, 'hilo'); setTop(c, 'K');
  assert.equal(act(c, 'higher').error, true); assert.equal(c.state.game.view.cards.length, 1);
  setTop(c, 'A'); assert.equal(act(c, 'lower').error, true);
});

test('Hi-Lo stops at the table limit', () => {
  const c = mkGame(); c.state.oddsOverrides = { hilo: { maxMult: 5 } }; start(c, 'hilo'); setTop(c, 'Q');
  const r = act(c, 'higher', {}, draw(12));                                     // King: ×11.64 → capped at 5
  assert.deepEqual([r.done, r.mult], [true, 5]);
});

test('Hi-Lo keeps only the last eight cards on screen', () => {
  const c = mkGame(); start(c, 'hilo'); setTop(c, '7');
  for (let i = 0; i < 12; i++) act(c, 'higher', {}, draw(6));                   // twelve redraws
  assert.equal(c.state.game.view.cards.length, 8);
});

test('Hi-Lo cards click as they land', () => {
  const c = mkGame(); const prev = structuredClone(c.state); start(c, 'hilo');
  assert.equal(SND.cuesFor(prev, c.state).filter(x => x.cue === 'card').length, 1);
});

test('Dice win chance: UNDER t wins on 1..t−1, OVER t wins on t+1..100', () => {
  assert.equal(G.diceChance('under', 50), 49); assert.equal(G.diceChance('over', 50), 50);
  assert.equal(G.diceChance('under', 2), 1); assert.equal(G.diceChance('over', 99), 1); assert.equal(G.diceChance('over', 100), 0);
});

test('Dice payout = (1 − edge) × 100 / chance, floored to cents', () => {
  const odds = { houseEdge: 0.03 };
  assert.equal(G.diceMult(odds, 'over', 50), 1.94); assert.equal(G.diceMult(odds, 'under', 11), 9.7);
  assert.equal(G.diceMult(odds, 'over', 98), 48.5); assert.equal(G.diceMult(odds, 'over', 100), 0);
  for (const t of [5, 20, 50, 77, 95]) assert.ok(G.diceMult(odds, 'under', t) * G.diceChance('under', t) / 100 <= 0.9701, `target ${t}`);
});

test('Dice rejects bets outside the table limits and malformed targets', () => {
  const odds = { minChance: 2, maxChance: 95 };
  assert.equal(G.diceBetError(odds, 'under', 50), null); assert.equal(G.diceBetError(odds, 'over', 5), null);
  assert.match(G.diceBetError(odds, 'under', 2), /minimum/); assert.match(G.diceBetError(odds, 'over', 2), /maximum/);
  assert.match(G.diceBetError(odds, 'sideways', 50), /UNDER or OVER/);
  for (const bad of [0, 101, 50.5, 'x', null]) assert.match(G.diceBetError(odds, 'under', bad), /whole number/, String(bad));
});

test('Dice: bet, roll, and the boundaries of winning', () => {
  const roll = (dir, target, n) => { const c = mkGame(); start(c, 'dice'); act(c, 'bet', { dir, target }); act(c, 'spin', {}, fixedRng([(n - 0.5) / 100])); return c.state.game; };
  assert.equal(roll('under', 50, 49).pending.mult, 1.97); assert.equal(roll('under', 50, 50).pending.mult, 0);
  assert.equal(roll('over', 50, 51).pending.mult, 1.94); assert.equal(roll('over', 50, 50).pending.mult, 0);
  const g = roll('over', 90, 100); assert.equal(g.view.roll, 100); assert.equal(g.pending.mult, 9.7); assert.ok(g.view.revealAt > g.view.rollAt);
});

test('Dice needs a valid bet before it rolls, and the bet locks once rolled', () => {
  const c = mkGame(); start(c, 'dice');
  assert.match(act(c, 'spin').text, /Nothing to do/);
  assert.equal(act(c, 'bet', { dir: 'under', target: 1 }).error, true); assert.equal(c.state.game.view.bet, null);
  act(c, 'bet', { dir: 'under', target: 30 }); act(c, 'bet', { dir: 'over', target: 60 });      // may change before rolling
  assert.equal(c.state.game.view.bet.dir, 'over');
  act(c, 'spin'); assert.match(act(c, 'bet', { dir: 'under', target: 30 }).text, /Nothing to do/);
});

test('Dice rolls are uniform 1–100 and the game returns about 97%', () => {
  const c = mkGame(); let ret = 0; const seen = new Set(); const N = 40000;
  for (let i = 0; i < N; i++) { start(c, 'dice'); act(c, 'bet', { dir: 'under', target: 34 }); act(c, 'spin'); ret += c.state.game.pending.mult; seen.add(c.state.game.view.roll); c.state.ledger.length = 0; }
  assert.equal(seen.size, 100); assert.ok(Math.abs(ret / N - 0.97) < 0.03, `RTP ${ret / N}`);
});

test('the new games are built, have odds, and can land on the board', () => {
  const c = mkGame();
  for (const id of ['hilo', 'dice']) { const def = G.gameDef(c.config, id); assert.equal(def.built, true); assert.ok(Object.keys(G.effectiveOdds(c.config, c.state, id)).length >= 2); }
  c.config.Games.find(g => g.id === 'dice').odds = {};                              // Sheet row with Odds = {}
  assert.equal(G.effectiveOdds(c.config, c.state, 'dice').maxChance, 95);
});
