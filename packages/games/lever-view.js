// What a stat is worth on a game, for the phones: the simulated expected return at every stat value
// (data/lever-curves.json, built by tools/build-lever-curves.mjs) against the player's own value.
import curves from '../../data/lever-curves.json' with { type: 'json' };
import { LEVERS } from './levers.js';

const clampStat = (v) => Math.max(curves.min, Math.min(curves.max, Math.round(Number(v) || curves.neutral)));
const pct = (v) => `${Math.round(v * 100)}%`;

// { stat, value, neutral, min, max, kind, text, curve[], base:{rtp,win}, yours:{rtp,win}, deltaPts, note }
export function leverView(gameId, statValue) {
  const g = curves.games[gameId]; if (!g) return null;
  const value = clampStat(statValue ?? curves.neutral), neutral = curves.neutral;
  const at = (s) => g.curve.find(c => c.stat === s) || g.curve[0];
  const base = at(neutral), yours = at(value);
  const deltaPts = Math.round((yours.rtp - base.rtp) * 100);
  const lever = LEVERS[gameId];
  return { stat: g.stat, value, neutral, min: curves.min, max: curves.max, kind: g.kind || lever?.kind, text: g.text || lever?.text || '', curve: g.curve, base, yours, deltaPts,
    note: deltaPts > 0 ? `+${deltaPts} points of return over a neutral ${g.stat}` : deltaPts < 0 ? `${deltaPts} points of return under a neutral ${g.stat}` : `a neutral ${g.stat}: the base game` };
}
// "Luck 7 · return 118% (base 102%, +16)"
export function leverSummary(gameId, statValue) {
  const v = leverView(gameId, statValue); if (!v) return '';
  const sign = v.deltaPts > 0 ? `+${v.deltaPts}` : `${v.deltaPts}`;
  return `${cap(v.stat)} ${v.value} · return ${pct(v.yours.rtp)} (base ${pct(v.base.rtp)}, ${sign})`;
}
// Which games a stat governs, best edge first at this value: [{ gameId, view }]
export function gamesForStat(stat, statValue) {
  return Object.keys(curves.games).filter(id => curves.games[id].stat === stat).map(gameId => ({ gameId, view: leverView(gameId, statValue) })).sort((a, b) => b.view.deltaPts - a.view.deltaPts);
}
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const returnPct = pct;

// ── Base odds vs your odds ───────────────────────────────────────────────────────────────────────────────────
// Concrete game numbers at neutral and at the player's stat: [{ label, base, yours, changed }]. Graded odds levers
// are read straight off the lever's odds patch; the post, threshold and versus levers are described from their rule.
import { baseOdds } from './adapter.js';
import { applyLever, leverDelta } from './levers.js';

const P = (v) => `${Math.round(Number(v) * 100)}%`;
const X = (v) => `${Number(Number(v).toFixed(2))}×`;
const TO1 = (v) => `${Number(Number(v).toFixed(2))}:1`;
const share = (list, pick, key = 'weight') => { const t = list.reduce((s, x) => s + Number(x[key] || 0), 0); const w = list.filter(pick).reduce((s, x) => s + Number(x[key] || 0), 0); return t ? w / t : 0; };
const onOff = (label, at, value) => ({ label, base: `off (needs ${at})`, yours: value >= at ? `ON (you have ${value})` : `off (you have ${value}, needs ${at})`, changed: value >= at });

