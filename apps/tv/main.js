// The shared screen. Opens a room as role 'tv' (it writes snapshots and owns the deadline events), shows the
// join QR all night, the lobby, then the map and the rail. Screens for play live in ./screens/*.js; this file
// is the frame, the clock watcher and the deadline appender.
import QRCode from 'qrcode';
import { h, render, $, qs, store, toast, ticker, lenient } from '../../packages/ui/dom.js';
import { boot, attach } from '../../packages/ui/client.js';
import { currentPlayerId, characterOf } from '../../packages/shared/state.js';
import { remainingMs } from '../../packages/shared/clock.js';
import { B } from '../../packages/shared/balance.js';
import { renderLobby } from './screens/lobby.js';
import { renderPlay } from './screens/play.js';
import { renderEnded } from './screens/ended.js';

const app = $('#app');
const joinUrl = (code) => `${location.origin}/phone/?code=${code}`;

async function main() {
  const { backend } = await boot();
  let code = (qs('code') || store.get('gwfrpg:tv:code') || '').toUpperCase();
  if (!code) return render(app, startScreen(backend));
  try { await open(backend, code); } catch (e) { console.error(e); toast(e.message, 'bad'); render(app, startScreen(backend, e.message)); }
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
      error ? h('p', { class: 'log error' }, error) : null));
}

async function open(backend, code) {
  const { session } = await attach({ backend, code, role: 'tv', view, presence: { role: 'tv' } });
  store.set('gwfrpg:tv:code', code);
  window.__gwf = { session };   // for the browser tests
  // Deadline watcher: the TV is the client that notices the clock at zero and silent phones.
  let lastProxyCheck = 0;
  ticker((now) => {
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
      if (p && !p.proxied && !p.autopilot && seen && now - seen > B.table.proxyAfterSeconds * 1000) session.dispatch('GM_PROXY', { playerId: pid, on: true, reason: 'silent' }, 'system').catch(() => {});
    }
    for (const [, el] of Object.entries(clockEls)) el.update?.(now);
  });
}

const clockEls = {};
function view(state, session) {
  const code = state.code;
  const frame = h('div', { class: 'tv-shell' },
    h('header', { class: 'tv-head' },
      h('h1', {}, 'Gambling With Friends'), h('span', { class: 'ital muted' }, 'The House is a dead god. Every table is its altar.'),
      h('span', { class: 'tag' }, `${modeName(state.mode)} · Tier ${roman(state.tier)} · ${state.phase === 'playing' ? `Turn ${state.turnIdx + 1}` : state.phase} · ROOM ${code}`)),
    h('main', { class: 'tv-main', id: 'tvMain' }),
    h('footer', { class: 'tv-foot' }, h('div', { class: 'ticker', id: 'ticker' }), h('div', { class: 'tv-log', id: 'tvLog' })));
  render(app, frame);
  const main = $('#tvMain', frame);
  const rail = lenient(h('aside', { class: 'tv-rail' }));
  const stage = lenient(h('section', { class: 'tv-map', id: 'tvStage' }));
  main.append(stage, rail);
  if (state.phase === 'lobby' || state.phase === 'creation') renderLobby({ state, session, stage, rail });
  else if (state.phase === 'playing') renderPlay({ state, session, stage, rail, clockEls });
  else renderEnded({ state, session, stage, rail });
  rail.append(joinPanel(code));
  // ticker + log
  const t = $('#ticker', frame);
  for (const pid of state.seats) { const p = state.players[pid]; if (!p || p.kicked) continue; const c = characterOf(state, pid); t.append(h('span', {}, h('span', { class: 'tick-name' }, p.name), h('span', { class: 'tick-sub' }, c ? `${className(c.classId)} · Lv ${c.level}${c.pets?.length ? ` · ${c.pets.length} pet${c.pets.length === 1 ? '' : 's'}` : ''}` : (p.ready ? 'ready' : 'joined')))); }
  const last = state.log.at(-1); $('#tvLog', frame).textContent = last ? last.text : '';
  if (state.banner) stage.append(h('div', { class: 'big-banner' }, state.banner));
}

function joinPanel(code) {
  const canvas = h('canvas', { 'aria-label': 'Join QR code' });
  QRCode.toCanvas(canvas, joinUrl(code), { margin: 1, width: 220, color: { dark: '#0d0a0b', light: '#e9e1cf' } }).catch(() => {});
  return h('div', { class: 'panel gold join' }, canvas, h('div', {}, h('h3', {}, 'Join the table'), h('div', { class: 'code' }, code), h('p', { class: 'muted' }, 'Scan or type the code at ', h('b', {}, `${location.host}/phone`), '. Spectators may wager.')));
}

export const modeName = (m) => ({ ffa: 'Free-for-all', pvp: 'PvP only', pve: 'PvE only', teams: 'Teams', royale: 'Royale' }[m] || m);
export const className = (id) => ({ whale: 'Whale', pitboss: 'Pit Boss', cutpurse: 'Cutpurse', enforcer: 'Enforcer', beastmaster: 'Beastmaster', croupier: 'Croupier' }[id] || id || '—');
export const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V'][n] || n;

main();
