// Player-view renderer for the live minigame (state.game) and the session recap.
// Pure rendering: reads state, writes DOM. Wheel-type games are animated by the
// shared wheel overlay (state.lastSpin); this stage shows context + live games.
import { esc } from './wheel-ui.js';
import { normalizeStakes, stakeLine } from './stakes.js';
import { sessionStats } from './stats.js';
import { STATUS as PET_STATUS, effectiveAc } from './petbattle.js';
import { spriteHtml } from './sprites.js';
import { currentLot, lotLabel } from './auction.js';
import { goldChartSvg } from './ledger-tools.js';
import { crashMult, crashHasCrashed, gameDef, rouletteColor, bjTotal, bacTotal, cardIsRed, PLINKO_STEP_MS, hiloStepMult, effectiveOdds, DICE_ROLL_MS, SLOTS_REEL_MS, KENO_BALL_MS, kenoRules, extraDef, extraCtx } from './games.js';

const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US');

export function renderGameStage(el, config, state, now = Date.now()) {
  const g = state.game;
  if (!g && state.auction) { renderAuctionStage(el, state.auction); return; }
  if (!g && state.contest) { renderContestStage(el, state.contest); return; }
  if (!g && state.raid) { renderRaidStage(el, state.raid, config); return; }
  if (!g && state.petBattle) { renderPetBattleStage(el, state.petBattle, config); return; }
  if (!g && state.shop) { renderShopStage(el, config, state); return; }
  if (!g) { el.classList.remove('show'); el.innerHTML = ''; el._gwfHtml = ''; return; }
  const def = gameDef(config, g.id) || { name: g.id, icon: '🎲' };
  const p = state.players.find(x => x.id === g.playerId);
  const wagerText = g.wagers.map(w => `${fmt(w.amount)} ${w.cur}`).join(' + ');
  let body = '';
  switch (g.id) {
    case 'crash': body = crashBody(g, now); break;
    case 'mines': body = minesBody(g); break;
    case 'roulette': body = rouletteBody(g); break;
    case 'blackjack': body = blackjackBody(g, now); break;
    case 'baccarat': body = baccaratBody(g, now); break;
    case 'plinko': body = plinkoBody(g, now); break;
    case 'hilo': body = hiloBody(g, now, effectiveOdds(config, state, 'hilo')); break;
    case 'dice': body = diceBody(g, now); break;
    case 'slots': body = slotsBody(g, now); break;
    case 'keno': body = kenoBody(g, now, kenoRules(effectiveOdds(config, state, 'keno'))); break;
    case 'bigwheel': case 'fifty': case 'placeholder':
      body = g.pending ? `<div class="stage-big">${esc(g.pending.label)}</div>` : `<div class="stage-sub">Spinning…</div>`; break;
    default: { const X = extraDef(g.id); body = X ? X.stage(g, now, { ...extraCtx(config, state, null, g, now), esc, cardsHtml }) : ''; }
  }
  const html = `
    <div class="stage-head">${def.icon || '🎲'} ${esc(def.name)}</div>
    <div class="stage-sub">${esc(p ? p.name : '?')} wagers <b>${esc(wagerText)}</b></div>
    ${body}`;
  // Ticking games re-render many times a second — only touch the DOM when something changed
  if (el._gwfHtml !== html || el.innerHTML === '') { el.innerHTML = html; el._gwfHtml = html; }
  el.classList.add('show');
}

// ── Cards ────────────────────────────────────────────────────────
const shown = (cards, now) => cards.filter(c => c.t <= now);
const faceDown = (c, now) => !!c.down || (c.flipAt != null && now < c.flipAt);
function cardsHtml(cards, now) {
  const vis = shown(cards, now);
  if (!vis.length) return `<div class="pcard-row"><div class="pcard ghost"></div></div>`;
  // 'new' = just landed / just flipped → plays the deal-in animation once (not on every re-render)
  const fresh = (c) => now - (faceDown(c, now) ? c.t : Math.max(c.t, c.flipAt || 0)) < 320 ? ' new' : '';
  return `<div class="pcard-row">${vis.map(c => faceDown(c, now)
    ? `<div class="pcard back${fresh(c)}"></div>`
    : `<div class="pcard${cardIsRed(c) ? ' red' : ''}${fresh(c)}"><span class="pc-r">${esc(c.r)}</span><span class="pc-s">${c.s}</span></div>`).join('')}</div>`;
}
const resultClass = (mult) => mult > 1 ? 'crash-good' : mult < 1 ? 'crash-bad' : '';

