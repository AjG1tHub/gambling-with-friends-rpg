// GM-side controls for Phase 4/5: minigames, wheel power-ups, shop power-ups,
// Live Odds panel, Chaos, Start Wheel. gm.js hands us a ctx of live accessors.
import * as G from './games.js';
import * as E from './engine.js';
import * as S from './state.js';
import { esc } from './wheel-ui.js';

let ctx = null;          // { S(), C(), rng, msg, sync, byId, cur, openModal, closeModal, followups, $ }
let crashTimer = null;
let revealTimer = null;   // re-enables Settle once cards / the Plinko ball have landed

// The game lab reuses the per-game controls without the rest of the GM page: it only needs
// #gameControls on the page and { S, C, rng, msg, sync, byId, $ } in the ctx.
export function attach(c) { ctx = c; }
export function init(c) {
  ctx = c;
  const $ = ctx.$;
  $('btnGameStart').onclick = startFromPanel;
  $('btnGameCancel').onclick = () => { const st = ctx.S(); st.game = null; hidePanel(); ctx.sync(); };
  $('btnAddWager').onclick = () => { wagers.push({ amount: 100, cur: 'Gold' }); renderWagers(); };
  $('gameSel').onchange = () => { $('gameSelName').textContent = ''; };
  // chaos
  for (let t = 1; t <= 5; t++) $('chaos' + t).onclick = () => doChaos(t, true);
  $('chaosSilent').onclick = () => doChaos(Number($('chaosTierSel').value), false);
  $('chaosUndo').onclick = undoChaos;
  $('btnRetcon').onclick = openRetcon;
  $('btnOddsReset').onclick = () => { ctx.S().oddsOverrides = {}; ctx.msg('Odds reset to config.', 'wheelMsgs'); ctx.sync(); };
}

// ── Minigame panel ───────────────────────────────────────────────
let wagers = [];
let panelPlayerId = null;

export function openPanel(player, tileGameId) {
  const $ = ctx.$, C = ctx.C();
  panelPlayerId = player.id;
  wagers = [{ amount: C.Config.MinBet, cur: 'Gold' }];
  const games = C.Games.filter(g => g.built);
  $('gameSel').innerHTML = games.map(g => `<option value="${g.id}" ${g.id === tileGameId ? 'selected' : ''}>${g.icon || ''} ${esc(g.name)}</option>`).join('');
  if (!games.some(g => g.id === tileGameId)) $('gameSel').value = games[0]?.id;
  $('gamePlayerName').textContent = player.name;
  // Any player can be put on any game at any time (GM fiat) — pick here
  const ps = $('gamePlayerSel');
  if (ps) {
    ps.innerHTML = ctx.S().players.map(pl => `<option value="${pl.id}" ${pl.id === player.id ? 'selected' : ''}>${esc(pl.name)}</option>`).join('');
    ps.onchange = () => { panelPlayerId = ps.value; const pl = ctx.byId(panelPlayerId); if (pl) $('gamePlayerName').textContent = pl.name; };
  }
  $('gamePanel').style.display = '';
  $('gameControls').innerHTML = '';
  $('wagerBlock').style.display = '';
  renderWagers();
  $('quickBets').innerHTML = C.Config.QuickBets.map(q => `<button data-q="${q}">${q === 'ALL_IN' ? 'ALL-IN' : q}</button>`).join('');
  $('quickBets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const p = ctx.byId(panelPlayerId);
    wagers[0].amount = b.dataset.q === 'ALL_IN' ? Math.max(S.bal(p, wagers[0].cur), C.Config.MinBet) : Number(b.dataset.q);
    renderWagers();
  }));
}
export function hidePanel() { const gp = ctx.$('gamePanel'); if (gp) gp.style.display = 'none'; clearTimeout(revealTimer); if (crashTimer) { clearInterval(crashTimer); crashTimer = null; } }