const DESCRIBE = {
  fifty: (b, y) => [['Win chance', P(b.winChance ?? 0.5), P(y.winChance ?? b.winChance ?? 0.5)]],
  bigwheel: (b, y) => { const L = (o) => share(o.segments || [], s => Number(s.mult) === 0), O = (o) => share(o.segments || [], s => Number(s.mult) === 1); return [['LOSE segment', P(L(b)), P(L(y))], ['1× segment', P(O(b)), P(O(y))]]; },
  crash: (b, y) => [['House edge on the fuse', P(b.houseEdge ?? 0.04), P(y.houseEdge ?? b.houseEdge ?? 0.04)]],
  mines: (b, y) => [['Mines on the field', `${b.mines}`, `${y.mines ?? b.mines}`]],
  blackjack: (b, y) => [['Blackjack pays', X(b.blackjackPays ?? 1.5), X(y.blackjackPays ?? b.blackjackPays ?? 1.5)]],
  baccarat: (b, y) => [['Banker pays', TO1(b.banker), TO1(y.banker ?? b.banker)], ['Tie pays', TO1(b.tie), TO1(y.tie ?? b.tie)]],
  slots: (b, y) => { const W = (o) => share(o.symbols || [], s => s.id === 'seven' || s.wild || s.id === 'wild'); return [['Wild 7 on a reel', P(W(b)), P(W(y))]]; },
  dragontiger: (b, y) => [['Tie pays', TO1(b.tie), TO1(y.tie ?? b.tie)]],
  chuckaluck: (b, y) => [['A triple pays', TO1(b.pay3), TO1(y.pay3 ?? b.pay3)]],
  sicbo: (b, y) => [['Small / Big pay', TO1(b.evenPay ?? 1), TO1(y.evenPay ?? b.evenPay ?? 1)]],
  scratch: (b, y) => { const L = (o) => { const t = (o.tiers || []).reduce((s, x) => s + Number(x.weight), 0) + Number(o.loseWeight || 0); return Number(o.loseWeight || 0) / (t || 1); }; return [['Losing card', P(L(b)), P(L(y))]]; },
  limbo: (b, y) => [['House edge on the target', P(b.houseEdge ?? 0.03), P(y.houseEdge ?? b.houseEdge ?? 0.03)]],
  tower: (b, y) => [['Safe doors per floor', `${(b.tiles || 3) - (b.traps || 1)} of ${b.tiles || 3}`, `${(y.tiles ?? b.tiles ?? 3) - (b.traps || 1)} of ${y.tiles ?? b.tiles ?? 3}`]],
  chicken: (b, y) => [['First lane risk', P(b.baseRisk), P(y.baseRisk ?? b.baseRisk)], ['Risk added per lane', P(b.riskStep), P(y.riskStep ?? b.riskStep)]],
  deal: (b, y) => [['Banker offer (× fair value)', `${X(b.offer1)} → ${X(b.offer3)}`, `${X(y.offer1 ?? b.offer1)} → ${X(y.offer3 ?? b.offer3)}`]],
  videopoker: (b, y) => [['Jacks-or-better pays', TO1(b.jacks ?? 1), TO1(y.jacks ?? b.jacks ?? 1)]],
  holdem: (b, y) => [['Ordinary winning hand pays', X(b.other ?? 1), X(y.other ?? b.other ?? 1)]],
  paigow: (b, y) => [['Commission', P(b.commission ?? 0.05), P(y.commission ?? b.commission ?? 0.05)]],
  // post / threshold / versus levers: the rule at this stat
  roulette: (b, y, d) => { const k = Math.trunc(d / 2), n = Number(b.pockets || 37); return [['Numbers covered by red/black', `18 of ${n} (${P(18 / n)})`, `${18 + k} of ${n} (${P((18 + k) / n)})`], ['Numbers covered by a single number', `1 of ${n}`, `${1 + k} of ${n}`]]; },
  plinko: (b, y, d) => [['Pegs leaning to the outer slots', 'none', d ? `${d * 3 > 0 ? '+' : ''}${d * 3}%` : 'none']],
  hilo: (b, y, d, v) => [onOff('A tie counts as a right call', 5, v.value), onOff('Peek the next card\'s colour', 7, v.value)],
  dice: (b, y, d) => { const k = Math.trunc(d / 3); return [['Win window', 'the call as made', k ? `${k > 0 ? '+' : ''}${k} wider` : 'the call as made']]; },
  keno: (b, y, d) => [['Free extra picks', '0', `${Math.trunc(d / 2)}`]],
  coinstreak: (b, y, d, v) => [onOff('First miss of a streak forgiven', 6, v.value)],
  war: (b, y, d, v) => [['Ties go to the higher Grit', `yours ${v.neutral}`, `yours ${v.value}`]],
  reddog: (b, y, d) => [['Raise multiplier', '×2', `×${Number((2 + 0.2 * d).toFixed(1))}`]],
  underover7: (b, y, d, v) => [onOff('A rolled 7 pushes on Under/Over', 5, v.value)],
  colorwheel: (b, y, d) => [['Extra colours covered', '0', `${Math.max(0, Math.trunc(d / 3))}`]],
  race: (b, y, d) => [['Your runner\'s chance', '×1.00', `×${Math.pow(1.1, d).toFixed(2)}`]],
  pachinko: (b, y, d) => [['High pockets', 'as drawn', d ? `${d * 4 > 0 ? '+' : ''}${d * 4}% wider` : 'as drawn']],
  hilodice: (b, y, d) => { const k = Math.max(0, Math.trunc(d / 3)); return [['Bust threshold', 'none', k ? `+${k} (a miss that close re-rolls)` : 'none']]; },
  bus: (b, y, d, v) => [onOff('A wrong first call is free', 5, v.value)],
  thimbles: (b, y, d, v) => [['Picker finds the pea (before the hider\'s Nerve)', '33%', `${Math.round((1 / 3 + 0.04 * d) * 100)}%`]],
  threecard: (b, y, d) => { const k = Math.trunc(d / 3); return [['Ante bonus pays from', 'a straight', k > 0 ? `${k} rank${k === 1 ? '' : 's'} lower` : k < 0 ? `${-k} rank${k === -1 ? '' : 's'} higher` : 'a straight']]; },
  letitride: (b, y, d, v) => [onOff('A pair pays from 9s (not 10s)', 5, v.value)],
  craps: (b, y, d, v) => [onOff('Come-out 12 is a push', 4, v.value), ['Odds pay', '×1.00', `×${(1 + 0.05 * d).toFixed(2)}`]],
};

export function oddsLines(gameId, statValue) {
  const v = leverView(gameId, statValue); if (!v) return [];
  const table = baseOdds(gameId, null) || {};
  const lx0 = { neutral: v.neutral, min: v.min, max: v.max, penalty: 0, targetD: 0, base: table, odds: table };
  let atNeutral = {}; try { atNeutral = applyLever(gameId, v.neutral, table, lx0) || {}; } catch { atNeutral = {}; }
  const base = { ...table, ...atNeutral };   // "base odds" = the game at a neutral stat
  const d = leverDelta(v.value, { neutral: v.neutral, min: v.min, max: v.max });
  let patch = {}; try { patch = applyLever(gameId, v.value, table, { ...lx0 }) || {}; } catch { patch = {}; }
  const yours = { ...base, ...patch };
  const fn = DESCRIBE[gameId]; if (!fn) return [];
  return fn(base, yours, d, v).map(r => Array.isArray(r) ? { label: r[0], base: r[1], yours: r[2], changed: r[1] !== r[2] } : r);
}
