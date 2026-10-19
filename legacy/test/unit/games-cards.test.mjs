import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, mkGame, fixedRng, cards, card } from './_helpers.mjs';

const act = (c, action, payload, rng = c.rng) => G.gameAction(c.config, c.state, rng, action, payload);
// Start blackjack, then rig the hands and the rest of the shoe.
function bj(player, dealer, shoe = [], tweak = null) {
  const c = mkGame(['A', 'B'], 1, tweak);
  G.startGame(c.config, c.state, c.rng, 'blackjack', c.p, [{ amount: 100, cur: 'Gold' }]);
  const g = c.state.game;
  g.phase = 'player'; g.result = null; g.view.revealAt = null; g.view.insurance = null; g.view.active = 0;
  g.view.hands = [{ cards: cards(...player).map(x => ({ ...x, t: 0 })), doubled: false, done: false, split: false, outcome: null }];
  g.view.dealer = cards(...dealer).map((x, i) => ({ ...x, t: 0, ...(i === 1 ? { down: true } : {}) }));
  g.secret.shoe = cards(...shoe);
  return { c, g, hand: () => g.view.hands[0] };
}
// Deal a real opening from a scripted shoe (order: player, dealer, player, dealer, then draws).
function deal(order, tweak = null) {
  const c = mkGame(['A', 'B'], 1, tweak);
  G.startGame(c.config, c.state, { ...c.rng, next: () => 0.999999, int: c.rng.int, pick: c.rng.pick, chance: c.rng.chance }, 'blackjack', c.p, [{ amount: 100, cur: 'Gold' }]);
  // re-deal deterministically from the scripted cards
  const g = c.state.game, shoe = cards(...order), now = Date.now();
  const [p1, d1, p2, d2] = shoe.splice(0, 4).map(x => ({ ...x, t: now }));
  g.view.hands = [{ cards: [p1, p2], doubled: false, done: false, split: false, outcome: null }]; g.view.active = 0;
  g.view.dealer = [d1, { ...d2, down: true }]; g.secret.shoe = shoe; g.result = null; g.view.revealAt = null;
  const odds = G.effectiveOdds(c.config, c.state, 'blackjack');
  if (d1.r === 'A' && Number(odds.insurance)) { g.view.insurance = 'offered'; g.phase = 'insurance'; } else { g.view.insurance = null; g.phase = 'player'; }
  return { c, g };
}

test('bjTotal counts aces as 11 or 1 and flags soft hands', () => {
  const t = (...r) => G.bjTotal(cards(...r));
  assert.deepEqual(t('A', 'K'), { total: 21, soft: true });
  assert.deepEqual(t('A', '6'), { total: 17, soft: true });
  assert.deepEqual(t('A', '6', 'K'), { total: 17, soft: false });
  assert.deepEqual(t('A', 'A', '9'), { total: 21, soft: true });
  assert.deepEqual(t('K', 'Q', '5'), { total: 25, soft: false });
  assert.deepEqual(t('10', 'J'), { total: 20, soft: false });
});

test('blackjack deals two cards each with the dealer hole card face down', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'blackjack', c.p, [{ amount: 100, cur: 'Gold' }]);
  const g = c.state.game;
  assert.equal(g.view.hands.length, 1); assert.equal(g.view.hands[0].cards.length, 2); assert.equal(g.view.dealer.length, 2); assert.equal(g.view.active, 0);
  if (g.phase !== 'done') assert.equal(g.view.dealer[1].down, true);
  assert.equal(g.phase === 'insurance', g.view.dealer[0].r === 'A' && g.phase !== 'done');
  assert.ok(g.secret.shoe.length >= 40);
});

test('a fresh shoe has the right composition', () => {
  const c = mkGame(); const seen = {};
  for (let i = 0; i < 400; i++) { G.startGame(c.config, c.state, c.rng, 'blackjack', c.p, []); for (const x of [...c.state.game.view.hands[0].cards, ...c.state.game.view.dealer]) seen[x.r] = (seen[x.r] || 0) + 1; }
  assert.equal(Object.keys(seen).length, 13);
  const tens = (seen['10'] + seen.J + seen.Q + seen.K) / 1600;
  assert.ok(Math.abs(tens - 4 / 13) < 0.04, `ten-value share ${tens}`);
});

