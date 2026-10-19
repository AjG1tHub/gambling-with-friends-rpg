// Stat levers (SPEC.md › Attacks and spells, the table's last column). Every game has a governing stat; each point
// above `stats.neutral` bends the game the way the table says, each point below bends it back the same way.
//
// A lever is applied at up to five moments of a round (the adapter calls these; levers never touch room state):
//   odds(d, base, x)                  → patch merged over the game's odds before startGame (graded levers)
//   afterStart(d, g, base, x)         → patch that REPLACES the override once the game is set up (mines/tower
//                                        place their traps with the lever but pay as the base table) or undefined
//   beforeAct(d, g, action, p, x)     → patch applied before an action (race: the backed runner's weight)
//   afterAct(d, g, action, p, pre, res, x) → may rewrite the game/`res` mid-round (ties heal, misses forgiven)
//   result(d, r, g, x)                → final {mult,label} adjustment (coverage, windows, bonuses, slides)
// x = { rng, base (odds without lever), odds (effective), neutral, penalty, statMin, targetD, now }
// d = statValue − neutral (clamped to the stat range).  targetD is the defender's delta for versus levers.
//
// kind: 'odds' (graded through the odds), 'post' (graded on the outcome), 'threshold' (switches on at a stat:
// those have no natural downside, so below neutral each point trims win payouts by items.leverPenaltyPerPoint),
// 'versus' (compares the two fighters).
import { rouletteWins, roulettePayout, hiloStepMult, RANK_VALUE, kenoRules, kenoPay, cardText } from './legacy/games.js';
import { colorSegments } from './legacy/games-quick.js';
import { chickenMult, busOptions } from './legacy/games-show.js';
import { eval3, rv } from './legacy/poker.js';

const floor2 = (v) => Math.floor(v * 100 + 1e-9) / 100;
const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const x2 = (m) => `${Number(Number(m).toFixed(2))}×`;
const TRUE_ODDS = { 4: 2, 5: 1.5, 6: 1.2, 8: 1.2, 9: 1.5, 10: 2 };
const SEVEN = 'seven';
const KENO_BONUS_PER_HIT = 0.25;                                   // what a drawn bonus star pays, in stakes
const forgive = (g, res, text) => { g.phase = 'running'; g.result = null; g.view.revealAt = null; Object.assign(res, { done: false, mult: undefined, text }); };

