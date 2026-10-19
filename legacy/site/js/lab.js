// Game Lab page (/lab). Built-in config, one sandbox tester, every minigame on a menu.
// Nothing here reads or writes the real session's save, and nothing is sent to the Sheet's ledger.
import { DEFAULT_CONFIG } from './config-default.js';
import { setLedgerPush } from './config.js';
import { makeRng } from './rng.js';
import * as S from './state.js';
import * as G from './games.js';
import * as GG from './gm-games.js';
import { renderGameStage } from './game-ui.js';
import { showWheelSpin, esc } from './wheel-ui.js';
import * as L from './lab-core.js';
import { rulesSections } from './rules.js';

setLedgerPush(false);
const $ = (id) => document.getElementById(id);
const config = structuredClone(DEFAULT_CONFIG);
const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
const rng = makeRng(seed);
let state = L.newLabState(config, seed);
const catalog = L.labCatalog(config), order = L.labOrder(catalog);
const store = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch { return { getItem: () => null, setItem() {} }; } })();
let marks = L.loadMarks(store);
let current = null, roundStart = 0, lastShown = null, shownSpinTs = 0, ticker = null, stake = 100;
const tester = () => state.players[0];
const nameOf = (id) => catalog.flatMap(g => g.games).find(g => g.id === id);

