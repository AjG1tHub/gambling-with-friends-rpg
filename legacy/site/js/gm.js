// GM Monitor (/gm) — the single writer. Owns state, rng, and all game logic.
import { loadConfig, getEndpoint, setEndpoint } from './config.js';
import * as RC from './recovery.js';
import { validateConfig, summarize as cfgSummary, reportHtml as cfgReportHtml, sheetDiff, gameReturns } from './config-check.js';
import { makeRng } from './rng.js';
import * as S from './state.js';
import * as E from './engine.js';
import { renderBoard, renderLeaderboard, fmtNum } from './render.js';
import { esc } from './wheel-ui.js';
import * as GG from './gm-games.js';
import * as ST from './stakes.js';
import * as LN from './loans.js';
import * as HI from './history.js';
import * as PR from './profiles.js';
import * as PT from './pets.js';
import * as PB from './petbattle.js';
import * as RD from './raid.js';
import { spriteHtml } from './sprites.js';
import * as CT from './contests.js';
import * as AU from './auction.js';
import * as BI from './buyin.js';
import * as TN from './turns.js';
import * as LT from './ledger-tools.js';
import { UndoStack, undoLabel, exportSession, parseSessionFile } from './snapshots.js';
import { DEFAULT_SOUND } from './sound.js';
import { rankMap } from './stats.js';
import { matchHotkey, cardHtml, isMac, hotkeyConflicts } from './hotkeys.js';

let config = null;
let state = null;
let rng = null;
let cfgSource = 'defaults';
let cfgRemote = null;   // raw tabs as fetched from the Sheet (for the config check)

// Undo: the last 30 clicks, kept in memory for this GM window (not persisted across reloads)
const undo = new UndoStack();
let lastSavedJson = null;

// transient UI state (never persisted)
const ui = { pickTile: null, wagers: [], turnKind: null, jailSpins: 0, resolvedAction: null };

const $ = (id) => document.getElementById(id);
const cur = () => S.currentPlayer(state);
const byId = (id) => state.players.find(p => p.id === id);

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  const r = await loadConfig();
  config = r.config; cfgSource = r.source; cfgRemote = r.remote || null;
  state = S.loadState();
  if (!state) state = S.initialState(config, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
  rng = makeRng(state.seed);
  rng.setState(state.rngState);
  state.configSource = cfgSource;
  lastSavedJson = JSON.stringify(state);
  initStatic();
  GG.init({
    S: () => state, C: () => config, rng, msg, toast, sync, byId, cur, openModal, closeModal,
    followups: handleVerbFollowups, $,
  });
  renderAll();
  announceConfigHealth();
  announceRecovery();
}
function announceRecovery() {
  const L = S.lastLoad || {};
  if (L.source === 'backup') { S.saveState(state); lastSavedJson = JSON.stringify(state); }      // replace the unreadable save straight away
  if (L.source === 'backup') showTrouble(`The saved game was unreadable, so the newest restore point (round ${L.backup?.round}, ${RC.ago(L.backup?.ts || Date.now())}) was loaded instead.`, { sticky: true });
  else if (L.source === 'corrupt') showTrouble('The saved game was unreadable and there was no restore point, so this is a fresh table. If you have a session file, load it from ⚙ Settings.', { sticky: true });
  const real = (L.notes || []).filter(n => /save format|numbered|reset|fixed/.test(n));
  if (L.source === 'live' && real.length) msg(`Saved game updated to the current version <span class="subtle">(${esc(real.slice(0, 3).join('; '))})</span>`, 'wheelMsgs');
  const bad = RC.auditState(state, config).filter(h => h.level === 'error');
  if (bad.length) { const fixes = RC.repairState(state, config); sync(); showTrouble(`The saved game had ${bad.length} problem${bad.length === 1 ? '' : 's'} and was repaired: ${fixes.join('; ')}.`, { sticky: true }); }
}

function sync() {
  PT.accruePower(config, state);            // main-game events → Power Level ⚡
  state.rngState = rng.getState();
  if (lastSavedJson) undo.push(lastSavedJson);          // what the table looked like before this click
  const res = S.saveState(state);
  lastSavedJson = JSON.stringify(state);
  if (res && !res.ok) showTrouble('The browser is out of storage, so this session is no longer being saved to disk. Use ⚙ Settings → “Save session to a file” now.', { sticky: true });
  else { try { RC.maybeBackup(state, { json: lastSavedJson }); } catch (_) { /* backups are best-effort */ } }
  renderAll();
}