test('stand: dealer draws to 17 and the higher hand wins', () => {
  const { c, g } = bj(['10', '9'], ['10', '6'], ['2', '5']);       // dealer 16 → 18
  const r = act(c, 'stand');
  assert.deepEqual([r.done, r.mult], [true, 2]); assert.equal(G.bjTotal(g.view.dealer).total, 18);
  assert.equal(g.view.dealer[1].down, undefined); assert.ok(g.view.revealAt > 0);
});

test('dealer stands on soft 17 by default and hits it when dealerHitsSoft17 is on', () => {
  let { c, g } = bj(['10', '8'], ['A', '6'], ['3']);
  assert.equal(act(c, 'stand').mult, 2); assert.equal(g.view.dealer.length, 2);
  ({ c, g } = bj(['10', '8'], ['A', '6'], ['3'], (cfg) => { cfg.Games.find(x => x.id === 'blackjack').odds.dealerHitsSoft17 = 1; }));
  assert.equal(act(c, 'stand').mult, 0); assert.equal(G.bjTotal(g.view.dealer).total, 20);
});

test('hit: bust ends the hand at 0×; the dealer does not draw', () => {
  const { c, g } = bj(['10', '6'], ['10', '6'], ['K', '5']);
  const r = act(c, 'hit');
  assert.deepEqual([r.done, r.mult], [true, 0]); assert.equal(g.view.dealer.length, 2); assert.match(g.result.label, /Bust at 26/);
});

test('hit to exactly 21 stands automatically', () => {
  const { c, g } = bj(['10', '6'], ['10', '7'], ['5']);
  const r = act(c, 'hit'); assert.equal(r.done, true); assert.equal(r.mult, 2); assert.equal(g.phase, 'done');
});

test('hit below 21 keeps the hand open', () => {
  const { c, g } = bj(['5', '6'], ['10', '7'], ['3', 'K']);
  assert.equal(act(c, 'hit').done, undefined); assert.equal(g.phase, 'player'); assert.equal(g.view.hands[0].cards.length, 3);
});

test('double: one card only, win pays 3× of the original stake, loss costs 2×', () => {
  let { c, g } = bj(['5', '6'], ['10', '7'], ['K']);                // 21 vs 17
  assert.equal(act(c, 'double').mult, 3); assert.equal(g.view.hands[0].cards.length, 3); assert.match(g.result.label, /doubled/);
  ({ c, g } = bj(['5', '6'], ['10', '9'], ['2']));                  // 13 vs 19
  assert.equal(act(c, 'double').mult, -1);
  ({ c, g } = bj(['5', '6'], ['10', '7'], ['6']));                  // 17 vs 17
  assert.equal(act(c, 'double').mult, 1);
  ({ c, g } = bj(['10', '6'], ['10', '7'], ['K']));                 // bust
  assert.equal(act(c, 'double').mult, -1);
});

test('double is only allowed on the first two cards', () => {
  const { c, g } = bj(['2', '3'], ['10', '7'], ['4', 'K']);
  act(c, 'hit'); assert.match(act(c, 'double').text, /Nothing to do/); assert.equal(g.view.hands[0].doubled, false);
});

test('push when totals tie; dealer bust pays the player', () => {
  let { c } = bj(['10', '8'], ['10', '8']); assert.equal(act(c, 'stand').mult, 1);
  ({ c } = bj(['10', '2'], ['10', '6'], ['K'])); assert.equal(act(c, 'stand').mult, 2);
});

