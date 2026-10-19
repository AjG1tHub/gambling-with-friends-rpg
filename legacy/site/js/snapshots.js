// Undo + session files (Phase 6/7 hardening). Pure helpers; the GM window owns the stack.
//   UndoStack — remembers the last N saved states as JSON. One GM click often saves twice within
//   a few milliseconds, so pushes inside `mergeMs` of the previous one are folded together: undo
//   always steps back one CLICK, not one save.
//   Session files — export the whole table to a .json, import it on any computer.
export class UndoStack {
  constructor({ max = 30, mergeMs = 250, now = () => Date.now() } = {}) { this.max = max; this.mergeMs = mergeMs; this.now = now; this.items = []; this.lastPush = -Infinity; }
  // Call with the state as it was BEFORE the change that is about to be saved.
  push(json, label = '') {
    if (typeof json !== 'string' || !json) return false;
    const t = this.now();
    if (this.items.length && this.items.at(-1).json === json) return false;            // nothing changed
    if (t - this.lastPush < this.mergeMs) { this.lastPush = t; return false; }          // same click: keep the older restore point
    this.items.push({ json, label, ts: t }); this.lastPush = t;
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    return true;
  }
  pop() { const it = this.items.pop() || null; this.lastPush = -Infinity; return it; }
  peek() { return this.items.at(-1) || null; }
  get size() { return this.items.length; }
  clear() { this.items = []; this.lastPush = -Infinity; }
}

// "what would be undone": the newest ledger row the current state has that the snapshot lacks.
export function undoLabel(currentState, snapshotJson) {
  try {
    const before = JSON.parse(snapshotJson); const seq = before.ledgerSeq || 0;
    const rows = (currentState.ledger || []).filter(r => (r.n || 0) > seq);
    if (!rows.length) return 'last change';
    const name = (id) => currentState.players.find(p => p.id === id)?.name;
    const types = [...new Set(rows.map(r => r.type))].filter(t => !['POWER', 'CREDIT', 'DEBIT'].includes(t));
    const who = name(rows.find(r => r.playerId)?.playerId);
    return `${(types.length ? types : [rows.at(-1).type]).slice(0, 3).join(' + ')}${who ? ` (${who})` : ''}`;
  } catch { return 'last change'; }
}

export const SESSION_FILE_KIND = 'gwf-session';
export function exportSession(state, { configSource = 'defaults', now = Date.now() } = {}) {
  return JSON.stringify({ app: 'gambling-with-friends', kind: SESSION_FILE_KIND, v: 1, exportedAt: now, configSource, state }, null, 1);
}
// Returns { state } or { error, text }. Only structural checks — enough to refuse the wrong file.
export function parseSessionFile(json) {
  let data; try { data = JSON.parse(json); } catch { return { error: true, text: 'That file is not valid JSON.' }; }
  const st = data?.kind === SESSION_FILE_KIND ? data.state : (data && Array.isArray(data.players) && Array.isArray(data.ledger) ? data : null);
  if (!st) return { error: true, text: 'That is not a Gambling With Friends session file.' };
  const problems = [];
  if (!Array.isArray(st.players)) problems.push('no player list');
  if (!Array.isArray(st.board)) problems.push('no board');
  if (!Array.isArray(st.ledger)) problems.push('no ledger');
  if (!Array.isArray(st.turnOrder)) problems.push('no turn order');
  if (Array.isArray(st.players) && st.players.some(p => !p || typeof p.id !== 'string' || typeof p.balances !== 'object')) problems.push('a player entry is malformed');
  if (Array.isArray(st.players) && Array.isArray(st.turnOrder) && st.turnOrder.some(id => !st.players.some(p => p.id === id))) problems.push('turn order names a missing player');
  if (problems.length) return { error: true, text: `Session file rejected: ${problems.join(', ')}.` };
  return { state: st, exportedAt: data.exportedAt || null, text: `Session loaded: ${st.players.length} players, round ${st.round || 1}.` };
}
