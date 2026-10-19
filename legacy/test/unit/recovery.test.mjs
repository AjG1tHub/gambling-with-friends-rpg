// Loop 26 — crash recovery: old saves migrate, damage is found and repaired, backups roll, a full browser degrades gracefully.
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, E, mkGame, DEFAULT_CONFIG } from './_helpers.mjs';
const RC = await import('../../site/js/recovery.js');
const PT = await import('../../site/js/pets.js');

// in-memory storage with an optional byte budget (to act like a full browser)
function mem(limit = Infinity) {
  const m = new Map();
  const size = () => [...m.values()].reduce((s, v) => s + v.length, 0);
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { v = String(v); const after = size() - (m.get(k)?.length || 0) + v.length; if (after > limit) throw new Error('QuotaExceededError'); m.set(k, v); } };
}
// what a save from the September build looked like: no v2 fields at all
function oldSave() {
  const { state } = mkGame(['Aj', 'Nick']);
  for (const p of state.players) { delete p.loans; delete p.power; delete p.pets; delete p.activePetId; }
  delete state.stakes; delete state.ledgerSeq; state.v = 1;
  state.ledger = [{ ts: 1, type: 'SESSION_START', playerId: null }, { ts: 2, type: 'CREDIT', playerId: 'p0', cur: 'Gold', amount: 100 }, { ts: 3, type: 'GAME', playerId: 'p0', won: true }];
  return state;
}