function blackjackBody(g, now) {
  const v = g.view;
  const dv = shown(v.dealer, now).filter(c => !faceDown(c, now));
  const dt = dv.length ? bjTotal(dv) : null;
  const done = g.phase === 'done' && now >= v.revealAt;
  const many = v.hands.length > 1;
  const hands = v.hands.map((h, i) => {
    const pv = shown(h.cards, now), pt = pv.length ? bjTotal(pv) : null;
    const res = done && h.outcome ? `<div class="hand-result ${h.outcome.profit > 0 ? 'crash-good' : h.outcome.profit < 0 ? 'crash-bad' : ''}">${esc(h.outcome.label)}</div>` : '';
    return `<div class="hand ${many && i === v.active ? 'winner' : ''}"><div class="hand-label">${many ? 'Hand ' + (i + 1) : 'Player'} <b>${pt ? (pt.soft && pt.total < 21 ? 'soft ' : '') + pt.total : ''}</b>${h.doubled ? ' <span class="chip">DOUBLED</span>' : ''}</div>${cardsHtml(h.cards, now)}${many ? res : ''}</div>`;
  }).join('');
  const active = v.hands[v.active];
  const prompt = g.phase === 'insurance' ? `Dealer shows an Ace — <b>INSURANCE?</b> (half your stake, pays 2:1 on a dealer blackjack)`
    : `${many ? `Hand ${v.active + 1}: ` : ''}Say <b>HIT</b>, <b>STAND</b>${active && active.cards.length === 2 ? ', <b>DOUBLE</b>' : ''}${active && active.cards.length === 2 && active.cards[0].r === active.cards[1].r ? ' or <b>SPLIT</b>' : ''}`;
  const status = done
    ? `<div class="stage-big ${resultClass(g.result.mult)} ${many ? 'small' : ''}">${many ? `Net ${g.result.mult - 1 > 0 ? '+' : ''}${Math.round((g.result.mult - 1) * 100) / 100}× stake` : esc(g.result.label)}</div>`
    : g.phase === 'done' ? `<div class="stage-sub">Dealer plays…</div>`
    : `<div class="stage-sub">${prompt}</div>`;
  return `<div class="card-table">
      <div class="hand"><div class="hand-label">Dealer <b>${dt ? dt.total : ''}</b>${v.insurance === 'taken' ? ' <span class="chip">INSURED</span>' : ''}</div>${cardsHtml(v.dealer, now)}</div>
      <div class="hands-row">${hands}</div>
    </div>${status}`;
}

function baccaratBody(g, now) {
  const v = g.view;
  if (g.phase === 'bet') return `<div class="stage-sub">Bet: <b>${v.bet ? esc(v.bet.toUpperCase()) : 'choosing Player, Banker or Tie…'}</b></div>`;
  const pv = shown(v.player, now), bv = shown(v.banker, now);
  const done = now >= v.revealAt;
  const win = (side) => done && v.winner === side ? ' winner' : '';
  return `<div class="stage-sub">Bet on <b>${esc(String(v.bet).toUpperCase())}</b></div>
    <div class="card-table side-by-side">
      <div class="hand${win('player')}"><div class="hand-label">Player <b>${pv.length ? bacTotal(pv) : ''}</b></div>${cardsHtml(v.player, now)}</div>
      <div class="hand${win('banker')}"><div class="hand-label">Banker <b>${bv.length ? bacTotal(bv) : ''}</b></div>${cardsHtml(v.banker, now)}</div>
    </div>
    ${done ? `<div class="stage-big ${resultClass(g.result.mult)}">${esc(g.result.label)}</div>` : `<div class="stage-sub">Dealing…</div>`}`;
}

