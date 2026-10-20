// The shared screen. Opens a room as role 'tv' (it writes snapshots and owns the deadline events), shows the
// join QR all night, the lobby, then the map and the rail, then the recap. Screens live in ./screens/*.js; this
// file is the frame, the clock watcher, the sound hook and the autopilot wiring (packages/ui/autopilot.js runs
// the table duties and every seat on autopilot from here).
//
// URL flags: ?code=XXXX (the room) · ?backend=local|ws|supabase · ?bots=N (seat N demo bots; creates a room when
// there is no code) · ?autostart=1 (open creation and start the run once the bots lock in) · ?mode=ffa|pvp|pve|teams|royale
import QRCode from 'qrcode';
import { h, render, $, qs, store, toast, ticker, lenient } from '../../packages/ui/dom.js';
import { boot, attach } from '../../packages/ui/client.js';
import { currentPlayerId, characterOf } from '../../packages/shared/state.js';
import { remainingMs } from '../../packages/shared/clock.js';
import { B } from '../../packages/shared/balance.js';
import { roomCode, seed32, hashPin } from '../../packages/shared/ids.js';
import { healthThird } from '../../packages/shared/health.js';
import { group } from '../../packages/shared/balance.js';
import { SoundPlayer, cuesFor, DEFAULT_SOUND } from '../../packages/ui/sound.js';
import { loadManifest } from '../../packages/ui/sprite.js';
import { startAutopilot, seatBots } from '../../packages/ui/autopilot.js';
import { className } from '../../packages/ui/recap.js';
import { renderLobby } from './screens/lobby.js';
import { renderPlay, visibleLog } from './screens/play.js';
import { renderEnded } from './screens/ended.js';

const app = $('#app');
const joinUrl = (code) => `${location.origin}/phone/?code=${code}`;
const SOUND_KEY = 'gwfrpg:tv:sound';
const sound = { settings: { ...DEFAULT_SOUND, ...(store.get(SOUND_KEY, {}) || {}) }, player: null, prev: null, music: store.get('gwfrpg:tv:music', false) };

