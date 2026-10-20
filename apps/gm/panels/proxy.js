// GM panel: Proxy & Autopilot (SPEC.md › GM controls: "hand a dead phone's turn to the GM (proxy mode), put an
// absent player on autopilot with the existing bot"). "Act for this phone" marks the seat proxied (GM_PROXY) and
// opens the real phone UI in a floating dock as /phone/?code=X&as=<playerId>&gm=1 (the phone then dispatches as
// 'gm' with payload.playerId); "Hand the turn back" releases it. Autopilot toggles GM_AUTOPILOT (the TV runs the bot).
// Receives { state, session, ctx, h, gm, main }.
import { characterOf, currentPlayerId } from '../../../packages/shared/state.js';
import { remainingMs } from '../../../packages/shared/clock.js';
import { fmtTime } from '../../../packages/ui/dom.js';

// The dock lives outside the console's <main> so re-renders never reload the iframe.
let dock = null, dockFor = null;

export function panelProxy({ state, session, h, gm, main }) {
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked && !p.spectator);
  const cur = currentPlayerId(state);
  const backendQs = backendQuery(session);
  const urlFor = (pid) => `/phone/?code=${state.code}&as=${encodeURIComponent(pid)}&gm=1${backendQs}`;
  const actFor = async (p) => { if (!p.proxied) await gm('GM_PROXY', { playerId: p.id, on: true }); openDock(p, urlFor(p.id), state, gm); };
  const handBack = async (p) => { await gm('GM_PROXY', { playerId: p.id, on: false }); if (dockFor === p.id) closeDock(); };
  const rows = seats.map(p => {
    const c = characterOf(state, p.id);
    const seen = Math.max(session.presence[p.id] || 0, p.lastSeenTs || 0);
    return h('tr', { style: p.id === cur ? { background: 'rgba(201,164,92,.08)' } : null },
      h('td', {}, h('b', {}, p.name), p.id === cur ? h('span', { class: 'pill gold', style: { marginLeft: '6px' } }, 'to move') : null, h('div', { class: 'muted' }, c ? `${c.name} · ${c.classId} · ${c.health}/${c.maxHealth} HP · ${c.pos || '—'}` : 'no character')),
      h('td', {}, h('span', { class: `pill ${p.connected ? 'ok' : 'bad'}` }, p.connected ? 'online' : 'away'), seen ? h('div', { class: 'muted' }, `seen ${Math.round((Date.now() - seen) / 1000)}s ago`) : null, state.phase === 'playing' ? h('div', { class: 'muted' }, `clock ${fmtTime(remainingMs(state, p.id, Date.now()))}`) : null),
      h('td', {}, p.proxied ? h('span', { class: 'pill gold' }, `proxied since ${new Date(state.gm.proxies?.[p.id] || 0).toLocaleTimeString()}`) : h('span', { class: 'muted' }, 'own phone'), p.autopilot ? h('div', {}, h('span', { class: 'pill' }, 'autopilot')) : null),
      h('td', { class: 'row' },
        h('button', { class: p.proxied ? 'primary' : '', onClick: () => actFor(p) }, dockFor === p.id ? 'Phone is open' : 'Act for this phone'),
        p.proxied ? h('button', { onClick: () => handBack(p) }, 'Hand the turn back') : null,
        h('a', { class: 'btn ghost', href: urlFor(p.id), target: '_blank', title: 'The proxied phone in its own tab' }, 'New tab ↗'),
        h('button', { class: p.autopilot ? 'primary' : '', onClick: () => gm('GM_AUTOPILOT', { playerId: p.id, on: !p.autopilot }) }, p.autopilot ? 'Autopilot on' : 'Autopilot')));
  });
  const proxied = seats.filter(p => p.proxied), bots = seats.filter(p => p.autopilot);
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Proxy & Autopilot'),
      h('p', { class: 'muted' }, 'A proxied seat is locked for its own phone; you play it from the console in the real phone UI (every prompt, the Cage, the Map). Autopilot hands the seat to the bot the TV runs; the player gets it back when you switch it off. The TV proxies a silent mover by itself after the table.proxyAfterSeconds silence.'),
      h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, ['Seat', 'Phone', 'Mode', ''].map(x => h('th', {}, x)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Nobody at the table yet.')))),
      h('div', { class: 'gm-bar', style: { marginTop: '10px' } },
        proxied.length ? h('button', { onClick: async () => { for (const p of proxied) await gm('GM_PROXY', { playerId: p.id, on: false }); closeDock(); } }, `Hand back all (${proxied.length})`) : null,
        bots.length ? h('button', { onClick: async () => { for (const p of bots) await gm('GM_AUTOPILOT', { playerId: p.id, on: false }); } }, `Autopilot off for all (${bots.length})`) : null,
        dock ? h('button', { class: 'ghost', onClick: closeDock }, 'Close the phone dock') : null)),
    h('div', { class: 'panel' }, h('h3', {}, 'How the proxy works'), h('p', { class: 'muted' }, `The dock loads /phone/?code=${state.code}&as=<playerId>&gm=1 with the console's backend (${backendQs ? backendQs.slice(1) : session.backend.kind}). In that mode the phone skips the join flow, shows a "GM acting for …" banner, and every tap is appended with actor 'gm' and payload.playerId, which every handler accepts for the GM. The seat stays proxied until you hand it back, so the real phone cannot double-act.`)));
}

function backendQuery(session) {
  let kind = null, ws = null;
  try { kind = sessionStorage.getItem('gwfrpg:backend'); ws = sessionStorage.getItem('gwfrpg:ws'); } catch { /* storage blocked */ }
  kind = kind || session.backend.kind;
  if (!kind || kind === 'supabase') return '';
  return `&backend=${encodeURIComponent(kind)}${kind === 'ws' && ws ? `&ws=${encodeURIComponent(ws)}` : ''}`;
}
function openDock(p, url, state, gm) {
  if (dock && dockFor === p.id) return;
  closeDock();
  dockFor = p.id;
  const frame = document.createElement('iframe'); frame.src = url; frame.title = `Phone of ${p.name}`; frame.setAttribute('allow', 'vibrate');
  Object.assign(frame.style, { width: '390px', height: '720px', border: '0', borderRadius: '18px', background: '#0d0a0b', display: 'block' });
  const head = document.createElement('div'); head.className = 'row between'; Object.assign(head.style, { padding: '6px 10px', gap: '8px' });
  head.innerHTML = `<span class="tag">GM acting for <b>${escapeHtml(p.name)}</b></span>`;
  const back = document.createElement('button'); back.textContent = 'Hand back'; back.className = 'ghost'; back.style.minHeight = '36px'; back.addEventListener('click', async () => { await gm('GM_PROXY', { playerId: p.id, on: false }); closeDock(); });
  const close = document.createElement('button'); close.textContent = '×'; close.className = 'ghost'; close.title = 'Close the dock (the seat stays proxied)'; close.style.minHeight = '36px'; close.addEventListener('click', closeDock);
  head.append(back, close);
  dock = document.createElement('div'); dock.id = 'gmPhoneDock'; dock.className = 'panel gold';
  Object.assign(dock.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '40', padding: '6px', boxShadow: '0 20px 60px rgba(0,0,0,.8)' });
  dock.append(head, frame); document.body.append(dock);
}
function closeDock() { dock?.remove(); dock = null; dockFor = null; }
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
