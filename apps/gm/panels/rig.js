// GM panel: rig. Placeholder until the UI phase fills it in; receives { state, session, ctx, h, gm, main }.
export function panelRig({ state, h, main }) {
  main.append(h('div', { class: 'panel' }, h('h2', {}, 'Rig'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