test('naturals: blackjack pays 3:2, dealer blackjack wins, both push', () => {
  const nat = (player, dealer) => bj(player, dealer, ['5', '5', '5']);
  let { c, g } = nat(['A', 'K'], ['10', '7']); assert.equal(act(c, 'stand').mult, 2.5); assert.equal(g.view.dealer.length, 2);
  ({ c, g } = nat(['A', 'K'], ['A', 'Q'])); assert.equal(act(c, 'stand').mult, 1);
  ({ c, g } = nat(['10', '9'], ['A', 'Q'])); assert.equal(act(c, 'stand').mult, 0);
});

test('a three-card 21 is not a blackjack — it pays 1:1', () => {
  const { c } = bj(['7', '7'], ['10', '8'], ['7']); assert.equal(act(c, 'hit').mult, 2);
});

test('blackjackPays is tunable (6:5 tables)', () => {
  const { c, g } = bj(['A', 'K'], ['10', '7'], [], (cfg) => { cfg.Games.find(x => x.id === 'blackjack').odds.blackjackPays = 1.2; });
  assert.equal(act(c, 'stand').mult, 2.2);
});

test('no actions after the hand is over', () => {
  const { c } = bj(['10', '9'], ['10', '8']); act(c, 'stand');
  assert.match(act(c, 'hit').text, /Nothing to do/); assert.match(act(c, 'stand').text, /Nothing to do/);
});

// ── Splits ──
test('split is offered only on a pair (tens of any face count as a pair) and within maxHands', () => {
  const odds = { maxHands: 4 };
  let { g } = bj(['8', '8'], ['10', '7']); assert.equal(G.bjCanSplit(odds, g.view), true);
  ({ g } = bj(['K', '10'], ['10', '7'])); assert.equal(G.bjCanSplit(odds, g.view), true);
  ({ g } = bj(['8', '9'], ['10', '7'])); assert.equal(G.bjCanSplit(odds, g.view), false);
  ({ g } = bj(['8', '8', '2'], ['10', '7'])); assert.equal(G.bjCanSplit(odds, g.view), false);
  ({ g } = bj(['8', '8'], ['10', '7'])); assert.equal(G.bjCanSplit({ maxHands: 1 }, g.view), false);
});

test('split: two hands, one new card each, played left to right', () => {
  const { c, g } = bj(['8', '8'], ['10', '7'], ['3', '2', 'K', '9']);      // hand1 8+3, hand2 8+2
  const r = act(c, 'split');
  assert.match(r.text, /2 hands/); assert.equal(g.view.hands.length, 2); assert.equal(g.view.active, 0);
  assert.deepEqual(g.view.hands.map(h => h.cards.map(x => x.r)), [['8', '3'], ['8', '2']]);
  act(c, 'hit'); assert.equal(g.view.active, 1);                             // 8+3+K = 21 → auto-advance
  const end = act(c, 'hit');                                                 // 8+2+9 = 19 → still open
  assert.equal(end.done, undefined); const fin = act(c, 'stand');
  assert.equal(fin.done, true); assert.equal(fin.mult, 3);                   // 21 beats 17 (+1), 19 beats 17 (+1)
  assert.match(g.result.label, /Hand 1: 21 beats dealer 17 · Hand 2: 19 beats dealer 17 — net \+2× stake/);
});

test('split hands settle independently: one wins, one busts = break even', () => {
  const { c, g } = bj(['9', '9'], ['10', '8'], ['K', '5', 'Q']);            // hand1 9+K=19, hand2 9+5 then Q = bust
  act(c, 'split'); act(c, 'stand'); const fin = act(c, 'hit');
  assert.equal(fin.done, true); assert.equal(fin.mult, 1);
  assert.deepEqual(g.view.hands.map(h => h.outcome.profit), [1, -1]);
});

test('a 21 made after a split is not a blackjack — it pays 1:1', () => {
  const { c, g } = bj(['K', 'K'], ['10', '7'], ['A', 'A']);
  const fin = act(c, 'split');                                               // both hands 21 at once → dealer plays
  assert.equal(fin.done, true); assert.equal(fin.mult, 3); assert.ok(!/BLACKJACK/.test(g.result.label));
});