// ── Trouble banner: errors never fail silently, and there is always a way back ─────────────────
let troubleCount = 0;
function showTrouble(text, { sticky = false } = {}) {
  let el = $('trouble');
  if (!el) { el = document.createElement('div'); el.id = 'trouble'; el.className = 'trouble'; document.body.appendChild(el); }
  troubleCount++;
  el.innerHTML = `<span class="trouble-text">⚠️ ${esc(text)}</span>
    <button id="trUndo">↩️ Undo last action</button><button id="trBackups">🛟 Restore points</button><button id="trSave">⬇ Save session file</button><button id="trClose">✕</button>`;
  el.style.display = '';
  $('trUndo').onclick = () => { hideTrouble(); doUndo(); };
  $('trBackups').onclick = () => { hideTrouble(); openBackups(); };
  $('trSave').onclick = downloadSession;
  $('trClose').onclick = hideTrouble;
  if (!sticky) { const n = troubleCount; setTimeout(() => { if (n === troubleCount) hideTrouble(); }, 30000); }
}
function hideTrouble() { const el = $('trouble'); if (el) el.style.display = 'none'; }
function onCrash(what) {
  const text = String(what && (what.message || what.reason?.message || what.reason) || what || 'unknown error').slice(0, 200);
  console.error('GWF error:', what);
  try { showTrouble(`Something went wrong (${text}). The table is still saved — try the action again, or step back.`); } catch (_) { /* never throw from the handler */ }
}
window.addEventListener('error', (e) => onCrash(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => onCrash(e.reason));
function downloadSession() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportSession(state, { configSource: cfgSource })], { type: 'application/json' }));
  a.download = `gwf-session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function adoptState(next, note) {
  state = next; rng.setState(state.rngState);
  ui.turnKind = state.move && !state.move.done ? 'move' : null; ui.resolvedAction = null; ui.pickTile = null;
  closeModal(); sync(); if (note) msg(note, 'wheelMsgs');
}
function openBackups() {
  const list = RC.listBackups();
  const health = RC.auditState(state, config);
  openModal(`<h2>🛟 Restore points <span class="subtle">kept in this browser</span></h2>
    <p class="subtle">A restore point is taken at the start of every round, when a session starts or ends, and every 5 minutes. The newest ${RC.BACKUP_MAX} are kept. Restoring can be undone with ↩️.</p>
    ${list.length ? `<table class="cfg-table"><tbody>${list.map(b => `<tr><td>${esc(RC.ago(b.ts))}</td><td>${esc(b.reason)}</td><td>round ${esc(b.round)} · ${esc(b.players)} players · ${esc(b.phase)}</td><td style="text-align:right"><button data-bk="${esc(b.id)}">Restore</button></td></tr>`).join('')}</tbody></table>` : '<p>No restore points yet.</p>'}
    <h3 style="margin-top:14px">Health check</h3>
    ${health.length ? `<table class="cfg-table"><tbody>${health.map(h => `<tr class="cfg-${h.level}"><td>${h.level === 'error' ? '⛔' : '⚠️'}</td><td>${esc(h.msg)}</td></tr>`).join('')}</tbody></table><div class="row"><button class="primary" id="bkRepair">🔧 Repair what can be repaired</button></div>` : '<p class="cfg-ok">✅ The saved game is consistent.</p>'}
    <div class="row" style="margin-top:12px"><button id="bkNow">📌 Take a restore point now</button><button id="bkBack">← Settings</button><button id="mClose">Close</button></div>`);
  document.querySelectorAll('[data-bk]').forEach(b => { b.onclick = () => {
    const st = RC.loadBackup(b.dataset.bk); if (!st) { msg('That restore point could not be read.', 'wheelMsgs'); return; }
    adoptState(st, `🛟 Restored the table to round ${esc(st.round)}.`);
  }; });
  if ($('bkRepair')) $('bkRepair').onclick = () => { const fixes = RC.repairState(state, config); closeModal(); sync(); msg(`🔧 Repaired: ${esc(fixes.join('; ') || 'nothing needed')}`, 'wheelMsgs'); };
  $('bkNow').onclick = () => { RC.saveBackup(state, 'manual'); openBackups(); };
  $('bkBack').onclick = openSettings; $('mClose').onclick = closeModal;
}

// Step back one GM click. Board, balances, wheels, pets and the dice sequence all rewind together.
// (Rows already sent to the Sheet's Ledger tab, and anything archived to the Hall of Fame, stay there.)
function doUndo() {
  const snap = undo.pop();
  if (!snap) { msg('Nothing to undo.', 'wheelMsgs'); return; }
  const what = undoLabel(state, snap.json);
  state = JSON.parse(snap.json);
  rng.setState(state.rngState);
  ui.turnKind = state.move && !state.move.done ? 'move' : null; ui.resolvedAction = null; ui.pickTile = null;
  closeModal();
  S.saveState(state); lastSavedJson = JSON.stringify(state);
  try { RC.maybeBackup(state, { json: lastSavedJson }); } catch (_) { /* best-effort */ }
  renderAll();
  msg(`↩️ Undid: <b>${esc(what)}</b> <span class="subtle">(${undo.size} more)</span>`, 'wheelMsgs');
}

// ── Rendering ────────────────────────────────────────────────────
function renderAll() {
  document.documentElement.dataset.theme = state.themeId;
  $('cfgSource').textContent = 'config: ' + cfgSource;
  if ($('btnUndo')) { $('btnUndo').disabled = !undo.size; $('btnUndo').textContent = `↩ Undo${undo.size ? ` (${undo.size})` : ''}`; }
  renderBoard($('gmBoard'), config, state, { clickable: true, onTileClick: onTileClick });
  renderLeaderboard($('gmLeaderboard'), config, state);
  $('gmLog').innerHTML = state.ledger.slice(-30).reverse()
    .map(r2 => `<div><span class="hl">${esc(r2.type)}</span> ${esc(JSON.stringify({ ...r2, ts: undefined, type: undefined }))}</div>`).join('');
  renderSetup();
  renderTurn();
  renderTools();
  GG.renderOdds();
  if (state.game) { $('gamePanel').style.display = ''; $('wagerBlock').style.display = 'none'; GG.renderControls(); }
}

function renderSetup() {
  const started = state.phase === 'playing';
  $('setupPanel').style.display = started ? 'none' : '';
  $('turnPanel').style.display = started ? '' : 'none';
  $('setupPlayers').innerHTML = state.players.map(p =>
    `<span class="tag">${esc(p.name)} <a href="#" data-rm="${p.id}" style="color: var(--bad-ink)">✕</a></span>`).join('');
  $('setupPlayers').querySelectorAll('[data-rm]').forEach(a =>
    a.addEventListener('click', (ev) => { ev.preventDefault(); state.players = state.players.filter(p => p.id !== a.dataset.rm); sync(); }));
  renderRoster();
}

// Saved players: one click to seat a regular (before or during a session)
function seatProfile(profileId) {
  const pr = PR.loadProfiles().find(x => x.id === profileId); if (!pr || PR.isSeated(state, pr)) return;
  const playing = state.phase === 'playing';
  const p = PR.playerFromProfile(pr, playing ? (E.startPositions(state)[0] ?? 0) : 0, config.Config.StartingBank);
  state.players.push(p);
  if (playing) { state.turnOrder.push(p.id); S.log(state, 'PLAYER_JOIN', p.id, { midSession: true, profile: pr.id }); PR.touchProfiles({ players: [p] }); msg(`➕ <b>${esc(pr.name)}</b> joins from the roster.`, 'wheelMsgs'); }
  sync();
}
function renderRoster() {
  const list = PR.loadProfiles();
  for (const id of ['rosterChips', 'rosterChipsMid']) {
    const box = $(id); if (!box) continue;
    const free = list.filter(pr => !PR.isSeated(state, pr));
    box.innerHTML = list.length
      ? (free.length ? free.map(pr => `<button class="roster-chip" data-seat="${pr.id}" title="Played ${pr.timesPlayed || 0}×">${pr.iconUrl ? `<img src="${esc(pr.iconUrl)}" alt="">` : ''}${esc(pr.name)}</button>`).join('') : '<span class="subtle">Everyone on the roster is seated.</span>')
      : '<span class="subtle">No saved players yet — tick “save” when adding someone.</span>';
    box.querySelectorAll('[data-seat]').forEach(b => b.onclick = () => seatProfile(b.dataset.seat));
  }
}
function openRoster(note = '', bad = false) {
  const list = PR.loadProfiles(); const hof = HI.hallOfFame(HI.loadHistory(), PR.profileKeyMap(list));
  const life = (pr) => hof.find(r => r.key === 'profile:' + pr.id);
  openModal(`<h2>👥 Saved players <span class="subtle">${list.length} on the roster (this browser)</span></h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    ${list.length ? `<table class="shop"><tr><th></th><th>Name</th><th>Sessions</th><th>👑</th><th>Lifetime net</th><th></th></tr>${list.map(pr => { const l = life(pr); return `<tr>
        <td>${pr.iconUrl ? `<img class="roster-icon" src="${esc(pr.iconUrl)}" alt="">` : ''}</td>
        <td><input value="${esc(pr.name)}" data-pr-name="${pr.id}" style="width:130px"></td>
        <td>${l ? l.sessions : 0}</td><td>${l ? l.titles : 0}</td><td>${l ? (l.totalNet > 0 ? '+' : '') + fmtNum(l.totalNet) : '—'}</td>
        <td><button data-pr-save="${pr.id}">Rename</button><label class="btn-like" style="padding:4px 8px;font-size:12px">Icon<input type="file" accept="image/*" data-pr-icon="${pr.id}" style="display:none"></label><button class="danger" data-pr-del="${pr.id}">✕</button></td></tr>`; }).join('')}</table>`
      : '<p class="subtle">No saved players yet. Add a player with “save” ticked and they appear here.</p>'}
    <div class="row" style="margin-top:12px"><button class="primary" id="mClose">Close</button></div>`);
  document.querySelectorAll('[data-pr-save]').forEach(b => b.onclick = () => { const r = PR.updateProfile(b.dataset.prSave, { name: document.querySelector(`[data-pr-name="${b.dataset.prSave}"]`).value }); openRoster(r.text, !!r.error); renderRoster(); });
  document.querySelectorAll('[data-pr-icon]').forEach(inp => inp.onchange = async () => { const icon = await fileToIcon(inp); if (icon) { const r = PR.updateProfile(inp.dataset.prIcon, { iconUrl: icon }); openRoster(r.text, !!r.error); renderRoster(); } });
  document.querySelectorAll('[data-pr-del]').forEach(b => b.onclick = () => { if (!confirm('Remove this saved player? Their past sessions stay in the Hall of Fame.')) return; const r = PR.deleteProfile(b.dataset.prDel); openRoster(r.text, !!r.error); renderRoster(); });
  $('mClose').onclick = closeModal;
}

function renderTools() {
  const pSel = $('toolPlayer'), cSel = $('toolCurrency');
  const pv = pSel.value, cv = cSel.value;
  pSel.innerHTML = state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  cSel.innerHTML = config.Currencies.filter(c => c.active).map(c => `<option>${esc(c.name)}</option>`).join('');
  if (pv) pSel.value = pv; if (cv) cSel.value = cv;
  const fSel = $('forceMethodSel');
  if (fSel && !fSel.options.length) fSel.innerHTML = config.Wheel_Method.map(m => `<option>${esc(m.label)}</option>`).join('');
  const foW = $('foWheel');
  if (foW && !foW.options.length) foW.innerHTML = Object.keys(forcedWheelDefs()).map(k => `<option>${k}</option>`).join('');
  const foO = $('foOutcome');
  if (foO && foW && foO.dataset.wheel !== foW.value) {
    const def = forcedWheelDefs()[foW.value];
    foO.innerHTML = def.rows.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('');
    foO.dataset.wheel = foW.value;
  }
  const foP = $('foPlayer');
  if (foP) {
    const vp = foP.value;
    foP.innerHTML = state.players.map(pl => `<option value="${pl.id}">${esc(pl.name)}</option>`).join('');
    if (vp) foP.value = vp; else if (cur()) foP.value = cur().id;
  }
  const trC = $('trCurrency');
  if (trC) { const v3 = trC.value; trC.innerHTML = config.Currencies.filter(c => c.active).map(c => `<option>${esc(c.name)}</option>`).join(''); if (v3) trC.value = v3; }
  for (const id of ['fsA', 'fsB', 'trFrom', 'trTo']) {
    const sel = $(id); if (!sel) continue;
    const v2 = sel.value;
    sel.innerHTML = state.players.map(pl => `<option value="${pl.id}">${esc(pl.name)}</option>`).join('');
    if (v2) sel.value = v2;
  }
  renderStakes();
  const themeSel = $('themeSel');
  if (!themeSel.options.length) {
    themeSel.innerHTML = config.Themes.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  }
  themeSel.value = state.themeId;
  if ($('textScaleSel')) { $('textScaleSel').value = String(state.display?.textScale || 1); $('contrastOn').checked = !!state.display?.contrast; }
  const snd = { ...DEFAULT_SOUND, ...(state.sound || {}) };
  if ($('soundOn')) { $('soundOn').checked = snd.on !== false; $('soundVol').value = snd.volume; }
}

// IRL stakes: record-only list with settle / reopen (never touches balances)
function renderStakes() {
  for (const id of ['stakeA', 'stakeB']) {
    const sel = $(id); if (!sel) continue;
    const v = sel.value;
    sel.innerHTML = `<option value="">${id === 'stakeA' ? 'who' : 'vs'} (optional)</option>` + state.players.map(pl => `<option value="${pl.id}">${esc(pl.name)}</option>`).join('');
    sel.value = v;
  }
  const box = $('stakeList'); if (!box) return;
  const stakes = ST.normalizeStakes(state);
  box.innerHTML = stakes.length ? stakes.slice().reverse().map(s => `<div class="stake-row ${s.settled ? 'settled' : ''}">
      <span class="stake-text">${esc(ST.stakeLine(state, s))}</span>
      ${s.settled ? `<button data-stake-reopen="${s.id}">↩ reopen</button>`
        : `<select data-stake-win="${s.id}"><option value="">winner…</option>${(s.playerIds.length ? s.playerIds.map(byId).filter(Boolean) : state.players).map(pl => `<option value="${pl.id}">${esc(pl.name)}</option>`).join('')}</select>
           <button data-stake-settle="${s.id}">✔ settle</button>`}
    </div>`).join('') : '<div class="subtle">No IRL stakes logged.</div>';
  box.querySelectorAll('[data-stake-settle]').forEach(b => b.onclick = () => {
    const sel = box.querySelector(`[data-stake-win="${b.dataset.stakeSettle}"]`);
    ST.settleStake(state, b.dataset.stakeSettle, { winnerId: sel ? sel.value : null }); sync();
  });
  box.querySelectorAll('[data-stake-reopen]').forEach(b => b.onclick = () => { ST.reopenStake(state, b.dataset.stakeReopen); sync(); });
}

// A short notice that is visible whatever panel is showing (replaces the old blocking alert boxes).
function toast(text, ms = 4500) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms);
}
function msg(html, where = 'turnMsgs') {
  const el = document.createElement('div');
  el.className = 'msg'; el.innerHTML = html;
  const box = $(where);
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
}

function renderTurn() {
  if (state.phase !== 'playing') return;
  const p = cur();
  $('turnWho').textContent = `${p.name} — Round ${state.round}` + (p.jailTier ? ` · JAIL ${p.jailTier}` : '');
  const acts = $('turnActions');
  acts.innerHTML = '';
  const mv = state.move;
  const addBtn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.addEventListener('click', fn); acts.appendChild(b); return b;
  };

  // Never show Begin Turn while a move is actually in flight (A9)
  if (ui.turnKind === null && mv && !mv.done) ui.turnKind = 'move';
  if (ui.turnKind === null) {
    addBtn('▶ Begin Turn', 'primary', doBeginTurn);
    addBtn('End Turn ⏭', '', doEndTurn);
  } else if (ui.turnKind === 'skip') {
    addBtn('End Turn ⏭', 'primary', doEndTurn);
  } else if (ui.turnKind === 'jail') {
    addBtn(`🔐 Jail Panel (${ui.jailSpins} spin${ui.jailSpins > 1 ? 's' : ''} due)`, 'primary', () => openJailPanel(p.id));
    addBtn('End Turn ⏭', '', doEndTurn);
  } else if (ui.turnKind === 'move') {
    if (!mv) {
      addBtn('🎡 Spin Method Wheel', 'primary', doSpinMethod);
      addBtn('End Turn ⏭', '', doEndTurn);
    } else if (mv.pendingVoid) {
      addBtn('🌀 SPIN THE VOID WHEEL', 'danger', doSpinVoid);
    } else if (mv.needsTarget) {
      // target pickers rendered in moveExtra
      addBtn('End Turn ⏭', '', doEndTurn);
    } else if (mv.done) {
      if (ui.resolvedAction === null) addBtn('🎯 Resolve Tile', 'primary', doResolveTile);
      addBtn('End Turn ⏭', ui.resolvedAction !== null ? 'primary' : '', doEndTurn);
    } else {
      addBtn('End Turn ⏭', '', doEndTurn);
    }
  }

  // Direction pad
  const showPad = mv && !mv.done && !mv.pendingVoid && !mv.needsTarget;
  $('dirpad').style.display = showPad ? 'grid' : 'none';
  $('moveStatus').textContent = '';
  if (showPad) {
    $('stepsLeft').textContent = mv.candy ? `🍬${mv.candy.color}${mv.candy.double ? '×2' : ''}` : mv.stepsLeft;
    $('moveStatus').textContent = mv.candy
      ? `${mv.label}: walk to the ${mv.candy.double ? 'SECOND' : 'first'} ${mv.candy.color} tile`
      : `${mv.label}: rolled ${mv.rolled ?? mv.stepsLeft} — ${mv.stepsLeft} step${mv.stepsLeft === 1 ? '' : 's'} left`;
  }

  // Force-method control: available whenever no move is in flight
  $('forceRow').style.display = (!mv || mv.done) ? '' : 'none';

  // moveExtra: target select for Swap / Benevolence
  const ex = $('moveExtra');
  ex.innerHTML = '';
  if (mv && mv.needsTarget) {
    const others = state.players.filter(pl => pl.id !== p.id);
    ex.innerHTML = `<span class="subtle">${mv.needsTarget === 'swap' ? 'Swap with:' : 'Benevolence — move:'}</span>`;
    others.forEach(o => {
      const b = document.createElement('button');
      b.textContent = o.name + (o.jailTier ? ' 🔒' : '');
      b.title = o.jailTier ? 'Swapping with a jailed player trades the sentence too — you take the cell' : '';
      b.addEventListener('click', () => pickMoveTarget(o.id));
      ex.appendChild(b);
    });
  }
  if (mv && mv.reversed) {
    ex.innerHTML += `<span class="tag debuff">THE LONG WAY: directions reversed</span>`;
  }
}

// ── Turn flow ────────────────────────────────────────────────────
function doBeginTurn() {
  const r = E.beginTurn(config, state);
  ui.turnKind = r.kind;
  ui.jailSpins = r.spins || 0;
  ui.resolvedAction = null;
  r.notes.forEach(n => msg(esc(n)));
  if (r.kind === 'jail') openJailPanel(cur().id);
  sync();
}

function doEndTurn() {
  E.endTurn(state, config);
  ui.turnKind = null; ui.jailSpins = 0; ui.resolvedAction = null;
  hideGamePanel();
  sync();
}

function startMethod(o, forced) {
  const mv = E.beginMove(config, state, rng, o, { forced });
  if (mv.done) {
    ui.resolvedAction = null;
    msg(`Arrived at tile ${cur().pos + 1}. Resolve it.`);
  } else if (mv.stepsLeft > 0 && !mv.candy && !mv.needsTarget) {
    msg(`Walk <b>${mv.stepsLeft}</b> step${mv.stepsLeft > 1 ? 's' : ''} — use the pad.`);
  }
  sync();
}

function doSpinMethod() {
  const o = E.spinMethodWheel(config, state, rng);
  msg(`🎡 <b>${esc(o.label)}</b> — ${esc(o.desc)}`);
  startMethod(o, false);
}

// Testing / GM-fiat: run any movement method without spinning the wheel.
// Ledger records it as forced instead of a wheel result.
function doForceMethod() {
  const o = config.Wheel_Method.find(m => m.label === $('forceMethodSel').value);
  if (!o) return;
  ui.turnKind = 'move'; ui.resolvedAction = null; state.move = null;
  msg(`⚙️ <b>GM forced: ${esc(o.label)}</b> — ${esc(o.desc)}`);
  startMethod(o, true);
}

// GM fiat: force ANY outcome on ANY wheel for ANY player. Stages the wheel
// animation landing on that outcome (indistinguishable from fate on the
// player view), executes the real effect, and ledgers it as forced.
function forcedWheelDefs() {
  return {
    'GOOD':     { rows: config.Wheel_Good,     title: 'GOOD Wheel' },
    'BAD':      { rows: config.Wheel_Bad,      title: 'BAD Wheel' },
    'VOID':     { rows: config.Wheel_Void,     title: 'VOID WHEEL' },
    'JAIL':     { rows: config.Wheel_Jail,     title: 'JAIL WHEEL' },
    'BUY-IN':   { rows: config.Wheel_BuyIn,    title: 'BUY-IN WHEEL' },
    'BATTLE':   { rows: config.Wheel_Battle,   title: 'BATTLE WHEEL' },
    'CATEGORY': { rows: config.Wheel_Category, title: 'CATEGORY WHEEL' },
  };
}

function doForceOutcome() {
  const wheelKey = $('foWheel').value;
  const def = forcedWheelDefs()[wheelKey];
  const idx = Number($('foOutcome').value);
  const o = def && def.rows[idx];
  const p = byId($('foPlayer').value) || cur();
  if (!def || !o || !p) return;
  state.lastSpin = { wheel: def.title, outcomes: def.rows.map(r => r.label), index: idx, playerId: p.id, ts: Date.now() };
  S.log(state, 'WHEEL_SPIN', p.id, { wheel: wheelKey, outcome: o.label, forced: true });
  let text = o.desc || '';
  if (o.verb) {
    const res = E.executeVerb(config, state, rng, o, p);
    text = res.text || o.desc || '';
    handleVerbFollowups(res, p);
  }
  state.lastSpin.effect = text || o.label;
  msg(`⚙️ <b>Forced ${esc(wheelKey)}: ${esc(o.label)}</b> — ${esc(text)}`, 'wheelMsgs');
  sync();
  if (wheelKey === 'BUY-IN') openBuyIn(p.id, o);
}

// Swap two players. Jail is a player state, so swapping with a jailed player
// trades places LITERALLY: you take their cell (and tier), they walk free.
function swapPlayers(a, b) {
  const pos = a.pos; a.pos = b.pos; b.pos = pos;
  if ((a.jailTier > 0) !== (b.jailTier > 0)) {
    const t = a.jailTier; a.jailTier = b.jailTier; b.jailTier = t;
    const s1 = a.jailSkipNextSpin; a.jailSkipNextSpin = b.jailSkipNextSpin; b.jailSkipNextSpin = s1;
    const s2 = a.jailSpinsNextTurn; a.jailSpinsNextTurn = b.jailSpinsNextTurn; b.jailSpinsNextTurn = s2;
    S.log(state, 'JAIL_SWAP', a.id, { with: b.id });
    return true;
  }
  return false;
}

function pickMoveTarget(targetId) {
  const mv = state.move; const p = cur(); const t = byId(targetId);
  if (mv.needsTarget === 'swap') {
    const traded = swapPlayers(p, t);
    mv.needsTarget = null; mv.done = true;
    S.log(state, 'MOVE', p.id, { swapWith: t.id });
    if (traded) msg(`${esc(p.name)} ⇄ ${esc(t.name)} — INCLUDING the jail sentence. Enjoy the cell.`);
    else msg(`${esc(p.name)} ⇄ ${esc(t.name)}. Resolve ${esc(p.name)}'s new tile.`);
  } else {
    mv.benevTarget = targetId;
    mv.needsTarget = null;
    msg(`Benevolence: walk <b>${esc(t.name)}</b> ${mv.stepsLeft} tiles with the pad (${esc(p.name)}'s direction choice).`);
  }
  sync();
}

