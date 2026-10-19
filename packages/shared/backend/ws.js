// WebSocket backend client for tools/dev-server.mjs. Same interface as the others; every method is one
// request/response over the socket, events arrive as pushes. Reconnects with back-off and re-subscribes.
import { uuid } from '../ids.js';

const ID_KEY = 'gwfrpg:identity';
function identityFromStorage() {
  try { const v = JSON.parse(localStorage.getItem(ID_KEY) || 'null'); if (v?.deviceId) return v; } catch { /* fresh */ }
  const id = { deviceId: uuid() }; try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch { /* ignore */ }
  return id;
}

export function createWsBackend({ url, WebSocketImpl = globalThis.WebSocket } = {}) {
  const identity = typeof localStorage !== 'undefined' ? identityFromStorage() : { deviceId: uuid() };
  let ws = null, ready = null, seq = 0, backoff = 300;
  const pending = new Map(), listeners = new Map(), presenceListeners = new Map(), subscribed = new Set();
  function connect() {
    ready = new Promise((ok, fail) => {
      ws = new WebSocketImpl(url);
      ws.onopen = () => { backoff = 300; for (const r of subscribed) send('subscribe', [r]).catch(() => {}); ok(); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id != null && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error)) : res(msg.result); return; }
        if (msg.event) for (const fn of listeners.get(msg.roomId) || []) fn(msg.event);
        if (msg.presence) for (const fn of presenceListeners.get(msg.roomId) || []) fn(msg.presence);
      };
      ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('socket closed')); pending.clear(); setTimeout(connect, backoff); backoff = Math.min(5000, backoff * 2); };
      ws.onerror = () => { fail(new Error('socket error')); };
    });
    ready.catch(() => {});
  }
  connect();
  async function send(op, args) {
    await ready;
    return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, op, args })); });
  }
  const proxyGroup = (g, methods) => Object.fromEntries(methods.map(m => [m, (...a) => send(`${g}.${m}`, a)]));
  return {
    kind: 'ws',
    identity: () => identity,
    createRoom: (o) => send('createRoom', [o]), findRoom: (c) => send('findRoom', [c]), getRoom: (id) => send('getRoom', [id]),
    append: (roomId, ev) => send('append', [roomId, ev]), loadEvents: (roomId, after) => send('loadEvents', [roomId, after]),
    subscribe(roomId, onEvent) { if (!listeners.has(roomId)) listeners.set(roomId, new Set()); listeners.get(roomId).add(onEvent); subscribed.add(roomId); send('subscribe', [roomId]).catch(() => {}); return () => listeners.get(roomId)?.delete(onEvent); },
    saveSnapshot: (roomId, s, st) => send('saveSnapshot', [roomId, s, st]),
    presence(roomId, meta, onSync) {
      if (!presenceListeners.has(roomId)) presenceListeners.set(roomId, new Set()); presenceListeners.get(roomId).add(onSync);
      const key = meta.playerId || meta.role || identity.deviceId;
      const ping = () => send('presence', [roomId, key]).then(onSync).catch(() => {});
      ping(); const t = setInterval(ping, 5000);
      return () => { clearInterval(t); presenceListeners.get(roomId)?.delete(onSync); };
    },
    roster: proxyGroup('roster', ['forDevice', 'create', 'save', 'get', 'claim']),
    wall: proxyGroup('wall', ['all', 'add', 'taken']),
    hallOfFame: proxyGroup('hallOfFame', ['list', 'add']),
    presets: proxyGroup('presets', ['list', 'save']),
    metaLedger: proxyGroup('metaLedger', ['add', 'list']),
    seasons: proxyGroup('seasons', ['current', 'save']),
    close() { ws.onclose = null; ws.close(); },
  };
}
