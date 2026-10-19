// Config doctor (loop 25). Pure: takes a merged config (defaults + Sheet) and returns a list of findings,
// so a typo in the Sheet shows up as a readable note in the GM window instead of a broken game mid-session.
//   level 'error' = the game will misbehave or crash · 'warn' = works, but probably not what you meant · 'info' = FYI
import { DEFAULT_CONFIG } from './config-default.js';
import * as G from './games.js';
import { buyInMech } from './buyin.js';
import { EXTRA_LIST } from './games-extra.js';

export const OUTCOME_VERBS = ['NOTHING', 'GOLD_DELTA', 'PCT_GOLD', 'GO_TO_JAIL', 'JAIL_ESCALATE', 'JAIL_RELEASE', 'JAIL_TIER_DOWN',
  'JAIL_SKIP_SPIN', 'JAIL_SPIN_TWICE', 'COMMISSARY', 'SHAKEDOWN', 'SKIP_TURN', 'BUFF_NEXT_WIN', 'PARDON_GRANT', 'SPIN_METHOD_AGAIN',
  'SECONDARY_RANDOM_GAIN', 'SECONDARY_LOSE_RANDOM', 'STEAL_FROM_RICHEST', 'PAY_TO_POOREST', 'COLLECTOR', 'POWER_DELTA', 'EGG_GRANT',
  'PET_HEAL', 'WILD_ENCOUNTER', 'TELEPORT_RANDOM', 'TELEPORT_CHOICE', 'FORCED_MARCH', 'VOID_LONG_WAY', 'VOID_EXILE', 'VOID_REWIND', 'ADJUDICATE'];
export const MOVE_VERBS = ['MOVE_DICE', 'MOVE_ONE', 'MOVE_D4', 'MOVE_2D6', 'MOVE_LONGWALK', 'MOVE_STAY', 'MOVE_TELEPORT', 'MOVE_MAGNET',
  'MOVE_CANDY', 'MOVE_SWAP', 'MOVE_BENEV'];
// params a verb cannot work without (number-valued)
export const VERB_PARAMS = { GOLD_DELTA: ['amount'], PCT_GOLD: ['pct'], BUFF_NEXT_WIN: ['mult'], STEAL_FROM_RICHEST: ['amount'],
  PAY_TO_POOREST: ['amount'], SECONDARY_RANDOM_GAIN: ['units'], SECONDARY_LOSE_RANDOM: ['units'], COLLECTOR: ['perTurn', 'turns'],
  POWER_DELTA: ['amount'], FORCED_MARCH: ['steps'] };
