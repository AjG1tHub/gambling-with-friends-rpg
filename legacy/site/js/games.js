// Minigame contract + settlement chain + power-ups (Phase 4).
// A game lives in state.game = { id, playerId, wagers, phase, view, secret, pending, startedTs }.
// The GM view drives it with gameAction(); the player view renders state.game.
// Money only moves in settle(), which applies the full chain:
//   buff (Lucky Streak / Cursed / Yard Time) → High Roller ×2 → Floor → Social Barter cut.
import { weightedIndex, shuffle } from './rng.js';
import { log, credit } from './state.js';
import { EXTRA, EXTRA_ODDS } from './games-extra.js';

// ── Odds (live-adjustable) ───────────────────────────────────────
export function gameDef(config, id) { return config.Games.find(g => g.id === id) || null; }
// Built-in fallbacks for the Phase 4b games, so a Sheet row with Odds = {} still plays.
export const PLINKO_DEFAULT_MULTS = [33, 11, 4, 2, 1, 0.6, 0.3, 0.6, 1, 2, 4, 11, 33];
// Slots: three reels, same weighted strip on each. `three` / `two` = total return for 3 / exactly 2 of a kind.
export const SLOTS_DEFAULT_SYMBOLS = [
  { id: 'cherry',  icon: '🍒', weight: 30, three: 4,   two: 2 },
  { id: 'lemon',   icon: '🍋', weight: 26, three: 6,   two: 0 },
  { id: 'bell',    icon: '🔔', weight: 20, three: 12,  two: 0 },
  { id: 'star',    icon: '⭐', weight: 12, three: 25,  two: 2 },
  { id: 'diamond', icon: '💎', weight: 8,  three: 60,  two: 3 },
  { id: 'seven',   icon: '7️⃣', weight: 4,  three: 500, two: 5 },
];
// Keno: 40 numbers, 10 drawn. pays[picks][hits] = total return (missing = 0). Every row returns ~93–96%.
export const KENO_DEFAULT_PAYS = {
  1: { 1: 3.8 },
  2: { 1: 1, 2: 9.5 },
  3: { 2: 3, 3: 44 },
  4: { 2: 1.5, 3: 9, 4: 110 },
  5: { 2: 1, 3: 3, 4: 30, 5: 400 },
  6: { 3: 3, 4: 12, 5: 110, 6: 1500 },
  7: { 3: 2, 4: 6, 5: 35, 6: 300, 7: 2500 },
  8: { 3: 1, 4: 4, 5: 18, 6: 120, 7: 800, 8: 5000 },
  9: { 3: 1, 4: 2, 5: 9, 6: 55, 7: 300, 8: 2000, 9: 5000 },
  10: { 0: 3, 4: 2, 5: 6, 6: 25, 7: 150, 8: 1000, 9: 5000, 10: 10000 },
};
const BUILTIN_ODDS = {
  fifty:     { winChance: 0.5, payout: 1.0 },
  bigwheel:  { segments: [
    { label: '1×', mult: 1, weight: 24 }, { label: '2×', mult: 2, weight: 15 }, { label: '3×', mult: 3, weight: 8 }, { label: '5×', mult: 5, weight: 4 },
    { label: '10×', mult: 10, weight: 2 }, { label: '20×', mult: 20, weight: 1 }, { label: 'LOSE', mult: 0, weight: 18 }] },
  roulette:  { pockets: 37, straight: 35, dozen: 2, even: 1 },
  crash:     { houseEdge: 0.04, growthPerSec: 0.10, maxMult: 50 },
  mines:     { grid: 25, mines: 3, houseEdge: 0.03 },
  slots:     { symbols: SLOTS_DEFAULT_SYMBOLS },
  keno:      { numbers: 40, drawn: 10, maxPicks: 10, pays: KENO_DEFAULT_PAYS },
  hilo:      { houseEdge: 0.03, maxMult: 100 },
  dice:      { houseEdge: 0.03, minChance: 2, maxChance: 95 },
  blackjack: { blackjackPays: 1.5, dealerHitsSoft17: 0, decks: 6, maxHands: 4, insurance: 1, splitAcesOneCard: 1 },
  baccarat:  { player: 1, banker: 0.95, tie: 8, decks: 8 },
  plinko:    { mults: PLINKO_DEFAULT_MULTS },
};
export function effectiveOdds(config, state, id) {
  const base = gameDef(config, id)?.odds || {};
  const over = state.oddsOverrides?.[id] || {};
  return { ...(BUILTIN_ODDS[id] || EXTRA_ODDS[id] || {}), ...base, ...over };
}
// Plug-in games (games-extra.js): what they are handed on every call.
export const extraDef = (id) => EXTRA[id] || null;
export function extraCtx(config, state, rng, g, now = Date.now()) {
  return { rng, now, state, odds: effectiveOdds(config, state, g.id), player: state.players.find(p => p.id === g.playerId) };
}
export const ANIM_MS = 2500;      // the shared screen keeps ticking this long after any game action (cards landing, dice tumbling)
export function houseEdgeMult(config, state) {
  const o = state.oddsOverrides?.HouseEdgeMultiplier;
  return (o != null && !isNaN(o)) ? Number(o) : (Number(config.Config.HouseEdgeMultiplier) || 1);
}

