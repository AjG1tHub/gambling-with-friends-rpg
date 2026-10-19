// Browser-side glue shared by the TV, phone and GM apps: pick a backend, open the room session, keep presence
// pinging, surface connection trouble, and drive a render loop that re-runs `view(state)` on every event.
import '../shared/index.js';
import { createBackend } from '../shared/backend/index.js';
import { openRoom, createRoom } from '../shared/room.js';
import { banner, toast, store } from './dom.js';

export async function boot({ kind } = {}) {
  const backend = await createBackend({ kind });
  const identity = backend.identity();
  return { backend, identity };
}

// Open (or create) a room and wire rendering. `view(state, session)` is called on every change and once at start.
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
  if (presence && backend.presence) leave = backend.presence(session.roomId, presence, (map) => { Object.assign(session.presence, map); try { view(session.state, session, null); } catch { /* ignore */ } });
  const offline = () => banner('Connection lost — the game goes on without you until you are back', 'bad');
  const online = () => { banner(''); session.refresh().catch(() => {}); };
  window.addEventListener('offline', offline); window.addEventListener('online', online);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') session.refresh().catch(() => {}); });
  const close = () => { leave?.(); session.close(); window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  return { session, close };
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