function renderWagers() {
  const $ = ctx.$, C = ctx.C();
  $('wagerLines').innerHTML = wagers.map((w, i) => `
    <div class="row">
      <input type="number" value="${w.amount}" data-wi="${i}" data-f="amount" style="width:110px">
      <select data-wi="${i}" data-f="cur">${C.Currencies.filter(c => c.active).map(c =>
        `<option ${c.name === w.cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${i > 0 ? `<button data-rmw="${i}">✕</button>` : `<span class="subtle">min ${C.Config.MinBet}</span>`}
    </div>`).join('');
  $('wagerLines').querySelectorAll('input,select').forEach(el => el.addEventListener('change', () => {
    const w = wagers[Number(el.dataset.wi)]; w[el.dataset.f] = el.dataset.f === 'amount' ? Number(el.value) : el.value;
  }));
  $('wagerLines').querySelectorAll('[data-rmw]').forEach(b => b.addEventListener('click', () => { wagers.splice(Number(b.dataset.rmw), 1); renderWagers(); }));
}

function startFromPanel() {
  const $ = ctx.$, st = ctx.S(), C = ctx.C();
  const p = ctx.byId(panelPlayerId); if (!p) return;
  const gameId = $('gameSel').value;
  const ws = wagers.filter(w => w.amount > 0);
  if (!ws.length) { (ctx.toast || ctx.msg)('⚠️ Enter a wager first.'); return; }
  G.startGame(C, st, ctx.rng, gameId, p, ws.map(w => ({ ...w })));
  $('wagerBlock').style.display = 'none';
  renderControls();
  ctx.sync();
}

// Re-render the per-game controls from state.game (also called after adopt)
export function renderControls() {
  const $ = ctx.$, st = ctx.S(), C = ctx.C();
  const g = st.game; const box = $('gameControls');
  if (!g) { box.innerHTML = ''; return; }
  const p = ctx.byId(g.playerId);
  const def = G.gameDef(C, g.id) || { name: g.id };
  const mods = {
    reroll: p.heldPowerUps.filter(x => x.id === 'reroll').length,
    fork: G.hasPowerUp(p, 'fork'), nudge: G.hasPowerUp(p, 'nudge'),
  };
  let html = `<div class="row"><b>${esc(def.name)}</b> <span class="subtle">${esc(p.name)} · ${g.wagers.map(w => w.amount + ' ' + w.cur).join(' + ')}</span></div>`;
  let xc = null;
  const nudgeHtml = (labels) => mods.nudge && !g.pending ? `<div class="row"><span class="subtle">Nudge (+50%):</span><select id="nudgeSel"><option value="">— none —</option>${labels.map(l => `<option>${esc(l)}</option>`).join('')}</select></div>` : '';
  const pendingHtml = () => {
    if (!g.pending) return '';
    if (g.forkOptions) return `<div class="msg">FORK — pick one:</div><div class="row">${g.forkOptions.map((o, i) => `<button class="primary" data-pick="${i}">${esc(o.label)} (${o.mult}×)</button>`).join('')}</div>`;
    return `<div class="msg">Result: <b>${esc(g.pending.label)}</b> → ${g.pending.mult}× stake</div>
      <div class="row"><button class="primary" id="gAccept">✅ Accept & settle</button>
      ${mods.reroll ? `<button id="gReroll">🔁 Reroll (${mods.reroll})</button>` : ''}
      ${mods.fork ? `<button id="gFork">🔱 Fork</button>` : ''}</div>`;
  };
  // Card / Plinko results play out on the shared screen first — hold Settle until they've landed
  const revealing = () => {
    const ms = (g.view.revealAt || 0) - Date.now();
    if (ms <= 0) return false;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { if (ctx.S().game && ctx.S().game.id === g.id) renderControls(); }, ms + 40);
    return true;
  };
  const resultHtml = () => revealing()
    ? `<div class="msg">Playing out on the big screen… <span class="subtle">${esc(g.result.label)}</span></div>`
    : `<div class="msg">${esc(g.result.label)}</div><div class="row"><button class="primary" id="gSettle">Settle</button></div>`;
  switch (g.id) {
    case 'fifty': html += nudgeHtml(['WIN', 'LOSE']) + (g.pending ? pendingHtml() : `<div class="row"><button class="primary" id="gSpin">🎡 Spin</button></div>`); break;
    case 'bigwheel': {
      const odds = G.effectiveOdds(C, st, 'bigwheel');
      html += nudgeHtml((odds.segments || []).map(s => s.label)) + (g.pending ? pendingHtml() : `<div class="row"><button class="primary" id="gSpin">🎡 Spin the Big Wheel</button></div>`); break;
    }
    case 'roulette': {
      const types = ['red','black','odd','even','low','high','dozen1','dozen2','dozen3','col1','col2','col3','straight'];
      if (!g.view.bet) html += `<div class="row"><select id="rBet">${types.map(t => `<option>${t}</option>`).join('')}</select><input id="rNum" type="number" min="0" max="36" value="17" style="width:70px"><button class="primary" id="rPlace">Place bet</button></div>`;
      else html += `<div class="row"><span>Bet: <b>${esc(g.view.bet.type)}${g.view.bet.type === 'straight' ? ' ' + g.view.bet.number : ''}</b></span></div>` + nudgeHtml(Array.from({ length: 37 }, (_, i) => String(i))) + (g.pending ? pendingHtml() : `<div class="row"><button class="primary" id="gSpin">🎡 Spin</button></div>`);
      break;
    }
    case 'crash': {
      if (!g.startedTs) html += `<div class="row"><button class="primary" id="cLaunch">🚀 LAUNCH</button></div>`;
      else if (g.phase === 'running') html += `<div class="row"><div class="big-turn" id="cMult">1.00×</div><button class="danger" id="cCash" style="font-size:20px;padding:14px 28px">💰 CASH OUT</button></div>`;
      else html += `<div class="msg">${esc(g.result.label)}</div><div class="row"><button class="primary" id="gSettle">Settle</button></div>`;
      break;
    }
    case 'mines': {
      const n = g.view.grid, cols = Math.round(Math.sqrt(n));
      let grid = `<div class="mine-grid gm" style="grid-template-columns:repeat(${cols},1fr)">`;
      for (let i = 0; i < n; i++) {
        const rev = g.view.revealed.includes(i), mine = g.view.revealAll && g.secret.mines.includes(i);
        grid += `<button class="mine-cell ${g.view.hit === i ? 'mine hit' : mine ? 'mine' : rev ? 'safe' : 'hidden'}" data-mine="${i}" ${g.phase === 'done' || rev ? 'disabled' : ''}>${g.view.hit === i ? '💥' : mine ? '💣' : rev ? '💎' : i + 1}</button>`;
      }
      grid += '</div>';
      html += grid + (g.phase === 'done'
        ? `<div class="msg">${esc(g.result.label)}</div><div class="row"><button class="primary" id="gSettle">Settle</button></div>`
        : `<div class="row"><span class="big-turn">${g.view.mult.toFixed(2)}×</span><button class="danger" id="mStop">🛑 STOP & take it</button></div>`);
      break;
    }
    case 'blackjack': {
      const v = g.view, done = g.phase === 'done', odds = G.effectiveOdds(C, st, 'blackjack');
      const txt = (cards, hide) => cards.map((c, i) => hide && i === 1 ? '🂠' : G.cardText(c)).join(' ');
      const dt = G.bjTotal(done ? v.dealer : v.dealer.slice(0, 1));
      html += `<div class="row gm-cards"><span class="subtle">Dealer</span> <b>${esc(txt(v.dealer, !done))}</b> <span class="subtle">(${dt.total})</span></div>`;
      v.hands.forEach((h, i) => { const pt = G.bjTotal(h.cards);
        html += `<div class="row gm-cards ${i === v.active ? 'active-hand' : ''}"><span class="subtle">${v.hands.length > 1 ? 'Hand ' + (i + 1) : 'Player'}</span> <b>${esc(txt(h.cards))}</b> <span class="subtle">(${pt.soft && pt.total < 21 ? 'soft ' : ''}${pt.total})${h.doubled ? ' · doubled' : ''}${i === v.active ? ' ◀' : ''}</span></div>`; });
      if (v.insurance === 'taken') html += `<div class="row"><span class="subtle">Insurance taken (½ stake)</span></div>`;
      if (done) html += resultHtml();
      else if (g.phase === 'insurance') html += `<div class="msg">Dealer shows an Ace — insurance? <span class="subtle">Costs half the stake, pays 2:1 if the dealer has blackjack.</span></div>
        <div class="row"><button class="primary" id="bjInsure">🛡 Take insurance</button><button id="bjDecline">No thanks</button></div>`;
      else html += `<div class="row"><button class="primary" id="bjHit">➕ HIT</button><button class="danger" id="bjStand">✋ STAND</button>
        ${G.bjCanDouble(v) ? `<button id="bjDouble">✖2 DOUBLE</button>` : ''}${G.bjCanSplit(odds, v) ? `<button id="bjSplit">✂ SPLIT</button>` : ''}</div>`;
      break;
    }
    case 'baccarat': {
      const v = g.view, odds = G.effectiveOdds(C, st, 'baccarat');
      if (g.phase === 'bet') {
        html += `<div class="row"><label>Bet on</label><select id="bacSide">
            <option value="player">PLAYER — pays ${odds.player}:1</option>
            <option value="banker">BANKER — pays ${odds.banker}:1</option>
            <option value="tie">TIE — pays ${odds.tie}:1</option></select>
          <button class="primary" id="bacDeal">🎴 Deal</button></div>`;
      } else {
        const txt = (cards) => cards.map(G.cardText).join(' ');
        html += `<div class="row gm-cards"><span class="subtle">Bet</span> <b>${esc(String(v.bet).toUpperCase())}</b></div>
          <div class="row gm-cards"><span class="subtle">Player</span> <b>${esc(txt(v.player))}</b> <span class="subtle">(${G.bacTotal(v.player)})</span></div>
          <div class="row gm-cards"><span class="subtle">Banker</span> <b>${esc(txt(v.banker))}</b> <span class="subtle">(${G.bacTotal(v.banker)})</span></div>` + resultHtml();
      }
      break;
    }
    case 'plinko': {
      const mults = G.plinkoMults(G.effectiveOdds(C, st, 'plinko'));
      html += nudgeHtml([...new Set(mults.map(m => `${m}×`))]);
      if (!g.pending) html += `<div class="row"><button class="primary" id="gSpin">🔻 Drop the ball</button></div>`;
      else if (revealing()) html += `<div class="msg">Ball is dropping…</div>`;
      else html += pendingHtml();
      break;
    }
    case 'hilo': {
      const v = g.view, odds = G.effectiveOdds(C, st, 'hilo'), top = v.cards.at(-1);
      html += `<div class="row gm-cards"><span class="subtle">Cards</span> <b>${esc(v.cards.map(G.cardText).join(' → '))}</b></div>`;
      if (g.phase === 'done') html += resultHtml();
      else {
        const hi = G.hiloStepMult(odds, top.r, 'higher'), lo = G.hiloStepMult(odds, top.r, 'lower');
        html += `<div class="row"><span class="big-turn">${v.mult.toFixed(2)}×</span>
          <button class="primary" id="hlHigher" ${hi ? '' : 'disabled'}>⬆ HIGHER${hi ? ` (×${hi.toFixed(2)})` : ''}</button>
          <button class="primary" id="hlLower" ${lo ? '' : 'disabled'}>⬇ LOWER${lo ? ` (×${lo.toFixed(2)})` : ''}</button>
          <button class="danger" id="hlCash">💰 CASH OUT</button></div>`;
      }
      break;
    }
    case 'dice': {
      const v = g.view, odds = G.effectiveOdds(C, st, 'dice');
      if (!v.bet) {
        html += `<div class="row"><label>Roll</label><select id="dcDir"><option value="under">UNDER</option><option value="over">OVER</option></select>
          <input id="dcTarget" type="number" min="1" max="100" value="50" style="width:70px"><span class="subtle" id="dcPreview"></span>
          <button class="primary" id="dcBet">Place bet</button></div><div id="dcErr"></div>`;
      } else {
        html += `<div class="row"><span>Bet: <b>${v.bet.dir.toUpperCase()} ${v.bet.target}</b> <span class="subtle">${v.bet.chance}% to win · pays ${v.bet.mult}×</span></span></div>`;
        if (!g.pending) html += `<div class="row"><button class="primary" id="gSpin">🎲 Roll</button></div>`;
        else if (revealing()) html += `<div class="msg">Rolling…</div>`;
        else html += pendingHtml();
      }
      break;
    }
    case 'slots': {
      if (!g.pending) html += `<div class="row"><button class="primary" id="gSpin">🎰 Pull the lever</button></div>`;
      else if (revealing()) html += `<div class="msg">Reels spinning…</div>`;
      else html += pendingHtml();
      break;
    }
    case 'keno': {
      const v = g.view, R = G.kenoRules(G.effectiveOdds(C, st, 'keno'));
      if (!g.pending) {
        let grid = `<div class="keno-grid gm">`;
        for (let n = 1; n <= v.numbers; n++) grid += `<button class="keno-cell ${v.picks.includes(n) ? 'picked' : ''}" data-keno="${n}">${n}</button>`;
        const k = v.picks.length; const table = k ? Object.entries(R.pays[k] || {}).map(([h, m]) => `${h} hit${h === '1' ? '' : 's'} = ${m}×`).join(' · ') : 'tap the numbers the player calls';
        html += grid + `</div><div class="row"><span class="subtle">${k}/${v.maxPicks} picked — ${esc(table)}</span></div>
          <div class="row"><button id="knQuick">🎲 Quick pick 5</button><button id="knClear">Clear</button><button class="primary" id="gSpin" ${k ? '' : 'disabled'}>🔢 Draw ${v.drawn}</button></div>`;
      } else if (revealing()) html += `<div class="msg">Drawing ${v.drawn} balls…</div>`;
      else html += `<div class="row gm-cards"><span class="subtle">Drawn</span> <b>${v.draw.slice().sort((a, b) => a - b).join(' ')}</b></div>` + pendingHtml();
      break;
    }
    case 'placeholder':
      html += g.pending ? pendingHtml() : `<div class="row"><button class="primary" id="gWon">✅ WON</button><button class="danger" id="gLost">❌ LOST</button></div>`; break;
    default: {
      // Plug-in games describe their controls as data: { info, inputs, buttons }.
      const X = G.extraDef(g.id); if (!X) break;
      if (g.phase === 'done') { html += resultHtml(); break; }
      xc = X.controls(g, G.extraCtx(C, st, ctx.rng, g)) || {};
      if (xc.info) html += `<div class="row xinfo">${xc.info}</div>`;
      if (xc.inputs) html += `<div class="row">${xc.inputs.map(i => `<input id="${i.id}" type="${i.type || 'number'}" value="${esc(i.value)}" ${i.min != null ? `min="${esc(i.min)}"` : ''} ${i.max != null ? `max="${esc(i.max)}"` : ''} ${i.step != null ? `step="${esc(i.step)}"` : ''} style="width:110px">`).join('')}</div>`;
      let row = '';
      (xc.buttons || []).forEach((bt, i) => { if (bt.br && row) { html += `<div class="row xbtns">${row}</div>`; row = ''; } row += `<button class="${bt.primary ? 'primary' : bt.danger ? 'danger' : ''}" data-xi="${i}" ${bt.disabled ? 'disabled' : ''}>${esc(bt.label)}</button>`; });
      if (row) html += `<div class="row xbtns">${row}</div>`;
    }
  }
  box.innerHTML = html;
  // wiring
  const act = (a, payload) => { const r = G.gameAction(C, ctx.S(), ctx.rng, a, payload); if (r.text) ctx.msg(esc(r.text)); renderControls(); ctx.sync(); return r; };
  const nudge = () => { const sel = $('nudgeSel'); if (sel && sel.value) { G.takePowerUp(st, p, 'nudge'); return sel.value; } return undefined; };
  $('gSpin') && ($('gSpin').onclick = () => act('spin', { nudgeLabel: nudge() }));
  $('rPlace') && ($('rPlace').onclick = () => act('bet', { type: $('rBet').value, number: Number($('rNum').value) }));
  $('gWon') && ($('gWon').onclick = () => act('won'));
  $('gLost') && ($('gLost').onclick = () => act('lost'));
  $('gAccept') && ($('gAccept').onclick = () => settleNow(g.pending.mult, g.pending.label));
  $('gReroll') && ($('gReroll').onclick = () => { G.takePowerUp(st, p, 'reroll'); g.pending = null; act('spin'); });
  $('gFork') && ($('gFork').onclick = () => {
    G.takePowerUp(st, p, 'fork');
    const first = g.pending; g.pending = null;
    const r = G.gameAction(C, st, ctx.rng, 'spin', {});
    g.forkOptions = [first, g.pending]; g.pending = first;
    ctx.msg('🔱 Fork: two results — pick one.'); renderControls(); ctx.sync();
  });
  box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const o = g.forkOptions[Number(b.dataset.pick)]; g.forkOptions = null; settleNow(o.mult, o.label); });
  $('cLaunch') && ($('cLaunch').onclick = () => { act('launch'); startCrashTimer(); });
  $('cCash') && ($('cCash').onclick = () => { const r = act('cashout'); if (crashTimer) { clearInterval(crashTimer); crashTimer = null; } });
  box.querySelectorAll('[data-mine]').forEach(b => b.onclick = () => act('reveal', { idx: Number(b.dataset.mine) }));
  $('mStop') && ($('mStop').onclick = () => act('stop'));
  box.querySelectorAll('[data-keno]').forEach(b => b.onclick = () => act('pick', { n: Number(b.dataset.keno) }));
  $('knQuick') && ($('knQuick').onclick = () => act('quick', { count: 5 }));
  $('knClear') && ($('knClear').onclick = () => act('clear'));
  $('hlHigher') && ($('hlHigher').onclick = () => act('higher'));
  $('hlLower') && ($('hlLower').onclick = () => act('lower'));
  $('hlCash') && ($('hlCash').onclick = () => act('cashout'));
  if ($('dcBet')) {
    const odds = G.effectiveOdds(C, st, 'dice');
    const preview = () => { const dir = $('dcDir').value, t = Number($('dcTarget').value); const err = G.diceBetError(odds, dir, t); $('dcPreview').textContent = err ? '' : `${G.diceChance(dir, t)}% to win · pays ${G.diceMult(odds, dir, t)}×`; $('dcErr').innerHTML = err ? `<div class="msg" style="border-color:var(--bad)">${esc(err)}</div>` : ''; return !err; };
    $('dcDir').onchange = preview; $('dcTarget').oninput = preview; preview();
    $('dcBet').onclick = () => { if (preview()) act('bet', { dir: $('dcDir').value, target: Number($('dcTarget').value) }); };
  }
  $('bjHit') && ($('bjHit').onclick = () => act('hit'));
  $('bjStand') && ($('bjStand').onclick = () => act('stand'));
  $('bjDouble') && ($('bjDouble').onclick = () => act('double'));
  $('bjSplit') && ($('bjSplit').onclick = () => act('split'));
  $('bjInsure') && ($('bjInsure').onclick = () => act('insure'));
  $('bjDecline') && ($('bjDecline').onclick = () => act('decline'));
  $('bacDeal') && ($('bacDeal').onclick = () => { G.gameAction(C, ctx.S(), ctx.rng, 'bet', { side: $('bacSide').value }); act('deal'); });
  $('gSettle') && ($('gSettle').onclick = () => settleNow(g.result.mult, g.result.label));
  box.querySelectorAll('[data-xi]').forEach(el => { el.onclick = () => {
    const bt = xc.buttons[Number(el.dataset.xi)], payload = { ...(bt.p || {}) };
    for (const [key, id] of Object.entries(bt.from || {})) { const inp = $(id); if (inp) payload[key] = inp.type === 'number' ? Number(inp.value) : inp.value; }
    const r = act(bt.a, payload); if (r && r.error && ctx.toast) ctx.toast('⚠️ ' + r.text);
  }; });
  if (g.id === 'crash' && g.phase === 'running' && !crashTimer) startCrashTimer();
}

function startCrashTimer() {
  if (crashTimer) clearInterval(crashTimer);
  crashTimer = setInterval(() => {
    const st = ctx.S(); const g = st.game;
    if (!g || g.id !== 'crash' || g.phase !== 'running') { clearInterval(crashTimer); crashTimer = null; return; }
    const now = Date.now();
    const el = ctx.$('cMult'); if (el) el.textContent = G.crashMult(g, now).toFixed(2) + '×';
    if (G.crashHasCrashed(g, now)) { clearInterval(crashTimer); crashTimer = null; const r = G.gameAction(ctx.C(), st, ctx.rng, 'cashout'); ctx.msg('💥 ' + esc(r.text)); renderControls(); ctx.sync(); }
  }, 100);
}

function settleNow(mult, label) {
  const st = ctx.S(), C = ctx.C();
  const p = ctx.byId(st.game.playerId);
  const gameId = st.game.id;
  const r = G.settle(C, st, p, mult, { gameId, label });
  ctx.msg(`${r.won ? '✅' : r.lost ? '❌' : '➖'} ${esc(r.text)}`);
  st.banner = ''; hidePanel(); ctx.sync();
}

// ── Wheel Mods on GOOD/BAD/VOID/START (Nudge / Reroll / Fork) ────
// Returns true if it handled the spin (player holds a mod), false → caller spins normally.
export function spinWithMods(rows, wheelTitle, wheelKey, player, onExecute) {
  const st = ctx.S(), C = ctx.C();
  const has = { reroll: G.hasPowerUp(player, 'reroll'), fork: G.hasPowerUp(player, 'fork'), nudge: G.hasPowerUp(player, 'nudge') };
  if (!has.reroll && !has.fork && !has.nudge) return false;
  let pendingIdx = null, forkIdx = null;
  const spin = (nudgeLabel) => {
    const i = G.pickWeighted(ctx.rng, rows, nudgeLabel);
    st.lastSpin = { wheel: wheelTitle, outcomes: rows.map(r => r.label), index: i, playerId: player.id, ts: Date.now(), effect: rows[i].desc };
    S.log(st, 'WHEEL_SPIN', player.id, { wheel: wheelKey, outcome: rows[i].label, preview: true });
    ctx.sync();
    return i;
  };
  const render = () => {
    const body = pendingIdx === null
      ? `${has.nudge ? `<div class="row"><span class="subtle">Nudge (+50%):</span><select id="wmNudge"><option value="">— none —</option>${rows.map(r => `<option>${esc(r.label)}</option>`).join('')}</select></div>` : ''}
         <div class="row"><button class="primary" id="wmSpin">🎡 Spin</button></div>`
      : forkIdx !== null
        ? `<div class="msg">FORK — choose:</div><div class="row"><button class="primary" id="wmPickA">${esc(rows[pendingIdx].label)}</button><button class="primary" id="wmPickB">${esc(rows[forkIdx].label)}</button></div>`
        : `<div class="msg">Landed: <b>${esc(rows[pendingIdx].label)}</b> — ${esc(rows[pendingIdx].desc || '')}</div>
           <div class="row"><button class="primary" id="wmAccept">✅ Accept</button>
           ${G.hasPowerUp(player, 'reroll') ? `<button id="wmReroll">🔁 Reroll</button>` : ''}
           ${G.hasPowerUp(player, 'fork') ? `<button id="wmFork">🔱 Fork</button>` : ''}</div>`;
    ctx.openModal(`<h2>${esc(wheelTitle)} — ${esc(player.name)} holds a Wheel Mod</h2>${body}<div class="row"><button id="mClose">Cancel</button></div>`);
    const $ = ctx.$;
    $('mClose').onclick = ctx.closeModal;
    $('wmSpin') && ($('wmSpin').onclick = () => { const sel = $('wmNudge'); let n; if (sel && sel.value) { G.takePowerUp(st, player, 'nudge'); n = sel.value; } pendingIdx = spin(n); render(); });
    $('wmAccept') && ($('wmAccept').onclick = () => finish(pendingIdx));
    $('wmReroll') && ($('wmReroll').onclick = () => { G.takePowerUp(st, player, 'reroll'); pendingIdx = spin(); render(); });
    $('wmFork') && ($('wmFork').onclick = () => { G.takePowerUp(st, player, 'fork'); forkIdx = spin(); render(); });
    $('wmPickA') && ($('wmPickA').onclick = () => finish(pendingIdx));
    $('wmPickB') && ($('wmPickB').onclick = () => finish(forkIdx));
  };
  const finish = (i) => {
    ctx.closeModal();
    const o = rows[i];
    st.lastSpin = { wheel: wheelTitle, outcomes: rows.map(r => r.label), index: i, playerId: player.id, ts: Date.now() };
    const res = E.executeVerb(C, st, ctx.rng, o, player);
    st.lastSpin.effect = res.text || o.desc;
    S.log(st, 'WHEEL_SPIN', player.id, { wheel: wheelKey, outcome: o.label, modded: true });
    onExecute(o, res);
    ctx.sync();
  };
  render();
  return true;
}

// ── Shop power-ups section ───────────────────────────────────────
export function powerUpShelfHtml(player) {
  const C = ctx.C();
  const rows = C.PowerUps.filter(pu => pu.active !== false).map(pu => {
    const held = player.heldPowerUps.filter(h => h.id === pu.id).length;
    return `<tr><td><b>${esc(pu.name)}</b><br><span class="subtle">${esc(pu.type)} · ${esc(pu.duration)}</span></td>
      <td>${esc(pu.effect)}</td><td><b>${pu.price}</b>g</td><td>${held}/${pu.maxHeld}</td>
      <td><button data-buy-pu="${pu.id}" ${held >= Number(pu.maxHeld) ? 'disabled' : ''}>Buy</button></td></tr>`;
  }).join('');
  return `<h3 style="margin-top:12px">⚡ Power-ups</h3><table class="shop"><tr><th>Item</th><th>Effect</th><th>Price</th><th>Held</th><th></th></tr>${rows}</table>`;
}
export function wirePowerUpShelf(player, refresh) {
  document.querySelectorAll('[data-buy-pu]').forEach(b => b.onclick = () => {
    const r = G.buyPowerUp(ctx.C(), ctx.S(), player, b.dataset.buyPu);
    ctx.$('sMsg').innerHTML = `<div class="msg" ${r.error ? 'style="border-color:var(--bad)"' : ''}>${esc(r.text)}</div>`;
    ctx.sync(); refresh();
  });
}

// ── Live Odds panel ──────────────────────────────────────────────
export function renderOdds() {
  const $ = ctx.$, st = ctx.S(), C = ctx.C();
  const box = $('oddsBody'); if (!box) return;
  const ov = st.oddsOverrides || {};
  let html = `<div class="row"><label>HouseEdgeMultiplier</label><input type="number" step="0.05" data-odds="HouseEdgeMultiplier" value="${G.houseEdgeMult(C, st)}" style="width:90px"></div>`;
  for (const g of C.Games.filter(x => x.built && !x.hidden)) {
    const eff = G.effectiveOdds(C, st, g.id);
    const fields = Object.entries(eff).filter(([k, v]) => typeof v === 'number');
    if (!fields.length) continue;
    html += `<div class="row"><b style="width:90px">${g.icon || ''} ${esc(g.name)}</b>` +
      fields.map(([k, v]) => `<label>${esc(k)}</label><input type="number" step="any" data-game="${g.id}" data-key="${k}" value="${v}" style="width:80px">`).join('') + `</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    const s = ctx.S(); s.oddsOverrides = s.oddsOverrides || {};
    if (inp.dataset.odds) s.oddsOverrides[inp.dataset.odds] = Number(inp.value);
    else { s.oddsOverrides[inp.dataset.game] = s.oddsOverrides[inp.dataset.game] || {}; s.oddsOverrides[inp.dataset.game][inp.dataset.key] = Number(inp.value); }
    S.log(s, 'ODDS', null, { key: inp.dataset.odds || inp.dataset.game + '.' + inp.dataset.key, value: Number(inp.value) });
    ctx.sync();
  }));
}