// ── Power-ups ────────────────────────────────────────────────────
export function hasPowerUp(player, id) { return player.heldPowerUps.some(pu => pu.id === id); }
export function takePowerUp(state, player, id) {
  const i = player.heldPowerUps.findIndex(pu => pu.id === id);
  if (i < 0) return null;
  const [pu] = player.heldPowerUps.splice(i, 1);
  log(state, 'POWERUP_USED', player.id, { id });
  return pu;
}
export function buyPowerUp(config, state, player, id) {
  const def = config.PowerUps.find(p => p.id === id && p.active !== false);
  if (!def) return { text: 'Unknown power-up.', error: true };
  const held = player.heldPowerUps.filter(pu => pu.id === id).length;
  if (held >= (Number(def.maxHeld) || 1)) return { text: `${def.name}: max ${def.maxHeld} held.`, error: true };
  if ((player.balances.Gold || 0) < Number(def.price)) return { text: `Need ${def.price} Gold for ${def.name}.`, error: true };
  credit(state, player, 'Gold', -Number(def.price), `Shop: ${def.name}`);
  player.heldPowerUps.push({ id: def.id, name: def.name, type: def.type });
  log(state, 'SHOP_BUY_POWERUP', player.id, { id: def.id, price: def.price });
  return { text: `${player.name} buys ${def.name} for ${def.price} Gold.` };
}
// Weighted pick with optional Nudge (+50% weight to one named outcome)
export function pickWeighted(rng, rows, nudgeLabel) {
  const rows2 = rows.map(r => ({ ...r, weight: Number(r.weight) * (nudgeLabel && r.label === nudgeLabel ? 1.5 : 1) }));
  return weightedIndex(rng, rows2);
}

// ── Roulette table ───────────────────────────────────────────────
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const rouletteColor = (n) => n === 0 ? 'green' : (RED.has(n) ? 'red' : 'black');
export function rouletteWins(bet, n) {
  if (n === 0) return bet.type === 'straight' && Number(bet.number) === 0;
  switch (bet.type) {
    case 'red':   return RED.has(n);
    case 'black': return !RED.has(n);
    case 'odd':   return n % 2 === 1;
    case 'even':  return n % 2 === 0;
    case 'low':   return n >= 1 && n <= 18;
    case 'high':  return n >= 19 && n <= 36;
    case 'dozen1': return n >= 1 && n <= 12;
    case 'dozen2': return n >= 13 && n <= 24;
    case 'dozen3': return n >= 25 && n <= 36;
    case 'col1':  return n % 3 === 1;
    case 'col2':  return n % 3 === 2;
    case 'col3':  return n % 3 === 0;
    case 'straight': return Number(bet.number) === n;
    default: return false;
  }
}
export function roulettePayout(odds, betType) {
  if (betType === 'straight') return Number(odds.straight ?? 35);
  if (betType.startsWith('dozen') || betType.startsWith('col')) return Number(odds.dozen ?? 2);
  return Number(odds.even ?? 1);
}

// ── Crash / Mines math (shared with the player view) ─────────────
export function crashMult(game, now) {
  const t = Math.max(0, (now - game.startedTs) / 1000);
  const m = Math.exp((game.view.growthPerSec || 0.1) * t);
  return Math.min(game.view.maxMult || 50, Math.floor(m * 100) / 100);
}
export function crashHasCrashed(game, now) { return crashMult(game, now) >= game.secret.crashAt; }
export function minesMult(odds, revealedCount) {
  const grid = Number(odds.grid || 25), mines = Number(odds.mines || 3), edge = Number(odds.houseEdge || 0);
  let m = 1;
  for (let i = 0; i < revealedCount; i++) m *= (grid - i) / (grid - mines - i);
  return Math.floor(m * (1 - edge) * 100) / 100;
}

// ── Cards (Blackjack / Baccarat) ─────────────────────────────────
// A card is { r, s, t } — t = the moment it lands on the shared screen, so the
// player view can deal cards one at a time. view.revealAt = when the result shows.
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];
export const cardText = (c) => c.r + c.s;
export const cardIsRed = (c) => c.s === '♥' || c.s === '♦';
function makeShoe(rng, decks, keep) {
  const cards = [];
  for (let d = 0; d < Math.max(1, Math.round(decks)); d++) for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  return shuffle(rng, cards).slice(0, keep);   // only the top of the shoe is ever needed
}
const isTen = (c) => c.r === '10' || c.r === 'J' || c.r === 'Q' || c.r === 'K';
export function bjTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { if (c.r === 'A') { aces++; total += 11; } else total += isTen(c) ? 10 : Number(c.r); }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const bacPoint = (c) => c.r === 'A' ? 1 : isTen(c) ? 0 : Number(c.r);
export const bacTotal = (cards) => cards.reduce((s, c) => s + bacPoint(c), 0) % 10;

// Pure baccarat: takes the top of the shoe in dealing order (P, B, P, B, third cards…)
// and applies the natural + third-card rules. Returns hands, totals and the winner.
export function bacPlay(cards) {
  const shoe = cards.map(c => ({ ...c }));
  const P = [shoe.shift()], B = [shoe.shift()]; P.push(shoe.shift()); B.push(shoe.shift());
  if (bacTotal(P) < 8 && bacTotal(B) < 8) {            // no natural → third-card rules
    let third = null;
    if (bacTotal(P) <= 5) { const c = shoe.shift(); P.push(c); third = bacPoint(c); }
    const b = bacTotal(B);
    const bankerDraws = third === null ? b <= 5
      : b <= 2 || (b === 3 && third !== 8) || (b === 4 && third >= 2 && third <= 7)
        || (b === 5 && third >= 4 && third <= 7) || (b === 6 && (third === 6 || third === 7));
    if (bankerDraws) B.push(shoe.shift());
  }
  const p = bacTotal(P), b = bacTotal(B);
  return { P, B, p, b, winner: p > b ? 'player' : b > p ? 'banker' : 'tie' };
}

