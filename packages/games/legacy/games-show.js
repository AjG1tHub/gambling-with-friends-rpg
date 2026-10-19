// Eight "watch the screen" games — more to look at, still simple rules. See xkit.js for the plug-in contract.
import { shuffle, weightedIndex } from './rng.js';
import { rv, freshDeck } from './poker.js';
import { floor2, end, idle, big, draw, txt, x2, pct, diceHtml, diceLanded, DICE_MS, b, sum, cls, revealed } from './xkit.js';

// ── Race ─────────────────────────────────────────────────────────────────────────────────────────
const RUNNERS = [
  { name: 'Lucky Strike', icon: '🐎', weight: 30 }, { name: 'Dust Devil', icon: '🦄', weight: 22 }, { name: 'Night Shift', icon: '🐆', weight: 18 },
  { name: 'Slow Burn', icon: '🐢', weight: 14 }, { name: 'Hail Mary', icon: '🦙', weight: 10 }, { name: 'Long Shot', icon: '🦥', weight: 6 },
];
export function raceRunners(o) { const r = Array.isArray(o?.runners) ? o.runners.filter(x => x && x.name && Number(x.weight) > 0) : []; return r.length >= 2 ? r : RUNNERS; }
export function racePays(o) { const r = raceRunners(o), tot = sum(r.map(x => Number(x.weight))); return r.map(x => floor2((1 - Number(o.houseEdge ?? 0.05)) / (x.weight / tot))); }
// Where runner i is at time t (0..1 of the track). Wobbles, never runs backwards much, lands exactly on its finish time.
export function racePos(finishMs, seed, t) { const p = Math.min(1, Math.max(0, t / finishMs)); return Math.min(1, Math.max(0, p + 0.2 * Math.sin(p * Math.PI * (2 + (seed % 3)) + seed) * p * (1 - p))); }
const race = {
  id: 'race', name: 'The Races', icon: '🏁', odds: { houseEdge: 0.05, durationMs: 9000, runners: RUNNERS },
  how: (o) => { const r = raceRunners(o), p = racePays(o); return `Back one runner and watch the race. Favourites win more often and pay less: ${r.map((x, i) => `${x.icon} ${x.name} ${x2(p[i])}`).join(', ')} (total returned on a win).`; },
  returns: (o) => { const r = raceRunners(o), tot = sum(r.map(x => Number(x.weight))), p = racePays(o); return [{ label: 'The Races (favourite)', rtp: r[0].weight / tot * p[0] }, { label: 'The Races (outsider)', rtp: r.at(-1).weight / tot * p.at(-1) }]; },
  start(g, x) { const r = raceRunners(x.odds), p = racePays(x.odds); Object.assign(g.view, { runners: r.map((q, i) => ({ name: q.name, icon: q.icon, pay: p[i] })), bet: null, finish: null, startAt: null, revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    const v = g.view, i = Math.round(Number(p.i)); if (g.phase !== 'bet' || a !== 'bet' || !v.runners[i]) return idle(a);
    const r = raceRunners(x.odds), dur = Number(x.odds.durationMs) || 9000, w = weightedIndex(x.rng, r);
    const rest = shuffle(x.rng, r.map((_, k) => k).filter(k => k !== w)), finish = [];
    finish[w] = dur; rest.forEach((k, n) => { finish[k] = dur + 350 * (n + 1) + Math.floor(x.rng.next() * 250); });
    v.bet = i; v.winner = w; v.finish = finish; v.seeds = r.map(() => x.rng.int(1, 97)); v.startAt = x.now + 600;
    return end(g, w === i ? v.runners[i].pay : 0, w === i ? `${v.runners[w].name} wins! Pays ${x2(v.runners[i].pay)}` : `${v.runners[w].name} wins — you backed ${v.runners[i].name}`, v.startAt + dur + 150);
  },
  controls: (g) => ({ info: 'Back a runner:', buttons: g.view.runners.map((r, i) => b(`${r.icon} ${r.name} · ${x2(r.pay)}`, 'bet', { i }, { primary: i < 2, br: i === 3 })) }),
  stage(g, now, x) {
    const v = g.view, t = v.startAt == null ? 0 : now - v.startAt;
    const lanes = v.runners.map((r, i) => { const pos = v.finish ? racePos(v.finish[i], v.seeds[i], t) : 0;
      return `<div class="xlane ${v.bet === i ? 'mine' : ''} ${revealed(g, now) && v.winner === i ? 'won' : ''}"><span class="xlane-name">${x.esc(r.name)} <small>${x2(r.pay)}</small></span><div class="xtrack"><span class="xrunner" style="left:${(pos * 92).toFixed(1)}%">${r.icon}</span></div></div>`; }).join('');
    return `<div class="xrace">${lanes}</div>${v.bet == null ? '<div class="stage-sub">Pick your runner…</div>' : revealed(g, now) ? big(g, now, x.esc) : `<div class="stage-sub">${t < 0 ? 'They are in the gate…' : `Backing <b>${x.esc(v.runners[v.bet].name)}</b>`}</div>`}`;
  },
  bot: (g, pick, smart) => ['bet', { i: smart ? 0 : pick.int(0, g.view.runners.length - 1) }],
};

// ── Tower ────────────────────────────────────────────────────────────────────────────────────────
export const towerMult = (o, k) => floor2((Number(o.tiles) / (Number(o.tiles) - Number(o.traps))) ** k * (1 - Number(o.houseEdge)));
const tower = {
  id: 'tower', name: 'Tower', icon: '🗼', odds: { floors: 8, tiles: 3, traps: 1, houseEdge: 0.03 },
  how: (o) => `Climb ${o.floors} floors. Each floor has ${o.tiles} doors and ${o.traps} of them ${o.traps === 1 ? 'is' : 'are'} trapped. Every safe door raises your multiplier (${[1, 2, 3].map(k => x2(towerMult(o, k))).join(', ')} … up to ${x2(towerMult(o, o.floors))}). Cash out any time — a trap loses the bet.`,
  returns: (o) => [{ label: 'Tower (any floor)', rtp: ((o.tiles - o.traps) / o.tiles) ** 3 * towerMult(o, 3) }],
  start(g, x) {
    const o = x.odds, F = Number(o.floors), T = Number(o.tiles);
    g.secret.traps = Array.from({ length: F }, () => shuffle(x.rng, Array.from({ length: T }, (_, i) => i)).slice(0, Number(o.traps)));
    Object.assign(g.view, { floors: F, tiles: T, floor: 0, picks: [], mult: 1, traps: null, hit: null, revealAt: null }); g.phase = 'running';
  },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'running') return idle(a);
    if (a === 'cashout') { v.traps = g.secret.traps; return end(g, v.mult, v.floor ? `Climbed ${v.floor} floor${v.floor === 1 ? '' : 's'} — ${x2(v.mult)}` : 'Walked away (push)', x.now); }
    const i = Math.round(Number(p.i)); if (a !== 'pick' || !(i >= 0 && i < v.tiles)) return idle(a);
    v.picks.push(i);
    if (g.secret.traps[v.floor].includes(i)) { v.hit = v.floor; v.traps = g.secret.traps; return end(g, 0, `Trap on floor ${v.floor + 1}`, x.now + 300); }
    v.floor += 1; v.mult = towerMult(x.odds, v.floor);
    if (v.floor >= v.floors) { v.traps = g.secret.traps; return end(g, v.mult, `Top of the tower — ${x2(v.mult)}`, x.now + 300); }
    return { text: `Safe. Floor ${v.floor} cleared — ${x2(v.mult)}` };
  },
  controls: (g, x) => ({ info: `<span class="big-turn">${x2(g.view.mult)}</span> <span class="subtle">floor ${g.view.floor + 1} of ${g.view.floors} · next ${x2(towerMult(x.odds, g.view.floor + 1))}</span>`,
    buttons: [...Array.from({ length: g.view.tiles }, (_, i) => b(`🚪 Door ${i + 1}`, 'pick', { i }, { primary: true })), b('💰 CASH OUT', 'cashout', {}, { danger: true })] }),
  stage(g, now, x) {
    const v = g.view, rows = [];
    for (let f = v.floors - 1; f >= 0; f--) {
      const cells = Array.from({ length: v.tiles }, (_, i) => { const picked = v.picks[f] === i, trap = v.traps && v.traps[f].includes(i);
        return `<div class="xcell small ${picked && trap ? 'bad' : picked ? 'hit' : trap ? 'dim' : f === v.floor && g.phase === 'running' ? 'next' : 'hidden'}">${picked && trap ? '💥' : picked ? '✅' : trap ? '💀' : '🚪'}</div>`; }).join('');
      rows.push(`<div class="xfloor"><span class="xfloor-n">${x2(towerMult(x.odds, f + 1))}</span>${cells}</div>`);
    }
    return `<div class="xtower">${rows.join('')}</div>${revealed(g, now) ? big(g, now, x.esc) : `<div class="stage-big small crash-live">${x2(v.mult)}</div>`}`;
  },
  bot: (g, pick, smart) => (g.view.floor >= (smart ? 3 : pick.int(0, 8)) ? ['cashout'] : ['pick', { i: pick.int(0, g.view.tiles - 1) }]),
};

