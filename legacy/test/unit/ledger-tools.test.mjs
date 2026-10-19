import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, G, mkGame } from './_helpers.mjs';
const LT = await import('../../site/js/ledger-tools.js');

function busy() {
  const c = mkGame(['Aj', 'Nick']);
  S.credit(c.state, c.p, 'Gold', 200, 'Payday'); S.credit(c.state, c.q, 'Gold', -700, 'Tax, "audit"');
  c.state.game = { id: 'fifty', playerId: c.p.id, wagers: [{ amount: 100, cur: 'Gold' }] }; G.settle(c.config, c.state, c.p, 2, { label: 'WIN' });
  E.sendToJail(c.config, c.state, c.q, 'test'); E.transfer(c.config, c.state, c.p, c.q, 'Gold', 50, 'side bet'); E.endTurn(c.state, c.config);
  return c;
}

test('every event type is in at most one group, and unknown types fall under Other', () => {
  const all = Object.values(LT.GROUPS).flat(); assert.equal(new Set(all).size, all.length);
  assert.equal(LT.groupOf('CREDIT'), 'Money'); assert.equal(LT.groupOf('JAIL_IN'), 'Jail'); assert.equal(LT.groupOf('PET_HATCH'), 'Pets'); assert.equal(LT.groupOf('WHAT'), 'Other');
});

test('filter by player includes rows where they are the other party of a transfer', () => {
  const c = busy(); const rows = LT.filterLedger(c.state, { playerId: c.q.id });
  assert.ok(rows.some(r => r.type === 'JAIL_IN')); assert.ok(rows.some(r => r.type === 'TRANSFER' && r.toId === c.q.id));
  assert.ok(!rows.some(r => r.type === 'GAME'));
});

test('filter by group, by explicit types, and by Other', () => {
  const c = busy(); S.log(c.state, 'WEIRD_EVENT', null, { x: 1 });
  assert.ok(LT.filterLedger(c.state, { group: 'Jail' }).every(r => r.type.startsWith('JAIL')));
  assert.deepEqual([...new Set(LT.filterLedger(c.state, { types: ['GAME'] }).map(r => r.type))], ['GAME']);
  assert.deepEqual(LT.filterLedger(c.state, { group: 'Other' }).map(r => r.type), ['WEIRD_EVENT']);
  assert.equal(LT.filterLedger(c.state, { group: 'All' }).length, c.state.ledger.length);
});

test('text search covers the type, the player name and the description, case-insensitively', () => {
  const c = busy();
  assert.equal(LT.filterLedger(c.state, { text: 'payday' }).length, 1);
  assert.ok(LT.filterLedger(c.state, { text: 'NICK' }).length >= 2);
  assert.equal(LT.filterLedger(c.state, { text: 'zzzz' }).length, 0);
  assert.ok(LT.filterLedger(c.state, { text: 'side bet', playerId: c.p.id, group: 'Money' }).length >= 1);
});

test('rows read like sentences', () => {
  const c = busy(); const d = (type, pick = () => true) => LT.describeRow(c.state, c.state.ledger.filter(r => r.type === type).find(pick));
  assert.equal(d('CREDIT'), '+200 Gold — Payday'); assert.equal(d('GAME'), 'fifty: won at 2× (WIN)');
  assert.equal(d('TRANSFER'), '50 Gold → Nick (side bet)'); assert.match(d('JAIL_IN'), /^jailed — test/); assert.equal(d('TURN_END'), 'turn 1 begins');
  assert.equal(LT.describeRow(c.state, { type: 'MYSTERY', ts: 1, playerId: null, n: 5 }), '');
  assert.ok(LT.describeRow(c.state, { type: 'MYSTERY', ts: 1, big: 'x'.repeat(500) }).length <= 120);
});

test('CSV: a header, one line per row, quotes and commas escaped, Excel-friendly line ends', () => {
  const c = busy(); const csv = LT.toCsv(c.state); const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'n,time,type,player,currency,amount,summary,data'); assert.equal(lines.length, c.state.ledger.length + 1);
  const tax = lines.find(l => l.includes('DEBIT') && l.includes('-700'));
  assert.ok(tax.includes('"-700 Gold — Tax, ""audit"""'), tax);
  assert.match(lines[1], /^\d+,\d{4}-\d{2}-\d{2}T/);
  assert.equal(LT.toCsv(c.state, []).trim(), 'n,time,type,player,currency,amount,summary,data');
});

test('the Gold timeline starts at the opening bank and ends at today\'s balance', () => {
  const c = busy(); const t = LT.goldTimeline(c.state, c.p.id);
  assert.equal(t[0].gold, 500); assert.equal(t.at(-1).gold, c.p.balances.Gold);
  assert.deepEqual(t.map(x => x.gold), [500, 700, 800, 750]);                      // payday, game win, side bet paid
  assert.deepEqual(LT.goldTimeline(c.state, c.q.id).map(x => x.gold), [500, -200, -150]);
  assert.deepEqual(LT.goldTimeline(c.state, 'ghost'), []);
});

test('the Gold timeline ignores secondary currencies', () => {
  const c = mkGame(); S.credit(c.state, c.p, 'Gems', 50, 'x');
  assert.deepEqual(LT.goldTimeline(c.state, c.p.id).map(x => x.gold), [500]);
});

test('the chart draws one line per player who moved Gold, a zero line when someone is in debt, and escapes names', () => {
  const c = busy(); c.p.name = '<Aj>'; const svg = LT.goldChartSvg(c.state);
  assert.equal((svg.match(/<path /g) || []).length, 2); assert.ok(svg.includes('stroke-dasharray')); assert.ok(svg.includes('&lt;Aj&gt;') && !svg.includes('<Aj>'));
  assert.match(svg, /high 800 · low -200/);
  assert.equal(LT.goldChartSvg(mkGame().state), '');                                // nothing has happened yet
});