// ── Blackjack hands (splits, doubles, insurance) ─────────────────
// view.hands = [{ cards, doubled, done, split, outcome }], view.active = index being played.
// view.insurance = null | 'offered' | 'taken' | 'declined'. Everything is scored in units of the
// ORIGINAL stake: result mult = 1 + (sum of hand profits) + (insurance profit). So one hand
// winning is 2×, two split hands both doubled and lost is −3×, and so on.
const bjHand = (cards, extra = {}) => ({ cards, doubled: false, done: false, split: false, outcome: null, ...extra });
const bjPoint = (c) => c.r === 'A' ? 11 : isTen(c) ? 10 : Number(c.r);
export const bjActiveHand = (v) => v.hands[v.active] || null;
export function bjCanSplit(odds, v) {
  const h = bjActiveHand(v);
  return !!h && !h.done && h.cards.length === 2 && v.hands.length < Number(odds.maxHands ?? 4) && bjPoint(h.cards[0]) === bjPoint(h.cards[1]);
}
export const bjCanDouble = (v) => { const h = bjActiveHand(v); return !!h && !h.done && h.cards.length === 2; };
const bjIsNatural = (v) => v.hands.length === 1 && !v.hands[0].split && v.hands[0].cards.length === 2 && bjTotal(v.hands[0].cards).total === 21;
const bjDealerNatural = (v) => v.dealer.length === 2 && bjTotal(v.dealer).total === 21;

// Move to the next hand that still needs a decision; when there is none, the dealer plays.
function bjAdvance(g, odds, at) {
  const v = g.view;
  for (let i = 0; i < v.hands.length; i++) {
    const h = v.hands[i]; if (h.done) continue;
    if (bjTotal(h.cards).total >= 21) { h.done = true; continue; }      // 21 (or a bust) needs no decision
    v.active = i; return false;
  }
  bjFinish(g, odds, at); return true;
}

// Dealer plays out and every hand is scored.
function bjFinish(g, odds, at) {
  const v = g.view;
  const hole = v.dealer[1]; delete hole.down; hole.flipAt = at + 500;
  let last = hole.flipAt;
  const pNat = bjIsNatural(v), dNat = bjDealerNatural(v);
  const anyLive = v.hands.some(h => bjTotal(h.cards).total <= 21);
  if (anyLive && !pNat && !dNat) {
    for (;;) {
      const d = bjTotal(v.dealer);
      if (d.total > 17 || (d.total === 17 && !(d.soft && Number(odds.dealerHitsSoft17)))) break;
      last += 700; v.dealer.push({ ...g.secret.shoe.shift(), t: last });
    }
  }
  const d = bjTotal(v.dealer).total, bjPays = Number(odds.blackjackPays ?? 1.5);
  let sum = 0;
  for (const h of v.hands) {
    const p = bjTotal(h.cards).total, stake = h.doubled ? 2 : 1; let profit, label;
    if (p > 21)              { profit = -stake; label = `Bust at ${p}`; }
    else if (pNat && dNat)   { profit = 0; label = 'Both have blackjack — push'; }
    else if (pNat)           { profit = bjPays; label = `BLACKJACK! Pays ${bjPays}:1`; }
    else if (dNat)           { profit = -stake; label = 'Dealer blackjack'; }
    else if (d > 21)         { profit = stake; label = `Dealer busts at ${d}`; }
    else if (p > d)          { profit = stake; label = `${p} beats dealer ${d}`; }
    else if (p < d)          { profit = -stake; label = `Dealer ${d} beats ${p}`; }
    else                     { profit = 0; label = `Push at ${d}`; }
    if (h.doubled) label += ' (doubled)';
    h.done = true; h.outcome = { profit, label }; sum += profit;
  }
  let insNote = '';
  if (v.insurance === 'taken') { const ins = dNat ? 1 : -0.5; sum += ins; insNote = dNat ? ' · insurance pays 2:1' : ' · insurance lost'; }
  const mult = Math.round((1 + sum) * 100) / 100;
  const label = v.hands.length === 1 ? v.hands[0].outcome.label + insNote
    : v.hands.map((h, i) => `Hand ${i + 1}: ${h.outcome.label}`).join(' · ') + insNote + ` — net ${sum > 0 ? '+' : ''}${sum}× stake`;
  g.phase = 'done'; v.active = -1; v.revealAt = last + 600; g.result = { mult, label };
}

// ── Hi-Lo (Phase 7 expansion) ────────────────────────────────────
// A card is face up; call HIGHER or LOWER for the next one. Aces are low (A=1 … K=13), the
// deck is endless (every rank equally likely), and an equal card is a free redraw. Each
// correct call multiplies the pot by the fair odds less the house edge; cash out any time.
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));
export function hiloStepMult(odds, rank, dir) {
  const v = RANK_VALUE[rank]; const ways = dir === 'higher' ? 13 - v : v - 1;
  if (!(ways > 0)) return 0;                                   // nothing is higher than a King / lower than an Ace
  return (1 - Number(odds.houseEdge ?? 0.03)) * 12 / ways;
}
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
function hiloDraw(rng, t) { return { r: RANKS[rng.int(0, 12)], s: SUITS[rng.int(0, 3)], t }; }