// ── Chicken Cross ────────────────────────────────────────────────────────────────────────────────
export const chickenRisk = (o, lane) => Math.min(0.9, Number(o.baseRisk) + Number(o.riskStep) * lane);
export function chickenMult(o, lanes) { let p = 1; for (let i = 0; i < lanes; i++) p *= 1 - chickenRisk(o, i); return floor2((1 - Number(o.houseEdge)) / p); }
const chicken = {
  id: 'chicken', name: 'Chicken Cross', icon: '🐔', odds: { lanes: 10, baseRisk: 0.06, riskStep: 0.025, houseEdge: 0.03 },
  how: (o) => `Walk the chicken across ${o.lanes} lanes of traffic. Each lane is busier than the last (the first is ${pct(chickenRisk(o, 0))} risk, the last ${pct(chickenRisk(o, o.lanes - 1))}). Every lane crossed raises the multiplier, up to ${x2(chickenMult(o, o.lanes))} on the far side. Cash out any time.`,
  returns: (o) => [{ label: 'Chicken Cross (any lane)', rtp: (1 - o.houseEdge) }],
  start(g, x) { Object.assign(g.view, { lanes: Number(x.odds.lanes), lane: 0, mult: 1, splat: null, stepAt: null, revealAt: null }); g.phase = 'running'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'running') return idle(a);
    if (a === 'cashout') return end(g, v.mult, v.lane ? `Stopped after ${v.lane} lane${v.lane === 1 ? '' : 's'} — ${x2(v.mult)}` : 'Stayed on the kerb (push)', x.now);
    if (a !== 'step') return idle(a);
    v.stepAt = x.now;
    if (x.rng.chance(chickenRisk(x.odds, v.lane))) { v.splat = v.lane; return end(g, 0, `Splat in lane ${v.lane + 1}`, x.now + 450); }
    v.lane += 1; v.mult = chickenMult(x.odds, v.lane);
    if (v.lane >= v.lanes) return end(g, v.mult, `Made it across — ${x2(v.mult)}`, x.now + 450);
    return { text: `Lane ${v.lane} crossed — ${x2(v.mult)}` };
  },
  controls: (g, x) => ({ info: `<span class="big-turn">${x2(g.view.mult)}</span> <span class="subtle">next lane: ${pct(chickenRisk(x.odds, g.view.lane))} risk → ${x2(chickenMult(x.odds, g.view.lane + 1))}</span>`,
    buttons: [b('🐔 STEP', 'step', {}, { primary: true }), b('💰 CASH OUT', 'cashout', {}, { danger: true })] }),
  stage(g, now, x) {
    const v = g.view, cells = [];
    for (let i = 0; i <= v.lanes; i++) {
      const here = v.splat == null ? i === v.lane : i === v.splat + 1, dead = v.splat != null && i === v.splat + 1;
      cells.push(`<div class="xroad ${i === 0 ? 'kerb' : ''} ${i <= v.lane && v.splat == null ? 'done' : ''}"><span class="xroad-m">${i ? x2(chickenMult(x.odds, i)) : 'start'}</span><span class="xroad-c">${dead ? '💥' : here ? '🐔' : i === 0 ? '' : ['🚗', '🚕', '🚙', '🚌', '🚚'][i % 5]}</span></div>`);
    }
    return `<div class="xroads">${cells.join('')}</div>${revealed(g, now) ? big(g, now, x.esc) : `<div class="stage-big small crash-live">${x2(v.mult)}</div><div class="stage-sub"><b>STEP</b> or <b>CASH OUT</b></div>`}`;
  },
  bot: (g, pick, smart) => (g.view.lane >= (smart ? 3 : pick.int(0, 10)) ? ['cashout'] : ['step']),
};

