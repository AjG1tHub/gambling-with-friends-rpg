// Lab screen: the creation gamble (SPEC.md › Character creation: gambling for your stats). Ten chips, a stat,
// a stake of 1–5 chips on 50/50, Dice or Hi-Lo in chips mode (the adapter), the chip maths of CHAR_STAT_GAMBLE,
// the Blood option, and the Buy-in Wheel spin that is the fourth creation gamble.
import { startRound } from '../../../packages/games/adapter.js';
import { makeRng, hash32, weightedIndex } from '../../../packages/shared/rng.js';
import { B } from '../../../packages/shared/balance.js';
import { mountRound, wheelSvg } from '../../../packages/ui/labkit.js';

export const CREATION_GAMES = B.creation.gambleGames;
const STATS = ['luck', 'nerve', 'greed', 'grit'];
// A practice creation sheet shared across the creation screens for the session.
const sheet = { chips: B.creation.chips, stats: Object.fromEntries(STATS.map(s => [s, B.stats.creationStart])), maxHealth: B.health?.maxAtLevel1 || 100, blooded: false, buyin: null, gambles: [] };

export function screenCreation(ctx) {
  const { lab, h, main, phone, id } = ctx;
  const gameId = id.slice('creation:'.length);
  const C = B.creation, S = B.stats;
  const log = h('div', { class: 'log log-box' });
  const msg = (t, cls = '') => { log.prepend(h('div', { class: cls }, t)); while (log.children.length > 10) log.lastChild.remove(); };
  const card = h('div', { class: 'panel' });
  const drawCard = () => card.replaceChildren(h('h3', {}, 'Practice sheet'), h('div', { class: 'row' }, h('span', { class: 'pill gold' }, `${sheet.chips} chips`), ...STATS.map(s => h('span', { class: 'pill' }, `${s} ${sheet.stats[s]}`)), h('span', { class: 'pill' }, `max Health ${sheet.maxHealth}${sheet.buyin ? ` (Buy-in ${sheet.buyin})` : ''}`)),
    h('p', { class: 'muted' }, `Unstaked chips become ${C.safePointPerChip} point each at lock; the cap at creation is ${S.creationCap}. Greed pays ${Math.round(C.greedPayoutPerPoint * 100)}% more per point above ${S.neutral}.`),
    h('div', { class: 'row' }, h('button', { class: 'ghost', onClick: () => { Object.assign(sheet, { chips: C.chips, stats: Object.fromEntries(STATS.map(s => [s, S.creationStart])), maxHealth: B.health?.maxAtLevel1 || 100, blooded: false, buyin: null, gambles: [] }); drawCard(); msg('Sheet reset.'); } }, 'Reset sheet'),
      h('button', { disabled: sheet.blooded, onClick: () => { const n = Number(prompt(`Blood: stake 1–${Math.floor(C.bloodMax / C.bloodHealthPerChip)} chips of max Health (${C.bloodHealthPerChip} Health each)?`, '1')); const max = Math.floor(C.bloodMax / C.bloodHealthPerChip); if (!(n >= 1 && n <= max)) return; sheet.maxHealth -= n * C.bloodHealthPerChip; sheet.chips += n; sheet.blooded = true; drawCard(); msg(`Bled ${n * C.bloodHealthPerChip} max Health for ${n} chip(s).`); } }, '🩸 Blood for chips')));
  drawCard();
  if (gameId === 'buyin') {
    const H = B.health, steps = 8, span = H.buyinMax - H.buyinMin, segs = Array.from({ length: steps }, (_, i) => ({ label: String(Math.round(H.buyinMin + span * i / (steps - 1))), weight: 1 }));
    const face = h('div', { class: 'center' }); face.append(wheelSvg({ outcomes: segs.map(s => s.label), size: phone ? 260 : 320 }));
    const spin = () => { const i = weightedIndex(makeRng(hash32(`${lab.seed}:buyin:${Date.now()}`)), segs); face.replaceChildren(wheelSvg({ outcomes: segs.map(s => s.label), index: i, size: phone ? 260 : 320 })); setTimeout(() => { sheet.buyin = Number(segs[i].label); sheet.maxHealth = sheet.buyin; drawCard(); msg(`Buy-in: ${segs[i].label} max Health`, 'turn'); }, 3200); lab.record(id, 1, 1, false); };
    main.append(h('div', { class: 'panel col' }, h('p', { class: 'muted' }, `The Buy-in Wheel sets max Health between ${H.buyinMin} and ${H.buyinMax} (a flat start is the GM's alternative). As a creation gamble, the spin's distance above the floor is the payout.`), face, h('button', { class: 'primary big', style: { width: 'auto' }, onClick: spin }, '🎡 Spin the Buy-in Wheel'), log), card);
    lab.mount = { stop() {}, auto: spin, settle: () => false };
    return;
  }
  // The three adapter games in chips mode.
  const stat = h('select', {}, STATS.map(s => h('option', { value: s }, s)));
  const chips = h('select', {}, Array.from({ length: C.maxStake - C.minStake + 1 }, (_, i) => h('option', { value: C.minStake + i }, `${C.minStake + i} chip${C.minStake + i === 1 ? '' : 's'}`)));
  const stageEl = h('div', { class: 'gwf-stage' }), controlsEl = h('div', { class: 'gwf-controls' }), result = h('div', { class: 'lab-result' });
  let round = null;
  const start = () => {
    lab.mount?.stop?.();
    const n = Number(chips.value); if (sheet.chips < n) { msg('Not enough chips — reset the sheet or bleed for more.', 'error'); return; }
    if (sheet.stats[stat.value] >= S.creationCap) { msg(`${stat.value} is at the creation cap.`, 'error'); return; }
    sheet.chips -= n; drawCard();
    round = startRound(null, { gameId, mode: 'chips', stake: n, attacker: { id: 'tester', name: 'Tester', stats: sheet.stats }, rng: makeRng(hash32(`${lab.seed}:creation:${Date.now()}`)), now: Date.now() });
    result.textContent = ''; result.className = 'lab-result';
    const handle = mountRound({ round, stageEl, controlsEl, phone, autoSettle: lab.autoSettle, onSettle: (o) => {
      const mult = o.mult; let points = 0, back = 0;
      if (mult > 1) { const greedBonus = 1 + C.greedPayoutPerPoint * (sheet.stats.greed - S.neutral); points = Math.max(0, Math.round(n * mult * greedBonus)); const gain = Math.min(points, S.creationCap - sheet.stats[stat.value]); sheet.stats[stat.value] += gain; points = gain; }
      else if (mult === 1) { back = n; sheet.chips += n; } else if (mult > 0) { back = Math.round(n * mult); sheet.chips += back; }
      sheet.gambles.push({ stat: stat.value, gameId, chips: n, mult, points, back });
      result.textContent = points ? `WIN — ${o.label} · ${mult}× · +${points} ${stat.value}` : `LOSS — ${o.label} · ${mult}× · ${n - back} chip(s) gone`; result.className = `lab-result ${points ? 'win' : 'lose'}`;
      msg(result.textContent, points ? 'turn' : ''); drawCard(); lab.record(id, n, mult, o.crit);
    } });
    handle.auto = () => { if (round.settled) return; round.play(makeRng(hash32(`${lab.seed}:cbot:${Date.now()}`)), true); handle.redraw(); handle.tick(); };
    lab.mount = handle;
  };
  lab.quickStake = (k) => { chips.value = k === 1 ? C.minStake : C.maxStake; start(); };
  main.append(h('div', { class: 'panel col' }, h('p', { class: 'muted' }, `Stake ${C.minStake}–${C.maxStake} chips on a stat. A win adds chips × the multiplier (× the Greed bonus) to the stat; a push returns the chips; a loss burns them.`),
    h('div', { class: 'row' }, h('label', { class: 'row' }, 'Stat ', stat), h('label', { class: 'row' }, 'Stake ', chips), h('button', { class: 'primary', onClick: start }, '▶ Gamble'), h('button', { onClick: () => lab.mount?.auto?.() }, '🤖 Auto-play'), h('button', { onClick: () => { if (!lab.mount?.settle?.()) ctx.toast('Nothing to settle yet.'); } }, 'Settle')),
    stageEl, controlsEl, result, log), card);
  start();
}