// ── Dice (Phase 7 expansion) ─────────────────────────────────────
// Roll 1–100. Bet UNDER a target (roll < target) or OVER it (roll > target). The rarer the
// win, the bigger the payout: total return = (1 − edge) × 100 / win-chance%.
export function diceChance(dir, target) { const t = Math.round(Number(target)); return dir === 'under' ? t - 1 : 100 - t; }
export function diceMult(odds, dir, target) {
  const ch = diceChance(dir, target);
  return ch > 0 ? floor2((1 - Number(odds.houseEdge ?? 0.03)) * 100 / ch) : 0;
}
export function diceBetError(odds, dir, target) {
  if (dir !== 'under' && dir !== 'over') return 'Pick UNDER or OVER.';
  const t = Number(target); if (!Number.isInteger(t) || t < 1 || t > 100) return 'Target must be a whole number from 1 to 100.';
  const ch = diceChance(dir, t), lo = Number(odds.minChance ?? 2), hi = Number(odds.maxChance ?? 95);
  if (ch < lo) return `That bet only wins ${ch}% of the time — the table minimum is ${lo}%.`;
  if (ch > hi) return `That bet wins ${ch}% of the time — the table maximum is ${hi}%.`;
  return null;
}
export const DICE_ROLL_MS = 1400;    // how long the number tumbles on the shared screen

// ── Slots (Phase 7 expansion) ────────────────────────────────────
export function slotsSymbols(odds) {
  const list = Array.isArray(odds?.symbols) ? odds.symbols.filter(x => x && x.id && Number(x.weight) > 0) : [];
  return list.length >= 2 ? list : SLOTS_DEFAULT_SYMBOLS;
}
// What a stopped line pays: three of a kind, else exactly two of a kind (any reels), else nothing.
export function slotsPay(symbols, reels) {
  const [a, b, c] = reels.map(i => symbols[i]);
  if (a.id === b.id && b.id === c.id) return { mult: Number(a.three) || 0, label: `${a.icon}${a.icon}${a.icon}`, kind: 'three', symbol: a.id };
  const pair = a.id === b.id || a.id === c.id ? a : b.id === c.id ? b : null;
  if (pair && Number(pair.two) > 0) return { mult: Number(pair.two), label: `${pair.icon}${pair.icon}`, kind: 'two', symbol: pair.id };
  return { mult: 0, label: 'no line', kind: 'none', symbol: null };
}
// Exact expected return of a symbol table (used by the balance report and the tests).
export function slotsRtp(symbols) {
  const total = symbols.reduce((s, x) => s + Number(x.weight), 0); let ev = 0;
  for (const x of symbols) { const p = Number(x.weight) / total; ev += p ** 3 * (Number(x.three) || 0) + 3 * p * p * (1 - p) * (Number(x.two) || 0); }
  return ev;
}
export const SLOTS_REEL_MS = [900, 1500, 2100];   // when each reel stops on the shared screen

// ── Keno (Phase 7 expansion) ─────────────────────────────────────
export function kenoRules(odds) {
  const numbers = Math.round(Number(odds?.numbers)) || 40, drawn = Math.round(Number(odds?.drawn)) || 10;
  const pays = odds?.pays && typeof odds.pays === 'object' && Object.keys(odds.pays).length ? odds.pays : KENO_DEFAULT_PAYS;
  const maxPicks = Math.min(Math.round(Number(odds?.maxPicks)) || 10, Math.max(...Object.keys(pays).map(Number)));
  return { numbers, drawn: Math.min(drawn, numbers), maxPicks, pays };
}
export const kenoPay = (rules, picks, hits) => Number(rules.pays?.[picks]?.[hits]) || 0;
const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
// Chance of exactly `hits` of your `picks` being among the drawn numbers (hypergeometric).
export function kenoHitChance(rules, picks, hits) { return choose(picks, hits) * choose(rules.numbers - picks, rules.drawn - hits) / choose(rules.numbers, rules.drawn); }
export function kenoRtp(rules, picks) { let ev = 0; for (let h = 0; h <= picks; h++) ev += kenoHitChance(rules, picks, h) * kenoPay(rules, picks, h); return ev; }
export const KENO_BALL_MS = 320;                  // gap between drawn balls on the shared screen

// ── Plinko ───────────────────────────────────────────────────────
export const PLINKO_STEP_MS = 230;   // time the ball takes per peg row on the shared screen
export function plinkoMults(odds) {
  const m = Array.isArray(odds?.mults) ? odds.mults.map(Number).filter(x => !isNaN(x)) : [];
  return m.length >= 3 ? m : PLINKO_DEFAULT_MULTS;
}
export function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
// The stage only needs a ticking re-render while something is in motion.
export function gameNeedsTicks(g, now) {
  if (!g) return false;
  if (g.id === 'crash') return g.phase === 'running';
  if (g.view && g.view.animUntil && now < g.view.animUntil) return true;
  return !!(g.view && g.view.revealAt && now < g.view.revealAt + 500);
}

