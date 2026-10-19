#!/usr/bin/env node
// Payout report: the expected return of every item (ports legacy/test/balance.mjs onto the adapter).
//   node tools/payout-report.mjs [rounds=20000] [--md]      writes docs/PAYOUT.md as well
// For each of the 36 items: the closed-form return where the game offers one (`returns()` on the plug-ins, the
// classics' exact maths), and a simulation with the smart bot through the adapter in Health mode and chip mode
// at the neutral stat, plus the same simulation at the governing stat's floor and ceiling to show the lever's
// span. Anything outside 93–100% at neutral is flagged unless it is on the allowlist below (known, documented).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as G from '../packages/games/legacy/games.js';
import { EXTRA } from '../packages/games/legacy/games-extra.js';
import { startRound, baseOdds, gameMeta, topMult } from '../packages/games/adapter.js';
import { ITEM_DEFS, makeItem } from '../packages/games/items.js';
import { LEVERS } from '../packages/games/levers.js';
import { makeRng } from '../packages/shared/rng.js';
import { B } from '../packages/shared/balance.js';

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 20000);
const MD = args.includes('--md');
const LO = 0.93, HI = 1.0;
// Known deviations the lead has seen; they stay flagged in the table but do not fail the run.
export const ALLOWLIST = {
  fifty: 'The legacy 50/50 table has no house edge (50% × 2 = exactly 100%); anything over 100% here is noise.',
  hilo: 'Hi-Lo (Mend) with 2 likeliest calls then cash out: two 3% edges compound and each step floors to 2 decimals (~93–94%).',
  slots: 'Slots: exact 94.5%; the 500× jackpot makes 20k rounds swing ±3%.',
  keno: 'Keno at 5 picks: exact 95.6%; the 400× top prize makes 20k rounds swing ±5%.',
  bigwheel: 'KNOWN legacy issue: the Big Wheel table returns ~192% (segments 1×…20× against 18/72 LOSE). Kept as is; the lead decides.',
  chuckaluck: 'Spec: a triple pays 3× at neutral Grit (10× at 6), so the base table returns ~92%; the legacy default paid 10×.',
  crash: 'Crash at a 2× auto cash-out: the legacy distribution floors the crash point at 1.00×, costing ~1–2% beyond the 4% edge.',
  limbo: 'Limbo at 2×: same floor effect as Crash.',
  coinstreak: 'Coin Streak with 2 calls then cash out: two 3% edges compound (94.1%).',
  hilodice: 'Dice Hi-Lo with 2 calls: compounding edge plus rounding (floor2) on each step.',
  holdem: "Casino Hold'em: the simple call/fold bot is below optimal play; the legacy table returned ~95–98% to its own bot.",
  letitride: 'Let It Ride: high variance (royal 1000:1); 20k rounds swing ±3%.',
  videopoker: 'Video Poker: high variance (royal 250:1) and a simple hold strategy; 20k rounds swing ±2%.',
  deal: 'Deal or No Deal: the smart bot never deals, so it returns the case average (96.5%) regardless of the offer lever.',
  scratch: 'Scratch Card: 68.73% losing cards with a 250× top prize; 20k rounds swing ±4%.',
};
// Closed-form returns, as legacy/test/balance.mjs computed them.
function exact(gameId) {
  const o = baseOdds(gameId), rows = [];
  switch (gameId) {
    case 'fifty': rows.push(['50/50', o.winChance * (1 + o.payout)]); break;
    case 'bigwheel': { const t = o.segments.reduce((s, x) => s + x.weight, 0); rows.push(['Big Wheel', o.segments.reduce((s, x) => s + x.weight * x.mult, 0) / t]); break; }
    case 'roulette': rows.push(['red/black', 18 / o.pockets * (1 + o.even)], ['dozen', 12 / o.pockets * (1 + o.dozen)], ['straight', 1 / o.pockets * (1 + o.straight)]); break;
    case 'crash': rows.push(['any target (approx)', 1 - o.houseEdge]); break;
    case 'mines': for (const k of [1, 3, 5]) { let pr = 1; for (let i = 0; i < k; i++) pr *= (o.grid - o.mines - i) / (o.grid - i); rows.push([`stop after ${k}`, pr * G.minesMult(o, k)]); } break;
    case 'plinko': { const m = G.plinkoMults(o), n = m.length - 1; rows.push(['Plinko', m.reduce((s, x, k) => s + G.binom(n, k) * x, 0) / 2 ** n]); break; }
    case 'dice': for (const [dir, t] of [['under', 50], ['over', 90]]) rows.push([`${dir} ${t}`, G.diceChance(dir, t) / 100 * G.diceMult(o, dir, t)]); break;
    case 'slots': rows.push(['Slots', G.slotsRtp(G.slotsSymbols(o))]); break;
    case 'keno': { const R = G.kenoRules(o); for (const k of [1, 5, 10]) rows.push([`${k} pick${k === 1 ? '' : 's'}`, G.kenoRtp(R, k)]); break; }
    default: if (EXTRA[gameId]?.returns) for (const r of EXTRA[gameId].returns(o)) rows.push([r.label.replace(/^[^(]*\(?/, '').replace(/\)$/, '') || r.label, r.rtp]);
  }
  return rows;
}
const NEUTRAL = { luck: B.stats.neutral, nerve: B.stats.neutral, greed: B.stats.neutral, grit: B.stats.neutral };
function simulate(gameId, { mode = 'health', stat = null, n = N, seed = 20261018 } = {}) {
  const rng = makeRng(seed), pick = makeRng(seed ^ 0x9e3779b9);
  const stats = { ...NEUTRAL }; if (stat != null) stats[LEVERS[gameId].stat] = stat;
  let ret = 0, crits = 0, maxMult = 0;
  const item = makeItem(null, { gameId, seed: 1 });
  for (let i = 0; i < n; i++) {
    const r = startRound(null, { item, mode, stake: mode === 'chips' ? B.creation.minStake : item.stake, attacker: { id: 'a', name: 'Sim', stats }, target: { id: 't', name: 'Dummy', stats: NEUTRAL }, rng, now: i * 1000 });
    const o = r.play(pick, true); if (!o) throw new Error(`${gameId} did not finish`);
    ret += o.mult; if (o.crit) crits++; if (o.mult > maxMult) maxMult = o.mult;
  }
  return { rtp: ret / n, critRate: crits / n, maxMult };
}
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const rows = [];
const heavy = new Set(['paigow', 'holdem', 'letitride', 'threecard', 'videopoker', 'blackjack']);
for (const d of ITEM_DEFS) {
  const n = heavy.has(d.gameId) ? Math.min(N, 8000) : N;
  const health = simulate(d.gameId, { mode: 'health', n }), chips = simulate(d.gameId, { mode: 'chips', n });
  const low = simulate(d.gameId, { stat: B.stats.min, n: Math.min(n, 6000) }), high = simulate(d.gameId, { stat: B.stats.max, n: Math.min(n, 6000) });
  const ex = exact(d.gameId);
  const flag = health.rtp < LO || health.rtp > HI ? (ALLOWLIST[d.gameId] ? 'known' : 'FLAG') : '';
  rows.push({ id: d.id, name: d.name, game: gameMeta(d.gameId).name, gameId: d.gameId, kind: d.kind, stat: d.stat, health, chips, low, high, exact: ex, top: topMult(d.gameId, baseOdds(d.gameId)), flag, n });
}
console.log('Item'.padEnd(16), 'Game'.padEnd(16), 'Health'.padStart(7), 'Chips'.padStart(7), `${LEVERS.fifty.stat === 'luck' ? '' : ''}stat ${B.stats.min}`.padStart(7), `stat ${B.stats.max}`.padStart(7), 'crit%'.padStart(6), ' exact', ' note');
for (const r of rows) console.log(r.name.padEnd(16), r.game.padEnd(16), pct(r.health.rtp).padStart(7), pct(r.chips.rtp).padStart(7), pct(r.low.rtp).padStart(7), pct(r.high.rtp).padStart(7), pct(r.health.critRate).padStart(6), ' ' + (r.exact.map(([l, v]) => `${l} ${pct(v)}`).join(' · ') || '—').slice(0, 60), r.flag ? ` ⚠ ${r.flag}` : '');
const flagged = rows.filter(r => r.flag);
console.log(`\n${rows.length} items · ${N.toLocaleString('en-US')} rounds each (fewer for the slow table games) · ${flagged.length} outside ${pct(LO)}–${pct(HI)} at neutral: ${flagged.map(r => `${r.name} ${pct(r.health.rtp)}${r.flag === 'known' ? ' (known)' : ''}`).join(', ') || 'none'}`);
const unexpected = flagged.filter(r => r.flag === 'FLAG');
if (unexpected.length) console.log(`UNEXPECTED: ${unexpected.map(r => r.name).join(', ')}`);

if (MD) {
  const here = dirname(fileURLToPath(import.meta.url));
  const md = [];
  md.push('# Payout report', '', `Generated by \`node tools/payout-report.mjs ${N} --md\` on ${new Date().toISOString().slice(0, 10)}. Expected return (total returned per unit staked) of every item, played through \`packages/games/adapter.js\` with the smart bot at the neutral stat (${B.stats.neutral}) in Health mode and in chip mode (creation), then at the governing stat's floor (${B.stats.min}) and ceiling (${B.stats.max}) to show the lever's span. "Exact" is the closed-form figure where the game offers one. "Crit" is how often the result reaches the game's top multiplier.`, '',
    `A Health-mode hit deals \`stake × (mult − 1) × (1 + rarity bonus)\`; a loss costs \`stake × (1 − mult)\`; so an item's damage return equals its return here minus one, before class and gear hooks. Chip mode uses the same odds (the creation module adds Greed's payout bonus on top).`, '',
    `| Item | Game | Kind | Stat | Health | Chips | At ${B.stats.min} | At ${B.stats.max} | Crit | Top | Exact | Note |`, '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const r of rows) md.push(`| ${r.name} | ${r.game} | ${r.kind} | ${r.stat} | ${pct(r.health.rtp)} | ${pct(r.chips.rtp)} | ${pct(r.low.rtp)} | ${pct(r.high.rtp)} | ${pct(r.health.critRate)} | ${Number.isFinite(r.top) ? `${Number(r.top.toFixed(2))}×` : 'all four'} | ${r.exact.map(([l, v]) => `${l} ${pct(v)}`).join(' · ') || '—'} | ${r.flag ? `⚠ ${r.flag === 'known' ? ALLOWLIST[r.gameId] : 'outside the band'}` : ''} |`);
  md.push('', '## Outside the band', '', ...(flagged.length ? flagged.map(r => `- **${r.name}** (${r.game}) ${pct(r.health.rtp)} — ${ALLOWLIST[r.gameId] || 'not on the allowlist: investigate'}`) : ['None.']), '',
    '## How to read the lever columns', '', 'Every game has a governing stat and a lever (SPEC.md › Attacks and spells). The two stat columns are the same bot and the same number of rounds with the stat at its floor and at its ceiling; `test/unit/levers.test.mjs` checks every lever moves the return the promised way with paired dice. Threshold levers ("at 5", "at 6") switch on at that stat and, below neutral, trim win payouts by `items.leverPenaltyPerPoint` per point.', '',
    '## Critical hits', '', 'A result at or above `topMult(gameId)` × `items.critXpMultiplierThreshold` is a crit (Blackjack: a natural; Mines: a full clear; Ride the Bus: all four calls). For binary games (50/50, War, Thimbles, Pai Gow) every win is the top multiplier, so every win is a crit — the spec says "the game\'s top multiplier is a critical hit"; the lead may want a per-game crit floor for those.');
  writeFileSync(join(here, '..', 'docs', 'PAYOUT.md'), md.join('\n') + '\n');
  console.log('wrote docs/PAYOUT.md');
}
