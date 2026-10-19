// Player view (/) — pure renderer. The GM window owns all state.
import { loadConfig } from './config.js';
import { loadState, channel, currentPlayer } from './state.js';
import { renderBoard, renderLeaderboard } from './render.js';
import { showWheelSpin, showSplash, esc } from './wheel-ui.js';
import { renderGameStage, renderRecap } from './game-ui.js';
import { gameNeedsTicks } from './games.js';
import { openStakes, stakeLine } from './stakes.js';
import { SoundPlayer, cuesFor, packFor, DEFAULT_SOUND, renderCue } from './sound.js';
import { timerView } from './turns.js';

let config = null;
let state = null;
let lastSpinTs = 0;
let shownSaveAt = null; // savedAt of the state that carried the wheel we're showing
let lastChaosTs = 0;
let liveTimer = null;   // re-renders the game stage while a game is in motion

const $ = (id) => document.getElementById(id);

// ── Sound (shared screen only). Browsers need one click in this window before audio plays.
const sound = new SoundPlayer();
function soundSettings() { return { ...DEFAULT_SOUND, ...(state?.sound || {}) }; }
function renderSoundChip() {
  const chip = $('soundChip'); if (!chip) return;
  const s = soundSettings();
  chip.style.display = sound.supported ? '' : 'none';
  chip.textContent = !s.on ? '🔇 Sound off (GM)' : sound.unlocked ? `🔊 ${packFor(state?.themeId, config).name}` : '🔈 Click anywhere to turn sound on';
  chip.classList.toggle('needs-click', s.on && !sound.unlocked);
}
function hear(prev, next) {
  if (!prev || !next || !sound.unlocked) return;
  sound.schedule(cuesFor(prev, next), packFor(next.themeId, config), soundSettings());
}
document.addEventListener('click', async () => { if (!sound.unlocked) { await sound.unlock(); renderSoundChip(); } }, true);

async function boot() {
  ({ config } = await loadConfig());
  state = loadState();
  // Never replay a spin that happened before this page loaded — only animate
  // spins that arrive live. (Fixes the "wheel always lands on the same old
  // outcome after refresh" replay bug.)
  if (state?.lastSpin?.ts) lastSpinTs = state.lastSpin.ts;
  if (state?.chaosFlash?.ts) lastChaosTs = state.chaosFlash.ts;
  render();
}