// ── Start / act ──────────────────────────────────────────────────
export function startGame(config, state, rng, gameId, player, wagers) {
  const odds = effectiveOdds(config, state, gameId);
  const g = { id: gameId, playerId: player.id, wagers, phase: 'ready', view: {}, secret: {}, pending: null, startedTs: null, result: null };
  switch (gameId) {
    case 'crash': {
      const edge = Number(odds.houseEdge ?? 0.04);
      const u = rng.next();
      // classic crash distribution: P(crash ≥ x) ≈ (1−edge)/x, capped
      g.secret.crashAt = Math.max(1, Math.min(Number(odds.maxMult || 50), Math.floor(100 * (1 - edge) / (1 - u)) / 100));
      g.view.growthPerSec = Number(odds.growthPerSec || 0.1);
      g.view.maxMult = Number(odds.maxMult || 50);
      break;
    }
    case 'mines': {
      const grid = Number(odds.grid || 25), mines = Number(odds.mines || 3);
      const idxs = Array.from({ length: grid }, (_, i) => i);
      const set = new Set();
      while (set.size < mines) set.add(idxs[rng.int(0, grid - 1)]);
      g.secret.mines = [...set];
      g.view.grid = grid; g.view.minesCount = mines; g.view.revealed = []; g.view.mult = 1;
      break;
    }
    case 'roulette': g.view.bet = null; break;
    case 'blackjack': {
      const now = Date.now();
      g.secret.shoe = makeShoe(rng, Number(odds.decks ?? 6), 48);
      const draw = (t) => ({ ...g.secret.shoe.shift(), t });
      const p1 = draw(now + 300), d1 = draw(now + 650), p2 = draw(now + 1000), d2 = { ...draw(now + 1350), down: true };
      g.view.hands = [bjHand([p1, p2])]; g.view.active = 0; g.view.dealer = [d1, d2];
      g.view.insurance = null; g.view.revealAt = null; g.phase = 'player';
      if (d1.r === 'A' && Number(odds.insurance ?? 1)) { g.view.insurance = 'offered'; g.phase = 'insurance'; }   // decide before the dealer peeks
      else if (bjIsNatural(g.view) || bjDealerNatural(g.view)) bjFinish(g, odds, now + 1350);                     // naturals end the hand on the spot
      break;
    }
    case 'baccarat': g.view.bet = null; g.view.player = []; g.view.banker = []; g.view.revealAt = null; g.phase = 'bet'; break;
    case 'plinko': g.view.mults = plinkoMults(odds); g.view.drop = null; g.view.revealAt = null; break;
    case 'hilo': g.view.cards = [hiloDraw(rng, Date.now() + 250)]; g.view.mult = 1; g.view.steps = 0; g.view.revealAt = null; g.phase = 'running'; break;
    case 'dice': g.view.bet = null; g.view.roll = null; g.view.rollAt = null; g.view.revealAt = null; break;
    case 'slots': g.view.symbols = slotsSymbols(odds).map(x => ({ id: x.id, icon: x.icon })); g.view.reels = null; g.view.spinAt = null; g.view.revealAt = null; break;
    case 'keno': { const R = kenoRules(odds); g.view.numbers = R.numbers; g.view.drawn = R.drawn; g.view.maxPicks = R.maxPicks; g.view.picks = []; g.view.draw = null; g.view.drawAt = null; g.view.revealAt = null; break; }
    default: if (EXTRA[gameId]) EXTRA[gameId].start(g, { rng, now: Date.now(), state, odds, player }); break;
  }
  g.view.animUntil = Date.now() + ANIM_MS;
  state.game = g;
  log(state, 'GAME_START', player.id, { gameId, wagers });
  return g;
}

