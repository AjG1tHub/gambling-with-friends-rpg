// Game Lab (/lab). A sandbox that never opens a real room: every one of the 36 items, every wheel, the creation
// gamble, the Challenge Wheel's hosted duels and the pets' attacks playable against a dummy opponent, with the
// legacy tick-list (OK / Problem, notes, stats, Copy report) and keys N P A S 1 2. Modes:
//   /lab/                 the PC Lab: catalog · the round · tick-list
//   /lab/?phone=1         the same catalog in the phone's layout with 60 px buttons (test every item from a phone)
//   /lab/?botrun=ffa&bots=4&seed=1   runs tools/bots.mjs' loop in the browser against the deployed code and shows the report
//   /lab/?qa=1            the QA run: every wheel three times, one spin at a time, with the calculation and a verdict per spin
// Deep links: /lab/#coinblade, #wheel:fortune, #duel:quickdraw, #creation:fifty, #pet:emberfox, #data:legendaries.
// Only createLocalBackend({ namespace: 'lab' }) is ever created (identity for the report); no room is opened.
import '../../packages/shared/index.js';
import { h, render, $, qs, toast, store, lenient } from '../../packages/ui/dom.js';
import { createLocalBackend } from '../../packages/shared/backend/local.js';
import { labCatalog, labOrder, stepId, newLabState, loadMarks, saveMarks, setStatus, setNote, recordPlay, statsLine, progress, reportText, LAB_HEALTH, LAB_CHIPS } from '../../packages/games/lab-core.js';
import { ITEM_DEFS, FAMILIES, CLASSES } from '../../packages/games/items.js';
import { gameMeta } from '../../packages/games/adapter.js';
import { B } from '../../packages/shared/balance.js';
import { ensureStageCss, download, copyText, makeSandbox } from '../../packages/ui/labkit.js';
import { PURPOSE_BUILT } from '../../packages/shared/challenge/hosted.js';
import { SPECIES } from '../../packages/shared/handlers/pets.js';
import { screenItems } from './screens/items.js';
import { screenWheels, WHEEL_IDS } from './screens/wheels.js';
import { screenCreation, CREATION_GAMES } from './screens/creation.js';
import { screenChallenge } from './screens/challenge.js';
import { screenPets } from './screens/pets.js';
import { screenData, DATA_PAGES } from './screens/data.js';
import { screenBotrun } from './screens/botrun.js';
import { screenQa, qaProgress } from './screens/qa.js';