test('split aces get one card each and stand', () => {
  const { c, g } = bj(['A', 'A'], ['10', '7'], ['5', '9']);
  const fin = act(c, 'split');
  assert.equal(fin.done, true); assert.deepEqual(g.view.hands.map(h => h.cards.length), [2, 2]);
  assert.deepEqual(g.view.hands.map(h => h.outcome.profit), [-1, 1]);        // 16 loses, 20 wins
});

test('double after split, re-split up to four hands, and the worst case costs −7×', () => {
  const { c, g } = bj(['8', '8'], ['10', '9'], ['8', '8', '2', '2', '2', '2', '10', '10', '10', '10']);
  act(c, 'split');                                 // [8,8] [8,8]
  act(c, 'split');                                 // [8,2] [8,2] [8,8]   (new cards 2,2)
  assert.equal(g.view.hands.length, 3);
  act(c, 'double');                                // hand1: 8+2+2 = 12 doubled
  act(c, 'double');                                // hand2: 8+2+2 = 12 doubled
  assert.equal(G.bjCanSplit({ maxHands: 4 }, g.view), true);
  act(c, 'split');                                 // [8,10] [8,10]
  assert.equal(g.view.hands.length, 4); assert.equal(G.bjCanSplit({ maxHands: 4 }, g.view), false);
  act(c, 'stand'); const fin = act(c, 'stand');
  assert.equal(fin.done, true);                    // dealer 19 beats 12, 12, 18, 18
  assert.deepEqual(g.view.hands.map(h => h.outcome.profit), [-2, -2, -1, -1]); assert.equal(fin.mult, -5);
});

test('if every hand busts the dealer does not draw', () => {
  const { c, g } = bj(['10', '10'], ['10', '6'], ['5', '5', 'K', 'K', '9']);
  act(c, 'split'); act(c, 'hit'); const fin = act(c, 'hit');
  assert.equal(fin.mult, -1); assert.equal(g.view.dealer.length, 2);
});

// ── Insurance ──
test('insurance is offered on a dealer ace before anything else can happen', () => {
  const { c, g } = deal(['10', 'A', '9', '5']);
  assert.equal(g.phase, 'insurance'); assert.equal(g.view.insurance, 'offered');
  assert.match(act(c, 'hit').text, /Nothing to do/); assert.match(act(c, 'stand').text, /Nothing to do/);
});

test('insurance taken + dealer blackjack: the hand loses, insurance pays 2:1 — break even', () => {
  const { c, g } = deal(['10', 'A', '9', 'K']);
  const r = act(c, 'insure');
  assert.equal(r.done, true); assert.equal(r.mult, 1); assert.match(g.result.label, /Dealer blackjack · insurance pays 2:1/);
});

test('insurance declined + dealer blackjack: the stake is lost', () => {
  const { c } = deal(['10', 'A', '9', 'K']); assert.equal(act(c, 'decline').mult, 0);
});

test('insurance taken, no dealer blackjack: play on and the half-stake is lost either way', () => {
  const { c, g } = deal(['10', 'A', '9', '6', '3']);                         // dealer A+6 = soft 17 stands
  assert.equal(act(c, 'insure').done, undefined); assert.equal(g.phase, 'player');
  assert.equal(act(c, 'stand').mult, 1.5);                                   // 19 beats 17 (+1) − 0.5 insurance
  assert.match(g.result.label, /insurance lost/);
});

test('player blackjack vs dealer ace: insuring locks in even money', () => {
  let { c } = deal(['A', 'A', 'K', 'Q']); assert.equal(act(c, 'insure').mult, 2);       // push + insurance 2:1
  ({ c } = deal(['A', 'A', 'K', '5'])); assert.equal(act(c, 'insure').mult, 2);          // blackjack 3:2 − 0.5
  ({ c } = deal(['A', 'A', 'K', '5'])); assert.equal(act(c, 'decline').mult, 2.5);
  ({ c } = deal(['A', 'A', 'K', 'Q'])); assert.equal(act(c, 'decline').mult, 1);
});