// ── Hi-Lo ────────────────────────────────────────────────────────
function hiloBody(g, now, odds) {
  const v = g.view, vis = shown(v.cards, now), top = vis.at(-1);
  const done = g.phase === 'done' && now >= (v.revealAt || 0);
  const hi = top ? hiloStepMult(odds, top.r, 'higher') : 0, lo = top ? hiloStepMult(odds, top.r, 'lower') : 0;
  const status = done ? `<div class="stage-big ${resultClass(g.result.mult)}">${esc(g.result.label)}</div>`
    : `<div class="stage-big crash-live">${v.mult.toFixed(2)}×</div>
       <div class="stage-sub">${hi ? `⬆ HIGHER pays ×${hi.toFixed(2)}` : '⬆ nothing beats a King'} &nbsp;·&nbsp; ${lo ? `⬇ LOWER pays ×${lo.toFixed(2)}` : '⬇ nothing is under an Ace'} &nbsp;·&nbsp; or CASH OUT</div>`;
  return `<div class="hilo-trail">${cardsHtml(v.cards, now)}</div><div class="stage-sub">Aces are low · same rank = free redraw</div>${status}`;
}

// ── Dice ─────────────────────────────────────────────────────────
function diceBody(g, now) {
  const v = g.view, b = v.bet;
  if (!b) return `<div class="stage-sub">Choosing a bet: roll 1–100, UNDER or OVER a target…</div>`;
  const rolling = v.rollAt != null && now < v.rollAt + DICE_ROLL_MS, landed = v.rollAt != null && !rolling;
  // while tumbling, flash numbers derived from the clock (purely cosmetic — the roll is already decided)
  const face = v.rollAt == null ? '?' : rolling ? ((Math.floor(now / 60) * 37) % 100) + 1 : v.roll;
  const won = landed && g.pending && g.pending.mult > 0;
  const lo = b.dir === 'under' ? 0 : b.target, hi = b.dir === 'under' ? b.target - 1 : 100;
  return `<div class="stage-sub">Bet: <b>${b.dir.toUpperCase()} ${b.target}</b> — ${b.chance}% to win, pays <b>${b.mult}×</b></div>
    <div class="dice-face ${landed ? (won ? 'win' : 'lose') : ''}">${face}</div>
    <div class="dice-bar"><div class="dice-win" style="left:${lo}%;width:${hi - lo}%"></div>${landed ? `<div class="dice-mark" style="left:${v.roll - 0.5}%"></div>` : ''}</div>
    <div class="dice-scale"><span>1</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    ${landed ? `<div class="stage-big ${won ? 'crash-good' : 'crash-bad'}">${won ? `WIN — ${b.mult}×` : 'MISS'}</div>` : ''}`;
}

// ── Slots ────────────────────────────────────────────────────────
function slotsBody(g, now) {
  const v = g.view, sy = v.symbols || [];
  const reel = (i) => {
    if (!v.reels) return `<div class="slot-reel idle">❔</div>`;
    const stopped = now >= v.spinAt + SLOTS_REEL_MS[i];
    // while spinning, cycle the strip off the clock (cosmetic — the stop is already decided)
    const icon = stopped ? sy[v.reels[i]].icon : sy[(Math.floor(now / 70) + i * 2) % sy.length].icon;
    return `<div class="slot-reel ${stopped ? 'stopped' : 'spinning'}">${icon}</div>`;
  };
  const done = v.reels && now >= v.revealAt;
  const status = !v.reels ? `<div class="stage-sub">Pull the lever…</div>`
    : !done ? `<div class="stage-sub">…</div>`
    : `<div class="stage-big ${resultClass(g.pending ? g.pending.mult : 0)}">${g.pending && g.pending.mult ? esc(g.pending.label) : 'No line'}</div>`;
  return `<div class="slot-machine ${done && v.win !== 'none' ? 'win' : ''}">${reel(0)}${reel(1)}${reel(2)}</div>${status}`;
}

