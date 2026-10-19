// Phone tab: pets. Placeholder until the UI phase fills it in; receives { state, session, me, c, myTurn, ctx, h, dispatch, screen }.
export function tabPets({ state, me, c, myTurn, h, dispatch, screen }) {
  screen.append(h('div', { class: 'panel' }, h('h3', {}, 'pets'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