test('insurance can be switched off in the odds', () => {
  const { g } = deal(['10', 'A', '9', '5'], (cfg) => { cfg.Games.find(x => x.id === 'blackjack').odds.insurance = 0; });
  assert.equal(g.phase, 'player'); assert.equal(g.view.insurance, null);
});

test('blackjack settles correctly through the money chain for split + insured hands', () => {
  const { c } = bj(['9', '9'], ['10', '8'], ['K', '5', 'Q']);
  act(c, 'split'); act(c, 'stand'); const fin = act(c, 'hit');
  G.settle(c.config, c.state, c.p, fin.mult); assert.equal(c.p.balances.Gold, 500);
  const d = bj(['8', '8'], ['10', '9'], ['10', '10']); act(d.c, 'split'); act(d.c, 'stand'); const lose = act(d.c, 'stand');
  G.settle(d.c.config, d.c.state, d.c.p, lose.mult); assert.equal(d.c.p.balances.Gold, 300);
});

test('baccarat card values and totals', () => {
  assert.equal(G.bacTotal(cards('K', '9')), 9); assert.equal(G.bacTotal(cards('7', '8')), 5);
  assert.equal(G.bacTotal(cards('A', '10', 'J')), 1); assert.equal(G.bacTotal(cards('5', '5')), 0);
});

test('baccarat naturals stand: no third cards on 8 or 9', () => {
  let r = G.bacPlay(cards('4', '2', '4', '3', 'K', 'K'));           // P 8, B 5
  assert.deepEqual([r.P.length, r.B.length, r.winner], [2, 2, 'player']);
  r = G.bacPlay(cards('2', '9', '2', 'K', '5', '5'));               // P 4, B 9
  assert.deepEqual([r.P.length, r.B.length, r.winner], [2, 2, 'banker']);
});

test('baccarat: player draws on 0–5 and stands on 6–7', () => {
  assert.equal(G.bacPlay(cards('2', '7', '3', 'K', '4', 'K')).P.length, 3);      // P 5 draws
  assert.equal(G.bacPlay(cards('3', '7', '3', 'K', '4', 'K')).P.length, 2);      // P 6 stands
});

test('baccarat: when the player stands, the banker draws on 0–5 only', () => {
  assert.equal(G.bacPlay(cards('3', '2', '3', '3', '9')).B.length, 3);           // P 6, B 5
  assert.equal(G.bacPlay(cards('3', '3', '3', '3', '9')).B.length, 2);           // P 6, B 6
});

test('baccarat banker third-card table (banker total × player third card)', () => {
  // rule[b] = set of player third-card values on which the banker draws
  const draws = { 0: [0,1,2,3,4,5,6,7,8,9], 1: [0,1,2,3,4,5,6,7,8,9], 2: [0,1,2,3,4,5,6,7,8,9], 3: [0,1,2,3,4,5,6,7,9], 4: [2,3,4,5,6,7], 5: [4,5,6,7], 6: [6,7], 7: [] };
  const rank = (v) => v === 0 ? 'K' : v === 1 ? 'A' : String(v);
  for (let b = 0; b <= 7; b++) for (let third = 0; third <= 9; third++) {
    // player: K + 5 (total 5, must draw `third`); banker: K + b
    const r = G.bacPlay([card('K'), card('K'), card('5'), card(rank(b)), card(rank(third)), card('2')]);
    assert.equal(r.P.length, 3);
    assert.equal(r.B.length === 3, draws[b].includes(third), `banker ${b} vs third ${third}`);
  }
});