// ── Keno ─────────────────────────────────────────────────────────
function kenoBody(g, now, rules) {
  const v = g.view, n = v.numbers || 40;
  const balls = v.draw ? Math.min(v.draw.length, Math.max(0, Math.floor((now - v.drawAt) / KENO_BALL_MS))) : 0;
  const out = new Set(v.draw ? v.draw.slice(0, balls) : []);
  let grid = `<div class="keno-grid" style="grid-template-columns:repeat(${n > 40 ? 10 : 8},1fr)">`;
  for (let i = 1; i <= n; i++) {
    const picked = v.picks.includes(i), hit = out.has(i);
    grid += `<div class="keno-cell ${picked ? 'picked' : ''} ${hit ? (picked ? 'hit' : 'drawn') : ''}">${i}</div>`;
  }
  grid += '</div>';
  const k = v.picks.length, hitsSoFar = v.picks.filter(x => out.has(x)).length;
  const done = v.draw && now >= v.revealAt;
  const pays = k ? Object.entries(rules.pays[k] || {}).map(([h, m]) => `<span class="keno-pay ${v.draw && Number(h) === hitsSoFar ? 'on' : ''}">${h} → ${m}×</span>`).join('') : '';
  const status = !v.draw ? `<div class="stage-sub">${k ? `${k} number${k === 1 ? '' : 's'} picked — call more, or DRAW` : `Call up to ${v.maxPicks} numbers`}</div>`
    : !done ? `<div class="stage-sub">Ball ${balls} of ${v.draw.length} · ${hitsSoFar} hit${hitsSoFar === 1 ? '' : 's'}</div>`
    : `<div class="stage-big ${resultClass(g.pending ? g.pending.mult : 0)}">${esc(g.pending ? g.pending.label : '')}</div>`;
  return `${grid}<div class="keno-pays">${pays}</div>${status}`;
}

// ── Plinko ───────────────────────────────────────────────────────
function plinkoBody(g, now) {
  const mults = g.view.mults || [], n = mults.length - 1;
  const S = 30, RH = 24, W = (n + 2) * S, top = 26, H = top + n * RH + 34, cx = W / 2;
  let pegs = '';
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++)
    pegs += `<circle cx="${cx + (j - i / 2) * S}" cy="${top + i * RH}" r="2.6" class="plk-peg"/>`;
  const drop = g.view.drop;
  const landed = drop && now >= drop.ts + n * PLINKO_STEP_MS;
  const slotY = top + (n - 1) * RH + 14;
  const tier = (m) => m >= 10 ? 'hot' : m >= 2 ? 'warm' : m >= 1 ? 'even' : 'cold';
  let slots = '';
  mults.forEach((m, k) => {
    const x = cx + (k - n / 2) * S;
    slots += `<g class="plk-slot ${tier(m)}${landed && drop.slot === k ? ' hit' : ''}"><rect x="${x - S / 2 + 1.5}" y="${slotY}" width="${S - 3}" height="18" rx="4"/><text x="${x}" y="${slotY + 13}" text-anchor="middle">${m}</text></g>`;
  });
  let ball = '';
  if (drop) {
    const f = Math.min(n, Math.max(0, (now - drop.ts) / PLINKO_STEP_MS));
    const i = Math.min(n - 1, Math.floor(f)), frac = f >= n ? 1 : f - i;
    const rights = drop.path.slice(0, i).reduce((a, b) => a + b, 0);
    const x0 = cx + (rights - i / 2) * S, x1 = x0 + (drop.path[i] ? S / 2 : -S / 2);
    const x = x0 + (x1 - x0) * frac;
    const y = top - 7 + (i + frac) * RH - Math.sin(Math.PI * frac) * 5;
    ball = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" class="plk-ball"/>`;
  }
  const status = !drop ? `<div class="stage-sub">Ready to drop…</div>`
    : !landed ? `<div class="stage-sub">…</div>`
    : `<div class="stage-big ${resultClass(mults[drop.slot])}">${mults[drop.slot]}×</div>`;
  return `<svg class="plinko-svg" viewBox="0 0 ${W} ${H}">${pegs}${slots}${ball}</svg>${status}`;
}

