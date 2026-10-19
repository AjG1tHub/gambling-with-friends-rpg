// Roster, vault, veterans and the Wall of Names (SPEC.md › Runs, game modes and meta progression; End of the run).
// The backend holds the real roster per claim-code owner; the room only mirrors it in state.roster so the
// reducer can check names, tiers and vault contents. Claim codes themselves are backend business: a phone
// redeems one and binds its seat to an ownerId with ROSTER_CLAIM; this module only carries ownerId.
//
// Events:
//   ROSTER_SYNC {ownerId, entries: [RosterEntry]}  the phone pushes what the backend returned for its owner
//   ROSTER_CLAIM {playerId, ownerId}               bind a seat to a roster owner (GM_REASSIGN_ROSTER in lobby.js too)
//   VAULT_BANK {playerId, itemIds}                 at run end: a survivor banks grid.vaultSurvivor items, the dead grid.vaultDead
//   VETERAN_SAVE {playerId}                        at run end: a survivor is kept as a veteran
// RosterEntry = { id, ownerId, name, classId, look, crest, level, stats, worn, alive, diedAt, vault: [Item], pets: [Pet], titles }
// rosterExport(state, playerId) builds the entry the phone writes back to the backend after the run (and the
// mirror is updated the same way on VAULT_BANK / VETERAN_SAVE). A character that died at any point in the run
// is dead on the roster: its name is on the Wall, its look and class can be reused under a new name.
import { register, refuse, requirePhase, requireActor, requirePlayer, hasHandler, onAfter } from '../reducer.js';
import { characterOf, note } from '../state.js';
import { deathHooks } from '../hooks.js';
import { WORN_SLOTS, STAT_IDS } from '../characters/character.js';
import { wornSlotOf } from './inventory.js';
import * as G from '../characters/grid.js';

const norm = (s) => String(s || '').trim().toLowerCase();
export const rosterEntryId = (state, c) => c.rosterId || `${state.roomId || state.code || 'room'}:${c.id}`;
export const isAliveForRoster = (c) => !!c && !c.dead && !(c.deaths > 0);

function cleanEntry(e, ownerId) {
  if (!e || typeof e !== 'object' || !e.id || !e.name) return null;
  const stats = {}; for (const s of STAT_IDS) stats[s] = Number(e.stats?.[s]) || 1;
  const worn = {}; for (const s of WORN_SLOTS) worn[s] = e.worn?.[s] && typeof e.worn[s] === 'object' ? e.worn[s] : null;
  return { id: String(e.id), ownerId, name: String(e.name).slice(0, 18), classId: e.classId || null, look: e.look || null, crest: e.crest || null, level: Math.max(1, Math.round(Number(e.level) || 1)), stats, worn,
    alive: e.alive !== false, diedAt: e.diedAt ?? null, vault: Array.isArray(e.vault) ? e.vault.filter(it => it && it.id) : [], pets: Array.isArray(e.pets) ? e.pets.filter(p => p && p.id) : [], titles: Array.isArray(e.titles) ? e.titles : [], runs: Number(e.runs) || 0 };
}

export function rosterExport(state, playerId) {
  const p = state.players[playerId]; const c = characterOf(state, playerId); if (!p || !c) return null;
  const id = rosterEntryId(state, c); const prev = state.roster[id];
  const alive = isAliveForRoster(c);
  const pets = (c.pets || []).map(pet => ({ ...structuredClone(pet), fainted: false, faintedAt: null, power: pet.maxPower || pet.power, bodies: pet.bodies != null ? Math.max(1, pet.bodies) : undefined }));
  const worn = {}; for (const s of WORN_SLOTS) worn[s] = alive && c.worn[s] ? structuredClone(c.worn[s]) : null;
  const vault = [...(prev?.vault || []), ...(c.vaulted || [])].filter((it, i, arr) => arr.findIndex(x => x.id === it.id) === i);
  return { id, ownerId: p.rosterOwnerId || null, name: c.name, classId: c.classId, look: structuredClone(c.look), crest: c.crest, level: alive ? c.level : 1, stats: alive ? { ...c.stats } : { ...(prev?.stats || c.stats) },
    worn, alive, diedAt: alive ? null : (c.diedAt || state.endedAt || state.lastEventTs), vault, pets, titles: [...(c.titles || [])], runs: prev?.lastRoom === state.code ? prev.runs : (prev?.runs || 0) + 1, veteran: !!c.veteran, lastRoom: state.code, lastMode: state.mode, lastTier: state.tier };
}
function mirror(state, playerId) { const e = rosterExport(state, playerId); if (e) state.roster[e.id] = e; return e; }

