import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, E, G, mkGame } from './_helpers.mjs';
const HI = await import('../../site/js/history.js');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// A finished session where `golds` are the final Gold balances, in player order.
function session(names, golds, { seed = 1, createdAt = 1000, sessionNo = 1 } = {}) {
  const c = mkGame(names, seed); c.state.createdAt = createdAt; c.state.sessionNo = sessionNo;
  c.players.forEach((p, i) => { p.balances.Gold = golds[i]; });
  return c;
}
const row = (hof, name) => hof.find(r => r.name === name);

test('summarizeSession captures ranks, net, per-player stats and awards', () => {
  const c = session(['Aj', 'Nick', 'Sam'], [900, 500, 100]);
  c.state.game = { id: 'fifty', playerId: c.p.id, wagers: [{ amount: 100, cur: 'Gold' }] }; G.settle(c.config, c.state, c.p, 2);
  E.sendToJail(c.config, c.state, c.players[2], 't');
  const s = HI.summarizeSession(c.config, c.state, 5000);
  assert.equal(s.endedAt, 5000); assert.equal(s.v, HI.HISTORY_VERSION);
  assert.deepEqual(s.players.map(p => [p.name, p.rank, p.net]), [['Aj', 1, 500], ['Nick', 2, 0], ['Sam', 3, -400]]);
  assert.deepEqual([s.players[0].games, s.players[0].wins, s.players[2].jailed], [1, 1, 1]);
  assert.equal(s.awards.find(a => a.key === 'champion').playerKey, 'name:aj');
  assert.equal(s.games[0].id, 'fifty');
});

test('players are keyed by profile when they have one, else by case-insensitive name', () => {
  assert.equal(HI.playerKey({ name: '  AJ ' }), 'name:aj');
  assert.equal(HI.playerKey({ name: 'Aj', profileId: 'pr7' }), 'profile:pr7');
});

test('archiving stores the session; ending the same session twice replaces it', () => {
  const st = mem(); const c = session(['Aj', 'Nick'], [700, 300]);
  assert.equal(HI.archiveSession(c.config, c.state, st, 10).count, 1);
  c.p.balances.Gold = 50;
  HI.archiveSession(c.config, c.state, st, 20);
  const h = HI.loadHistory(st);
  assert.equal(h.length, 1); assert.equal(h[0].endedAt, 20); assert.equal(h[0].players[0].name, 'Nick');
});

test('a new session on the same table (Start Session again) archives separately', () => {
  const st = mem(); const c = session(['Aj', 'Nick'], [700, 300]);
  HI.archiveSession(c.config, c.state, st, 10);
  c.state.sessionNo = 2; HI.archiveSession(c.config, c.state, st, 20);
  assert.equal(HI.loadHistory(st).length, 2);
});

test('an empty table is not archived', () => {
  const st = mem(); const c = mkGame([]);
  assert.equal(HI.archiveSession(c.config, c.state, st).error, true); assert.equal(HI.loadHistory(st).length, 0);
});

test('corrupt or foreign storage contents load as an empty history', () => {
  const st = mem();
  for (const junk of ['not json', '{"a":1}', 'null', '[1,2,{"id":5}]']) { st.setItem(HI.HISTORY_KEY, junk); assert.deepEqual(HI.loadHistory(st), []); }
});

test('history keeps only the most recent sessions (cap)', () => {
  const st = mem(); const list = [];
  for (let i = 0; i < HI.HISTORY_MAX + 15; i++) list.push({ id: 's' + i, endedAt: i, players: [], awards: [] });
  const saved = HI.saveHistory(list, st);
  assert.equal(saved.length, HI.HISTORY_MAX); assert.equal(saved[0].id, 's15'); assert.equal(HI.loadHistory(st).length, HI.HISTORY_MAX);
});

test('export → clear → import restores everything; importing again adds nothing', () => {
  const st = mem();
  const a = session(['Aj', 'Nick'], [700, 300], { createdAt: 1 }), b = session(['Aj', 'Nick'], [200, 800], { createdAt: 2 });
  HI.archiveSession(a.config, a.state, st, 10); HI.archiveSession(b.config, b.state, st, 20);
  const file = HI.exportHistory(st);
  assert.equal(JSON.parse(file).sessions.length, 2);
  HI.clearHistory(st); assert.equal(HI.loadHistory(st).length, 0);
  const first = HI.importHistory(file, st); assert.deepEqual([first.added, first.updated, first.count], [2, 0, 2]);
  const again = HI.importHistory(file, st); assert.deepEqual([again.added, again.updated, again.count], [0, 2, 2]);
});

