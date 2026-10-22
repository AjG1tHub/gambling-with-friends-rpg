// Shared-screen stage HTML for the 12 classics, ported from legacy/site/js/game-ui.js as pure string functions
// (no DOM). The plug-ins carry their own `stage(g, now, x)`; `stageFor` routes to either. `x` supplies `esc`,
// `cardsHtml(cards, now)` and `odds` exactly as the legacy test harness does. The TV renders a snapshot that has
// no `secret`; after a round ends the adapter copies what may be shown into `view.reveal` (mines).
import { crashMult, crashHasCrashed, rouletteColor, bjTotal, bacTotal, cardIsRed, PLINKO_STEP_MS, hiloStepMult, DICE_ROLL_MS, SLOTS_REEL_MS, KENO_BALL_MS, kenoRules } from './legacy/games.js';
import { EXTRA } from './legacy/games-extra.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shown = (cards, now) => cards.filter(c => c.t == null || c.t <= now);
const faceDown = (c, now) => !!c.down || (c.flipAt != null && now < c.flipAt);
// The same card markup the legacy player view used; the TV's CSS classes (pcard, pcard-row, red, back) carry over.
export function cardsHtml(cards, now) {
  const vis = shown(cards || [], now);
  if (!vis.length) return '<div class="pcard-row"><div class="pcard ghost"></div></div>';
  const fresh = (c) => (now - (faceDown(c, now) ? (c.t || 0) : Math.max(c.t || 0, c.flipAt || 0)) < 320 ? ' new' : '');
  return `<div class="pcard-row">${vis.map(c => faceDown(c, now) ? `<div class="pcard back${fresh(c)}"></div>` : `<div class="pcard${cardIsRed(c) ? ' red' : ''}${fresh(c)}"><span class="pc-r">${esc(c.r)}</span><span class="pc-s">${c.s}</span></div>`).join('')}</div>`;
}
const resultClass = (mult) => (mult > 1 ? 'crash-good' : mult < 1 ? 'crash-bad' : '');
const outcome = (g) => g.result || g.pending || null;