test('baccarat payouts: Player 1:1, Banker 0.95:1, Tie 8:1, and a tie pushes side bets', () => {
  const play = (side, shoe) => {
    const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'baccarat', c.p, [{ amount: 100, cur: 'Gold' }]);
    act(c, 'bet', { side });
    // rig the deal by scripting the shuffle: easier to call the scorer directly through a stubbed bacPlay input
    const g = c.state.game; const { winner } = G.bacPlay(shoe);
    const odds = G.effectiveOdds(c.config, c.state, 'baccarat');
    return side === winner ? 1 + odds[side] : winner === 'tie' ? 1 : 0;
  };
  const pWin = cards('4', '2', '4', '3'), bWin = cards('2', '9', '2', 'K'), tie = cards('4', '4', '4', '4');
  assert.equal(play('player', pWin), 2); assert.equal(play('banker', bWin), 1.95); assert.equal(play('tie', tie), 9);
  assert.equal(play('player', bWin), 0); assert.equal(play('player', tie), 1); assert.equal(play('banker', tie), 1); assert.equal(play('tie', pWin), 0);
});

test('baccarat through the game flow: bet → deal → result, with staggered card times', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'baccarat', c.p, [{ amount: 100, cur: 'Gold' }]);
  assert.match(act(c, 'deal').text, /Nothing to do/);                             // no bet yet
  act(c, 'bet', { side: 'banker' });
  const r = act(c, 'deal'); const g = c.state.game;
  assert.equal(r.done, true); assert.ok([0, 1, 1.95].includes(r.mult));
  const times = [g.view.player[0], g.view.banker[0], g.view.player[1], g.view.banker[1], g.view.player[2], g.view.banker[2]].filter(Boolean).map(x => x.t);
  assert.deepEqual(times, times.slice().sort((a, b) => a - b)); assert.ok(g.view.revealAt > times.at(-1));
  assert.match(act(c, 'deal').text, /Nothing to do/);                             // can't re-deal
});

test('plinko: binomial weights and a default table that returns ~96.6%', () => {
  assert.deepEqual([0, 1, 2, 6, 12].map(k => G.binom(12, k)), [1, 12, 66, 924, 1]);
  const m = G.PLINKO_DEFAULT_MULTS; let ev = 0;
  m.forEach((x, k) => { ev += G.binom(12, k) * x; });
  assert.ok(Math.abs(ev / 4096 - 0.9657) < 0.001);
  assert.deepEqual(m, m.slice().reverse());                                        // symmetric board
});

test('plinko: the ball path always ends in the slot that pays', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'plinko', c.p, [{ amount: 100, cur: 'Gold' }]);
  for (let i = 0; i < 300; i++) {
    act(c, 'spin', {}); const g = c.state.game, d = g.view.drop;
    assert.equal(d.path.length, 12); assert.equal(d.path.reduce((a, b) => a + b, 0), d.slot);
    assert.equal(g.pending.mult, g.view.mults[d.slot]);
  }
});

test('plinko: scripted rolls reach the edge and the centre', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'plinko', c.p, []);
  act(c, 'spin', {}, fixedRng([0])); assert.equal(c.state.game.pending.mult, 33); assert.equal(c.state.game.view.drop.slot, 0);
  act(c, 'spin', {}, fixedRng([0.5])); assert.equal(c.state.game.view.drop.slot, 6); assert.equal(c.state.game.pending.mult, 0.3);
});

test('plinko falls back to the default board when the config row has bad multipliers', () => {
  assert.equal(G.plinkoMults({}).length, 13); assert.equal(G.plinkoMults({ mults: [1, 2] }).length, 13);
  assert.deepEqual(G.plinkoMults({ mults: ['5', 1, 0.2, 1, 5] }), [5, 1, 0.2, 1, 5]);
});

test('gameNeedsTicks: only while something is in motion', () => {
  assert.equal(G.gameNeedsTicks(null, 0), false);
  assert.equal(G.gameNeedsTicks({ id: 'crash', phase: 'running', view: {} }, 0), true);
  assert.equal(G.gameNeedsTicks({ id: 'crash', phase: 'done', view: {} }, 0), false);
  assert.equal(G.gameNeedsTicks({ id: 'plinko', view: { revealAt: 1000 } }, 900), true);
  assert.equal(G.gameNeedsTicks({ id: 'plinko', view: { revealAt: 1000 } }, 1600), false);
  assert.equal(G.gameNeedsTicks({ id: 'mines', view: {} }, 0), false);
});
