// GM panel: the run. Event log, restore points and undo, pause, end.
export function panelRun({ state, h, gm, main }) {
  const label = h('input', { placeholder: 'Restore point label' });
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Run'), h('div', { class: 'gm-bar' },
      h('button', { onClick: () => { gm('GM_RESTORE_POINT', { label: label.value || undefined }); label.value = ''; } }, 'Save restore point'), label,
      h('button', { class: 'danger', onClick: () => { if (state.restorePoints.length && confirm('Undo to the last restore point?')) gm('GM_UNDO', {}); } }, 'Undo to last point'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Restore points'), state.restorePoints.length ? h('div', { class: 'list' }, [...state.restorePoints].reverse().map(r => h('div', { class: 'item' }, h('span', { class: 'grow' }, r.label, h('span', { class: 'muted' }, ` · ${new Date(r.ts).toLocaleTimeString()}`)), h('button', { onClick: () => { if (confirm(`Restore "${r.label}"?`)) gm('GM_UNDO', { restoreId: r.id }); } }, 'Restore')))) : h('p', { class: 'muted' }, 'None yet. Save one before anything risky.')),
    h('div', { class: 'panel' }, h('h3', {}, 'Log'), h('div', { class: 'log log-box' }, [...state.log].reverse().slice(0, 120).map(l => h('div', { class: l.kind }, h('span', { class: 'mono muted' }, new Date(l.ts).toLocaleTimeString() + ' '), l.text)))));
}
