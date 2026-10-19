// Supabase backend: rooms + events in Postgres, Realtime postgres_changes for the room channel, roster,
// Wall of Names, Hall of Fame and presets as tables. Uses the publishable key; RLS policies are open by design
// (see supabase/migrations/0001_init.sql).
import { createClient } from '@supabase/supabase-js';
import { uuid } from '../ids.js';

const ID_KEY = 'gwfrpg:identity';
function loadIdentity() {
  try { const v = JSON.parse(localStorage.getItem(ID_KEY) || 'null'); if (v?.deviceId) return v; } catch { /* fresh */ }
  const id = { deviceId: uuid() }; try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch { /* private mode */ }
  return id;
}
const rowToRoom = (r) => r && ({ roomId: r.id, code: r.code, seed: Number(r.seed), mode: r.mode, tier: r.tier, size: r.size, gmPinHash: r.gm_pin_hash, status: r.status, lastSeq: r.last_seq, snapshot: r.snapshot, snapshotSeq: r.snapshot_seq, createdAt: new Date(r.created_at).getTime() });
const rowToEvent = (e) => ({ id: String(e.id), roomId: e.room_id, seq: e.seq, type: e.type, actor: e.actor, ts: Number(e.ts), payload: e.payload || {} });
const rowToOwner = (o) => o && ({ id: o.id, claimCode: o.claim_code, deviceIds: o.device_ids || [], displayName: o.display_name || '', data: o.data || { characters: [], vault: [], pets: [], veterans: [] }, updatedAt: new Date(o.updated_at).getTime() });
const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };

