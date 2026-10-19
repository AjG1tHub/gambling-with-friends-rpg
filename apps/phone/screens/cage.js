// Phone tab: cage. Placeholder until the UI phase fills it in; receives { state, session, me, c, myTurn, ctx, h, dispatch, screen }.
export function tabCage({ state, me, c, myTurn, h, dispatch, screen }) {
  screen.append(h('div', { class: 'panel' }, h('h3', {}, 'cage'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