register({
  ROSTER_SYNC(state, ev, ctx) {
    const { ownerId, entries } = ctx.payload; if (!ownerId) refuse('ownerId required');
    if (!ctx.isGm && !Object.values(state.players).some(p => p.id === ctx.actor && p.rosterOwnerId === ownerId)) refuse('not your roster', 'forbidden');
    for (const id of Object.keys(state.roster)) if (state.roster[id].ownerId === ownerId) delete state.roster[id];
    for (const raw of entries || []) { const e = cleanEntry(raw, ownerId); if (e) state.roster[e.id] = e; }
    for (const e of Object.values(state.roster)) if (!e.alive && e.ownerId === ownerId && !state.wall.some(w => norm(w) === norm(e.name))) state.wall.push(e.name);
  },
  ROSTER_CLAIM(state, ev, ctx) {
    const p = requirePlayer(state, ctx.payload.playerId); requireActor(state, ctx, p.id);
    if (!ctx.payload.ownerId) refuse('ownerId required');
    p.rosterOwnerId = String(ctx.payload.ownerId);
    note(state, `${p.name} claims their roster`, 'join', ctx.now);
  },
});
// VAULT_BANK / VETERAN_SAVE: handlers/modes.js registers a thinner pair of these too (c.vaulted / c.veteran only).
// Registering twice throws, so these are registered only when nothing has claimed the events yet; import this
// module before modes.js (or drop the modes.js pair) to get the roster mirror and the item removal below.
const endOfRun = {
  VAULT_BANK(state, ev, ctx) {
    requirePhase(state, 'ended');
    const p = requirePlayer(state, ctx.payload.playerId); requireActor(state, ctx, p.id);
    const c = characterOf(state, p.id); if (!c) refuse('no character');
    const Gb = ctx.B('grid'); const ids = [...new Set(ctx.payload.itemIds || [])];
    const cap = (isAliveForRoster(c) ? Gb.vaultSurvivor : Gb.vaultDead) + (c.flags?.extraVault || 0) + (c.vaultBonus || 0);
    if ((c.vaulted?.length || 0) + ids.length > cap) refuse(`you may vault ${cap} item${cap === 1 ? '' : 's'}`, 'vault');
    c.vaulted = c.vaulted || [];
    for (const id of ids) {
      const it = c.items[id]; if (!it) refuse(`${id} is not yours`, 'item');
      const slot = wornSlotOf(c, id); if (slot) c.worn[slot] = null; G.remove(c, id, { forget: true });
      c.vaulted.push(structuredClone(it));
      note(state, `${c.name} vaults ${it.name}`, 'vault', ctx.now);
    }
    mirror(state, p.id);
  },
  VETERAN_SAVE(state, ev, ctx) {
    requirePhase(state, 'ended');
    const p = requirePlayer(state, ctx.payload.playerId); requireActor(state, ctx, p.id);
    const c = characterOf(state, p.id); if (!c) refuse('no character');
    if (!isAliveForRoster(c)) refuse(`${c.name} did not survive the run`, 'dead');
    c.veteran = true; mirror(state, p.id);
    note(state, `${c.name} is saved as a veteran (level ${c.level})`, 'vault', ctx.now);
  },
};
for (const [type, fn] of Object.entries(endOfRun)) if (!hasHandler(type)) register({ [type]: fn });
// Whoever handles the two end-of-run events, the roster mirror reflects the result (c.vaulted / c.veteran).
onAfter((state, ev) => { if ((ev.type === 'VAULT_BANK' || ev.type === 'VETERAN_SAVE') && state.phase === 'ended') { const pid = ev.payload?.playerId || ev.actor; if (state.players[pid]) mirror(state, pid); } });

// The Wall of Names: a character's first death retires its name. info = { charId, killerId, cause }.
deathHooks.onDeath.push((state, ctx, info) => {
  const c = state.characters[info?.charId]; if (!c) return;
  c.diedAt = c.diedAt || ctx.now;
  if (!state.wall.some(w => norm(w) === norm(c.name))) { state.wall.push(c.name); note(state, `${c.name} goes on the Wall of Names`, 'death', ctx.now); }
});