export function blackjackBody(g, now, x) {
  const v = g.view, dv = shown(v.dealer, now).filter(c => !faceDown(c, now)), dt = dv.length ? bjTotal(dv) : null;
  const done = g.phase === 'done' && now >= (v.revealAt || 0), many = v.hands.length > 1;
  const hands = v.hands.map((h, i) => { const pv = shown(h.cards, now), pt = pv.length ? bjTotal(pv) : null;
    const res = done && h.outcome ? `<div class="hand-result ${h.outcome.profit > 0 ? 'crash-good' : h.outcome.profit < 0 ? 'crash-bad' : ''}">${x.esc(h.outcome.label)}</div>` : '';
    return `<div class="hand ${many && i === v.active ? 'winner' : ''}"><div class="hand-label">${many ? 'Hand ' + (i + 1) : 'Player'} <b>${pt ? (pt.soft && pt.total < 21 ? 'soft ' : '') + pt.total : ''}</b>${h.doubled ? ' <span class="chip">DOUBLED</span>' : ''}</div>${x.cardsHtml(h.cards, now)}${many ? res : ''}</div>`; }).join('');
  const active = v.hands[v.active];
  const prompt = g.phase === 'insurance' ? 'Dealer shows an Ace — <b>INSURANCE?</b> (half the stake, pays 2:1 on a dealer blackjack)'
    : `${many ? `Hand ${v.active + 1}: ` : ''}<b>HIT</b>, <b>STAND</b>${active && active.cards.length === 2 ? ', <b>DOUBLE</b>' : ''}${active && active.cards.length === 2 && active.cards[0].r === active.cards[1].r ? ' or <b>SPLIT</b>' : ''}`;
  const status = done ? `<div class="stage-big ${resultClass(g.result.mult)} ${many ? 'small' : ''}">${many ? `Net ${g.result.mult - 1 > 0 ? '+' : ''}${Math.round((g.result.mult - 1) * 100) / 100}× stake` : x.esc(g.result.label)}</div>`
    : g.phase === 'done' ? '<div class="stage-sub">Dealer plays…</div>' : `<div class="stage-sub">${prompt}</div>`;
  return `<div class="card-table"><div class="hand"><div class="hand-label">Dealer <b>${dt ? dt.total : ''}</b>${v.insurance === 'taken' ? ' <span class="chip">INSURED</span>' : ''}</div>${x.cardsHtml(v.dealer, now)}</div><div class="hands-row">${hands}</div></div>${status}`;
}
export function baccaratBody(g, now, x) {
  const v = g.view;
  if (g.phase === 'bet') return `<div class="stage-sub">Bet: <b>${v.bet ? x.esc(String(v.bet).toUpperCase()) : 'choosing Player, Banker or Tie…'}</b></div>`;
  const pv = shown(v.player, now), bv = shown(v.banker, now), done = now >= (v.revealAt || 0), win = (side) => (done && v.winner === side ? ' winner' : '');
  return `<div class="stage-sub">Bet on <b>${x.esc(String(v.bet).toUpperCase())}</b></div><div class="card-table side-by-side"><div class="hand${win('player')}"><div class="hand-label">Player <b>${pv.length ? bacTotal(pv) : ''}</b></div>${x.cardsHtml(v.player, now)}</div><div class="hand${win('banker')}"><div class="hand-label">Banker <b>${bv.length ? bacTotal(bv) : ''}</b></div>${x.cardsHtml(v.banker, now)}</div></div>${done ? `<div class="stage-big ${resultClass(g.result.mult)}">${x.esc(g.result.label)}</div>` : '<div class="stage-sub">Dealing…</div>'}`;
}
export function hiloBody(g, now, x) {
  const v = g.view, vis = shown(v.cards, now), top = vis.at(-1), done = g.phase === 'done' && now >= (v.revealAt || 0);
  const hi = top ? hiloStepMult(x.odds, top.r, 'higher') : 0, lo = top ? hiloStepMult(x.odds, top.r, 'lower') : 0;
  const status = done ? `<div class="stage-big ${resultClass(g.result.mult)}">${x.esc(g.result.label)}</div>`
    : `<div class="stage-big crash-live">${v.mult.toFixed(2)}×</div><div class="stage-sub">${hi ? `⬆ HIGHER pays ×${hi.toFixed(2)}` : '⬆ nothing beats a King'} &nbsp;·&nbsp; ${lo ? `⬇ LOWER pays ×${lo.toFixed(2)}` : '⬇ nothing is under an Ace'} &nbsp;·&nbsp; or CASH OUT</div>`;
  return `<div class="hilo-trail">${x.cardsHtml(v.cards, now)}</div><div class="stage-sub">Aces are low · same rank = free redraw</div>${status}`;
}
export function diceBody(g, now) {
  const v = g.view, b = v.bet;
  if (!b) return '<div class="stage-sub">Choosing a bet: roll 1–100, UNDER or OVER a target…</div>';
  const rolling = v.rollAt != null && now < v.rollAt + DICE_ROLL_MS, landed = v.rollAt != null && !rolling;
  const face = v.rollAt == null ? '?' : rolling ? ((Math.floor(now / 60) * 37) % 100) + 1 : v.roll;
  const o = outcome(g), won = landed && o && o.mult > 0, lo = b.dir === 'under' ? 0 : b.target, hi = b.dir === 'under' ? b.target - 1 : 100;
  return `<div class="stage-sub">Bet: <b>${b.dir.toUpperCase()} ${b.target}</b> — ${b.chance}% to win, pays <b>${b.mult}×</b></div><div class="dice-face ${landed ? (won ? 'win' : 'lose') : ''}">${face}</div><div class="dice-bar"><div class="dice-win" style="left:${lo}%;width:${hi - lo}%"></div>${landed ? `<div class="dice-mark" style="left:${v.roll - 0.5}%"></div>` : ''}</div><div class="dice-scale"><span>1</span><span>25</span><span>50</span><span>75</span><span>100</span></div>${landed ? `<div class="stage-big ${won ? 'crash-good' : 'crash-bad'}">${won ? `WIN — ${o.mult}×` : 'MISS'}</div>` : ''}`;
}
export function slotsBody(g, now, x) {
  const v = g.view, sy = v.symbols || [], o = outcome(g);
  const reel = (i) => { if (!v.reels) return '<div class="slot-reel idle">❔</div>'; const stopped = now >= v.spinAt + SLOTS_REEL_MS[i]; const icon = stopped ? sy[v.reels[i]].icon : sy[(Math.floor(now / 70) + i * 2) % sy.length].icon; return `<div class="slot-reel ${stopped ? 'stopped' : 'spinning'}">${icon}</div>`; };
  const done = v.reels && now >= v.revealAt;
  const status = !v.reels ? '<div class="stage-sub">Pull the lever…</div>' : !done ? '<div class="stage-sub">…</div>' : `<div class="stage-big ${resultClass(o ? o.mult : 0)}">${o && o.mult ? x.esc(o.label) : 'No line'}</div>`;
  return `<div class="slot-machine ${done && v.win !== 'none' ? 'win' : ''}">${reel(0)}${reel(1)}${reel(2)}</div>${status}`;
}
export function kenoBody(g, now, x) {
  const v = g.view, n = v.numbers || 40, rules = kenoRules(x.odds), o = outcome(g);
  const balls = v.draw ? Math.min(v.draw.length, Math.max(0, Math.floor((now - v.drawAt) / KENO_BALL_MS))) : 0, out = new Set(v.draw ? v.draw.slice(0, balls) : []);
  let grid = `<div class="keno-grid" style="grid-template-columns:repeat(${n > 40 ? 10 : 8},1fr)">`;
  for (let i = 1; i <= n; i++) { const picked = v.picks.includes(i) || (v.bonusPicks || []).includes(i), hit = out.has(i); grid += `<div class="keno-cell ${picked ? 'picked' : ''} ${hit ? (picked ? 'hit' : 'drawn') : ''}">${i}</div>`; }
  grid += '</div>';
  const k = v.picks.length, hitsSoFar = v.picks.filter(q => out.has(q)).length, done = v.draw && now >= v.revealAt;
  const pays = k ? Object.entries(rules.pays[k] || {}).map(([h, m]) => `<span class="keno-pay ${v.draw && Number(h) === hitsSoFar ? 'on' : ''}">${h} → ${m}×</span>`).join('') : '';
  const status = !v.draw ? `<div class="stage-sub">${k ? `${k} number${k === 1 ? '' : 's'} picked — call more, or DRAW` : `Call up to ${v.maxPicks} numbers`}</div>` : !done ? `<div class="stage-sub">Ball ${balls} of ${v.draw.length} · ${hitsSoFar} hit${hitsSoFar === 1 ? '' : 's'}</div>` : `<div class="stage-big ${resultClass(o ? o.mult : 0)}">${x.esc(o ? o.label : '')}</div>`;
  return `${grid}<div class="keno-pays">${pays}</div>${status}`;
}
export function plinkoBody(g, now) {
  const mults = g.view.mults || [], n = mults.length - 1, S = 30, RH = 24, W = (n + 2) * S, top = 26, H = top + n * RH + 34, cx = W / 2;
  let pegs = ''; for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) pegs += `<circle cx="${cx + (j - i / 2) * S}" cy="${top + i * RH}" r="2.6" class="plk-peg"/>`;
  const drop = g.view.drop, landed = drop && now >= drop.ts + n * PLINKO_STEP_MS, slotY = top + (n - 1) * RH + 14, tier = (m) => (m >= 10 ? 'hot' : m >= 2 ? 'warm' : m >= 1 ? 'even' : 'cold');
  let slots = ''; mults.forEach((m, k) => { const px = cx + (k - n / 2) * S; slots += `<g class="plk-slot ${tier(m)}${landed && drop.slot === k ? ' hit' : ''}"><rect x="${px - S / 2 + 1.5}" y="${slotY}" width="${S - 3}" height="18" rx="4"/><text x="${px}" y="${slotY + 13}" text-anchor="middle">${m}</text></g>`; });
  let ball = '';
  if (drop) { const f = Math.min(n, Math.max(0, (now - drop.ts) / PLINKO_STEP_MS)), i = Math.min(n - 1, Math.floor(f)), frac = f >= n ? 1 : f - i; const rights = drop.path.slice(0, i).reduce((a, c) => a + c, 0);
    const x0 = cx + (rights - i / 2) * S, x1 = x0 + (drop.path[i] ? S / 2 : -S / 2), px = x0 + (x1 - x0) * frac, py = top - 7 + (i + frac) * RH - Math.sin(Math.PI * frac) * 5; ball = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" class="plk-ball"/>`; }
  const status = !drop ? '<div class="stage-sub">Ready to drop…</div>' : !landed ? '<div class="stage-sub">…</div>' : `<div class="stage-big ${resultClass(mults[drop.slot])}">${mults[drop.slot]}×</div>`;
  return `<svg class="plinko-svg" viewBox="0 0 ${W} ${H}">${pegs}${slots}${ball}</svg>${status}`;
}
export function crashBody(g, now) {
  if (!g.startedTs) return '<div class="stage-sub">Ready for launch…</div><div class="stage-big">1.00×</div>';
  const crashAt = g.secret?.crashAt ?? g.view.finalMult ?? Infinity;
  const crashed = g.phase === 'done' ? !!g.view.crashed : (g.secret ? crashHasCrashed(g, now) : false);
  const m = g.phase === 'done' ? g.view.finalMult : crashed ? crashAt : crashMult(g, now);
  const pts = []; const t = Math.min((now - g.startedTs) / 1000, 60);
  for (let i = 0; i <= 60; i++) { const tt = t * i / 60, mm = Math.min(m, Math.exp((g.view.growthPerSec || 0.1) * tt)); pts.push(`${(i / 60 * 300).toFixed(1)},${(120 - Math.min(118, (mm - 1) / Math.max(1, m - 1) * 110)).toFixed(1)}`); }
  const status = g.phase === 'done' ? (g.view.crashed ? `<div class="stage-big crash-bad">💥 CRASHED @ ${m}×</div>` : `<div class="stage-big crash-good">💰 CASHED OUT @ ${m}×</div>`) : crashed ? `<div class="stage-big crash-bad">💥 CRASHED @ ${m}×</div>` : `<div class="stage-big crash-live">${Number(m).toFixed(2)}×</div>`;
  return `<svg class="crash-svg" viewBox="0 0 300 120" preserveAspectRatio="none"><polyline points="${pts.join(' ')}" fill="none" stroke="${crashed ? '#e05252' : '#7ddb8a'}" stroke-width="3"/></svg>${status}`;
}
export function minesBody(g, now, x) {
  const v = g.view, n = v.grid || 25, cols = Math.round(Math.sqrt(n)), mines = v.revealAll ? (g.secret?.mines || v.reveal?.mines || []) : [];
  const cells = [];
  for (let i = 0; i < n; i++) { const revealed = v.revealed.includes(i), isMine = mines.includes(i), hit = v.hit === i; const cls = hit ? 'mine hit' : isMine ? 'mine' : revealed ? 'safe' : 'hidden';
    cells.push(`<div class="mine-cell ${cls}">${hit ? '💥' : isMine ? '💣' : revealed ? '💎' : `<span class="mine-num">${i + 1}</span>`}</div>`); }
  const status = g.phase === 'done' ? `<div class="stage-big ${g.result.mult > 0 ? 'crash-good' : 'crash-bad'}">${x.esc(g.result.label)}</div>` : `<div class="stage-big crash-live">${v.mult.toFixed(2)}×</div><div class="stage-sub mines-hint">💎 ${v.revealed.length} safe found · 💣 ${v.minesCount} mines hidden</div>`;
  return `<div class="mine-grid" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>${status}`;
}
export function rouletteBody(g, now, x) {
  const bet = g.view.bet, betText = bet ? `${bet.type}${bet.type === 'straight' ? ' ' + bet.number : ''}` : 'placing bet…', pocket = g.view.pocket, o = outcome(g);
  return `<div class="stage-sub">Bet: <b>${x.esc(betText)}</b></div>${pocket != null ? `<div class="stage-big roulette-${rouletteColor(pocket)}">${pocket}</div>` : ''}${o ? `<div class="stage-sub ${resultClass(o.mult)}">${x.esc(o.label)}</div>` : ''}`;
}
export function wheelBody(g, now, x) { const o = outcome(g); return o ? `<div class="stage-big ${resultClass(o.mult)}">${x.esc(o.label)}</div>` : '<div class="stage-sub">Spinning…</div>'; }