function crashBody(g, now) {
  if (!g.startedTs) return `<div class="stage-sub">Ready for launch…</div><div class="stage-big">1.00×</div>`;
  const crashed = g.phase === 'done' ? g.view.crashed : crashHasCrashed(g, now);
  const m = g.phase === 'done' ? g.view.finalMult : (crashed ? g.secret.crashAt : crashMult(g, now));
  const pts = [];
  const t = Math.min((now - g.startedTs) / 1000, 60);
  for (let i = 0; i <= 60; i++) {
    const tt = t * i / 60;
    const mm = Math.min(m, Math.exp((g.view.growthPerSec || 0.1) * tt));
    pts.push(`${(i / 60 * 300).toFixed(1)},${(120 - Math.min(118, (mm - 1) / Math.max(1, m - 1) * 110)).toFixed(1)}`);
  }
  const status = g.phase === 'done'
    ? (g.view.crashed ? `<div class="stage-big crash-bad">💥 CRASHED @ ${m}×</div>` : `<div class="stage-big crash-good">💰 CASHED OUT @ ${m}×</div>`)
    : (crashed ? `<div class="stage-big crash-bad">💥 CRASHED @ ${m}×</div>` : `<div class="stage-big crash-live">${m.toFixed(2)}×</div>`);
  return `<svg class="crash-svg" viewBox="0 0 300 120" preserveAspectRatio="none">
      <polyline points="${pts.join(' ')}" fill="none" stroke="${crashed ? '#e05252' : '#7ddb8a'}" stroke-width="3"/>
    </svg>${status}`;
}

function minesBody(g) {
  const n = g.view.grid || 25, cols = Math.round(Math.sqrt(n));
  const cells = [];
  for (let i = 0; i < n; i++) {
    const revealed = g.view.revealed.includes(i);
    const isMine = g.view.revealAll && g.secret.mines.includes(i);
    const hit = g.view.hit === i;
    const cls = hit ? 'mine hit' : isMine ? 'mine' : revealed ? 'safe' : 'hidden';
    // Hidden cells carry their number so the table can call "12!" and the GM clicks 12
    cells.push(`<div class="mine-cell ${cls}">${hit ? '💥' : isMine ? '💣' : revealed ? '💎' : `<span class="mine-num">${i + 1}</span>`}</div>`);
  }
  const status = g.phase === 'done'
    ? `<div class="stage-big ${g.result.mult > 0 ? 'crash-good' : 'crash-bad'}">${esc(g.result.label)}</div>`
    : `<div class="stage-big crash-live">${g.view.mult.toFixed(2)}×</div>
       <div class="stage-sub mines-hint">💎 ${g.view.revealed.length} safe found · 💣 ${g.view.minesCount} mines hidden · call a number to dig, or say STOP</div>`;
  return `<div class="mine-grid" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>${status}`;
}

function rouletteBody(g) {
  const bet = g.view.bet;
  const betText = bet ? `${bet.type}${bet.type === 'straight' ? ' ' + bet.number : ''}` : 'placing bet…';
  const pocket = g.view.pocket;
  return `<div class="stage-sub">Bet: <b>${esc(betText)}</b></div>` +
    (pocket != null ? `<div class="stage-big roulette-${rouletteColor(pocket)}">${pocket}</div>` : '');
}

// ── Session recap (End Session) — standings, awards, per-game results ──
export function renderRecap(el, config, state) {
  const st = sessionStats(config, state);
  const medal = (rank) => ['🥇', '🥈', '🥉'][rank - 1] || rank;
  const signed = (n) => `<span class="${n > 0 ? 'crash-good' : n < 0 ? 'crash-bad' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</span>`;
  const rows = st.standings.map(s => { const p = st.players[s.id]; return `<tr>
      <td>${medal(s.rank)}</td><td>${esc(s.name)}</td><td><b>${fmt(s.value)}g</b></td><td>${signed(s.net)}</td>
      <td>${p.games ? `${p.wins}–${p.losses}${p.pushes ? '–' + p.pushes : ''} in games` : 'no games'}</td>
      <td>${p.jailed ? p.jailed + '× jailed' : ''}</td><td>${p.battlesWon ? p.battlesWon + ' battles won' : ''}</td><td>${s.debt ? `<span class="crash-bad">still owes ${fmt(s.debt)}g</span>` : ''}</td></tr>`; }).join('');
  const awardCards = st.awards.map(a => `<div class="award"><div class="award-emoji">${a.emoji}</div>
      <div><div class="award-title">${esc(a.title)}</div><div class="award-name">${esc(a.name)}</div><div class="award-detail">${esc(a.detail)}</div></div></div>`).join('');
  const gameRows = st.games.map(g => { const def = gameDef(config, g.id) || { name: g.id, icon: '🎲' };
    return `<tr><td>${def.icon || '🎲'} ${esc(def.name)}</td><td>${g.plays} played</td><td>${g.wins} won</td><td>players ${signed(g.net)}g</td><td>best ${g.biggestMult}×</td></tr>`; }).join('');
  el.innerHTML = `
    <div class="recap-sub">${esc(recapSubtitle(state, st))}</div>
    <table class="recap">${rows}</table>
    <div class="recap-awards">${awardCards}</div>
    ${goldChartSvg(state)}
    ${state.ledgerDropped ? `<div class="subtle" style="text-align:center;margin-top:6px">A very long night: awards and charts cover the most recent ${state.ledger.length.toLocaleString('en-US')} events (${Number(state.ledgerDropped).toLocaleString('en-US')} earlier ones have scrolled off). Standings are exact.</div>` : ''}
    ${gameRows ? `<div class="shop-h" style="margin-top:16px">Games</div><table class="recap small">${gameRows}</table>` : ''}
    <div class="recap-stats">
      <div>🎡 Wheel spins: <b>${st.totals.wheelSpins}</b></div>
      <div>🎰 Games played: <b>${st.totals.games}</b></div>
      <div>⚔️ Battles: <b>${st.totals.battles}</b></div>
      <div>🔒 Jailings: <b>${st.totals.jailings}</b></div>
      <div>🌀 Void triggers: <b>${st.totals.voids}</b></div>
      <div>☠️ Chaos events: <b>${st.totals.chaos}</b></div>
    </div>
    ${lifetimeRecap(state)}
    ${stakesRecap(state)}`;
}

