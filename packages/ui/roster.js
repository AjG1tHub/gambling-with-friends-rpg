// Roster, claim code, vault and Wall of Names flows shared by the Self tab and the lobby / creation screens
// (SPEC.md › Runs, game modes and meta progression). The backend holds the real roster per claim-code owner;
// this module loads it for the phone's device, mirrors it into the room (ROSTER_CLAIM + ROSTER_SYNC), shows the
// claim code, recovers a roster on a new phone, and writes the run's result back when the run ends.
//
//   ensureRoster(session, backend, playerId)      load or create the owner, claim the seat, sync once per seat
//   recoverRoster(session, backend, playerId, code) redeem a claim code on this device, then sync
//   saveBack({ state, playerId, backend })          at phase 'ended': rosterExport → owner.data → roster.save (+ Wall rows)
//   claimPanel({ ... }), wallPanel({ backend }), rulesDrawer(), lookEditor(look, onChange), rosterUi
import { h, toast, store } from './dom.js';
import { spriteElement } from './sprite.js';
import { rosterExport } from '../shared/handlers/roster.js';
import { characterOf } from '../shared/state.js';
import { LOOK_RANGES, cleanLook, emptyWorn } from '../shared/characters/character.js';
import rulebook from '../../data/rulebook.generated.json' with { type: 'json' };

export const rosterUi = { owner: null, loading: null, claimed: new Set(), synced: new Set(), wall: null, wallAt: 0, saved: {}, error: null };

const emptyData = () => ({ characters: [], vault: [], pets: [], veterans: [] });
export function ownerEntries(owner) {
  const d = owner?.data || emptyData(); const entries = (d.characters || []).map(e => ({ ...e, vault: [...(e.vault || [])] }));
  // Items in the owner-level vault that no entry carries ride along on the first entry, so VAULT_PULL can see them.
  const seen = new Set(entries.flatMap(e => e.vault.map(it => it.id)));
  const loose = (d.vault || []).filter(it => it && it.id && !seen.has(it.id));
  if (loose.length && entries.length) entries[0].vault.push(...loose);
  return entries;
}

// Load (or create) this device's roster owner. Cached; concurrent callers share one load.
export async function loadOwner(backend, { displayName = '' } = {}) {
  if (rosterUi.owner) return rosterUi.owner;
  if (!rosterUi.loading) {
    rosterUi.loading = (async () => {
      const deviceId = backend.identity().deviceId;
      let owner = await backend.roster.forDevice(deviceId);
      if (!owner) owner = await backend.roster.create(deviceId, displayName);
      owner.data = { ...emptyData(), ...(owner.data || {}) };
      rosterUi.owner = owner; return owner;
    })().catch(e => { rosterUi.error = e.message; rosterUi.loading = null; throw e; });
  }
  return rosterUi.loading;
}

// Claim the seat for the owner and push the owner's entries into the room. Once per seat per page load.
export async function ensureRoster(session, backend, playerId, { force = false } = {}) {
  if (!session || !backend?.roster || !playerId) return null;
  const p = session.state.players[playerId]; if (!p || p.spectator) return null;
  const owner = await loadOwner(backend, { displayName: p.name });
  const key = `${session.code || session.roomId}:${playerId}`;
  if (p.rosterOwnerId !== owner.id && (force || !rosterUi.claimed.has(key))) {
    rosterUi.claimed.add(key);
    try { await session.dispatch('ROSTER_CLAIM', { playerId, ownerId: owner.id }, playerId); } catch (e) { console.warn('ROSTER_CLAIM', e); }
  }
  if (force || !rosterUi.synced.has(key)) {
    rosterUi.synced.add(key);
    try { await session.dispatch('ROSTER_SYNC', { ownerId: owner.id, entries: ownerEntries(owner) }, playerId); } catch (e) { console.warn('ROSTER_SYNC', e); }
  }
  return owner;
}
// Redeem a claim code on this phone: the owner (and all its characters, vault and pets) now belongs to this device too.
export async function recoverRoster(session, backend, playerId, code) {
  const clean = String(code || '').trim().toUpperCase(); if (!clean) throw new Error('Type the code first');
  const owner = await backend.roster.claim(clean, backend.identity().deviceId);
  owner.data = { ...emptyData(), ...(owner.data || {}) };
  rosterUi.owner = owner; rosterUi.loading = Promise.resolve(owner);
  if (session && playerId) await ensureRoster(session, backend, playerId, { force: true });
  return owner;
}

