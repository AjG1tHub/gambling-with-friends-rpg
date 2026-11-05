// The player's phone. Join by code (from the QR or typed), keep a seat across reloads, then show the six tabs:
// Play (the current prompt), Cage (paper doll + grid), Self (stats, Mirror, claim code), Pets, Map, Letters.
// This file is the frame and the join flow; tab screens live in ./screens/*.js.
import { h, render, $, qs, toast, buzz, store, fmtTime, ticker, lenient } from '../../packages/ui/dom.js';
import { boot, attach, rememberSeat, recallSeat, dispatchOrToast } from '../../packages/ui/client.js';
import { ensureRoster } from '../../packages/ui/roster.js';
import { readSet } from '../../packages/ui/letters.js';
import { shortId } from '../../packages/shared/ids.js';
import { currentPlayerId, characterOf } from '../../packages/shared/state.js';
import { shouldReclaimSeat } from '../../packages/shared/handlers/lobby.js';
import { remainingMs } from '../../packages/shared/clock.js';
import { tabPlay } from './screens/play.js';
import { tabCage } from './screens/cage.js';
import { tabSelf } from './screens/self.js';
import { tabPets } from './screens/pets.js';
import { tabMap } from './screens/map.js';
import { tabLetters } from './screens/letters.js';
import { bugButton, bugSheet, rewardOverlay } from './feedback.js';
import { coachCard, isRuleBroadcast } from './coach.js';
import { helpButton, helpSheet } from './help.js';
import { startPractice } from './practice.js';

const app = $('#app');
const TABS = [['play', 'Play', tabPlay], ['cage', 'Cage', tabCage], ['self', 'Self', tabSelf], ['pets', 'Pets', tabPets], ['map', 'Map', tabMap], ['letters', 'Letters', tabLetters]];
const ctx = { backend: null, session: null, me: null, tab: 'play', deviceId: null, code: null, owner: null, lastTurnPid: null };

async function main() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/phone/sw.js').catch(() => {});
  // Learn to play: a solo practice run on the local backend (practice.js owns the room; no TV, GM or network).
  if (qs('practice') === '1') { try { return await startPractice({ ctx, view, app }); } catch (e) { console.error(e); return render(app, joinScreen(`Practice could not start: ${e.message}`)); } }
  const { backend, identity } = await boot();
  ctx.backend = backend; ctx.deviceId = identity.deviceId;
  const code = (qs('code') || '').toUpperCase();
  // GM proxy mode: /phone/?code=X&as=<playerId>&gm=1 — the console acts for a seat; refused without gm=1.
  if (qs('as')) { if (qs('gm') !== '1') return render(app, h('div', { class: 'boot' }, h('h1', {}, 'Not allowed'), h('p', { class: 'muted' }, 'Acting for another seat needs the GM console (gm=1).'))); ctx.proxyFor = qs('as'); }
  if (code.length === 4) return join(code);
  render(app, joinScreen());
}