// All-time table (snapshot the GM window puts in state when the session is archived)
function lifetimeRecap(state) {
  const rows = state.lifetime || [];
  if (!rows.length) return '';
  return `<div class="shop-h" style="margin-top:16px">🏆 All-time</div><table class="recap small">${rows.map(r =>
    `<tr><td>${esc(r.name)}</td><td>${r.sessions} session${r.sessions === 1 ? '' : 's'}</td><td>👑 ${r.titles}</td><td>${r.totalNet > 0 ? '+' : ''}${fmt(r.totalNet)}g lifetime</td></tr>`).join('')}</table>`;
}

// ── Shop mirror (state.shop while the GM has the shop modal open) ──
function renderShopStage(el, config, state) {
  const sh = state.shop;
  const p = state.players.find(x => x.id === sh.playerId);
  const held = (id) => p ? p.heldPowerUps.filter(h => h.id === id).length : 0;
  const bal = (n) => p ? (p.balances[n] || 0) : 0;
  const offers = sh.offers.map(o => `<tr>
      <td class="shop-em">${o.emoji || ''}</td><td><b>${esc(o.name)}</b></td>
      <td class="shop-rate">${fmt(o.sessionRate)} <span class="stage-sub">Gold each</span></td>
      <td class="stage-sub">you hold ${fmt(bal(o.name))}</td></tr>`).join('');
  const pus = (config.PowerUps || []).filter(pu => pu.active !== false).map(pu => `<tr>
      <td><b>${esc(pu.name)}</b><div class="stage-sub">${esc(pu.effect)}</div></td>
      <td class="shop-rate">${pu.price}g</td>
      <td class="stage-sub">${held(pu.id)}/${pu.maxHeld}</td></tr>`).join('');
  el.innerHTML = `
    <div class="stage-head">🛒 SHOP</div>
    <div class="stage-sub">${esc(p ? p.name : '?')} is shopping · <b>${fmt(bal('Gold'))} Gold</b> · rates ${sh.bounds.min}×–${sh.bounds.max}× GoldRate, fixed for this session</div>
    <div class="shop-stage">
      <div><div class="shop-h">Currency exchange</div><table class="shop-tbl">${offers}</table></div>
      <div><div class="shop-h">⚡ Power-ups</div><table class="shop-tbl">${pus}</table></div>
    </div>`;
  el.classList.add('show');
}

// IRL stakes on the recap: what's still owed in real life, and what was settled
function stakesRecap(state) {
  const stakes = normalizeStakes(state);
  if (!stakes.length) return '';
  const row = (s) => `<div class="stake-row ${s.settled ? 'settled' : ''}"><span class="stake-text">${s.settled ? '✔' : '🤝'} ${esc(stakeLine(state, s))}</span></div>`;
  return `<div class="recap-stakes"><div class="shop-h">IRL stakes — ${stakes.filter(s => !s.settled).length} still owed</div>${stakes.map(row).join('')}</div>`;
}