// ── save-back at the end of the run ──────────────────────────────
// Merge the room's export for this seat into the owner's data and save. Returns { entry, owner, wallRows } or null.
// Idempotent per room + seat (re-running after VAULT_BANK / VETERAN_SAVE updates the same entry).
export async function saveBack({ state, playerId, backend, session = null }) {
  if (!state || state.phase !== 'ended' || !backend?.roster) return null;
  const entry = rosterExport(state, playerId); if (!entry) return null;
  const owner = rosterUi.owner || await loadOwner(backend).catch(() => null); if (!owner) return null;
  const sig = JSON.stringify([entry.id, entry.alive, entry.level, entry.vault.map(i => i.id), entry.veteran, entry.pets.map(p => p.id)]);
  const key = `${state.code}:${playerId}`;
  if (rosterUi.saved[key] === sig) return { entry, owner, wallRows: [], unchanged: true };
  const d = owner.data = { ...emptyData(), ...(owner.data || {}) };
  entry.ownerId = owner.id;
  const i = d.characters.findIndex(e => e.id === entry.id); if (i >= 0) d.characters[i] = entry; else d.characters.push(entry);
  const byId = (list) => { const m = new Map(); for (const x of list) if (x && x.id) m.set(x.id, x); return [...m.values()]; };
  d.vault = byId([...(d.vault || []).filter(it => !entry.vault.some(v => v.id === it.id)), ...entry.vault]);
  d.pets = byId([...(d.pets || []), ...entry.pets]);
  d.veterans = d.characters.filter(e => e.alive && e.veteran).map(e => e.id);
  await backend.roster.save(owner);
  const c = characterOf(state, playerId); const wallRows = [];
  if (!entry.alive && c) {
    wallRows.push({ name: c.name, classId: c.classId, level: c.level, diedAt: entry.diedAt || Date.now(), cause: c.diedTo || null, room: state.code, mode: state.mode, ownerId: owner.id });
    try { await backend.wall.add(wallRows); rosterUi.wall = null; } catch (e) { console.warn('wall.add', e); }
  }
  rosterUi.saved[key] = sig; store.set(`gwfrpg:savedback:${key}`, Date.now());
  return { entry, owner, wallRows };
}