// Returns { done?: bool, mult?, text }. GM settles when done via settle().
export function gameAction(config, state, rng, action, payload = {}) {
  const g = state.game; if (!g) return { text: 'No game running.' };
  const r = EXTRA[g.id] ? EXTRA[g.id].act(g, action, payload || {}, extraCtx(config, state, rng, g)) : gameActionCore(config, state, rng, action, payload);
  if (state.game === g) g.view.animUntil = Date.now() + ANIM_MS;
  return r;
}
function gameActionCore(config, state, rng, action, payload = {}) {
  const g = state.game; if (!g) return { text: 'No game running.' };
  const odds = effectiveOdds(config, state, g.id);
  const player = state.players.find(p => p.id === g.playerId);
  const spinWheel = (outcomes, weights, colors, wheelName) => {
    const rows = outcomes.map((label, i) => ({ label, weight: weights[i] }));
    const i = pickWeighted(rng, rows, payload.nudgeLabel);
    state.lastSpin = { wheel: wheelName, outcomes, index: i, playerId: player.id, ts: Date.now(), colors };
    return i;
  };
  switch (g.id) {
    case 'fifty': {
      if (action !== 'spin') break;
      const wc = Number(odds.winChance ?? 0.5);
      const i = spinWheel(['WIN', 'LOSE'], [wc, 1 - wc], ['#3f9d5c', '#c0392b'], '50 / 50');
      const mult = i === 0 ? 1 + Number(odds.payout ?? 1) : 0;
      g.pending = { mult, label: i === 0 ? 'WIN' : 'LOSE' };
      state.lastSpin.effect = i === 0 ? `WIN — pays ${odds.payout ?? 1}:1` : 'LOSE — stake gone';
      return { pending: true, text: `50/50: ${g.pending.label}` };
    }
    case 'bigwheel': {
      if (action !== 'spin') break;
      const segs = odds.segments || [];
      const i = spinWheel(segs.map(s => s.label), segs.map(s => Number(s.weight)), null, 'BIG WHEEL');
      const mult = Number(segs[i].mult);
      g.pending = { mult, label: segs[i].label };
      state.lastSpin.effect = mult > 0 ? `Pays ${mult}× your stake` : 'House takes it';
      return { pending: true, text: `Big Wheel: ${segs[i].label}` };
    }
    case 'roulette': {
      if (action === 'bet') { g.view.bet = { type: payload.type, number: payload.number }; return { text: `Bet: ${payload.type}${payload.type === 'straight' ? ' ' + payload.number : ''}` }; }
      if (action !== 'spin' || !g.view.bet) break;
      const n = Number(odds.pockets || 37);
      const outcomes = Array.from({ length: n }, (_, k) => String(k));
      const colors = outcomes.map(k => ({ green: '#1e8449', red: '#c0392b', black: '#1c1c1c' })[rouletteColor(Number(k))]);
      const i = spinWheel(outcomes, outcomes.map(() => 1), colors, 'ROULETTE');
      const won = rouletteWins(g.view.bet, i);
      const mult = won ? 1 + roulettePayout(odds, g.view.bet.type) : 0;
      g.pending = { mult, label: `${i} ${rouletteColor(i)}` };
      g.view.pocket = i;
      state.lastSpin.effect = won ? `${i} ${rouletteColor(i).toUpperCase()} — ${g.view.bet.type} hits, pays ${roulettePayout(odds, g.view.bet.type)}:1` : `${i} ${rouletteColor(i).toUpperCase()} — ${g.view.bet.type} misses`;
      return { pending: true, text: g.pending.label };
    }
    case 'crash': {
      if (action === 'launch') { g.startedTs = Date.now(); g.phase = 'running'; return { text: 'Launched.' }; }
      if (action === 'cashout') {
        if (g.phase !== 'running') break;
        const now = Date.now();
        const m = crashMult(g, now);
        const crashed = m >= g.secret.crashAt;
        g.phase = 'done';
        g.result = crashed ? { mult: 0, label: `CRASHED at ${g.secret.crashAt}×` } : { mult: m, label: `Cashed out at ${m}×` };
        g.view.finalMult = crashed ? g.secret.crashAt : m; g.view.crashed = crashed;
        return { done: true, mult: g.result.mult, text: g.result.label };
      }
      break;
    }
    case 'mines': {
      if (action === 'reveal') {
        const idx = Number(payload.idx);
        if (g.phase === 'done' || g.view.revealed.includes(idx)) break;
        g.phase = 'running';
        if (g.secret.mines.includes(idx)) {
          g.phase = 'done'; g.view.hit = idx; g.view.revealAll = true;
          g.result = { mult: 0, label: `💥 Mine on tile ${idx + 1}` };
          return { done: true, mult: 0, text: g.result.label };
        }
        g.view.revealed.push(idx);
        g.view.mult = minesMult(odds, g.view.revealed.length);
        const safeLeft = Number(odds.grid || 25) - Number(odds.mines || 3) - g.view.revealed.length;
        if (safeLeft === 0) { g.phase = 'done'; g.view.revealAll = true; g.result = { mult: g.view.mult, label: `Cleared the field at ${g.view.mult}×` }; return { done: true, mult: g.view.mult, text: g.result.label }; }
        return { text: `Safe. ${g.view.mult}× (${safeLeft} safe left)` };
      }
      if (action === 'stop') {
        if (g.phase === 'done') break;
        g.phase = 'done'; g.view.revealAll = true;
        const m = g.view.revealed.length ? g.view.mult : 1;
        g.result = { mult: m, label: g.view.revealed.length ? `Stopped at ${m}×` : 'Walked away (push)' };
        return { done: true, mult: m, text: g.result.label };
      }
      break;
    }
    case 'blackjack': {
      const v = g.view, now = Date.now();
      const finished = () => ({ done: true, mult: g.result.mult, text: g.result.label });
      if (g.phase === 'insurance') {
        if (action !== 'insure' && action !== 'decline') break;
        v.insurance = action === 'insure' ? 'taken' : 'declined'; g.phase = 'player';
        if (bjIsNatural(v) || bjDealerNatural(v)) { bjFinish(g, odds, now); return finished(); }
        return { text: action === 'insure' ? 'Insurance taken (costs half the stake). Dealer has no blackjack — play on.' : 'No insurance. Dealer has no blackjack — play on.' };
      }
      if (g.phase !== 'player') break;
      const h = bjActiveHand(v); if (!h) break;
      if (action === 'split') {
        if (!bjCanSplit(odds, v)) break;
        const aces = h.cards[0].r === 'A';
        const moved = h.cards.pop();
        h.cards.push({ ...g.secret.shoe.shift(), t: now + 100 }); h.split = true;              // first hand is dealt first
        const fresh = bjHand([moved, { ...g.secret.shoe.shift(), t: now + 450 }], { split: true });
        v.hands.splice(v.active + 1, 0, fresh);
        if (aces && Number(odds.splitAcesOneCard ?? 1)) { h.done = true; fresh.done = true; }     // split aces get one card each
        if (bjAdvance(g, odds, now + 450)) return finished();
        return { text: `Split — now playing ${v.hands.length} hands.` };
      }
      if (action === 'hit' || action === 'double') {
        if (action === 'double') { if (!bjCanDouble(v)) break; h.doubled = true; }
        const c = { ...g.secret.shoe.shift(), t: now };
        h.cards.push(c);
        const t = bjTotal(h.cards).total;
        if (t >= 21 || action === 'double') {
          h.done = true;
          if (bjAdvance(g, odds, now + 300)) return { ...finished(), text: `${cardText(c)} → ${g.result.label}` };
          return { text: `${cardText(c)} → ${t > 21 ? 'bust' : t}. Next hand.` };
        }
        return { text: `Hit: ${cardText(c)} → ${t}` };
      }
      if (action === 'stand') {
        h.done = true;
        if (bjAdvance(g, odds, now)) return finished();
        return { text: 'Stand. Next hand.' };
      }
      break;
    }
    case 'baccarat': {
      if (action === 'bet') { if (g.phase !== 'bet') break; g.view.bet = payload.side; return { text: `Bet on ${String(payload.side).toUpperCase()}` }; }
      if (action !== 'deal' || g.phase !== 'bet' || !g.view.bet) break;
      const now = Date.now();
      const { P, B, p, b, winner } = bacPlay(makeShoe(rng, Number(odds.decks ?? 8), 6));
      // stagger the cards on the shared screen in dealing order (P, B, P, B, then thirds)
      let t = now; const stamp = (c, extra = 0) => { t += 600 + extra; c.t = t; };
      stamp(P[0]); stamp(B[0]); stamp(P[1]); stamp(B[1]);
      if (P[2]) stamp(P[2], 300); if (B[2]) stamp(B[2], 300);
      const side = g.view.bet;
      const pays = Number(odds[side] ?? ({ player: 1, banker: 0.95, tie: 8 })[side]);
      const mult = side === winner ? 1 + pays : (winner === 'tie' ? 1 : 0);
      g.view.player = P; g.view.banker = B; g.view.winner = winner; g.view.revealAt = t + 700;
      g.phase = 'done';
      g.result = { mult, label: `Player ${p} · Banker ${b} — ${winner === 'tie' ? 'TIE' : winner.toUpperCase() + ' wins'}${side === winner ? `, pays ${pays}:1` : mult === 1 ? ', bet pushes' : ''}` };
      return { done: true, mult, text: g.result.label };
    }
    case 'plinko': {
      if (action !== 'spin') break;
      const mults = plinkoMults(odds), n = mults.length - 1;
      const rows = mults.map((m, k) => ({ label: `${m}×`, weight: binom(n, k) }));
      const k = pickWeighted(rng, rows, payload.nudgeLabel);
      const now = Date.now();
      g.view.mults = mults;
      g.view.drop = { path: shuffle(rng, Array.from({ length: n }, (_, i) => i < k ? 1 : 0)), slot: k, ts: now };
      g.view.revealAt = now + n * PLINKO_STEP_MS + 300;
      g.pending = { mult: mults[k], label: `Slot ${k + 1} · ${mults[k]}×` };
      return { pending: true, text: `Plinko: slot ${k + 1} of ${n + 1} → ${mults[k]}×` };
    }
    case 'hilo': {
      if (g.phase !== 'running') break;
      const v = g.view, now = Date.now(), top = v.cards.at(-1);
      if (action === 'cashout') {
        g.phase = 'done'; v.revealAt = now;
        g.result = { mult: v.mult, label: v.steps ? `Cashed out at ${v.mult}× after ${v.steps} call${v.steps === 1 ? '' : 's'}` : 'Walked away (push)' };
        return { done: true, mult: v.mult, text: g.result.label };
      }
      if (action !== 'higher' && action !== 'lower') break;
      const step = hiloStepMult(odds, top.r, action);
      if (!step) return { text: `Nothing is ${action} than ${top.r === 'A' ? 'an Ace' : 'a King'} — pick the other way.`, error: true };
      const next = hiloDraw(rng, now + 150); v.cards.push(next); if (v.cards.length > 8) v.cards.shift();
      const a = RANK_VALUE[top.r], b = RANK_VALUE[next.r];
      if (a === b) return { text: `${cardText(next)} — same rank, free redraw.` };
      if ((action === 'higher') === (b > a)) {
        v.steps += 1; v.mult = Math.min(Number(odds.maxMult ?? 100), floor2(v.mult * step));
        if (v.mult >= Number(odds.maxMult ?? 100)) { g.phase = 'done'; v.revealAt = now + 700; g.result = { mult: v.mult, label: `Hit the ${v.mult}× table limit` }; return { done: true, mult: v.mult, text: g.result.label }; }
        return { text: `${cardText(next)} — correct. ${v.mult}×` };
      }
      g.phase = 'done'; v.revealAt = now + 700; v.bust = true;
      g.result = { mult: 0, label: `${cardText(next)} is not ${action} than ${cardText(top)}` };
      return { done: true, mult: 0, text: g.result.label };
    }
    case 'dice': {
      if (action === 'bet') {
        if (g.pending) break;
        const err = diceBetError(odds, payload.dir, payload.target);
        if (err) return { text: err, error: true };
        g.view.bet = { dir: payload.dir, target: Math.round(Number(payload.target)), chance: diceChance(payload.dir, payload.target), mult: diceMult(odds, payload.dir, payload.target) };
        return { text: `Bet: ${payload.dir.toUpperCase()} ${g.view.bet.target} — ${g.view.bet.chance}% to win, pays ${g.view.bet.mult}×` };
      }
      if (action !== 'spin' || !g.view.bet) break;
      const b = g.view.bet, roll = rng.int(1, 100), now = Date.now();
      const won = b.dir === 'under' ? roll < b.target : roll > b.target;
      g.view.roll = roll; g.view.rollAt = now; g.view.revealAt = now + DICE_ROLL_MS;
      g.pending = { mult: won ? b.mult : 0, label: `Rolled ${roll} — ${won ? 'WIN' : 'miss'}` };
      return { pending: true, text: `Dice: ${roll} (${b.dir} ${b.target}) → ${won ? b.mult + '×' : 'lose'}` };
    }
    case 'slots': {
      if (action !== 'spin') break;
      const symbols = slotsSymbols(odds), now = Date.now();
      const reels = [0, 1, 2].map(() => weightedIndex(rng, symbols));
      const pay = slotsPay(symbols, reels);
      g.view.symbols = symbols.map(x => ({ id: x.id, icon: x.icon }));
      g.view.reels = reels; g.view.spinAt = now; g.view.revealAt = now + SLOTS_REEL_MS[2] + 250; g.view.win = pay.kind;
      g.pending = { mult: pay.mult, label: pay.mult ? `${pay.label} pays ${pay.mult}×` : `${reels.map(i => symbols[i].icon).join('')} — no line` };
      return { pending: true, text: `Slots: ${reels.map(i => symbols[i].icon).join(' ')} → ${pay.mult}×` };
    }
    case 'keno': {
      const R = kenoRules(odds), v = g.view;
      if (g.pending && action !== 'spin') break;
      if (action === 'pick') {
        const n = Math.round(Number(payload.n));
        if (!(n >= 1 && n <= R.numbers)) return { text: `Pick a number from 1 to ${R.numbers}.`, error: true };
        if (v.picks.includes(n)) { v.picks = v.picks.filter(x => x !== n); return { text: `Un-picked ${n}.` }; }
        if (v.picks.length >= R.maxPicks) return { text: `Maximum ${R.maxPicks} picks.`, error: true };
        v.picks.push(n); v.picks.sort((a, b) => a - b);
        return { text: `Picked ${n} (${v.picks.length}/${R.maxPicks}).` };
      }
      if (action === 'quick') {
        const k = Math.max(1, Math.min(R.maxPicks, Math.round(Number(payload.count)) || 5));
        v.picks = shuffle(rng, Array.from({ length: R.numbers }, (_, i) => i + 1)).slice(0, k).sort((a, b) => a - b);
        return { text: `Quick pick: ${v.picks.join(', ')}` };
      }
      if (action === 'clear') { v.picks = []; return { text: 'Picks cleared.' }; }
      if (action !== 'spin') break;
      if (!v.picks.length) return { text: 'Pick at least one number first.', error: true };
      const now = Date.now();
      v.draw = shuffle(rng, Array.from({ length: R.numbers }, (_, i) => i + 1)).slice(0, R.drawn);
      v.drawAt = now; v.revealAt = now + R.drawn * KENO_BALL_MS + 400;
      const hits = v.picks.filter(n => v.draw.includes(n)).length, mult = kenoPay(R, v.picks.length, hits);
      v.hits = hits;
      g.pending = { mult, label: `${hits} of ${v.picks.length} hit${mult ? ` — pays ${mult}×` : ''}` };
      return { pending: true, text: `Keno: ${g.pending.label}` };
    }
    case 'placeholder': {
      if (action === 'won')  { g.pending = { mult: 2, label: 'WON' }; return { pending: true, text: 'GM: won' }; }
      if (action === 'lost') { g.pending = { mult: 0, label: 'LOST' }; return { pending: true, text: 'GM: lost' }; }
      break;
    }
  }
  return { text: `Nothing to do for ${action}.` };
}

