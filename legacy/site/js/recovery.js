// Crash recovery (loop 26): state versioning + migration, a health audit with safe repairs, and rolling
// backups in localStorage. All pure except for the `storage` argument (defaults to localStorage), so the
// tests drive it with an in-memory stand-in.
export const STATE_VERSION = 2;
export const BACKUP_KEY = 'gwf_backups';
export const STATE_KEY = 'gwf_state';
export const BACKUP_MAX = 4;
export const BACKUP_EVERY_MS = 5 * 60 * 1000;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

// Player fields every build expects, with the value an older save should get.
const PLAYER_DEFAULTS = () => ({ iconUrl: '', pos: 0, balances: { Gold: 0 }, jailTier: 0, jailSkipNextSpin: false, jailSpinsNextTurn: 1, skipTurns: 0,
  winMult: null, pardons: 0, collector: null, heldPowerUps: [], debuffs: [], loans: [], power: 0, pets: [], activePetId: null });
const STATE_DEFAULTS = () => ({ themeId: 'noir', players: [], board: [], turnOrder: [], turnIdx: 0, round: 1, phase: 'setup', move: null, lastSpin: null,
  shopRates: {}, banner: '', ledger: [], stakes: [], configSource: 'defaults' });

// Bring a save from any earlier build up to the current shape. Mutates and returns { state, from, to, notes }.
export function migrateState(state) {
  const notes = [];
  if (!isObj(state)) return { state: null, from: null, to: STATE_VERSION, notes: ['not a saved game'] };
  const from = fin(state.v) ? state.v : 0;
  for (const [k, v] of Object.entries(STATE_DEFAULTS())) if (state[k] === undefined) { state[k] = v; notes.push(`added ${k}`); }
  for (const k of ['players', 'board', 'turnOrder', 'ledger', 'stakes']) if (!Array.isArray(state[k])) { state[k] = []; notes.push(`reset ${k}`); }
  state.players = state.players.filter(p => isObj(p) && p.id != null);
  for (const p of state.players) {
    for (const [k, v] of Object.entries(PLAYER_DEFAULTS())) if (p[k] === undefined) { p[k] = v; notes.push(`${p.name || p.id}: added ${k}`); }
    if (!isObj(p.balances)) { p.balances = { Gold: 0 }; notes.push(`${p.name || p.id}: reset balances`); }
    if (p.balances.Gold === undefined) p.balances.Gold = 0;
    for (const k of ['heldPowerUps', 'debuffs', 'loans', 'pets']) if (!Array.isArray(p[k])) { p[k] = []; notes.push(`${p.name || p.id}: reset ${k}`); }
    if (typeof p.name !== 'string' || !p.name) { p.name = String(p.id); }
  }
  // v1 → v2: ledger rows gained a sequence number `n` (used by sound cues, undo labels, Power accrual).
  if (state.ledger.some(r => isObj(r) && !fin(r.n))) {
    state.ledger = state.ledger.filter(isObj);
    state.ledger.forEach((r, i) => { r.n = i + 1; });
    state.ledgerSeq = state.ledger.length;
    // everything already in the ledger has been counted (or predates Power) — don't pay it out again
    state.powerSeq = state.ledgerSeq;
    notes.push('numbered the ledger');
  }
  const maxN = state.ledger.reduce((m, r) => Math.max(m, fin(r?.n) ? r.n : 0), 0);
  if (!fin(state.ledgerSeq) || state.ledgerSeq < maxN) { if (maxN > 0) notes.push('fixed the ledger counter'); state.ledgerSeq = maxN; }
  if (!fin(state.seed)) { state.seed = (Date.now() >>> 0); notes.push('added a seed'); }
  if (!fin(state.rngState)) { state.rngState = state.seed >>> 0; notes.push('reset the dice sequence'); }
  if (!fin(state.createdAt)) state.createdAt = Date.now();
  if (from !== STATE_VERSION) notes.push(`save format v${from} → v${STATE_VERSION}`);
  state.v = STATE_VERSION;
  return { state, from, to: STATE_VERSION, notes };
}

