// Phone tab: Play. The current prompt with big buttons; shows who is up when it is not your turn.
// Phase 0 covers the lobby (ready toggle, players); the move/fight/tile prompts arrive with the UI phase.
export function tabPlay({ state, session, me, c, myTurn, h, dispatch, screen }) {
  if (state.phase === 'lobby' || state.phase === 'creation') {
    const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked);
    screen.append(
      h('div', { class: 'hero' }, h('div', { class: 'crest' }, c?.crest || me.crest || '🂠'), h('h2', {}, c?.name || me.name), h('p', { class: 'muted' }, state.phase === 'creation' ? 'Creation is open' : 'Waiting for the GM')),
      me.spectator ? h('p', { class: 'muted center' }, 'You are watching.') : h('button', { class: `big ${me.ready ? 'primary' : ''}`, onClick: () => dispatch('PLAYER_READY', { playerId: me.id, ready: !me.ready }) }, me.ready ? '✓ Ready — tap to unready' : 'Tap when ready'),
      h('div', { class: 'hr' }),
      h('div', { class: 'list' }, seats.map(p => h('div', { class: `item ${p.connected ? '' : 'off'}` }, h('span', {}, p.crest || '🂠'), h('span', { class: 'grow' }, p.name, p.id === me.id ? h('span', { class: 'muted' }, ' (you)') : null), h('span', { class: `pill ${p.ready ? 'ok' : ''}` }, p.ready ? 'ready' : p.connected ? 'here' : 'away')))));
    return;
  }
  if (state.phase === 'ended') { screen.append(h('div', { class: 'hero' }, h('h2', {}, 'The run is over'), h('p', {}, state.endReason || ''))); return; }
  const pid = Object.keys(state.players).find(id => id === (state.seats[state.turnIdx % Math.max(1, state.seats.length)]));
  if (!myTurn) { screen.append(h('div', { class: 'hero' }, h('h2', {}, `${state.players[pid]?.name || '…'} to move`), h('p', { class: 'muted' }, 'Your phone buzzes on your turn.'))); return; }
  screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Your turn'), h('p', { class: 'muted ital' }, 'Movement and fight prompts arrive with the UI phase.'), h('button', { class: 'primary big', onClick: () => dispatch('TURN_END', {}) }, 'End turn')));
}
