// GM panel: Export. The whole room as JSON (state + events) out, and a state JSON back in.
export function panelExport({ state, session, h, gm, main }) {
  const out = h('textarea', { class: 'json', readonly: true });
  const inp = h('textarea', { class: 'json', placeholder: 'Paste a room state JSON here' });
  const exportRoom = async () => { const events = await session.backend.loadEvents(session.roomId, 0); const blob = { exportedAt: new Date().toISOString(), code: state.code, state, events }; out.value = JSON.stringify(blob); download(`gwf-room-${state.code}.json`, out.value); };
  const importRoom = async () => { try { const blob = JSON.parse(inp.value); const st = blob.state || blob; if (!st.players) throw new Error('not a room state'); if (confirm('Replace this room\'s state with the pasted one?')) await gm('ROOM_IMPORT', { state: st }); } catch (e) { alert(e.message); } };
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Export'), h('p', { class: 'muted' }, 'Downloads the room state and its full event log. Keep one before anything you might want to undo across a reload.'), h('button', { class: 'primary', onClick: exportRoom }, 'Export room JSON'), out),
    h('div', { class: 'panel' }, h('h2', {}, 'Import'), h('p', { class: 'muted' }, 'Replaces the current state (the room code and PIN stay). The import is itself an event, so it can be undone from a restore point.'), inp, h('button', { class: 'danger', onClick: importRoom }, 'Import state')),
    h('div', { class: 'panel' }, h('h3', {}, 'Room'), h('p', { class: 'mono muted' }, `roomId ${session.roomId} · seq ${session.lastSeq} · seed ${state.seed} · backend ${session.backend.kind}`)));
}
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