const app = $('#app');
const phone = qs('phone') === '1';
if (phone) document.body.classList.add('lab-phone');
ensureStageCss();
const storage = (() => { try { localStorage.getItem('x'); return localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();

// ── the catalog: items by family, then the wheels, creation gamble, duels and pets as extra groups ─
const itemRow = (d) => { const m = gameMeta(d.gameId); return { id: d.id, gameId: d.gameId, name: d.name, game: m.name, icon: m.icon, kind: d.kind, family: d.family, stat: d.stat, lever: d.lever }; };
const DUEL_NAMES = { quickdraw: 'Quick-Draw', speedmath: 'Speed Math', memorymatch: 'Memory Match', trivia: 'Trivia', highestcard: 'Highest Card', typingrace: 'Typing Race', emojimemory: 'Emoji Memory' };
export function buildCatalog() {
  const groups = Object.entries(FAMILIES).map(([fid, f]) => ({ label: `${f.name} items`, family: fid, items: ITEM_DEFS.filter(d => d.family === fid).map(itemRow) }));
  groups.push({ label: 'Wheels', items: WHEEL_IDS.map(w => ({ id: `wheel:${w.id}`, name: w.name, icon: '🎡', game: 'wheel', kind: 'wheel', stat: '—' })) });
  groups.push({ label: 'Creation gamble', items: CREATION_GAMES.map(g => ({ id: `creation:${g}`, name: g === 'buyin' ? 'Buy-in Wheel' : `${gameMeta(g).name} for stats`, icon: g === 'buyin' ? '🩸' : gameMeta(g).icon, game: g, kind: 'creation', stat: 'chips' })) });
  groups.push({ label: 'Challenge Wheel duels', items: PURPOSE_BUILT.map(g => ({ id: `duel:${g}`, name: DUEL_NAMES[g] || g, icon: '⚔', game: g, kind: 'duel', stat: '—' })) });
  groups.push({ label: 'Pet attacks', items: SPECIES.map(s => ({ id: `pet:${s.id}`, name: s.name, icon: '🐾', game: s.attacks.map(a => a.gameId).join('/'), kind: 'pet', stat: s.element })) });
  return groups.filter(g => g.items.length);
}

export const lab = {
  phone, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
  state: null, marks: loadMarks(storage), catalog: buildCatalog(), order: [], current: null,
  mode: store.get('gwfrpg:lab:mode', 'health'), rarity: store.get('gwfrpg:lab:rarity', 'common'), stake: null, autoSettle: store.get('gwfrpg:lab:auto', true), powerUps: false, rig: 'none', doubleDown: false, classId: store.get('gwfrpg:lab:class', 'enforcer'),
  sandbox: null, lastResult: '', backend: null,
  save() { saveMarks(storage, this.marks); },
  sb() { if (!this.sandbox) this.sandbox = makeSandbox({ seed: this.seed, classId: this.classId }); return this.sandbox; },
  mark(status) { if (!this.current) return; setStatus(this.marks, this.current, this.marks[this.current]?.status === status ? '' : status); this.save(); drawNav(); drawSide(); },
  record(id, stake, mult, crit) { recordPlay(this.marks, id, stake, mult, crit); this.save(); drawNav(); drawSide(); },
};
lab.order = labOrder(lab.catalog);
lab.state = newLabState({ seed: lab.seed, health: LAB_HEALTH, chips: LAB_CHIPS, classId: lab.classId });
window.__lab = lab;

// ── routing ──────────────────────────────────────────────────────────────────────────────────────
const screenFor = (id) => (id === 'botrun' ? screenBotrun : id === 'qa' ? screenQa : id?.startsWith('wheel:') ? screenWheels : id?.startsWith('creation:') ? screenCreation : id?.startsWith('duel:') ? screenChallenge : id?.startsWith('pet:') ? screenPets : id?.startsWith('data:') ? screenData : screenItems);
const nameOf = (id) => lab.catalog.flatMap(g => g.items).find(x => x.id === id) || (id?.startsWith('data:') ? { name: DATA_PAGES.find(p => `data:${p.id}` === id)?.name || 'Data', icon: '📜' } : id === 'botrun' ? { name: 'Bot run', icon: '🤖' } : id === 'qa' ? { name: 'QA: every wheel ×3', icon: '🔍' } : { name: id, icon: '🎲' });
export function open(id, { push = true } = {}) {
  lab.current = id || null;
  if (push && id) history.replaceState(null, '', `#${id}`);
  draw();
}
const els = { nav: null, main: null, side: null };

function draw() {
  const top = h('header', { class: 'lab-top' }, h('h1', {}, '🧪 Game Lab'), h('span', { class: 'sub' }, phone ? 'phone mode' : 'every item, wheel and duel against a dummy — a sandbox that never touches a real room'),
    h('span', { class: 'grow' }), phone ? null : h('span', { class: 'muted', id: 'labProgress' }, progress(lab.catalog, lab.marks).text),
    h('label', {}, h('input', { type: 'checkbox', checked: lab.autoSettle, onChange: (e) => { lab.autoSettle = e.target.checked; store.set('gwfrpg:lab:auto', lab.autoSettle); } }), 'auto-settle'),
    phone ? null : h('label', { title: 'A Nudge, a Reroll and a Fork every round (chance games only)' }, h('input', { type: 'checkbox', checked: lab.powerUps, onChange: (e) => { lab.powerUps = e.target.checked; } }), 'power-ups'),
    phone ? h('a', { class: 'btn ghost', href: '/lab/' }, 'PC Lab') : h('a', { class: 'btn ghost', href: '/lab/?phone=1' }, 'Phone mode ↗'),
    phone ? null : h('a', { class: 'btn ghost', href: '/lab/?botrun=ffa&bots=4' }, 'Bot run'), phone ? null : h('a', { class: 'btn ghost', href: '/lab/?qa=1' }, 'QA run'), phone ? null : h('a', { class: 'btn ghost', href: '/gm/' }, '← GM console'));
  els.nav = lenient(h('nav', { class: 'lab-nav panel', 'aria-label': 'Catalog' }));
  els.main = lenient(h('main', { class: 'lab-main' }));
  els.side = lenient(h('aside', { class: 'lab-side' }));
  const grid = h('div', { class: 'lab-grid' }, els.nav, els.main, els.side);
  const tabs = phone ? h('nav', { class: 'phone-tabs' }, h('button', { class: !lab.current ? 'on' : '', onClick: () => open(null) }, 'Catalog'), h('button', { class: lab.current && !lab.current.startsWith('data:') ? 'on' : '', onClick: () => { if (!lab.current) open(lab.order[0]); } }, 'Round'), h('button', { class: lab.current?.startsWith('data:') ? 'on' : '', onClick: () => open('data:legendaries') }, 'Data')) : null;
  render(app, h('div', { class: 'lab-shell' }, top, grid, tabs));
  drawNav(); drawMain(); drawSide();
}
function drawNav() {
  if (!els.nav) return;
  const nav = els.nav; nav.replaceChildren();
  if (phone && lab.current) { nav.style.display = 'none'; return; } nav.style.display = '';
  const btn = (id, icon, name, st = '', cls = '') => h('button', { class: `${id === lab.current ? 'on' : ''} ${cls}`.trim(), dataset: { id }, onClick: () => open(id) }, h('span', {}, icon), h('span', {}, name), h('span', { class: 'st' }, st));
  for (const grp of lab.catalog) {
    nav.append(h('h4', {}, grp.label));
    for (const it of grp.items) { const e = lab.marks[it.id] || {}; nav.append(btn(it.id, it.icon, it.name, e.status === 'ok' ? '✅' : e.status === 'bad' ? '⚠️' : e.plays ? `${e.plays}×` : '', e.status || '')); }
  }
  nav.append(h('h4', {}, 'Reference'));
  for (const p of DATA_PAGES) nav.append(btn(`data:${p.id}`, p.icon, p.name));
  const q = lab.marks.qa || {}, qp = qaProgress(lab.marks);
  nav.append(h('h4', {}, 'Runs'), btn('botrun', '🤖', 'Bot run in the browser'), btn('qa', '🔍', 'QA: every wheel ×3', q.status === 'ok' ? '✅' : q.status === 'bad' ? '⚠️' : qp.done ? `${qp.done}/${qp.total}` : '', q.status || ''));
}
function drawMain() {
  const main = els.main; main.replaceChildren();
  lab.mount?.stop?.(); lab.mount = null;
  if (!lab.current) {
    if (phone) { main.append(h('p', { class: 'muted ital' }, 'Tap anything in the catalog. Every round plays with the phone\'s own buttons.')); return; }
    main.append(h('div', { class: 'panel' }, h('h2', {}, 'Pick something on the left'), h('p', { class: 'muted' }, 'Or press N. Items play against the Training Dummy with your practice character; wheels spin on a sandbox room; duels play against a bot; pets swing their attacks; the Data pages list every Legendary, set, species, monster, boot and class in the spec.'),
      h('p', { class: 'muted' }, 'Keys: ', h('span', { class: 'kbd' }, 'N'), ' next · ', h('span', { class: 'kbd' }, 'P'), ' previous · ', h('span', { class: 'kbd' }, 'A'), ' auto-play with the bot · ', h('span', { class: 'kbd' }, 'S'), ' settle · ', h('span', { class: 'kbd' }, '1'), '/', h('span', { class: 'kbd' }, '2'), ' quick stakes (Common / Legendary) · ', h('span', { class: 'kbd' }, 'O'), ' works · ', h('span', { class: 'kbd' }, 'X'), ' problem')));
    return;
  }
  const meta = nameOf(lab.current);
  const head = h('div', { class: 'lab-head' }, h('h2', {}, `${meta.icon || ''} ${meta.name}`), h('div', { class: 'row' },
    phone ? h('button', { onClick: () => open(null) }, '← Catalog') : null,
    h('button', { title: 'Previous (P)', onClick: () => open(stepId(lab.order, lab.current, -1)) }, '← Prev'), h('button', { title: 'Next (N)', onClick: () => open(stepId(lab.order, lab.current, 1)) }, 'Next →')));
  main.append(head);
  const ctx = { lab, h, main, side: els.side, phone, open, toast, id: lab.current, meta, drawSide, drawNav, redraw: drawMain };
  try { screenFor(lab.current)(ctx); } catch (e) { console.error(e); main.append(h('p', { class: 'log error' }, e.message)); }
}
function drawSide() {
  const side = els.side; if (!side) return; side.replaceChildren();
  const id = lab.current;
  if (!id || id === 'botrun' || id === 'qa' || id.startsWith('data:')) { side.append(reportPanel()); return; }
  const e = lab.marks[id] || {};
  const note = h('textarea', { placeholder: 'Notes — what felt off, what to change…', rows: 4 }); note.value = e.note || '';
  note.addEventListener('input', () => { setNote(lab.marks, id, note.value); lab.save(); });
  side.append(h('div', { class: 'panel' }, h('h3', {}, 'Did it work?'),
    h('div', { class: 'row' }, h('button', { class: e.status === 'ok' ? 'primary' : '', title: 'O', onClick: () => lab.mark('ok') }, '✅ Works'), h('button', { class: e.status === 'bad' ? 'danger' : '', title: 'X', onClick: () => lab.mark('bad') }, '⚠️ Problem'), h('button', { class: 'ghost', onClick: () => { setStatus(lab.marks, id, ''); lab.save(); drawNav(); drawSide(); } }, 'Clear')),
    note, h('div', { class: 'muted', id: 'labStats' }, statsLine(lab.marks, id))),
    lab.sideExtra ? lab.sideExtra : null,
    reportPanel());
}
function reportPanel() {
  const p = progress(lab.catalog, lab.marks);
  let armed = 0;
  return h('div', { class: 'panel' }, h('h3', {}, 'Report'), h('p', { class: 'muted' }, p.text),
    h('div', { class: 'row' }, h('button', { class: 'primary', onClick: async () => { const t = reportText(lab.catalog, lab.marks); toast((await copyText(t)) ? 'Report copied — paste it into the chat.' : 'Clipboard blocked — downloading instead'); if (!navigator.clipboard) download('gwf-lab-report.txt', t, 'text/plain'); } }, '📋 Copy report'),
      h('button', { onClick: () => download('gwf-lab-report.txt', reportText(lab.catalog, lab.marks), 'text/plain') }, 'Download'),
      h('button', { class: 'ghost', onClick: () => { if (Date.now() - armed < 4000) { lab.marks = {}; lab.save(); drawNav(); drawSide(); toast('Ticks and notes cleared.'); armed = 0; } else { armed = Date.now(); toast('Press Reset again to clear every tick and note.'); } } }, 'Reset')),
    phone ? null : h('p', { class: 'muted', style: { fontSize: '.8rem' } }, 'Seed ', h('span', { class: 'mono' }, String(lab.seed)), ' · practice sheet: Health ', String(lab.state.tester.health), '/', String(lab.state.tester.maxHealth), ' · chips ', String(lab.state.tester.chips)));
}

// ── keys ─────────────────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (lab.mount?.keys?.[k]) { lab.mount.keys[k](); e.preventDefault(); return; }   // a screen with its own keys (the QA run: O / X / N)
  if (k === 'n') open(stepId(lab.order, lab.current, 1)); else if (k === 'p') open(stepId(lab.order, lab.current, -1));
  else if (k === 'a') { if (!lab.mount?.auto) return toast('Nothing to auto-play here.'); lab.mount.auto(); }
  else if (k === 's') { if (!lab.mount?.settle || !lab.mount.settle()) toast('Nothing to settle yet.'); }
  else if (k === '1') { lab.quickStake?.(1); } else if (k === '2') { lab.quickStake?.(2); }
  else if (k === 'o') lab.mark('ok'); else if (k === 'x') lab.mark('bad');
  else return;
  e.preventDefault();
});
window.addEventListener('error', (e) => { toast(`⚠️ ${e.message || 'error'}`, 'bad', 6000); });
window.addEventListener('hashchange', () => { const id = decodeURIComponent(location.hash.slice(1)); if (id && id !== lab.current && (lab.order.includes(id) || id.startsWith('data:') || id === 'botrun' || id === 'qa')) open(id, { push: false }); });

// ── boot ─────────────────────────────────────────────────────────────────────────────────────────
lab.backend = createLocalBackend({ namespace: 'lab' });
if (qs('botrun')) { lab.current = 'botrun'; draw(); }
else if (qs('qa')) { lab.current = 'qa'; draw(); }
else { const hash = decodeURIComponent(location.hash.slice(1)); if (hash && (lab.order.includes(hash) || hash.startsWith('data:') || hash === 'botrun' || hash === 'qa')) lab.current = hash; else if (!phone && !hash) lab.current = null; draw(); }
export { nameOf, drawSide, drawNav, CLASSES, B };
