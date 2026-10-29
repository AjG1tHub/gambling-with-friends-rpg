// Stat levers: every one of the 36 moves the measured return the way the spec table promises. Rounds are paired by
// seed (the same dice for the low-stat and the high-stat run), so the difference is the lever, not the noise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVERS, LEVER_IDS, applyLever, leverDelta, afterStartLever, postLever, leverRows } from '../../packages/games/levers.js';
import { startRound, baseOdds } from '../../packages/games/adapter.js';
import { GAME_IDS, makeItem } from '../../packages/games/items.js';
import { slotsRtp, slotsSymbols, minesMult } from '../../packages/games/legacy/games.js';
import { makeRng } from '../../packages/shared/rng.js';
import { B } from '../../packages/shared/balance.js';

const N = B.stats.neutral;
const stats = (v, stat) => ({ luck: N, nerve: N, greed: N, grit: N, [stat]: v });
const begin = (gameId, statValue, seed, extra = {}) => startRound(null, { item: makeItem(null, { gameId, seed }), stake: 10, attacker: { id: 'a', name: 'A', stats: stats(statValue, LEVERS[gameId].stat) }, target: { id: 't', name: 'T', stats: stats(N, 'luck') }, rng: makeRng(seed), now: 1_000_000, ...extra });

// How each game is played so that its lever is exercised (the smart bot where it already does).
const smart = (r, pick) => r.play(pick, true);
const PLAY = {
  roulette: (r) => { r.act('bet', { type: 'red' }); r.act('spin'); }, crash: (r) => r.act('launch', { target: 2 }),
  baccarat: (r) => { r.act('bet', { side: 'tie' }); r.act('deal'); }, dice: (r) => { r.act('bet', { dir: 'under', target: 50 }); r.act('spin'); },
  keno: (r) => { r.act('quick', { count: 5 }); r.act('spin'); }, dragontiger: (r) => r.act('bet', { side: 'tie' }), reddog: (r) => { if (!r.done) r.act('raise'); },
  sicbo: (r) => r.act('bet', { type: 'big' }), underover7: (r) => r.act('bet', { side: 'under' }), colorwheel: (r) => r.act('bet', { color: 'Blue' }),
  race: (r) => r.act('bet', { i: 0 }), pachinko: (r) => r.act('drop'), thimbles: (r) => r.act('pick', { i: 0 }), chuckaluck: (r) => r.act('pick', { n: 4 }),
  deal: (r, pick) => { let g = 0; while (!r.done && g++ < 30) { const [a, p] = r.bot(pick, false); if (a === 'nodeal') r.act('deal'); else r.act(a, p || {}); } },
  war: (r) => { if (!r.done) r.act('war'); },
  hilo: (r) => { let g = 0; while (!r.done && g++ < 20) { const v = r.g.view, rk = v.cards.at(-1).r; if (v.steps >= 3) { r.act('cashout'); break; } r.act(['A', '2', '3', '4', '5', '6', '7'].includes(rk) ? 'higher' : 'lower'); } },
  craps: (r) => { let g = 0; while (!r.done && g++ < 40) { if (r.g.phase === 'point' && !r.g.view.odds) r.act('odds', { n: 2 }); else r.act('roll'); } },
  bus: (r, pick) => { let g = 0; while (!r.done && g++ < 10) { if (r.g.view.cards.length >= 2) { r.act('cashout'); break; } const live = Object.entries(r.g.view.opts).filter(([, m]) => m); r.act('call', { v: live[pick.int(0, live.length - 1)][0] }); } },
  coinstreak: (r, pick) => { let g = 0; while (!r.done && g++ < 10) { if (r.g.view.steps >= 3) { r.act('cashout'); break; } r.act(pick.chance(0.5) ? 'heads' : 'tails'); } },
  letitride: (r) => { while (!r.done) r.act('ride'); },
};
const SIMPLE = ['fifty', 'bigwheel', 'dice', 'underover7', 'chuckaluck', 'sicbo', 'dragontiger', 'limbo', 'crash', 'colorwheel', 'thimbles', 'scratch'];
function measure(gameId, statValue, n, extra = {}) {
  const pick = makeRng(77); let sum = 0;
  for (let i = 0; i < n; i++) { const r = begin(gameId, statValue, 10_000 + i, extra); (PLAY[gameId] || smart)(r, pick); assert.ok(r.done, `${gameId} did not finish at stat ${statValue}`); sum += r.result.mult; }
  return sum / n;
}

