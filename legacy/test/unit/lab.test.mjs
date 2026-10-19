// Game Lab logic: the catalogue, the sandbox, when a round may be settled, and the tick-list / report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, G, R, DEFAULT_CONFIG } from './_helpers.mjs';
const L = await import('../../site/js/lab-core.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m }; };
const cat = L.labCatalog(DEFAULT_CONFIG), order = L.labOrder(cat);

test('the menu lists all 36 games in four groups, classics first, with no hidden GM Call', () => {
  assert.deepEqual(cat.map(g => [g.label, g.games.length]), [['Classics', 12], ['Quick games', 10], ['Show games', 8], ['Table games', 6]]);
  assert.equal(order.length, 36); assert.equal(new Set(order).size, 36); assert.ok(!order.includes('placeholder')); assert.equal(order[0], 'fifty');
  for (const g of cat.flatMap(x => x.games)) assert.ok(g.name && g.icon);
});
test('switched-off games drop off the menu; unknown built games land under Other', () => {
  const cfg = structuredClone(DEFAULT_CONFIG); cfg.Games.find(g => g.id === 'keno').built = false; cfg.Games.push({ id: 'poker', name: 'Poker', built: true });
  const c2 = L.labCatalog(cfg); assert.ok(!L.labOrder(c2).includes('keno')); assert.deepEqual(c2.at(-1), { label: 'Other', games: [{ id: 'poker', name: 'Poker', icon: '🎲' }] });
});
test('next / previous wrap around, and work before anything is open', () => {
  assert.equal(L.stepId(order, null, 1), order[0]); assert.equal(L.stepId(order, null, -1), order.at(-1));
  assert.equal(L.stepId(order, order[0], 1), order[1]); assert.equal(L.stepId(order, order.at(-1), 1), order[0]); assert.equal(L.stepId(order, order[0], -1), order.at(-1));
  assert.equal(L.stepId([], 'x', 1), null);
});
test('the sandbox is one tester with a big bankroll, marked as a lab table', () => {
  const st = L.newLabState(DEFAULT_CONFIG, 5);
  assert.equal(st.players.length, 1); assert.equal(st.players[0].balances.Gold, L.LAB_BANK); assert.equal(st.lab, true); assert.equal(st.phase, 'playing');
  assert.equal(S.currentPlayer(st).id, 'tester');
});
test('every game on the menu can be started in the sandbox', () => {
  const st = L.newLabState(DEFAULT_CONFIG, 9), rng = R.makeRng(9);
  for (const id of order) { G.startGame(DEFAULT_CONFIG, st, rng, id, st.players[0], [{ amount: 100, cur: 'Gold' }]); assert.equal(st.game.id, id); st.game = null; }
});
test('a round is ready to settle only when it has a result and nothing is still moving', () => {
  const st = L.newLabState(DEFAULT_CONFIG, 3), now = 10_000;
  assert.equal(L.readyToSettle(st, 0, now), false, 'no game');
  st.game = { id: 'x', phase: 'running', view: {}, result: null, pending: null }; assert.equal(L.readyToSettle(st, 0, now), false, 'no result yet');
  st.game = { id: 'x', phase: 'done', view: { revealAt: now + 500 }, result: { mult: 2, label: 'w' } }; assert.equal(L.readyToSettle(st, 0, now), false, 'still revealing');
  assert.equal(L.readyToSettle(st, 0, now + 500), true);
  st.game = { id: 'fifty', phase: 'ready', view: {}, pending: { mult: 0, label: 'LOSE' } }; st.lastSpin = { ts: now - 1000 };
  assert.equal(L.readyToSettle(st, now - 2000, now), false, 'the wheel is still spinning'); assert.equal(L.readyToSettle(st, now - 2000, now - 1000 + L.WHEEL_MS), true);
  assert.equal(L.readyToSettle(st, now, now), true, 'a wheel from an earlier round does not hold this one up');
  st.game.forkOptions = [{}, {}]; assert.equal(L.readyToSettle(st, now, now + 99999), false, 'a Fork waits for the tester to choose');
  st.game = { id: 'x', phase: 'decide', view: {}, result: { mult: 1, label: '' } }; assert.equal(L.readyToSettle(st, now, now), false);
});
test('outcomeOf prefers a final result, then a pending wheel result', () => {
  assert.equal(L.outcomeOf(null), null); assert.equal(L.outcomeOf({}), null);
  assert.deepEqual(L.outcomeOf({ pending: { mult: 3 } }), { mult: 3 }); assert.deepEqual(L.outcomeOf({ result: { mult: 0 }, pending: { mult: 3 } }), { mult: 0 });
});
test('ticks, notes and play counts are kept per game and survive a reload', () => {
  const st = mem(); let m = L.loadMarks(st); assert.deepEqual(m, {});
  L.setStatus(m, 'tower', 'ok'); L.setNote(m, 'tower', 'doors too small'); L.recordPlay(m, 'tower', 100, 2.18); L.recordPlay(m, 'tower', 100, 0); L.setStatus(m, 'war', 'bad');
  assert.equal(L.saveMarks(st, m), true);
  m = L.loadMarks(st); assert.equal(m.tower.status, 'ok'); assert.equal(m.tower.note, 'doors too small'); assert.equal(m.tower.plays, 2); assert.equal(m.war.status, 'bad');
  assert.equal(L.statsLine(m, 'tower'), '2 rounds · staked 200 · net +18 · returned 109%'); assert.equal(L.statsLine(m, 'keno'), 'Not played yet.');
  L.setStatus(m, 'tower', 'whatever'); assert.equal(m.tower.status, '', 'only ok / bad / blank');
  L.setNote(m, 'x', 'y'.repeat(5000)); assert.equal(m.x.note.length, 2000);
});
test('corrupt or blocked storage degrades to an empty tick-list instead of crashing', () => {
  const bad = mem(); bad.m.set(L.LAB_KEY, '{{{'); assert.deepEqual(L.loadMarks(bad), {});
  const arr = mem(); arr.m.set(L.LAB_KEY, '[1,2]'); assert.deepEqual(L.loadMarks(arr), {});
  assert.deepEqual(L.loadMarks({ getItem() { throw new Error('blocked'); } }), {});
  assert.equal(L.saveMarks({ setItem() { throw new Error('full'); } }, {}), false);
});
test('progress counts what is checked, what has problems and what has been played', () => {
  const m = {}; assert.equal(L.progress(cat, m).text, '0 of 36 checked · 0 played');
  L.setStatus(m, 'fifty', 'ok'); L.setStatus(m, 'war', 'bad'); L.recordPlay(m, 'tower', 100, 1); L.setStatus(m, 'not-a-game', 'ok');
  const p = L.progress(cat, m); assert.deepEqual([p.ok, p.bad, p.played, p.left, p.total], [1, 1, 1, 34, 36]); assert.equal(p.text, '2 of 36 checked · 1 with problems · 1 played');
});
test('the report lists every game with its status and note, ready to paste', () => {
  const m = {}; L.setStatus(m, 'fifty', 'ok'); L.setStatus(m, 'war', 'bad'); L.setNote(m, 'war', 'tie screen\nstays too long'); L.recordPlay(m, 'tower', 100, 1);
  const text = L.reportText(cat, m, new Date('2026-10-11T00:00:00Z'));
  assert.match(text, /^Gambling With Friends — game lab report \(2026-10-11\)\n2 of 36 checked/);
  assert.match(text, /## Classics\n- \[OK\] 50\/50 Wheel/); assert.match(text, /- \[PROBLEM\] War — tie screen stays too long/); assert.match(text, /- \[played, not marked\] Tower \(1 rounds\)/); assert.match(text, /- \[not tested\] Keno/);
  assert.equal(text.split('\n').filter(l => l.startsWith('- [')).length, 36);
});
test('payout rows: exact figures where the maths is closed-form, the measured figure where it depends on play', () => {
  assert.deepEqual(L.payoutRows(DEFAULT_CONFIG, 'thimbles'), [{ label: 'Thimbles', value: '96.0%' }]);
  assert.equal(L.payoutRows(DEFAULT_CONFIG, 'sicbo').length, 5);
  assert.deepEqual(L.payoutRows(DEFAULT_CONFIG, 'videopoker'), [{ label: 'Returns', value: 'about 97% with sensible holds' }]);
  assert.deepEqual(L.payoutRows(DEFAULT_CONFIG, 'blackjack'), [{ label: 'Returns', value: 'about 99% with sensible play' }]);
  for (const id of order) { const rows = L.payoutRows(DEFAULT_CONFIG, id); assert.ok(rows.length >= 1 && rows.every(r => r.label && r.value && !/NaN|undefined/.test(r.value)), id); }
});
test('the lab never writes the real session and switches off ledger posts to the Sheet', async () => {
  const fs = await import('node:fs'); const src = fs.readFileSync(new URL('../../site/js/lab.js', import.meta.url), 'utf8');
  assert.match(src, /setLedgerPush\(false\)/); assert.doesNotMatch(src, /saveState|clearState|gwf_state|loadState/);
  const C = await import('../../site/js/config.js'); const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { calls.push(a); return Promise.resolve({ json: async () => ({}) }); };
  localStorage.setItem('gwf_sheets_endpoint', 'https://example.test/exec');
  C.setLedgerPush(false); C.pushLedgerRow({ type: 'X' }); assert.equal(calls.length, 0);
  C.setLedgerPush(true); C.pushLedgerRow({ type: 'X' }); assert.equal(calls.length, 1);
  localStorage.removeItem('gwf_sheets_endpoint'); globalThis.fetch = realFetch;
});