export function createSupabaseBackend({ url, key, client = null } = {}) {
  const sb = client || createClient(url, key, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 20 } } });
  const identity = typeof localStorage !== 'undefined' ? loadIdentity() : { deviceId: uuid() };
  const api = {
    kind: 'supabase', client: sb,
    identity: () => identity,
    async createRoom({ code, seed, mode = 'ffa', tier = 1, size = 'regular', gmPinHash = '' }) {
      const data = must(await sb.from('rooms').insert({ code, seed, mode, tier, size, gm_pin_hash: gmPinHash }).select().single());
      return { roomId: data.id, code: data.code };
    },
    async findRoom(code) { const data = must(await sb.from('rooms').select('*').eq('code', code).order('created_at', { ascending: false }).limit(1)); return rowToRoom(data[0]); },
    async getRoom(roomId) { const data = must(await sb.from('rooms').select('*').eq('id', roomId).maybeSingle()); return rowToRoom(data); },
    async append(roomId, event) {
      const data = must(await sb.rpc('append_event', { p_room_id: roomId, p_type: event.type, p_actor: event.actor, p_ts: event.ts, p_payload: event.payload || {}, p_client_id: identity.deviceId }));
      return rowToEvent(Array.isArray(data) ? data[0] : data);
    },
    async loadEvents(roomId, afterSeq = 0) {
      const out = []; let from = afterSeq;
      for (;;) { const page = must(await sb.from('events').select('*').eq('room_id', roomId).gt('seq', from).order('seq').limit(1000)); out.push(...page.map(rowToEvent)); if (page.length < 1000) break; from = page.at(-1).seq; }
      return out;
    },
    subscribe(roomId, onEvent) {
      const ch = sb.channel(`room:${roomId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `room_id=eq.${roomId}` }, (m) => onEvent(rowToEvent(m.new))).subscribe();
      return () => { sb.removeChannel(ch); };
    },
    async saveSnapshot(roomId, seq, state) { must(await sb.rpc('save_snapshot', { p_room_id: roomId, p_seq: seq, p_state: state })); },
    roster: {
      async forDevice(deviceId) { const data = must(await sb.from('roster_owners').select('*').contains('device_ids', [deviceId]).limit(1)); return rowToOwner(data[0]); },
      async create(deviceId, displayName = '') {
        const { claimCode } = await import('../ids.js');
        for (let i = 0; i < 5; i++) { const res = await sb.from('roster_owners').insert({ claim_code: claimCode(), device_ids: [deviceId], display_name: displayName }).select().single(); if (!res.error) return rowToOwner(res.data); if (!/duplicate/i.test(res.error.message)) throw new Error(res.error.message); }
        throw new Error('could not allocate a claim code');
      },
      async save(owner) { const data = must(await sb.from('roster_owners').update({ data: owner.data, display_name: owner.displayName || null, device_ids: owner.deviceIds, updated_at: new Date().toISOString() }).eq('id', owner.id).select().single()); return rowToOwner(data); },
      async get(ownerId) { const data = must(await sb.from('roster_owners').select('*').eq('id', ownerId).maybeSingle()); return rowToOwner(data); },
      async claim(code, deviceId) { const data = must(await sb.rpc('claim_roster', { p_claim_code: String(code).toUpperCase(), p_device_id: deviceId })); return rowToOwner(Array.isArray(data) ? data[0] : data); },
    },
    wall: {
      async all() { return must(await sb.from('wall_of_names').select('*').order('died_at', { ascending: false })).map(r => ({ nameKey: r.name_key, name: r.name, ownerId: r.owner_id, character: r.character, cause: r.cause, roomCode: r.room_code, diedAt: new Date(r.died_at).getTime() })); },
      async add(rows) { if (!rows.length) return; must(await sb.from('wall_of_names').upsert(rows.map(r => ({ name_key: String(r.name).trim().toLowerCase(), name: r.name, owner_id: r.ownerId || null, character: r.character || null, cause: r.cause || null, room_code: r.roomCode || null })), { onConflict: 'name_key', ignoreDuplicates: true })); },
      async taken(name) { const data = must(await sb.from('wall_of_names').select('name_key').eq('name_key', String(name).trim().toLowerCase()).limit(1)); return data.length > 0; },
    },
    hallOfFame: {
      async list() { return must(await sb.from('hall_of_fame').select('*').order('created_at', { ascending: false }).limit(500)).map(r => ({ id: r.id, roomId: r.room_id, seasonId: r.season_id, kind: r.kind, ...r.data, createdAt: new Date(r.created_at).getTime() })); },
      async add(row) { const { kind = 'run', roomId = null, seasonId = null, ...data } = row; must(await sb.from('hall_of_fame').insert({ kind, room_id: roomId, season_id: seasonId, data })); },
    },
    presets: {
      async list() { return must(await sb.from('challenge_presets').select('*')).map(r => ({ id: r.id, name: r.name, entries: r.entries })); },
      async save(p) { must(await sb.from('challenge_presets').upsert({ id: p.id, name: p.name, entries: p.entries, updated_at: new Date().toISOString() })); return p; },
    },
    metaLedger: {
      async add(rows) { if (rows.length) must(await sb.from('meta_ledger').insert(rows.map(r => ({ room_id: r.roomId || null, season_id: r.seasonId || null, player_name: r.playerName, owner_id: r.ownerId || null, buy_in: r.buyIn ?? null, mode: r.mode || null, placing: r.placing ?? null, character_name: r.characterName || null, vaulted: r.vaulted || null, notes: r.notes || null })))); },
      async list() { return must(await sb.from('meta_ledger').select('*').order('created_at', { ascending: false }).limit(1000)); },
    },
    seasons: {
      async current() { const data = must(await sb.from('seasons').select('*').is('ended_at', null).order('id', { ascending: false }).limit(1)); if (data[0]) return { id: data[0].id, name: data[0].name, nights: data[0].nights, startedAt: new Date(data[0].started_at).getTime(), data: data[0].data }; const s = must(await sb.from('seasons').insert({ name: 'Season 1' }).select().single()); return { id: s.id, name: s.name, nights: 0, startedAt: Date.now(), data: {} }; },
      async save(s) { must(await sb.from('seasons').update({ nights: s.nights, data: s.data || {}, ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : null }).eq('id', s.id)); return s; },
    },
  };
  return api;
}
