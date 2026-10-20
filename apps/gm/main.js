// The GM console. Creates rooms (mode, tier, size, PIN), gates itself behind the room's PIN, and offers the
// panels: Table (players, pause, start), Run (end, undo, restore points, broadcast), Config (balance.json),
// Rig, Challenge lists, Spotlight, Ledger, Recap, Hall of Fame, Export. Panels live in ./panels/*.js.
import { h, render, $, qs, toast, store, lenient } from '../../packages/ui/dom.js';
import { boot, attach, dispatchOrToast } from '../../packages/ui/client.js';
import { roomCode, seed32, hashPin } from '../../packages/shared/ids.js';
import { MODES, SIZES } from '../../packages/shared/state.js';
import { panelTable } from './panels/table.js';
import { panelRun } from './panels/run.js';
import { panelConfig } from './panels/config.js';
import { panelRig } from './panels/rig.js';
import { panelChallenge } from './panels/challenge.js';
import { panelMonsters } from './panels/monsters.js';
import { panelProxy } from './panels/proxy.js';
import { panelLedger } from './panels/ledger.js';
import { panelExport } from './panels/export.js';
import { panelBugs, openBugCount, gmReportLine } from './panels/bugs.js';

const app = $('#app');
const PANELS = [['table', 'Table', panelTable], ['run', 'Run', panelRun], ['config', 'Config', panelConfig], ['rig', 'Rig & Spotlight', panelRig], ['challenge', 'Challenge lists', panelChallenge], ['monsters', 'Monsters', panelMonsters], ['proxy', 'Proxy & Autopilot', panelProxy], ['ledger', 'Ledger & Recap', panelLedger], ['bugs', 'Bugs & rewards', panelBugs], ['export', 'Export', panelExport]];
const ctx = { backend: null, session: null, panel: 'table', code: null, pinOk: false };
const gm = (type, payload) => dispatchOrToast(ctx.session, type, payload, 'gm');

async function main() {
  const { backend, identity } = await boot();
  ctx.backend = backend; ctx.deviceId = identity.deviceId;
  const code = (qs('code') || '').toUpperCase();
  if (code.length === 4) return open(code);
  render(app, startScreen());
}

function startScreen(error = '') {
  const saved = store.get('gwfrpg:gm:defaults', {});
  const f = {
    mode: h('select', {}, MODES.map(m => h('option', { value: m, selected: (saved.mode || 'ffa') === m }, m))),
    tier: h('select', {}, [1, 2, 3].map(t => h('option', { value: t, selected: Number(saved.tier || 1) === t }, `Tier ${t}`))),
    size: h('select', {}, SIZES.map(s => h('option', { value: s, selected: (saved.size || 'regular') === s }, s))),
    pin: h('input', { type: 'password', inputmode: 'numeric', placeholder: 'GM PIN (4+ digits)', value: '', autocomplete: 'off' }),
    preset: h('select', {}, [['inperson', 'In Person'], ['discord', 'Discord'], ['quick', 'Quick']].map(([v, l]) => h('option', { value: v, selected: (saved.preset || 'inperson') === v }, l))),
    fog: h('input', { type: 'checkbox', checked: saved.fog !== false }),
  };
  const create = async () => {
    const pin = f.pin.value.trim(); if (pin.length < 4) return toast('Set a PIN of at least 4 digits', 'bad');
    const code = roomCode();
    const defaults = { mode: f.mode.value, tier: Number(f.tier.value), size: f.size.value, preset: f.preset.value, fog: f.fog.checked };
    store.set('gwfrpg:gm:defaults', defaults);
    const balance = store.get('gwfrpg:gm:balance', null);
    try {
      const { session } = await attach({ backend: ctx.backend, role: 'gm', view, create: { code, seed: seed32(), mode: defaults.mode, tier: defaults.tier, size: defaults.size, gmPinHash: await hashPin(pin), balance, challengePreset: defaults.preset, fogOfWar: defaults.fog, gmDeviceId: ctx.deviceId } });
      ctx.session = session; ctx.code = code; ctx.pinOk = true; store.set(`gwfrpg:gm:pin:${code}`, await hashPin(pin));
      history.replaceState(null, '', `?code=${code}`);
      window.__gwf = { session, ctx };
      view(session.state, session);
    } catch (e) { console.error(e); toast(e.message, 'bad'); }
  };
  const codeIn = h('input', { class: 'code', maxlength: 4, placeholder: 'CODE' });
  const reopen = () => { const c = codeIn.value.trim().toUpperCase(); if (c.length === 4) location.search = `?code=${c}`; };
  return h('div', { class: 'boot' }, h('h1', {}, 'GM console'), h('p', { class: 'ital muted' }, 'You run the night from here and play from your phone like everyone else.'),
    h('div', { class: 'grid2', style: { width: 'min(900px, 100%)', textAlign: 'left' } },
      h('div', { class: 'panel gold col' }, h('h3', {}, 'Create a room'),
        h('div', { class: 'grid2' }, field('Mode', f.mode), field('Difficulty', f.tier), field('Map size', f.size), field('Challenge list', f.preset)),
        field('GM PIN', f.pin), h('label', { class: 'row' }, f.fog, ' Fog of war on the TV'),
        h('button', { class: 'primary big', onClick: create }, 'Create room'), h('p', { class: 'muted' }, 'Then open ', h('a', { href: '/', target: '_blank' }, 'the table screen'), ' on the TV and enter the code.')),
      h('div', { class: 'panel col' }, h('h3', {}, 'Reopen a room'), codeIn, h('button', { class: 'big', onClick: reopen }, 'Open console'),
        h('div', { class: 'hr' }), h('h3', {}, 'Backend down?'), h('p', { class: 'muted' }, h('a', { href: '/classic/gm/' }, 'Run classic mode'), ' — the previous one-computer build, unchanged.'),
        error ? h('p', { class: 'log error' }, error) : null)));
}
const field = (label, el) => h('div', { class: 'field' }, h('label', {}, label), el);

