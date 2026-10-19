// Loop 25 — config doctor: the Sheet can be mistyped; the game should say what is wrong in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from './_helpers.mjs';
const V = await import('../../site/js/config-check.js');

const cfg = (tweak) => { const c = structuredClone(DEFAULT_CONFIG); if (tweak) tweak(c); return c; };
const errs = (c) => V.validateConfig(c).filter(f => f.level === 'error');
const has = (list, tab, re) => list.some(f => f.tab === tab && re.test(f.msg));

test('the built-in config has no errors', () => {
  const f = V.validateConfig(cfg());
  assert.deepEqual(f.filter(x => x.level === 'error'), []);
  assert.equal(V.summarize(f).ok, true);
});
test('the built-in config has exactly two warnings: the generous Big Wheel and the unbuilt Hedge power-up', () => {
  const w = V.validateConfig(cfg()).filter(f => f.level === 'warn');
  assert.equal(w.length, 2);
  assert.ok(w.some(x => /Big Wheel returns 191\.7%/.test(x.msg)));
  assert.ok(w.some(x => x.tab === 'PowerUps' && /Hedge is on sale/.test(x.msg)));     // sold but has no effect yet
  assert.equal(V.validateConfig(cfg(c => { c.PowerUps.find(p => p.id === 'hedge').active = false; })).filter(f => f.tab === 'PowerUps').length, 0);
});
test('every verb used by the built-in wheels is known to the checker', () => {
  for (const tab of ['Wheel_Start', 'Wheel_Void', 'Wheel_Good', 'Wheel_Bad', 'Wheel_Jail']) for (const r of DEFAULT_CONFIG[tab]) assert.ok(V.OUTCOME_VERBS.includes(r.verb), `${tab}: ${r.verb}`);
  for (const r of DEFAULT_CONFIG.Wheel_Method) assert.ok(V.MOVE_VERBS.includes(r.verb), r.verb);
});
test('the checker knows every verb the engine executes', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../site/js/engine.js', import.meta.url), 'utf8');
  const cases = [...src.matchAll(/case '([A-Z_0-9]+)'/g)].map(m => m[1]).filter(v => !V.TILE_TYPES.includes(v));
  for (const v of cases) assert.ok(V.OUTCOME_VERBS.includes(v) || V.MOVE_VERBS.includes(v), `engine handles ${v} but the checker would reject it`);
});
test('a missing tab is an error; an unknown tab is only a note', () => {
  const c = cfg(c => { delete c.Wheel_Good; c.Bananas = []; });
  const f = V.validateConfig(c);
  assert.ok(has(f.filter(x => x.level === 'error'), 'Wheel_Good', /missing/));
  assert.ok(f.some(x => x.level === 'info' && x.tab === 'Bananas'));
});
test('tile counts that do not fill the board are caught before the board is built', () => {
  const e = errs(cfg(c => { c.Board.tileCounts.GAME = 28; }));
  assert.ok(has(e, 'Board', /add up to 39.*40 tiles/));
});
test('a pin that is off the board or has no tile of that type is an error', () => {
  assert.ok(has(errs(cfg(c => { c.Board.pins[99] = 'JAIL'; })), 'Board', /off the board/));
  assert.ok(has(errs(cfg(c => { c.Board.tileCounts.JAIL = 0; c.Board.tileCounts.GAME = 31; })), 'Board', /pinned as JAIL/));
});
test('a typo in a verb is an error naming the row', () => {
  const e = errs(cfg(c => { c.Wheel_Good[0].verb = 'GOLD_DELTTA'; }));
  assert.ok(has(e, 'Wheel_Good', /Payday.*GOLD_DELTTA.*not a verb/));
});
test('a verb missing its number is an error', () => {
  assert.ok(has(errs(cfg(c => { c.Wheel_Bad[1].params = {}; })), 'Wheel_Bad', /GOLD_DELTA needs a number for “amount”/));
  assert.ok(has(errs(cfg(c => { c.Wheel_Bad[8].params = { perTurn: 50 }; })), 'Wheel_Bad', /COLLECTOR needs a number for “turns”/));
});
test('numbers typed as text in the Sheet are accepted', () => {
  const c = cfg(c => { c.Wheel_Good[0].params.amount = '200'; c.Wheel_Good[0].weight = '15'; c.Config.MinBet = '100'; });
  assert.deepEqual(errs(c), []);
});
test('bad weights: negative, text, or all zero', () => {
  assert.ok(has(errs(cfg(c => { c.Wheel_Void[0].weight = -1; })), 'Wheel_Void', /weight must be a number/));
  assert.ok(has(errs(cfg(c => { c.Wheel_Void[0].weight = 'lots'; })), 'Wheel_Void', /weight must be a number/));
  assert.ok(has(errs(cfg(c => { c.Wheel_Start.forEach(r => { r.weight = 0; }); })), 'Wheel_Start', /Every weight is 0/));
  assert.ok(has(errs(cfg(c => { c.Wheel_Method = []; })), 'Wheel_Method', /no rows/));
});
test('a movement wheel may only hold movement verbs', () => {
  assert.ok(has(errs(cfg(c => { c.Wheel_Method[0].verb = 'GOLD_DELTA'; })), 'Wheel_Method', /not a verb/));
});
test('duplicate wheel labels are a warning, not an error', () => {
  const f = V.validateConfig(cfg(c => { c.Wheel_Good[1].label = 'Payday'; }));
  assert.ok(f.some(x => x.level === 'warn' && x.tab === 'Wheel_Good' && /both called “Payday”/.test(x.msg)));
  assert.equal(f.filter(x => x.level === 'error').length, 0);
});
test('jail wheel: a tier with no weight cannot spin; no exit row is a warning', () => {
  assert.ok(has(errs(cfg(c => { c.Wheel_Jail.forEach(r => { r.weights[3] = 0; }); })), 'Wheel_Jail', /Tier 3 has no weight/));
  const f = V.validateConfig(cfg(c => { c.Wheel_Jail = c.Wheel_Jail.filter(r => !['JAIL_RELEASE', 'JAIL_TIER_DOWN'].includes(r.verb)); }));
  assert.ok(f.some(x => x.level === 'warn' && x.tab === 'Wheel_Jail' && /only way out is paying/.test(x.msg)));
});
test('currencies: Gold must exist at rate 1; duplicates and bad rates are errors', () => {
  assert.ok(has(errs(cfg(c => { c.Currencies = c.Currencies.filter(x => x.name !== 'Gold'); })), 'Currencies', /no “Gold” row/));
  assert.ok(has(errs(cfg(c => { c.Currencies[0].goldRate = 2; })), 'Currencies', /has to be 1/));
  assert.ok(has(errs(cfg(c => { c.Currencies.push({ name: 'Gems', goldRate: 1 }); })), 'Currencies', /“Gems” is listed twice/));
  assert.ok(has(errs(cfg(c => { c.Currencies[1].goldRate = 0; })), 'Currencies', /“Gems”: goldRate/));
});
test('games: unknown built game, duplicate id, none switched on', () => {
  assert.ok(has(errs(cfg(c => { c.Games.push({ id: 'poker', name: 'Poker', built: true }); })), 'Games', /“poker” is marked built/));
  assert.ok(has(errs(cfg(c => { c.Games.push({ ...c.Games[0] }); })), 'Games', /“fifty” is listed twice/));
  assert.ok(has(errs(cfg(c => { c.Games.forEach(g => { if (!g.hidden) g.built = false; }); })), 'Games', /No game is switched on/));
});
test('an unbuilt extra row (a future game) is fine', () => {
  assert.deepEqual(errs(cfg(c => { c.Games.push({ id: 'poker', name: 'Poker', built: false }); })), []);
});
test('a Sheet that predates the new games gets a warning per missing game', () => {
  const f = V.validateConfig(cfg(c => { c.Games = c.Games.filter(g => !['hilo', 'dice', 'slots', 'keno'].includes(g.id)); }));
  const w = f.filter(x => x.level === 'warn' && /has no row/.test(x.msg));
  assert.equal(w.length, 4);
  assert.equal(f.filter(x => x.level === 'error').length, 0);
});
test('game odds sanity: mines, plinko, dice, crash', () => {
  assert.ok(has(errs(cfg(c => { c.Games.find(g => g.id === 'mines').odds.mines = 25; })), 'Games', /mines:/));
  assert.ok(has(errs(cfg(c => { c.Games.find(g => g.id === 'plinko').odds.mults = [1, 'x', 2]; })), 'Games', /plinko:/));
  assert.ok(has(errs(cfg(c => { c.Games.find(g => g.id === 'dice').odds.minChance = 99; })), 'Games', /dice:/));
  assert.ok(has(errs(cfg(c => { c.Games.find(g => g.id === 'crash').odds.growthPerSec = 0; })), 'Games', /crash:/));
});
test('empty odds from the Sheet fall back to the built-ins without complaint', () => {
  assert.deepEqual(errs(cfg(c => { c.Games.forEach(g => { if (g.odds) g.odds = {}; }); })), []);
});
test('a harsh game is flagged too', () => {
  const f = V.validateConfig(cfg(c => { c.Games.find(g => g.id === 'fifty').odds.winChance = 0.3; }));
  assert.ok(f.some(x => x.level === 'warn' && /50\/50 Wheel returns only 60\.0%/.test(x.msg)));
});
test('gameReturns matches the balance report on the closed-form games', () => {
  const r = Object.fromEntries(V.gameReturns(cfg()).map(x => [x.label, x.rtp]));
  assert.ok(Math.abs(r['50/50 Wheel'] - 1) < 1e-9);
  assert.ok(Math.abs(r['Roulette (red/black)'] - 36 / 37) < 1e-9);
  assert.ok(Math.abs(r['Plinko'] - 0.966) < 0.002);
  assert.ok(Math.abs(r['Slots'] - 0.945) < 0.002);
  assert.ok(r['Baccarat (banker)'] > 0.985 && r['Baccarat (banker)'] < 0.992);
  assert.equal(Object.keys(r).filter(k => k.startsWith('Keno')).length, 10);
});
test('gameReturns skips switched-off games and survives broken odds', () => {
  const c = cfg(c => { c.Games.find(g => g.id === 'slots').built = false; c.Games.find(g => g.id === 'bigwheel').odds.segments = null; });
  const ids = V.gameReturns(c).map(x => x.id);
  assert.ok(!ids.includes('slots')); assert.ok(!ids.includes('bigwheel')); assert.ok(ids.includes('plinko'));
});
test('battle + buy-in rows: unknown auto / mech are errors', () => {
  assert.ok(has(errs(cfg(c => { c.Wheel_Battle[2].auto = 'cards'; })), 'Wheel_Battle', /auto must be coin, card or dice/));
  assert.ok(has(errs(cfg(c => { c.Wheel_BuyIn[0].mech = 'free'; })), 'Wheel_BuyIn', /mech “free” is unknown/));
});
test('side systems: loans, pets, raid ranges', () => {
  assert.ok(has(errs(cfg(c => { c.Loans.minPrincipal = 5000; })), 'Loans', /larger than maxPrincipal/));
  assert.ok(has(errs(cfg(c => { c.Pets.eggCost = 5000; })), 'Pets', /eggCost/));
  assert.ok(has(errs(cfg(c => { c.Pets.gain.turn = -1; })), 'Pets', /gain\.turn/));
  assert.ok(has(errs(cfg(c => { c.Raid.minParty = 9; })), 'Raid', /minParty/));
  assert.ok(has(errs(cfg(c => { c.PetBattle.resistMult = 2; })), 'PetBattle', /resistMult/));
});
test('custom species and bosses need all six stats', () => {
  assert.ok(has(errs(cfg(c => { c.PetSpecies = [{ id: 'x', name: 'Xer', base: { str: 10 } }]; })), 'PetSpecies', /all six stats/));
  assert.ok(has(errs(cfg(c => { c.PetBosses = [{ id: 'b', name: 'Bo', stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }]; })), 'PetBosses', /level/));
  const ok = cfg(c => { c.PetSpecies = [{ id: 'x', name: 'Xer', base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, evolves: [{ level: 8, name: 'Xerox' }] }]; });
  assert.deepEqual(errs(ok), []);
});
test('quick bets and min bet sanity', () => {
  assert.ok(has(errs(cfg(c => { c.Config.QuickBets = [100, 'MAX']; })), 'Config', /QuickBets/));
  const f = V.validateConfig(cfg(c => { c.Config.MinBet = 900; }));
  assert.ok(f.some(x => x.level === 'warn' && /nobody can afford/.test(x.msg)));
  assert.ok(has(errs(cfg(c => { c.Config.VoidChance = 20; })), 'Config', /VoidChance/));
});
test('unknown theme ids warn; power-up duplicates are errors', () => {
  assert.ok(V.validateConfig(cfg(c => { c.Themes.push({ id: 'disco', name: 'Disco' }); })).some(x => x.level === 'warn' && x.tab === 'Themes'));
  assert.ok(has(errs(cfg(c => { c.PowerUps.push({ ...c.PowerUps[0] }); })), 'PowerUps', /listed twice/));
});
test('sheetDiff lists which tabs came from the Sheet and which built-in rows it dropped', () => {
  const remote = { Games: DEFAULT_CONFIG.Games.filter(g => g.id !== 'keno'), Wheel_Good: DEFAULT_CONFIG.Wheel_Good.filter(r => r.label !== 'Mystery Egg'), Config: { StartingBank: 500 } };
  const d = V.sheetDiff(remote);
  assert.deepEqual(d.fromSheet.sort(), ['Config', 'Games', 'Wheel_Good']);
  assert.ok(d.fromDefaults.includes('Wheel_Bad'));
  assert.ok(d.dropped.some(x => x.tab === 'Games' && x.key === 'keno'));
  assert.ok(d.dropped.some(x => x.tab === 'Wheel_Good' && x.key === 'Mystery Egg'));
  assert.ok(d.dropped.some(x => x.tab === 'Config' && x.key === 'MinBet'));
  assert.equal(V.sheetDiff(null).fromSheet.length, 0);
});
test('reportHtml: clean config says so; findings are escaped and errors come first', () => {
  assert.match(V.reportHtml([]), /looks good/);
  const esc = (s) => String(s).replace(/</g, '&lt;');
  const html = V.reportHtml([{ level: 'info', tab: 'A', msg: 'zzz-fyi' }, { level: 'error', tab: 'B', msg: '<script>' }], esc);
  assert.ok(html.indexOf('&lt;script>') < html.indexOf('zzz-fyi'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /<b>1<\/b> problem to fix/);
});
test('validateConfig never throws on garbage', () => {
  for (const junk of [null, 42, [], {}, { Games: 'x', Board: 7, Config: [], Wheel_Jail: [null], Wheel_Good: [null, 3], Currencies: [null], PowerUps: [null], Themes: [null], Pets: 'no', Loans: 3 }])
    assert.doesNotThrow(() => V.validateConfig(junk));
});