test('a new session is stamped with the current save version', () => {
  assert.equal(S.initialState(DEFAULT_CONFIG, 1).v, RC.STATE_VERSION);
});
test('migrating a September save adds every field the current build needs', () => {
  const m = RC.migrateState(oldSave());
  assert.equal(m.from, 1); assert.equal(m.state.v, RC.STATE_VERSION);
  for (const p of m.state.players) { assert.deepEqual(p.loans, []); assert.deepEqual(p.pets, []); assert.equal(p.power, 0); assert.equal(p.activePetId, null); }
  assert.deepEqual(m.state.stakes, []);
  assert.deepEqual(m.state.ledger.map(r => r.n), [1, 2, 3]);
  assert.equal(m.state.ledgerSeq, 3);
  assert.ok(m.notes.some(n => /v1 → v2/.test(n)));
});
test('a migrated save does not pay Power for games that happened before pets existed', () => {
  const { config } = mkGame();
  const st = RC.migrateState(oldSave()).state;
  PT.accruePower(config, st);
  assert.equal(st.players[0].power, 0);
});
test('a migrated save keeps playing: turns end, ledger numbers continue', () => {
  const { config } = mkGame();
  const st = RC.migrateState(oldSave()).state;
  S.log(st, 'TEST', 'p0', {});
  assert.equal(st.ledger.at(-1).n, 4);
  assert.doesNotThrow(() => E.endTurn(st, config));
  assert.deepEqual(RC.auditState(st, config).filter(h => h.level === 'error'), []);
});
test('migrating a current save changes nothing and is idempotent', () => {
  const { state } = mkGame();
  const before = JSON.stringify(state);
  const m = RC.migrateState(state);
  assert.equal(JSON.stringify(m.state), before);
  assert.deepEqual(m.notes, []);
  assert.equal(JSON.stringify(RC.migrateState(m.state).state), before);
});
test('migrate drops junk players, resets non-list fields, and refuses non-objects', () => {
  const { state } = mkGame();
  state.players.push(null, 'x', { name: 'no id' }); state.ledger = 'oops'; state.players[0].balances = null; state.players[1].pets = 'none';
  const m = RC.migrateState(state);
  assert.equal(m.state.players.length, 3);
  assert.deepEqual(m.state.ledger, []);
  assert.deepEqual(m.state.players[0].balances, { Gold: 0 });
  assert.deepEqual(m.state.players[1].pets, []);
  assert.equal(RC.migrateState(null).state, null); assert.equal(RC.migrateState([]).state, null); assert.equal(RC.migrateState('hi').state, null);
});
test('a ledger counter that fell behind is pulled forward', () => {
  const { state } = mkGame(); S.log(state, 'A', null); S.log(state, 'B', null); state.ledgerSeq = 0;
  assert.equal(RC.migrateState(state).state.ledgerSeq, 2);
});
test('a healthy table audits clean — fresh, mid-move and mid-game', () => {
  const g = mkGame();
  assert.deepEqual(RC.auditState(g.state, g.config), []);
  E.endTurn(g.state, g.config);
  assert.deepEqual(RC.auditState(g.state, g.config), []);
  assert.deepEqual(RC.auditState(S.initialState(g.config, 5), g.config), []);
});
test('audit finds the damage; repair fixes it without inventing money', () => {
  const { state, config, p, q } = mkGame();
  p.balances.Gold = NaN; p.balances.Gems = '12'; q.pos = 999; q.jailTier = 9; p.power = 5000; p.activePetId = 'ghost';
  p.loans = [{ owed: 'lots' }, { owed: 100, principal: 80 }];
  state.turnOrder.push('nobody', 'p0'); state.turnIdx = NaN; state.game = { playerId: 'gone' }; state.move = { playerId: 'gone' }; state.round = 0;
  const found = RC.auditState(state, config);
  assert.ok(found.filter(h => h.level === 'error').length >= 8);
  const fixes = RC.repairState(state, config);
  assert.ok(fixes.length >= 9);
  assert.equal(p.balances.Gold, 0); assert.equal(p.balances.Gems, 12);
  assert.equal(state.board[q.pos].type, 'START'); assert.equal(q.jailTier, 4); assert.equal(p.power, 1000); assert.equal(p.activePetId, null);
  assert.equal(p.loans.length, 1); assert.deepEqual(state.turnOrder, ['p0', 'p1', 'p2']); assert.equal(state.turnIdx, 0);
  assert.equal(state.game, null); assert.equal(state.move, null); assert.equal(state.round, 1);
  assert.deepEqual(RC.auditState(state, config), []);
  assert.deepEqual(RC.repairState(state, config), []);
});
test('repair removes duplicate players and rebuilds an empty turn order', () => {
  const { state, config } = mkGame();
  state.players.push({ ...state.players[0] }); state.turnOrder = [];
  assert.ok(RC.auditState(state, config).some(h => /share the id/.test(h.msg)));
  RC.repairState(state, config);
  assert.equal(state.players.length, 3); assert.deepEqual(state.turnOrder, ['p0', 'p1', 'p2']);
});
test('a running session with no board goes back to setup instead of crashing the renderer', () => {
  const { state, config } = mkGame(); state.board = [];
  RC.repairState(state, config);
  assert.equal(state.phase, 'setup');
});
test('audit warns when the board points at a game the config no longer has', () => {
  const { state, config } = mkGame();
  state.board.find(t => t.type === 'GAME').gameId = 'poker';
  assert.ok(RC.auditState(state, config).some(h => h.level === 'warn' && /not in the config/.test(h.msg)));
});
test('backupReason: first save, new round, phase change, player change, timer — otherwise nothing', () => {
  const { state } = mkGame();
  assert.equal(RC.backupReason(null, state, 0), 'first save');
  const meta = { phase: 'playing', round: 1, players: 3, ts: 1000 };
  assert.equal(RC.backupReason(meta, state, 2000), null);
  assert.equal(RC.backupReason(meta, { ...state, round: 2 }, 2000), 'round 2');
  assert.equal(RC.backupReason(meta, { ...state, phase: 'ended' }, 2000), 'session ended');
  assert.equal(RC.backupReason({ ...meta, phase: 'setup' }, state, 2000), 'session started');
  assert.equal(RC.backupReason({ ...meta, players: 2 }, state, 2000), 'players changed');
  assert.equal(RC.backupReason(meta, state, 1000 + RC.BACKUP_EVERY_MS), 'timed');
  assert.equal(RC.backupReason(null, { players: [] }, 0), null);
});
test('backups roll: only the newest few are kept, newest listed first', () => {
  const st = mem(); const { state } = mkGame();
  for (let r = 1; r <= 7; r++) { state.round = r; RC.saveBackup(state, `round ${r}`, { storage: st, now: r * 1000 }); }
  const list = RC.listBackups(st);
  assert.equal(list.length, RC.BACKUP_MAX);
  assert.deepEqual(list.map(b => b.round), [7, 6, 5, 4]);
  assert.equal(list[0].reason, 'round 7'); assert.ok(list[0].bytes > 100);
});
test('maybeBackup only writes when there is a reason', () => {
  const st = mem(); const { state } = mkGame();
  assert.equal(RC.maybeBackup(state, { storage: st, now: 1000 }).reason, 'first save');
  assert.equal(RC.maybeBackup(state, { storage: st, now: 2000 }), null);
  state.round = 2;
  assert.equal(RC.maybeBackup(state, { storage: st, now: 3000 }).reason, 'round 2');
  assert.equal(RC.listBackups(st).length, 2);
});
test('restoring a backup gives back the table as it was (and migrates it)', () => {
  const st = mem(); const { state, p } = mkGame();
  p.balances.Gold = 777; delete p.loans;
  const { meta } = RC.saveBackup(state, 'manual', { storage: st, now: 5 });
  p.balances.Gold = 1;
  const back = RC.loadBackup(meta.id, st);
  assert.equal(back.players[0].balances.Gold, 777); assert.deepEqual(back.players[0].loans, []);
  assert.equal(RC.loadBackup('nope', st), null);
});
test('safeSave: when the browser is full, old backups are given up so the live game still saves', () => {
  const { state } = mkGame(); const json = JSON.stringify(state);
  const probe = mem(); for (let i = 0; i < 3; i++) RC.saveBackup(state, 'r' + i, { storage: probe, now: i });
  const st = mem(probe.getItem(RC.BACKUP_KEY).length + json.length / 2);     // room for the backups, not for the live save as well
  for (let i = 0; i < 3; i++) RC.saveBackup(state, 'r' + i, { storage: st, now: i });
  assert.equal(RC.listBackups(st).length, 3);
  const res = RC.safeSave(json, { storage: st });
  assert.equal(res.ok, true); assert.ok(res.dropped >= 1);
  assert.equal(st.getItem(RC.STATE_KEY), json);
});
test('safeSave reports failure (instead of throwing) when even an empty browser has no room', () => {
  const res = RC.safeSave('x'.repeat(100), { storage: mem(10) });
  assert.equal(res.ok, false); assert.match(res.error, /Quota/);
});
test('saveBackup never throws on a full browser', () => {
  const { state } = mkGame();
  assert.doesNotThrow(() => RC.saveBackup(state, 'x', { storage: mem(50) }));
  assert.equal(RC.listBackups(mem(50)).length, 0);
});
test('recoverState: live save wins; a corrupt save falls back to the newest readable backup', () => {
  const st = mem(); const { state } = mkGame();
  state.round = 3; RC.saveBackup(state, 'round 3', { storage: st, now: 1 });
  state.round = 4; RC.saveBackup(state, 'round 4', { storage: st, now: 2 });
  state.round = 5; st.setItem(RC.STATE_KEY, JSON.stringify(state));
  assert.equal(RC.recoverState({ storage: st }).state.round, 5);
  st.setItem(RC.STATE_KEY, '{"players":[{"id"');                       // tab died mid-write
  const r = RC.recoverState({ storage: st });
  assert.equal(r.source, 'backup'); assert.equal(r.state.round, 4); assert.equal(r.backup.reason, 'round 4');
  // newest backup also damaged → the one before
  const list = JSON.parse(st.getItem(RC.BACKUP_KEY)); list[1].json = 'garbage'; st.setItem(RC.BACKUP_KEY, JSON.stringify(list));
  assert.equal(RC.recoverState({ storage: st }).state.round, 3);
});
test('recoverState: nothing saved → none; corrupt with no backups → corrupt; garbage backups list is ignored', () => {
  assert.equal(RC.recoverState({ storage: mem() }).source, 'none');
  { const w = mem(); const { state } = mkGame(); RC.saveBackup(state, 'before wipe', { storage: w, now: 1 });      // wiped on purpose: backups exist, live save does not
    const r = RC.recoverState({ storage: w }); assert.equal(r.source, 'none'); assert.equal(r.state, null); assert.equal(RC.listBackups(w).length, 1); }
  const st = mem(); st.setItem(RC.STATE_KEY, 'nope'); st.setItem(RC.BACKUP_KEY, '{"not":"a list"}');
  const r = RC.recoverState({ storage: st });
  assert.equal(r.source, 'corrupt'); assert.equal(r.state, null);
  assert.deepEqual(RC.listBackups(st), []);
});
test('state.js: saveState → loadState round-trips through recovery and reports how the load went', () => {
  localStorage.clear();
  const { state } = mkGame();
  const res = S.saveState(state);
  assert.equal(res.ok, true);
  const back = S.loadState();
  assert.equal(back.players.length, 3); assert.equal(S.lastLoad.source, 'live');
  localStorage.setItem('gwf_state', '{{{');
  assert.equal(S.loadState(), null); assert.equal(S.lastLoad.source, 'corrupt');
  localStorage.clear();
});
test('state.js: an old save in the browser is migrated on load', () => {
  localStorage.clear();
  localStorage.setItem('gwf_state', JSON.stringify(oldSave()));
  const st = S.loadState();
  assert.equal(st.v, RC.STATE_VERSION); assert.deepEqual(st.players[0].pets, []);
  assert.ok(S.lastLoad.notes.length > 0);
  localStorage.clear();
});
test('ago: friendly times', () => {
  assert.equal(RC.ago(1000, 1000 + 20e3), 'just now'); assert.equal(RC.ago(0, 5 * 60e3), '5 min ago');
  assert.equal(RC.ago(0, 3 * 3600e3), '3 h ago'); assert.equal(RC.ago(0, 2 * 86400e3), '2 d ago');
});