// ── Pachinko ─────────────────────────────────────────────────────────────────────────────────────
export const PACH_STEP = 170, PACH_GAP = 380;
export function pachMults(o) { const m = Array.isArray(o?.mults) ? o.mults.map(Number).filter(Number.isFinite) : []; return m.length >= 3 ? m : [9, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 9]; }
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
const pachinko = {
  id: 'pachinko', name: 'Pachinko', icon: '🎱', odds: { balls: 5, mults: [9, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 9] },
  how: (o) => `${o.balls} balls drop through the pegs at once. Each lands in a slot (${pachMults(o).map(x2).join(' · ')}) and your bet is multiplied by the average of all ${o.balls}.`,
  returns: (o) => { const m = pachMults(o), n = m.length - 1; return [{ label: 'Pachinko', rtp: sum(m.map((v, k) => binom(n, k) * v)) / 2 ** n }]; },
  start(g, x) { Object.assign(g.view, { mults: pachMults(x.odds), drops: null, revealAt: null }); g.phase = 'ready'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'ready' || a !== 'drop') return idle(a);
    const n = v.mults.length - 1, balls = Math.max(1, Math.min(12, Math.round(Number(x.odds.balls)) || 5));
    v.drops = Array.from({ length: balls }, (_, i) => { const path = Array.from({ length: n }, () => (x.rng.chance(0.5) ? 1 : 0)); return { path, slot: sum(path), ts: x.now + i * PACH_GAP }; });
    const avg = floor2(sum(v.drops.map(d => v.mults[d.slot])) / balls);
    return end(g, avg, `${v.drops.map(d => x2(v.mults[d.slot])).join(' + ')} → ${x2(avg)}`, x.now + (balls - 1) * PACH_GAP + n * PACH_STEP + 400);
  },
  controls: (g, x) => ({ buttons: [b(`🎱 Drop ${x.odds.balls} balls`, 'drop', {}, { primary: true })] }),
  stage(g, now, x) {
    const v = g.view, n = v.mults.length - 1, W = 40 * (n + 2), H = 26 * (n + 2);
    let pegs = ''; for (let r = 0; r < n; r++) for (let c = 0; c <= r; c++) pegs += `<circle cx="${W / 2 + (c - r / 2) * 40}" cy="${22 + r * 26}" r="3.2" class="xpeg"/>`;
    let balls = ''; const landed = Array(n + 1).fill(0);
    for (const d of v.drops || []) { const s = Math.floor((now - d.ts) / PACH_STEP); if (s < 0) continue;
      if (s >= n) { landed[d.slot] += 1; continue; }
      const rights = sum(d.path.slice(0, s)); balls += `<circle cx="${W / 2 + (rights - s / 2) * 40}" cy="${10 + s * 26}" r="7" class="xball"/>`; }
    const slots = v.mults.map((m, k) => `<div class="xslot ${landed[k] ? 'lit' : ''}">${x2(m)}${landed[k] ? `<b>${'●'.repeat(landed[k])}</b>` : ''}</div>`).join('');
    return `<svg class="xpach" viewBox="0 0 ${W} ${H - 20}" role="img" aria-label="Pachinko board">${pegs}${balls}</svg><div class="xslots" style="grid-template-columns:repeat(${n + 1},1fr)">${slots}</div>${big(g, now, x.esc)}`;
  },
  bot: () => ['drop'],
};

