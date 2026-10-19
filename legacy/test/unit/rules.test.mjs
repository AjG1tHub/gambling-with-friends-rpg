// Loop 27 — the rulebook is generated from the config, so it must track every tunable and never print junk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from './_helpers.mjs';
const R = await import('../../site/js/rules.js');

const cfg = (tweak) => { const c = structuredClone(DEFAULT_CONFIG); if (tweak) tweak(c); return c; };
const sec = (c, id) => R.rulesSections(c).find(s => s.id === id)?.html ?? null;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const chances = (html) => [...html.matchAll(/<td class="n">([\d.]+)%<\/td>/g)].map(m => Number(m[1]));

test('every section renders, with unique ids, and nothing prints as undefined / NaN / [object', () => {
  const s = R.rulesSections(cfg());
  assert.deepEqual(s.map(x => x.id), ['goal', 'turn', 'tiles', 'games', 'good', 'bad', 'start', 'void', 'jail', 'battle', 'money', 'broke', 'pets', 'extras']);
  const html = R.rulesHtml(cfg());
  assert.doesNotMatch(html, /undefined|NaN|\[object|Infinity/);
  for (const x of s) assert.ok(html.includes(`href="#${x.id}"`) && html.includes(`<section id="${x.id}">`));
});
test('every switched-on game is explained by name; hidden and switched-off games are not', () => {
  const c = cfg(c => { c.Games.find(g => g.id === 'keno').built = false; });
  const g = text(sec(c, 'games'));
  for (const game of c.Games.filter(x => x.built && !x.hidden)) assert.ok(g.includes(game.name), game.name);
  assert.ok(!g.includes('Keno')); assert.ok(!g.includes('GM Call'));
  assert.equal((sec(c, 'games').match(/class="game"/g) || []).length, 35);
});
test('every wheel row with weight appears, and each wheel\'s chances add up to 100%', () => {
  for (const [id, tab] of [['good', 'Wheel_Good'], ['bad', 'Wheel_Bad'], ['start', 'Wheel_Start'], ['void', 'Wheel_Void']]) {
    const html = sec(cfg(), id);
    for (const r of DEFAULT_CONFIG[tab]) assert.ok(text(html).includes(r.label), `${tab}: ${r.label}`);
    const sum = chances(html).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 0.6, `${tab} sums to ${sum}`);
  }
});
test('a zero-weight row is left out of the rulebook', () => {
  const html = sec(cfg(c => { c.Wheel_Good.find(r => r.label === 'Pardon').weight = 0; }), 'good');
  assert.ok(!html.includes('<b>Pardon</b>'));
});
test('the numbers follow the config: starting bank, min bet, void chance, jail buyouts', () => {
  const c = cfg(c => { c.Config.StartingBank = 1234; c.Config.MinBet = 55; c.Config.VoidChance = 0.35; c.Config.JailBuyoutT3 = 999; });
  assert.match(text(sec(c, 'goal')), /1,234 Gold/);
  assert.match(text(sec(c, 'tiles')), /Minimum bet 55 Gold/);
  assert.match(text(sec(c, 'turn')), /35% chance/);
  assert.match(text(sec(c, 'jail')), /999 \(tier 3\)/);
});
test('the Void section disappears when the Void is switched off', () => {
  const c = cfg(c => { c.Config.VoidEnabled = false; });
  assert.equal(sec(c, 'void'), null);
  assert.doesNotMatch(text(sec(c, 'turn')), /Void/);
});
test('jail wheel: each tier column sums to 100% and tier-only rows show 0% elsewhere', () => {
  const html = sec(cfg(), 'jail');
  const rows = [...html.matchAll(/<tr><td><b>([^<]+)<\/b><\/td>((?:<td class="n">[^<]*<\/td>){4})/g)];
  assert.equal(rows.length, DEFAULT_CONFIG.Wheel_Jail.length);
  const cols = [0, 0, 0, 0];
  for (const r of rows) [...r[2].matchAll(/>(\d+)%</g)].forEach((m, i) => { cols[i] += Number(m[1]); });
  for (const c of cols) assert.ok(Math.abs(c - 100) <= 3, `tier column sums to ${c}`);
  const solitary = rows.find(r => r[1] === 'Solitary')[2];
  assert.match(solitary, />0%<.*>0%<.*>0%<.*>12%</);
});
test('game text follows the odds: blackjack rules, roulette payouts, baccarat, dice limits', () => {
  const c = cfg(c => {
    Object.assign(c.Games.find(g => g.id === 'blackjack').odds, { blackjackPays: 1.2, dealerHitsSoft17: 1, insurance: 0, maxHands: 2 });
    c.Games.find(g => g.id === 'roulette').odds.straight = 30;
    c.Games.find(g => g.id === 'baccarat').odds.tie = 9;
    c.Games.find(g => g.id === 'dice').odds.maxChance = 90;
  });
  const g = text(sec(c, 'games'));
  assert.match(g, /Blackjack pays 1\.2:1/); assert.match(g, /Dealer hits soft 17/); assert.match(g, /up to 2 hands/); assert.doesNotMatch(g, /insurance/);
  assert.match(g, /single number \(pays 30:1\)/); assert.match(g, /Tie pays 9:1/); assert.match(g, /2%–90%/);
});
test('default blackjack mentions insurance and standing on soft 17', () => {
  const g = text(sec(cfg(), 'games'));
  assert.match(g, /stands on soft 17/); assert.match(g, /insurance for half your bet/);
});
test('returns are shown per game and match the config check', () => {
  const g = text(sec(cfg(), 'games'));
  assert.match(g, /Big Wheel returns 191\.7%/); assert.match(g, /Plinko returns 96\.6%/); assert.match(g, /Slots returns 94\.5%/);
  assert.match(g, /Blackjack returns about 99% with sensible play/);
  assert.match(g, /Keno returns 9\d(\.\d)?%–9\d(\.\d)?% depending on the bet/);
});
test('plinko, slots and keno tables come from the paytables', () => {
  const html = sec(cfg(c => { c.Games.find(g => g.id === 'plinko').odds.mults = [9, 1, 0.5, 1, 9]; }), 'games');
  assert.match(html, /<td class="n">9×<\/td><td class="n">1×<\/td><td class="n">0\.5×<\/td>/);
  assert.match(html, /<td class="n">6\.3%<\/td><td class="n">25%<\/td><td class="n">37\.5%<\/td>/);
  assert.match(html, /7️⃣<\/td><td class="n">500×/);
  assert.match(html, /10 hits → 10000×/);
});
test('a game with broken odds still gets an entry instead of breaking the page', () => {
  const c = cfg(c => { c.Games.find(g => g.id === 'bigwheel').odds.segments = 'oops'; c.Games.push({ id: 'poker', name: 'Poker Night', built: true }); });
  let html; assert.doesNotThrow(() => { html = R.rulesHtml(c); });
  assert.match(html, /Big Wheel/); assert.match(text(html), /Poker Night The GM will explain this one/);
  assert.doesNotMatch(html, /undefined|NaN/);
});
test('battle wheel rows are tagged: on-screen, pets, category, at the table', () => {
  const b = sec(cfg(), 'battle');
  assert.match(b, /Coin Flip<\/b>.*?played on screen/s); assert.match(b, /Pet Battle<\/b>.*?pets fight it out/s);
  assert.match(b, /Name 10[^<]*<\/b>.*?then a category is spun/s); assert.match(b, /Thumb War<\/b>.*?played at the table/s);
  assert.match(text(b), /Movies, Animals, Foods/);
});
test('money section lists active currencies and power-ups only', () => {
  const c = cfg(c => { c.Currencies.find(x => x.name === 'Gems').active = false; c.PowerUps.find(p => p.id === 'fork').active = false; });
  const m = text(sec(c, 'money'));
  assert.ok(!/Gems/.test(m)); assert.match(m, /Keys = 10 Gold/); assert.ok(!/Edge: Fork/.test(m)); assert.match(m, /Edge: Reroll 300/);
});
test('loan terms follow the config; the Loan Shark vanishes when loans are off', () => {
  const on = text(sec(cfg(c => { c.Loans.interestPct = 40; c.Loans.termTurns = 6; }), 'broke'));
  assert.match(on, /plus 40% within 6 of your turns/);
  assert.doesNotMatch(text(sec(cfg(c => { c.Loans.enabled = false; }), 'broke')), /Borrow \d/);
});
test('pets section follows the config and disappears when pets are off', () => {
  const p = text(sec(cfg(c => { c.Pets.eggCost = 150; c.Pets.maxPets = 4; c.PetBattle.strongMult = 2; }), 'pets'));
  assert.match(p, /hatch an egg for 150 ⚡ \(up to 4 pets\)/); assert.match(p, /strong hit does 2× damage/);
  assert.match(p, /Emberfox/); assert.match(p, /Pyrewolf \(L8\)/); assert.match(p, /Fire beats Grass/);
  assert.equal(sec(cfg(c => { c.Pets.enabled = false; }), 'pets'), null);
});
test('egg chances across the pet table add up to 100%', () => {
  const html = sec(cfg(), 'pets');
  const table = html.slice(html.indexOf('<h3>The pets</h3>'), html.indexOf('<h3>Pet battles</h3>'));
  const sum = chances(table).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.7, `sums to ${sum}`);
});
test('custom species from the Sheet replace the built-in list', () => {
  const p = text(sec(cfg(c => { c.PetSpecies = [{ id: 'x', name: 'Glorp', emoji: '👾', element: 'Shadow', rarity: 'common', base: {}, grow: [] }]; }), 'pets'));
  assert.match(p, /Glorp/); assert.doesNotMatch(p, /Emberfox/); assert.match(p, /100%/);
});
test('text from the config is escaped', () => {
  const c = cfg(c => { c.Wheel_Good[0].label = '<img src=x onerror=alert(1)>'; c.Wheel_Good[0].desc = '"quoted" & <b>bold</b>'; c.Games[0].name = '<script>x</script>'; c.Currencies[1].name = '<i>Gems</i>'; });
  const html = R.rulesHtml(c);
  assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('<script>x')); assert.ok(!html.includes('<i>Gems</i>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(html.includes('&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;'));
});
test('an empty or missing wheel says so instead of crashing', () => {
  const c = cfg(c => { c.Wheel_Good = []; delete c.Wheel_Category; c.Wheel_Jail = null; c.PowerUps = null; });
  let html; assert.doesNotThrow(() => { html = R.rulesHtml(c); });
  assert.match(sec(c, 'good'), /This wheel is empty/);
  assert.doesNotMatch(html, /undefined|NaN/);
});
test('the rules and guide pages exist and link to each other', async () => {
  const fs = await import('node:fs'); const read = (p) => fs.readFileSync(new URL('../../site/' + p, import.meta.url), 'utf8');
  assert.match(read('rules/index.html'), /rulesHtml\(config\)/);
  const guide = read('gm/guide.html');
  assert.match(guide, /href="hotkeys\.html"/); assert.match(guide, /href="\.\.\/rules\/"/);
  assert.match(read('gm/index.html'), /href="guide\.html"/); assert.match(read('index.html'), /href="rules\/"/);
});
test('every hotkey the guide mentions exists in the registry', async () => {
  const fs = await import('node:fs'); const { HOTKEYS } = await import('../../site/js/hotkeys.js');
  const guide = fs.readFileSync(new URL('../../site/gm/guide.html', import.meta.url), 'utf8');
  const combos = [...guide.matchAll(/<kbd>Ctrl<\/kbd>\+<kbd>Alt<\/kbd>\+<kbd>([^<]+)<\/kbd>/g)].map(m => m[1]);
  assert.ok(combos.length >= 8);
  const keys = new Set(HOTKEYS.filter(h => h.mods.includes('C')).map(h => h.keys));
  for (const k of combos) assert.ok(keys.has(k), `guide mentions Ctrl+Alt+${k}`);
});
