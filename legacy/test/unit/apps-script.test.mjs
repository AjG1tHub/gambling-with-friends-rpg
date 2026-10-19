// Loop 25 — the Google Sheet endpoint (sheet/Code.gs). Its pure helpers run here in a sandbox with no Sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from './_helpers.mjs';
const { build, EMPTY_HEADERS } = await import('../../tools/build-apps-script.mjs');
const { mergeConfig } = await import('../../site/js/config.js');
const V = await import('../../site/js/config-check.js');

const ctx = vm.createContext({});
vm.runInContext(build(), ctx);
const A = (name) => (...args) => JSON.parse(JSON.stringify(ctx[name](...args) ?? null));   // plain objects out of the sandbox
const gridToValue = A('gridToValue'), planTab = A('planTab'), planAll = A('planAll');

// A sheet as it stood before the pets / expansion work (shape copied from the real “GWF Config” Sheet).
const OLD = {
  Config: [['Key', 'Value'], ['StartingBank', 500], ['MinBet', 100], ['QuickBets', '[100,250,500,"ALL_IN"]'], ['VoidChance', 0.2], ['VoidEnabled', true], ['SpecialTilesShuffle', true],
    ['BattleMinWager', 100], ['AuctionDefaultLots', 'PER_CURRENCY'], ['ShopRateMin', 0.5], ['ShopRateMax', 2], ['ShopCurrenciesPerVisit', 3], ['JailBuyoutT1', 200], ['JailBuyoutT2', 400],
    ['JailBuyoutT3', 800], ['JailBuyoutT4', 1600], ['JailSkillCheckStake', 100], ['JailRiskMinWager', 100], ['HouseEdgeMultiplier', 1], ['LongWalkMaxSteps', 10], ['BenevolenceSteps', 2], ['GoldCanGoNegative', true]],
  Currencies: [['Name', 'GoldRate', 'Active', 'Emoji'], ['Gold', 1, true, '🪙'], ['Gems', 5, true, '💎'], ['Bananas', 0.1, true, '']],
  Board: [['Key', 'Value'], ['cols', 8], ['rows', 5], ['tileCounts', '{"GAME":29,"GOOD":3,"BAD":3,"JAIL":2,"SHOP":2,"START":1}'], ['colorWeights', '{"Red":10,"Blue":8,"Green":8,"Yellow":7,"Purple":5,"Black":2}'], ['pins', '{"7":"START","32":"JAIL"}']],
  Games: [['Id', 'Name', 'Icon', 'Built', 'Hidden', 'Odds'], ['fifty', '50/50 Wheel', '🎡', true, false, '{"winChance":0.5,"payout":1.0}'], ['roulette', 'Roulette', '🔴', true, false, '{"pockets":37,"straight":35,"dozen":2,"even":1}'],
    ['crash', 'Crash', '🚀', true, false, '{"houseEdge":0.04,"growthPerSec":0.10,"maxMult":50}'], ['mines', 'Mines', '💣', true, false, '{"grid":25,"mines":3,"houseEdge":0.03}'], ['bigwheel', 'Big Wheel', '🎰', true, false, '{}'],
    ['blackjack', 'Blackjack', '🃏', true, false, '{}'], ['baccarat', 'Baccarat', '🎴', true, false, '{}'], ['plinko', 'Plinko', '🔻', true, false, '{}'], ['placeholder', 'GM Call (did they win?)', '❓', true, true, '{}']],
  Wheel_Good: [['Label', 'Verb', 'Params', 'Weight', 'Desc'], ['Payday', 'GOLD_DELTA', '{"amount":200}', 15, '+200 Gold'], ['Pardon', 'PARDON_GRANT', '{}', 5, 'Consumed instead of entering jail'], ['Nothing But Vibes', 'NOTHING', '{}', 7, 'No effect']],
  Wheel_Jail: [['Label', 'Verb', 'Params', 'W1', 'W2', 'W3', 'W4', 'Desc'], ['Escape', 'JAIL_RELEASE', '{}', 25, 18, 12, 8, 'Free immediately'], ['Solitary', 'JAIL_SPIN_TWICE', '{}', 0, 0, 0, 12, 'Spin twice next turn'], ['Nothing', 'NOTHING', '{}', 4, 4, 6, 6, 'mocks you']],
  Wheel_Battle: [['Label', 'Pool', 'Weight', 'SpinCategory'], ['Rock Paper Scissors (Bo3)', 'Physical', 14, false], ['Coin Flip', 'Digital', 12, false], ['Name 10 → Category Wheel', 'Physical', 12, true]],
  Wheel_BuyIn: [['Label', 'Weight', 'Desc'], ['Flat Fee', 18, 'GM names a Gold price'], ['Percentage Tithe', 14, 'Pay 10% of current Gold']],
  Stakes: [['Ts', 'Players', 'Description', 'Settled']],
};

