// The 24 plug-in minigames: every one starts, plays to a finish with legal moves, pays what it says, and returns what it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, G, R, mkGame, fixedRng, DEFAULT_CONFIG } from './_helpers.mjs';
const { EXTRA_LIST, EXTRA, EXTRA_GROUPS } = await import('../../site/js/games-extra.js');
const Q = await import('../../site/js/games-quick.js');
const SH = await import('../../site/js/games-show.js');
const T = await import('../../site/js/games-table.js');
const esc = (s) => String(s);
const cardsHtml = (cards, now) => cards.filter(c => c.t <= now).map(c => (c.down || (c.flipAt && now < c.flipAt) ? '[??]' : `[${c.r}${c.s}]`)).join('');
const c = (s) => s.split(' ').map(t => ({ r: t.slice(0, -1), s: t.slice(-1), t: 0 }));

// start a game for player 0 with a 100 Gold stake
function begin(id, { seed = 7, tweak = null, rng = null } = {}) {
  const t = mkGame(['Aj', 'Nick'], seed, tweak); const r = rng || t.rng;
  G.startGame(t.config, t.state, r, id, t.p, [{ amount: 100, cur: 'Gold' }]);
  return { ...t, r, g: t.state.game, act: (a, p) => G.gameAction(t.config, t.state, r, a, p), x: () => G.extraCtx(t.config, t.state, r, t.state.game) };
}
// play one round with the game's own bot; returns the finished game
function playOut(id, pick, smart, opts) {
  const t = begin(id, opts); let guard = 0;
  while (t.g.phase !== 'done' && guard++ < 300) { const [a, p] = EXTRA[id].bot(t.g, pick, smart, t.x()); t.act(a, p); }
  assert.equal(t.g.phase, 'done', `${id} did not finish`);
  return t;
}

test('there are 24 plug-in games in three groups, each with a unique id, a name and an icon', () => {
  assert.equal(EXTRA_LIST.length, 24);
  assert.equal(new Set(EXTRA_LIST.map(g => g.id)).size, 24);
  assert.deepEqual(EXTRA_GROUPS.map(g => g.ids.length), [10, 8, 6]);
  for (const g of EXTRA_LIST) { assert.ok(g.name && g.icon, g.id); for (const fn of ['how', 'start', 'act', 'controls', 'stage', 'bot']) assert.equal(typeof g[fn], 'function', `${g.id}.${fn}`); }
  assert.ok(!EXTRA_LIST.some(g => ['fifty', 'bigwheel', 'roulette', 'crash', 'mines', 'blackjack', 'baccarat', 'plinko', 'hilo', 'dice', 'slots', 'keno', 'placeholder'].includes(g.id)));
});
test('every plug-in game is in the built-in config, switched on, with a rulebook blurb', () => {
  for (const X of EXTRA_LIST) {
    const row = DEFAULT_CONFIG.Games.find(g => g.id === X.id); assert.ok(row && row.built, X.id);
    const how = X.how(G.effectiveOdds(DEFAULT_CONFIG, { oddsOverrides: {} }, X.id));
    assert.ok(how.length > 40 && !/undefined|NaN/.test(how), `${X.id}: ${how}`);
  }
});

