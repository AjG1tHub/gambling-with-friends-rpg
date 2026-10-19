// Room, seats and the GM's player management. ROOM_CREATED is always the first event in a room's log.
import { register, refuse, requireGm, requirePhase, requirePlayer } from '../reducer.js';
import { initialState, newPlayer, note } from '../state.js';
import { pauseAll, resumeAll } from '../clock.js';
import { checkOverrides } from '../balance.js';
import { rig } from '../rng.js';

const MAX_NAME = 18;
export const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, MAX_NAME);

register({
  ROOM_CREATED(state, ev, ctx) {
    // The reducer hands a placeholder for the first event; we replace every field.
    const p = ctx.payload;
    const fresh = initialState({ roomId: p.roomId || ev.roomId, code: p.code, seed: p.seed, mode: p.mode, tier: p.tier, size: p.size, gmPinHash: p.gmPinHash, createdAt: ctx.now, gmDeviceId: p.gmDeviceId || null });
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    if (p.balance) { const bad = checkOverrides(p.balance); if (bad.length) refuse(bad.join('; ')); state.balance = p.balance; }
    if (p.challengePreset) state.gm.challengePreset = p.challengePreset;
    if (p.fogOfWar != null) state.gm.fogOfWar = !!p.fogOfWar;
    note(state, `Room ${state.code} opened (${state.mode}, tier ${state.tier}, ${state.size})`, 'info', ctx.now);
  },
  PLAYER_JOIN(state, ev, ctx) {
    const { playerId, name, deviceId, spectator = false, isGm = false } = ctx.payload;
    if (!playerId) refuse('playerId required');
    const max = ctx.B('table').maxPlayers;
    const existing = state.players[playerId];
    if (existing) { existing.connected = true; existing.lastSeenTs = ctx.now; existing.kicked = false; if (deviceId) existing.deviceId = deviceId; return; }
    // A device that already has a seat reconnects to it instead of taking a second one.
    const byDevice = deviceId && Object.values(state.players).find(p => p.deviceId === deviceId && !p.kicked);
    if (byDevice) { byDevice.connected = true; byDevice.lastSeenTs = ctx.now; return; }
    const seated = Object.values(state.players).filter(p => !p.spectator && !p.kicked).length;
    if (!spectator && seated >= max) refuse(`table is full (${max})`, 'full');
    if (!spectator && state.phase === 'playing') refuse('the run has started; join as a spectator', 'phase');
    const player = newPlayer({ id: playerId, name: cleanName(name) || `Player ${seated + 1}`, deviceId, spectator, isGm, joinedAt: ctx.now });
    state.players[playerId] = player;
    if (!spectator) state.seats.push(playerId);
    state.stats[playerId] = { turns: 0, hits: 0, crits: 0, kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0, bosses: 0, petsCaught: 0, goldEarned: 0, challengesWon: 0, challengesLost: 0, lettersSent: 0 };
    note(state, `${player.name} ${spectator ? 'is watching' : 'sat down'}`, 'join', ctx.now);
  },
  SPECTATE(state, ev, ctx) { const p = requirePlayer(state, ctx.payload.playerId); p.spectator = true; state.seats = state.seats.filter(id => id !== p.id); },
  PLAYER_SEEN(state, ev, ctx) { const p = state.players[ctx.payload.playerId]; if (p) { p.lastSeenTs = ctx.now; p.connected = true; } },
  PLAYER_LEAVE(state, ev, ctx) { const p = state.players[ctx.payload.playerId]; if (p) { p.connected = false; p.lastSeenTs = ctx.now; } },
  PLAYER_RECONNECT(state, ev, ctx) {
    const p = requirePlayer(state, ctx.payload.playerId);
    p.connected = true; p.lastSeenTs = ctx.now;
    if (ctx.payload.deviceId) p.deviceId = ctx.payload.deviceId;
    // Reconnecting takes the seat back from the GM proxy without a GM action.
    if (p.proxied) { p.proxied = false; delete state.gm.proxies[p.id]; note(state, `${p.name} is back`, 'join', ctx.now); }
  },
  PLAYER_RENAME(state, ev, ctx) { const p = requirePlayer(state, ctx.payload.playerId); if (!ctx.isGm && ctx.actor !== p.id) refuse('not your seat', 'forbidden'); const n = cleanName(ctx.payload.name); if (!n) refuse('name required'); p.name = n; },
  PLAYER_READY(state, ev, ctx) { const p = requirePlayer(state, ctx.payload.playerId); if (!ctx.isGm && ctx.actor !== p.id) refuse('not your seat', 'forbidden'); requirePhase(state, 'lobby', 'creation'); p.ready = ctx.payload.ready !== false; },
  GM_KICK(state, ev, ctx) {
    requireGm(ctx); const p = requirePlayer(state, ctx.payload.playerId);
    p.kicked = true; p.connected = false; p.ready = false;
    state.seats = state.seats.filter(id => id !== p.id);
    delete state.held[p.id];
    if (p.characterId && state.characters[p.characterId]) state.characters[p.characterId].dead = true;
    note(state, `${p.name} was removed by the GM`, 'gm', ctx.now);
  },
  GM_PROXY(state, ev, ctx) {
    requireGm(ctx); const p = requirePlayer(state, ctx.payload.playerId);
    p.proxied = ctx.payload.on !== false;
    if (p.proxied) state.gm.proxies[p.id] = ctx.now; else delete state.gm.proxies[p.id];
    note(state, p.proxied ? `GM is acting for ${p.name}` : `${p.name} has their phone back`, 'gm', ctx.now);
  },
  GM_AUTOPILOT(state, ev, ctx) { requireGm(ctx); const p = requirePlayer(state, ctx.payload.playerId); p.autopilot = ctx.payload.on !== false; note(state, `${p.name} ${p.autopilot ? 'is on autopilot' : 'is off autopilot'}`, 'gm', ctx.now); },
  GM_REASSIGN_ROSTER(state, ev, ctx) {
    requireGm(ctx); const p = requirePlayer(state, ctx.payload.playerId);
    if (!ctx.payload.rosterOwnerId) refuse('rosterOwnerId required');
    p.rosterOwnerId = ctx.payload.rosterOwnerId;
    note(state, `${p.name} now holds roster ${ctx.payload.rosterOwnerId.slice(0, 6)}`, 'gm', ctx.now);
  },
  GM_SET_TEAMS(state, ev, ctx) {
    requireGm(ctx); requirePhase(state, 'lobby', 'creation');
    const teams = ctx.payload.teams || {};   // { teamId: { name, members: [playerId] } }
    state.gm.teams = teams;
    for (const p of Object.values(state.players)) p.teamId = null;
    for (const [tid, t] of Object.entries(teams)) for (const pid of t.members || []) if (state.players[pid]) state.players[pid].teamId = tid;
  },
  GM_PAUSE(state, ev, ctx) { requireGm(ctx); if (state.gm.paused) return; state.gm.paused = true; state.gm.pausedAt = ctx.now; pauseAll(state, ctx.now); note(state, 'Paused', 'gm', ctx.now); },
  GM_RESUME(state, ev, ctx) { requireGm(ctx); if (!state.gm.paused) return; state.gm.paused = false; state.gm.pausedAt = null; resumeAll(state, ctx.now); note(state, 'Resumed', 'gm', ctx.now); },
  GM_BROADCAST(state, ev, ctx) { requireGm(ctx); state.toasts.push({ id: ev.id, to: null, text: String(ctx.payload.text || '').slice(0, 280), ts: ctx.now }); state.toasts = state.toasts.slice(-40); if (ctx.payload.banner) state.banner = String(ctx.payload.text || '').slice(0, 120); },
  GM_WHISPER(state, ev, ctx) { requireGm(ctx); requirePlayer(state, ctx.payload.playerId); state.toasts.push({ id: ev.id, to: ctx.payload.playerId, text: String(ctx.payload.text || '').slice(0, 280), ts: ctx.now }); state.toasts = state.toasts.slice(-40); },
  GM_SPOTLIGHT(state, ev, ctx) { requireGm(ctx); const ids = (ctx.payload.playerIds || []).filter(id => state.players[id]).slice(0, 4); state.gm.spotlight = ids; },
  GM_CONFIG(state, ev, ctx) {
    requireGm(ctx);
    const patch = ctx.payload.balance || {};
    const bad = checkOverrides(patch); if (bad.length) refuse(bad.join('; '));
    for (const [g, keys] of Object.entries(patch)) { state.balance[g] = { ...(state.balance[g] || {}), ...keys }; }
    if (ctx.payload.reset) state.balance = {};
    if (ctx.payload.duelsEnabled != null) state.gm.duelsEnabled = !!ctx.payload.duelsEnabled;
    if (ctx.payload.fogOfWar != null) state.gm.fogOfWar = !!ctx.payload.fogOfWar;
    if (ctx.payload.sideBets != null) state.balance.social = { ...(state.balance.social || {}), sideBetsOn: ctx.payload.sideBets ? 1 : 0 };
    note(state, 'GM changed the config', 'gm', ctx.now);
  },
  GM_RIG(state, ev, ctx) { requireGm(ctx); const { stream, value } = ctx.payload; if (!stream) refuse('stream required'); rig(state, stream, value); },
  GM_RESTORE_POINT(state, ev, ctx) {
    requireGm(ctx);
    const label = String(ctx.payload.label || `Restore ${state.restorePoints.length + 1}`).slice(0, 60);
    const snap = structuredClone(state); snap.restorePoints = [];
    state.restorePoints.push({ id: ev.id, label, ts: ctx.now, seq: ev.seq, snapshot: snap });
    if (state.restorePoints.length > 12) state.restorePoints.shift();
  },
  GM_UNDO(state, ev, ctx) {
    // Restore a snapshot: the whole state except the restore points themselves and the event counters.
    requireGm(ctx);
    const rp = state.restorePoints.find(r => r.id === ctx.payload.restoreId) || state.restorePoints.at(-1);
    if (!rp) refuse('no restore point');
    const keep = { restorePoints: state.restorePoints, eventCount: state.eventCount, lastSeq: state.lastSeq };
    const snap = structuredClone(rp.snapshot);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, snap, keep);
    note(state, `Restored "${rp.label}"`, 'gm', ctx.now);
  },
  ROOM_IMPORT(state, ev, ctx) {
    requireGm(ctx);
    const snap = ctx.payload.state; if (!snap || snap.v !== state.v) refuse('bad import');
    const keep = { roomId: state.roomId, code: state.code, gm: { ...snap.gm, pinHash: state.gm.pinHash } };
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, structuredClone(snap), keep);
    note(state, 'Room imported', 'gm', ctx.now);
  },
});
