// GM panel: export. Placeholder until the UI phase fills it in; receives { state, session, ctx, h, gm, main }.
export function panelExport({ state, h, main }) {
  main.append(h('div', { class: 'panel' }, h('h2', {}, 'Export'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