function doStep(dir) {
  const r = E.stepMove(config, state, rng, dir);
  if (!r.ok) { msg(`<span style="color: var(--bad-ink)">${esc(r.msg)}</span> <button onclick="window.__gwfOverride('${dir}')">GM override</button>`); sync(); return; }
  if (r.voidTriggered) msg('🌀 <b>EDGE CROSSED — THE VOID STIRS.</b> Spin the Void Wheel.');
  if (r.battle) { msg('⚔️ Long Walk collision!'); openBattle(state.move.playerId, r.battle); }
  if (r.arrived) {
    ui.resolvedAction = null;
    const who = state.move.benevTarget ? byId(state.move.benevTarget) : cur();
    msg(`Arrived at tile ${who.pos + 1}. Resolve it.`);
  }
  sync();
}
window.__gwfOverride = (dir) => { const r = E.stepMove(config, state, rng, dir, { override: true }); if (r.arrived) { ui.resolvedAction = null; msg(`Arrived (override). Resolve the tile.`); } sync(); };

function doSpinVoid() {
  const mover = moverOfCurrentMove();
  const handled = GG.spinWithMods(config.Wheel_Void, 'VOID WHEEL', 'Void', mover, (o, res) => {
    if (state.move) state.move.pendingVoid = false;
    msg(`🌀 <b>${esc(o.label)}</b> — ${esc(res.text || o.desc)}`);
    handleVerbFollowups(res, mover);
  });
  if (handled) return;
  const { outcome, result } = E.spinVoidWheel(config, state, rng);
  msg(`🌀 <b>${esc(outcome.label)}</b> — ${esc(result.text || outcome.desc)}`);
  handleVerbFollowups(result, moverOfCurrentMove());
  sync();
}

function moverOfCurrentMove() {
  return state.move?.benevTarget ? byId(state.move.benevTarget) : cur();
}

function doResolveTile() {
  const who = moverOfCurrentMove();
  const r = E.resolveTile(config, state, who);
  ui.resolvedAction = r.action;
  if (r.battleWith && r.tile.type !== 'JAIL') {
    msg(`⚔️ <b>Collision with ${esc(byId(r.battleWith).name)}!</b> Battle first.`);
    openBattle(who.id, r.battleWith);
  }
  switch (r.action) {
    case 'minigame': showGamePanel(who); break;
    case 'good_wheel': doGoodBad('good', who); break;
    case 'bad_wheel': doGoodBad('bad', who); break;
    case 'shop': openShop(who.id); break;
    case 'jailed': msg(`🔒 <b>${esc(who.name)} is in JAIL 1.</b> Movement turn over.`); break;
    case 'start_wheel': msg('🏁 Back at START — spin the Start Wheel.'); GG.spinStart(who); break;
    default: msg('Neutral tile. Nothing happens.');
  }
  sync();
}

function doGoodBad(which, player) {
  player = player || cur();
  // Wheel Mods (Nudge/Reroll/Fork) get a preview-and-confirm flow
  const handled = GG.spinWithMods(which === 'good' ? config.Wheel_Good : config.Wheel_Bad,
    which === 'good' ? 'GOOD Wheel' : 'BAD Wheel', which.toUpperCase(), player,
    (o, res) => { msg(`${which === 'good' ? '😇' : '😈'} <b>${esc(o.label)}</b> — ${esc(res.text || '')}`, 'wheelMsgs'); handleVerbFollowups(res, player); });
  if (handled) return;
  const { outcome, result } = E.spinGoodBad(config, state, rng, which, player);
  msg(`${which === 'good' ? '😇' : '😈'} <b>${esc(outcome.label)}</b> — ${esc(result.text || '')}`, 'wheelMsgs');
  handleVerbFollowups(result, player);
  sync();
}

function handleVerbFollowups(result, player) {
  if (!result) return;
  if (result.spinMethodAgain) { ui.turnKind = 'move'; state.move = null; msg('Free Move: spin the Method Wheel again.'); }
  if (result.resolveTile) { ui.resolvedAction = null; msg(`Now at tile ${player.pos + 1} — resolve it.`); }
  if (result.gmPickTile) {
    ui.pickTile = { label: `Teleport ${player.name}`, cb: (idx) => { player.pos = idx; ui.resolvedAction = null; msg(`Teleported to tile ${idx + 1}. Resolve it.`); sync(); } };
    $('pickHint').textContent = '← click a tile to teleport';
  }
  if (result.forcedMarch) {
    state.move = { playerId: player.id, method: 'FORCED', label: 'Forced March', startPos: player.pos, path: [player.pos], lastDir: null, pendingVoid: false, reversed: false, done: false, stepsLeft: result.forcedMarch, candy: null, needsTarget: null };
    ui.turnKind = 'move';
    msg(`Forced March: GM walks ${esc(player.name)} ${result.forcedMarch} tiles.`);
  }
  if (result.adjudicate) msg(`⚖️ ${esc(result.text)}`);
  if (result.wildEncounter) {
    const r = PB.startWildEncounter(config, state, rng, player.id);
    if (r.error) msg(`🐾 ${esc(r.text)}`, 'wheelMsgs'); else { PB.runBossTurns(config, state, rng); drawPetBattle(); }
  }
}

function onTileClick(idx) {
  if (ui.pickTile) {
    const cb = ui.pickTile.cb; ui.pickTile = null; $('pickHint').textContent = '';
    cb(idx);
  }
}

// ── Minigames (Phase 4) — see gm-games.js ────────────────────────
function showGamePanel(player) {
  const tile = state.board[player.pos];
  GG.openPanel(player, tile && tile.type === 'GAME' ? tile.gameId : null);
}
function hideGamePanel() { GG.hidePanel(); }

// ── Jail panel ───────────────────────────────────────────────────
function openJailPanel(playerId) {
  const jailed = state.players.filter(p => p.jailTier > 0);
  let p = byId(playerId);
  if (!p || p.jailTier === 0) p = jailed[0];
  if (!p) { openModal('<h2>🔐 Jail</h2><p>No one is in jail. The streets are safe. For now.</p><div class="row" style="margin-top:12px"><button class="primary" id="mClose">Close</button></div>'); $('mClose').onclick = closeModal; return; }
  const fee = E.jailBuyoutFee(config, p);
  const others = state.players.filter(o => o.id !== p.id);
  openModal(`
    <h2>🔐 ${esc(p.name)} — Jail ${p.jailTier}</h2>
    <p class="subtle">One exit attempt allowed before the mandatory spin. Spins due this turn: <b>${ui.jailSpins || 1}</b></p>
    <div class="panel" style="margin:10px 0"><h3>Exit paths</h3>
      <div class="row"><button class="primary" id="jBuyout">💰 Buyout — ${fee} Gold${p.heldPowerUps.some(x => x.id === 'bribe') ? ' (Bribe: 50% off applied)' : ''}</button></div>
      <div class="row"><span>🎯 Skill Check (${config.Config.JailSkillCheckStake}g stake, GM picks the game):</span>
        <button id="jSkillW">won</button><button id="jSkillL">lost</button></div>
      <div class="row"><span>🎲 Double-or-Detain:</span>
        <input id="jRisk" type="number" value="${config.Config.JailRiskMinWager}" style="width:90px">
        <button class="danger" id="jRiskGo">50/50</button></div>
      <div class="row"><span>🤝 Social Barter — payer:</span>
        <select id="jPayer">${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
        <button id="jBarterSkip">they skip a turn</button>
        <button id="jBarterCut">25% of next 3 wins</button></div>
    </div>
    <div class="row">
      <button class="danger" id="jSpin">🎡 SPIN THE JAIL WHEEL</button>
      <button id="mClose">Close</button>
    </div>
    <div id="jMsg"></div>`);
  const done = (r) => { $('jMsg').innerHTML = `<div class="msg">${esc(r.text || '')}</div>`; sync(); refreshOrClose(); };
  const refreshOrClose = () => { if (byId(p.id).jailTier === 0) { setTimeout(closeModal, 900); if (ui.turnKind === 'jail') ui.turnKind = 'skip'; } };
  $('jBuyout').onclick = () => done(E.jailBuyout(config, state, p));
  $('jSkillW').onclick = () => done(E.jailSkillCheck(config, state, rng, p, true));
  $('jSkillL').onclick = () => done(E.jailSkillCheck(config, state, rng, p, false));
  $('jRiskGo').onclick = () => done(E.jailRiskCheck(config, state, rng, p, Number($('jRisk').value)));
  $('jBarterSkip').onclick = () => done(E.jailSocialBarter(config, state, byId($('jPayer').value), p, 'skip'));
  $('jBarterCut').onclick = () => done(E.jailSocialBarter(config, state, byId($('jPayer').value), p, 'cut'));
  $('jSpin').onclick = () => {
    const { outcome, result } = E.spinJailWheel(config, state, rng, p);
    if (ui.jailSpins > 0) ui.jailSpins -= 1;
    $('jMsg').innerHTML = `<div class="msg">🎡 <b>${esc(outcome.label)}</b> — ${esc(result.text || outcome.desc)}</div>`;
    sync(); refreshOrClose();
  };
  $('mClose').onclick = closeModal;
}