// Look for damage. Returns [{ level:'error'|'warn', msg }]. Nothing is changed.
export function auditState(state, config = null) {
  const out = [], add = (level, msg) => out.push({ level, msg });
  if (!isObj(state)) { add('error', 'There is no saved game.'); return out; }
  const ids = new Set();
  for (const p of state.players || []) {
    if (ids.has(p.id)) add('error', `Two players share the id ${p.id}.`);
    ids.add(p.id);
    for (const [cur, amt] of Object.entries(p.balances || {})) if (!fin(amt)) add('error', `${p.name}'s ${cur} balance is not a number.`);
    if (!fin(p.pos) || p.pos < 0 || ((state.board || []).length && p.pos >= state.board.length)) add('error', `${p.name} is standing off the board.`);
    if (!fin(p.jailTier) || p.jailTier < 0 || p.jailTier > 4) add('error', `${p.name}'s jail tier is out of range.`);
    if (!fin(p.power) || p.power < 0 || p.power > 1000) add('warn', `${p.name}'s Power is outside 0–1000.`);
    if (p.activePetId != null && !(p.pets || []).some(x => x && x.id === p.activePetId)) add('warn', `${p.name}'s active pet no longer exists.`);
    for (const l of p.loans || []) if (!isObj(l) || !fin(l.owed)) add('error', `${p.name} has a broken loan record.`);
  }
  for (const id of state.turnOrder || []) if (!ids.has(id)) add('error', 'The turn order names a player who is not at the table.');
  if (new Set(state.turnOrder || []).size !== (state.turnOrder || []).length) add('error', 'A player appears twice in the turn order.');
  if (state.phase === 'playing') {
    if (!(state.board || []).length) add('error', 'The session is running but there is no board.');
    if (!(state.turnOrder || []).length) add('error', 'The session is running but nobody is in the turn order.');
    else if (!Number.isInteger(state.turnIdx) || state.turnIdx < 0) add('error', 'The turn pointer is not a valid number.');   // turnIdx counts every turn taken; whose turn it is = turnIdx mod players
  }
  if (state.game && !ids.has(state.game.playerId)) add('error', 'A minigame is open for a player who is not at the table.');
  if (state.move && !ids.has(state.move.playerId)) add('error', 'A move is in progress for a player who is not at the table.');
  if (!fin(state.round) || state.round < 1) add('warn', 'The round counter is invalid.');
  if (config && Array.isArray(config.Games) && (state.board || []).some(t => t && t.type === 'GAME' && t.gameId && !config.Games.some(g => g.id === t.gameId)))
    add('warn', 'Some board tiles point at a game that is not in the config (they will fall back to GM Call).');
  return out;
}

// Fix everything auditState can find without guessing at money. Mutates; returns the list of fixes made.
export function repairState(state, config = null) {
  const fixes = [];
  if (!isObj(state)) return fixes;
  const seen = new Set();
  state.players = (state.players || []).filter(p => { if (seen.has(p.id)) { fixes.push(`removed a duplicate of ${p.name}`); return false; } seen.add(p.id); return true; });
  const n = (state.board || []).length;
  for (const p of state.players) {
    for (const [cur, amt] of Object.entries(p.balances || {})) if (!fin(amt)) { const num = Number(amt); p.balances[cur] = Number.isFinite(num) ? num : 0; fixes.push(`${p.name}'s ${cur} reset to ${p.balances[cur]}`); }
    if (!fin(p.pos) || p.pos < 0 || (n && p.pos >= n)) { const start = (state.board || []).findIndex(t => t && t.type === 'START'); p.pos = start >= 0 ? start : 0; fixes.push(`${p.name} moved back to START`); }
    if (!fin(p.jailTier) || p.jailTier < 0 || p.jailTier > 4) { p.jailTier = Math.min(4, Math.max(0, Math.round(Number(p.jailTier)) || 0)); fixes.push(`${p.name}'s jail tier clamped`); }
    if (!fin(p.power) || p.power < 0 || p.power > 1000) { p.power = Math.min(1000, Math.max(0, Math.round(Number(p.power)) || 0)); fixes.push(`${p.name}'s Power clamped`); }
    p.pets = (p.pets || []).filter(isObj);
    if (p.activePetId != null && !p.pets.some(x => x.id === p.activePetId)) { p.activePetId = p.pets[0]?.id ?? null; fixes.push(`${p.name}'s active pet reset`); }
    const loans = (p.loans || []).filter(l => isObj(l) && fin(l.owed));
    if (loans.length !== (p.loans || []).length) { p.loans = loans; fixes.push(`${p.name}: dropped a broken loan record`); }
  }
  const ids = new Set(state.players.map(p => p.id));
  const order = [...new Set((state.turnOrder || []).filter(id => ids.has(id)))];
  if (order.length !== (state.turnOrder || []).length) { state.turnOrder = order; fixes.push('cleaned the turn order'); }
  if (state.phase === 'playing' && !state.turnOrder.length && state.players.length) { state.turnOrder = state.players.map(p => p.id); fixes.push('rebuilt the turn order'); }
  if (!Number.isInteger(state.turnIdx) || state.turnIdx < 0) { state.turnIdx = 0; fixes.push('turn pointer reset to the first player'); }
  if (state.game && !ids.has(state.game.playerId)) { state.game = null; fixes.push('closed an orphaned minigame (no money moved)'); }
  if (state.move && !ids.has(state.move.playerId)) { state.move = null; fixes.push('cancelled an orphaned move'); }
  if (!fin(state.round) || state.round < 1) { state.round = 1; fixes.push('round counter reset'); }
  if (state.phase === 'playing' && !n) { state.phase = 'setup'; fixes.push('no board — back to setup'); }
  return fixes;
}