export const CORE_GAMES = ['fifty', 'bigwheel', 'roulette', 'crash', 'mines', 'blackjack', 'baccarat', 'plinko', 'hilo', 'dice', 'slots', 'keno', 'placeholder'];
export const KNOWN_GAMES = [...CORE_GAMES, ...EXTRA_LIST.map(g => g.id)];
export const KNOWN_THEMES = ['noir', 'vapor', 'felt', 'riviera'];
export const BUYIN_MECHS = ['flat', 'tithe', 'auction', 'loan', 'charity', 'work', 'sacrifice', 'double'];
export const TILE_TYPES = ['GAME', 'GOOD', 'BAD', 'JAIL', 'SHOP', 'START'];
const OUTCOME_WHEELS = ['Wheel_Start', 'Wheel_Void', 'Wheel_Good', 'Wheel_Bad'];
export const RTP_HIGH = 1.02, RTP_LOW = 0.8;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numish = (v) => v !== '' && v != null && Number.isFinite(Number(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Baccarat outcome chances for an 8-deck shoe (standard published figures).
const BAC = { player: 0.446247, banker: 0.458597, tie: 0.095156 };

// Expected return of each game at the configured odds, as [{ id, label, rtp }]. Closed-form only —
// blackjack depends on how it's played, so it is left out (test/balance.mjs simulates it).
export function gameReturns(config) {
  const st = { oddsOverrides: {} }, out = [];
  const has = (id) => (config.Games || []).some(g => g && g.id === id && g.built);
  const odds = (id) => G.effectiveOdds(config, st, id);
  const push = (id, label, rtp) => { if (Number.isFinite(rtp)) out.push({ id, label, rtp }); };
  try { if (has('fifty')) { const o = odds('fifty'); push('fifty', '50/50 Wheel', Number(o.winChance) * (1 + Number(o.payout))); } } catch { /* reported by validate */ }
  try { if (has('bigwheel')) { const seg = odds('bigwheel').segments || []; const t = seg.reduce((s, x) => s + Number(x.weight), 0); push('bigwheel', 'Big Wheel', seg.reduce((s, x) => s + Number(x.weight) * Number(x.mult), 0) / t); } } catch { /* */ }
  try { if (has('roulette')) { const o = odds('roulette'); push('roulette', 'Roulette (red/black)', 18 / o.pockets * (1 + Number(o.even))); push('roulette', 'Roulette (dozen)', 12 / o.pockets * (1 + Number(o.dozen))); push('roulette', 'Roulette (single number)', 1 / o.pockets * (1 + Number(o.straight))); } } catch { /* */ }
  try { if (has('crash')) push('crash', 'Crash', 1 - Number(odds('crash').houseEdge)); } catch { /* */ }
  try { if (has('mines')) { const o = odds('mines'); push('mines', 'Mines (one pick)', (o.grid - o.mines) / o.grid * G.minesMult(o, 1)); } } catch { /* */ }
  try { if (has('baccarat')) { const o = odds('baccarat'); push('baccarat', 'Baccarat (player)', BAC.player * (1 + Number(o.player)) + BAC.tie); push('baccarat', 'Baccarat (banker)', BAC.banker * (1 + Number(o.banker)) + BAC.tie); push('baccarat', 'Baccarat (tie)', BAC.tie * (1 + Number(o.tie))); } } catch { /* */ }
  try { if (has('plinko')) { const m = G.plinkoMults(odds('plinko')), n = m.length - 1; push('plinko', 'Plinko', m.reduce((s, x, k) => s + G.binom(n, k) * x, 0) / 2 ** n); } } catch { /* */ }
  try { if (has('hilo')) push('hilo', 'Hi-Lo (per call)', 1 - Number(odds('hilo').houseEdge)); } catch { /* */ }
  try { if (has('dice')) push('dice', 'Dice (under 50)', G.diceChance('under', 50) / 100 * G.diceMult(odds('dice'), 'under', 50)); } catch { /* */ }
  try { if (has('slots')) push('slots', 'Slots', G.slotsRtp(G.slotsSymbols(odds('slots')))); } catch { /* */ }
  try { if (has('keno')) { const R = G.kenoRules(odds('keno')); for (let k = 1; k <= R.maxPicks; k++) push('keno', `Keno (${k} pick${k === 1 ? '' : 's'})`, G.kenoRtp(R, k)); } } catch { /* */ }
  // plug-in games: each reports its own closed-form returns where the maths allows
  for (const X of EXTRA_LIST) { if (!has(X.id) || !X.returns) continue; try { for (const r of X.returns(odds(X.id))) push(X.id, r.label, r.rtp); } catch { /* reported by validate */ } }
  return out;
}

function checkWheel(add, tab, rows, { verbs = null, needVerb = true } = {}) {
  if (!Array.isArray(rows)) { add('error', tab, 'This tab should be a list of rows.'); return; }
  if (!rows.length) { add('error', tab, 'The wheel has no rows — it cannot spin.'); return; }
  let total = 0; const seen = new Set();
  rows.forEach((r, i) => {
    const where = `Row ${i + 1}${r && r.label ? ` (“${r.label}”)` : ''}`;
    if (!isObj(r)) { add('error', tab, `${where} is not a row.`); return; }
    if (!r.label) add('error', tab, `${where} has no label.`);
    else if (seen.has(r.label)) add('warn', tab, `Two rows are both called “${r.label}” — Nudge and the wheel legend can't tell them apart.`);
    seen.add(r.label);
    if (!numish(r.weight) || Number(r.weight) < 0) add('error', tab, `${where}: weight must be a number, 0 or more (got ${JSON.stringify(r.weight)}).`);
    else total += Number(r.weight);
    if (needVerb) {
      if (!r.verb) add('error', tab, `${where} has no verb, so nothing would happen.`);
      else if (verbs && !verbs.includes(r.verb)) add('error', tab, `${where}: “${r.verb}” is not a verb the game knows.`);
      for (const k of VERB_PARAMS[r.verb] || []) if (!numish(r.params?.[k])) add('error', tab, `${where}: ${r.verb} needs a number for “${k}”.`);
      if (r.verb === 'PCT_GOLD' && numish(r.params?.pct) && Math.abs(Number(r.params.pct)) > 100) add('warn', tab, `${where}: ${r.params.pct}% is more than everything a player has.`);
    }
  });
  if (total <= 0) add('error', tab, 'Every weight is 0 — the wheel cannot land on anything.');
}

function checkNumbers(add, tab, obj, spec) {
  if (!isObj(obj)) { add('error', tab, 'This tab should be a list of settings (name → value).'); return; }
  for (const [key, [min, max]] of Object.entries(spec)) {
    const v = obj[key];
    if (v == null || v === '') { add('warn', tab, `“${key}” is missing — the built-in value will be assumed where possible.`); continue; }
    if (!numish(v)) { add('error', tab, `“${key}” must be a number (got ${JSON.stringify(v)}).`); continue; }
    if (Number(v) < min || Number(v) > max) add('error', tab, `“${key}” is ${v}; it has to be between ${min} and ${max}.`);
  }
}

export function validateConfig(config) {
  const out = [];
  const add = (level, tab, msg) => out.push({ level, tab, msg });
  if (!isObj(config)) { add('error', 'Config', 'No config loaded.'); return out; }
  for (const tab of Object.keys(DEFAULT_CONFIG)) if (config[tab] == null) add('error', tab, 'Tab is missing entirely.');
  for (const tab of Object.keys(config)) if (!(tab in DEFAULT_CONFIG)) add('info', tab, 'Unknown tab — the game ignores it.');

  // Config
  if (isObj(config.Config)) {
    const BIG = 1e9;
    checkNumbers(add, 'Config', config.Config, { StartingBank: [0, BIG], MinBet: [1, BIG], VoidChance: [0, 1], BattleMinWager: [0, BIG],
      JailBuyoutT1: [0, BIG], JailBuyoutT2: [0, BIG], JailBuyoutT3: [0, BIG], JailBuyoutT4: [0, BIG], JailSkillCheckStake: [0, BIG],
      HouseEdgeMultiplier: [0, 10], LongWalkMaxSteps: [1, 200], BenevolenceSteps: [1, 50] });
    const c = config.Config;
    if (!Array.isArray(c.QuickBets) || !c.QuickBets.length) add('warn', 'Config', 'QuickBets is empty — the GM will have to type every bet.');
    else for (const q of c.QuickBets) if (q !== 'ALL_IN' && !(numish(q) && Number(q) > 0)) add('error', 'Config', `QuickBets: “${q}” is not an amount (use numbers or ALL_IN).`);
    if (numish(c.MinBet) && numish(c.StartingBank) && Number(c.MinBet) > Number(c.StartingBank)) add('warn', 'Config', `MinBet (${c.MinBet}) is more than the StartingBank (${c.StartingBank}) — nobody can afford a first bet.`);
    if (numish(c.HouseEdgeMultiplier) && Number(c.HouseEdgeMultiplier) !== 1) add('info', 'Config', `HouseEdgeMultiplier is ${c.HouseEdgeMultiplier}: every game profit is scaled by it.`);
    if (c.GoldCanGoNegative === false) add('warn', 'Config', 'GoldCanGoNegative is FALSE, but the game does not enforce a zero floor yet — Gold can still go negative.');
    const buy = [c.JailBuyoutT1, c.JailBuyoutT2, c.JailBuyoutT3, c.JailBuyoutT4].map(Number);
    if (buy.every(Number.isFinite) && buy.some((b, i) => i && b < buy[i - 1])) add('warn', 'Config', 'Jail buyouts get cheaper at a deeper tier.');
  } else add('error', 'Config', 'This tab should be a list of settings (name → value).');

  // Currencies
  const curs = Array.isArray(config.Currencies) ? config.Currencies : null;
  if (!curs) add('error', 'Currencies', 'This tab should be a list of rows.');
  else {
    const names = new Set();
    curs.forEach((c, i) => {
      if (!c || !c.name) { add('error', 'Currencies', `Row ${i + 1} has no name.`); return; }
      if (names.has(c.name)) add('error', 'Currencies', `“${c.name}” is listed twice.`);
      names.add(c.name);
      if (!numish(c.goldRate) || Number(c.goldRate) <= 0) add('error', 'Currencies', `“${c.name}”: goldRate must be a number above 0.`);
    });
    const gold = curs.find(c => c && c.name === 'Gold');
    if (!gold) add('error', 'Currencies', 'There is no “Gold” row — every payout is measured in Gold.');
    else { if (Number(gold.goldRate) !== 1) add('error', 'Currencies', 'Gold\'s goldRate has to be 1.'); if (gold.active === false) add('error', 'Currencies', 'Gold is switched off.'); }
    if (curs.filter(c => c && c.active !== false && c.name !== 'Gold').length === 0) add('warn', 'Currencies', 'No secondary currencies are active — shops, auctions and “random secondary” outcomes do nothing.');
  }

  // Board
  const B = config.Board;
  if (!isObj(B)) add('error', 'Board', 'This tab should be a list of settings.');
  else {
    const n = Number(B.cols) * Number(B.rows);
    if (!(Number.isInteger(Number(B.cols)) && Number.isInteger(Number(B.rows)) && n > 0)) add('error', 'Board', 'cols and rows must be whole numbers above 0.');
    const tc = isObj(B.tileCounts) ? B.tileCounts : {};
    const sum = Object.values(tc).reduce((s, v) => s + (Number(v) || 0), 0);
    if (n > 0 && sum !== n) add('error', 'Board', `Tile counts add up to ${sum}, but a ${B.cols}×${B.rows} board has ${n} tiles. The board cannot be built.`);
    for (const t of Object.keys(tc)) if (!TILE_TYPES.includes(t)) add('error', 'Board', `“${t}” is not a tile type (${TILE_TYPES.join(', ')}).`);
    if (!(Number(tc.START) >= 1)) add('error', 'Board', 'There has to be at least one START tile.');
    if (!(Number(tc.GAME) >= 1)) add('warn', 'Board', 'There are no GAME tiles — no minigames will ever be played.');
    if (!(Number(tc.JAIL) >= 1)) add('warn', 'Board', 'There is no JAIL tile; “Go to Jail” has nowhere to send people.');
    for (const [idx, type] of Object.entries(B.pins || {})) {
      if (!(Number(idx) >= 0 && Number(idx) < n)) add('error', 'Board', `Pinned tile ${idx} is off the board (0–${n - 1}).`);
      if (!(Number(tc[type]) >= 1)) add('error', 'Board', `Tile ${idx} is pinned as ${type}, but the counts include no ${type} tile.`);
    }
    const cw = isObj(B.colorWeights) ? Object.entries(B.colorWeights) : [];
    if (!cw.length || cw.reduce((s, [, w]) => s + (Number(w) || 0), 0) <= 0) add('error', 'Board', 'colorWeights needs at least one colour with a weight above 0.');
    const boardColors = new Set(cw.map(([c]) => c));
    for (const r of Array.isArray(config.Wheel_Color) ? config.Wheel_Color : []) if (r && r.color && !boardColors.has(r.color)) add('warn', 'Wheel_Color', `“${r.label}” sends Candy Land to ${r.color}, but no tile is ${r.color}.`);
  }

  // Games
  const games = Array.isArray(config.Games) ? config.Games : null;
  if (!games) add('error', 'Games', 'This tab should be a list of rows.');
  else {
    const ids = new Set();
    for (const g of games) {
      if (!g || !g.id) { add('error', 'Games', 'A row has no id.'); continue; }
      if (ids.has(g.id)) add('error', 'Games', `“${g.id}” is listed twice.`);
      ids.add(g.id);
      if (g.built && !KNOWN_GAMES.includes(g.id)) add('error', 'Games', `“${g.id}” is marked built, but no such game exists in the code. (See the Games tab of the built-in config for the ${KNOWN_GAMES.length - 1} ids that exist.)`);
      if (g.odds != null && !isObj(g.odds)) add('error', 'Games', `“${g.id}”: odds must be a {…} object.`);
    }
    for (const id of KNOWN_GAMES) {
      const row = games.find(g => g && g.id === id);
      if (!row) add(id === 'placeholder' ? 'error' : 'warn', 'Games', id === 'placeholder' ? 'The “placeholder” (GM Call) row is missing — tiles with an unbuilt game have nothing to fall back on.' : `“${id}” has no row, so it will never appear on the board. Add the row to bring it back.`);
      else if (!row.built && id !== 'placeholder') add('info', 'Games', `“${id}” is switched off (built = false).`);
    }
    if (!games.some(g => g && g.built && !g.hidden)) add('error', 'Games', 'No game is switched on.');
    const st = { oddsOverrides: {} }, on = (id) => games.some(g => g && g.id === id && g.built), odds = (id) => G.effectiveOdds(config, st, id);
    if (on('fifty')) { const o = odds('fifty'); if (!(Number(o.winChance) > 0 && Number(o.winChance) <= 1)) add('error', 'Games', 'fifty: winChance must be between 0 and 1.'); }
    if (on('bigwheel')) { const seg = odds('bigwheel').segments; if (!Array.isArray(seg) || !seg.length) add('error', 'Games', 'bigwheel: needs a list of segments.'); else checkWheel((l, t, m) => add(l, 'Games', 'bigwheel — ' + m), 'Games', seg, { needVerb: false }), seg.forEach(s => { if (!numish(s?.mult) || Number(s.mult) < 0) add('error', 'Games', `bigwheel — segment “${s?.label}” needs a mult of 0 or more.`); }); }
    if (on('roulette')) { const o = odds('roulette'); if (![37, 38].includes(Number(o.pockets))) add('warn', 'Games', `roulette: ${o.pockets} pockets — the wheel is drawn for 37.`); }
    if (on('mines')) { const o = odds('mines'); if (!(Number(o.mines) >= 1 && Number(o.mines) < Number(o.grid))) add('error', 'Games', 'mines: mines must be at least 1 and fewer than the grid size.'); }
    if (on('crash')) { const o = odds('crash'); if (!(Number(o.houseEdge) >= 0 && Number(o.houseEdge) < 1)) add('error', 'Games', 'crash: houseEdge must be between 0 and 1.'); if (!(Number(o.growthPerSec) > 0)) add('error', 'Games', 'crash: growthPerSec must be above 0 or the rocket never climbs.'); }
    if (on('plinko')) { const m = odds('plinko').mults; if (!Array.isArray(m) || m.length < 3 || m.some(x => !numish(x) || Number(x) < 0)) add('error', 'Games', 'plinko: mults must be a list of 3+ numbers, none below 0.'); else if (m.length > 17) add('warn', 'Games', `plinko: ${m.length} slots is a lot — the board gets hard to read past 17.`); }
    if (on('blackjack')) { const o = odds('blackjack'); if (!(Number(o.decks) >= 1 && Number(o.decks) <= 8)) add('error', 'Games', 'blackjack: decks must be 1–8.'); if (!(Number(o.maxHands) >= 1)) add('error', 'Games', 'blackjack: maxHands must be at least 1.'); if (Number(o.blackjackPays) < 1.5) add('info', 'Games', `blackjack pays ${o.blackjackPays}:1 on a natural (3:2 = 1.5 is the friendly standard).`); }
    if (on('dice')) { const o = odds('dice'); if (!(Number(o.minChance) >= 1 && Number(o.maxChance) <= 98 && Number(o.minChance) < Number(o.maxChance))) add('error', 'Games', 'dice: needs 1 ≤ minChance < maxChance ≤ 98.'); }
    if (on('slots')) { const raw = odds('slots').symbols; if (raw != null && (!Array.isArray(raw) || raw.length < 2 || raw.some(s => !s || !s.id || !s.icon || !(Number(s.weight) > 0)))) add('error', 'Games', 'slots: every symbol needs an id, an icon and a weight above 0 (at least 2 symbols). Until fixed, the built-in reels are used.'); }
    if (on('keno')) { const R = G.kenoRules(odds('keno')); if (!(R.drawn < R.numbers && R.maxPicks <= R.numbers && R.maxPicks >= 1)) add('error', 'Games', 'keno: needs drawn < numbers and 1 ≤ maxPicks ≤ numbers.'); }
    for (const r of gameReturns(config)) {
      const pct = (r.rtp * 100).toFixed(1) + '%';
      if (r.rtp > RTP_HIGH) add('warn', 'Games', `${r.label} returns ${pct} — players profit on average, so Gold inflates fast.`);
      else if (r.rtp < RTP_LOW) add('warn', 'Games', `${r.label} returns only ${pct} — harsh; players bleed Gold quickly.`);
    }
  }

  // Wheels
  for (const tab of OUTCOME_WHEELS) checkWheel(add, tab, config[tab], { verbs: OUTCOME_VERBS });
  checkWheel(add, 'Wheel_Method', config.Wheel_Method, { verbs: MOVE_VERBS });
  checkWheel(add, 'Wheel_Color', config.Wheel_Color, { needVerb: false });
  checkWheel(add, 'Wheel_Category', config.Wheel_Category, { needVerb: false });
  checkWheel(add, 'Wheel_Battle', config.Wheel_Battle, { needVerb: false });
  checkWheel(add, 'Wheel_BuyIn', config.Wheel_BuyIn, { needVerb: false });
  for (const r of Array.isArray(config.Wheel_Battle) ? config.Wheel_Battle : []) {
    if (r && r.auto && !['coin', 'card', 'dice'].includes(r.auto)) add('error', 'Wheel_Battle', `“${r.label}”: auto must be coin, card or dice (or left empty for a contest the GM judges).`);
    if (r && r.petBattle && config.Pets && config.Pets.enabled === false) add('warn', 'Wheel_Battle', `“${r.label}” is a pet battle, but pets are switched off.`);
  }
  for (const r of Array.isArray(config.Wheel_BuyIn) ? config.Wheel_BuyIn : []) {
    if (r && r.mech && !BUYIN_MECHS.includes(r.mech)) add('error', 'Wheel_BuyIn', `“${r.label}”: mech “${r.mech}” is unknown (${BUYIN_MECHS.join(', ')}).`);
    else if (r && !buyInMech(r)) add('info', 'Wheel_BuyIn', `“${r.label}” is not a buy-in the game can run by itself — the GM settles it by hand.`);
  }
  // Jail wheel: per-tier weights
  const jail = config.Wheel_Jail;
  if (!Array.isArray(jail) || !jail.length) add('error', 'Wheel_Jail', 'The wheel has no rows — nobody could ever leave jail.');
  else {
    const totals = { 1: 0, 2: 0, 3: 0, 4: 0 }; let exits = false;
    jail.forEach((r, i) => {
      const where = `Row ${i + 1}${r && r.label ? ` (“${r.label}”)` : ''}`;
      if (!isObj(r) || !r.label) { add('error', 'Wheel_Jail', `${where} has no label.`); return; }
      if (!r.verb) add('error', 'Wheel_Jail', `${where} has no verb.`);
      else if (!OUTCOME_VERBS.includes(r.verb)) add('error', 'Wheel_Jail', `${where}: “${r.verb}” is not a verb the game knows.`);
      if (!isObj(r.weights)) { add('error', 'Wheel_Jail', `${where} needs weights for tiers 1–4.`); return; }
      for (const t of [1, 2, 3, 4]) { const w = r.weights[t]; if (!numish(w) || Number(w) < 0) add('error', 'Wheel_Jail', `${where}: tier ${t} weight must be a number, 0 or more.`); else totals[t] += Number(w); }
      if (r.verb === 'JAIL_RELEASE' || r.verb === 'JAIL_TIER_DOWN') exits = true;
    });
    for (const t of [1, 2, 3, 4]) if (totals[t] <= 0) add('error', 'Wheel_Jail', `Tier ${t} has no weight at all — the wheel cannot spin there.`);
    if (!exits) add('warn', 'Wheel_Jail', 'No row releases a player or lowers their tier — the only way out is paying.');
  }

  // Side systems
  const BIG = 1e9;
  if (config.Auction != null) checkNumbers(add, 'Auction', config.Auction, { minIncrement: [1, BIG], openingPct: [0, 10], callsToSell: [1, 10] });
  if (config.Loans != null) {
    checkNumbers(add, 'Loans', config.Loans, { minPrincipal: [1, BIG], maxPrincipal: [1, BIG], interestPct: [0, 1000], termTurns: [1, 100], penaltyPct: [0, 1000], garnishPerTurn: [1, BIG], maxOpenLoans: [1, 20] });
    if (isObj(config.Loans) && Number(config.Loans.minPrincipal) > Number(config.Loans.maxPrincipal)) add('error', 'Loans', 'minPrincipal is larger than maxPrincipal.');
  }
  if (config.Pets != null) {
    checkNumbers(add, 'Pets', config.Pets, { maxPets: [1, 12], eggCost: [0, 1000], reviveCost: [0, 1000], xpPerPower: [0, 1000], maxLevel: [1, 100] });
    if (isObj(config.Pets) && isObj(config.Pets.gain)) for (const [k, v] of Object.entries(config.Pets.gain)) { if (!numish(v) || Number(v) < 0) add('error', 'Pets', `gain.${k} must be a number, 0 or more.`); }
    if (isObj(config.Pets) && Number(config.Pets.eggCost) > 1000) add('error', 'Pets', 'eggCost is above the 1,000 Power cap — nobody could ever buy an egg.');
  }
  if (config.PetBattle != null) {
    checkNumbers(add, 'PetBattle', config.PetBattle, { maxRounds: [1, 500], bossHpScale: [0.1, 20], strongMult: [1, 10], resistMult: [0, 1], dropChance: [0, 1] });
  }
  if (config.Raid != null) {
    checkNumbers(add, 'Raid', config.Raid, { minParty: [1, 12], maxParty: [1, 12], hpPerMember: [0, 10], goldShare: [0, 10], maxRounds: [1, 500] });
    if (isObj(config.Raid) && Number(config.Raid.minParty) > Number(config.Raid.maxParty)) add('error', 'Raid', 'minParty is larger than maxParty.');
  }
  const STAT = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const checkCreatures = (tab, needsLevel) => {
    const rows = config[tab]; if (rows == null) return;
    if (!Array.isArray(rows)) { add('error', tab, 'This tab should be a list of rows.'); return; }
    const ids = new Set();
    for (const r of rows) {
      if (!r || !r.id || !r.name) { add('error', tab, 'A row has no id or name.'); continue; }
      if (ids.has(r.id)) add('error', tab, `“${r.id}” is listed twice.`);
      ids.add(r.id);
      const stats = needsLevel ? r.stats : r.base;
      if (!isObj(stats) || STAT.some(s => !numish(stats[s]))) add('error', tab, `“${r.name}” needs all six stats (${STAT.join(', ')}) under ${needsLevel ? 'stats' : 'base'}.`);
      if (needsLevel && !(Number(r.level) >= 1)) add('error', tab, `“${r.name}” needs a level of 1 or more.`);
    }
  };
  checkCreatures('PetSpecies', false); checkCreatures('PetBosses', true); checkCreatures('RaidBosses', true);
  if (Array.isArray(config.PetSpecies)) for (const r of config.PetSpecies) if (r && r.evolves != null && (!Array.isArray(r.evolves) || r.evolves.some(e => !e || !e.name || !(Number(e.level) >= 2)))) add('error', 'PetSpecies', `“${r.name}”: evolves must be a list of { level, name, emoji } stages (level 2 or higher).`);

  // Themes, PowerUps
  if (!Array.isArray(config.Themes) || !config.Themes.length) add('error', 'Themes', 'At least one theme is needed.');
  else for (const t of config.Themes) if (!t || !KNOWN_THEMES.includes(t.id)) add('warn', 'Themes', `Theme “${t && t.id}” has no colours in the stylesheet — it would look like the default.`);
  if (Array.isArray(config.SoundPacks)) for (const p of config.SoundPacks) {
    if (!p || !p.themeId) add('error', 'SoundPacks', 'A row has no themeId.');
    else if (p.wave && !['sine', 'square', 'triangle', 'sawtooth'].includes(p.wave)) add('error', 'SoundPacks', `“${p.themeId}”: wave must be sine, square, triangle or sawtooth.`);
  }
  if (!Array.isArray(config.PowerUps)) add('error', 'PowerUps', 'This tab should be a list of rows.');
  else {
    const ids = new Set();
    for (const p of config.PowerUps) {
      if (!p || !p.id) { add('error', 'PowerUps', 'A row has no id.'); continue; }
      if (ids.has(p.id)) add('error', 'PowerUps', `“${p.id}” is listed twice.`);
      ids.add(p.id);
      if (!numish(p.price) || Number(p.price) < 0) add('error', 'PowerUps', `“${p.id}”: price must be a number, 0 or more.`);
      if (p.id === 'hedge' && p.active !== false) add('warn', 'PowerUps', 'Hedge is on sale, but locking a shop rate is not built yet — it does nothing. Set Active to FALSE until it is.');
    }
  }
  const SC = config.ShopConfig;
  if (isObj(SC) && Number(SC.rateMin) > Number(SC.rateMax)) add('error', 'ShopConfig', 'rateMin is larger than rateMax.');
  return out;
}

// What the Sheet changed relative to the built-ins: which tabs it supplies, and which built-in rows it dropped.
// (A Sheet tab replaces the built-in tab wholesale, so rows added to the code after the Sheet was made go missing.)
export function sheetDiff(remoteTabs) {
  const out = { fromSheet: [], fromDefaults: [], dropped: [] };
  if (!isObj(remoteTabs)) { out.fromDefaults = Object.keys(DEFAULT_CONFIG); return out; }
  const keyOf = (r) => (r && (r.id || r.label || r.name)) || null;
  for (const tab of Object.keys(DEFAULT_CONFIG)) {
    if (remoteTabs[tab] == null) { out.fromDefaults.push(tab); continue; }
    out.fromSheet.push(tab);
    const def = DEFAULT_CONFIG[tab], got = remoteTabs[tab];
    if (Array.isArray(def) && Array.isArray(got)) {
      const have = new Set(got.map(keyOf));
      for (const r of def) { const k = keyOf(r); if (k && !have.has(k)) out.dropped.push({ tab, key: k }); }
    } else if (isObj(def) && isObj(got)) {
      for (const k of Object.keys(def)) if (!(k in got)) out.dropped.push({ tab, key: k });
    }
  }
  return out;
}

export function summarize(findings) {
  const n = (l) => findings.filter(f => f.level === l).length;
  return { errors: n('error'), warnings: n('warn'), infos: n('info'), ok: n('error') === 0 };
}

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
export function reportHtml(findings, esc = (s) => String(s)) {
  const s = summarize(findings);
  if (!findings.length) return '<p class="cfg-ok">✅ Config looks good — nothing to report.</p>';
  const order = { error: 0, warn: 1, info: 2 };
  const rows = [...findings].sort((a, b) => order[a.level] - order[b.level] || a.tab.localeCompare(b.tab));
  return `<p class="cfg-sum">${s.errors ? `⛔ <b>${s.errors}</b> problem${s.errors === 1 ? '' : 's'} to fix` : '✅ No blocking problems'} · ⚠️ ${s.warnings} warning${s.warnings === 1 ? '' : 's'} · ℹ️ ${s.infos} note${s.infos === 1 ? '' : 's'}</p>
<table class="cfg-table"><tbody>${rows.map(f => `<tr class="cfg-${f.level}"><td>${ICON[f.level]}</td><td><b>${esc(f.tab)}</b></td><td>${esc(f.msg)}</td></tr>`).join('')}</tbody></table>`;
}
