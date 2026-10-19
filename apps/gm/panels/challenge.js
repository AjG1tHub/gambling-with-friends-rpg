// GM panel: challenge. Placeholder until the UI phase fills it in; receives { state, session, ctx, h, gm, main }.
export function panelChallenge({ state, h, main }) {
  main.append(h('div', { class: 'panel' }, h('h2', {}, 'Challenge'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