function toast(text, ms = 3500) { const el = $('toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms); }
function msg(html) { const el = document.createElement('div'); el.innerHTML = html; $('labMsgs').prepend(el); while ($('labMsgs').children.length > 6) $('labMsgs').lastChild.remove(); }
const save = () => L.saveMarks(store, marks);

// The per-game buttons come from the same module the real GM window uses.
GG.attach({ S: () => state, C: () => config, rng, msg, toast, sync, byId: (id) => state.players.find(p => p.id === id), cur: tester, openModal() {}, closeModal() {}, followups() {}, $ });

function renderList() {
  $('labList').innerHTML = catalog.map(grp => `<h4>${esc(grp.label)}</h4>` + grp.games.map(g => { const e = marks[g.id] || {};
    return `<button class="lab-item ${g.id === current ? 'on' : ''} ${e.status || ''}" data-id="${g.id}"><span>${g.icon}</span><span>${esc(g.name)}</span><span class="st">${e.status === 'ok' ? '✅' : e.status === 'bad' ? '⚠️' : e.plays ? e.plays + '×' : ''}</span></button>`; }).join('')).join('');
  $('labList').querySelectorAll('[data-id]').forEach(el => { el.onclick = () => open(el.dataset.id); });
  $('labProgress').textContent = L.progress(catalog, marks).text;
}
function renderSide() {
  if (!current) return;
  const sec = rulesSections(config).find(s => s.id === 'games'), box = document.createElement('div'); box.innerHTML = sec ? sec.html : '';
  const mine = [...box.querySelectorAll('.game')].find(el => el.querySelector('h3')?.textContent.includes(nameOf(current).name));
  if (mine) { mine.querySelector('h3')?.remove(); $('labHow').innerHTML = mine.innerHTML; } else $('labHow').textContent = '—';
  $('labPay').innerHTML = `<table>${L.payoutRows(config, current).map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')}</table>`;
  const e = marks[current] || {}; $('labNote').value = e.note || ''; $('labStats').textContent = L.statsLine(marks, current);
  $('labOk').classList.toggle('primary', e.status === 'ok'); $('labBad').classList.toggle('danger', e.status === 'bad');
}

function startRound() {
  if (!current) return;
  if (state.game) state.game = null;
  const p = tester();
  if (S.bal(p, 'Gold') < stake * 4) { p.balances.Gold = L.LAB_BANK; msg('Tester topped back up to 10,000 Gold.'); }
  p.heldPowerUps = $('labMods').checked ? [{ id: 'nudge', name: 'Nudge' }, { id: 'reroll', name: 'Edge: Reroll' }, { id: 'fork', name: 'Edge: Fork' }] : [];
  state.ledger.length = 0; state.lastSpin = null; lastShown = null; roundStart = Date.now();
  $('wheelOverlay').classList.remove('show'); $('labResult').textContent = ''; $('labResult').className = 'lab-result';
  G.startGame(config, state, rng, current, p, [{ amount: stake, cur: 'Gold' }]);
  $('gamePanel').style.display = ''; GG.renderControls(); sync();
}
function open(id) { current = id; $('labMsgs').innerHTML = ''; $('labName').textContent = `${nameOf(id).icon} ${nameOf(id).name}`; $('labEmpty').hidden = true; renderList(); renderSide(); startRound(); }

// Called after every action (by the shared controls) and by the ticker.
function sync() {
  const now = Date.now(), g = state.game;
  if (g) lastShown = structuredClone(g);
  else if (lastShown && lastShown.settled !== true) {                       // the round was just settled (by the button or automatically)
    const o = L.outcomeOf(lastShown) || { mult: 1, label: '' }, last = state.ledger.filter(r => r.type === 'GAME' && 'won' in r).at(-1), mult = last ? Number(last.mult) : o.mult;
    lastShown.settled = true; lastShown.phase = 'done'; if (!lastShown.result) lastShown.result = { mult, label: o.label };
    L.recordPlay(marks, current, stake, mult); save();
    const net = Math.round(stake * (mult - 1));
    $('labResult').textContent = `${mult > 1 ? 'WIN' : mult < 1 ? 'LOSS' : 'PUSH'} — ${lastShown.result.label || mult + '×'} (${net >= 0 ? '+' : ''}${net} Gold)`;
    $('labResult').className = 'lab-result ' + (mult > 1 ? 'win' : mult < 1 ? 'lose' : '');
    $('gameControls').innerHTML = ''; renderList(); renderSide();
  }
  renderGameStage($('gameStage'), config, { ...state, game: g || lastShown }, now);
  if (state.lastSpin && state.lastSpin.ts > shownSpinTs && state.lastSpin.ts >= roundStart) { shownSpinTs = state.lastSpin.ts; showWheelSpin($('wheelOverlay'), state.lastSpin); }
  $('labGold').textContent = Math.round(S.bal(tester(), 'Gold')).toLocaleString('en-US');
  $('labCancel').disabled = !g; $('labAgain').disabled = !current;
  const busy = g && (G.gameNeedsTicks(g, now) || L.outcomeOf(g) || g.id === 'crash');
  if (busy && !ticker) ticker = setInterval(tick, 60);
  if (!busy && ticker && !(lastShown && G.gameNeedsTicks(lastShown, now))) { clearInterval(ticker); ticker = null; }
}
function settle() {
  const g = state.game, o = L.outcomeOf(g); if (!g || !o) return false;
  if (!L.readyToSettle(state, roundStart, Date.now())) return false;
  $('wheelOverlay').classList.remove('show');
  G.settle(config, state, tester(), o.mult, { gameId: g.id, label: o.label }); GG.hidePanel(); $('gamePanel').style.display = '';
  sync(); return true;
}
function tick() {
  const now = Date.now(), g = state.game;
  if (g && $('labAuto').checked && L.readyToSettle(state, roundStart, now)) { settle(); return; }
  renderGameStage($('gameStage'), config, { ...state, game: g || lastShown }, now);
  if (!g && !(lastShown && G.gameNeedsTicks(lastShown, now))) { clearInterval(ticker); ticker = null; }
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────
$('labTheme').innerHTML = config.Themes.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
$('labTheme').onchange = () => { document.documentElement.dataset.theme = $('labTheme').value; };
$('labBet').onchange = () => { stake = Number($('labBet').value); };
$('labAgain').onclick = startRound;
$('labCancel').onclick = () => { state.game = null; lastShown = null; $('gameControls').innerHTML = ''; $('labResult').textContent = 'Round cancelled — nothing won or lost.'; sync(); };
$('labNext').onclick = () => open(L.stepId(order, current, 1));
$('labPrev').onclick = () => open(L.stepId(order, current, -1));
const mark = (status) => { if (!current) return; L.setStatus(marks, current, marks[current]?.status === status ? '' : status); save(); renderList(); renderSide(); };
$('labOk').onclick = () => mark('ok'); $('labBad').onclick = () => mark('bad'); $('labClear').onclick = () => mark('');
$('labNote').oninput = () => { if (current) { L.setNote(marks, current, $('labNote').value); save(); } };
$('labCopy').onclick = async () => { const text = L.reportText(catalog, marks);
  try { await navigator.clipboard.writeText(text); toast('Report copied — paste it into the chat.'); } catch { $('labNote').value = text; $('labNote').select(); toast('Could not reach the clipboard — the report is in the notes box, selected.'); } };
let resetArmed = 0;
$('labReset').onclick = () => { if (Date.now() - resetArmed < 4000) { marks = {}; save(); renderList(); renderSide(); toast('Ticks and notes cleared.'); resetArmed = 0; } else { resetArmed = Date.now(); toast('Press Reset again to clear every tick and note.'); } };
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'n') open(L.stepId(order, current, 1)); else if (k === 'p') open(L.stepId(order, current, -1));
  else if (k === 'a') startRound(); else if (k === 's') { if (!settle()) toast('Nothing to settle yet.'); }
  else if (k === '1') mark('ok'); else if (k === '2') mark('bad'); else return;
  e.preventDefault();
});
window.addEventListener('error', (e) => { msg(`<span style="color:var(--bad-ink)">⚠️ ${esc(e.message || 'error')}</span>`); });
renderList(); sync();
// Deep link: /lab/#tower opens that game.
if (location.hash && order.includes(location.hash.slice(1))) open(location.hash.slice(1));
