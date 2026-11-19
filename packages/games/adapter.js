// The game → item adapter (ARCHITECTURE.md › Minigames as items). A Round wraps one legacy game object exactly as
// the GM window drove it (same startGame / gameAction / controls / stage / bot contract) and adds what an item
// needs: the stat lever, a rig hook for the Croupier, Nudge / Reroll / Fork on the legacy `pending` convention,
// a secret-free snapshot for ITEM_STEP, and `outcome()` → { mult, label, crit } for ITEM_RESOLVE.
//
// The adapter runs on the acting phone (or the TV for monsters, or the Lab), never inside a reducer handler.
// It takes the rng and the clock it is handed; only Crash's live multiplier reads the `now` passed to act().
import * as G from './legacy/games.js';
import { EXTRA, EXTRA_LIST } from './legacy/games-extra.js';
import { colorSegments, scratchTiers, limboChance } from './legacy/games-quick.js';
import { racePays, towerMult, chickenMult, pachMults, dealValues } from './legacy/games-show.js';
import { vpKey, vpAdvice, VP_ROWS } from './legacy/games-table.js';
import { RANK_ORDER } from './legacy/poker.js';
import { shuffle } from './legacy/rng.js';
import { x2 } from './legacy/xkit.js';
import { ITEMS, byGame, GAME_IDS } from './items.js';
import { LEVERS, leverDelta, applyLever, afterStartLever, beforeActLever, afterActLever, postLever } from './levers.js';
import { controlsFor, publicControls, ROULETTE_TYPES } from './controls.js';
import { stageHtml, esc, cardsHtml } from './stage.js';
import { group, bonusFor } from '../shared/balance.js';

export const CLASSIC_IDS = ['fifty', 'bigwheel', 'roulette', 'crash', 'mines', 'blackjack', 'baccarat', 'plinko', 'hilo', 'dice', 'slots', 'keno'];
export const CLASSIC_META = {
  fifty: { name: '50/50 Wheel', icon: '⚖️' }, bigwheel: { name: 'Big Wheel', icon: '🎡' }, roulette: { name: 'Roulette', icon: '🔴' }, crash: { name: 'Crash', icon: '🚀' },
  mines: { name: 'Mines', icon: '💣' }, blackjack: { name: 'Blackjack', icon: '🃏' }, baccarat: { name: 'Baccarat', icon: '🎴' }, plinko: { name: 'Plinko', icon: '🔻' },
  hilo: { name: 'Hi-Lo', icon: '🔼' }, dice: { name: 'Dice', icon: '🎲' }, slots: { name: 'Slots', icon: '🎰' }, keno: { name: 'Keno', icon: '🔢' },
};
export const gameMeta = (id) => CLASSIC_META[id] || (EXTRA[id] ? { name: EXTRA[id].name, icon: EXTRA[id].icon } : { name: id, icon: '🎲' });
// The legacy config shape (legacy/site/js/config-default.js › Games rows): odds {} so the built-in tables apply.
export const gameRows = () => [...CLASSIC_IDS, ...EXTRA_LIST.map(g => g.id)].map(id => ({ id, ...gameMeta(id), built: true, odds: {} }));
export const CONFIG = Object.freeze({ Games: gameRows(), Config: { HouseEdgeMultiplier: 1 }, PowerUps: [] });
export const baseOdds = (gameId, extra = null) => ({ ...G.effectiveOdds(CONFIG, { oddsOverrides: {} }, gameId), ...(extra || {}) });
const ALL_IDS = [...CLASSIC_IDS, ...EXTRA_LIST.map(g => g.id)];
export const isKnownGame = (id) => ALL_IDS.includes(id);
const LIR_BETS = 3;                                               // Let It Ride starts with three bets on the table
const floor2 = (v) => Math.floor(v * 100 + 1e-9) / 100;
const round2 = (v) => Math.round(v * 100) / 100;
let seq = 0;

// Strip anything named `secret` at any depth (defensive: a plug-in could nest one).
export function stripSecret(obj) {
  if (Array.isArray(obj)) return obj.map(stripSecret);
  if (obj && typeof obj === 'object') { const out = {}; for (const [k, v] of Object.entries(obj)) { if (k === 'secret') continue; out[k] = stripSecret(v); } return out; }
  return obj;
}

