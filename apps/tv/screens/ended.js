// TV after the run: the recap frame (charts arrive with the polish phase).
import { h } from '../../../packages/ui/dom.js';
export function renderEnded({ state, stage, rail }) {
  stage.append(h('div', { style: { padding: '2vw' } }, h('h2', {}, 'The run is over'), h('p', {}, state.endReason || ''), state.winner ? h('p', { class: 'display' }, `Winner: ${state.players[state.winner]?.name || state.winner}`) : null));
  rail.append(h('div', { class: 'panel' }, h('h3', {}, 'Recap'), h('p', { class: 'muted' }, 'Vault and recap on the phones and the GM console.')));
}