function joinScreen(error = '') {
  const input = h('input', { class: 'code', maxlength: 4, placeholder: 'CODE', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Room code' });
  const go = () => { const c = input.value.trim().toUpperCase(); if (c.length !== 4) return toast('The code is four letters', 'bad'); history.replaceState(null, '', `?code=${c}`); join(c); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const last = store.get('gwfrpg:phone:last');
  return h('div', { class: 'boot' }, h('h1', {}, 'Gambling With Friends'), h('p', { class: 'ital muted' }, 'Your character lives on your phone.'),
    h('div', { class: 'panel gold col', style: { width: '100%', maxWidth: '380px' } }, h('h3', {}, 'Join the table'), input, h('button', { class: 'primary big', onClick: go }, 'Join'),
      last ? h('button', { class: 'ghost', onClick: () => { input.value = last.code; go(); } }, `Rejoin ${last.code} as ${last.name}`) : null,
      error ? h('p', { class: 'log error' }, error) : null),
    h('button', { class: 'big learn-btn', style: { width: '100%', maxWidth: '380px' }, onClick: () => { location.search = '?practice=1'; } }, '📖 Learn to play (5 min, solo)'),
    h('p', { class: 'muted small ital' }, 'A short run on this phone alone, with two bots. No table needed.'));
}

async function join(code) {
  ctx.code = code;
  render(app, h('div', { class: 'boot' }, h('h1', {}, code), h('p', { class: 'muted' }, 'Finding the table…')));
  try {
    const { session, setPresence } = await attach({ backend: ctx.backend, code, role: 'phone', view, presence: ctx.proxyFor ? { role: 'gm' } : { role: 'phone', playerId: recallSeat(code) || undefined } });
    ctx.session = session; ctx.setPresence = setPresence; window.__gwf = { session, ctx };
    // Back from airplane mode, a lock screen or another app: if the TV handed this seat to the GM for silence while
    // we were away, take it back the moment we are provably here (we just received an event or came back online).
    let reclaimedAt = 0;
    const reclaim = async () => {
      const since = session.state.gm?.proxies?.[ctx.me] || 0;
      if (!ctx.me || ctx.proxyFor || !shouldReclaimSeat(session.state, ctx.me) || since === reclaimedAt) return;
      reclaimedAt = since;
      try { await session.dispatch('PLAYER_RECONNECT', { playerId: ctx.me, deviceId: ctx.deviceId }, ctx.me); toast('You are back at the table', 'ok'); } catch (e) { console.warn('reclaim', e); }
    };
    session.onChange(() => { reclaim(); });
    window.addEventListener('online', () => setTimeout(reclaim, 500));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(reclaim, 500); });
    if (ctx.proxyFor) { if (!session.state.players[ctx.proxyFor]) throw new Error(`no seat ${ctx.proxyFor} in this room`); ctx.me = ctx.proxyFor; view(session.state, session); return; }
    const seat = recallSeat(code);
    const existing = seat && session.state.players[seat];
    const roster = () => ensureRoster(session, ctx.backend, ctx.me).catch(e => console.warn('roster', e));
    if (existing && !existing.kicked) { ctx.me = seat; await session.dispatch('PLAYER_RECONNECT', { playerId: seat, deviceId: ctx.deviceId }, seat); roster(); view(session.state, session); return; }
    const byDevice = Object.values(session.state.players).find(p => p.deviceId === ctx.deviceId && !p.kicked);
    if (byDevice) { ctx.me = byDevice.id; rememberSeat(code, byDevice.id); setPresence({ role: 'phone', playerId: byDevice.id }); await session.dispatch('PLAYER_RECONNECT', { playerId: byDevice.id, deviceId: ctx.deviceId }, byDevice.id); roster(); view(session.state, session); return; }
    render(app, nameScreen(session));
  } catch (e) { console.error(e); render(app, joinScreen(e.message)); }
}

function nameScreen(session) {
  const last = store.get('gwfrpg:phone:last');
  const input = h('input', { placeholder: 'Your name at the table', maxlength: 18, value: last?.name || '', autocomplete: 'nickname', 'aria-label': 'Name' });
  const playing = session.state.phase === 'playing';
  const go = async (spectator) => {
    const name = input.value.trim(); if (!name && !spectator) return toast('Pick a name', 'bad');
    const playerId = shortId('p');
    const ok = await dispatchOrToast(session, 'PLAYER_JOIN', { playerId, name: name || 'Watcher', deviceId: ctx.deviceId, spectator }, playerId);
    if (!ok) return;
    ctx.me = playerId; rememberSeat(ctx.code, playerId); store.set('gwfrpg:phone:last', { code: ctx.code, name }); ctx.setPresence?.({ role: 'phone', playerId }); ensureRoster(session, ctx.backend, playerId).catch(e => console.warn('roster', e));
    view(session.state, session);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(false); });
  return h('div', { class: 'boot' }, h('h1', {}, ctx.code), h('p', { class: 'muted' }, `${Object.values(session.state.players).filter(p => !p.spectator && !p.kicked).length} at the table`),
    h('div', { class: 'panel gold col', style: { width: '100%', maxWidth: '380px' } }, h('h3', {}, playing ? 'The run has started' : 'Sit down'), input,
      playing ? null : h('button', { class: 'primary big', onClick: () => go(false) }, 'Sit down'),
      h('button', { class: 'ghost big', onClick: () => go(true) }, 'Watch the table')));
}