// ── Pet battle (state.petBattle) ─────────────────────────────────
function fighterHtml(f, b, config) {
  const pct = Math.max(0, Math.round(f.hp / f.hpMax * 100));
  const turn = b.phase === 'active' && b.turn === f.side, won = b.phase === 'done' && b.winner === f.side, out = f.hp <= 0;
  return `<div class="pb-fighter ${turn ? 'turn' : ''} ${won ? 'won' : ''} ${out ? 'out' : ''}">
      <div class="pb-owner">${esc(f.owner)}</div>
      <div class="pb-sprite">${spriteHtml(config, f, 160)}</div>
      <div class="pb-name">${esc(f.name)} <span class="stage-sub">L${f.level} · ${esc(f.element)}</span></div>
      <div class="pb-hp"><div class="pb-hp-fill ${pct < 30 ? 'low' : pct < 60 ? 'mid' : ''}" style="width:${pct}%"></div></div>
      <div class="pb-nums">${f.hp} / ${f.hpMax} HP · AC ${effectiveAc(f)}${f.guard ? ' 🛡️' : ''}${f.status ? ` <span class="pb-status">${PET_STATUS[f.status.id].icon} ${PET_STATUS[f.status.id].name}</span>` : ''}</div>
    </div>`;
}
function renderPetBattleStage(el, b, config) {
  const lines = b.log.slice(-4).map(l => `<div class="pb-line ${l.kind || ''}">${esc(l.text)}</div>`).join('');
  const head = b.kind === 'boss' ? '🐲 BOSS FIGHT' : b.kind === 'wild' ? '🌿 WILD ENCOUNTER' : `⚔️ PET BATTLE${b.wager ? ` — ${fmt(b.wager)} Gold each` : ''}`;
  const html = `<div class="stage-head">${head}</div>
    <div class="stage-sub">Round ${Math.min(b.round, 99)}${b.phase === 'active' ? ` · ${esc(b[b.turn].name)}'s move` : ''}</div>
    <div class="pb-arena">${fighterHtml(b.a, b, config)}<div class="pb-vs">VS</div>${fighterHtml(b.b, b, config)}</div>
    <div class="pb-log">${lines}</div>
    ${b.phase === 'done' ? `<div class="stage-big small crash-good">🏆 ${esc(b[b.winner].name)} wins!</div><div class="stage-sub">${esc((b.rewards || []).join(' · '))}</div>` : ''}`;
  if (el._gwfHtml !== html || el.innerHTML === '') { el.innerHTML = html; el._gwfHtml = html; }
  el.classList.add('show');
}

// ── Raid (state.raid): the boss up top, the party in a row below ──
function renderRaidStage(el, r, config) {
  const actorSide = r.phase === 'active' ? r.order[r.turnIdx] : null;
  const bar = (f) => { const pct = Math.max(0, Math.round(f.hp / f.hpMax * 100)); return `<div class="pb-hp"><div class="pb-hp-fill ${pct < 30 ? 'low' : pct < 60 ? 'mid' : ''}" style="width:${pct}%"></div></div>`; };
  const status = (f) => f.status ? ` <span class="pb-status">${PET_STATUS[f.status.id].icon} ${PET_STATUS[f.status.id].name}</span>` : '';
  const member = (f) => `<div class="pb-fighter raid-member ${actorSide === f.side ? 'turn' : ''} ${f.hp <= 0 ? 'out' : ''}">
      <div class="pb-owner">${esc(f.owner)}</div><div class="pb-sprite">${spriteHtml(config, f, 76)}</div><div class="pb-name">${esc(f.name)} <span class="stage-sub">L${f.level}</span></div>
      ${bar(f)}<div class="pb-nums">${f.hp}/${f.hpMax} · AC ${effectiveAc(f)}${status(f)}</div></div>`;
  const b = r.boss;
  const html = `<div class="stage-head">🐍 RAID</div><div class="stage-sub">Round ${r.round}${actorSide ? ` · ${esc(actorSide === 'boss' ? b.name : r.party.find(f => f.side === actorSide).name)}'s move` : ''}</div>
    <div class="pb-fighter raid-boss ${actorSide === 'boss' ? 'turn' : ''} ${b.hp <= 0 ? 'out' : ''}"><div class="pb-sprite">${spriteHtml(config, b, 120)}</div><div class="pb-name">${esc(b.name)} <span class="stage-sub">L${b.level} · ${esc(b.element)}</span></div>
      ${bar(b)}<div class="pb-nums">${b.hp} / ${b.hpMax} HP · AC ${effectiveAc(b)}${status(b)}</div></div>
    <div class="raid-party">${r.party.map(member).join('')}</div>
    <div class="pb-log">${r.log.slice(-3).map(l => `<div class="pb-line ${l.kind || ''}">${esc(l.text)}</div>`).join('')}</div>
    ${r.phase === 'done' ? `<div class="stage-big small ${r.winner === 'party' ? 'crash-good' : 'crash-bad'}">${r.winner === 'party' ? '🏆 RAID CLEARED' : '💀 RAID FAILED'}</div><div class="stage-sub">${esc((r.rewards || []).join(' · '))}</div>` : ''}`;
  if (el._gwfHtml !== html || el.innerHTML === '') { el.innerHTML = html; el._gwfHtml = html; }
  el.classList.add('show');
}

// ── Digital battle contest (state.contest) ──
function renderContestStage(el, c) {
  const last = c.rounds.at(-1); const ties = c.rounds.length - 1;
  const side = (name, show, won) => `<div class="pb-fighter ${won ? 'won' : ''}"><div class="pb-owner">${esc(name)}</div><div class="contest-show">${esc(show || '—')}</div></div>`;
  const html = `<div class="stage-head">⚔️ ${esc(c.title)}</div>
    ${ties ? `<div class="stage-sub">${ties} tie${ties > 1 ? 's' : ''} first — replayed</div>` : (last.note ? `<div class="stage-sub">${esc(last.note)}</div>` : '')}
    <div class="pb-arena">${side(c.aName, last.a, c.winnerId === c.aId)}<div class="pb-vs">VS</div>${side(c.bName, last.b, c.winnerId === c.bId)}</div>
    <div class="stage-big crash-good">🏆 ${esc(c.winnerName)}</div>`;
  if (el._gwfHtml !== html || el.innerHTML === '') { el.innerHTML = html; el._gwfHtml = html; }
  el.classList.add('show');
}

// ── Live auction (state.auction) ──
function renderAuctionStage(el, a) {
  const lot = currentLot(a);
  const html = lot ? `<div class="stage-head">🔨 AUCTION — ${esc(a.sellerName)}</div>
      <div class="stage-sub">Lot ${a.lotIdx + 1} of ${a.lots.length} · worth about ${fmt(lot.refValue)} Gold</div>
      <div class="stage-big">${esc(lotLabel(lot))}</div>
      <div class="auction-bid ${lot.calls ? 'going' : ''}">${lot.high ? `${fmt(lot.high.amount)} Gold — <b>${esc(lot.high.name)}</b>` : `Opening bid ${fmt(lot.opening)} Gold`}</div>
      <div class="stage-big small crash-bad">${lot.calls === 1 ? 'GOING ONCE…' : lot.calls >= 2 ? 'GOING TWICE…' : '&nbsp;'}</div>`
    : `<div class="stage-head">🔨 AUCTION OVER</div><div class="stage-big small">${esc(a.summary || '')}</div>
       <div class="pb-log">${a.log.slice(-5).map(l => `<div class="pb-line">${esc(l)}</div>`).join('')}</div>`;
  if (el._gwfHtml !== html || el.innerHTML === '') { el.innerHTML = html; el._gwfHtml = html; }
  el.classList.add('show');
}

// One quiet line under the banner (which already says FINAL STANDINGS): how long the night was.
export function recapSubtitle(state, st) {
  const ts = (state.ledger || []).map(r => r.ts).filter(Number.isFinite);
  const mins = ts.length > 1 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 60000) : 0;
  const dur = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : mins >= 1 ? `${mins} min` : '';
  const n = (state.players || []).length;
  return [`${st.round} round${st.round === 1 ? '' : 's'}`, `${n} player${n === 1 ? '' : 's'}`, dur].filter(Boolean).join(' · ');
}