// ── Deal or No Deal (mini) ───────────────────────────────────────────────────────────────────────
export function dealValues(o) { const v = Array.isArray(o?.values) ? o.values.map(Number).filter(Number.isFinite) : []; return v.length === 10 ? v : [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3.5]; }
const OPENS = [3, 3, 2], FACTORS = ['offer1', 'offer2', 'offer3'];
const dealLeft = (g) => g.secret.cases.filter((_, i) => !(i in g.view.opened));
const deal = {
  id: 'deal', name: 'Deal or No Deal', icon: '💼', odds: { values: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3.5], offer1: 0.85, offer2: 0.92, offer3: 1 },
  how: (o) => `Ten cases hold ${dealValues(o).map(x2).join(', ')} of your bet. Keep one. Open three, and the banker makes an offer; say Deal to take it, or No Deal to open three more, then two more. If you never deal, you choose between your case and the last one left.`,
  returns: (o) => [{ label: 'Deal or No Deal (never deal)', rtp: sum(dealValues(o)) / 10 }],
  start(g, x) { g.secret.cases = shuffle(x.rng, dealValues(x.odds)); Object.assign(g.view, { values: dealValues(x.odds).slice().sort((a, c) => a - c), mine: null, opened: {}, round: 0, toOpen: 0, offer: null, revealAt: null }); g.phase = 'pick'; },
  act(g, a, p, x) {
    const v = g.view, i = Math.round(Number(p.i)), free = (k) => k >= 0 && k < 10 && k !== v.mine && !(k in v.opened);
    if (g.phase === 'pick' && a === 'pick' && i >= 0 && i < 10) { v.mine = i; v.toOpen = OPENS[0]; g.phase = 'open'; return { text: `Case ${i + 1} is yours.` }; }
    if (g.phase === 'open' && a === 'open' && free(i)) {
      v.opened[i] = g.secret.cases[i]; v.toOpen -= 1;
      if (v.toOpen <= 0) { const left = dealLeft(g); v.offer = floor2(Number(x.odds[FACTORS[v.round]]) * sum(left) / left.length); g.phase = 'offer'; }
      return { text: `Case ${i + 1}: ${x2(g.secret.cases[i])}` };
    }
    if (g.phase === 'offer' && a === 'deal') { const mine = g.secret.cases[v.mine]; v.reveal = g.secret.cases; return end(g, v.offer, `DEAL at ${x2(v.offer)} — your case held ${x2(mine)}`, x.now); }
    if (g.phase === 'offer' && a === 'nodeal') { v.round += 1; v.offer = null; if (v.round < OPENS.length) { v.toOpen = OPENS[v.round]; g.phase = 'open'; } else g.phase = 'final'; return { text: 'No deal.' }; }
    if (g.phase === 'final' && (a === 'keep' || a === 'swap')) {
      const other = g.secret.cases.findIndex((_, k) => k !== v.mine && !(k in v.opened)), take = a === 'keep' ? v.mine : other; v.reveal = g.secret.cases; v.took = take;
      return end(g, g.secret.cases[take], `${a === 'keep' ? 'Kept' : 'Swapped to'} case ${take + 1}: ${x2(g.secret.cases[take])}`, x.now + 300);
    }
    return idle(a);
  },
  controls(g) {
    const v = g.view, cases = (a, ok) => Array.from({ length: 10 }, (_, i) => b(i in v.opened ? x2(v.opened[i]) : `💼 ${i + 1}${i === v.mine ? ' ★' : ''}`, a, { i }, { disabled: !ok(i), br: i === 5 }));
    if (g.phase === 'pick') return { info: 'Player picks a case to keep:', buttons: cases('pick', () => true) };
    if (g.phase === 'open') return { info: `Open ${v.toOpen} more:`, buttons: cases('open', (i) => i !== v.mine && !(i in v.opened)) };
    if (g.phase === 'offer') return { info: `Banker offers <b class="big-turn">${x2(v.offer)}</b>`, buttons: [b('🤝 DEAL', 'deal', {}, { primary: true }), b('✋ NO DEAL', 'nodeal', {}, { danger: true })] };
    return { info: 'Two cases left:', buttons: [b(`Keep case ${v.mine + 1}`, 'keep', {}, { primary: true }), b('Swap', 'swap', {}, { primary: true })] };
  },
  stage(g, now, x) {
    const v = g.view, gone = Object.values(v.opened), board = v.values.map(val => { const k = gone.indexOf(val); const out = k >= 0; if (out) gone.splice(k, 1); return `<span class="xpill ${out ? 'gone' : ''}">${x2(val)}</span>`; }).join('');
    const cases = Array.from({ length: 10 }, (_, i) => { const open = i in v.opened, shown = v.reveal && revealed(g, now);
      return `<div class="xcell small ${i === v.mine ? 'next' : ''} ${open ? 'dim' : ''} ${shown && i === v.took ? 'hit' : ''}">${open ? x2(v.opened[i]) : shown ? x2(v.reveal[i]) : `💼<small>${i + 1}</small>`}</div>`; }).join('');
    const prompt = g.phase === 'pick' ? 'Pick a case to keep' : g.phase === 'open' ? `Open <b>${v.toOpen}</b> more case${v.toOpen === 1 ? '' : 's'}` : g.phase === 'offer' ? `The banker offers <b>${x2(v.offer)}</b> — <b>DEAL</b> or <b>NO DEAL</b>?` : g.phase === 'final' ? '<b>KEEP</b> your case or <b>SWAP</b>?' : '';
    return `<div class="xtrail">${board}</div><div class="xgrid five">${cases}</div>${g.phase === 'offer' ? `<div class="stage-big small crash-live">${x2(v.offer)}</div>` : ''}${revealed(g, now) ? big(g, now, x.esc) : `<div class="stage-sub">${prompt}</div>`}`;
  },
  bot(g, pick, smart) {
    const v = g.view;
    if (g.phase === 'pick') return ['pick', { i: pick.int(0, 9) }];
    if (g.phase === 'open') { const free = Array.from({ length: 10 }, (_, i) => i).filter(i => i !== v.mine && !(i in v.opened)); return ['open', { i: free[pick.int(0, free.length - 1)] }]; }
    if (g.phase === 'offer') return [smart ? 'nodeal' : pick.chance(0.3) ? 'deal' : 'nodeal'];
    return [pick.chance(0.5) ? 'keep' : 'swap'];
  },
};