// ── Battle ───────────────────────────────────────────────────────
function openBattle(aId, bId) {
  const a = byId(aId) || cur();
  const others = state.players.filter(o => o.id !== a.id);
  const b = byId(bId) || others[0];
  if (!b) return;
  const curOpts = config.Currencies.filter(c => c.active).map(c => `<option>${esc(c.name)}</option>`).join('');
  openModal(`
    <h2>⚔️ Battle</h2>
    <div class="row"><b>${esc(a.name)}</b> vs
      <select id="bOpp">${others.map(o => `<option value="${o.id}" ${o.id === b.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      <button class="primary" id="bSpin">🎡 Spin Battle Wheel</button></div>
    <div id="bContest" class="msg" style="display:none"></div>
    <h3 style="margin-top:10px">Wagers (unequal allowed, floor ${config.Config.BattleMinWager} Gold-equiv)</h3>
    <div class="row"><span style="width:110px">${esc(a.name)}:</span><input id="bWagA" type="number" value="${config.Config.BattleMinWager}" style="width:100px"><select id="bCurA">${curOpts}</select></div>
    <div class="row"><span style="width:110px" id="bNameB">${esc(b.name)}:</span><input id="bWagB" type="number" value="${config.Config.BattleMinWager}" style="width:100px"><select id="bCurB">${curOpts}</select></div>
    <div class="row" style="margin-top:8px">
      <button class="primary" id="bWinA">🏆 ${esc(a.name)} wins</button>
      <button class="primary" id="bWinB">🏆 <span id="bWinBName">${esc(b.name)}</span> wins</button>
    </div>
    <div class="row">
      <button class="danger" id="bForfA">${esc(a.name)} refuses (auto-forfeit)</button>
      <button class="danger" id="bForfB"><span id="bForfBName">${esc(b.name)}</span> refuses</button>
      <button id="mClose">Close</button>
    </div>
    <div id="bMsg"></div>`);
  const oppId = () => $('bOpp').value;
  $('bOpp').onchange = () => { const o = byId(oppId()); $('bNameB').textContent = o.name + ':'; $('bWinBName').textContent = o.name; $('bForfBName').textContent = o.name; };
  $('bSpin').onclick = () => {
    const { contest, category } = E.spinBattleWheel(config, state, rng, a.id, oppId());
    $('bContest').style.display = '';
    $('bContest').innerHTML = `<b>${esc(contest.label)}</b> <span class="subtle">(${esc(contest.pool)})</span>${category ? ` — Category: <b>${esc(category)}</b>` : ''}${contest.petBattle ? ` <button id="bPetGo" class="primary">⚔️🐾 Fight it out</button>` : ''}${CT.contestKind(contest) ? ` <button id="bAuto" class="primary">🎲 Run it</button>` : ''}`;
    if ($('bAuto')) $('bAuto').onclick = () => {
      const r = CT.runContest(config, state, rng, CT.contestKind(contest), a.id, oppId());
      $('bMsg').innerHTML = `<div class="msg" ${r.error ? 'style="border-color:var(--bad)"' : ''}>${esc(r.text)}${r.error ? '' : ' — press the winner button to settle the wagers.'}</div>`;
      if (!r.error) { $(r.winnerId === a.id ? 'bWinA' : 'bWinB').classList.add('pulse'); $(r.winnerId === a.id ? 'bWinB' : 'bWinA').classList.remove('pulse'); }
      sync();
    };
    if ($('bPetGo')) $('bPetGo').onclick = () => {
      const w = Math.max(Number($('bWagA').value) || 0, Number($('bWagB').value) || 0);
      const r = PB.startPetBattle(config, state, rng, { challengerId: a.id, opponentId: oppId(), wager: $('bCurA').value === 'Gold' && $('bCurB').value === 'Gold' ? w : 0 });
      if (r.error) { $('bMsg').innerHTML = `<div class="msg" style="border-color:var(--bad)">${esc(r.text)} Settle it another way.</div>`; return; }
      sync(); drawPetBattle();
    };
    sync();
  };
  const wagers = () => [
    { playerId: a.id, cur: $('bCurA').value, amount: Number($('bWagA').value) },
    { playerId: oppId(), cur: $('bCurB').value, amount: Number($('bWagB').value) },
  ];
  const finish = (winnerId, forfeitId = null) => {
    const r = E.settleBattle(config, state, wagers(), winnerId, { forfeitId });
    $('bMsg').innerHTML = `<div class="msg" ${r.error ? 'style="border-color:var(--bad)"' : ''}>${esc(r.text)}</div>`;
    if (r.error) return;
    sync(); setTimeout(closeModal, 900);
  };
  $('bWinA').onclick = () => finish(a.id);
  $('bWinB').onclick = () => finish(oppId());
  $('bForfA').onclick = () => finish(oppId(), a.id);
  $('bForfB').onclick = () => finish(a.id, oppId());
  $('mClose').onclick = closeModal;
}

// ── Shop (placeholder tier: exchange only) ───────────────────────
function openShop(playerId) {
  const p = byId(playerId) || cur();
  const { offers, bounds } = E.shopOffers(config, state, rng);
  openModal(`
    <h2>🛒 Shop — ${esc(p.name)}</h2>
    <p class="subtle">Session rates, rolled once per currency per session. Bounds shown so volatility reads as fair:
      <b>${bounds.min}× – ${bounds.max}× GoldRate</b>. Bidirectional, no house cut. Browsing is free; leaving ends tile resolution.</p>
    <table class="shop"><tr><th></th><th>Currency</th><th>GoldRate</th><th>Session rate</th><th>Units</th><th></th><th></th></tr>
      ${offers.map(o => `<tr>
        <td>${o.emoji || ''}</td><td>${esc(o.name)}</td><td>${o.goldRate}</td><td><b>${o.sessionRate}</b></td>
        <td><input type="number" value="1" min="1" style="width:70px" id="sq_${esc(o.name)}"></td>
        <td><button data-buy="${esc(o.name)}">Buy</button></td>
        <td><button data-sell="${esc(o.name)}">Sell</button></td>
      </tr>`).join('')}
    </table>
    <div id="puShelf">${GG.powerUpShelfHtml(p)}</div>
    <div id="petShelf"></div>
    <div class="row" style="margin-top:8px"><button class="primary" id="mClose">Leave Shop</button></div>
    <div id="sMsg"></div>`);
  const petShelf = () => {
    if (!PT.petRules(config).enabled) return;
    const pet = PT.activePet(p);
    $('petShelf').innerHTML = `<h3 style="margin-top:12px">🐾 Pet goods <span class="subtle">${pet ? `active: ${pet.emoji} ${esc(pet.name)} L${pet.level} · ${pet.hp}/${pet.hpMax} HP` : 'no pet yet'}</span></h3>
      <table class="shop">${PT.petShop(config).map(it => `<tr><td>${it.icon || ''} <b>${esc(it.name)}</b></td><td>${esc(it.desc || '')}</td><td><b>${it.price}</b>g</td><td><button data-buy-pet="${it.id}">Buy</button></td></tr>`).join('')}</table>`;
    document.querySelectorAll('[data-buy-pet]').forEach(b => b.onclick = () => {
      const r = PT.buyPetGood(config, state, rng, p, b.dataset.buyPet);
      $('sMsg').innerHTML = `<div class="msg" ${r.error ? 'style="border-color:var(--bad)"' : ''}>${esc(r.text)}</div>`; sync(); petShelf();
    });
  };
  petShelf();
  const refreshShelf = () => { $('puShelf').innerHTML = GG.powerUpShelfHtml(p); GG.wirePowerUpShelf(p, refreshShelf); };
  GG.wirePowerUpShelf(p, refreshShelf);
  document.querySelectorAll('[data-buy],[data-sell]').forEach(b => b.addEventListener('click', () => {
    const buy = b.dataset.buy; const name2 = buy || b.dataset.sell;
    const units = Number(document.getElementById('sq_' + name2).value);
    const r = E.shopExchange(config, state, p, name2, units, buy ? 'buy' : 'sell');
    $('sMsg').innerHTML = `<div class="msg" ${r.error ? 'style="border-color:var(--bad)"' : ''}>${esc(r.text)}</div>`;
    sync();
  }));
  // Mirror the shop on the shared screen while it's open (cleared by closeModal / any other modal)
  state.shop = { playerId: p.id, bounds, ts: Date.now(), offers: offers.map(o => ({ name: o.name, emoji: o.emoji, goldRate: o.goldRate, sessionRate: o.sessionRate })) };
  sync();
  $('mClose').onclick = closeModal;
}

// ── Buy-In + Auction ─────────────────────────────────────────────
function doBuyIn() {
  const p = cur();
  const o = E.spinBuyInWheel(config, state, rng, p);
  msg(`💸 <b>Buy-In: ${esc(o.label)}</b> — ${esc(o.desc)}`, 'wheelMsgs');
  sync(); openBuyIn(p.id, o);
}
// Apply the mechanic the wheel picked (or let the GM pick another). The GM only supplies the fee.
function openBuyIn(playerId, row, note = '', bad = false) {
  const p = byId(playerId) || cur(); if (!p) return;
  const rows = config.Wheel_BuyIn; row = row || rows[0];
  const mech = BI.buyInMech(row);
  openModal(`<h2>💸 Buy-in — ${esc(p.name)}</h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    <div class="row"><label>Mechanic</label><select id="biRow">${rows.map((r, i) => `<option value="${i}" ${r === row ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select><span class="subtle">${esc(row.desc || '')}</span></div>
    <div class="row">${BI.needsFee(mech) ? `<label>Fee (Gold)</label><input id="biFee" type="number" min="1" value="${config.Config.MinBet}" style="width:100px">` : '<input id="biFee" type="hidden" value="0">'}
      <label title="Gold handed to the player as their new stake, if your table does that">New stake (optional)</label><input id="biGrant" type="number" min="0" value="0" style="width:100px"></div>
    <div class="msg" id="biPreview"></div>
    <div class="row"><button class="primary" id="biApply">Apply</button><button id="mClose">Close</button></div>`);
  const pick = () => rows[Number($('biRow').value)];
  const preview = () => { $('biPreview').textContent = BI.previewBuyIn(config, state, p, pick(), $('biFee').value); };
  $('biRow').onchange = () => openBuyIn(p.id, pick());
  $('biFee').oninput = preview; preview();
  $('biApply').onclick = () => {
    const r = BI.applyBuyIn(config, state, p, pick(), { fee: $('biFee').value, grant: $('biGrant').value });
    if (r.error) return openBuyIn(p.id, pick(), r.text, true);
    msg(`💸 ${esc(r.text)}`, 'wheelMsgs'); sync();
    if (r.openAuction) return openAuction(p.id);
    if (r.openLoans) return openLoans(p.id);
    closeModal();
  };
  $('mClose').onclick = closeModal;
}

function openAuction(sellerId, note = '', bad = false) {
  const A = state.auction; const R = AU.auctionRules(config);
  const curOpts = config.Currencies.filter(c => c.active).map(c => `<option>${esc(c.name)}</option>`).join('');
  const pOpts = (sel) => state.players.map(o => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  const noteHtml = note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : '';
  const again = (r) => { sync(); openAuction(sellerId, r.text, !!r.error); };
  if (!A) {
    openModal(`<h2>🔨 Auction</h2>${noteHtml}
      <div class="row"><label>Seller</label><select id="aSeller">${pOpts(sellerId)}</select>
        <select id="aMode"><option value="PER_CURRENCY" ${config.Config.AuctionDefaultLots !== 'BUNDLE' ? 'selected' : ''}>one lot per currency</option><option value="BUNDLE" ${config.Config.AuctionDefaultLots === 'BUNDLE' ? 'selected' : ''}>everything as one lot</option></select>
        <button class="primary" id="aStart">Start live auction</button></div>
      <p class="subtle">Every secondary currency the seller holds goes up. Opening bid = ${Math.round(R.openingPct * 100)}% of GoldRate value, raises of ${R.minIncrement}+.</p>
      <details style="margin-top:8px"><summary class="subtle">Manual: settle a single lot by hand</summary>
        <div class="row" style="margin-top:6px"><label>Buyer</label><select id="aBuyer">${pOpts(null)}</select>
          <label>Lot</label><input id="aAmt" type="number" value="1" style="width:90px"><select id="aCur">${curOpts}</select>
          <label>for</label><input id="aPrice" type="number" value="100" style="width:100px"><label>Gold</label><button id="aSettle">Settle lot</button></div></details>
      <div class="row" style="margin-top:8px"><button id="mClose">Close</button></div><div id="aMsg"></div>`);
    $('aStart').onclick = () => { sellerId = $('aSeller').value; again(AU.startAuction(config, state, sellerId, { mode: $('aMode').value })); };
    $('aSettle').onclick = () => { const r = E.settleAuctionLot(config, state, $('aSeller').value, $('aBuyer').value, $('aCur').value, Number($('aAmt').value), Number($('aPrice').value)); $('aMsg').innerHTML = `<div class="msg">${esc(r.text)}</div>`; sync(); };
    $('mClose').onclick = closeModal; return;
  }
  const lot = AU.currentLot(A);
  const bidders = state.players.filter(o => o.id !== A.sellerId);
  openModal(`<h2>🔨 ${esc(A.sellerName)}'s auction <span class="subtle">lot ${Math.min(A.lotIdx + 1, A.lots.length)} of ${A.lots.length}</span></h2>${noteHtml}
    ${lot ? `<div class="msg"><b style="font-size:18px">${esc(AU.lotLabel(lot))}</b> <span class="subtle">worth ~${lot.refValue} Gold at GoldRate</span><br>
        ${lot.high ? `High bid: <b>${lot.high.amount} Gold</b> — ${esc(lot.high.name)}` : `No bids yet — opens at <b>${lot.opening}</b>`}${lot.calls ? ` · <b style="color: var(--bad-ink)">${lot.calls === 1 ? 'GOING ONCE' : 'GOING TWICE'}</b>` : ''}</div>
      <table class="shop">${bidders.map(o => `<tr><td><b>${esc(o.name)}</b> <span class="subtle">${fmtNum(S.bal(o, 'Gold'))}g</span></td>
        <td><button data-bid="${o.id}" data-amt="${AU.minBid(config, lot)}">${AU.minBid(config, lot)}</button><button data-bid="${o.id}" data-amt="${AU.minBid(config, lot) + 40}">+50</button><button data-bid="${o.id}" data-amt="${AU.minBid(config, lot) + 90}">+100</button>
          <input type="number" style="width:90px" placeholder="custom" data-bid-in="${o.id}"><button data-bid-custom="${o.id}">Bid</button></td></tr>`).join('')}</table>
      <div class="row" style="margin-top:8px"><button class="primary" id="aCall">🔨 ${lot.calls === 0 ? 'Going once…' : lot.calls === 1 ? 'Going twice…' : (lot.high ? 'SOLD!' : 'No sale')}</button><button id="aPass">Pass this lot</button></div>`
      : `<div class="msg">🔨 ${esc(A.summary || 'Auction over.')}</div>`}
    <div class="log" style="max-height:130px">${A.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>
    <div class="row" style="margin-top:8px">${lot ? '<button class="danger" id="aEnd">End auction now</button>' : '<button class="primary" id="aEnd">Done</button>'}<button id="mHide">Hide panel</button></div>`);
  document.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => again(AU.placeBid(config, state, b.dataset.bid, Number(b.dataset.amt))));
  document.querySelectorAll('[data-bid-custom]').forEach(b => b.onclick = () => again(AU.placeBid(config, state, b.dataset.bidCustom, Number(document.querySelector(`[data-bid-in="${b.dataset.bidCustom}"]`).value))));
  $('aCall') && ($('aCall').onclick = () => again(AU.callLot(config, state)));
  $('aPass') && ($('aPass').onclick = () => again(AU.passLot(config, state)));
  $('aEnd').onclick = () => { AU.endAuction(state); closeModal(); sync(); };
  $('mHide').onclick = closeModal;
}

// ── Ledger viewer ────────────────────────────────────────────────
function openLedger(filter = { playerId: '', group: 'All', text: '' }) {
  const rows = LT.filterLedger(state, filter); const shown = rows.slice(-250).reverse();
  const time = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  openModal(`<h2>📜 Ledger <span class="subtle">${rows.length} of ${state.ledger.length} rows${rows.length > 250 ? ' — newest 250 shown' : ''}${state.ledgerDropped ? ` · ${state.ledgerDropped} older rows scrolled off` : ''}</span></h2>
    <div class="row"><select id="lgPlayer"><option value="">everyone</option>${state.players.map(o => `<option value="${o.id}" ${o.id === filter.playerId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      <select id="lgGroup">${['All', ...Object.keys(LT.GROUPS), 'Other'].map(g => `<option ${g === filter.group ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <input id="lgText" placeholder="search…" value="${esc(filter.text || '')}" style="flex:1"><button id="lgGo">Filter</button><button id="lgCsv">⬇ CSV</button></div>
    ${LT.goldChartSvg(state)}
    <div class="ledger-table"><table class="shop"><tr><th>#</th><th>Time</th><th>Type</th><th>Player</th><th>What happened</th></tr>
      ${shown.map(r => `<tr><td class="subtle">${r.n ?? ''}</td><td class="subtle">${time(r.ts)}</td><td><span class="tag">${esc(r.type)}</span></td><td>${esc(byId(r.playerId)?.name || '')}</td><td>${esc(LT.describeRow(state, r))}</td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:10px"><button class="primary" id="mClose">Close</button></div>`);
  const read = () => ({ playerId: $('lgPlayer').value, group: $('lgGroup').value, text: $('lgText').value });
  $('lgGo').onclick = () => openLedger(read()); $('lgPlayer').onchange = () => openLedger(read()); $('lgGroup').onchange = () => openLedger(read());
  $('lgText').onkeydown = (e) => { if (e.key === 'Enter') openLedger(read()); };
  $('lgCsv').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + LT.toCsv(state, LT.filterLedger(state, read()))], { type: 'text/csv' }));
    a.download = `gwf-ledger-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  $('mClose').onclick = closeModal;
}

// ── Turn order, benching, shot clock ─────────────────────────────
function openTurnTools(note = '', bad = false) {
  const again = (r) => { sync(); openTurnTools(r.text, !!r.error); };
  const up = cur()?.id;
  openModal(`<h2>🔀 Turn order & table</h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    <table class="shop">${state.turnOrder.map((id, i) => { const pl = byId(id); return `<tr><td>${i + 1}.</td><td><b>${esc(pl?.name || '?')}</b> ${id === up ? '<span class="tag buff">UP NOW</span>' : ''}</td>
      <td><button data-ord="${id}" data-d="-1" ${i === 0 ? 'disabled' : ''}>▲</button><button data-ord="${id}" data-d="1" ${i === state.turnOrder.length - 1 ? 'disabled' : ''}>▼</button>
        <button data-bench="${id}" ${state.turnOrder.length <= 1 ? 'disabled' : ''}>Sit out</button></td></tr>`; }).join('')}</table>
    ${TN.benched(state).length ? `<h3 style="margin-top:10px">Sitting out</h3><div class="pill-row">${TN.benched(state).map(pl => `<button data-return="${pl.id}">↩ ${esc(pl.name)}</button>`).join('')}</div>` : ''}
    <h3 style="margin-top:10px">⏱ Shot clock</h3>
    <div class="row"><select id="ttTimer">${TN.TIMER_CHOICES.map(sec => `<option value="${sec}" ${Number(state.turnTimerSec || 0) === sec ? 'selected' : ''}>${sec ? sec + ' seconds per turn' : 'Off'}</option>`).join('')}</select>
      <button id="ttRestart">Restart this turn's clock</button><span class="subtle">Shows on the shared screen. Running out only shames — nothing happens automatically.</span></div>
    <div class="row" style="margin-top:10px"><button class="primary" id="mClose">Close</button></div>`);
  document.querySelectorAll('[data-ord]').forEach(b => b.onclick = () => again(TN.moveInOrder(state, b.dataset.ord, Number(b.dataset.d))));
  document.querySelectorAll('[data-bench]').forEach(b => b.onclick = () => { const r = TN.benchPlayer(state, b.dataset.bench); if (r.wasUp) { ui.turnKind = null; ui.resolvedAction = null; hideGamePanel(); } again(r); });
  document.querySelectorAll('[data-return]').forEach(b => b.onclick = () => again(TN.returnPlayer(state, b.dataset.return)));
  $('ttTimer').onchange = () => { state.turnTimerSec = Number($('ttTimer').value); TN.restartTurnClock(state); again({ text: state.turnTimerSec ? `Shot clock: ${state.turnTimerSec}s per turn.` : 'Shot clock off.' }); };
  $('ttRestart').onclick = () => { TN.restartTurnClock(state); again({ text: 'Clock restarted.' }); };
  $('mClose').onclick = closeModal;
}

// ── Pets + Power Level ───────────────────────────────────────────
function openPets(playerId, note = '', bad = false) {
  const R = PT.petRules(config); const p = byId(playerId) || cur() || state.players[0]; if (!p) return;
  const pets = PT.petsOf(p), act = PT.activePet(p);
  const again = (r) => { sync(); openPets(p.id, r.text, !!r.error); };
  openModal(`<h2>🐾 Pets — <select id="ptPlayer">${state.players.map(o => `<option value="${o.id}" ${o.id === p.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      <span class="lb-power" style="font-size:18px">⚡ ${PT.powerOf(p)}</span> <span class="subtle">Power Level (max ${PT.POWER_MAX})</span></h2>
    <div class="row"><span class="tag buff">${PT.rankOf(p).icon} ${PT.rankOf(p).name}</span><span class="subtle">${PT.powerEarned(p)} ⚡ earned lifetime${PT.nextRank(p) ? ` · ${PT.nextRank(p).earned - PT.powerEarned(p)} to ${PT.nextRank(p).name}` : ' · top rank'}${PT.rankOf(p).eggDiscount ? ` · eggs −${Math.round(PT.rankOf(p).eggDiscount * 100)}%` : ''}${PT.rankOf(p).xpBonus ? ` · training XP +${Math.round(PT.rankOf(p).xpBonus * 100)}%` : ''}</span></div>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    ${Object.keys(PT.bagOf(p)).length ? `<div class="row"><span class="subtle">Bag:</span>${Object.entries(PT.bagOf(p)).map(([id, n]) => `<span class="tag" title="${esc(PT.itemDef(id).desc)}">${PT.itemDef(id).icon} ${esc(PT.itemDef(id).name)} ×${n}</span>`).join('')}</div>` : ''}
    <p class="subtle">Power is earned by playing (turn +${R.gain.turn}, game win +${R.gain.gameWin}, big win +${R.gain.gameBigWin}, battle +${R.gain.battleWin}, out of jail +${R.gain.jailOut}) and spent here. It never becomes Gold.</p>
    ${pets.length ? pets.map(pet => `<div class="pet-card ${pet.id === act?.id ? 'active' : ''} ${pet.fainted ? 'fainted' : ''}">
        <div class="pet-face">${spriteHtml(config, pet, 64)}</div>
        <div class="pet-body">
          <div><b>${esc(pet.name)}</b> <span class="subtle">${esc(PT.formOf(config, pet).name)} · ${esc(pet.element)} · ${esc(pet.rarity)}${(() => { const sp = PT.speciesOf(config, pet.speciesId), nx = sp?.evolves?.[pet.stage || 0]; return nx ? ` · evolves at L${nx.level}` : ''; })()}</span> ${pet.id === act?.id ? '<span class="tag buff">ACTIVE</span>' : ''} ${pet.fainted ? '<span class="tag debuff">FAINTED</span>' : ''}</div>
          <div>Level <b>${pet.level}</b> · XP ${pet.xp}/${PT.xpToNext(pet.level)} · HP <b>${pet.hp}/${pet.hpMax}</b> · AC ${PT.armorClass(pet)} · ${pet.wins}W–${pet.losses}L</div>
          <div class="subtle">${esc(PT.statLine(pet))}</div>
          <div class="row" style="margin:6px 0 0">
            <input type="number" min="1" value="25" style="width:70px" data-pt-amt="${pet.id}"><button data-pt-train="${pet.id}">⚡ Train</button>
            <button data-pt-heal="${pet.id}">❤ Heal (${R.reviveCost}⚡)</button>
            ${pet.id === act?.id ? '' : `<button data-pt-active="${pet.id}">Make active</button>`}
            <input value="${esc(pet.name)}" style="width:110px" data-pt-name="${pet.id}"><button data-pt-rename="${pet.id}">Rename</button>
            <select data-pt-item="${pet.id}"><option value="">${pet.item ? '— take off —' : 'no held item'}</option>${pet.item ? `<option value="${pet.item}" selected>${PT.itemDef(pet.item).icon} ${esc(PT.itemDef(pet.item).name)} (held)</option>` : ''}${Object.entries(PT.bagOf(p)).filter(([, n]) => n > 0).map(([id, n]) => `<option value="${id}">${PT.itemDef(id).icon} ${esc(PT.itemDef(id).name)} ×${n}</option>`).join('')}</select>
            <button class="danger" data-pt-release="${pet.id}">Release</button>
          </div>
        </div></div>`).join('') : '<p class="subtle">No pets yet. Hatch an egg.</p>'}
    <div class="row" style="margin-top:12px">
      <button class="primary" id="ptHatch" ${pets.length >= R.maxPets ? 'disabled' : ''}>🥚 Hatch an egg (${PT.eggCostFor(config, p)}⚡)</button>
      <span class="subtle">GM:</span>
      <select id="ptSpecies"><option value="">random species</option>${PT.speciesList(config).map(sp => `<option value="${sp.id}">${sp.emoji} ${esc(sp.name)} (${esc(sp.rarity)})</option>`).join('')}</select>
      <button id="ptGift" ${pets.length >= R.maxPets ? 'disabled' : ''}>🎁 Free egg</button>
      <input id="ptPower" type="number" placeholder="±⚡" style="width:80px"><button id="ptGrant">Adjust ⚡</button>
      <button id="mClose">Close</button>
    </div>`);
  $('ptPlayer').onchange = () => openPets($('ptPlayer').value);
  $('ptHatch').onclick = () => again(PT.hatchEgg(config, state, rng, p));
  $('ptGift').onclick = () => again(PT.hatchEgg(config, state, rng, p, { free: true, speciesId: $('ptSpecies').value || undefined }));
  $('ptGrant').onclick = () => { const n = Number($('ptPower').value); if (!n) return; const d = PT.gainPower(state, p, n, 'GM adjustment'); again({ text: `${p.name}: ${d >= 0 ? '+' : ''}${d} ⚡` }); };
  document.querySelectorAll('[data-pt-train]').forEach(b => b.onclick = () => again(PT.trainPet(config, state, rng, p, b.dataset.ptTrain, Number(document.querySelector(`[data-pt-amt="${b.dataset.ptTrain}"]`).value))));
  document.querySelectorAll('[data-pt-heal]').forEach(b => b.onclick = () => again(PT.revivePet(config, state, p, b.dataset.ptHeal)));
  document.querySelectorAll('[data-pt-active]').forEach(b => b.onclick = () => again(PT.setActivePet(state, p, b.dataset.ptActive)));
  document.querySelectorAll('[data-pt-rename]').forEach(b => b.onclick = () => again(PT.renamePet(p, b.dataset.ptRename, document.querySelector(`[data-pt-name="${b.dataset.ptRename}"]`).value)));
  document.querySelectorAll('[data-pt-item]').forEach(sel => sel.onchange = () => { const pet = PT.petsOf(p).find(x => x.id === sel.dataset.ptItem); if (sel.value === (pet.item || '')) return; again(PT.equipItem(state, p, sel.dataset.ptItem, sel.value || null)); });
  document.querySelectorAll('[data-pt-release]').forEach(b => b.onclick = () => { if (confirm('Release this pet for good?')) again(PT.releasePet(state, p, b.dataset.ptRelease)); });
  $('mClose').onclick = closeModal;
}

// ── Pet battles (boss fights + PvP) ──────────────────────────────
function openPetBattle(challengerId, note = '', bad = false) {
  if (state.raid) return drawRaid(note, bad);
  const b = state.petBattle;
  if (b) return drawPetBattle(note, bad);
  const p = byId(challengerId) || cur() || state.players[0]; if (!p) return;
  const others = state.players.filter(o => o.id !== p.id);
  const mine = PB.previewFighter(config, { player: p });
  const odds = (foe) => (mine && foe ? `${Math.round(PB.matchup(mine, foe).a * 100)}% favoured` : '');
  openModal(`<h2>⚔️🐾 Pet battle</h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    <div class="row"><label>Challenger</label><select id="pbA">${state.players.map(o => `<option value="${o.id}" ${o.id === p.id ? 'selected' : ''}>${esc(o.name)}${PT.activePet(o) ? ` — ${PT.activePet(o).emoji} ${esc(PT.activePet(o).name)} L${PT.activePet(o).level}${PT.activePet(o).fainted ? ' (fainted)' : ''}` : ' — no pet'}</option>`).join('')}</select></div>
    <h3 style="margin-top:8px">🐲 Boss fight <span class="subtle">win Gold + Power; lose and your pet faints</span></h3>
    <table class="shop">${PB.bossList(config).map(bs => { const f = PB.previewFighter(config, { bossId: bs.id }); return `<tr><td style="font-size:22px">${bs.emoji}</td><td><b>${esc(bs.name)}</b><br><span class="subtle">L${bs.level} · ${esc(bs.element)} · ${f.hpMax} HP · AC ${f.ac}</span></td>
        <td>${bs.rewardGold} Gold</td><td class="subtle">${odds(f)}</td><td><button class="primary" data-pb-boss="${bs.id}">Fight</button></td></tr>`; }).join('')}</table>
    <div class="row"><button id="pbWild">🌿 Wild encounter</button><span class="subtle">a wild pet near your level — beat it and your pet may befriend it (CHA check)</span></div>
    <h3 style="margin-top:8px">🐍 Raid <span class="subtle">co-op: 2–6 pets vs one scaled-up boss; every winner gets Gold, XP and Power</span></h3>
    <div class="row"><select id="rdBoss">${RD.raidBossList(config).map(bs => `<option value="${bs.id}">${bs.emoji} ${esc(bs.name)} (L${bs.level}${bs.raidOnly ? ', raid only' : ''})</option>`).join('')}</select>
      <span class="pill-row">${state.players.map(o => `<label class="sound-ctl"><input type="checkbox" data-rd-p="${o.id}" ${PT.activePet(o) && !PT.activePet(o).fainted ? 'checked' : 'disabled'}> ${esc(o.name)}</label>`).join('')}</span>
      <button class="primary" id="rdGo">Start raid</button></div>
    <h3 style="margin-top:8px">⚔️ Player vs player</h3>
    <div class="row"><select id="pbB">${others.map(o => `<option value="${o.id}">${esc(o.name)}${PT.activePet(o) ? ` — ${PT.activePet(o).emoji} L${PT.activePet(o).level}` : ' — no pet'}</option>`).join('')}</select>
      <label>Gold each</label><input id="pbWager" type="number" min="0" value="0" style="width:90px"><button class="primary" id="pbPvp" ${others.length ? '' : 'disabled'}>Battle</button>
      <button id="mClose">Close</button></div>`);
  $('pbA').onchange = () => openPetBattle($('pbA').value);
  const go = (opts) => { const r = PB.startPetBattle(config, state, rng, { challengerId: $('pbA').value, ...opts }); if (r.error) return openPetBattle($('pbA').value, r.text, true); PB.runBossTurns(config, state, rng); sync(); drawPetBattle(); };
  document.querySelectorAll('[data-pb-boss]').forEach(btn => btn.onclick = () => go({ bossId: btn.dataset.pbBoss }));
  $('pbPvp').onclick = () => go({ opponentId: $('pbB').value, wager: $('pbWager').value });
  $('rdGo').onclick = () => {
    const ids = [...document.querySelectorAll('[data-rd-p]:checked')].map(x => x.dataset.rdP);
    const r = RD.startRaid(config, state, rng, { playerIds: ids, bossId: $('rdBoss').value });
    if (r.error) return openPetBattle($('pbA').value, r.text, true);
    sync(); drawRaid();
  };
  $('pbWild').onclick = () => { const r = PB.startWildEncounter(config, state, rng, $('pbA').value); if (r.error) return openPetBattle($('pbA').value, r.text, true); PB.runBossTurns(config, state, rng); sync(); drawPetBattle(); };
  $('mClose').onclick = closeModal;
}
function drawPetBattle(note = '', bad = false) {
  const b = state.petBattle; if (!b) return openPetBattle();
  const side = (f) => `<div class="pb-gm ${b.phase === 'active' && b.turn === f.side ? 'turn' : ''}"><span style="font-size:26px">${f.emoji}</span> <b>${esc(f.name)}</b> <span class="subtle">${esc(f.owner)} · L${f.level} ${esc(f.element)}</span><br>
      HP <b>${f.hp}/${f.hpMax}</b> · AC ${PB.effectiveAc(f)} · Mend ×${f.mends}${f.status ? ` · <b>${PB.STATUS[f.status.id].icon} ${PB.STATUS[f.status.id].name}</b>` : ''}</div>`;
  const me = PB.currentFighter(b);
  const moves = b.phase === 'active' && !me.isBoss ? PB.movesFor(me).map(m => `<button class="${m.kind === 'attack' ? 'primary' : ''}" data-pb-move="${m.id}" title="${esc(m.desc)}">${m.icon} ${esc(m.name)}</button>`).join('') : '';
  openModal(`<h2>${b.kind === 'boss' ? '🐲 Boss fight' : b.kind === 'wild' ? '🌿 Wild encounter' : '⚔️ Pet battle'} <span class="subtle">round ${b.round}${b.wager ? ` · ${b.wager} Gold each` : ''}</span></h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    <div class="row" style="align-items:stretch">${side(b.a)}${side(b.b)}</div>
    ${b.phase === 'active' ? `<div class="row"><b>${esc(me.name)}</b><span class="subtle">(${esc(me.owner)}) chooses:</span>${moves}</div>` : `<div class="msg">🏆 <b>${esc(b[b.winner].name)}</b> wins. ${esc((b.rewards || []).join(' · '))}</div>`}
    <div class="log" style="max-height:170px">${b.log.slice().reverse().map(l => `<div>${esc(l.text)}</div>`).join('')}</div>
    <div class="row" style="margin-top:10px">${b.phase === 'done' ? '<button class="primary" id="pbDone">Done</button>' : '<button class="danger" id="pbAbort">Abort (no result)</button>'}<button id="mHide">Hide panel</button></div>`, { keepBattle: true });
  document.querySelectorAll('[data-pb-move]').forEach(btn => btn.onclick = () => {
    const r = PB.petBattleAction(config, state, rng, btn.dataset.pbMove);
    if (r.error) return drawPetBattle(r.text, true);
    PB.runBossTurns(config, state, rng); sync(); drawPetBattle();
  });
  $('pbDone') && ($('pbDone').onclick = () => { PB.clearPetBattle(state); closeModal(); sync(); });
  $('pbAbort') && ($('pbAbort').onclick = () => { if (confirm('Abort the pet battle? Nothing is won or lost.')) { PB.clearPetBattle(state); closeModal(); sync(); } });
  $('mHide').onclick = closeModal;
}

function drawRaid(note = '', bad = false) {
  const r = state.raid; if (!r) return openPetBattle();
  const me = r.phase === 'active' ? RD.raidActor(r) : null;
  const card = (f, cls = '') => `<div class="pb-gm ${me && me.side === f.side ? 'turn' : ''} ${cls}"><span style="font-size:22px">${f.emoji}</span> <b>${esc(f.name)}</b> <span class="subtle">${esc(f.owner)} · L${f.level}</span><br>
      HP <b>${f.hp}/${f.hpMax}</b> · AC ${PB.effectiveAc(f)}${f.status ? ` · <b>${PB.STATUS[f.status.id].icon} ${PB.STATUS[f.status.id].name}</b>` : ''}</div>`;
  const moves = me && !me.isBoss ? PB.movesFor(me).map(m => `<button class="${m.kind === 'attack' ? 'primary' : ''}" data-rd-move="${m.id}" title="${esc(m.desc)}">${m.icon} ${esc(m.name)}</button>`).join('') : '';
  openModal(`<h2>🐍 Raid <span class="subtle">round ${r.round}</span></h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    <div class="row" style="align-items:stretch">${card(r.boss)}</div>
    <div class="row" style="align-items:stretch">${r.party.map(f => card(f)).join('')}</div>
    ${r.phase === 'active' ? `<div class="row"><b>${esc(me.name)}</b><span class="subtle">(${esc(me.owner)}) chooses:</span>${moves}</div>` : `<div class="msg">${r.winner === 'party' ? '🏆 Raid cleared.' : '💀 Raid failed.'} ${esc((r.rewards || []).join(' · '))}</div>`}
    <div class="log" style="max-height:170px">${r.log.slice().reverse().map(l => `<div>${esc(l.text)}</div>`).join('')}</div>
    <div class="row" style="margin-top:10px">${r.phase === 'done' ? '<button class="primary" id="rdDone">Done</button>' : '<button class="danger" id="rdAbort">Abort (no result)</button>'}<button id="mHide">Hide panel</button></div>`);
  document.querySelectorAll('[data-rd-move]').forEach(btn => btn.onclick = () => { const x = RD.raidAction(config, state, rng, btn.dataset.rdMove); if (x.error) return drawRaid(x.text, true); sync(); drawRaid(); });
  $('rdDone') && ($('rdDone').onclick = () => { RD.clearRaid(state); closeModal(); sync(); });
  $('rdAbort') && ($('rdAbort').onclick = () => { if (confirm('Abort the raid? Nothing is won or lost.')) { RD.clearRaid(state); closeModal(); sync(); } });
  $('mHide').onclick = closeModal;
}

// ── Hall of Fame (cross-session history, stored in this browser) ──
function openHistory(note = '', bad = false) {
  const hist = HI.loadHistory(), hof = HI.hallOfFame(hist, PR.profileKeyMap(PR.loadProfiles())), recs = HI.records(hist);
  const signed = (n) => `${n > 0 ? '+' : ''}${fmtNum(n)}`;
  openModal(`<h2>🏆 Hall of Fame <span class="subtle">${hist.length} session${hist.length === 1 ? '' : 's'} archived in this browser</span></h2>
    ${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}
    ${hof.length ? `<table class="shop"><tr><th>Player</th><th>Sessions</th><th>👑 Titles</th><th>Podiums</th><th>Total net</th><th>Best night</th><th>Game win %</th><th>🔒</th></tr>
      ${hof.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${r.sessions}</td><td>${r.titles}${r.bestStreak > 1 ? ` <span class="subtle">(${r.bestStreak} in a row)</span>` : ''}</td><td>${r.podiums}</td>
        <td>${signed(r.totalNet)}</td><td>${signed(Math.round(r.bestNet))}</td><td>${r.winRate == null ? '—' : Math.round(r.winRate * 100) + '%'}</td><td>${r.jailed}</td></tr>`).join('')}</table>`
      : '<p class="subtle">No sessions yet. End a session and it lands here.</p>'}
    ${recs.length ? `<h3 style="margin-top:10px">Records</h3><div class="pill-row">${recs.map(r => `<span class="tag buff">${r.emoji} ${esc(r.title)}: <b>${esc(r.name)}</b> ${signed(Math.round(r.value))}</span>`).join('')}</div>` : ''}
    ${hist.length ? `<h3 style="margin-top:10px">Sessions</h3><div class="log" style="max-height:140px">${hist.slice().reverse().map(s => `<div>${esc(HI.sessionLine(s))}</div>`).join('')}</div>` : ''}
    <div class="row" style="margin-top:12px">
      <button id="hiExport" ${hist.length ? '' : 'disabled'}>⬇ Export</button>
      <label class="btn-like">⬆ Import <input type="file" id="hiImport" accept="application/json,.json" style="display:none"></label>
      <button class="danger" id="hiClear" ${hist.length ? '' : 'disabled'}>Clear history</button>
      <button class="primary" id="mClose">Close</button>
    </div>`);
  $('hiExport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([HI.exportHistory()], { type: 'application/json' }));
    a.download = `gwf-history-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  $('hiImport').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const r = HI.importHistory(await f.text()); openHistory(r.text, !!r.error); };
  $('hiClear').onclick = () => { if (confirm('Delete every archived session from this browser? Export first if you want a copy.')) { HI.clearHistory(); openHistory('History cleared.'); } };
  $('mClose').onclick = closeModal;
}

// ── Loan Shark ───────────────────────────────────────────────────
function openLoans(borrowerId) {
  const R = LN.loanRules(config);
  const pOpts = (sel) => state.players.map(o => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  const draw = (note = '', bad = false) => {
    const rows = state.players.flatMap(pl => LN.openLoans(pl).map(l => `<tr>
        <td><b>${esc(pl.name)}</b></td><td>${l.lender === 'house' ? 'House' : esc(byId(l.lender)?.name || '?')}</td>
        <td>${l.principal}</td><td><b>${l.owed}</b></td>
        <td>${l.status === 'default' ? '<span style="color: var(--bad-ink);font-weight:800">DEFAULT</span>' : l.turnsLeft + ' turn' + (l.turnsLeft === 1 ? '' : 's')}</td>
        <td><input type="number" min="1" placeholder="all" style="width:80px" data-repay-amt="${pl.id}|${l.id}"><button data-repay="${pl.id}|${l.id}">Repay</button></td></tr>`));
    const keep = { b: $('lnBorrower')?.value || borrowerId || cur()?.id, l: $('lnLender')?.value || 'house', a: $('lnAmount')?.value || R.minPrincipal * 5, i: $('lnPct')?.value ?? R.interestPct, t: $('lnTerm')?.value ?? R.termTurns };
    openModal(`<h2>🦈 Loan Shark</h2>
      <p class="subtle">Table terms: ${R.interestPct}% flat interest, due in ${R.termTurns} of the borrower's turns. Miss it: +${R.penaltyPct}% penalty, then the Collector takes ${R.garnishPerTurn} Gold every turn. Limits ${R.minPrincipal}–${R.maxPrincipal} Gold, ${R.maxOpenLoans} loans each.</p>
      <div class="row"><label>Borrower</label><select id="lnBorrower">${pOpts(keep.b)}</select>
        <label>Lender</label><select id="lnLender"><option value="house">🏦 The house</option>${pOpts(null)}</select></div>
      <div class="row"><label>Gold</label><input id="lnAmount" type="number" value="${keep.a}" style="width:100px">
        <label>Interest %</label><input id="lnPct" type="number" value="${keep.i}" style="width:70px">
        <label>Turns</label><input id="lnTerm" type="number" value="${keep.t}" style="width:60px">
        <button class="primary" id="lnGo">Lend</button></div>
      <div id="lnMsg">${note ? `<div class="msg" ${bad ? 'style="border-color:var(--bad)"' : ''}>${esc(note)}</div>` : ''}</div>
      <h3 style="margin-top:10px">Open loans</h3>
      ${rows.length ? `<table class="shop"><tr><th>Borrower</th><th>Lender</th><th>Borrowed</th><th>Owes</th><th>Due</th><th></th></tr>${rows.join('')}</table>` : '<div class="subtle">Nobody owes anybody. Yet.</div>'}
      <div class="row" style="margin-top:10px"><button id="mClose">Close</button></div>`);
    $('lnLender').value = keep.l;
    $('lnGo').onclick = () => {
      const r = LN.takeLoan(config, state, byId($('lnBorrower').value), $('lnAmount').value, { lender: $('lnLender').value, interestPct: $('lnPct').value, termTurns: $('lnTerm').value });
      sync(); draw(r.text, !!r.error);
    };
    document.querySelectorAll('[data-repay]').forEach(b => b.onclick = () => {
      const [pid, lid] = b.dataset.repay.split('|');
      const amt = document.querySelector(`[data-repay-amt="${b.dataset.repay}"]`).value;
      const r = LN.repayLoan(config, state, byId(pid), lid, amt === '' ? null : amt);
      sync(); draw(r.text, !!r.error);
    });
    $('mClose').onclick = closeModal;
  };
  draw();
}

// ── Settings ─────────────────────────────────────────────────────
function openSettings() {
  openModal(`
    <h2>⚙ Settings</h2>
    <div class="row"><label>Google Sheets endpoint (Apps Script /exec URL)</label></div>
    <div class="row"><input id="sEndpoint" style="flex:1" value="${esc(getEndpoint())}" placeholder="https://script.google.com/macros/s/…/exec"></div>
    <div class="row">
      <button class="primary" id="sReload">💾 Save + Reload Config <span class="kbd">^⌥R</span></button>
      <button id="sCheck">🩺 Check config</button>
      <button id="mClose">Close</button>
    </div>
    <p class="subtle">Empty = built-in defaults (roadmap v0.4 Appendix A). The Sheet overrides defaults tab-by-tab.
    Seed: ${state.seed} · Ledger rows: ${state.ledger.length}</p>
    <div class="row" style="margin-top:10px"><button id="sExport">⬇ Save session to a file</button>
      <button id="sBackups">🛟 Restore points</button>
      <label class="btn-like">⬆ Load session file <input type="file" id="sImport" accept="application/json,.json" style="display:none"></label></div>
    <div id="sMsg2"></div>
    <div class="row" style="margin-top:6px"><button class="danger" id="sWipe">☢ Wipe session (players, board, ledger)</button></div>`);
  $('sExport').onclick = downloadSession;
  $('sBackups').onclick = openBackups;
  $('sImport').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = parseSessionFile(await f.text());
    if (r.error) { $('sMsg2').innerHTML = `<div class="msg" style="border-color:var(--bad)">${esc(r.text)}</div>`; return; }
    if (!confirm(`${r.text}\nReplace the current table with it? (You can undo.)`)) return;
    const m = RC.migrateState(r.state); const fixes = RC.repairState(m.state, config);
    adoptState(m.state, `📂 ${esc(r.text)}${fixes.length ? ` <span class="subtle">(repaired: ${esc(fixes.join('; '))})</span>` : ''}`);
  };
  $('sReload').onclick = async () => {
    setEndpoint($('sEndpoint').value);
    await reloadConfig();
    closeModal();
  };
  $('sCheck').onclick = openConfigCheck;
  $('sWipe').onclick = () => { if (confirm('Wipe the whole session? (A restore point is kept, so it can be brought back from 🛟 Restore points.)')) { try { if (state.players.length) RC.saveBackup(state, 'before wipe'); } catch (_) {} S.clearState(); location.reload(); } };
  $('mClose').onclick = closeModal;
}

async function reloadConfig() {
  const r = await loadConfig();
  config = r.config; cfgSource = r.source; cfgRemote = r.remote || null;
  state.configSource = cfgSource;
  S.channel.postMessage({ type: 'config', config });
  msg(`Config reloaded: <b>${esc(cfgSource)}</b>`, 'wheelMsgs');
  announceConfigHealth();
  sync();
}

// Config doctor: after every load, say so if the Sheet has something the game can't use.
function announceConfigHealth() {
  const s = cfgSummary(validateConfig(config));
  const el = $('cfgHealth');
  if (el) { el.textContent = s.errors ? `⛔ ${s.errors}` : s.warnings ? `⚠️ ${s.warnings}` : '✅'; el.title = s.errors ? `${s.errors} config problem(s) — click to see` : s.warnings ? `${s.warnings} config warning(s) — click to see` : 'Config looks good'; el.className = 'cfg-chip ' + (s.errors ? 'bad' : s.warnings ? 'warn' : 'ok'); }
  if (s.errors) msg(`⛔ The config has <b>${s.errors}</b> problem${s.errors === 1 ? '' : 's'} — open ⚙ Settings → 🩺 Check config before playing.`, 'wheelMsgs');
}
function openConfigCheck() {
  const findings = validateConfig(config), d = sheetDiff(cfgRemote), rt = gameReturns(config);
  const sheetNote = cfgRemote
    ? `<p class="subtle">From the Sheet: ${d.fromSheet.length ? esc(d.fromSheet.join(', ')) : 'nothing'}.<br>Built-in: ${esc(d.fromDefaults.join(', ') || 'nothing')}.</p>
       ${d.dropped.length ? `<details class="cfg-drop"><summary>${d.dropped.length} built-in row${d.dropped.length === 1 ? '' : 's'} not in your Sheet (so not in the game)</summary><p>${d.dropped.map(x => `<span class="tag">${esc(x.tab)} · ${esc(x.key)}</span>`).join(' ')}</p></details>` : ''}`
    : `<p class="subtle">Source: <b>${esc(cfgSource)}</b> — no Sheet is being read, so these are the built-in values.</p>`;
  openModal(`<h2>🩺 Config check</h2>${sheetNote}${cfgReportHtml(findings, esc)}
    <details class="cfg-drop"><summary>Expected return per game (100% = break-even for players)</summary>
    <table class="cfg-table"><tbody>${rt.map(r => `<tr class="${r.rtp > 1.02 || r.rtp < 0.8 ? 'cfg-warn' : ''}"><td>${esc(r.label)}</td><td style="text-align:right"><b>${(r.rtp * 100).toFixed(1)}%</b></td></tr>`).join('')}</tbody></table>
    <p class="subtle">Blackjack depends on how it is played (about 99% with sensible play).</p></details>
    <div class="row" style="margin-top:12px"><button id="cfgBack">← Settings</button><button class="primary" id="mClose">Close</button></div>`);
  $('cfgBack').onclick = openSettings; $('mClose').onclick = closeModal;
}

// ── Icon uploader: file → 64×64 center-cropped JPEG data-URI ─────
// No hosting needed; the icon travels inside game state to every window.
async function fileToIcon(inputEl) {
  const f = inputEl.files && inputEl.files[0];
  if (!f) return '';
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('bad image'));
      i.src = URL.createObjectURL(f);
    });
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const s = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
    URL.revokeObjectURL(img.src);
    return c.toDataURL('image/jpeg', 0.82);
  } catch (e) { toast('⚠️ Could not read that image — player added without an icon.'); return ''; }
}

// ── Modal helpers ────────────────────────────────────────────────
function openModal(html, _opts = {}) { if (state?.shop) state.shop = null; $('modalBody').innerHTML = html; $('modalBack').classList.add('show'); }
function closeModal() { $('modalBack').classList.remove('show'); const dirty = !!(state?.shop || state?.contest); if (state) { state.shop = null; state.contest = null; } if (dirty) sync(); }

// ── Static wiring ────────────────────────────────────────────────
function initStatic() {
  // Multi-window safety: if ANOTHER GM window writes state, adopt its copy
  // instead of clobbering it later with our stale in-memory one; on a reset
  // broadcast, reload fresh. (Fixes ghost players resurrecting after a wipe.)
  S.channel.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.sender === S.TAB_ID) return;
    if (d.type === 'reset') { location.reload(); return; }
    if (d.type === 'state' && d.state) {
      state = d.state;
      rng.setState(state.rngState);
      // Keep this tab's turn UI in step with the adopted state (A9 fix)
      if (state.move && !state.move.done) ui.turnKind = 'move';
      else if (!state.move && ui.turnKind === 'move') ui.turnKind = null;
      renderAll();
    }
  });
  $('btnAddPlayer').onclick = async () => {
    const name = $('npName').value.trim();
    if (!name) return;
    const icon = await fileToIcon($('npIconFile'));
    const p = S.newPlayer('p' + Date.now() + Math.floor(Math.random() * 999), name, icon, 0, config.Config.StartingBank);
    if ($('npSave').checked) { const r = PR.saveProfile({ name, iconUrl: icon }); if (r.profile) { p.profileId = r.profile.id; if (!icon && r.profile.iconUrl) p.iconUrl = r.profile.iconUrl; } }
    state.players.push(p);
    $('npName').value = ''; $('npIconFile').value = '';
    sync();
  };
  $('btnStart').onclick = () => {
    if (state.players.length < 2) { toast('⚠️ Add at least 2 players first.'); return; }
    state.board = E.generateBoard(config, rng);
    const starts = E.startPositions(state);
    state.players.forEach((p, i) => { p.pos = starts[i % starts.length]; });
    state.turnOrder = state.players.map(p => p.id);
    state.turnIdx = 0; state.round = 1; state.phase = 'playing';
    state.banner = ''; state.move = null;
    state.rankSnapshot = rankMap(config, state);
    state.sessionNo = (state.sessionNo || 0) + 1; state.sessionStartedAt = Date.now(); state.lifetime = null;
    PR.touchProfiles(state);
    PT.restAllPets(state);
    state.turnStartedTs = Date.now();
    S.log(state, 'SESSION_START', null, { players: state.players.length });
    sync();
  };
  $('btnReset').onclick = () => { if (confirm('Reset everything? (A restore point is kept under ⚙ Settings → 🛟 Restore points.)')) { try { if (state.players.length) RC.saveBackup(state, 'before reset'); } catch (_) {} S.clearState(); location.reload(); } };
  $('btnOpenPlayerView').onclick = () => window.open('../', 'gwf-player');
  $('btnSettings').onclick = openSettings;
  if ($('cfgHealth')) $('cfgHealth').onclick = openConfigCheck;
  $('themeSel').onchange = () => { state.themeId = $('themeSel').value; sync(); };
  const setSound = () => { state.sound = { on: $('soundOn').checked, volume: Number($('soundVol').value) }; sync(); };
  $('soundOn').onchange = setSound; $('soundVol').onchange = setSound;
  // A ledger row the player view turns into a fanfare — proves audio end to end
  $('btnSoundTest').onclick = () => { S.log(state, 'SOUND_TEST', null, {}); sync(); };
  $('dirpad').querySelectorAll('button[data-dir]').forEach(b => b.addEventListener('click', () => doStep(b.dataset.dir)));
  $('btnGood').onclick = () => doGoodBad('good');
  $('btnBad').onclick = () => doGoodBad('bad');
  $('btnVoid').onclick = doSpinVoid;
  $('btnJailWheel').onclick = () => { const p = cur(); if (p.jailTier > 0) { const { outcome, result } = E.spinJailWheel(config, state, rng, p); msg(`🎡 <b>${esc(outcome.label)}</b> — ${esc(result.text || '')}`, 'wheelMsgs'); sync(); } else openJailPanel(null); };
  $('btnBattle').onclick = () => openBattle(cur()?.id, null);
  $('btnBuyIn').onclick = doBuyIn;
  $('btnShop').onclick = () => openShop(cur()?.id);
  $('btnJailPanel').onclick = () => openJailPanel(cur()?.id);
  $('btnAuction').onclick = () => openAuction(cur()?.id);
  $('btnLoans').onclick = () => openLoans(cur()?.id);
  $('btnPets').onclick = () => openPets(cur()?.id);
  $('btnPetBattle').onclick = () => openPetBattle(cur()?.id);
  $('btnAdjust').onclick = () => {
    const p = byId($('toolPlayer').value); if (!p) return;
    S.credit(state, p, $('toolCurrency').value, Number($('toolAmount').value), 'GM adjustment');
    sync();
  };
  $('btnMoveTo').onclick = () => {
    const p = byId($('toolPlayer').value); if (!p) return;
    ui.pickTile = { cb: (idx) => { p.pos = idx; S.log(state, 'MOVE', p.id, { gmMoveTo: idx }); sync(); } };
    $('pickHint').textContent = `← click a tile for ${p.name}`;
  };
  $('btnJailSend').onclick = () => { const p = byId($('toolPlayer').value); if (p) { E.sendToJail(config, state, p, 'GM'); sync(); } };
  $('btnJailFree').onclick = () => { const p = byId($('toolPlayer').value); if (p) { E.releaseFromJail(config, state, p, 'GM'); sync(); } };
  $('btnSkipTurnTool').onclick = () => { const p = byId($('toolPlayer').value); if (p) { p.skipTurns += 1; sync(); } };
  $('btnForceMethod').onclick = doForceMethod;
  $('btnForceOutcome').onclick = doForceOutcome;
  $('foWheel').addEventListener('change', () => renderTools());
  $('btnTransfer').onclick = () => {
    const r = E.transfer(config, state, byId($('trFrom').value), byId($('trTo').value), $('trCurrency').value, $('trAmount').value);
    msg(`${r.error ? '⚠️' : '💸'} ${esc(r.text)}`, 'wheelMsgs');
    if (!r.error) $('trAmount').value = '';
    sync();
  };
  $('btnGameAny').onclick = () => { const p = byId($('toolPlayer').value) || cur(); if (p) GG.openPanel(p, null); };
  $('btnForceSwap').onclick = () => {
    const a = byId($('fsA').value), b = byId($('fsB').value);
    if (!a || !b || a.id === b.id) { toast('⚠️ Pick two different players.'); return; }
    const traded = swapPlayers(a, b);
    S.log(state, 'MOVE', a.id, { forcedSwapWith: b.id, forced: true });
    msg(`⚙️ <b>Forced swap:</b> ${esc(a.name)} ⇄ ${esc(b.name)}${traded ? ' — jail sentence traded too' : ''}`, 'wheelMsgs');
    sync();
  };
  $('btnAddMid').onclick = async () => {
    const name = $('mpName').value.trim();
    if (!name) return;
    if (state.phase !== 'playing') { toast('⚠️ No session running — use Session Setup instead.'); return; }
    const icon = await fileToIcon($('mpIconFile'));
    const p = S.newPlayer('p' + Date.now() + Math.floor(Math.random() * 999), name, icon, (E.startPositions(state)[0] ?? 0), config.Config.StartingBank);
    { const r = PR.saveProfile({ name, iconUrl: icon }); if (r.profile) { p.profileId = r.profile.id; if (!icon && r.profile.iconUrl) p.iconUrl = r.profile.iconUrl; PR.touchProfiles({ players: [p] }); } }
    state.players.push(p);
    state.turnOrder.push(p.id);
    S.log(state, 'PLAYER_JOIN', p.id, { midSession: true });
    msg(`➕ <b>${name}</b> joins on the START tile with ${config.Config.StartingBank} Gold. They act at the end of the turn order.`, 'wheelMsgs');
    $('mpName').value = ''; $('mpIconFile').value = '';
    sync();
  };
  $('btnEndSession').onclick = () => {
    if (!confirm('End the session? Final standings stay on the player view. Players and balances are kept — Start Session begins a new round with them.')) return;
    state.phase = 'ended';
    state.move = null;
    state.banner = '🏁 FINAL STANDINGS';
    ui.turnKind = null; ui.resolvedAction = null;
    hideGamePanel();
    S.log(state, 'SESSION_END', null, { round: state.round });
    // Archive to the Hall of Fame and show the all-time table under the recap
    PT.accruePower(config, state); PR.stashProgress(state);      // pets + Power carry over on saved profiles
    const arch = HI.archiveSession(config, state);
    state.lifetime = HI.hallOfFame(HI.loadHistory(), PR.profileKeyMap(PR.loadProfiles())).slice(0, 10).map(r => ({ name: r.name, sessions: r.sessions, titles: r.titles, totalNet: r.totalNet, bestStreak: r.bestStreak }));
    msg(`🏆 ${esc(arch.text)}`, 'wheelMsgs');
    sync();
  };
  $('btnBanner').onclick = () => { state.banner = $('bannerText').value; sync(); };
  $('btnStake').onclick = () => {
    const ids = [$('stakeA').value, $('stakeB').value].filter(Boolean);
    const r = ST.addStake(state, { text: $('stakeText').value, playerIds: ids });
    if (r.error) { msg(`⚠️ ${esc(r.text)}`, 'wheelMsgs'); return; }
    $('stakeText').value = ''; sync();
  };
  $('modalBack').addEventListener('click', (e) => { if (e.target === $('modalBack')) closeModal(); });

  // Hotkeys — one registry (hotkeys.js) feeds this handler, the help overlay and the printable card
  const conflicts = hotkeyConflicts(); if (conflicts.length) console.warn('Hotkey conflicts:', conflicts);
  document.addEventListener('keydown', (e) => {
    const h = matchHotkey(e); if (!h) return;
    const fn = hotkeyActions()[h.tier ? (h.loud ? 'chaosLoud' : 'chaosSilent') : h.id];
    if (!fn) return;
    if (fn(h) !== false) e.preventDefault();
  });
  $('btnHotkeys').onclick = openHotkeyHelp;
  $('btnHistory').onclick = () => openHistory();
  $('btnUndo').onclick = doUndo;
  $('btnTurnTools').onclick = () => openTurnTools();
  $('btnLedger').onclick = () => openLedger();
  $('btnRoster').onclick = () => openRoster();
  $('textScaleSel').onchange = () => { state.display = { ...(state.display || {}), textScale: Number($('textScaleSel').value) }; sync(); };
  $('contrastOn').onchange = () => { state.display = { ...(state.display || {}), contrast: $('contrastOn').checked }; sync(); };
}