// ── panels ───────────────────────────────────────────────────────
// The claim code: big and dashed; "enter this code on a new phone's Self tab to recover your roster"; the Recover form.
export function claimPanel({ session, backend, playerId, onChange } = {}) {
  const owner = rosterUi.owner;
  const input = h('input', { class: 'code', maxlength: 8, placeholder: 'CODE', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Claim code to recover', style: { fontSize: '1.3rem', letterSpacing: '.3em' } });
  const go = async () => {
    const btn = recoverBtn; btn.disabled = true;
    try { const o = await recoverRoster(session, backend, playerId, input.value); toast(`Roster ${o.claimCode} is now on this phone`); onChange?.(o); }
    catch (e) { toast(e.message || 'No roster with that code', 'bad'); btn.disabled = false; }
  };
  const recoverBtn = h('button', { class: 'primary', onClick: go }, 'Recover');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const n = owner ? (owner.data?.characters || []).length : 0;
  return h('div', { class: 'panel gold col claim-panel' },
    h('h3', {}, 'Your roster'),
    owner ? h('div', { class: 'claim', 'aria-label': 'claim code' }, owner.claimCode || '—') : h('p', { class: 'muted ital' }, rosterUi.error ? `Roster unavailable: ${rosterUi.error}` : 'Loading your roster…'),
    h('p', { class: 'muted small' }, 'Enter this code on a new phone’s Self tab to recover your roster: your characters, veterans, vault and pets follow the code, not the phone.'),
    owner ? h('p', { class: 'muted small ital' }, `${n} character${n === 1 ? '' : 's'} on record · ${(owner.data?.vault || []).length} in the vault · ${(owner.data?.pets || []).length} pet${(owner.data?.pets || []).length === 1 ? '' : 's'}`) : null,
    h('div', { class: 'hr' }),
    h('div', { class: 'tag' }, 'Recover a roster'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, input), recoverBtn));
}

// The Wall of Names from the backend (cached a minute). Renders a list; re-renders itself when the load lands.
export function wallPanel({ backend, state } = {}) {
  const box = h('div', { class: 'panel wall-panel' }, h('h3', {}, 'The Wall of Names'));
  const draw = (rows) => {
    const names = rows?.length ? rows : (state?.wall || []).map(n => ({ name: n }));
    box.replaceChildren(h('h3', {}, 'The Wall of Names'),
      names.length ? h('div', { class: 'wall-list' }, names.slice().sort((a, b) => (b.diedAt || 0) - (a.diedAt || 0)).map(r => h('div', { class: 'wall-row' }, h('span', { class: 'wall-name' }, r.name), h('span', { class: 'muted small ital' }, [r.classId ? cap(r.classId) : null, r.level ? `Lv ${r.level}` : null, r.diedAt ? new Date(r.diedAt).toLocaleDateString() : null].filter(Boolean).join(' · ')))))
        : h('p', { class: 'muted ital' }, 'No names yet. The Wall waits.'),
      h('p', { class: 'muted small ital' }, 'A name on the Wall can never be used again.'));
  };
  draw(rosterUi.wall);
  if (backend?.wall && (!rosterUi.wall || Date.now() - rosterUi.wallAt > 60000)) backend.wall.all().then(rows => { rosterUi.wall = rows || []; rosterUi.wallAt = Date.now(); if (box.isConnected) draw(rosterUi.wall); }).catch(() => {});
  return box;
}

// The rulebook in a drawer: data/rulebook.generated.json sections as collapsible blocks.
export function rulesDrawer({ open = false } = {}) {
  const block = (b) => {
    if (b.type === 'p') return h('p', {}, b.text);
    if (b.type === 'list') return h('ul', { class: 'rules-list' }, (b.items || []).map(t => h('li', {}, t)));
    if (b.type === 'table') return h('div', { class: 'rules-table-wrap' }, h('table', { class: 'rules-table' }, h('thead', {}, h('tr', {}, (b.columns || []).map(cn => h('th', {}, cn)))), h('tbody', {}, (b.rows || []).map(r => h('tr', {}, r.map(cell => h('td', {}, cell)))))));
    return null;
  };
  return h('details', { class: 'drawer rules-drawer', open: open || null }, h('summary', {}, 'The rules'),
    h('div', { class: 'drawer-body' }, (rulebook.sections || []).map(s => h('details', { class: 'rules-section' }, h('summary', {}, s.title), h('div', { class: 'rules-body' }, (s.blocks || []).map(block))))));
}

// The look editor: steppers for body / skin / face / hair, a coat colour, a live preview. onChange(look) on every
// edit; the returned element exposes .look. Used by the Mirror on Self and by the creation flow.
export function lookEditor(look = {}, onChange = null, { classId = null, crest = '🂠', name = '' } = {}) {
  const cur = cleanLook(look);
  const preview = { name, crest, classId, look: cur, worn: emptyWorn(), health: 1, maxHealth: 1, pets: [], effects: [] };
  const canvas = spriteElement(preview, { scale: 2, pets: false, className: 'sprite look-preview' });
  const labels = { body: ['Slight', 'Sturdy', 'Broad'], skin: null, face: null, hair: null };
  const rows = {};
  const step = (k, d) => { const n = LOOK_RANGES[k]; cur[k] = ((cur[k] + d) % n + n) % n; rows[k].textContent = labelFor(k); canvas.redraw?.(); onChange?.({ ...cur }); };
  const labelFor = (k) => labels[k]?.[cur[k]] || `${cap(k)} ${cur[k] + 1} / ${LOOK_RANGES[k]}`;
  const stepper = (k) => h('div', { class: 'look-row' }, h('button', { class: 'mini', 'aria-label': `previous ${k}`, onClick: () => step(k, -1) }, '‹'), (rows[k] = h('span', { class: 'look-val' }, labelFor(k))), h('button', { class: 'mini', 'aria-label': `next ${k}`, onClick: () => step(k, 1) }, '›'));
  const coat = h('input', { type: 'color', value: cur.coat, 'aria-label': 'coat colour', class: 'look-coat' });
  coat.addEventListener('input', () => { cur.coat = coat.value; canvas.redraw?.(); onChange?.({ ...cur }); });
  const el = h('div', { class: 'look-editor' }, h('div', { class: 'look-preview-box' }, canvas), h('div', { class: 'look-controls' }, ['body', 'skin', 'face', 'hair'].map(stepper), h('div', { class: 'look-row' }, h('span', { class: 'look-val' }, 'Coat'), coat)));
  el.look = cur; el.preview = preview;
  return el;
}
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
export { rosterExport };