async function open(code) {
  try {
    const { session } = await attach({ backend: ctx.backend, code, role: 'gm', view, presence: { role: 'gm' } });
    ctx.session = session; ctx.code = code; window.__gwf = { session, ctx };
    ctx.pinOk = store.get(`gwfrpg:gm:pin:${code}`) === session.state.gm.pinHash;
    view(session.state, session);
  } catch (e) { console.error(e); render(app, startScreen(e.message)); }
}

function pinGate(state, session) {
  const input = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'GM PIN', autofocus: true });
  const go = async () => { const hsh = await hashPin(input.value.trim()); if (hsh !== state.gm.pinHash) return toast('Wrong PIN', 'bad'); store.set(`gwfrpg:gm:pin:${ctx.code}`, hsh); ctx.pinOk = true; view(session.state, session); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'boot' }, h('h1', {}, `Room ${ctx.code}`), h('div', { class: 'panel gold col', style: { minWidth: '360px' } }, h('h3', {}, 'GM PIN'), input, h('button', { class: 'primary big', onClick: go }, 'Unlock')));
}

function view(state, session) {
  if (!ctx.pinOk) return render(app, pinGate(state, session));
  const nav = h('nav', { class: 'gm-nav' }, h('h1', {}, 'GM console'), h('div', { class: 'code' }, state.code), h('div', { class: 'muted', style: { padding: '0 8px 10px' } }, `${state.mode} · tier ${state.tier} · ${state.size} · ${state.phase}${state.gm.paused ? ' · PAUSED' : ''}`),
    PANELS.map(([id, label]) => { const open = id === 'bugs' ? openBugCount(state) : 0; return h('button', { class: id === ctx.panel ? 'on' : '', onClick: () => { ctx.panel = id; view(session.state, session); } }, label, open ? h('span', { class: 'dot', title: `${open} open report${open === 1 ? '' : 's'}` }, open) : null); }),
    h('div', { class: 'grow' }), gmReportLine({ h, gm, rerender: () => view(session.state, session) }), h('a', { href: '/', target: '_blank', class: 'btn ghost' }, 'Table screen ↗'), h('a', { href: '/lab/', target: '_blank', class: 'btn ghost' }, 'Game Lab ↗'));
  const main = lenient(h('main', { class: 'gm-main' }));
  if (state.lastError && Date.now() - state.lastError.ts < 15000) main.append(h('div', { class: 'err-box' }, `${state.lastError.type} by ${state.lastError.actor}: ${state.lastError.message}`));
  render(app, h('div', { class: 'gm-shell' }, nav, main));
  const p = PANELS.find(x => x[0] === ctx.panel) || PANELS[0];
  try { p[2]({ state, session, ctx, h, gm, main }); } catch (e) { console.error(e); main.append(h('p', { class: 'log error' }, e.message)); }
}

main();