// Red Dog (Hound Snap): the plug-in's stage says "RAISE … or CALL"; the phone's buttons say DEAL / DOUBLE. One wording.
export function reddogBody(g, now, x) {
  const v = g.view, mid = v.third ? '' : '<div class="pcard ghost"></div>';
  const RANK = { A: 14, K: 13, Q: 12, J: 11 }; const rv = (c) => RANK[c.r] || Number(c.r);
  const [lo, hi] = [...v.cards].sort((a, b) => rv(a) - rv(b));
  const ask = g.phase === 'decide' && now >= (v.askAt || 0);
  return `<div class="xbetween">${x.cardsHtml([lo], now)}${v.third ? x.cardsHtml([v.third], now) : `<div class="pcard-row">${mid}</div>`}${x.cardsHtml([hi], now)}</div>
    ${ask ? `<div class="stage-sub">Gap of <b>${v.spread}</b> — a card in between pays <b>${v.pay}:1</b>. <b>DEAL</b> as it is, or <b>DOUBLE</b> the stake first.</div>` : bigResult(g, now, x.esc)}`;
}
const bigResult = (g, now, esc) => (g.phase === 'done' && g.result && now >= (g.view?.revealAt || 0) ? `<div class="stage-big ${g.result.mult > 1 ? 'crash-good' : g.result.mult < 1 ? 'crash-bad' : ''}">${esc(g.result.label)}</div>` : '');
export const CLASSIC_STAGES = { reddog: reddogBody, crash: crashBody, mines: minesBody, roulette: rouletteBody, blackjack: blackjackBody, baccarat: baccaratBody, plinko: plinkoBody, hilo: hiloBody, dice: diceBody, slots: slotsBody, keno: kenoBody, bigwheel: wheelBody, fifty: wheelBody };
// Stage HTML for any of the 36. `x` must carry `odds`; `esc` and `cardsHtml` default to the ones above.
export function stageHtml(g, now, x = {}) {
  const xx = { esc, cardsHtml, odds: {}, ...x };
  if (CLASSIC_STAGES[g.id]) return CLASSIC_STAGES[g.id](g, now, xx);
  if (EXTRA[g.id]) return EXTRA[g.id].stage(g, now, xx);
  return `<div class="stage-sub">${esc(g.id)}</div>`;
}
export const stageFor = stageHtml;