// ── The Joker: wild jokers in Video Poker ────────────────────────────────────────────────────────
// The legacy game is a byte-identical copy and knows no jokers, so the wild rule lives here: a Round started with
// `wildJokers` (the default when the item is The Joker) shuffles `legendaries.jokerCount` jokers into the deck and
// re-reads the final hand with each joker standing for whatever card pays best. Five of a kind (four of a rank and
// a joker, or three and two) has no row in the pay table: simplest reading, it pays as four of a kind and is the
// "double crit" (isCrit below; handlers/items.js doubles the hit by `legendaries.jokerCritMult`).
export const FIVE_OF_A_KIND = 'Five of a kind';
export const JOKER = Object.freeze({ r: '🃏', s: '', joker: true });
const SUITS = ['♠', '♥', '♦', '♣'];
const VP_ORDER = VP_ROWS.map(r => r[0]);                          // best row first
// → { key: a pay-table row or null, five: true for five of a kind }. Without a joker it is the legacy vpKey.
export function vpWildKey(cards) {
  const wild = cards.map((c, i) => (c.joker ? i : -1)).filter(i => i >= 0);
  if (!wild.length) return { key: vpKey(cards), five: false };
  if (new Set(cards.filter(c => !c.joker).map(c => c.r)).size <= 1) return { key: 'quads', five: true };
  let best = null;
  const better = (k) => k && (!best || VP_ORDER.indexOf(k) < VP_ORDER.indexOf(best));
  const fill = (hand, n) => {
    if (n === wild.length) { const k = vpKey(hand); if (better(k)) best = k; return; }
    for (const s of SUITS) for (const r of RANK_ORDER) { const next = hand.slice(); next[wild[n]] = { r, s }; fill(next, n + 1); }
  };
  fill(cards, 0);
  return { key: best, five: false };
}
// The legacy hold advice plus every joker (never throw a wild card away).
export const vpWildAdvice = (cards) => [...new Set([...vpAdvice(cards), ...cards.map((c, i) => (c.joker ? i : -1)).filter(i => i >= 0)])];

// ── Top multiplier per game (what counts as a critical hit) ──────────────────────────────────────
// Pragmatic table: the biggest total return the game can pay at the given odds (and, where it depends on the
// player's choices, for the choices made: Keno's picks). Special cases that are labels rather than numbers
// (Blackjack natural, Mines full clear, Ride the Bus all four) are handled in isCrit.
export function topMult(gameId, odds, g = null) {
  const o = odds || baseOdds(gameId);
  switch (gameId) {
    case 'fifty': return 1 + Number(o.payout);
    case 'bigwheel': return Math.max(...(o.segments || []).map(s => Number(s.mult)));
    case 'roulette': return 1 + Number(o.straight);
    case 'crash': return Number(o.maxMult);
    case 'mines': return G.minesMult(o, Number(o.grid) - Number(o.mines));
    case 'blackjack': return 1 + Number(o.blackjackPays);
    case 'baccarat': return 1 + Number(o.tie);
    case 'plinko': return Math.max(...G.plinkoMults(o));
    case 'hilo': return Number(o.maxMult);
    case 'dice': return G.diceMult(o, 'under', Number(o.minChance ?? 2) + 1);
    case 'slots': return Math.max(...G.slotsSymbols(o).map(s => Number(s.three) || 0));
    case 'keno': { const R = G.kenoRules(o); const k = g?.view?.picks?.length || R.maxPicks; return Math.max(...Object.values(R.pays[k] || { 0: 0 }).map(Number)); }
    case 'coinstreak': return Number(o.maxMult);
    case 'war': return 2;
    case 'dragontiger': return 1 + Number(o.tie);
    case 'reddog': return 1 + Number(o.trips);
    case 'chuckaluck': return 1 + Number(o.pay3);
    case 'sicbo': return 1 + Number(o.t4);
    case 'underover7': return 1 + Number(o.sevenPay);
    case 'colorwheel': return 1 + Math.max(...colorSegments(o).map(s => Number(s.pay)));
    case 'scratch': return Math.max(...scratchTiers(o).map(t => Number(t.mult)));
    case 'limbo': return Number(o.maxTarget);
    case 'race': return Math.max(...racePays(o));
    case 'tower': return towerMult(o, Number(o.floors));
    case 'chicken': return chickenMult(o, Number(o.lanes));
    case 'pachinko': return Math.max(...pachMults(o));
    case 'deal': return Math.max(...dealValues(o));
    case 'hilodice': return Number(o.maxMult);
    case 'bus': return Infinity;                                   // "rode the whole bus" is the crit (label), see isCrit
    case 'thimbles': return Number(o.pay);
    case 'videopoker': return Number(o.royal);
    case 'threecard': return 1 + 2 + Number(o.bonusSF);
    case 'letitride': return 1 + LIR_BETS * Number(o.royal);
    case 'holdem': return 1 + Number(o.royal) + 2;
    case 'craps': return 2 + Number(o.maxOdds) * 2;
    case 'paigow': return 2 - Number(o.commission);
    default: return Infinity;
  }
}
export function isCrit(gameId, odds, g, result, threshold = 1) {
  if (!result || !(result.mult > 1)) return false;
  const label = String(result.label || '');
  if (gameId === 'blackjack') return /^BLACKJACK/.test(label);
  if (gameId === 'mines') return /^Cleared/.test(label);
  if (gameId === 'bus') return /^Rode the whole bus/.test(label);
  if (gameId === 'videopoker' && label.startsWith(FIVE_OF_A_KIND)) return true;
  const top = topMult(gameId, odds, g);
  return Number.isFinite(top) && result.mult >= top * threshold - 1e-9;
}