// ── Rolling backups ──────────────────────────────────────────────────────────────────────────────
const store = (s) => s || globalThis.localStorage;
function readBackups(storage) { try { const a = JSON.parse(store(storage).getItem(BACKUP_KEY) || '[]'); return Array.isArray(a) ? a.filter(b => isObj(b) && typeof b.json === 'string') : []; } catch { return []; } }
function writeBackups(storage, list) {
  // If the browser is out of room, give up the oldest backups rather than fail.
  let l = list.slice();
  for (;;) {
    try { if (l.length) store(storage).setItem(BACKUP_KEY, JSON.stringify(l)); else store(storage).removeItem(BACKUP_KEY); return l.length; }
    catch { if (!l.length) return 0; l = l.slice(1); }
  }
}
export function listBackups(storage) {
  return readBackups(storage).map(b => ({ id: b.id, ts: b.ts, reason: b.reason, round: b.round, players: b.players, phase: b.phase, bytes: b.json.length })).reverse();
}
// When is a new restore point worth taking? New round, phase change, player count change, or enough time passed.
export function backupReason(lastMeta, state, now = Date.now()) {
  if (!isObj(state) || !(state.players || []).length) return null;
  if (!lastMeta) return 'first save';
  if (lastMeta.phase !== state.phase) return state.phase === 'ended' ? 'session ended' : state.phase === 'playing' ? 'session started' : 'phase change';
  if (lastMeta.round !== state.round) return `round ${state.round}`;
  if (lastMeta.players !== state.players.length) return 'players changed';
  if (now - lastMeta.ts >= BACKUP_EVERY_MS) return 'timed';
  return null;
}
export function saveBackup(state, reason, { storage, now = Date.now(), max = BACKUP_MAX, json = null } = {}) {
  const list = readBackups(storage);
  list.push({ id: `${now}-${list.length}`, ts: now, reason, round: state.round, players: state.players.length, phase: state.phase, json: json || JSON.stringify(state) });
  while (list.length > max) list.shift();
  const kept = writeBackups(storage, list);
  return { kept, meta: listBackups(storage)[0] || null };
}
export function maybeBackup(state, opts = {}) {
  const last = listBackups(opts.storage)[0] || null;
  const reason = backupReason(last, state, opts.now ?? Date.now());
  return reason ? { reason, ...saveBackup(state, reason, opts) } : null;
}
export function loadBackup(id, storage) {
  const b = readBackups(storage).find(x => x.id === id); if (!b) return null;
  try { return migrateState(JSON.parse(b.json)).state; } catch { return null; }
}
export function clearBackups(storage) { store(storage).removeItem(BACKUP_KEY); }

// Write the live state; if the browser is full, drop backups (oldest first) and try again.
export function safeSave(json, { storage, key = STATE_KEY } = {}) {
  const s = store(storage); let dropped = 0;
  for (;;) {
    try { s.setItem(key, json); return { ok: true, dropped }; }
    catch (e) {
      const list = readBackups(storage);
      if (!list.length) return { ok: false, dropped, error: String(e && e.message || e) };
      list.shift(); dropped++;
      try { if (list.length) s.setItem(BACKUP_KEY, JSON.stringify(list)); else s.removeItem(BACKUP_KEY); } catch { s.removeItem(BACKUP_KEY); }
    }
  }
}

// Read the live state; if it is unreadable, fall back to the newest backup that parses.
// (No live state at all means a fresh start — a deliberate wipe must stay wiped.)
export function recoverState({ storage, key = STATE_KEY } = {}) {
  const raw = store(storage).getItem(key);
  if (raw) {
    try { const st = JSON.parse(raw); if (isObj(st)) { const m = migrateState(st); return { state: m.state, source: 'live', notes: m.notes }; } } catch { /* fall through to backups */ }
  }
  if (!raw) return { state: null, source: 'none', notes: [] };          // nothing saved (or wiped on purpose): start fresh
  const list = readBackups(storage);
  for (let i = list.length - 1; i >= 0; i--) {
    try { const st = JSON.parse(list[i].json); if (isObj(st)) { const m = migrateState(st); return { state: m.state, source: 'backup', backup: { ts: list[i].ts, reason: list[i].reason, round: list[i].round }, notes: m.notes }; } } catch { /* try an older one */ }
  }
  return { state: null, source: 'corrupt', notes: [] };
}

export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
}