test('header ↔ key: GoldRate → goldRate, SpinCategory → spinCategory, and back', () => {
  assert.equal(ctx.keyFromHeader('GoldRate'), 'goldRate');
  assert.equal(ctx.keyFromHeader('Id'), 'id');
  assert.equal(ctx.keyFromHeader(' Max Held '), 'maxHeld');
  assert.equal(ctx.headerFromKey('spinCategory'), 'SpinCategory');
});
test('parseCell: JSON, booleans, numeric text; blanks vanish; broken JSON stays text', () => {
  assert.deepEqual(A('parseCell')('{"amount":150}'), { amount: 150 });
  assert.deepEqual(A('parseCell')('[100,"ALL_IN"]'), [100, 'ALL_IN']);
  assert.equal(ctx.parseCell('TRUE'), true); assert.equal(ctx.parseCell(false), false);
  assert.equal(ctx.parseCell('12.5'), 12.5); assert.equal(ctx.parseCell(7), 7);
  assert.equal(ctx.parseCell(''), undefined); assert.equal(ctx.parseCell('   '), undefined);
  assert.equal(ctx.parseCell('{oops'), '{oops'); assert.equal(ctx.parseCell('{"a":}'), '{"a":}');
  assert.equal(ctx.parseCell('PER_CURRENCY'), 'PER_CURRENCY');
});
test('a Key/Value tab becomes an object with parsed values', () => {
  const c = gridToValue(OLD.Config);
  assert.equal(c.StartingBank, 500); assert.deepEqual(c.QuickBets, [100, 250, 500, 'ALL_IN']); assert.equal(c.VoidEnabled, true);
  assert.deepEqual(gridToValue(OLD.Board).pins, { 7: 'START', 32: 'JAIL' });
});
test('a row tab becomes a list of objects; blank cells are left out', () => {
  const cur = gridToValue(OLD.Currencies);
  assert.deepEqual(cur[1], { name: 'Gems', goldRate: 5, active: true, emoji: '💎' });
  assert.ok(!('emoji' in cur[2]));
  const g = gridToValue(OLD.Games);
  assert.deepEqual(g[0].odds, { winChance: 0.5, payout: 1 });
  assert.equal(g.at(-1).hidden, true);
});
test('Wheel_Jail W1–W4 columns become weights {1..4}', () => {
  const j = gridToValue(OLD.Wheel_Jail);
  assert.deepEqual(j[0].weights, { 1: 25, 2: 18, 3: 12, 4: 8 });
  assert.equal(j[1].weights[4], 12); assert.equal(j[1].weights[1], 0);
});
test('fully blank rows are skipped; a header-only tab is an empty list; an empty tab is null', () => {
  assert.deepEqual(gridToValue([['Label', 'Weight'], ['', ''], ['A', 1]]), [{ label: 'A', weight: 1 }]);
  assert.deepEqual(gridToValue(OLD.Stakes), []);
  assert.equal(gridToValue([]), null); assert.equal(gridToValue([['', '']]), null);
});
test('the old Sheet, read and merged over the defaults, passes the config check', () => {
  const tabs = {}; for (const [k, grid] of Object.entries(OLD)) tabs[k] = gridToValue(grid);
  const cfg = mergeConfig(tabs);
  assert.deepEqual(V.validateConfig(cfg).filter(f => f.level === 'error'), []);
  assert.equal(cfg.Games.length, 9);                                    // the Sheet's list wins: no hilo/dice/slots/keno yet
  assert.ok(V.validateConfig(cfg).some(f => /“keno” has no row/.test(f.msg)));
  assert.equal(cfg.Pets.maxPets, 3);                                    // tabs the Sheet lacks come from the built-ins
});
test('round trip: defaults → grid → value gives the defaults back', () => {
  for (const [tab, def] of Object.entries(DEFAULT_CONFIG)) {
    const p = planTab(tab, null, def, EMPTY_HEADERS[tab]);
    assert.equal(p.create, true, tab);
    const back = gridToValue([p.headers, ...p.appendRows]);
    assert.deepEqual(back, JSON.parse(JSON.stringify(def)), tab);
  }
});
test('plan for an up-to-date tab is empty', () => {
  const p0 = planTab('Wheel_Good', null, DEFAULT_CONFIG.Wheel_Good);
  const p = planTab('Wheel_Good', [p0.headers, ...p0.appendRows], DEFAULT_CONFIG.Wheel_Good);
  assert.deepEqual([p.create, p.addColumns, p.appendRows, p.fillCells], [false, [], [], []]);
});
test('Games: only the missing games are appended, in the Sheet\'s own column order', () => {
  const p = planTab('Games', OLD.Games, DEFAULT_CONFIG.Games);
  assert.deepEqual(p.appendRows.map(r => r[0]).slice(0, 4), ['hilo', 'dice', 'slots', 'keno']); assert.equal(p.appendRows.length, 28); assert.ok(p.appendRows.some(r => r[0] === 'paigow'));
  assert.deepEqual(p.addColumns, []);
  const hilo = p.appendRows[0];
  assert.equal(hilo[1], 'Hi-Lo'); assert.equal(hilo[3], true); assert.equal(hilo[4], ''); assert.equal(hilo[5], '{"houseEdge":0.03,"maxMult":100}');
  assert.equal(p.fillCells.length, 0);                                  // existing rows (and their {} odds) are untouched
});
test('Wheel_Battle: Auto + PetBattle columns are added, Coin Flip gets its auto, new rows appended', () => {
  const p = planTab('Wheel_Battle', OLD.Wheel_Battle, DEFAULT_CONFIG.Wheel_Battle);
  assert.deepEqual(p.addColumns.sort(), ['Auto', 'PetBattle']);
  const autoCol = 4 + ['PetBattle', 'Auto'].indexOf('Auto');           // columns land after the existing four, in default order
  const fill = p.fillCells.find(c => c.value === 'coin');
  assert.equal(fill.row, 2); assert.ok(fill.col === 4 || fill.col === 5);
  assert.ok(p.appendRows.some(r => r[0] === 'Pet Battle'));
  assert.ok(!p.appendRows.some(r => r[0] === 'Coin Flip'));
  assert.ok(autoCol >= 4);
});
test('Wheel_BuyIn: Mech + Params columns are added and every existing row gets its mech', () => {
  const p = planTab('Wheel_BuyIn', OLD.Wheel_BuyIn, DEFAULT_CONFIG.Wheel_BuyIn);
  assert.deepEqual(p.addColumns.sort(), ['Mech', 'Params']);
  assert.ok(p.fillCells.some(c => c.row === 1 && c.value === 'flat'));
  assert.ok(p.fillCells.some(c => c.row === 2 && c.value === 'tithe'));
  assert.ok(p.fillCells.some(c => c.row === 2 && c.value === '{"pct":10}'));
  assert.equal(p.appendRows.length, DEFAULT_CONFIG.Wheel_BuyIn.length - 2);
});
test('settings tabs: only missing keys are appended; rows the user added are left alone', () => {
  const grid = [['Key', 'Value'], ['StartingBank', 9999], ['MyOwnKey', 'x']];
  const p = planTab('Config', grid, DEFAULT_CONFIG.Config);
  assert.ok(!p.appendRows.some(r => r[0] === 'StartingBank'));
  assert.ok(p.appendRows.some(r => r[0] === 'MinBet' && r[1] === 100));
  assert.equal(p.appendRows.length, Object.keys(DEFAULT_CONFIG.Config).length - 1);
});
test('user-added rows (Bananas) never appear in a plan', () => {
  const p = planTab('Currencies', OLD.Currencies, DEFAULT_CONFIG.Currencies);
  assert.ok(!p.appendRows.some(r => r[0] === 'Bananas' || r[0] === 'Gold' || r[0] === 'Gems'));
  assert.equal(p.appendRows.length, DEFAULT_CONFIG.Currencies.length - 2);
});
test('planAll on the old Sheet: creates the new tabs, skips the Ledger, and applying it leaves nothing to do', () => {
  const plans = planAll(OLD, DEFAULT_CONFIG, EMPTY_HEADERS);
  const tabs = plans.map(p => p.tab);
  for (const t of ['Pets', 'PetBattle', 'Raid', 'Loans', 'Auction', 'PetSpecies', 'Wheel_Color', 'Games', 'Wheel_Good']) assert.ok(tabs.includes(t), t);
  assert.ok(!tabs.includes('Ledger')); assert.ok(!tabs.includes('Stakes'));
  assert.deepEqual(plans.find(p => p.tab === 'PetSpecies').headers, EMPTY_HEADERS.PetSpecies);
  // apply the plans to a copy of the grids the way gwfAddMissing does
  const grids = structuredClone(OLD);
  for (const p of plans) {
    const g = grids[p.tab] || (grids[p.tab] = []);
    if (p.create) g.push([...p.headers]);
    for (const h of p.addColumns) { g[0].push(h); for (let i = 1; i < g.length; i++) g[i].push(''); }
    for (const c of p.fillCells) g[c.row][c.col] = c.value;
    for (const r of p.appendRows) g.push([...r]);
  }
  assert.deepEqual(planAll(grids, DEFAULT_CONFIG, EMPTY_HEADERS), []);
  const merged = {}; for (const [k, grid] of Object.entries(grids)) merged[k] = gridToValue(grid);
  const cfg = mergeConfig(merged);
  assert.deepEqual(V.validateConfig(cfg).filter(f => f.level === 'error'), []);
  assert.equal(cfg.Games.length, 37);
  assert.equal(cfg.Config.StartingBank, 500);
  assert.ok(cfg.Currencies.some(c => c.name === 'Bananas'));
  assert.equal(cfg.Wheel_Battle.find(r => r.label === 'Coin Flip').auto, 'coin');
});
test('describePlans is readable, and says so when there is nothing to add', () => {
  assert.match(ctx.describePlans([]), /Nothing to add/);
  const text = ctx.describePlans(ctx.planAll(OLD, JSON.parse(JSON.stringify(DEFAULT_CONFIG)), EMPTY_HEADERS));
  assert.match(text, /Games: 28 rows \(hilo, dice, slots, keno, coinstreak/);
  assert.match(text, /Pets: new tab/);
});
test('ledgerRow: timestamp, type, player id, full JSON', () => {
  const r = A('ledgerRow')({ type: 'CREDIT', playerId: 'p1', amount: 5 }, 'NOW');
  assert.deepEqual(r, ['NOW', 'CREDIT', 'p1', '{"type":"CREDIT","playerId":"p1","amount":5}']);
  assert.deepEqual(A('ledgerRow')({ type: 'TURN_END', playerId: null }, 1).slice(1, 3), ['TURN_END', '']);
  assert.doesNotThrow(() => ctx.ledgerRow(undefined, 1));
});
test('doGet / doPost against a fake SpreadsheetApp', () => {
  const sheets = { Config: OLD.Config, Games: OLD.Games, Ledger: [['ts', 'type', 'playerId', 'json']], Sheet1: [] };
  const mk = (name) => ({ getName: () => name, getLastRow: () => sheets[name].length, getLastColumn: () => (sheets[name][0] || []).length,
    getDataRange: () => ({ getValues: () => sheets[name] }), appendRow: (r) => sheets[name].push(r) });
  const c2 = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => Object.keys(sheets).map(mk), getSheetByName: (n) => (sheets[n] ? mk(n) : null) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  });
  vm.runInContext(build(), c2);
  const got = JSON.parse(c2.doGet().text);
  assert.equal(got.ok, true); assert.equal(got.tabs.Config.MinBet, 100); assert.equal(got.tabs.Games.length, 9);
  assert.ok(!('Ledger' in got.tabs)); assert.ok(!('Sheet1' in got.tabs));
  const res = JSON.parse(c2.doPost({ postData: { contents: JSON.stringify({ action: 'ledger', row: { type: 'MOVE', playerId: 'p9' } }) } }).text);
  assert.equal(res.ok, true); assert.equal(sheets.Ledger.length, 2); assert.equal(sheets.Ledger[1][1], 'MOVE');
  assert.equal(JSON.parse(c2.doPost({ postData: { contents: '{"action":"nope"}' } }).text).ok, false);
  assert.equal(JSON.parse(c2.doPost({ postData: { contents: 'not json' } }).text).ok, false);
});
test('sheet/Code.gs on disk is up to date with the template + defaults', async () => {
  const fs = await import('node:fs');
  assert.equal(fs.readFileSync(new URL('../../sheet/Code.gs', import.meta.url), 'utf8'), build(), 'run: node tools/build-apps-script.mjs');
});