// ── Rounds ───────────────────────────────────────────────────────────────────────────────────────
// ctx: { B(group) } (a reducer ctx works) or { state } (balance overrides read from the room) or nothing (defaults).
// opts: { item | gameId, mode: 'health'|'chips', stake, attacker: {id,name,stats,classId,level}, target: {id,name,stats},
//         odds (extra overrides), rng, now, holdPending, rig: {outcome:'win'|'lose'} (Croupier), statValue (override),
//         wildJokers (Video Poker only; defaults to true when the item is The Joker) }
export function startRound(ctx, opts) {
  return new Round(ctx, opts);
}
class Round {
  constructor(ctx, { item = null, gameId = null, mode = 'health', stake = null, attacker = null, target = null, odds = null, rng, now = 0, holdPending = false, rig = null, statValue = undefined, wildJokers = undefined } = {}) {
    if (!rng) throw new Error('startRound needs an rng');
    const Bf = typeof ctx?.B === 'function' ? ctx.B : (g) => group(ctx?.state || null, g);
    this.B = Bf;
    this.item = item || (gameId ? { id: `lab-${gameId}`, baseId: byGame[gameId]?.id || gameId, name: gameMeta(gameId).name, gameId, kind: byGame[gameId]?.kind || 'attack', family: byGame[gameId]?.family || null, stat: byGame[gameId]?.stat || 'luck', rarity: 'common', stake: stake ?? Bf('items').stakeCommon, charges: Infinity } : null);
    if (!this.item || !isKnownGame(this.item.gameId)) throw new Error(`unknown game ${this.item?.gameId || gameId}`);
    this.gameId = this.item.gameId; this.mode = mode; this.stake = stake ?? this.item.stake; this.attacker = attacker || { id: 'p', name: 'Player', stats: {} }; this.target = target;
    this.id = `round-${(++seq).toString(36)}`; this.now = now; this.rng = rng; this.holdPending = holdPending; this.rig = rig ? { ...rig } : null; this.rigUsed = false;
    this.settled = false; this.result = null; this.text = ''; this.log = []; this.nudgeLabel = null; this.consumed = { nudge: 0, reroll: 0, fork: 0 }; this.botPlan = {};
    const stats = Bf('stats'), items = Bf('items');
    this.lever = LEVERS[this.gameId] || null;
    const statName = this.item.stat || this.lever?.stat || 'luck';
    this.statName = statName;
    this.statValue = statValue !== undefined ? statValue : (this.attacker.stats?.[statName] ?? stats.neutral);
    const tStat = this.gameId === 'thimbles' ? 'nerve' : statName;
    const targetD = target?.stats?.[tStat] != null ? leverDelta(target.stats[tStat], { neutral: stats.neutral, min: stats.min, max: stats.max }) : null;
    this.lx = { rng, now, neutral: stats.neutral, min: stats.min, max: stats.max, penalty: items.leverPenaltyPerPoint, bonus: items.leverBonusPerPoint ?? 0, targetD, base: baseOdds(this.gameId, odds), get odds() { return null; } };
    this.critThreshold = items.critXpMultiplierThreshold;
    // The legacy mini state: one proxy player holding the stake in the mode's currency.
    const cur = mode === 'chips' ? 'Chips' : 'Health';
    this.cur = cur;
    this.mini = { players: [{ id: this.attacker.id, name: this.attacker.name || 'Player', balances: { [cur]: this.stake }, heldPowerUps: [], debuffs: [], winMult: null }], oddsOverrides: {}, ledger: [], now, lastSpin: null, game: null };
    if (odds) this.mini.oddsOverrides[this.gameId] = { ...odds };
    // Lever: graded odds go in before startGame.
    const patch = applyLever(this.gameId, this.statValue, this.lx.base, this.lx);
    if (patch && Object.keys(patch).length) this.mini.oddsOverrides[this.gameId] = { ...(this.mini.oddsOverrides[this.gameId] || {}), ...patch };
    Object.defineProperty(this.lx, 'odds', { get: () => this.odds(), configurable: true });
    this.g = G.startGame(CONFIG, this.mini, rng, this.gameId, this.mini.players[0], [{ amount: this.stake, cur }]);
    this.wild = this.gameId === 'videopoker' && (wildJokers ?? this.item.legendaryId === 'thejoker');
    if (this.wild) this.dealJokers(Bf('legendaries').jokerCount);
    const after = afterStartLever(this.gameId, this.statValue, this.g, this.lx.base, this.lx);
    if (after !== undefined) this.mini.oddsOverrides[this.gameId] = { ...(odds || {}), ...after };
    this.applyRigAtStart();
    if (this.g.phase === 'done' && this.g.result) this.finalize(this.g.result);
  }
  // The Joker: the legacy start() has already dealt five from a 52-card deck, so put them back, add the jokers,
  // shuffle and deal the five again (same deal timings), which gives a joker the same odds in the first five as in the draw.
  dealJokers(n) {
    const g = this.g, v = g.view;
    const deck = shuffle(this.rng, [...v.cards.map(c => ({ r: c.r, s: c.s })), ...g.secret.deck, ...Array.from({ length: n }, () => ({ ...JOKER }))]);
    v.cards = v.cards.map(c => ({ ...deck.shift(), t: c.t })); g.secret.deck = deck; v.wild = true;
  }
  // Re-read the drawn hand with jokers wild and overwrite the legacy result (which saw the jokers as dead cards).
  wildResult(res) {
    const g = this.g, v = g.view, o = this.odds(), w = vpWildKey(v.cards);
    if (!v.cards.some(c => c.joker)) return;
    const name = w.five ? FIVE_OF_A_KIND : w.key ? VP_ROWS.find(r => r[0] === w.key)[1] : null;
    v.win = w.key; v.five = w.five;
    g.result = w.key ? { mult: Number(o[w.key]), label: `${name} — ${x2(o[w.key])} (jokers wild)` } : { mult: 0, label: `${g.result.label} (the joker could not save it)` };
    Object.assign(res, { done: true, mult: g.result.mult, text: g.result.label });
  }
  get phase() { return this.g.phase; }
  get view() { return this.g.view; }
  get pending() { return this.g.pending; }
  get done() { return this.settled; }
  odds() { return G.effectiveOdds(CONFIG, this.mini, this.gameId); }
  x(now = this.now) { return { ...G.extraCtx(CONFIG, this.mini, this.rng, this.g, now), esc, cardsHtml }; }
  controls() { return controlsFor(this.g, this.x()); }
  publicControls() { return publicControls(this.controls()); }
  stage(now = this.now) { return stageHtml(this.g, now, this.x(now)); }
  revealAt() { return this.g.view.revealAt || this.now; }
  get lastSpin() { return this.mini.lastSpin; }
  // Legacy game object minus `secret`, plus the last wheel spin and, once over, whatever hidden set may be shown.
  snapshot() {
    const snap = stripSecret(this.g);
    if (this.g.phase === 'done' || this.g.pending) {
      if (this.gameId === 'mines' && this.g.secret?.mines) snap.view.reveal = { mines: [...this.g.secret.mines] };
    }
    snap.spin = this.mini.lastSpin ? { ...this.mini.lastSpin } : null;
    snap.roundId = this.id; snap.itemId = this.item.id; snap.mode = this.mode; snap.stake = this.stake;
    return snap;
  }
  finalize(r) {
    if (this.settled) return this.doneResult();
    const adjusted = postLever(this.gameId, this.statValue, { mult: r.mult, label: r.label }, this.g, this.lx) || r;
    this.g.result = { ...r, mult: adjusted.mult, label: adjusted.label }; this.g.phase = 'done';
    if (this.g.pending) this.g.pending = { ...this.g.pending, mult: adjusted.mult, label: adjusted.label };
    this.settled = true; this.result = { mult: adjusted.mult, label: adjusted.label };
    this.text = adjusted.label; this.log.push(adjusted.label);
    return this.doneResult();
  }
  doneResult() { return { done: true, mult: this.result.mult, text: this.result.label }; }
  // Advance the game. Returns { done?, mult?, text, pending?, error? }. `now` is the moment of the action.
  act(action, payload = {}, now = this.now) {
    payload = payload && typeof payload === 'object' ? payload : {};
    this.now = now; this.mini.now = now; this.lx.now = now;
    const g = this.g;
    if (this.settled) return { ...this.doneResult(), text: 'Round over.', error: true };
    if (action === 'accept') { if (g.pending) return this.finalize(g.pending); if (g.result && g.phase === 'done') return this.finalize(g.result); return { text: 'Nothing to accept yet.', error: true }; }
    if (action === 'unbet') { if ((this.gameId === 'roulette' || this.gameId === 'dice' || this.gameId === 'baccarat') && !g.pending && !g.result) { g.view.bet = null; return { text: 'Bet cleared.' }; } return { text: 'Cannot change the bet now.', error: true }; }
    if (this.gameId === 'crash') return this.actCrash(action, payload, now);
    if (action === 'spin' && this.nudgeLabel && !payload.nudgeLabel) payload = { ...payload, nudgeLabel: this.nudgeLabel };
    const pre = beforeActLever(this.gameId, this.statValue, g, action, payload, this.lx);
    if (pre) this.mini.oddsOverrides[this.gameId] = { ...(this.mini.oddsOverrides[this.gameId] || {}), ...pre };
    const before = { cards: g.view.cards?.length ?? 0, history: g.view.history?.length ?? 0, mult: g.view.mult };
    this.mini.game = g;
    let res = G.gameAction(CONFIG, this.mini, this.rng, action, payload) || { text: '' };
    res = { ...res };
    if (this.wild && action === 'auto' && g.phase === 'hold') { const keep = vpWildAdvice(g.view.cards); g.view.held = g.view.held.map((_, i) => keep.includes(i)); }
    if (this.wild && action === 'draw' && g.result) this.wildResult(res);
    afterActLever(this.gameId, this.statValue, g, action, payload, before, res, this.lx);
    this.applyRig(action, payload, res);
    if (res.text) { this.text = res.text; this.log.push(res.text); }
    if (g.pending && !this.settled) {
      if (this.holdPending) return { pending: true, mult: g.pending.mult, text: res.text || g.pending.label };
      return this.finalize(g.pending);
    }
    if (g.phase === 'done' && g.result && !this.settled) return this.finalize(g.result);
    if (res.done && !this.settled && g.result) return this.finalize(g.result);
    return res;
  }
  // Crash is driven by the clock we are handed, so a bot or a test can decide the cash-out moment; the legacy
  // code reads Date.now() for this one game, which is the single place the adapter re-implements six lines.
  actCrash(action, payload, now) {
    const g = this.g, o = this.odds();
    if (action === 'launch') {
      if (g.startedTs) return { text: 'Already launched.', error: true };
      g.startedTs = now; g.phase = 'running'; this.text = 'Launched.';
      if (payload.target != null) return this.crashResolve(Number(payload.target), now, o, true);
      return { text: 'Launched.' };
    }
    if (action === 'cashout') {
      if (g.phase !== 'running') return { text: 'Not running.', error: true };
      if (payload.target != null) return this.crashResolve(Number(payload.target), now, o, false);
      const m = G.crashMult(g, now);
      return this.crashFinish(m, m >= g.secret.crashAt, now);
    }
    return { text: `Nothing to do for ${action}.`, error: true };
  }
  crashResolve(target, now, o, fromLaunch) {
    const g = this.g, t = Math.max(1, Math.min(Number(o.maxMult || 50), floor2(target)));
    const crashed = g.secret.crashAt <= t;
    const reachAt = g.startedTs + Math.log(crashed ? g.secret.crashAt : t) / (g.view.growthPerSec || 0.1) * 1000;
    const r = this.crashFinish(t, crashed, now);
    g.view.revealAt = Math.max(now, Math.round(reachAt)); g.view.autoTarget = t; return r;
  }
  crashFinish(m, crashed, now) {
    const g = this.g; g.phase = 'done';
    g.result = crashed ? { mult: 0, label: `CRASHED at ${g.secret.crashAt}×` } : { mult: m, label: `Cashed out at ${m}×` };
    g.view.finalMult = crashed ? g.secret.crashAt : m; g.view.crashed = crashed; g.view.endedAt = now;
    return this.finalize(g.result);
  }
  // ── Croupier's Rig the Deck: force the next binary outcome ─────────────────────────────────────
  applyRigAtStart() {
    if (!this.rig || this.gameId !== 'war' || this.g.phase !== 'done') return;
    const win = this.rig.outcome === 'win', g = this.g, p = g.view.player[0], d = g.view.dealer[0];
    g.result = { mult: win ? 2 : 0, label: `${win ? p.r + ' beats ' + d.r : d.r + ' beats ' + p.r} (the deck was rigged)` }; this.useRig();
  }
  useRig() { this.rigUsed = true; this.rig = null; }
  applyRig(action, payload, res) {
    if (!this.rig) return;
    const want = this.rig.outcome === 'win', g = this.g, o = this.odds(), id = this.gameId;
    const force = (target, winMult) => { const won = target.mult > 1; if (won === want) { this.useRig(); return; } target.mult = want ? winMult : 0; target.label = `${target.label} (rigged: ${want ? 'WIN' : 'LOSE'})`; if (res) { res.mult = target.mult; res.text = target.label; } this.useRig(); };
    if (id === 'fifty' && action === 'spin' && g.pending) { force(g.pending, 1 + Number(o.payout ?? 1)); if (this.mini.lastSpin) this.mini.lastSpin.index = g.pending.mult > 1 ? 0 : 1; }
    else if (id === 'roulette' && action === 'spin' && g.pending && (g.view.bet?.type === 'red' || g.view.bet?.type === 'black')) force(g.pending, 1 + Number(o.even ?? 1));
    // Croupier level 20 (rigwheel): the Big Wheel too. A rigged WIN stops on the smallest paying segment, a rigged
    // LOSE on a House segment; the picture (lastSpin.index) is moved with it so the TV shows what was paid.
    else if (id === 'bigwheel' && action === 'spin' && g.pending && this.rig.wheel) {
      const segs = o.segments || [], won = g.pending.mult > 1;
      if (won !== want) { const cands = segs.map((sg, i) => ({ i, mult: Number(sg.mult), label: sg.label })).filter(x => want ? x.mult > 1 : x.mult === 0).sort((x, y) => x.mult - y.mult);
        if (cands.length) { const c0 = cands[0]; g.pending.mult = c0.mult; g.pending.label = `${c0.label} (rigged)`; if (this.mini.lastSpin) { this.mini.lastSpin.index = c0.i; this.mini.lastSpin.effect = c0.mult > 0 ? `Pays ${c0.mult}× your stake` : 'House takes it'; } if (res) { res.text = `Big Wheel: ${g.pending.label}`; } } }
      this.useRig();
    }
    else if (id === 'underover7' && action === 'bet' && g.result && (payload.side === 'under' || payload.side === 'over')) force(g.result, 1 + Number(o.sidePay));
    else if (id === 'dragontiger' && action === 'bet' && g.result && (payload.side === 'dragon' || payload.side === 'tiger') && g.view.winner !== 'tie') force(g.result, 2);
    else if (id === 'hilo' && (action === 'higher' || action === 'lower')) {
      const v = g.view, top = v.cards.at(-1), prev = v.cards.at(-2); if (!prev || G.RANK_VALUE[top.r] === G.RANK_VALUE[prev.r]) return;
      const lost = g.phase === 'done' && g.result?.mult === 0;
      if (want && lost) { const step = G.hiloStepMult(o, prev.r, action); g.phase = 'running'; g.result = null; v.revealAt = null; v.bust = false; v.steps += 1; v.mult = Math.min(Number(o.maxMult ?? 100), floor2(v.mult * step)); Object.assign(res, { done: false, mult: undefined, text: `${G.cardText(top)} — correct (rigged). ${v.mult}×` }); }
      else if (!want && !lost && g.phase === 'running') { g.phase = 'done'; v.revealAt = this.now + 700; v.bust = true; g.result = { mult: 0, label: `${G.cardText(top)} — wrong (rigged)` }; Object.assign(res, { done: true, mult: 0, text: g.result.label }); }
      this.useRig();
    }
  }
  // ── Nudge / Reroll / Fork on the legacy pending convention (chance games only) ─────────────────
  canNudge() { return !this.settled && !this.g.pending && ['fifty', 'bigwheel', 'roulette', 'plinko', 'dice', 'slots', 'keno'].includes(this.gameId); }
  nudgeLabels() { const o = this.odds(); switch (this.gameId) { case 'fifty': return ['WIN', 'LOSE']; case 'bigwheel': return (o.segments || []).map(s => s.label); case 'roulette': return Array.from({ length: Number(o.pockets || 37) }, (_, i) => String(i)); case 'plinko': return [...new Set(G.plinkoMults(o).map(m => `${m}×`))]; default: return []; } }
  nudge(label) { if (!this.canNudge()) return false; this.nudgeLabel = label || null; this.consumed.nudge += 1; return true; }
  canReroll() { return !!this.g.pending && !this.settled; }
  reroll() {
    if (!this.canReroll()) return { text: 'Nothing to reroll.', error: true };
    const g = this.g; g.pending = null; g.forkOptions = null; this.consumed.reroll += 1;
    const hold = this.holdPending; this.holdPending = true; const r = this.act('spin', {}); this.holdPending = hold;
    if (!hold && g.pending) return this.finalize(g.pending);
    return r;
  }
  canFork() { return this.canReroll(); }
  fork() {
    if (!this.canFork()) return { text: 'Nothing to fork.', error: true };
    const g = this.g, first = { ...g.pending }; g.pending = null; this.consumed.fork += 1;
    const hold = this.holdPending; this.holdPending = true; this.act('spin', {}); this.holdPending = hold;
    const second = { ...g.pending }; g.forkOptions = [first, second]; g.pending = first;
    return { pending: true, fork: true, options: g.forkOptions.map(o => ({ mult: o.mult, label: o.label })), text: `Fork: ${first.label} or ${second.label}` };
  }
  pickFork(i) {
    const g = this.g; if (!g.forkOptions) return { text: 'No fork open.', error: true };
    const o = g.forkOptions[Number(i)] || g.forkOptions[0]; g.forkOptions = null; g.pending = { ...o };
    return this.finalize(o);
  }
  // ── Bots ────────────────────────────────────────────────────────────────────────────────────────
  // One step: [action, payload]. `pick` is the bot's own rng (separate from the game dice), `smart` plays sensibly.
  bot(pick, smart = false) {
    const g = this.g; if (this.settled) return null;
    if (g.forkOptions) return ['pickFork', { i: pick.int(0, 1) }];
    if (g.pending) return ['accept'];
    if (this.wild && smart && g.phase === 'hold') { const keep = vpWildAdvice(g.view.cards), i = g.view.held.findIndex((h, k) => h !== keep.includes(k)); return i >= 0 ? ['hold', { i }] : ['draw']; }
    if (EXTRA[this.gameId]) return EXTRA[this.gameId].bot(g, pick, smart, this.x());
    const v = g.view, o = this.odds(), choose = (arr) => arr[pick.int(0, arr.length - 1)];
    switch (this.gameId) {
      case 'fifty': case 'bigwheel': case 'plinko': case 'slots': return ['spin'];
      case 'roulette': return v.bet ? ['spin'] : ['bet', smart ? { type: 'red' } : { type: choose([...ROULETTE_TYPES, 'straight']), number: pick.int(0, 36) }];
      case 'crash': return g.startedTs ? ['cashout', { target: this.botPlan.target || 2 }] : ['launch', { target: smart ? 2 : choose([1.2, 1.5, 2, 3, 5]) }];
      case 'mines': {
        if (this.botPlan.k == null) this.botPlan.k = smart ? 3 : pick.int(0, 6);
        if (v.revealed.length >= this.botPlan.k) return ['stop'];
        const free = Array.from({ length: v.grid }, (_, i) => i).filter(i => !v.revealed.includes(i)); return ['reveal', { idx: choose(free) }];
      }
      case 'blackjack': {
        if (g.phase === 'insurance') return [smart ? 'decline' : (pick.chance(0.4) ? 'insure' : 'decline')];
        const h = G.bjActiveHand(v); if (!h) return ['stand']; const t = G.bjTotal(h.cards);
        if (smart) return [h.cards.length === 2 && !t.soft && (t.total === 10 || t.total === 11) ? 'double' : (t.total < 17 || (t.total === 17 && t.soft)) ? 'hit' : 'stand'];
        const opts = ['stand']; if (t.total < 19) opts.push('hit', 'hit'); if (G.bjCanDouble(v)) opts.push('double'); if (G.bjCanSplit(o, v)) opts.push('split', 'split'); return [choose(opts)];
      }
      case 'baccarat': return v.bet ? ['deal'] : ['bet', { side: smart ? 'banker' : choose(['player', 'banker', 'tie']) }];
      case 'hilo': {
        if (this.botPlan.k == null) this.botPlan.k = smart ? 2 : pick.int(0, 5);
        if (v.steps >= this.botPlan.k) return ['cashout'];
        const r = G.RANK_VALUE[v.cards.at(-1).r]; if (smart) return [r <= 7 ? 'higher' : 'lower'];
        return [r === 1 ? 'higher' : r === 13 ? 'lower' : choose(['higher', 'lower'])];
      }
      case 'dice': {
        if (v.bet) return ['spin'];
        if (smart) return ['bet', { dir: 'under', target: 50 }];
        const dir = choose(['under', 'over']); let target = pick.int(1, 100); if (G.diceBetError(o, dir, target)) target = dir === 'under' ? 50 : 51; return ['bet', { dir, target }];
      }
      case 'keno': return v.picks.length ? ['spin'] : ['quick', { count: smart ? 5 : pick.int(1, 10) }];
      default: return null;
    }
  }
  // Play to the end with the bot. Returns the outcome.
  play(pick, smart = false, maxSteps = 300) {
    let guard = 0;
    while (!this.settled && guard++ < maxSteps) {
      const step = this.bot(pick, smart); if (!step) break;
      const [a, p] = step;
      if (a === 'pickFork') this.pickFork(p.i); else this.act(a, p || {}, this.now);
    }
    return this.settled ? this.outcome() : null;
  }
  outcome() { return outcome(this); }
}
export function outcome(round) {
  if (!round.result) return null;
  const { mult, label } = round.result;
  return { mult, label, crit: isCrit(round.gameId, round.odds(), round.g, round.result, round.critThreshold) };
}
// Damage an attack deals (or a spell heals) for a result, before hooks: stake × (mult − 1) × (1 + rarity bonus).
export function payoutFor(state, item, stake, mult) {
  if (!(mult > 1)) return 0;
  return Math.round(stake * (mult - 1) * (1 + bonusFor(state, item?.rarity || 'common')));
}
export const lossFor = (stake, mult) => (mult < 1 ? Math.round(stake * (1 - mult)) : 0);
export { ITEMS, byGame, GAME_IDS, LEVERS, round2 };