// The shared screen must never die on one bad frame: draw what we can, say so quietly, try again next update.
function render() {
  try { renderInner(); const e = document.getElementById('gwf-view-error'); if (e) e.remove(); }
  catch (err) {
    console.error('GWF view error:', err);
    let e = document.getElementById('gwf-view-error');
    if (!e) { e = document.createElement('div'); e.id = 'gwf-view-error'; e.className = 'view-error'; document.body.appendChild(e); }
    e.textContent = '⚠️ Display hiccup — waiting for the GM’s next move…';
  }
}
function renderInner() {
  if (!state) { $('banner').textContent = 'Waiting for the GM…'; return; }
  document.documentElement.dataset.theme = state.themeId || 'noir';
  // Readability: GM-controlled text size + high-contrast mode for the shared screen
  document.body.style.setProperty('--text-scale', String(state.display?.textScale || 1));
  document.body.classList.toggle('hc', !!state.display?.contrast);
  renderSoundChip();
  renderTurnTimer();
  const cur = currentPlayer(state);
  $('banner').textContent = state.banner ||
    (state.phase === 'setup' ? 'GAMBLING WITH FRIENDS' :
      cur ? `${cur.name}'s turn — Round ${state.round}${cur.jailTier ? ` (JAIL ${cur.jailTier})` : ''}` : 'GAMBLING WITH FRIENDS');
  renderBoard($('board'), config, state);
  renderLeaderboard($('leaderboard'), config, state);
  // Open IRL stakes stay visible so nobody "forgets" what they agreed to
  const open = openStakes(state);
  $('stakesPanel').style.display = open.length ? '' : 'none';
  $('stakesList').innerHTML = open.map(s => `<div class="stake-row"><span class="stake-text">🤝 ${esc(stakeLine(state, s))}</span></div>`).join('');
  // Session recap replaces the board once the GM ends the session
  const ended = state.phase === 'ended';
  $('recap').style.display = ended ? '' : 'none';
  $('board').style.visibility = ended ? 'hidden' : '';
  if (ended) renderRecap($('recap'), config, state);
  // Live minigame stage (Crash keeps re-rendering on a timer while running)
  renderGameStage($('gameStage'), config, state);
  // Anything in motion (Crash climbing, cards being dealt, a Plinko ball) ticks until it settles
  const live = () => gameNeedsTicks(state.game, Date.now());
  if (live() && !liveTimer) liveTimer = setInterval(() => {
    renderGameStage($('gameStage'), config, state);
    if (!live()) { clearInterval(liveTimer); liveTimer = null; }
  }, 50);
  if (!live() && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  // Loud Chaos → full-screen splash (silent shuffles pass without a word)
  if (state.chaosFlash && state.chaosFlash.ts > lastChaosTs) {
    lastChaosTs = state.chaosFlash.ts;
    shownSaveAt = state.savedAt || Date.now();
    showSplash($('wheelOverlay'), state.chaosFlash.tier ? `☠️ CHAOS T${state.chaosFlash.tier} — ${state.chaosFlash.label}` : `↩️ ${state.chaosFlash.label}`, state.chaosFlash.desc);
    return;
  }
  $('log').innerHTML = state.ledger.slice(-14).reverse()
    .map(r => `<div><span class="hl">${esc(r.type)}</span> ${esc(shortRow(r))}</div>`).join('');
  // Animate a spin the GM just made. The wheel then STAYS up until the GM's
  // next action arrives. Every save reaches this window TWICE (BroadcastChannel
  // + the storage event), so "next action" means a state with a NEWER savedAt
  // than the one that carried the spin — not merely a re-render.
  if (state.lastSpin && state.lastSpin.ts > lastSpinTs) {
    lastSpinTs = state.lastSpin.ts;
    shownSaveAt = state.savedAt || Date.now();
    showWheelSpin($('wheelOverlay'), state.lastSpin);
  } else if (shownSaveAt && state.savedAt && state.savedAt > shownSaveAt) {
    $('wheelOverlay').classList.remove('show');
    shownSaveAt = null;
  }
}

// Shot clock: a thin bar under the banner, refreshed twice a second while it is running.
let timerTick = null, timeUpFor = null;
function renderTurnTimer() {
  const v = state ? timerView(state) : null; const box = $('turnTimer');
  if (!v) { box.style.display = 'none'; if (timerTick) { clearInterval(timerTick); timerTick = null; } return; }
  box.style.display = ''; box.classList.toggle('over', v.over); box.classList.toggle('low', !v.over && v.left <= 10);
  $('turnTimerFill').style.width = v.pct + '%'; $('turnTimerText').textContent = v.text;
  if (v.over && timeUpFor !== state.turnStartedTs) { timeUpFor = state.turnStartedTs; if (sound.unlocked && soundSettings().on) sound.playNotes(renderCue('jail', packFor(state.themeId, config)), soundSettings().volume); }
  if (!timerTick) timerTick = setInterval(renderTurnTimer, 500);
}

function shortRow(r) {
  const p = state.players.find(pl => pl.id === r.playerId);
  const bits = [p ? p.name : '', r.outcome || '', r.wheel || '', r.why || '',
    r.cur ? `${r.amount > 0 ? '+' : ''}${r.amount} ${r.cur}` : ''].filter(Boolean);
  return bits.join(' · ');
}

channel.addEventListener('message', (e) => {
  if (e.data?.type === 'state') { const prev = state; state = e.data.state; hear(prev, state); render(); }
  if (e.data?.type === 'config') { config = e.data.config; render(); }
  if (e.data?.type === 'reset') { location.reload(); }
});
window.addEventListener('storage', () => { const prev = state; state = loadState(); hear(prev, state); render(); });

boot();