// ── Settlement chain ─────────────────────────────────────────────
// mult = total return multiple of stake: 0 lose, 1 push, 2 = 1:1 win, etc.
export function settle(config, state, player, mult, meta = {}) {
  const g = state.game;
  const wagers = meta.wagers || g?.wagers || [];
  const he = houseEdgeMult(config, state);
  const hr = takePowerUp(state, player, 'highroller');
  const floorPU = mult < 1 ? takePowerUp(state, player, 'floor') : null;
  const won = mult > 1, lost = mult < 1;
  const lines = [];
  for (const w of wagers) {
    if (won) {
      let profit = w.amount * (mult - 1) * he;
      if (player.winMult) profit *= player.winMult.mult;
      if (hr) profit *= 2;
      profit = Math.round(profit);
      for (const d of player.debuffs) {
        if (d.winsLeft > 0 && d.payeeId) {
          const cut = Math.round(profit * d.cut);
          const payee = state.players.find(p => p.id === d.payeeId);
          if (payee && cut > 0) { credit(state, payee, w.cur, cut, 'Social Barter cut'); profit -= cut; }
        }
      }
      credit(state, player, w.cur, profit, `${meta.gameId || g?.id || 'game'} win`);
      lines.push(`+${profit} ${w.cur}`);
    } else if (lost) {
      let loss = w.amount * (1 - mult);
      if (hr) loss *= 2;
      if (floorPU && w.cur !== 'Gold') loss = 0;
      loss = Math.round(loss);
      if (loss > 0) { credit(state, player, w.cur, -loss, `${meta.gameId || g?.id || 'game'} loss`); lines.push(`−${loss} ${w.cur}`); }
      else lines.push(`${w.cur} safe (Floor)`);
    } else lines.push(`${w.amount} ${w.cur} pushed`);
  }
  const bits = [];
  if (won && player.winMult) { bits.push(`buff ×${player.winMult.mult}`); player.winMult = null; }
  if (hr) bits.push('High Roller ×2');
  if (floorPU) bits.push('Floor');
  if (won) { player.debuffs.forEach(d => { if (d.winsLeft > 0) d.winsLeft -= 1; }); player.debuffs = player.debuffs.filter(d => d.winsLeft === undefined || d.winsLeft > 0); }
  log(state, 'GAME', player.id, { gameId: meta.gameId || g?.id, mult, won, wagers, label: meta.label });
  state.game = null;
  return { text: `${player.name} ${won ? 'WINS' : lost ? 'loses' : 'pushes'} (${meta.label || mult + '×'}): ${lines.join(', ')}${bits.length ? ' [' + bits.join(', ') + ']' : ''}`, won, lost };
}