export const LEVERS = {
  fifty: { stat: 'luck', kind: 'odds', perPoint: 0.02, text: 'win chance +2% a point',
    odds: (d, o) => ({ winChance: clamp(Number(o.winChance ?? 0.5) + 0.02 * d, 0.01, 0.99) }) },
  bigwheel: { stat: 'luck', kind: 'odds', perPoint: 0.08, text: 'a spin stopping one segment off yours slides onto it 8% a point',
    odds(d, o) {
      const segs = (o.segments || []).map(s => ({ ...s, weight: Number(s.weight) }));
      const lose = segs.find(s => Number(s.mult) === 0), one = segs.find(s => Number(s.mult) === 1);
      if (!lose || !one || d === 0) return {};
      const shift = 0.08 * Math.abs(d) * (d > 0 ? lose.weight : one.weight);
      if (d > 0) { lose.weight -= shift; one.weight += shift; } else { one.weight -= shift; lose.weight += shift; }
      return { segments: segs };
    } },
  roulette: { stat: 'luck', kind: 'post', perPoint: 0.5, text: 'one extra covered number per 2 points',
    result(d, r, g, x) {
      const k = Math.trunc(d / 2), bet = g.view.bet, pocket = g.view.pocket; if (!k || !bet || pocket == null) return r;
      const n = Number(x.odds.pockets || 37), all = Array.from({ length: n }, (_, i) => i);
      const covered = new Set(all.filter(i => rouletteWins(bet, i)));
      if (k > 0) all.filter(i => !covered.has(i)).slice(0, k).forEach(i => covered.add(i));
      else [...covered].sort((a, b) => b - a).slice(0, -k).forEach(i => covered.delete(i));
      const won = covered.has(pocket), mult = won ? 1 + roulettePayout(x.odds, bet.type) : 0;
      return mult === r.mult ? r : { mult, label: `${r.label} — ${won ? 'covered by Luck' : 'uncovered (low Luck)'}` };
    } },
  crash: { stat: 'nerve', kind: 'odds', perPoint: 0.04, text: 'the fuse burns 4% slower a point (the crash point sits 4% higher)',
    odds: (d, o) => ({ houseEdge: clamp(1 - (1 - Number(o.houseEdge ?? 0.04)) * (1 + 0.04 * d), -0.5, 0.95) }) },
  mines: { stat: 'nerve', kind: 'odds', perPoint: 0.5, text: 'one fewer mine per 2 points (paid as the full field)',
    odds: (d, o) => ({ mines: clamp(Number(o.mines || 3) - Math.trunc(d / 2), 1, Number(o.grid || 25) - 2) }),
    afterStart: () => ({}) },
  blackjack: { stat: 'greed', kind: 'odds', perPoint: 0.1, text: 'blackjack pays +0.1× a point; double on any two cards',
    odds: (d, o) => ({ blackjackPays: Math.max(1, round2(Number(o.blackjackPays ?? 1.5) + 0.1 * d)) }) },
  baccarat: { stat: 'greed', kind: 'odds', perPoint: 0.01, text: 'banker commission falls 1% a point; Tie pays +0.5 a point',
    odds: (d, o) => ({ banker: clamp(round2(Number(o.banker ?? 0.95) + 0.01 * d), 0.5, 1), tie: Math.max(1, Number(o.tie ?? 8) + 0.5 * d) }) },
  plinko: { stat: 'luck', kind: 'post', perPoint: 0.03, text: 'pegs lean to the outer high slots 3% a point',
    result(d, r, g, x) {
      const drop = g.view.drop, mults = g.view.mults; if (!drop || !mults || !d || !x.rng.chance(0.03 * Math.abs(d))) return r;
      const n = mults.length - 1, k = drop.slot, mid = n / 2;
      const outward = k < mid ? k - 1 : k > mid ? k + 1 : (x.rng.chance(0.5) ? k - 1 : k + 1), inward = k < mid ? k + 1 : k > mid ? k - 1 : k;
      const nk = clamp(d > 0 ? outward : inward, 0, n); if (nk === k) return r;
      drop.slot = nk; if (g.pending) { g.pending.mult = mults[nk]; g.pending.label = `Slot ${nk + 1} · ${mults[nk]}×`; }
      return { mult: mults[nk], label: `Slot ${nk + 1} · ${mults[nk]}× (${d > 0 ? 'Luck' : 'low Luck'} nudged the ball)` };
    } },
  hilo: { stat: 'grit', kind: 'threshold', perPoint: 0, text: 'ties heal at 5 (a same-rank card counts as a correct call); at 1 a tie busts',
    afterAct(d, g, a, p, pre, res, x) {
      if (a !== 'higher' && a !== 'lower' || g.phase !== 'running') return;
      const v = g.view, top = v.cards.at(-1), prev = v.cards.at(-2);
      if (!prev || v.cards.length === pre.cards || RANK_VALUE[top.r] !== RANK_VALUE[prev.r]) return;   // not a tie
      if (d >= 2) {
        const step = hiloStepMult(x.odds, prev.r, a); v.steps += 1; v.mult = Math.min(Number(x.odds.maxMult ?? 100), floor2(v.mult * step));
        res.text = `${cardText(top)} ties — Grit heals it. ${v.mult}×`;
        if (v.mult >= Number(x.odds.maxMult ?? 100)) { g.phase = 'done'; v.revealAt = x.now + 700; g.result = { mult: v.mult, label: `Hit the ${v.mult}× table limit` }; Object.assign(res, { done: true, mult: v.mult, text: g.result.label }); }
      } else if (d <= -2) {
        g.phase = 'done'; v.revealAt = x.now + 700; v.bust = true; g.result = { mult: 0, label: `${cardText(top)} ties ${cardText(prev)} — low Grit busts` };
        Object.assign(res, { done: true, mult: 0, text: g.result.label });
      }
    } },
  dice: { stat: 'grit', kind: 'post', perPoint: 1 / 3, text: 'the win window widens by 1 per 3 points',
    result(d, r, g) {
      const w = Math.trunc(d / 3), b = g.view.bet, roll = g.view.roll; if (!w || !b || roll == null) return r;
      const won = b.dir === 'under' ? roll < b.target + w : roll > b.target - w, mult = won ? b.mult : 0;
      return mult === r.mult ? r : { mult, label: `Rolled ${roll} — ${won ? 'WIN (Grit widened the window)' : 'miss (low Grit narrowed the window)'}` };
    } },
  slots: { stat: 'luck', kind: 'odds', perPoint: 0.05, text: 'the wild 7 symbol is 5% more common a point',
    odds: (d, o) => ({ symbols: (o.symbols || []).map(s => (s.id === SEVEN ? { ...s, weight: Math.max(0.5, Number(s.weight) * (1 + 0.05 * d)) } : s)) }) },
  keno: { stat: 'luck', kind: 'post', perPoint: 0.5, text: 'one free extra pick per 2 points (a drawn bonus pick pays a quarter stake on top; the Keno table is too steep for bonus picks to count as hits)',
    result(d, r, g, x) {
      const k = Math.trunc(d / 2), v = g.view; if (!k || !v.draw) return r;
      const R = kenoRules(x.odds);
      if (k > 0) {
        const pool = Array.from({ length: R.numbers }, (_, i) => i + 1).filter(n => !v.picks.includes(n)); const extra = x.rng.shuffle(pool).slice(0, k); v.bonusPicks = extra;
        const bonusHits = extra.filter(n => v.draw.includes(n)).length; if (!bonusHits) return r;
        const mult = round2(r.mult + bonusHits * KENO_BONUS_PER_HIT); return { mult, label: `${r.label} + ${bonusHits} bonus star${bonusHits === 1 ? '' : 's'} (Luck)` };
      }
      const counted = v.picks.slice(0, Math.max(0, v.picks.length + k));
      const hits = counted.filter(n => v.draw.includes(n)).length, mult = kenoPay(R, v.picks.length, hits);
      if (hits === v.hits) return r; v.hits = hits;
      return { mult, label: `${hits} of ${v.picks.length} hit${mult ? ` — pays ${mult}×` : ''} (picks lost to low Luck)` };
    } },
  coinstreak: { stat: 'nerve', kind: 'threshold', perPoint: 0, text: 'the first miss of a streak is forgiven at 6',
    afterAct(d, g, a, p, pre, res) {
      if (d < 3 || (a !== 'heads' && a !== 'tails') || g.phase !== 'done' || g.result.mult !== 0 || g.view.forgiven) return;
      g.view.forgiven = true; forgive(g, res, 'Miss forgiven — Nerve holds the streak.');
    } },
  war: { stat: 'grit', kind: 'versus', perPoint: 0, text: 'ties go to the higher Grit',
    afterStart(d, g, base, x) {
      if (g.phase !== 'tie' || x.targetD == null || d === x.targetD) return;
      const win = d > x.targetD; g.phase = 'done'; g.view.revealAt = x.now + 1200;
      g.result = { mult: win ? 2 : 0, label: win ? 'Tie — the higher Grit takes it' : 'Tie — the higher Grit was theirs' };
    } },
  dragontiger: { stat: 'greed', kind: 'odds', perPoint: 1, text: 'Tie pays +1× a point',
    odds: (d, o) => ({ tie: Math.max(1, Number(o.tie ?? 11) + d) }) },
  reddog: { stat: 'greed', kind: 'post', perPoint: 0.2, text: 'raise multiplier +0.2 a point',
    result(d, r, g) {
      const v = g.view; if (!d || !v.raised || !(r.mult > 1)) return r;
      const k = Math.max(0.2, round2(2 + 0.2 * d)), mult = round2(1 + v.pay * k);
      return { mult, label: `${r.label.split(' on a doubled bet')[0]} on a ×${k} raise` };
    } },
  chuckaluck: { stat: 'grit', kind: 'odds', perPoint: 7 / 3, text: 'a triple pays 10× instead of 3× at 6 (graded)',
    odds: (d) => ({ pay3: clamp(round2(3 + (7 / 3) * d), 0, 10) }) },
  sicbo: { stat: 'grit', kind: 'odds', perPoint: 0.02, text: 'Small and Big lose less of their edge each point; triples no longer kill them at 7',
    odds: (d, o) => ({ evenPay: Math.max(0.5, round2(Number(o.evenPay ?? 1) + 0.02 * d)) }),
    afterAct(d, g, a, p, pre, res, x) {
      const v = g.view; if (d < 4 || g.phase !== 'done' || !v.dice || g.result.mult !== 0 || !['small', 'big', 'odd', 'even'].includes(v.bet?.type)) return;
      const trip = v.dice[0] === v.dice[1] && v.dice[1] === v.dice[2]; if (!trip) return;
      const t = v.total, hit = v.bet.type === 'small' ? t <= 10 : v.bet.type === 'big' ? t >= 11 : v.bet.type === 'odd' ? t % 2 === 1 : t % 2 === 0;
      if (!hit) return;
      g.result = { mult: 1 + Number(x.odds.evenPay), label: `${g.result.label.replace(' — miss', '')} — Grit survives the triple, WIN` }; Object.assign(res, { mult: g.result.mult, text: g.result.label });
    } },
  underover7: { stat: 'grit', kind: 'threshold', perPoint: 0, text: 'a 7 is a push instead of a loss at 5',
    result(d, r, g) { const v = g.view; if (d < 2 || v.total !== 7 || v.bet === 'seven' || r.mult !== 0) return r; return { mult: 1, label: `${v.dice[0]} + ${v.dice[1]} = 7 — push (Grit)` }; } },
  colorwheel: { stat: 'luck', kind: 'threshold', perPoint: 0, text: 'one extra colour covered per 3 points',
    result(d, r, g, x) {
      const k = Math.trunc(d / 3); if (k <= 0 || r.mult > 0) return r;
      const segs = colorSegments(x.odds), order = segs.map((s, i) => i).sort((a, b) => Number(segs[b].count) - Number(segs[a].count));   // commonest first
      const si = segs.findIndex(s => s.label === g.view.bet), pos = order.indexOf(si); if (si < 0) return r;
      const extra = pos > 0 ? order.slice(Math.max(0, pos - k), pos) : order.slice(1, 1 + k);
      if (!extra.some(i => segs[i].label === g.view.landed)) return r;
      return { mult: 1 + Number(segs[si].pay), label: `${g.view.landed} — covered by Luck, pays ${segs[si].pay}:1` };
    } },
  scratch: { stat: 'luck', kind: 'odds', perPoint: 0.1, text: 'one free extra scratch per 2 points (the losing card is 10% rarer per extra scratch)',
    odds: (d, o) => ({ loseWeight: Math.max(Number(o.loseWeight) * 0.1, Number(o.loseWeight) * (1 - 0.1 * Math.trunc(d / 2))) }) },
  limbo: { stat: 'nerve', kind: 'odds', perPoint: 0.03, text: 'the named multiplier is reached 3% more often a point',
    odds: (d, o) => ({ houseEdge: clamp(1 - (1 - Number(o.houseEdge ?? 0.03)) * (1 + 0.03 * d), -0.5, 0.95) }) },
  race: { stat: 'luck', kind: 'odds', perPoint: 0.1, text: 'your runner starts one length ahead a point (its chance ×1.1 a point)',
    beforeAct(d, g, a, p, x) {
      if (a !== 'bet' || !d) return; const i = Math.round(Number(p.i)), runners = (x.base.runners || []).map(r => ({ ...r })); if (!runners[i]) return;
      runners[i].weight = Math.max(0.1, Number(runners[i].weight) * (1 + 0.1 * d)); return { runners };
    } },
  tower: { stat: 'nerve', kind: 'odds', perPoint: 1 / 3, text: 'one extra safe tile per floor per 3 points (paid as the base tower)',
    odds: (d, o) => ({ tiles: clamp(Number(o.tiles) + Math.trunc(d / 3), Number(o.traps) + 1, 6) }), afterStart: () => ({}) },
  chicken: { stat: 'nerve', kind: 'odds', perPoint: 0.05, text: 'traffic 5% slower a point (paid as the base road)',
    odds: (d, o) => ({ baseRisk: clamp(Number(o.baseRisk) * (1 - 0.05 * d), 0.005, 0.9), riskStep: clamp(Number(o.riskStep) * (1 - 0.05 * d), 0.001, 0.5) }),
    afterAct(d, g, a, p, pre, res, x) {
      const v = g.view; if (!d) return; v.mult = chickenMult(x.base, v.lane);
      if (g.phase === 'done' && g.result.mult > 0) { g.result.mult = v.mult; g.result.label = v.lane >= v.lanes ? `Made it across — ${x2(v.mult)}` : `Stopped after ${v.lane} lane${v.lane === 1 ? '' : 's'} — ${x2(v.mult)}`; res.mult = v.mult; res.text = g.result.label; }
    } },
  pachinko: { stat: 'luck', kind: 'post', perPoint: 0.04, text: 'the high pockets 4% wider a point (each ball may slide one slot outward)',
    result(d, r, g, x) {
      const v = g.view, n = v.mults.length - 1, mid = n / 2; if (!d || !v.drops) return r;
      let moved = false;
      for (const dr of v.drops) { if (!x.rng.chance(0.04 * Math.abs(d))) continue; const k = dr.slot;
        const out = k < mid ? k - 1 : k > mid ? k + 1 : (x.rng.chance(0.5) ? k - 1 : k + 1), inn = k < mid ? k + 1 : k > mid ? k - 1 : k;
        const nk = clamp(d > 0 ? out : inn, 0, n); if (nk !== k) { dr.slot = nk; moved = true; } }
      if (!moved) return r;
      const avg = floor2(v.drops.reduce((s, dr) => s + v.mults[dr.slot], 0) / v.drops.length);
      return { mult: avg, label: `${v.drops.map(dr => x2(v.mults[dr.slot])).join(' + ')} → ${x2(avg)} (${d > 0 ? 'Luck' : 'low Luck'})` };
    } },
  deal: { stat: 'greed', kind: 'odds', perPoint: 0.05, text: "the banker's offers rise 5% a point",
    odds: (d, o) => ({ offer1: round2(Number(o.offer1) * (1 + 0.05 * d)), offer2: round2(Number(o.offer2) * (1 + 0.05 * d)), offer3: round2(Number(o.offer3) * (1 + 0.05 * d)) }) },
  hilodice: { stat: 'grit', kind: 'threshold', perPoint: 1 / 3, text: 'your bust threshold +1 per 3 points (a miss within that distance is a free re-roll); at 0 a tie busts',
    afterAct(d, g, a, p, pre, res, x) {
      if (a !== 'higher' && a !== 'lower') return; const v = g.view, w = Math.trunc(d / 3), was = v.history.at(-1), t = v.total;
      if (w > 0 && g.phase === 'done' && g.result.mult === 0 && was != null && Math.abs(t - was) <= w) { forgive(g, res, `${t} — within ${w} of ${was}, Grit re-rolls.`); return; }
      if (w < 0 && g.phase === 'running' && t === was && v.history.length !== pre.history) { g.phase = 'done'; v.revealAt = x.now + 1000; g.result = { mult: 0, label: `${t} again — low Grit busts on a tie` }; Object.assign(res, { done: true, mult: 0, text: g.result.label }); }
    } },
  bus: { stat: 'nerve', kind: 'threshold', perPoint: 0, text: 'a wrong first call is free at 5',
    afterAct(d, g, a, p, pre, res, x) {
      const v = g.view; if (d < 2 || a !== 'call' || g.phase !== 'done' || g.result.mult !== 0 || v.cards.length !== 1 || v.forgiven) return;
      v.forgiven = true; v.cards = []; v.mult = 1; v.prev = 1; v.opts = busOptions(x.odds, [], g.secret.deck); forgive(g, res, 'Wrong first call — free (Nerve). Call again.');
    } },
  thimbles: { stat: 'luck', kind: 'versus', perPoint: 0.04, text: 'Luck for the picker (+4% a point), Nerve for the hider (−4% a point)',
    result(d, r, g, x) {
      const eff = d - (x.targetD ?? 0), v = g.view; if (!eff || !x.rng.chance(0.04 * Math.abs(eff))) return r;
      if (eff > 0 && r.mult === 0) { v.ball = v.pick; return { mult: Number(x.odds.pay), label: `Found it — ${x2(x.odds.pay)} (Luck)` }; }
      if (eff < 0 && r.mult > 0) { v.ball = (v.pick + 1) % v.cups; return { mult: 0, label: `It was under cup ${v.ball + 1} (the hider's Nerve)` }; }
      return r;
    } },
  videopoker: { stat: 'greed', kind: 'odds', perPoint: 0.5, text: 'jacks-or-better pays 2× at 5 (graded from 0 at 1)',
    odds: (d) => ({ jacks: clamp(round2(1 + 0.5 * d), 0, 2) }) },
  threecard: { stat: 'greed', kind: 'post', perPoint: 1 / 3, text: 'the ante bonus pays from one rank lower per 3 points',
    result(d, r, g, x) {
      const k = Math.trunc(d / 3); if (!k || r.label === 'Folded') return r; const P = eval3(g.view.player), b = Number(x.odds.bonusStraight);
      if (k > 0 && P.cat < 3 && P.cat >= 3 - k) return { mult: round2(r.mult + b), label: `${r.label} (+${b}:1 bonus from Greed)` };
      if (k < 0 && P.cat === 3) return { mult: Math.max(0, round2(r.mult - b)), label: `${r.label.replace(` (+${b}:1 bonus)`, '')} (no bonus: low Greed)` };
      return r;
    } },
  letitride: { stat: 'greed', kind: 'threshold', perPoint: 0, text: 'a pair pays from 9s at 5; at 1 a pair of tens no longer pays',
    result(d, r, g, x) {
      const v = g.view, vals = [...v.player, ...v.board].map(rv), pairOf = (n) => vals.filter(a => a === n).length === 2;
      if (d >= 2 && !v.win && pairOf(9)) { const pay = Number(x.odds.tens); return { mult: 1 + v.bets * pay, label: `Pair of Nines — ${pay}:1 on ${v.bets} bet${v.bets === 1 ? '' : 's'} (Greed)` }; }
      if (d <= -2 && v.win === 'tens' && pairOf(10) && !vals.some(a => a > 10 && vals.filter(b => b === a).length >= 2)) return { mult: 1 - v.bets, label: `Pair of Tens — not enough at low Greed, ${v.bets} bet${v.bets === 1 ? '' : 's'} lost` };
      return r;
    } },
  holdem: { stat: 'greed', kind: 'odds', perPoint: 0.1, text: 'the ante pays 10% more a point on ordinary winning hands (the flop is already open before the call)',
    odds: (d, o) => ({ other: Math.max(0, round2(Number(o.other ?? 1) + 0.1 * d)) }) },
  craps: { stat: 'grit', kind: 'post', perPoint: 0.05, text: 'a come-out 12 is a push at 4 (at 2 a come-out 11 is only a push); odds pay +5% a point',
    result(d, r, g) {
      const v = g.view, t = v.rolls.at(-1);
      if (d >= 1 && /craps/.test(r.label) && t === 12) return { mult: 1, label: '12 — a push for the gritty' };
      if (d <= -1 && /natural/.test(r.label) && t === 11) return { mult: 1, label: '11 — only a push at low Grit' };
      if (d && v.odds && /made the point/.test(r.label)) { const mult = round2(2 + v.odds * TRUE_ODDS[v.point] * (1 + 0.05 * d)); return { mult, label: `${r.label} ${d > 0 ? '+' : ''}${Math.round(5 * d)}% Grit` }; }
      return r;
    } },
  paigow: { stat: 'grit', kind: 'odds', perPoint: 0.01, text: 'commission falls 1% a point',
    odds: (d, o) => ({ commission: clamp(round2(Number(o.commission ?? 0.05) - 0.01 * d), 0, 0.2) }) },
};
export const LEVER_IDS = Object.keys(LEVERS);