// ── Dice Hi-Lo ───────────────────────────────────────────────────────────────────────────────────
const WAYS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
export function hilodiceStep(o, total, dir) {
  let hi = 0, lo = 0; for (const [t, w] of Object.entries(WAYS)) { if (Number(t) > total) hi += w; else if (Number(t) < total) lo += w; }
  const p = (dir === 'higher' ? hi : lo) / (hi + lo); return p > 0 ? floor2((1 - Number(o.houseEdge)) / p) : 0;
}
const hilodice = {
  id: 'hilodice', name: 'Dice Hi-Lo', icon: '🎯', odds: { houseEdge: 0.03, maxMult: 200 },
  how: (o) => `Two dice are rolled. Call whether the next roll totals higher or lower. The less likely the call, the more it multiplies your winnings; the same total is a free re-roll. Cash out any time — a wrong call loses the bet. Capped at ${x2(o.maxMult)}.`,
  returns: (o) => [{ label: 'Dice Hi-Lo (per call)', rtp: 1 - o.houseEdge }],
  start(g, x) { const d = [x.rng.int(1, 6), x.rng.int(1, 6)]; Object.assign(g.view, { dice: d, total: d[0] + d[1], rollAt: x.now, mult: 1, prev: 1, steps: 0, history: [], revealAt: null }); g.phase = 'running'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'running') return idle(a);
    if (a === 'cashout') return end(g, v.mult, v.steps ? `Cashed out at ${x2(v.mult)} after ${v.steps} call${v.steps === 1 ? '' : 's'}` : 'Walked away (push)', x.now);
    if (a !== 'higher' && a !== 'lower') return idle(a);
    const step = hilodiceStep(x.odds, v.total, a); if (!step) return { text: `Nothing is ${a} than ${v.total}.`, error: true };
    const d = [x.rng.int(1, 6), x.rng.int(1, 6)], t = d[0] + d[1], was = v.total;
    v.history.push(was); if (v.history.length > 8) v.history.shift(); v.dice = d; v.total = t; v.rollAt = x.now; v.prev = v.mult;
    if (t === was) return { text: `${t} again — free re-roll.` };
    if ((a === 'higher') === (t > was)) {
      v.steps += 1; v.mult = Math.min(Number(x.odds.maxMult), floor2(v.mult * step));
      if (v.mult >= Number(x.odds.maxMult)) return end(g, v.mult, `Hit the ${x2(v.mult)} table limit`, x.now + DICE_MS + 100);
      return { text: `${t} — correct. ${x2(v.mult)}` };
    }
    return end(g, 0, `${t} is not ${a} than ${was}`, x.now + DICE_MS + 100);
  },
  controls(g, x) { const v = g.view, hi = hilodiceStep(x.odds, v.total, 'higher'), lo = hilodiceStep(x.odds, v.total, 'lower');
    return { info: `<span class="big-turn">${x2(v.mult)}</span> <span class="subtle">showing ${v.total}</span>`, buttons: [b(`⬆ HIGHER${hi ? ` (×${hi.toFixed(2)})` : ''}`, 'higher', {}, { primary: true, disabled: !hi }), b(`⬇ LOWER${lo ? ` (×${lo.toFixed(2)})` : ''}`, 'lower', {}, { primary: true, disabled: !lo }), b('💰 CASH OUT', 'cashout', {}, { danger: true })] }; },
  stage(g, now, x) {
    const v = g.view, settled = diceLanded(v.rollAt, now), hi = hilodiceStep(x.odds, v.total, 'higher'), lo = hilodiceStep(x.odds, v.total, 'lower');
    return `<div class="xtrail">${v.history.map(t => `<span class="xpill">${t}</span>`).join('')}</div>${diceHtml(v.dice, v.rollAt, now)}${settled ? `<div class="stage-sub">Total <b class="xnum">${v.total}</b></div>` : ''}
      ${revealed(g, now) ? big(g, now, x.esc) : g.phase === 'done' ? '' : `<div class="stage-big small crash-live">${x2(settled ? v.mult : v.prev)}</div>${settled ? `<div class="stage-sub">${hi ? `⬆ HIGHER ×${hi.toFixed(2)}` : '⬆ nothing beats 12'} · ${lo ? `⬇ LOWER ×${lo.toFixed(2)}` : '⬇ nothing is under 2'} · or CASH OUT</div>` : ''}`}`;
  },
  bot: (g, pick, smart) => (g.view.steps >= (smart ? 2 : pick.int(0, 4)) ? ['cashout'] : [smart ? (g.view.total <= 7 ? 'higher' : 'lower') : g.view.total === 2 ? 'higher' : g.view.total === 12 ? 'lower' : pick.chance(0.5) ? 'higher' : 'lower']),
};