test('savedAt always moves forward — even when the save carries a timestamp from the future', async () => {
  localStorage.clear();
  const { state } = mkGame();
  S.saveState(state); const first = state.savedAt;
  assert.ok(Math.abs(first - Date.now()) < 1000);
  S.saveState(state); assert.equal(state.savedAt, first, 'a second save in the same click shares the stamp');
  await new Promise(r => setTimeout(r, 140));
  S.saveState(state); assert.ok(state.savedAt > first, 'the next click gets a newer stamp');
  state.savedAt = Date.now() + 60_000;                       // e.g. a session file from a PC whose clock is a minute fast
  const future = state.savedAt;
  await new Promise(r => setTimeout(r, 140));
  S.saveState(state); assert.ok(state.savedAt > future, 'still advances');
  const a = state.savedAt;
  await new Promise(r => setTimeout(r, 140));
  S.saveState(state); assert.ok(state.savedAt > a, 'and keeps advancing');
  localStorage.clear();
});

test('a table many rounds in is healthy: the turn counter keeps climbing and repair leaves it alone', () => {
  const { state, config } = mkGame(['A', 'B', 'C']);
  for (let i = 0; i < 17; i++) E.endTurn(state, config);
  assert.equal(state.turnIdx, 17); assert.equal(S.currentPlayer(state).id, 'p2');
  assert.deepEqual(RC.auditState(state, config), []);
  assert.deepEqual(RC.repairState(state, config), []);
  assert.equal(state.turnIdx, 17); assert.equal(S.currentPlayer(state).id, 'p2');
});
