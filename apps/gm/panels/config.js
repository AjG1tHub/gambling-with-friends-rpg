// GM panel: config. Placeholder until the UI phase fills it in; receives { state, session, ctx, h, gm, main }.
export function panelConfig({ state, h, main }) {
  main.append(h('div', { class: 'panel' }, h('h2', {}, 'Config'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
