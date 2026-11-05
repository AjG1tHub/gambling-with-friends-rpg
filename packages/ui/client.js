// Browser-side glue shared by the TV, phone and GM apps: pick a backend, open the room session, keep presence
// pinging, surface connection trouble, and drive a render loop that re-runs `view(state)` on every event.
import '../shared/index.js';
import { createBackend } from '../shared/backend/index.js';
import { openRoom, createRoom } from '../shared/room.js';
import { banner, toast, store } from './dom.js';

// Extra options (a local `namespace`, say) go through to the backend factory.
export async function boot({ kind, ...opts } = {}) {
  const backend = await createBackend({ kind, ...opts });
  const identity = backend.identity();
  return { backend, identity };
}

// Open (or create) a room and wire rendering. `view(state, session)` is called on every change and once at start.
const PRESENCE_RENDER_MS = 10000;
export async function attach({ backend, roomId, code, role, view, onEvent, create = null, presence = null }) {
  let session;
  const onError = (e) => { if (e?.code && e.code !== 'error') return; console.error(e); };
  try {
    session = create ? await createRoom(backend, { ...create, role, onError }) : await openRoom(backend, { roomId, code, role, onError });
  } catch (e) { throw e; }
  const rerender = (ev) => { try { view(session.state, session, ev); } catch (e) { console.error('view failed', e); } if (ev && onEvent) onEvent(ev, session.state); };
  session.onChange((_, ev) => rerender(ev));
  rerender(null);
  // Presence: ping while the tab is alive; the TV watches for silence.
  let leave = null;
  // Only the GM console draws presence ("seen 5s ago"); the TV reads it from a ticker and the phone never shows it.
  // Every client pings every 5 s and the backend fans the map out to everyone, so re-rendering a phone on each ping
  // rebuilt its whole screen about once a second: the name field lost focus mid-word and the screen jumped to the top.
  // The GM console does re-render on presence, but at most every 10 s and never while the GM is typing or mid-click
  // (five clients pinging every 5 s would otherwise rebuild the console about once a second: focus lost in the Teach
  // box, a Kick button replaced under the pointer).
  let presenceRender = null, lastPresenceRender = 0;
  const onPresence = (map) => {
    Object.assign(session.presence, map); if (role !== 'gm') return;
    const paint = () => { presenceRender = null; const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { presenceRender = setTimeout(paint, 3000); return; } lastPresenceRender = Date.now(); try { view(session.state, session, null); } catch { /* ignore */ } };
    if (presenceRender) return;
    presenceRender = setTimeout(paint, Math.max(0, PRESENCE_RENDER_MS - (Date.now() - lastPresenceRender)));
  };
  if (presence && backend.presence) leave = backend.presence(session.roomId, presence, onPresence);
  // A phone that takes a seat after attaching re-registers under its player id, or the TV proxies it for silence.
  const setPresence = (meta) => { if (!backend.presence) return; leave?.(); leave = backend.presence(session.roomId, meta, onPresence); };
  const offline = () => banner('Connection lost — the game goes on without you until you are back', 'bad');
  const online = () => { banner(''); session.refresh().catch(() => {}); };
  window.addEventListener('offline', offline); window.addEventListener('online', online);
  // The socket itself can drop while the browser still thinks it is online (wifi hiccup, the dev server restarting,
  // a sleeping tab): say so the same way, and clear it when the socket is back (the room back-fills on its own).
  const unDrop = backend.onDisconnect?.(() => { if (navigator.onLine !== false) banner('Connection lost — reconnecting…', 'bad'); });
  const unBack = backend.onReconnect?.(() => { if (navigator.onLine !== false) banner(''); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') session.refresh().catch(() => {}); });
  const close = () => { leave?.(); unDrop?.(); unBack?.(); session.close(); window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  return { session, close, setPresence };
}

// A seat id per room on this device, so a reload rejoins the same seat.
export const seatKey = (code) => `gwfrpg:seat:${code}`;
export const rememberSeat = (code, playerId) => store.set(seatKey(code), playerId);
export const recallSeat = (code) => store.get(seatKey(code));

export async function dispatchOrToast(session, type, payload, actor) {
  try {
    await session.dispatch(type, payload, actor);
    const err = session.state.lastError;
    if (err && err.type === type && err.actor === actor && Date.now() - err.ts < 5000) { toast(err.message, 'bad'); return false; }
    return true;
  } catch (e) { toast(e.message || 'Something went wrong', 'bad'); return false; }
}
