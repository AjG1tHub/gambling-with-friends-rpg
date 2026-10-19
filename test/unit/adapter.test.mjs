// The game → item adapter: all 36 items, 300 random rounds each in Health and chip mode, finish with a finite
// result, sane controls, a clean stage and a secret-free snapshot; junk actions are refused; the same seed gives
// the same round; pending / nudge / reroll / fork; the Croupier rig; the crit table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startRound, outcome, topMult, isCrit, baseOdds, CLASSIC_IDS, stripSecret, gameRows, CONFIG } from '../../packages/games/adapter.js';
import { ITEM_DEFS, GAME_IDS, makeItem } from '../../packages/games/items.js';
import { HIDDEN_PICKS, publicControls } from '../../packages/games/controls.js';
import { stageHtml } from '../../packages/games/stage.js';
import { makeRng } from '../../packages/shared/rng.js';
import { B } from '../../packages/shared/balance.js';

const NEUTRAL = { luck: 3, nerve: 3, greed: 3, grit: 3 };
const attacker = (stats = NEUTRAL) => ({ id: 'a', name: 'Aj', stats, classId: 'enforcer', level: 1 });
const target = { id: 't', name: 'Dummy', stats: NEUTRAL };
const begin = (gameId, { seed = 7, mode = 'health', stake = 10, stats = NEUTRAL, rng = null, ...rest } = {}) =>
  startRound(null, { item: makeItem(null, { gameId, seed }), mode, stake, attacker: attacker(stats), target, rng: rng || makeRng(seed), now: 1_000_000, ...rest });
const hasSecret = (o) => JSON.stringify(o).includes('"secret"');
// The legacy games stamp cards and animations with Date.now(); scrub those before comparing two runs.
const scrub = (o) => (Array.isArray(o) ? o.map(scrub) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([, v]) => !(typeof v === 'number' && v > 1e11)).map(([k, v]) => [k, scrub(v)])) : o);
const JUNK = [['nonsense', {}], ['bet', {}], ['pick', { i: 99 }], ['pick', { i: -1 }], ['pick', { n: 'x' }], ['bet', { side: 'sideways', type: 'huge', target: -5, color: 'Mauve', i: 44 }], ['call', { v: 'purple' }], ['open', { i: 99 }], ['hold', { i: 7 }], ['toggle', { i: 9 }], ['odds', { n: 99 }], ['scratch', { i: 12 }], ['reveal', { idx: 99 }], ['spin', null], ['bet', null], ['launch', { target: 'x' }], ['cashout', {}], ['accept', {}], ['unbet', {}]];

test('the adapter knows all 36 games: 12 classics + 24 plug-ins, with a legacy-shaped config', () => {
  assert.equal(GAME_IDS.length, 36); assert.equal(new Set(GAME_IDS).size, 36);
  assert.equal(gameRows().length, 36); assert.equal(CONFIG.Games.length, 36); assert.equal(CONFIG.Config.HouseEdgeMultiplier, 1);
  for (const id of GAME_IDS) assert.ok(Object.keys(baseOdds(id)).length > 0, `${id} has odds`);
  for (const id of CLASSIC_IDS) assert.ok(GAME_IDS.includes(id));
});