// ── Ride the Bus ─────────────────────────────────────────────────────────────────────────────────
const RED = (c) => c.s === '♥' || c.s === '♦';
// What each call would pay at this stop, given the cards already out: { call: stepMult } (0 = cannot win).
export function busOptions(o, shown, deck) {
  const n = deck.length, k = (pred) => deck.filter(pred).length / n, m = (p) => (p > 0 ? floor2((1 - Number(o.stageEdge)) / p) : 0), s = shown.length;
  if (s === 0) return { red: m(k(RED)), black: m(k(c => !RED(c))) };
  if (s === 1) return { higher: m(k(c => rv(c) > rv(shown[0]))), lower: m(k(c => rv(c) < rv(shown[0]))) };
  if (s === 2) { const lo = Math.min(rv(shown[0]), rv(shown[1])), hi = Math.max(rv(shown[0]), rv(shown[1])); return { inside: m(k(c => rv(c) > lo && rv(c) < hi)), outside: m(k(c => rv(c) < lo || rv(c) > hi)) }; }
  return Object.fromEntries(['♠', '♥', '♦', '♣'].map(su => [su, m(k(c => c.s === su))]));
}
const BUS_Q = ['Red or black?', 'Higher or lower than the first card?', 'Inside or outside the first two?', 'Which suit?'];
const busHit = (call, shown, c) => {
  const s = shown.length;
  if (s === 0) return (call === 'red') === RED(c);
  if (s === 1) return call === 'higher' ? rv(c) > rv(shown[0]) : rv(c) < rv(shown[0]);
  if (s === 2) { const lo = Math.min(rv(shown[0]), rv(shown[1])), hi = Math.max(rv(shown[0]), rv(shown[1])); return call === 'inside' ? rv(c) > lo && rv(c) < hi : rv(c) < lo || rv(c) > hi; }
  return c.s === call;
};
const bus = {
  id: 'bus', name: 'Ride the Bus', icon: '🚌', odds: { stageEdge: 0.015 },
  how: () => 'Four calls in a row, one card each: red or black; higher or lower than the first card; inside or outside the first two; and the suit. Each right call multiplies your winnings by what that call was worth. Cash out after any card — a wrong call (or a tie) loses the bet. Aces are high.',
  returns: (o) => [{ label: 'Ride the Bus (per call)', rtp: 1 - o.stageEdge }, { label: 'Ride the Bus (all four)', rtp: (1 - o.stageEdge) ** 4 }],
  start(g, x) { g.secret.deck = freshDeck(shuffle, x.rng, 1); Object.assign(g.view, { cards: [], mult: 1, prev: 1, opts: busOptions(x.odds, [], g.secret.deck), revealAt: null }); g.phase = 'running'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'running') return idle(a);
    if (a === 'cashout') return v.cards.length ? end(g, v.mult, `Got off at ${x2(v.mult)} after ${v.cards.length} card${v.cards.length === 1 ? '' : 's'}`, x.now) : end(g, 1, 'Never got on (push)', x.now);
    const step = v.opts[p.v]; if (a !== 'call' || !step) return idle(a);
    const shown = v.cards.slice(), c = draw(g, x.now + 250); v.cards.push(c); v.prev = v.mult; v.flipAt = x.now + 250;
    if (!busHit(p.v, shown, c)) return end(g, 0, `${c.r}${c.s} — called ${p.v}`, x.now + 800);
    v.mult = floor2(v.mult * step);
    if (v.cards.length >= 4) return end(g, v.mult, `Rode the whole bus — ${x2(v.mult)}`, x.now + 800);
    v.opts = busOptions(x.odds, v.cards, g.secret.deck);
    return { text: `${c.r}${c.s} — correct. ${x2(v.mult)}` };
  },
  controls: (g) => ({ info: `<span class="big-turn">${x2(g.view.mult)}</span> <span class="subtle">${BUS_Q[g.view.cards.length]} ${g.view.cards.length ? '· ' + txt(g.view.cards) : ''}</span>`,
    buttons: [...Object.entries(g.view.opts).map(([k, m]) => b(`${k.toUpperCase()}${m ? ` ×${m.toFixed(2)}` : ''}`, 'call', { v: k }, { primary: true, disabled: !m })), b('💰 GET OFF', 'cashout', {}, { danger: true, disabled: !g.view.cards.length })] }),
  stage(g, now, x) {
    const v = g.view, landed = !v.flipAt || now >= v.flipAt + 300;
    const stops = BUS_Q.map((q, i) => `<span class="xpill ${i < v.cards.length ? 'ok' : i === v.cards.length && g.phase === 'running' ? 'now' : ''}">${i + 1}</span>`).join('');
    return `<div class="xtrail">${stops}</div>${x.cardsHtml(v.cards, now)}
      ${revealed(g, now) ? big(g, now, x.esc) : g.phase === 'done' ? '' : `<div class="stage-big small crash-live">${x2(landed ? v.mult : v.prev)}</div><div class="stage-sub"><b>${BUS_Q[v.cards.length]}</b> ${Object.entries(v.opts).filter(([, m]) => m).map(([k, m]) => `${k.toUpperCase()} ×${m.toFixed(2)}`).join(' · ')}</div>`}`;
  },
  bot(g, pick, smart) { const v = g.view, live = Object.entries(v.opts).filter(([, m]) => m);
    if (v.cards.length && (smart ? v.cards.length >= 2 : pick.chance(0.3))) return ['cashout'];
    return ['call', { v: (smart ? live.slice().sort((a, c) => a[1] - c[1])[0] : live[pick.int(0, live.length - 1)])[0] }]; },
};