// ── Chaos ────────────────────────────────────────────────────────
export function undoChaos() { const r = E.chaosUndo(ctx.S()); ctx.msg('↩️ ' + esc(r.text), 'wheelMsgs'); ctx.sync(); }
export function doChaos(tier, loud) {
  const st = ctx.S(), C = ctx.C();
  const r = E.chaosShuffle(C, st, ctx.rng, tier, { loud });
  ctx.msg(`☠️ ${esc(r.text)}${loud ? '' : ' (silent)'}`, 'wheelMsgs');
  ctx.sync();
}
function openRetcon() {
  const st = ctx.S(), C = ctx.C();
  const types = ['GAME','GOOD','BAD','JAIL','SHOP','START'];
  const colors = Object.keys(C.Board.colorWeights);
  ctx.openModal(`<h2>🩹 Retcon a tile</h2>
    <div class="row"><label>Tile #</label><input id="rtIdx" type="number" min="1" max="${st.board.length}" value="1" style="width:80px">
    <label>Type</label><select id="rtType"><option value="">keep</option>${types.map(t => `<option>${t}</option>`).join('')}</select>
    <label>Color</label><select id="rtColor"><option value="">keep</option>${colors.map(c => `<option>${c}</option>`).join('')}</select>
    <button class="primary" id="rtGo">Apply</button><button id="mClose">Close</button></div><div id="rtMsg"></div>`);
  ctx.$('mClose').onclick = ctx.closeModal;
  ctx.$('rtGo').onclick = () => {
    const r = E.retconTile(C, ctx.S(), ctx.rng, Number(ctx.$('rtIdx').value) - 1, { type: ctx.$('rtType').value || undefined, color: ctx.$('rtColor').value || undefined });
    ctx.$('rtMsg').innerHTML = `<div class="msg">${esc(r.text)}</div>`; ctx.sync();
  };
}

// ── Start Wheel ──────────────────────────────────────────────────
export function spinStart(player) {
  const st = ctx.S(), C = ctx.C();
  const rows = C.Wheel_Start || [];
  if (!rows.length) { ctx.msg('No Wheel_Start rows in config.'); return; }
  const handled = spinWithMods(rows, 'START WHEEL', 'Start', player, (o, res) => { ctx.msg(`🏁 <b>${esc(o.label)}</b> — ${esc(res.text || '')}`); ctx.followups(res, player); });
  if (handled) return;
  const r = E.spinStartWheel(C, st, ctx.rng, player);
  if (r) { ctx.msg(`🏁 <b>${esc(r.outcome.label)}</b> — ${esc(r.result.text || '')}`); ctx.followups(r.result, player); }
  ctx.sync();
}