let stopTicker = null;
function view(state, session) {
  if (!ctx.me) return;
  const me = state.players[ctx.me];
  if (!me || me.kicked) { render(app, h('div', { class: 'boot' }, h('h1', {}, 'Removed'), h('p', { class: 'muted' }, 'The GM removed this seat.'), h('button', { class: 'primary', onClick: () => { store.del(`gwfrpg:seat:${ctx.code}`); location.search = ''; } }, 'Join again'))); return; }
  const c = characterOf(state, ctx.me);
  const pid = currentPlayerId(state), myTurn = state.phase === 'playing' && pid === ctx.me;
  if (myTurn && ctx.lastTurnPid !== pid) buzz([80, 40, 80]);
  ctx.lastTurnPid = pid;
  const clock = h('div', { class: 'clock', id: 'phClock' }, state.phase === 'playing' ? fmtTime(remainingMs(state, pid, Date.now())) : '');
  // In proxy mode every event goes out as the GM with payload.playerId (handlers accept playerId for the GM).
  const dispatch = ctx.proxyFor ? (type, payload) => dispatchOrToast(session, type, { ...(payload || {}), playerId: ctx.me }, 'gm') : (type, payload) => dispatchOrToast(session, type, payload, ctx.me);
  const rerender = () => view(session.state, session);
  const top = h('header', { class: 'top' },
    h('div', { class: 'who' }, h('div', { class: 'turn-tag' }, state.phase !== 'playing' ? state.phase.toUpperCase() : myTurn ? 'YOUR TURN' : `${state.players[pid]?.name || '—'} TO MOVE`), h('div', { class: 'name' }, c?.name || me.name, c ? h('span', { class: 'ital muted' }, ` ${c.classId || 'no class yet'}${c.region ? ` · ${c.region}` : ''}`) : null)),
    clock, c ? h('span', { class: `lantern ${tell(c)}`, title: 'your lantern' }) : null, helpButton({ rerender }), bugButton({ rerender }));
  const screen = lenient(h('main', { class: 'screen', id: 'phScreen' }));
  // The Coach (coach.js): one card for the situation, above the screen on every tab; never allowed to break the render.
  let coach = null;
  try { coach = coachCard({ state, session, me, c, myTurn, ctx, h, dispatch, rerender }); } catch (e) { console.error('coach', e); }
  const tabs = h('nav', { class: 'tabs' }, TABS.map(([id, label]) => h('button', { class: id === ctx.tab ? 'on' : '', onClick: () => { ctx.tab = id; view(session.state, session); } }, label, id === 'letters' && unread(state) ? h('span', { class: 'dot' }) : null, id === 'play' && myTurn && ctx.tab !== 'play' ? h('span', { class: 'dot' }) : null)));
  // QA: the bug-report sheet and the secret reward overlay sit above the tabs (feedback.js).
  let qa = [];
  try { qa = [bugSheet({ state, ctx, me, myTurn, dispatch, rerender }), rewardOverlay({ state, ctx, me, dispatch })]; } catch (e) { console.error('qa', e); }
  try { qa.push(helpSheet({ state, ctx, me, c, myTurn, dispatch, rerender })); } catch (e) { console.error('help', e); }
  const banner = ctx.proxyFor ? h('div', { class: 'banner', style: { position: 'static' } }, `GM acting for ${me.name}`) : ctx.practice ? h('div', { class: 'banner practice-tag' }, 'PRACTICE · solo run with two bots · ? to quit') : null;
  const rows = [banner && 'auto', 'auto', coach && 'auto', '1fr', 'auto'].filter(Boolean).join(' ');
  render(app, h('div', { class: 'shell', style: { gridTemplateRows: rows } }, banner, top, coach, screen, tabs), qa);
  const tab = TABS.find(t => t[0] === ctx.tab) || TABS[0];
  try { tab[2]({ state, session, me, c, myTurn, ctx, h, dispatch, screen, rerender }); } catch (e) { console.error(e); screen.append(h('p', { class: 'log error' }, e.message)); }
  stopTicker?.(); stopTicker = ticker((now) => { if (state.phase === 'playing') clock.textContent = fmtTime(remainingMs(session.state, currentPlayerId(session.state), now)); });
  // GM whispers / broadcasts
  const seen = ctx.seenToasts ||= new Set();
  // A "📖 Title: text" broadcast is a rule card in the coach slot (coach.js), not a five-second toast.
  for (const t of state.toasts.slice(-5)) if (!seen.has(t.id) && (t.to == null || t.to === ctx.me) && Date.now() - t.ts < 60000) { seen.add(t.id); if (isRuleBroadcast(t)) { buzz(40); continue; } toast(t.text, '', 5000); buzz(40); }
}
const tell = (c) => (c.dead ? 'dead' : c.health / c.maxHealth > 0.66 ? '' : c.health / c.maxHealth >= 0.33 ? 'mid' : 'low');
const unread = (state) => { let seen; try { seen = readSet(ctx.me); } catch { seen = new Set(); } return state.letters.some(l => l.toId === ctx.me && l.deliveredAt && !l.destroyed && !l.read && !seen.has(l.id)); };

main();