// What each hotkey does. Returning false = "not applicable right now" (the key is left alone).
function hotkeyActions() {
  const playing = state.phase === 'playing';
  const clickTurn = (match) => { const b = [...$('turnActions').querySelectorAll('button')].find(match); if (!b) return false; b.click(); };
  const step = (dir) => { const mv = state.move; if (!playing || !mv || mv.done || mv.pendingVoid || mv.needsTarget || $('modalBack').classList.contains('show')) return false; doStep(dir); };
  const need = (fn) => (h) => (playing ? fn(h) : false);
  return {
    primary: need(() => clickTurn(b => b.classList.contains('primary') || b.classList.contains('danger'))),
    beginTurn: need(() => clickTurn(b => /Begin Turn/.test(b.textContent))),
    endTurn: need(() => clickTurn(b => /End Turn/.test(b.textContent))),
    spinMethod: need(() => clickTurn(b => /Spin Method/.test(b.textContent))),
    resolveTile: need(() => clickTurn(b => /Resolve Tile/.test(b.textContent))),
    stepN: () => step('N'), stepS: () => step('S'), stepW: () => step('W'), stepE: () => step('E'),
    good: need(() => doGoodBad('good')), bad: need(() => doGoodBad('bad')), void: need(() => doSpinVoid()),
    battle: need(() => openBattle(cur()?.id, null)), buyIn: need(() => doBuyIn()),
    jail: need(() => openJailPanel(cur()?.id)), shop: need(() => openShop(cur()?.id)), loans: need(() => openLoans(cur()?.id)), pets: need(() => openPets(cur()?.id)), petBattle: need(() => openPetBattle(cur()?.id)),
    game: need(() => { const p = byId($('toolPlayer').value) || cur(); if (p) GG.openPanel(p, null); }),
    chaosLoud: need((h) => GG.doChaos(h.tier, true)), chaosSilent: need((h) => GG.doChaos(h.tier, false)),
    chaosUndo: need(() => GG.undoChaos()),
    reloadConfig: () => { reloadConfig(); },
    playerView: () => { window.open('../', 'gwf-player'); },
    mute: () => { const snd = { ...DEFAULT_SOUND, ...(state.sound || {}) }; state.sound = { ...snd, on: !snd.on }; msg(snd.on ? '🔇 Sound muted' : '🔊 Sound on', 'wheelMsgs'); sync(); },
    help: () => { openHotkeyHelp(); },
    undo: () => { doUndo(); },
    closeModal: () => { if (!$('modalBack').classList.contains('show')) return false; closeModal(); },
  };
}

function openHotkeyHelp() {
  openModal(`<h2>⌨ GM Hotkeys</h2><div class="hk-help">${cardHtml(isMac(), esc)}</div>
    <div class="row" style="margin-top:10px"><a class="btn-link" href="hotkeys.html" target="gwf-hotkeys">🖨 Printable card ↗</a><button class="primary" id="mClose">Close</button></div>`);
  $('mClose').onclick = closeModal;
}

boot();