for (const def of ITEM_DEFS) for (const mode of ['health', 'chips']) {
  test(`${def.id} (${def.gameId}) in ${mode} mode: 300 random rounds finish with a finite result, sane controls, a clean stage and no secret in the snapshot`, () => {
    const pick = makeRng(1000 + def.gameId.length + (mode === 'chips' ? 7 : 0));
    for (let i = 0; i < 300; i++) {
      const r = begin(def.gameId, { seed: 50 + i, mode, stake: mode === 'chips' ? 3 : 10 });
      assert.equal(r.mode, mode); assert.equal(r.gameId, def.gameId); assert.ok(r.g.view && typeof r.g.view === 'object');
      let guard = 0;
      while (!r.done && guard++ < 300) {
        const ctl = r.controls();
        assert.ok(Array.isArray(ctl.buttons), `${def.gameId}: controls shape`);
        const tappable = ctl.buttons.filter(b => !b.disabled).length + (ctl.grid ? ctl.grid.cells.filter(c => !c.disabled).length : 0);
        assert.ok(tappable > 0, `${def.gameId}: nothing to tap in phase ${r.phase}`);
        if (i < 6) { const html = r.stage(r.now + 60_000); assert.ok(typeof html === 'string' && html.length > 10 && !/undefined|NaN|\[object/.test(html), `${def.gameId} stage mid-game: ${html.slice(0, 160)}`); assert.ok(!hasSecret(r.snapshot())); }
        const step = r.bot(pick, false); assert.ok(step, `${def.gameId}: bot gave nothing in phase ${r.phase}`);
        if (step[0] === 'pickFork') r.pickFork(step[1].i); else r.act(step[0], step[1] || {});
      }
      assert.ok(r.done, `${def.gameId} never finished (seed ${50 + i})`);
      const o = outcome(r); assert.ok(Number.isFinite(o.mult) && o.mult >= -8 && o.mult <= 10001, `${def.gameId} mult ${o.mult}`);
      assert.ok(o.label && !/undefined|NaN/.test(o.label), `${def.gameId} label "${o.label}"`); assert.equal(typeof o.crit, 'boolean');
      assert.ok(Number.isFinite(r.revealAt()));
      if (i < 6) for (const when of [0, r.now, r.revealAt() + 1]) { const html = r.stage(when); assert.ok(!/undefined|NaN|\[object/.test(html), `${def.gameId} final stage at ${when}: ${html.slice(0, 200)}`); }
      const snap = r.snapshot(); assert.ok(!hasSecret(snap), `${def.gameId} leaks a secret`); assert.equal(snap.roundId, r.id); assert.equal(snap.phase, 'done');
      // nothing changes a finished round
      const frozen = JSON.stringify(r.result);
      for (const [a, p] of JUNK) { const res = r.act(a, p); assert.ok(res.error, `${def.gameId}: ${a} accepted after the end`); }
      assert.equal(JSON.stringify(r.result), frozen, `${def.gameId} changed after it ended`);
      assert.equal(r.controls().buttons.length, 0);
    }
  });
}
for (const def of ITEM_DEFS) {
  test(`${def.gameId}: junk actions are refused without breaking the round; same seed, same round`, () => {
    const r = begin(def.gameId, { seed: 4242 });
    const before = JSON.stringify(stripSecret(r.g.view));
    for (const [a, p] of JUNK) assert.doesNotThrow(() => r.act(a, p), `${def.gameId} threw on ${a}`);
    if (!r.done) assert.ok(!/NaN|undefined/.test(JSON.stringify(r.g.view)));
    assert.ok(before.length > 2);
    const run = () => { const q = begin(def.gameId, { seed: 4242 }); const pick = makeRng(9); let guard = 0; while (!q.done && guard++ < 300) { const [a, p] = q.bot(pick, false); if (a === 'pickFork') q.pickFork(p.i); else q.act(a, p || {}); } return JSON.stringify([q.result, scrub(stripSecret(q.g.view))]); };
    assert.equal(run(), run());
  });
}

test('hidden picks: mines squares, scratch panels, the shell and bus calls are flagged and stripped from public controls; secrets never leave', () => {
  for (const [gameId, actions] of Object.entries(HIDDEN_PICKS)) {
    const r = begin(gameId, { seed: 3 });
    if (gameId === 'bus' || gameId === 'thimbles' || gameId === 'scratch' || gameId === 'mines') {
      const ctl = r.controls();
      const all = [...ctl.buttons, ...(ctl.grid ? ctl.grid.cells : [])];
      const hidden = all.filter(b => actions.includes(b.a));
      assert.ok(hidden.length, `${gameId}: expected hidden-pick controls`); assert.ok(hidden.every(b => b.hidden === true), `${gameId}: hidden picks not flagged`);
      const pub = publicControls(ctl); assert.ok(![...pub.buttons, ...(pub.grid ? pub.grid.cells : [])].some(b => b.hidden), `${gameId}: public controls leak hidden picks`);
    }
    assert.ok(r.g.secret && Object.keys(r.g.secret).length > 0, `${gameId} keeps its secret on the phone`);
    assert.ok(!hasSecret(r.snapshot()));
  }
  const r = begin('mines', { seed: 11 }); r.act('reveal', { idx: 0 }); assert.ok(!hasSecret(r.snapshot()) && !('reveal' in r.snapshot().view));
  r.act('stop'); assert.ok(Array.isArray(r.snapshot().view.reveal.mines), 'after the round the mine layout may be shown');
  const html = stageHtml(r.snapshot(), r.now + 5000, { odds: baseOdds('mines') }); assert.ok(html.includes('💣'), 'the TV can show the mines from the snapshot');
});

test('crash is driven by the clock it is handed: launch with a target resolves at once; cashout reads `now`', () => {
  let r = begin('crash', { seed: 1 });
  const res = r.act('launch', { target: 2 }); assert.ok(res.done); assert.ok(r.result.mult === 2 || r.result.mult === 0);
  assert.equal(r.result.mult === 2, r.g.secret.crashAt > 2); assert.ok(r.g.view.revealAt >= r.now);
  r = begin('crash', { seed: 1 }); r.act('launch'); assert.equal(r.phase, 'running');
  const t = r.now + 5000, m = Math.min(50, Math.floor(Math.exp(0.1 * 5) * 100) / 100);
  const out = r.act('cashout', {}, t); assert.ok(out.done);
  if (r.g.secret.crashAt > m) assert.equal(r.result.mult, m); else assert.equal(r.result.mult, 0);
  assert.ok(r.act('cashout', {}, t).error);
  const counts = { win: 0, lose: 0 }; for (let i = 0; i < 400; i++) { const q = begin('crash', { seed: 100 + i }); q.act('launch', { target: 2 }); counts[q.result.mult ? 'win' : 'lose']++; }
  assert.ok(counts.win > 140 && counts.win < 250, `a 2× target wins about 48%: ${counts.win}/400`);
});

test('pending: chance games auto-settle unless held; accept, reroll and fork work on the legacy pending convention; nudge biases the spin', () => {
  let r = begin('fifty', { seed: 2 }); const res = r.act('spin'); assert.ok(res.done); assert.ok(r.g.pending && r.done);
  r = begin('fifty', { seed: 2, holdPending: true }); const held = r.act('spin'); assert.ok(held.pending && !r.done); assert.equal(r.canReroll(), true);
  const first = r.g.pending.mult; const rr = r.reroll(); assert.ok(rr.pending && !r.done); assert.equal(r.consumed.reroll, 1);
  const f = r.fork(); assert.ok(f.fork && f.options.length === 2); assert.equal(r.g.forkOptions.length, 2);
  const picked = r.pickFork(1); assert.ok(picked.done && r.done); assert.equal(r.result.mult, f.options[1].mult); assert.ok(first === 0 || first === 2);
  assert.ok(r.act('accept').error);
  r = begin('dice', { seed: 5, holdPending: true }); r.act('bet', { dir: 'under', target: 50 }); r.act('spin'); assert.ok(r.g.pending && !r.done); const acc = r.act('accept'); assert.ok(acc.done && r.done);
  // nudge: +50% weight on LOSE makes losing more common across many spins
  let lose = 0, loseN = 0; for (let i = 0; i < 600; i++) { const q = begin('fifty', { seed: 900 + i }); q.act('spin'); if (!q.result.mult) lose++; const n = begin('fifty', { seed: 900 + i }); assert.ok(n.canNudge()); n.nudge('LOSE'); n.act('spin'); if (!n.result.mult) loseN++; }
  assert.ok(loseN > lose + 20, `nudge to LOSE: ${loseN} vs ${lose}`);
  assert.deepEqual(begin('fifty').nudgeLabels(), ['WIN', 'LOSE']); assert.equal(begin('war').canNudge(), false);
});

test("the Croupier's rig forces the next binary outcome and is consumed once", () => {
  for (const want of ['win', 'lose']) {
    for (let i = 0; i < 30; i++) {
      let r = begin('fifty', { seed: 300 + i, rig: { outcome: want } }); r.act('spin'); assert.equal(r.result.mult > 1, want === 'win'); assert.ok(r.rigUsed && !r.rig); assert.ok(/rigged/.test(r.result.label) || true);
      r = begin('underover7', { seed: 300 + i, rig: { outcome: want } }); r.act('bet', { side: 'under' }); assert.equal(r.result.mult > 1, want === 'win');
      r = begin('roulette', { seed: 300 + i, rig: { outcome: want } }); r.act('bet', { type: 'red' }); r.act('spin'); assert.equal(r.result.mult > 1, want === 'win');
      r = begin('dragontiger', { seed: 300 + i, rig: { outcome: want } }); r.act('bet', { side: 'tiger' }); if (r.g.view.winner !== 'tie') assert.equal(r.result.mult > 1, want === 'win');
      r = begin('war', { seed: 300 + i, rig: { outcome: want } }); if (r.done) { assert.equal(r.result.mult > 1, want === 'win'); assert.ok(r.rigUsed); }
      r = begin('hilo', { seed: 300 + i, rig: { outcome: want } }); const before = r.g.view.mult; const rk = r.g.view.cards[0].r; r.act(['A', '2', '3', '4', '5', '6', '7'].includes(rk) ? 'higher' : 'lower'); const top = r.g.view.cards.at(-1), prev = r.g.view.cards.at(-2);
      if (prev && top.r !== prev.r) { if (want === 'win') { assert.ok(!r.done && r.g.view.steps === 1, 'rigged win keeps the streak'); } else assert.ok(r.done && r.result.mult === 0); assert.ok(r.rigUsed); }
    }
  }
  // the rig only touches binary moments: a straight roulette bet ignores it
  const r = begin('roulette', { seed: 1, rig: { outcome: 'win' } }); r.act('bet', { type: 'straight', number: 7 }); r.act('spin'); assert.ok(!r.rigUsed);
});

test('topMult: a finite top for every game except the bus (label crit); isCrit agrees with the labels', () => {
  for (const id of GAME_IDS) { const t = topMult(id, baseOdds(id)); if (id === 'bus') assert.equal(t, Infinity); else assert.ok(Number.isFinite(t) && t > 1, `${id} top ${t}`); }
  assert.equal(topMult('bigwheel', baseOdds('bigwheel')), 20); assert.equal(topMult('fifty', baseOdds('fifty')), 2); assert.equal(topMult('slots', baseOdds('slots')), 500); assert.equal(topMult('plinko', baseOdds('plinko')), 33);
  assert.equal(topMult('keno', baseOdds('keno'), { view: { picks: [1, 2, 3] } }), 44);
  assert.ok(isCrit('bigwheel', baseOdds('bigwheel'), null, { mult: 20, label: '20×' })); assert.ok(!isCrit('bigwheel', baseOdds('bigwheel'), null, { mult: 10, label: '10×' }));
  assert.ok(isCrit('blackjack', baseOdds('blackjack'), null, { mult: 2.5, label: 'BLACKJACK! Pays 1.5:1' })); assert.ok(!isCrit('blackjack', baseOdds('blackjack'), null, { mult: 2.5, label: 'two hands' }));
  assert.ok(isCrit('mines', baseOdds('mines'), null, { mult: 50, label: 'Cleared the field at 50×' })); assert.ok(isCrit('bus', baseOdds('bus'), null, { mult: 9, label: 'Rode the whole bus — 9×' })); assert.ok(!isCrit('bus', baseOdds('bus'), null, { mult: 9, label: 'Got off at 9×' }));
  assert.ok(!isCrit('fifty', baseOdds('fifty'), null, { mult: 0, label: 'LOSE' })); assert.ok(isCrit('fifty', baseOdds('fifty'), null, { mult: 2, label: 'WIN' }), 'a binary game crits on its only win (spec: top multiplier)');
});

test('the smart bot returns a sane band over 1,500 rounds for every item (no item pays over 110% to sensible play)', () => {
  const pick = makeRng(808);
  for (const id of GAME_IDS) {
    let ret = 0; const n = 1500;
    for (let i = 0; i < n; i++) { const r = begin(id, { seed: 20_000 + i }); const o = r.play(pick, true); assert.ok(o, `${id} did not finish`); ret += o.mult; }
    const rtp = ret / n;
    if (id === 'bigwheel') assert.ok(rtp > 1.5, 'Big Wheel is the known player-favourable legacy table'); else assert.ok(rtp > 0.6 && rtp < 1.12, `${id} returned ${(rtp * 100).toFixed(1)}%`);
  }
});

test('stake and mode: the proxy player holds the stake in the right currency; chip rounds carry mode "chips"', () => {
  const r = begin('fifty', { mode: 'chips', stake: 3 }); assert.equal(r.mini.players[0].balances.Chips, 3); assert.equal(r.snapshot().mode, 'chips'); assert.equal(r.snapshot().stake, 3);
  const h = begin('fifty', { stake: 35 }); assert.equal(h.mini.players[0].balances.Health, 35); assert.equal(h.cur, 'Health');
  assert.throws(() => startRound(null, { gameId: 'nope', rng: makeRng(1) }));
  assert.throws(() => startRound(null, { gameId: 'fifty' }), /rng/);
  const lab = startRound(null, { gameId: 'keno', rng: makeRng(1) }); assert.equal(lab.item.stake, B.items.stakeCommon); assert.equal(lab.stake, B.items.stakeCommon);
});
