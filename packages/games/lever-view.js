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