// ── Thimbles ─────────────────────────────────────────────────────────────────────────────────────
const thimbles = {
  id: 'thimbles', name: 'Thimbles', icon: '🥤', odds: { cups: 3, pay: 2.88 },
  how: (o) => `A ball goes under one of ${o.cups} cups and they are shuffled. Point at the right cup and get ${x2(o.pay)} your bet back.`,
  returns: (o) => [{ label: 'Thimbles', rtp: Number(o.pay) / Number(o.cups) }],
  start(g, x) { const n = Math.max(2, Math.min(6, Math.round(Number(x.odds.cups)) || 3)); g.secret.ball = x.rng.int(0, n - 1); Object.assign(g.view, { cups: n, pick: null, ball: null, shuffleAt: x.now, revealAt: null }); g.phase = 'pick'; },
  act(g, a, p, x) {
    const v = g.view, i = Math.round(Number(p.i)); if (g.phase !== 'pick' || a !== 'pick' || !(i >= 0 && i < v.cups)) return idle(a);
    v.pick = i; v.ball = g.secret.ball; v.liftAt = x.now;
    return end(g, i === v.ball ? Number(x.odds.pay) : 0, i === v.ball ? `Found it — ${x2(x.odds.pay)}` : `It was under cup ${v.ball + 1}`, x.now + 700);
  },
  controls: (g) => ({ info: 'Player points at a cup:', buttons: Array.from({ length: g.view.cups }, (_, i) => b(`🥤 Cup ${i + 1}`, 'pick', { i }, { primary: true })) }),
  stage(g, now, x) {
    const v = g.view, mixing = now < v.shuffleAt + 1600, lifted = v.pick != null && now >= v.liftAt + 300;
    const cups = Array.from({ length: v.cups }, (_, i) => `<div class="xcup ${mixing ? 'mix m' + (i % 3) : ''} ${lifted && (i === v.pick || i === v.ball) ? 'up' : ''} ${lifted && i === v.pick ? 'picked' : ''}"><span class="xcup-c"></span><span class="xcup-b">${lifted && i === v.ball ? '🔴' : ''}</span><small>${i + 1}</small></div>`).join('');
    return `<div class="xcups">${cups}</div>${revealed(g, now) ? big(g, now, x.esc) : `<div class="stage-sub">${mixing ? 'Keep your eye on the ball…' : 'Which cup?'}</div>`}`;
  },
  bot: (g, pick) => ['pick', { i: pick.int(0, g.view.cups - 1) }],
};

export const SHOW = [race, tower, chicken, pachinko, deal, hilodice, bus, thimbles];