test('every one of the 36 games has a lever with a stat, a kind and a rulebook line; the table matches items36.json', async () => {
  assert.deepEqual(LEVER_IDS.sort(), [...GAME_IDS].sort());
  for (const id of GAME_IDS) { const lv = LEVERS[id]; assert.ok(['luck', 'nerve', 'greed', 'grit'].includes(lv.stat), id); assert.ok(['odds', 'post', 'threshold', 'versus'].includes(lv.kind), id); assert.ok(lv.text.length > 10, id); }
  assert.equal(leverRows().length, 36);
  const defs = Object.fromEntries((await import('../../packages/games/items.js')).ITEM_DEFS.map(d => [d.gameId, d]));
  for (const id of GAME_IDS) assert.equal(LEVERS[id].stat, defs[id].stat, `${id} stat`);
});
test('leverDelta pivots on stats.neutral and clamps to the stat range; the neutral stat leaves the odds untouched', () => {
  assert.equal(leverDelta(3), 0); assert.equal(leverDelta(8), 5); assert.equal(leverDelta(1), -2); assert.equal(leverDelta(99), 7); assert.equal(leverDelta(-5), -2); assert.equal(leverDelta(undefined), 0);
  for (const id of GAME_IDS) { if (id === 'chuckaluck') { assert.deepEqual(applyLever(id, N, baseOdds(id), { neutral: N }), { pay3: 3 }, 'Chuck-a-Luck: the legacy table pays 10× for a triple, the spec says 3× at neutral, so this lever runs at d = 0 too'); continue; } assert.deepEqual(applyLever(id, N, baseOdds(id), { neutral: N }), {}, `${id} at neutral`); }
});
test('graded odds levers are symmetric around neutral: +k points bend the table as far as −k points bend it back', () => {
  const o = baseOdds('fifty'); assert.equal(applyLever('fifty', 5, o).winChance, 0.54); assert.equal(applyLever('fifty', 1, o).winChance, 0.46);
  assert.equal(applyLever('blackjack', 6, baseOdds('blackjack')).blackjackPays, 1.8); assert.equal(applyLever('blackjack', 1, baseOdds('blackjack')).blackjackPays, 1.3);
  assert.equal(applyLever('paigow', 8, baseOdds('paigow')).commission, 0); assert.equal(applyLever('paigow', 1, baseOdds('paigow')).commission, 0.08);   // 1.5% a point
  const seg = (v) => Object.fromEntries(applyLever('bigwheel', v, baseOdds('bigwheel')).segments.map(s => [s.label, s.weight]));
  assert.ok(seg(5)['LOSE'] < 18 && seg(5)['1×'] > 24); assert.ok(seg(1)['LOSE'] > 18 && seg(1)['1×'] < 24);
  assert.ok(slotsRtp(slotsSymbols({ ...baseOdds('slots'), ...applyLever('slots', 8, baseOdds('slots')) })) > slotsRtp(slotsSymbols(baseOdds('slots'))));
  assert.ok(slotsRtp(slotsSymbols({ ...baseOdds('slots'), ...applyLever('slots', 1, baseOdds('slots')) })) < slotsRtp(slotsSymbols(baseOdds('slots'))));
  // mines and tower place their traps with the lever but pay as the base table
  assert.equal(applyLever('mines', 5, baseOdds('mines')).mines, 2); assert.equal(applyLever('mines', 1, baseOdds('mines')).mines, 4); assert.deepEqual(afterStartLever('mines', 5, {}, baseOdds('mines')), {});
  const r = begin('mines', 7, 1); assert.equal(r.g.view.minesCount, 1); assert.equal(r.g.secret.mines.length, 1); assert.equal(r.odds().mines, 3, 'pays as a 3-mine field');
  r.act('reveal', { idx: r.g.secret.mines.includes(0) ? 1 : 0 }); assert.equal(r.g.view.mult, minesMult(baseOdds('mines'), 1));
  const t = begin('tower', 6, 1); assert.equal(t.g.view.tiles, 4); assert.equal(t.odds().tiles, 3);
});
test('every lever trims wins below neutral by items.leverPenaltyPerPoint (never below zero profit) and boosts them above by items.leverBonusPerPoint', () => {
  const x = { neutral: N, penalty: B.items.leverPenaltyPerPoint };
  assert.equal(postLever('coinstreak', 1, { mult: 3, label: 'w' }, { view: {} }, x).mult, 1 + 2 * (1 - 0.1));
  assert.equal(postLever('coinstreak', 3, { mult: 3, label: 'w' }, { view: {} }, x).mult, 3);
  assert.equal(postLever('coinstreak', 1, { mult: 0, label: 'l' }, { view: {} }, x).mult, 0);
  assert.equal(postLever('fifty', 1, { mult: 2, label: 'w' }, { view: {} }, x).mult, 1 + 1 * (1 - 0.1), 'every lever kind shares the below-neutral trim');
  assert.equal(postLever('fifty', 10, { mult: 2, label: 'w' }, { view: {} }, { ...x, bonus: B.items.leverBonusPerPoint }).mult, 1 + 1 * (1 + 0.02 * 7), 'and the above-neutral boost (+14% at the cap)');
});
test('the mid-round levers: hilo ties heal at 5 and bust at 1; a first miss is forgiven at Nerve 6 (coin streak, bus)', () => {
  let healed = 0, busted = 0, ties = 0;
  for (let i = 0; i < 400; i++) {
    for (const [v, bucket] of [[5, 'heal'], [1, 'bust']]) {
      const r = begin('hilo', v, 5000 + i); const rk = r.g.view.cards[0].r; const res = r.act(['A', '2', '3', '4', '5', '6', '7'].includes(rk) ? 'higher' : 'lower');
      const top = r.g.view.cards.at(-1), prev = r.g.view.cards.at(-2); if (!prev || top.r !== prev.r) continue; ties++;
      if (bucket === 'heal') { assert.ok(!r.done && r.g.view.steps === 1, `tie healed: ${res.text}`); healed++; } else { assert.ok(r.done && r.result.mult === 0, `tie busted: ${res.text}`); busted++; }
    }
  }
  assert.ok(healed > 5 && busted > 5, `ties seen ${ties}`);
  let forgiven = 0;
  for (let i = 0; i < 300; i++) { const r = begin('coinstreak', 6, 6000 + i); r.act('heads'); if (r.g.view.forgiven) { forgiven++; assert.ok(!r.done); r.act('heads'); if (r.g.view.flips.at(-1).side !== 'heads') assert.ok(r.done && r.result.mult === 0, 'only the first miss is forgiven'); } }
  assert.ok(forgiven > 100, `forgiven ${forgiven}`);
  const low = begin('coinstreak', 3, 6000); low.act('heads'); if (low.g.view.flips[0].side !== 'heads') assert.ok(low.done);
  let busFree = 0; for (let i = 0; i < 300; i++) { const r = begin('bus', 5, 7000 + i); r.act('call', { v: 'red' }); if (r.g.view.forgiven) { busFree++; assert.ok(!r.done && r.g.view.cards.length === 0 && r.g.view.mult === 1); } }
  assert.ok(busFree > 100, `bus first calls forgiven ${busFree}`);
});
test('war: ties go to the higher Grit; thimbles: the hider\'s Nerve pulls against the picker\'s Luck', () => {
  let decided = 0;
  for (let i = 0; i < 400; i++) {
    const hi = startRound(null, { item: makeItem(null, { gameId: 'war', seed: i }), stake: 10, attacker: { id: 'a', stats: stats(8, 'grit') }, target: { id: 't', stats: stats(2, 'grit') }, rng: makeRng(9000 + i), now: 0 });
    const lo = startRound(null, { item: makeItem(null, { gameId: 'war', seed: i }), stake: 10, attacker: { id: 'a', stats: stats(2, 'grit') }, target: { id: 't', stats: stats(8, 'grit') }, rng: makeRng(9000 + i), now: 0 });
    const even = startRound(null, { item: makeItem(null, { gameId: 'war', seed: i }), stake: 10, attacker: { id: 'a', stats: stats(5, 'grit') }, target: { id: 't', stats: stats(5, 'grit') }, rng: makeRng(9000 + i), now: 0 });
    if (even.phase === 'tie') { decided++; assert.ok(hi.done && hi.result.mult > 1, 'tie to the higher Grit (a win, boosted by Grit 8)'); assert.ok(lo.done && lo.result.mult === 0); }
  }
  assert.ok(decided > 10, `ties ${decided}`);
  const n = 3000, pick = makeRng(1); let picker = 0, hider = 0;
  for (let i = 0; i < n; i++) {
    const a = startRound(null, { item: makeItem(null, { gameId: 'thimbles', seed: i }), stake: 10, attacker: { id: 'a', stats: stats(9, 'luck') }, target: { id: 't', stats: stats(N, 'nerve') }, rng: makeRng(8000 + i), now: 0 }); a.act('pick', { i: 0 }); picker += a.result.mult;
    const b = startRound(null, { item: makeItem(null, { gameId: 'thimbles', seed: i }), stake: 10, attacker: { id: 'a', stats: stats(N, 'luck') }, target: { id: 't', stats: stats(9, 'nerve') }, rng: makeRng(8000 + i), now: 0 }); b.act('pick', { i: 0 }); hider += b.result.mult;
  }
  assert.ok(picker / n > hider / n + 0.1, `picker ${(picker / n).toFixed(3)} vs hider ${(hider / n).toFixed(3)}`);
});

for (const id of GAME_IDS) {
  const n = SIMPLE.includes(id) ? 5000 : 1500;
  test(`${id}: ${LEVERS[id].stat} at ${B.stats.max} returns more than ${LEVERS[id].stat} at ${B.stats.min} over ${n} paired rounds (${LEVERS[id].text})`, () => {
    const lo = measure(id, B.stats.min, n), hi = measure(id, B.stats.max, n), mid = measure(id, N, Math.min(n, 1000));
    assert.ok(hi > lo + 0.004, `${id}: low ${(lo * 100).toFixed(2)}% · neutral ${(mid * 100).toFixed(2)}% · high ${(hi * 100).toFixed(2)}%`);
  });
}