test('import merges with what is already here and skips unusable entries', () => {
  const st = mem(); const c = session(['Aj', 'Nick'], [700, 300], { createdAt: 1 });
  HI.archiveSession(c.config, c.state, st, 10);
  const other = JSON.stringify([{ id: 'elsewhere', endedAt: 5, players: [{ key: 'name:sam', name: 'Sam', rank: 1, net: 10 }], awards: [] }, { broken: true }]);
  const r = HI.importHistory(other, st);
  assert.deepEqual([r.added, r.skipped, r.count], [1, 1, 2]);
});

test('import rejects junk without touching the archive', () => {
  const st = mem(); st.setItem(HI.HISTORY_KEY, JSON.stringify([{ id: 'keep', endedAt: 1, players: [] }]));
  for (const bad of ['{{{', '{"sessions":"nope"}', '[]', '{"sessions":[{"x":1}]}']) assert.equal(HI.importHistory(bad, st).error, true, bad);
  assert.equal(HI.loadHistory(st).length, 1);
});

test('Hall of Fame: titles, podiums, total and best/worst nights across sessions', () => {
  const st = mem();
  const add = (names, golds, n) => { const c = session(names, golds, { createdAt: n }); HI.archiveSession(c.config, c.state, st, n); };
  add(['Aj', 'Nick', 'Sam'], [900, 500, 100], 1);
  add(['aj', 'Nick'], [300, 1500], 2);                       // "aj" is the same person
  add(['Aj', 'Nick', 'Sam', 'Lee'], [1200, 400, 600, 500], 3);
  const hof = HI.hallOfFame(HI.loadHistory(st));
  assert.deepEqual(hof.map(r => r.name), ['Aj', 'Nick', 'Sam', 'Lee']);
  const aj = row(hof, 'Aj');
  assert.deepEqual([aj.sessions, aj.titles, aj.podiums, aj.totalNet, aj.bestNet, aj.worstNet, aj.avgNet], [3, 2, 3, 900, 700, -200, 300]);
  assert.deepEqual([row(hof, 'Nick').titles, row(hof, 'Nick').totalNet, row(hof, 'Nick').spoons], [1, 900, 1]);
  assert.equal(row(hof, 'Sam').spoons, 1); assert.equal(row(hof, 'Lee').sessions, 1);
});

test('Hall of Fame tracks winning streaks in date order, whatever order they were saved in', () => {
  const mk = (n, winner) => ({ id: 's' + n, endedAt: n, players: [{ key: 'name:a', name: 'A', rank: winner === 'A' ? 1 : 2, net: 0 }, { key: 'name:b', name: 'B', rank: winner === 'B' ? 1 : 2, net: 0 }], awards: [] });
  const hof = HI.hallOfFame([mk(4, 'B'), mk(1, 'A'), mk(3, 'A'), mk(2, 'A'), mk(5, 'A')]);
  assert.equal(row(hof, 'A').bestStreak, 3); assert.equal(row(hof, 'A').streak, 1); assert.equal(row(hof, 'B').bestStreak, 1);
});

test('Hall of Fame counts awards other than Champion / Wooden Spoon', () => {
  const s = { id: 'x', endedAt: 1, players: [{ key: 'name:a', name: 'A', rank: 1, net: 5 }], awards: [{ key: 'champion', playerKey: 'name:a' }, { key: 'jailbird', playerKey: 'name:a' }, { key: 'hothand', playerKey: 'name:a' }, { key: 'ouch', playerKey: 'name:gone' }] };
  assert.equal(HI.hallOfFame([s])[0].awards, 2);
});

test('an empty history gives an empty Hall of Fame and no records', () => {
  assert.deepEqual(HI.hallOfFame([]), []); assert.deepEqual(HI.records([]), []);
});

test('records pick the single best and worst nights', () => {
  const st = mem();
  const add = (names, golds, n) => { const c = session(names, golds, { createdAt: n }); HI.archiveSession(c.config, c.state, st, n); };
  add(['Aj', 'Nick'], [2500, -700], 1); add(['Aj', 'Nick'], [600, 400], 2);
  const r = Object.fromEntries(HI.records(HI.loadHistory(st)).map(x => [x.key, x]));
  assert.deepEqual([r.bestNight.name, r.bestNight.value], ['Aj', 2000]);
  assert.deepEqual([r.worstNight.name, r.worstNight.value], ['Nick', -1200]);
  assert.equal(r.mostJailed, undefined);
});

test('sessionLine is a readable one-liner', () => {
  const c = session(['Aj', 'Nick'], [900, 100]); const s = HI.summarizeSession(c.config, c.state, Date.UTC(2026, 9, 10, 16));
  assert.match(HI.sessionLine(s), /2026 — 2 players, 1 round — 👑 Aj \(\+400\)/);
});