async function main() {
  const { backend } = await boot();
  const manifest = await loadManifest().catch(() => null);
  // Sound files live under assets/ (Vite's publicDir), served without the prefix; the player gets a re-based copy.
  const soundManifest = manifest?.sound ? { sound: Object.fromEntries(Object.entries(manifest.sound).map(([k, v]) => [k, { ...v, path: String(v.path || '').replace(/^assets\//, '') }])) } : null;
  sound.player = new SoundPlayer({ manifest: soundManifest, base: '/' });
  document.addEventListener('pointerdown', () => { if (sound.settings.on !== false) sound.player.unlock().then(() => refreshSoundButton()); }, { capture: true });
  let code = (qs('code') || '').toUpperCase();
  const bots = Math.max(0, Math.min(8, Number(qs('bots')) || 0));
  if (!code && !bots) code = (store.get('gwfrpg:tv:code') || '').toUpperCase();
  if (!code && !bots) return render(app, startScreen(backend));
  try {
    if (!code && bots) await createDemoRoom(backend, bots);
    else await open(backend, code, { bots });
  } catch (e) { console.error(e); toast(e.message, 'bad'); render(app, startScreen(backend, e.message)); }
}

function startScreen(backend, error = '') {
  const input = h('input', { class: 'code', maxlength: 4, placeholder: 'CODE', autofocus: true, 'aria-label': 'Room code' });
  const go = async () => { const c = input.value.trim().toUpperCase(); if (c.length !== 4) return toast('Four letters', 'bad'); location.search = `?code=${c}`; };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'boot' },
    h('h1', {}, 'Gambling With Friends'), h('p', { class: 'ital muted' }, 'The House is a dead god. Every table is its altar.'),
    h('div', { class: 'panel gold col', style: { minWidth: '420px' } },
      h('h3', {}, 'Open a table on this screen'), input, h('button', { class: 'primary big', onClick: go }, 'Show the table'),
      h('p', { class: 'muted' }, 'The GM creates the room from the console at ', h('a', { href: '/gm/' }, '/gm'), '. Backend down? ', h('a', { href: '/classic/' }, 'Run classic mode'), '.'),
      h('p', { class: 'muted small' }, 'Demo: ', h('a', { href: '?backend=local&bots=4&autostart=1' }, 'a table of four bots'), ' plays itself on this screen.'),
      error ? h('p', { class: 'log error' }, error) : null));
}

// ?bots=N with no code: the TV makes the room itself (PIN 1234, remembered for /gm on this browser) and seats the bots.
async function createDemoRoom(backend, bots) {
  const code = roomCode(), pinHash = await hashPin('1234');
  const mode = ['ffa', 'pvp', 'pve', 'teams', 'royale'].includes(qs('mode')) ? qs('mode') : 'ffa';
  const create = { code, seed: seed32(), mode, tier: Number(qs('tier')) || 1, size: ['short', 'regular', 'long'].includes(qs('size')) ? qs('size') : 'regular', gmPinHash: pinHash, fogOfWar: qs('fog') !== '0', gmDeviceId: backend.identity().deviceId };
  store.set(`gwfrpg:gm:pin:${code}`, pinHash);
  const q = new URLSearchParams(location.search); q.set('code', code); history.replaceState(null, '', `?${q.toString()}`);
  await open(backend, code, { bots, create });
}

let session = null, autopilot = null, rerenderSoon = null;
async function open(backend, code, { bots = 0, create = null } = {}) {
  ({ session } = await attach({ backend, code, role: 'tv', view: onView, presence: { role: 'tv' }, create }));
  store.set('gwfrpg:tv:code', code);
  window.__gwf = { session, sound };   // for the browser tests
  // The TV is the table's hands: table duties every second and on every event; seats on autopilot or on bots.
  const botSeats = new Set();
  autopilot = startAutopilot(session, { botSeats, autostart: qs('autostart') === '1' });
  window.__gwf.autopilot = autopilot;
  if (bots) { try { const ids = await seatBots(session, bots); for (const id of ids) botSeats.add(id); } catch (e) { console.error(e); toast(`bots: ${e.message}`, 'bad'); } }
  // Deadline watcher: the TV is the client that notices the clock at zero and silent phones.
  let lastProxyCheck = 0;
  ticker((now) => {
    for (const el of Object.values(clockEls)) el?.update?.(now);
    const st = session.state; if (!st || st.phase !== 'playing' || st.gm.paused) return;
    const pid = currentPlayerId(st); if (!pid) return;
    const c = st.clocks[pid];
    if (c?.runningSince != null && remainingMs(st, pid, now) <= 0 && !session.__timeoutPending) {
      session.__timeoutPending = true;
      session.dispatch('TURN_TIMEOUT', {}, 'system').catch(() => {}).finally(() => setTimeout(() => { session.__timeoutPending = false; }, 1500));
    }
    if (now - lastProxyCheck > 3000) {
      lastProxyCheck = now;
      const p = st.players[pid];
      const seen = Math.max(session.presence[pid] || 0, p?.lastSeenTs || 0);
      if (p && !p.proxied && !p.autopilot && !botSeats.has(pid) && seen && now - seen > B.table.proxyAfterSeconds * 1000) session.dispatch('GM_PROXY', { playerId: pid, on: true, reason: 'silent' }, 'system').catch(() => {});
    }
  });
}

// Every event re-renders; the sound hook diffs the previous state against the new one.
function onView(state, sess, ev) {
  const now = Date.now();
  if (sound.prev && sound.prev !== state) {
    try { const cues = cuesFor(sound.prev, state, now); if (cues.length && sound.settings.on !== false) sound.player?.schedule(cues, sound.settings, now); } catch (e) { console.warn('sound', e); }
    maybeMusic(state);
  }
  sound.prev = state;
  view(state, sess, now);
}
const rerender = () => { if (rerenderSoon) return; rerenderSoon = setTimeout(() => { rerenderSoon = null; if (session?.state) view(session.state, session, Date.now()); }, 30); };

const clockEls = {};
function view(state, sess, now = Date.now()) {
  const code = state.code;
  const frame = h('div', { class: 'tv-shell' },
    h('header', { class: 'tv-head' },
      h('h1', {}, 'Gambling With Friends'), h('span', { class: 'ital muted tagline' }, 'The House is a dead god. Every table is its altar.'),
      h('span', { class: 'tag' }, `${modeName(state.mode)} · Tier ${roman(state.tier)} · ${state.phase === 'playing' ? `Turn ${state.turnIdx + 1}` : state.phase} · ROOM ${code}`),
      soundButton()),
    h('main', { class: 'tv-main', id: 'tvMain' }),
    h('footer', { class: 'tv-foot' }, h('div', { class: 'ticker', id: 'ticker' }), h('div', { class: 'tv-log', id: 'tvLog' })));
  render(app, frame);
  const main = $('#tvMain', frame);
  const rail = lenient(h('aside', { class: 'tv-rail' }));
  const stage = lenient(h('section', { class: `tv-map phase-${state.phase}`, id: 'tvStage' }));
  main.append(stage, rail);
  const args = { state, session: sess, stage, rail, clockEls, rerender, now };
  if (state.phase === 'lobby' || state.phase === 'creation') renderLobby(args);
  else if (state.phase === 'playing') renderPlay(args);
  else renderEnded(args);
  rail.append(joinPanel(code));
  // Standings ticker (name, lantern tell, class · level · pets) and the last log line.
  const t = $('#ticker', frame), H = group(state, 'health');
  for (const pid of state.seats) {
    const p = state.players[pid]; if (!p || p.kicked) continue; const c = characterOf(state, pid);
    const third = c ? healthThird(c, H) : null;
    t.append(h('span', { class: `tick${pid === currentPlayerId(state) && state.phase === 'playing' ? ' up' : ''}` }, h('span', { class: 'tick-name' }, c?.name || p.name), third ? h('span', { class: `tick-lamp ${third}`, title: 'lantern' }, third === 'high' ? '●' : third === 'mid' ? '◐' : third === 'low' ? '○' : '✝') : null, h('span', { class: 'tick-sub' }, c ? `${className(c.classId)} · Lv ${c.level}${c.pets?.length ? ` · ${c.pets.length} pet${c.pets.length === 1 ? '' : 's'}` : ''}${c.gold ? ` · ${c.gold}g` : ''}` : (p.ready ? 'ready' : 'joined'))));
  }
  const last = visibleLog(state, now).at(-1); $('#tvLog', frame).textContent = last ? last.text : '';
  if (state.banner) stage.append(h('div', { class: 'big-banner' }, state.banner));
}

function joinPanel(code) {
  const canvas = h('canvas', { 'aria-label': 'Join QR code' });
  // qrcode writes an inline size on the canvas; the stylesheet's vw size must win so the rail fits a laptop.
  QRCode.toCanvas(canvas, joinUrl(code), { margin: 1, width: 220, color: { dark: '#0d0a0b', light: '#e9e1cf' } }).then(() => { canvas.style.width = ''; canvas.style.height = ''; }).catch(() => {});
  return h('div', { class: 'panel gold join' }, canvas, h('div', {}, h('h3', {}, 'Join the table'), h('div', { class: 'code' }, code), h('p', { class: 'muted' }, 'Scan or type the code at ', h('b', {}, `${location.host}/phone`), '. Spectators may wager.')));
}

// ── sound ──
let soundBtn = null;
function soundButton() {
  soundBtn = h('button', { class: 'ghost sound-btn', title: 'Sound (music off by default; shift-click toggles music)', onClick: (e) => {
    if (e.shiftKey) { sound.music = !sound.music; store.set('gwfrpg:tv:music', sound.music); if (!sound.music) sound.player.stopMusic(); else maybeMusic(session?.state, true); toast(sound.music ? 'Music on (when real tracks exist)' : 'Music off'); refreshSoundButton(); return; }
    sound.settings.on = sound.settings.on === false; store.set(SOUND_KEY, sound.settings);
    if (sound.settings.on) sound.player.unlock().then(() => { sound.player.play('ui_tap_2', sound.settings); refreshSoundButton(); }); else { sound.player.cancelPending(); sound.player.stopMusic(); }
    refreshSoundButton();
  } });
  refreshSoundButton();
  return soundBtn;
}
function refreshSoundButton() {
  if (!soundBtn) return;
  const on = sound.settings.on !== false, unlocked = sound.player?.unlocked;
  soundBtn.textContent = !on ? '🔇 muted' : unlocked ? (sound.music ? '🔊 sound · ♪' : '🔊 sound') : '🔈 tap for sound';
  soundBtn.classList.toggle('muted', !on);
}
let musicKey = null;
function maybeMusic(state, force = false) {
  if (!sound.music || !sound.player || !state) return;
  const key = state.phase === 'ended' ? 'music_recap' : state.phase === 'playing' ? (state.fight && !state.fight.done ? (state.fight.kind === 'boss' || state.fight.kind === 'raid' ? 'music_boss' : 'music_fight') : `music_${characterOf(state, currentPlayerId(state))?.region || 'strip'}`) : 'music_lobby';
  if (key === musicKey && !force) return;
  musicKey = key; sound.player.playMusic(key, sound.settings).catch(() => {});
}

export const modeName = (m) => ({ ffa: 'Free-for-all', pvp: 'PvP only', pve: 'PvE only', teams: 'Teams', royale: 'Royale' }[m] || m);
export const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V'][n] || n;
export { className };

main();
