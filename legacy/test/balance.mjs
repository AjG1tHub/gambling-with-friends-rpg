// Balance report: expected return (RTP) of every minigame at the current default odds.
// Exact where the maths is closed-form, simulated otherwise.  node test/balance.mjs
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.BroadcastChannel = class { postMessage() {} addEventListener() {} };
const G = await import('../site/js/games.js');
const { makeRng } = await import('../site/js/rng.js');
const { DEFAULT_CONFIG: C } = await import('../site/js/config-default.js');
const N = Number(process.argv[2] || 200000), rng = makeRng(20261009);
const st = () => ({ players: [{ id: 'p', name: 'T', balances: { Gold: 0 }, heldPowerUps: [], debuffs: [], winMult: null }], ledger: [], oddsOverrides: {} });
const odds = (id) => G.effectiveOdds(C, st(), id);
const rows = [];
const sim = (id, play) => { const s = st(), p = s.players[0]; let ret = 0; for (let i = 0; i < N; i++) { G.startGame(C, s, rng, id, p, [{ amount: 100, cur: 'Gold' }]); ret += play(s, s.game); s.game = null; s.ledger.length = 0; } return ret / N; };
{ const o = odds('fifty'); rows.push(['50/50 Wheel', o.winChance * (1 + o.payout), 'exact']); }
{ const seg = odds('bigwheel').segments; const t = seg.reduce((s, x) => s + x.weight, 0); rows.push(['Big Wheel', seg.reduce((s, x) => s + x.weight * x.mult, 0) / t, 'exact']); }
{ const o = odds('roulette'); rows.push(['Roulette (red/black)', 18 / o.pockets * (1 + o.even), 'exact'], ['Roulette (dozen)', 12 / o.pockets * (1 + o.dozen), 'exact'], ['Roulette (straight)', 1 / o.pockets * (1 + o.straight), 'exact']); }
{ const o = odds('crash'); rows.push(['Crash (any cash-out target)', 1 - o.houseEdge, 'approx']); }
{ const o = odds('mines'); for (const k of [1, 3, 5]) { let pr = 1; for (let i = 0; i < k; i++) pr *= (o.grid - o.mines - i) / (o.grid - i); rows.push([`Mines (stop after ${k})`, pr * G.minesMult(o, k), 'exact']); } }
rows.push(['Blackjack (hit <17, double 10/11)', sim('blackjack', (s, g) => { if (g.phase === 'insurance') G.gameAction(C, s, rng, 'decline'); while (g.phase === 'player') { const h = G.bjActiveHand(g.view), t = G.bjTotal(h.cards); G.gameAction(C, s, rng, h.cards.length === 2 && !t.soft && (t.total === 10 || t.total === 11) ? 'double' : (t.total < 17 || (t.total === 17 && t.soft)) ? 'hit' : 'stand'); } return g.result.mult; }), 'sim']);
for (const side of ['player', 'banker', 'tie']) rows.push([`Baccarat (${side})`, sim('baccarat', (s, g) => { G.gameAction(C, s, rng, 'bet', { side }); G.gameAction(C, s, rng, 'deal'); return g.result.mult; }), 'sim']);
{ const m = G.plinkoMults(odds('plinko')), n = m.length - 1; rows.push(['Plinko', m.reduce((s, x, k) => s + G.binom(n, k) * x, 0) / 2 ** n, 'exact']); }
rows.push(['Hi-Lo (2 likeliest calls, cash out)', sim('hilo', (s, g) => { for (let k = 0; k < 2 && g.phase === 'running'; k++) { const v = G.RANK_VALUE[g.view.cards.at(-1).r]; G.gameAction(C, s, rng, v <= 7 ? 'higher' : 'lower'); } if (g.phase === 'running') G.gameAction(C, s, rng, 'cashout'); return g.result.mult; }), 'sim']);
for (const [dir, t] of [['under', 50], ['over', 90]]) rows.push([`Dice (${dir} ${t})`, G.diceChance(dir, t) / 100 * G.diceMult(odds('dice'), dir, t), 'exact']);
rows.push(['Slots', G.slotsRtp(G.slotsSymbols(odds('slots'))), 'exact']);
{ const R = G.kenoRules(odds('keno')); for (const k of [1, 5, 10]) rows.push([`Keno (${k} pick${k === 1 ? '' : 's'})`, G.kenoRtp(R, k), 'exact']); }
// Plug-in games: closed-form returns where the game reports them, plus a simulation with its "smart" bot.
{ const { EXTRA_LIST } = await import('../site/js/games-extra.js'); const pick = makeRng(77);
  for (const X of EXTRA_LIST) {
    const o = odds(X.id);
    if (X.returns) for (const r of X.returns(o)) rows.push([r.label, r.rtp, 'exact']);
    const sims = Math.min(N, X.id === 'paigow' || X.id === 'holdem' ? 20000 : 60000);
    const s = st(), p = s.players[0]; let ret = 0;
    for (let i = 0; i < sims; i++) { G.startGame(C, s, rng, X.id, p, [{ amount: 100, cur: 'Gold' }]); const g = s.game; let guard = 0;
      while (g.phase !== 'done' && guard++ < 200) { const [a, pl] = X.bot(g, pick, true, G.extraCtx(C, s, rng, g)); G.gameAction(C, s, rng, a, pl); }
      ret += g.result.mult; s.game = null; s.ledger.length = 0; }
    rows.push([`${X.name} (played sensibly)`, ret / sims, `sim ${sims / 1000}k`]);
  } }
// (new games add their rows above this line)
console.log('Game'.padEnd(36), 'Return'.padStart(8), ' Basis');
for (const [name, rtp, basis] of rows) console.log(name.padEnd(36), ((rtp * 100).toFixed(1) + '%').padStart(8), ' ' + basis, rtp > 1.02 ? '  ⚠ player-favourable' : rtp < 0.85 ? '  ⚠ harsh' : '');