for (const X of EXTRA_LIST) {
  test(`${X.id}: 300 random rounds finish with a finite result, sane controls and a clean stage`, () => {
    const pick = R.makeRng(1000 + X.id.length);
    for (let i = 0; i < 300; i++) {
      const t = begin(X.id, { seed: 50 + i }); let guard = 0;
      assert.equal(t.state.game, t.g); assert.ok(t.g.view && typeof t.g.view === 'object');
      while (t.g.phase !== 'done' && guard++ < 300) {
        const ctl = X.controls(t.g, t.x());
        assert.ok(Array.isArray(ctl.buttons) && ctl.buttons.length, `${X.id}: no buttons in phase ${t.g.phase}`);
        assert.ok(ctl.buttons.some(b => !b.disabled), `${X.id}: every button disabled in phase ${t.g.phase}`);
        if (i < 8) { const html = X.stage(t.g, Date.now() + 60000, { ...t.x(), esc, cardsHtml }); assert.ok(typeof html === 'string' && html.length > 10 && !/undefined|NaN|\[object/.test(html), `${X.id} stage mid-game: ${html.slice(0, 200)}`); }
        const [a, p] = X.bot(t.g, pick, false, t.x()); t.act(a, p);
      }
      assert.equal(t.g.phase, 'done', `${X.id} never finished (seed ${50 + i})`);
      const m = t.g.result.mult;
      assert.ok(Number.isFinite(m) && m >= -3 && m <= 10001, `${X.id} mult ${m}`);
      assert.ok(t.g.result.label && !/undefined|NaN/.test(t.g.result.label), `${X.id} label "${t.g.result.label}"`);
      assert.ok(Number.isFinite(t.g.view.revealAt), `${X.id} revealAt`);
      if (i < 8) for (const when of [0, Date.now(), t.g.view.revealAt + 1]) { const html = X.stage(t.g, when, { ...t.x(), esc, cardsHtml }); assert.ok(!/undefined|NaN|\[object/.test(html), `${X.id} final stage at ${when}: ${html.slice(0, 300)}`); }
      // nothing an action returns once the round is over changes it
      const frozen = JSON.stringify(t.g.result); for (const b of ['bet', 'pick', 'roll', 'cashout', 'call', 'draw', 'play']) t.act(b, { i: 0, n: 1, side: 'under', v: 'red', type: 'big', target: 2, color: 'Red' });
      assert.equal(JSON.stringify(t.g.result), frozen, `${X.id} changed after it ended`);
      // settle pays exactly what the result says
      const before = S.bal(t.p, 'Gold'); G.settle(t.config, t.state, t.p, m, { gameId: X.id });
      assert.equal(S.bal(t.p, 'Gold') - before, Math.round(100 * (m - 1)), `${X.id} settle`); assert.equal(t.state.game, null);
    }
  });
  test(`${X.id}: the result stays hidden on the shared screen until it has played out`, () => {
    const pick = R.makeRng(5);
    for (let i = 0; i < 40; i++) { const t = playOut(X.id, pick, false, { seed: 900 + i });
      if (t.g.view.revealAt <= Date.now() + 5) continue;                                   // instant results (cash-outs) have nothing to hide
      const early = X.stage(t.g, Date.now() - 50, { ...t.x(), esc, cardsHtml });
      assert.ok(!early.includes(`stage-big crash-good">${t.g.result.label}`) && !early.includes(`stage-big crash-bad">${t.g.result.label}`) && !early.includes(`stage-big ">${t.g.result.label}`), `${X.id} shows its result early`);
      assert.ok(X.stage(t.g, t.g.view.revealAt + 10, { ...t.x(), esc, cardsHtml }).includes(t.g.result.label), `${X.id} never shows its result`); }
  });
  test(`${X.id}: junk actions are refused without breaking the game`, () => {
    const t = begin(X.id); const before = JSON.stringify(t.g.view);
    for (const [a, p] of [['nonsense', {}], ['bet', {}], ['pick', { i: 99 }], ['pick', { i: -1 }], ['pick', { n: 'x' }], ['bet', { side: 'sideways', type: 'huge', target: -5, color: 'Mauve', i: 44 }], ['call', { v: 'purple' }], ['open', { i: 99 }], ['hold', { i: 7 }], ['toggle', { i: 9 }], ['odds', { n: 99 }], ['scratch', { i: 12 }]])
      assert.doesNotThrow(() => t.act(a, p), `${X.id} threw on ${a}`);
    assert.doesNotThrow(() => t.act('bet', null));
    if (t.g.phase !== 'done') assert.ok(!/NaN|undefined/.test(JSON.stringify(t.g.view)));
    assert.ok(before.length > 2);
  });
  test(`${X.id}: same seed, same round`, () => {
    const run = () => { const t = begin(X.id, { seed: 4242 }); const pick = R.makeRng(9); let guard = 0;
      while (t.g.phase !== 'done' && guard++ < 300) { const [a, p] = X.bot(t.g, pick, false, t.x()); t.act(a, p); } return JSON.stringify(t.g.result); };
    assert.equal(run(), run());
  });
}

// ── returns: closed-form figures are right, and simulated play lands where it should ─────────────
const simulate = (id, n, smart = true, tweak = null) => {
  const t = mkGame(['A'], 31337, tweak), pick = R.makeRng(808); let ret = 0;
  for (let i = 0; i < n; i++) { G.startGame(t.config, t.state, t.rng, id, t.p, [{ amount: 100, cur: 'Gold' }]); const g = t.state.game; let guard = 0;
    while (g.phase !== 'done' && guard++ < 300) { const [a, p] = EXTRA[id].bot(g, pick, smart, G.extraCtx(t.config, t.state, t.rng, g)); G.gameAction(t.config, t.state, t.rng, a, p); }
    ret += g.result.mult; t.state.game = null; t.state.ledger.length = 0; }
  return ret / n;
};
test('every closed-form return is between 85% and 100% — no game pays out more than it takes', () => {
  for (const X of EXTRA_LIST) { if (!X.returns) continue;
    for (const r of X.returns(G.effectiveOdds(DEFAULT_CONFIG, { oddsOverrides: {} }, X.id))) assert.ok(r.rtp > 0.85 && r.rtp <= 1.0, `${r.label}: ${(r.rtp * 100).toFixed(1)}%`); }
});
const SIM = { coinstreak: [0.941, 0.02], war: [0.971, 0.02], dragontiger: [0.963, 0.015], reddog: [0.972, 0.03], chuckaluck: [0.954, 0.03], sicbo: [0.972, 0.015], underover7: [0.958, 0.03], colorwheel: [0.966, 0.015],
  limbo: [0.97, 0.02], race: [0.948, 0.03], tower: [0.969, 0.03], chicken: [0.97, 0.03], pachinko: [0.958, 0.02], deal: [0.965, 0.02], hilodice: [0.94, 0.03], thimbles: [0.96, 0.02], craps: [0.986, 0.03], threecard: [0.966, 0.03], paigow: [0.972, 0.03] };
for (const [id, [want, tol]] of Object.entries(SIM)) test(`${id}: 40,000 sensible rounds return about ${(want * 100).toFixed(1)}%`, () => {
  const got = simulate(id, 40000); assert.ok(Math.abs(got - want) < tol, `${id} returned ${(got * 100).toFixed(2)}%`);
});
test('the high-variance games stay in a sane band over 40,000 rounds (scratch, bus, video poker, let it ride, hold\'em)', () => {
  for (const [id, lo, hi] of [['scratch', 0.88, 1.05], ['bus', 0.9, 1.0], ['videopoker', 0.9, 1.03], ['letitride', 0.88, 1.06], ['holdem', 0.9, 1.01]]) { const got = simulate(id, 40000); assert.ok(got > lo && got < hi, `${id} returned ${(got * 100).toFixed(2)}%`); }
});
test('random (bad) play never beats the house either', () => {
  for (const X of EXTRA_LIST) { const got = simulate(X.id, 6000, false); assert.ok(got < 1.12, `${X.id} returned ${(got * 100).toFixed(1)}% to random play`); }
});
test('odds are tunable: a bigger house edge lowers what the game returns', () => {
  const o = (id, patch) => (cfg) => { Object.assign(cfg.Games.find(g => g.id === id).odds, patch); };
  assert.ok(simulate('limbo', 20000, true, o('limbo', { houseEdge: 0.3 })) < 0.78);
  assert.ok(simulate('thimbles', 20000, true, o('thimbles', { pay: 2 })) < 0.72);
  assert.ok(simulate('chuckaluck', 20000, true, o('chuckaluck', { pay3: 3 })) < 0.94);
  assert.ok(simulate('underover7', 20000, true, o('underover7', { sidePay: 1, sevenPay: 4 })) < 0.9);
});

// ── rule checks, one game at a time ──────────────────────────────────────────────────────────────
test('coin streak: each right call multiplies by 1.94, a wrong one loses, cash-out with no flips is a push', () => {
  let t = begin('coinstreak', { rng: fixedRng([0.1]) });                                   // 0.1 < 0.5 → heads
  t.act('heads'); assert.equal(t.g.view.mult, 1.94); t.act('heads'); assert.equal(t.g.view.mult, 3.76);
  assert.equal(t.act('cashout').mult, 3.76);
  t = begin('coinstreak', { rng: fixedRng([0.1]) }); assert.equal(t.act('tails').mult, 0);
  t = begin('coinstreak'); assert.equal(t.act('cashout').mult, 1);
  t = begin('coinstreak', { rng: fixedRng([0.1]), tweak: (cfg) => { cfg.Games.find(g => g.id === 'coinstreak').odds = { maxMult: 3 }; } });
  t.act('heads'); const r = t.act('heads'); assert.equal(r.done, true); assert.equal(r.mult, 3);
});
test('war: high card wins, tie offers war or surrender, war win pays 1 unit, war loss costs 2', () => {
  const X = EXTRA.war, mk = (deck) => { const g = { id: 'war', view: {}, secret: {}, phase: 'ready' }; const x = { rng: R.makeRng(1), now: 1000, odds: { decks: 1 } }; X.start(g, x); return { g, x }; };
  const rig = (cards) => { const t = begin('war'); const g = t.g; g.phase = 'ready'; g.result = null; g.secret.deck = c(cards); const p = { ...g.secret.deck.shift(), t: 0 }, d = { ...g.secret.deck.shift(), t: 0 }; g.view.player = [p]; g.view.dealer = [d]; return { t, g }; };
  { const { g } = mk(); assert.ok(['done', 'tie'].includes(g.phase)); }
  let seenWin = 0, seenLose = 0, seenTie = 0;
  for (let s = 1; s < 400; s++) { const t = begin('war', { seed: s }); const p = t.g.view.player[0], d = t.g.view.dealer[0], pv = '23456789'.includes(p.r) ? Number(p.r) : { 10: 10, J: 11, Q: 12, K: 13, A: 14 }[p.r], dv = '23456789'.includes(d.r) ? Number(d.r) : { 10: 10, J: 11, Q: 12, K: 13, A: 14 }[d.r];
    if (pv > dv) { seenWin++; assert.equal(t.g.result.mult, 2); } else if (pv < dv) { seenLose++; assert.equal(t.g.result.mult, 0); }
    else { seenTie++; assert.equal(t.g.phase, 'tie'); if (s % 2) assert.equal(t.act('surrender').mult, 0.5); else { const r = t.act('war'); assert.ok(r.mult === 2 || r.mult === -1); assert.equal(t.g.view.player.length, 2); } } }
  assert.ok(seenWin > 100 && seenLose > 100 && seenTie > 5);
  assert.ok(rig('A♠ K♠').g);
});
test('dragon tiger: aces are low; a tie refunds half of Dragon/Tiger bets and pays the Tie bet', () => {
  const rig = (side, cards) => { const t = begin('dragontiger'); const X = EXTRA.dragontiger; const orig = t.r.next; let n = 0;
    // deal from a stacked deck by swapping the deck after the bet is validated
    const g = t.g; const x = { ...t.x(), now: 1000 }; g.phase = 'bet';
    const real = X.act; const res = (() => { const deck = c(cards); const fakeRng = { next: () => 0.5, int: (a) => a, chance: () => true };
      const out = real.call(X, g, 'bet', { side }, { ...x, rng: fakeRng }); return { out, deck }; })();
    return res.out; };
  // use natural play instead of stacking: check the arithmetic over many seeds
  let ties = 0;
  for (let s = 1; s < 600; s++) for (const side of ['dragon', 'tiger', 'tie']) { const t = begin('dragontiger', { seed: s }); const r = t.act('bet', { side }); const v = t.g.view;
    const val = (cd) => (cd.r === 'A' ? 1 : '23456789'.includes(cd.r) ? Number(cd.r) : { 10: 10, J: 11, Q: 12, K: 13 }[cd.r]); const d = val(v.dragon[0]), g2 = val(v.tiger[0]);
    const w = d > g2 ? 'dragon' : g2 > d ? 'tiger' : 'tie'; if (w === 'tie') ties++;
    assert.equal(v.winner, w); assert.equal(r.mult, side === 'tie' ? (w === 'tie' ? 12 : 0) : w === 'tie' ? 0.5 : w === side ? 2 : 0); }
  assert.ok(ties > 30);
  assert.ok(typeof rig === 'function');
});
test('red dog: consecutive cards push, a pair pushes or pays 11:1, and the gap sets the price', () => {
  const seen = { push: 0, pair: 0, decide: 0 };
  for (let s = 1; s < 500; s++) { const t = begin('reddog', { seed: s }); const v = t.g.view;
    if (v.spread === 0) { seen.push++; assert.equal(t.g.result.mult, 1); }
    else if (v.spread === -1) { seen.pair++; assert.ok(t.g.result.mult === 1 || t.g.result.mult === 12); assert.equal(v.cards.length + 1, 3); }
    else { seen.decide++; assert.equal(t.g.phase, 'decide'); assert.equal(v.pay, [5, 4, 2, 1][Math.min(4, v.spread) - 1]);
      const raise = s % 2 === 0, r = t.act(raise ? 'raise' : 'call'); assert.ok([1 + v.pay * (raise ? 2 : 1), raise ? -1 : 0].includes(r.mult)); } }
  assert.ok(seen.push > 20 && seen.pair > 10 && seen.decide > 300);
});
test('chuck-a-luck: one, two or three matches pay 1:1, 2:1, 10:1', () => {
  const roll = (vals, n) => { const t = begin('chuckaluck', { rng: fixedRng(vals.map(v => (v - 0.5) / 6)) }); return t.act('pick', { n }).mult; };
  assert.equal(roll([3, 5, 6], 1), 0); assert.equal(roll([1, 5, 6], 1), 2); assert.equal(roll([1, 1, 6], 1), 3); assert.equal(roll([4, 4, 4], 4), 11);
});
test('sic bo: small/big lose to triples; totals and the triple bet pay their table', () => {
  const roll = (vals, bet) => { const t = begin('sicbo', { rng: fixedRng(vals.map(v => (v - 0.5) / 6)) }); return t.act('bet', bet).mult; };
  assert.equal(roll([1, 2, 3], { type: 'small' }), 2); assert.equal(roll([1, 2, 3], { type: 'big' }), 0); assert.equal(roll([6, 5, 4], { type: 'big' }), 2);
  assert.equal(roll([2, 2, 2], { type: 'small' }), 0, 'a triple beats Small'); assert.equal(roll([5, 5, 5], { type: 'big' }), 0); assert.equal(roll([3, 3, 3], { type: 'odd' }), 0);
  assert.equal(roll([1, 2, 4], { type: 'odd' }), 2); assert.equal(roll([1, 2, 3], { type: 'even' }), 2);
  assert.equal(roll([2, 2, 2], { type: 'triple' }), 34); assert.equal(roll([1, 2, 3], { type: 'triple' }), 0);
  assert.equal(roll([1, 1, 2], { type: 'total', n: 4 }), 69); assert.equal(roll([6, 6, 5], { type: 'total', n: 17 }), 69); assert.equal(roll([3, 3, 4], { type: 'total', n: 10 }), 7.7); assert.equal(roll([3, 3, 4], { type: 'total', n: 11 }), 0);
});
test('under/over 7: 1.3:1 either side, 4.75:1 on the seven', () => {
  const roll = (a, b, side) => { const t = begin('underover7', { rng: fixedRng([(a - 0.5) / 6, (b - 0.5) / 6]) }); return t.act('bet', { side }).mult; };
  assert.equal(roll(1, 2, 'under'), 2.3); assert.equal(roll(3, 4, 'under'), 0); assert.equal(roll(3, 4, 'seven'), 5.75); assert.equal(roll(6, 5, 'over'), 2.3); assert.equal(roll(6, 5, 'seven'), 0);
});
test('wheel of colours: 50 slots laid out evenly, the big wheel overlay gets the spin, pays the colour price', () => {
  const segs = Q.colorSegments({}), layout = Q.colorLayout(segs);
  assert.equal(layout.length, 50); assert.deepEqual(segs.map((_, i) => layout.filter(k => k === i).length), [23, 13, 8, 4, 2]);
  const purple = layout.map((k, i) => (k === 4 ? i : -1)).filter(i => i >= 0); assert.ok(purple[1] - purple[0] > 15, 'rare colours are spread apart');
  const t = begin('colorwheel', { rng: fixedRng([0]) }); const r = t.act('bet', { color: segs[layout[0]].label });
  assert.equal(r.mult, 1 + segs[layout[0]].pay); assert.equal(t.state.lastSpin.wheel, 'WHEEL OF COLOURS'); assert.equal(t.state.lastSpin.outcomes.length, 50); assert.equal(t.state.lastSpin.colors.length, 50);
  const t2 = begin('colorwheel', { rng: fixedRng([0]) }); assert.equal(t2.act('bet', { color: 'Purple' }).mult, layout[0] === 4 ? 24 : 0);
});
test('scratch card: a winning card has its symbol exactly three times, a losing card has no three alike', () => {
  let wins = 0;
  for (let s = 1; s < 800; s++) { const t = begin('scratch', { seed: s }); const cells = t.g.secret.cells; assert.equal(cells.length, 9);
    const counts = {}; cells.forEach(x => { counts[x] = (counts[x] || 0) + 1; }); const triples = Object.entries(counts).filter(([, n]) => n >= 3);
    if (t.g.secret.mult) { wins++; assert.equal(triples.length, 1); assert.equal(triples[0][1], 3); assert.equal(triples[0][0], t.g.secret.icon); } else assert.equal(triples.length, 0);
    assert.ok(t.g.view.cells.every(x => x === null), 'nothing shows before scratching'); }
  assert.ok(wins > 150 && wins < 350);
  const t = begin('scratch'); for (let i = 0; i < 8; i++) { t.act('scratch', { i }); assert.notEqual(t.g.phase, 'done'); } t.act('scratch', { i: 3 }); assert.notEqual(t.g.phase, 'done', 're-scratching does nothing');
  assert.equal(t.act('scratch', { i: 8 }).done, true); assert.equal(t.g.result.mult, t.g.secret.mult);
});
test('limbo: pays the target when the draw clears it; targets outside the range are refused', () => {
  const t = begin('limbo', { rng: fixedRng([0.5]) });                                     // 0.97 / 0.5 = 1.94
  assert.equal(t.act('bet', { target: 5000 }).error, true); assert.equal(t.act('bet', { target: 1 }).error, true); assert.equal(t.g.phase, 'bet');
  assert.equal(t.act('bet', { target: 1.9 }).mult, 1.9); assert.equal(t.g.view.result, 1.94);
  assert.equal(begin('limbo', { rng: fixedRng([0.5]) }).act('bet', { target: 2 }).mult, 0);
  assert.ok(Math.abs(Q.limboChance({ houseEdge: 0.03 }, 2) - 0.485) < 1e-9);
});
test('the races: the winner finishes first, favourites pay less, positions never leave the track', () => {
  const pays = SH.racePays({ houseEdge: 0.05 }); assert.ok(pays[0] < pays[5]); assert.deepEqual(pays.slice().sort((a, b) => a - b), pays);
  for (let s = 1; s < 200; s++) { const t = begin('race', { seed: s }); const r = t.act('bet', { i: s % 6 }); const v = t.g.view;
    assert.equal(Math.min(...v.finish), v.finish[v.winner]); assert.equal(r.mult, v.winner === s % 6 ? v.runners[s % 6].pay : 0); assert.equal(new Set(v.finish).size, 6); }
  for (const seed of [1, 2, 50, 97]) for (let ms = -500; ms <= 12000; ms += 250) { const p = SH.racePos(9000, seed, ms); assert.ok(p >= 0 && p <= 1); }
  assert.equal(SH.racePos(9000, 7, 9000), 1); assert.equal(SH.racePos(9000, 7, 0), 0);
});
test('tower: safe doors climb the ladder, a trap ends it, the top cashes out by itself', () => {
  const o = { floors: 8, tiles: 3, traps: 1, houseEdge: 0.03 }; assert.equal(SH.towerMult(o, 1), 1.45); assert.equal(SH.towerMult(o, 8), 24.86);
  const t = begin('tower'); const safe = (f) => [0, 1, 2].find(i => !t.g.secret.traps[f].includes(i));
  t.act('pick', { i: safe(0) }); assert.equal(t.g.view.mult, 1.45); t.act('pick', { i: safe(1) }); assert.equal(t.g.view.mult, 2.18);
  assert.equal(t.g.view.traps, null, 'traps stay hidden while climbing');
  const r = t.act('pick', { i: t.g.secret.traps[2][0] }); assert.equal(r.mult, 0); assert.ok(t.g.view.traps);
  const u = begin('tower'); for (let f = 0; f < 8; f++) u.act('pick', { i: [0, 1, 2].find(i => !u.g.secret.traps[f].includes(i)) }); assert.equal(u.g.phase, 'done'); assert.equal(u.g.result.mult, 24.86);
  const w = begin('tower'); w.act('pick', { i: [0, 1, 2].find(i => !w.g.secret.traps[0].includes(i)) }); assert.equal(w.act('cashout').mult, 1.45);
});
test('chicken cross: risk climbs lane by lane and the ladder is priced to it', () => {
  const o = { lanes: 10, baseRisk: 0.06, riskStep: 0.025, houseEdge: 0.03 };
  assert.ok(Math.abs(SH.chickenRisk(o, 0) - 0.06) < 1e-9); assert.ok(Math.abs(SH.chickenRisk(o, 9) - 0.285) < 1e-9); assert.equal(SH.chickenMult(o, 0), 0.97); assert.equal(SH.chickenMult(o, 1), 1.03);
  for (let k = 1; k <= 10; k++) assert.ok(SH.chickenMult(o, k) > SH.chickenMult(o, k - 1));
  const t = begin('chicken', { rng: fixedRng([0.99]) }); for (let i = 0; i < 10; i++) t.act('step'); assert.equal(t.g.phase, 'done'); assert.equal(t.g.result.mult, SH.chickenMult(o, 10));
  assert.equal(begin('chicken', { rng: fixedRng([0.0]) }).act('step').mult, 0);
});
test('pachinko: five balls, the bet is multiplied by their average slot', () => {
  const t = begin('pachinko'); const r = t.act('drop'); const v = t.g.view;
  assert.equal(v.drops.length, 5); for (const d of v.drops) { assert.equal(d.path.length, 8); assert.equal(d.slot, d.path.reduce((s, x) => s + x, 0)); }
  assert.equal(r.mult, Math.floor(v.drops.reduce((s, d) => s + v.mults[d.slot], 0) / 5 * 100 + 1e-9) / 100);
  assert.equal(begin('pachinko', { rng: fixedRng([0.9]) }).act('drop').mult, 9, 'all left edge');
});
test('deal or no deal: open 3-3-2 with an offer after each, the offer follows what is left, never dealing ends in keep/swap', () => {
  const t = begin('deal'); t.act('pick', { i: 4 }); assert.equal(t.g.phase, 'open'); assert.equal(t.act('open', { i: 4 }).error, true, 'cannot open your own case');
  const openN = (n) => { for (let k = 0, i = 0; k < n; i++) { if (i === 4 || i in t.g.view.opened) continue; t.act('open', { i }); k++; } };
  openN(3); assert.equal(t.g.phase, 'offer');
  const left = t.g.secret.cases.filter((_, i) => !(i in t.g.view.opened)); assert.equal(left.length, 7);
  assert.equal(t.g.view.offer, Math.floor(0.85 * left.reduce((s, v) => s + v, 0) / 7 * 100 + 1e-9) / 100);
  t.act('nodeal'); openN(3); assert.equal(t.g.phase, 'offer'); t.act('nodeal'); openN(2); assert.equal(t.g.phase, 'offer');
  const two = t.g.secret.cases.filter((_, i) => !(i in t.g.view.opened)); assert.equal(two.length, 2); assert.equal(t.g.view.offer, Math.floor((two[0] + two[1]) / 2 * 100 + 1e-9) / 100, 'last offer is the fair average');
  t.act('nodeal'); assert.equal(t.g.phase, 'final'); const r = t.act('keep'); assert.equal(r.mult, t.g.secret.cases[4]);
  const u = begin('deal'); u.act('pick', { i: 0 }); u.act('open', { i: 1 }); u.act('open', { i: 2 }); u.act('open', { i: 3 }); const offer = u.g.view.offer; assert.equal(u.act('deal').mult, offer);
  const w = begin('deal'); w.act('pick', { i: 0 }); for (const i of [1, 2, 3]) w.act('open', { i }); w.act('nodeal'); for (const i of [4, 5, 6]) w.act('open', { i }); w.act('nodeal'); for (const i of [7, 8]) w.act('open', { i }); w.act('nodeal'); assert.equal(w.act('swap').mult, w.g.secret.cases[9]);
  assert.ok(Math.abs(SH.dealValues({}).reduce((s, v) => s + v, 0) / 10 - 0.965) < 1e-9);
});
test('dice hi-lo: rarer calls pay more, impossible calls are refused, equal totals re-roll for free', () => {
  const o = { houseEdge: 0.03 };
  assert.equal(SH.hilodiceStep(o, 7, 'higher'), 1.94); assert.equal(SH.hilodiceStep(o, 7, 'lower'), 1.94); assert.equal(SH.hilodiceStep(o, 12, 'higher'), 0); assert.equal(SH.hilodiceStep(o, 2, 'lower'), 0);
  assert.ok(SH.hilodiceStep(o, 11, 'higher') > 30); assert.ok(SH.hilodiceStep(o, 11, 'lower') < 1.01 + 0.03);
  const d = (a, b) => [(a - 0.5) / 6, (b - 0.5) / 6];
  const t = begin('hilodice', { rng: fixedRng([...d(3, 4), ...d(3, 4), ...d(6, 6)]) }); assert.equal(t.g.view.total, 7);
  assert.equal(t.act('higher').done, undefined); assert.equal(t.g.view.steps, 0, 'a 7 after a 7 is a free re-roll');
  t.act('higher'); assert.equal(t.g.view.mult, 1.94); assert.equal(t.act('higher').error, true, 'nothing beats 12'); assert.equal(t.act('cashout').mult, 1.94);
});
test('ride the bus: prices follow the cards that are out; ties lose; four right calls finish the ride', () => {
  const o = { stageEdge: 0.015 }, deck = (skip) => { const d = []; for (const s of ['♠', '♥', '♦', '♣']) for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) if (!skip.includes(r + s)) d.push({ r, s }); return d; };
  assert.deepEqual(SH.busOptions(o, [], deck([])), { red: 1.97, black: 1.97 });
  const afterAce = SH.busOptions(o, c('A♠'), deck(['A♠'])); assert.equal(afterAce.higher, 0); assert.ok(afterAce.lower < 1.1);
  const wide = SH.busOptions(o, c('2♠ A♥'), deck(['2♠', 'A♥'])); assert.equal(wide.outside, 0, 'nothing is outside 2–A'); assert.ok(wide.inside < 1.2, 'a wide gap is easy to land inside, so it pays little');
  const tight = SH.busOptions(o, c('5♠ 9♥'), deck(['5♠', '9♥'])); assert.ok(tight.inside > tight.outside, 'a narrow gap pays more to land inside');
  const suits = SH.busOptions(o, c('2♠ A♥ 7♦'), deck(['2♠', 'A♥', '7♦'])); assert.ok(suits['♣'] < suits['♠'], 'the untouched suit pays least');
  let full = 0; for (let s = 1; s < 3000 && full < 3; s++) { const t = begin('bus', { seed: s }); const pick = R.makeRng(s); let guard = 0;
    while (t.g.phase !== 'done' && guard++ < 10) { const live = Object.entries(t.g.view.opts).filter(([, m]) => m); t.act('call', { v: live[pick.int(0, live.length - 1)][0] }); }
    if (t.g.view.cards.length === 4 && t.g.result.mult > 0) { full++; assert.ok(t.g.result.mult > 10); } }
  assert.equal(full, 3);
  const t = begin('bus'); assert.equal(t.act('cashout').mult, 1);
});
test('thimbles: one cup in three hides the ball and pays 2.88', () => {
  let hits = 0; for (let s = 1; s <= 600; s++) { const t = begin('thimbles', { seed: s }); assert.equal(t.g.view.ball, null); const r = t.act('pick', { i: 1 }); if (r.mult) { hits++; assert.equal(r.mult, 2.88); assert.equal(t.g.view.ball, 1); } }
  assert.ok(hits > 160 && hits < 240);
});
test('video poker: holds are kept, the rest are replaced, and the paytable is applied', () => {
  assert.equal(T.vpKey(c('A♠ K♠ Q♠ J♠ 10♠')), 'royal'); assert.equal(T.vpKey(c('J♠ J♥ 4♦ 7♣ 2♠')), 'jacks'); assert.equal(T.vpKey(c('10♠ 10♥ 4♦ 7♣ 2♠')), null); assert.equal(T.vpKey(c('2♠ 2♥ 4♦ 4♣ 9♠')), 'twopair');
  assert.equal(T.vpKey(c('A♠ 2♥ 3♦ 4♣ 5♠')), 'straight'); assert.equal(T.vpKey(c('9♥ 8♥ 7♥ 6♥ 5♥')), 'sf');
  const t = begin('videopoker'); const first = t.g.view.cards.map(x => x.r + x.s); t.act('hold', { i: 0 }); t.act('hold', { i: 3 }); t.act('draw');
  const after = t.g.view.cards.map(x => x.r + x.s); assert.equal(after[0], first[0]); assert.equal(after[3], first[3]); assert.equal(new Set([...first, ...after]).size, 8, 'three new cards, none repeated');
  assert.equal(t.g.result.mult, T.vpKey(t.g.view.cards) ? G.effectiveOdds(t.config, t.state, 'videopoker')[T.vpKey(t.g.view.cards)] : 0);
});
test('video poker advice: keep made hands, four to a royal, high pairs, four to a flush, low pairs, then high cards', () => {
  const keep = (s) => T.vpAdvice(c(s)).sort().join('');
  assert.equal(keep('9♥ 8♥ 7♥ 6♥ 5♥'), '01234'); assert.equal(keep('A♠ K♠ Q♠ J♠ 3♦'), '0123'); assert.equal(keep('J♠ J♥ 4♦ 7♣ 2♠'), '01');
  assert.equal(keep('2♠ 9♠ K♠ 5♠ 8♦'), '0123'); assert.equal(keep('4♠ 4♥ K♦ 7♣ 2♠'), '01'); assert.equal(keep('7♠ 7♥ 7♦ K♣ 2♠'), '012'); assert.equal(keep('5♠ 6♥ 7♦ 8♣ K♠'), '0123');
  assert.equal(keep('2♠ 5♥ 9♦ J♣ K♠'), '34'); assert.equal(keep('2♠ 5♥ 9♦ 7♣ 3♠'), '');
});
test('three card poker: fold loses the bet; a dealer below queen-high pays the bet only; the bonus is paid even on a loss', () => {
  const X = EXTRA.threecard, mk = (player, dealer) => { const g = { id: 'threecard', playerId: 'p0', view: { player: c(player), dealer: c(dealer).map(x => ({ ...x, down: true })), revealAt: null }, secret: {}, phase: 'decide' }; return g; };
  const x = { now: 1000, odds: X.odds }, play = (p, d) => X.act(mk(p, d), 'play', {}, x).mult;
  assert.equal(X.act(mk('A♠ K♥ 2♦', 'Q♠ 7♥ 2♣'), 'fold', {}, x).mult, 0);
  assert.equal(play('K♠ 9♥ 2♦', 'J♠ 7♥ 2♣'), 2, 'dealer does not qualify: +1');
  assert.equal(play('K♠ 9♥ 2♦', 'Q♠ 7♥ 2♣'), 3, 'qualifies and loses: +2'); assert.equal(play('J♠ 9♥ 2♦', 'Q♠ 7♥ 2♣'), -1, 'qualifies and wins: −2');
  assert.equal(play('K♠ 9♥ 2♦', 'K♦ 9♣ 2♥'), 1, 'tie pushes');
  assert.equal(play('4♠ 5♥ 6♦', 'J♠ 7♥ 2♣'), 3, 'straight bonus on top of the non-qualifier'); assert.equal(play('7♠ 7♥ 7♦', 'A♠ A♥ 2♣'), 7, 'trips: +2 and 4:1 bonus');
  assert.equal(play('4♠ 5♥ 6♦', '9♠ 9♥ 9♣'), 0, 'lost −2 but kept the 1:1 straight bonus');
  assert.equal(play('4♠ 5♠ 6♠', 'Q♠ 7♥ 2♣'), 8);
});
test('let it ride: three bets start, each pull removes one, the paytable pays every bet still riding', () => {
  assert.equal(T.lirKey(c('10♠ 10♥ 4♦ 7♣ 2♠')), 'tens'); assert.equal(T.lirKey(c('9♠ 9♥ 4♦ 7♣ 2♠')), null); assert.equal(T.lirKey(c('A♠ K♠ Q♠ J♠ 10♠')), 'royal');
  const X = EXTRA.letitride, x = { now: 1000, odds: X.odds }, mk = (p, b) => ({ id: 'letitride', view: { player: c(p), board: c(b).map(q => ({ ...q, down: true })), bets: 3, step: 0, revealAt: null }, secret: {}, phase: 'decide' });
  let g = mk('K♠ K♥ 4♦', '7♣ 2♠'); X.act(g, 'ride', {}, x); assert.equal(g.view.bets, 3); assert.equal(X.act(g, 'ride', {}, x).mult, 4, 'pair of kings, 3 bets at 1:1');
  g = mk('K♠ K♥ 4♦', '7♣ 2♠'); X.act(g, 'pull', {}, x); assert.equal(X.act(g, 'pull', {}, x).mult, 2, 'one bet left');
  g = mk('9♠ 8♥ 4♦', '7♣ 2♠'); X.act(g, 'ride', {}, x); assert.equal(X.act(g, 'ride', {}, x).mult, -2, 'all three lost'); g = mk('9♠ 8♥ 4♦', '7♣ 2♠'); X.act(g, 'pull', {}, x); assert.equal(X.act(g, 'pull', {}, x).mult, 0);
  g = mk('9♠ 9♥ 9♦', '7♣ 2♠'); X.act(g, 'ride', {}, x); assert.equal(X.act(g, 'pull', {}, x).mult, 7, 'trips 3:1 on two bets');
  g = mk('K♠ K♥ 4♦', '7♣ 2♠'); X.act(g, 'ride', {}, x); assert.ok(!g.view.board[0].down && g.view.board[1].down, 'one community card turns at a time');
});
test("casino hold'em: fold loses the bet, a win pays the bet by hand plus the call, a loss costs three", () => {
  const X = EXTRA.holdem, x = { now: 1000, odds: X.odds };
  const mk = (p, d, flop, rest) => ({ id: 'holdem', view: { player: c(p), dealer: c(d).map(q => ({ ...q, down: true })), board: c(flop), revealAt: null }, secret: { deck: c(rest) }, phase: 'decide' });
  assert.equal(X.act(mk('A♠ K♠', '7♦ 2♣', 'Q♥ 9♦ 4♣', '3♠ 8♥'), 'fold', {}, x).mult, 0);
  assert.equal(X.act(mk('A♠ A♥', 'K♦ K♣', 'Q♥ 9♦ 4♣', '3♠ 8♥'), 'call', {}, x).mult, 4, 'dealer qualifies and loses: 1 + 2');
  assert.equal(X.act(mk('A♠ K♥', 'K♦ K♣', 'Q♥ 9♦ 4♣', '3♠ 8♥'), 'call', {}, x).mult, -2, 'lost the bet and the call');
  assert.equal(X.act(mk('A♠ K♥', '7♦ 2♣', 'Q♥ 9♦ 4♣', '3♠ 8♥'), 'call', {}, x).mult, 2, 'dealer has nothing: bet pays, call pushes');
  assert.equal(X.act(mk('A♠ K♥', '3♦ 2♣', 'Q♥ 9♦ 3♣', '5♠ 8♥'), 'call', {}, x).mult, 2, 'a pair of threes does not qualify');
  assert.equal(X.act(mk('A♠ K♥', '4♦ 2♣', 'Q♥ 9♦ 4♣', '5♠ 8♥'), 'call', {}, x).mult, -2, 'a pair of fours does');
  assert.equal(X.act(mk('A♠ 2♠', 'K♦ K♣', 'Q♠ 9♠ 4♠', '3♥ 8♥'), 'call', {}, x).mult, 5, 'flush pays 2:1 on the bet + the call');
  assert.equal(X.act(mk('2♠ 3♥', '2♦ 3♣', 'A♥ K♦ Q♣', 'J♠ 10♥'), 'call', {}, x).mult, 1, 'the board plays for both: push');
});
test('craps: naturals, craps, the point, and odds at true prices', () => {
  const d = (a, b) => [(a - 0.5) / 6, (b - 0.5) / 6], roll = (...rolls) => begin('craps', { rng: fixedRng(rolls.flat()) });
  assert.equal(roll(d(3, 4)).act('roll').mult, 2); assert.equal(roll(d(5, 6)).act('roll').mult, 2);
  for (const [a, b] of [[1, 1], [1, 2], [6, 6]]) assert.equal(roll(d(a, b)).act('roll').mult, 0);
  let t = roll(d(2, 2), d(3, 5), d(1, 3)); t.act('roll'); assert.equal(t.g.view.point, 4); assert.equal(t.act('roll').done, undefined); assert.equal(t.act('roll').mult, 2);
  t = roll(d(2, 2), d(3, 4)); t.act('roll'); assert.equal(t.act('roll').mult, 0, 'seven out with no odds loses the bet');
  t = roll(d(2, 2), d(1, 3)); t.act('roll'); t.act('odds', { n: 2 }); assert.equal(t.act('roll').mult, 6, '1 + 2 units at 2:1');
  t = roll(d(2, 3), d(4, 1)); t.act('roll'); t.act('odds', { n: 2 }); assert.equal(t.act('roll').mult, 5, '5 pays 3:2');
  t = roll(d(3, 3), d(2, 4)); t.act('roll'); t.act('odds', { n: 1 }); assert.equal(t.act('roll').mult, 3.2, '6 pays 6:5');
  t = roll(d(3, 3), d(3, 4)); t.act('roll'); t.act('odds', { n: 2 }); assert.equal(t.act('roll').mult, -2, 'seven out loses the bet and the odds');
  t = roll(d(3, 3)); assert.equal(t.act('odds', { n: 1 }).error, true, 'no odds before there is a point'); t.act('roll'); assert.equal(t.act('odds', { n: 3 }).error, true, 'max 2×');
});
test('pai gow: the house way is always legal, splits must keep the big hand bigger, ties go to the dealer', () => {
  const pick = R.makeRng(3);
  for (let s = 1; s < 400; s++) { const t = begin('paigow', { seed: s }); const v = t.g.view, low = T.pgHouseWay(v.player);
    assert.equal(low.length, 2); assert.ok(T.pgValid(v.player.filter((_, i) => !low.includes(i)), low.map(i => v.player[i]))); }
  assert.equal(T.pgValid(c('A♠ K♥ 9♦ 7♣ 2♠'), c('Q♠ J♥')), true); assert.equal(T.pgValid(c('Q♠ J♥ 9♦ 7♣ 2♠'), c('A♠ K♥')), false, 'the ace has to stay in the big hand');
  assert.equal(T.pgValid(c('A♠ K♥ 9♦ 7♣ 2♠'), c('3♠ 3♥')), false, 'a pair in the small hand needs a pair or better behind it'); assert.equal(T.pgValid(c('9♠ 9♥ K♦ 7♣ 2♠'), c('3♠ 3♥')), true); assert.equal(T.pgValid(c('2♠ 2♥ K♦ 7♣ 5♠'), c('3♠ 3♥')), false);
  const way = (s) => { const cards = c(s), low = T.pgHouseWay(cards); return low.map(i => cards[i].r).sort().join(''); };
  assert.equal(way('A♠ K♥ 9♦ 7♣ 5♠ 3♥ 2♦'), 'K9'.split('').sort().join(''), 'no pair: second and third highest go small');
  assert.equal(way('9♠ 9♥ A♦ K♣ 5♠ 3♥ 2♦'), 'AK', 'one pair: keep it big, best two kickers small');
  const t = begin('paigow'); t.act('toggle', { i: 0 }); t.act('toggle', { i: 1 }); assert.ok(t.g.view.low.length <= 2);
  t.g.view.low = [0]; assert.equal(t.act('confirm').error, true); t.act('auto'); const r = t.act('confirm'); assert.ok([0, 1, 1.95].includes(r.mult));
  const X = EXTRA.paigow, x = { now: 1, odds: X.odds }, mk = (p, d) => ({ id: 'paigow', view: { player: c(p), dealer: c(d).map(q => ({ ...q, down: true })), low: [], revealAt: null }, secret: {}, phase: 'set' });
  const same = mk('A♠ K♥ 9♦ 7♣ 5♠ 3♥ 2♦', 'A♦ K♣ 9♥ 7♠ 5♦ 3♣ 2♥'); X.act(same, 'auto', {}, x); assert.equal(X.act(same, 'confirm', {}, x).mult, 0, 'identical hands: the dealer takes both');
  const win = mk('A♠ A♥ K♦ K♣ 5♠ 3♥ 2♦', 'Q♦ J♣ 9♥ 7♠ 5♦ 3♣ 2♥'); X.act(win, 'auto', {}, x); assert.equal(X.act(win, 'confirm', {}, x).mult, 1.95);
});
test('the shared screen keeps ticking for a moment after every action, so dealt cards and dice actually appear', () => {
  const t = begin('war'); const now = Date.now();
  assert.ok(t.g.view.animUntil > now + 2000); assert.equal(G.gameNeedsTicks(t.g, now), true); assert.equal(G.gameNeedsTicks(t.g, now + 60000), false);
  const b = begin('blackjack'); assert.equal(G.gameNeedsTicks(b.g, Date.now()), true, 'the classic games get the same treatment');
});
