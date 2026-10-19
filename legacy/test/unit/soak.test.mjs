// Loop 29 — bot-played sessions. The bot (test/bot.mjs) clicks through whole nights at random and checks
// the invariants after every action; these are the short runs. `node test/soak.mjs 60 500` is the long one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, E, mkGame, fixedRng } from './_helpers.mjs';
const { playSession, checkInvariants } = await import('../bot.mjs');

test('soak: 10 seeded sessions (2–6 players, 120 turns each) hold every invariant after every action', () => {
  let actions = 0; const seen = {};
  for (let seed = 1; seed <= 10; seed++) {
    const r = playSession({ seed: seed * 104729, players: 2 + (seed % 5), turns: 120, sideChance: 0.2 + (seed % 3) * 0.2 });
    actions += r.actions; for (const [k, v] of Object.entries(r.counts)) seen[k] = (seen[k] || 0) + v;
    assert.equal(r.state.phase, 'ended');
    assert.equal(r.stats.totals.turns, 120);
  }
  assert.ok(actions > 3000, `only ${actions} actions`);
  for (const k of ['turn', 'move', 'wheel', 'tile', 'game', 'jail', 'side', 'battle', 'shop']) assert.ok(seen[k] > 0, `the bot never exercised "${k}"`);
});
test('soak: the same seed plays the same night (balances, positions, pets, ledger length)', () => {
  const sig = (r) => JSON.stringify(r.state.players.map(p => [p.balances, p.pos, p.jailTier, p.power, (p.pets || []).map(x => [x.speciesId, x.level])])) + r.ledgerRows;
  const a = playSession({ seed: 424242, players: 4, turns: 80 }), b = playSession({ seed: 424242, players: 4, turns: 80 });
  assert.equal(sig(a), sig(b));
  assert.notEqual(sig(a), sig(playSession({ seed: 424243, players: 4, turns: 80 })));
});
test('soak: survives hostile configs — tiny board, no Void, harsh odds, pets off, everything negative', () => {
  const tweaks = [
    (c) => { c.Board = { cols: 3, rows: 2, tileCounts: { GAME: 2, GOOD: 1, BAD: 1, JAIL: 1, START: 1 }, colorWeights: { Red: 1, Blue: 1 }, pins: {} }; },
    (c) => { c.Config.VoidEnabled = false; c.Config.MinBet = 1; c.Config.StartingBank = 0; },
    (c) => { c.Config.VoidChance = 1; },
    (c) => { c.Pets.enabled = false; c.Loans.enabled = false; },
    (c) => { c.Games.forEach(g => { if (g.id !== 'placeholder') g.built = false; }); },
    (c) => { c.Wheel_Bad = c.Wheel_Bad.filter(r => ['GO_TO_JAIL', 'COLLECTOR', 'PCT_GOLD'].includes(r.verb)); c.Board.tileCounts = { GAME: 5, GOOD: 0, BAD: 30, JAIL: 2, SHOP: 2, START: 1 }; },
    (c) => { c.Wheel_Good = c.Wheel_Good.filter(r => ['EGG_GRANT', 'POWER_DELTA', 'TELEPORT_CHOICE', 'SPIN_METHOD_AGAIN'].includes(r.verb)); c.Board.tileCounts = { GAME: 5, GOOD: 30, BAD: 0, JAIL: 2, SHOP: 2, START: 1 }; },
    (c) => { c.Wheel_Method = c.Wheel_Method.filter(r => ['MOVE_CANDY', 'MOVE_LONGWALK', 'MOVE_SWAP', 'MOVE_BENEV'].includes(r.verb)); },
    (c) => { c.Config.HouseEdgeMultiplier = 3; c.Currencies = c.Currencies.slice(0, 2); },
  ];
  tweaks.forEach((tweak, i) => { const r = playSession({ seed: 9000 + i, players: 3, turns: 80, tweak, sideChance: 0.3 }); assert.equal(r.state.phase, 'ended', `tweak ${i}`); });
});
test('soak: one player alone, and a crowded table of eight', () => {
  assert.equal(playSession({ seed: 5, players: 1, turns: 60 }).state.phase, 'ended');
  assert.equal(playSession({ seed: 6, players: 8, turns: 160 }).state.phase, 'ended');
});
test('soak: a long night stays within the ledger cap and remembers how many rows fell off', () => {
  const r = playSession({ seed: 77, players: 4, turns: 900, checkEvery: 25 });
  assert.ok(r.ledgerRows > S.LEDGER_MAX, `only ${r.ledgerRows} rows — raise the turn count`);
  assert.ok(r.state.ledger.length <= S.LEDGER_MAX);
  assert.equal(r.state.ledgerDropped + r.state.ledger.length, r.ledgerRows);
  assert.ok(JSON.stringify(r.state).length < 2_000_000, 'the saved game stays under 2 MB');
});
test('the invariant checker itself notices trouble', () => {
  const mk = () => { const g = mkGame(['A', 'B']); const book = { open: new Map(g.state.players.map(p => [p.id + '|Gold', 500])), sum: new Map(), seenN: 0 }; return { ...g, book }; };
  { const { config, state, book } = mk(); assert.doesNotThrow(() => checkInvariants(config, state, book, 't')); }
  { const { config, state, book, p } = mk(); p.balances.Gold += 5; assert.throws(() => checkInvariants(config, state, book, 't'), /ledger adds up/); }
  { const { config, state, book, p } = mk(); p.pos = 99; assert.throws(() => checkInvariants(config, state, book, 't'), /off the board/); }
  { const { config, state, book, p } = mk(); p.power = NaN; assert.throws(() => checkInvariants(config, state, book, 't'), /non-finite/); }
  { const { config, state, book, p } = mk(); p.balances.Gems = -3; assert.throws(() => checkInvariants(config, state, book, 't'), /cannot go negative/); }
});
// ── regressions for what the soak found ─────────────────────────────────────────────────────────
test('found by soak: taking more of a secondary than a player holds logs what actually moved', () => {
  const { state, p } = mkGame();
  S.credit(state, p, 'Gems', 3, 'gift'); S.credit(state, p, 'Gems', -10, 'Dropped It');
  assert.equal(p.balances.Gems, 0);
  const row = state.ledger.at(-1);
  assert.equal(row.type, 'DEBIT'); assert.equal(row.amount, -3); assert.equal(row.asked, -10);
  const sum = state.ledger.filter(r => r.cur === 'Gems').reduce((s, r) => s + r.amount, 0);
  assert.equal(sum, p.balances.Gems);
  S.credit(state, p, 'Gold', -9999, 'ruin'); assert.equal(state.ledger.at(-1).amount, -9999); assert.ok(!('asked' in state.ledger.at(-1)));
});
test('found by soak: Candy Land cannot walk forever when the colour is not on the board', () => {
  const { config, state, p } = mkGame(['A', 'B'], 3, (c) => { c.Config.VoidEnabled = false; });
  state.board.forEach(t => { if (t.color === 'Black') t.color = 'Red'; });
  p.pos = 0;
  E.beginMove(config, state, fixedRng([0.999]), config.Wheel_Method.find(m => m.verb === 'MOVE_CANDY'));   // last colour row = DOUBLE Black
  assert.equal(state.move.candy.color, 'Black');
  let steps = 0, r;
  do { r = E.stepMove(config, state, fixedRng([0.99]), 'E', { override: true }); steps++; } while (!state.move.done && steps < 500);
  assert.equal(state.move.done, true); assert.equal(steps, state.board.length * 2);
  assert.match(r.msg, /No Black tile/);
});
test('found by soak: Candy Land still stops on the first matching tile as before', () => {
  const { config, state, p } = mkGame(['A', 'B'], 3, (c) => { c.Config.VoidEnabled = false; });
  state.board.forEach((t, i) => { t.color = i === 3 ? 'Red' : 'Blue'; }); p.pos = 0;
  E.beginMove(config, state, fixedRng([0]), config.Wheel_Method.find(m => m.verb === 'MOVE_CANDY'));        // first colour row = Red
  E.stepMove(config, state, fixedRng([0.99]), 'E'); E.stepMove(config, state, fixedRng([0.99]), 'E');
  const r = E.stepMove(config, state, fixedRng([0.99]), 'E');
  assert.equal(r.arrived, true); assert.equal(p.pos, 3);
});
test('found by soak: the ledger cap drops the oldest rows and counts them', () => {
  const { state } = mkGame();
  for (let i = 0; i < S.LEDGER_MAX + 25; i++) S.log(state, 'X', null, {});
  assert.equal(state.ledger.length, S.LEDGER_MAX); assert.equal(state.ledgerDropped, 25);
  assert.equal(state.ledger[0].n, 26); assert.equal(state.ledger.at(-1).n, S.LEDGER_MAX + 25);
});