export function leverDelta(statValue, { neutral = 3, min = 1, max = 10 } = {}) {
  const v = Number.isFinite(Number(statValue)) ? Number(statValue) : neutral;
  return clamp(Math.round(v), min, max) - neutral;
}
const L = (gameId) => LEVERS[gameId] || null;
// Odds patch for startGame. `odds` is the base table (no lever). Returns {} when the lever has no graded odds.
export function applyLever(gameId, statValue, odds, x = {}) {
  const lv = L(gameId); if (!lv || !lv.odds) return {};
  const d = leverDelta(statValue, x); if (d === 0) return {};
  return lv.odds(d, odds, x) || {};
}
export function afterStartLever(gameId, statValue, g, base, x = {}) { const lv = L(gameId); if (!lv || !lv.afterStart) return undefined; return lv.afterStart(leverDelta(statValue, x), g, base, x); }
export function beforeActLever(gameId, statValue, g, action, payload, x = {}) { const lv = L(gameId); if (!lv || !lv.beforeAct) return undefined; return lv.beforeAct(leverDelta(statValue, x), g, action, payload || {}, x); }
export function afterActLever(gameId, statValue, g, action, payload, pre, res, x = {}) { const lv = L(gameId); if (!lv || !lv.afterAct) return; lv.afterAct(leverDelta(statValue, x), g, action, payload || {}, pre, res, x); }
// Final result adjustment, plus the generic below-neutral trim for threshold levers.
export function postLever(gameId, statValue, result, g, x = {}) {
  const lv = L(gameId); if (!lv || !result) return result;
  const d = leverDelta(statValue, x); let r = result;
  if (lv.result && d !== 0) r = lv.result(d, r, g, x) || r;
  if (lv.kind === 'threshold' && d < 0 && r.mult > 1 && (x.penalty || 0) > 0) {
    const mult = round2(1 + (r.mult - 1) * Math.max(0, 1 - x.penalty * -d));
    if (mult !== r.mult) r = { mult, label: `${r.label} (trimmed by low ${lv.stat})` };
  }
  return r;
}
// Rulebook rows: one line per game.
export const leverRows = () => LEVER_IDS.map(id => ({ gameId: id, stat: LEVERS[id].stat, kind: LEVERS[id].kind, perPoint: LEVERS[id].perPoint, text: LEVERS[id].text }));
