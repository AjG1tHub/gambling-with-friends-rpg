// GM panel: ledger. Placeholder until the UI phase fills it in; receives { state, session, ctx, h, gm, main }.
export function panelLedger({ state, h, main }) {
  main.append(h('div', { class: 'panel' }, h('h2', {}, 'Ledger'), h('p', { class: 'muted ital' }, 'Coming with the UI phase.')));
}
