// The six-hex rosette (SPEC.md › Phone UI): six hex-shaped direction buttons around a Stop Here hub, in the order
// of hex.DIRS (NE, E, SE, SW, W, NW) so dir i on screen is dir i in MOVE_STEP. Each button carries the tile glyph and
// name of what lies that way; an illegal direction is greyed with the reason as its title; a hex holding a living
// monster is hot. Buttons are 92 px, well over the 60 px target.
//
//   rosette({ steps, onStep(dir), onStop(), stop: { label, disabled, reason, hidden } })
//   steps = legalSteps(state, pid): [{ dir, name, key, type, label, legal, reason, bridge, stops }]
import { h } from './dom.js';
import { tileGlyph } from '../shared/map/query.js';

const W = 92, R = 300, C = (R - W) / 2;
// Pointy-top neighbours around the hub, in DIRS order.
const OFFSETS = [[W / 2, -W * 0.75], [W, 0], [W / 2, W * 0.75], [-W / 2, W * 0.75], [-W, 0], [-W / 2, -W * 0.75]];
const VOID = new Set(['water', 'chasm', 'wall', null]);

export function rosette({ steps = [], onStep, onStop, stop = {} } = {}) {
  const root = h('div', { class: 'rosette', role: 'group', 'aria-label': 'Move: six directions around Stop Here' });
  for (let dir = 0; dir < 6; dir++) {
    const s = steps[dir] || { dir, name: '?', type: null, label: 'off the map', legal: false, reason: 'off the map' };
    const [dx, dy] = OFFSETS[dir];
    const voidish = VOID.has(s.type) || s.type === 'blocker';
    const cls = ['hexbtn', voidish ? 'void' : '', s.stops ? 'hot' : '', s.legal ? 'ok' : 'no', s.bridge ? 'bridge' : ''].filter(Boolean).join(' ');
    const why = !s.legal ? (s.reason || 'not now') : s.stops ? 'a monster waits here: the move ends there' : '';
    root.append(h('button', {
      class: cls, type: 'button', style: { left: `${C + dx}px`, top: `${C + dy}px` }, disabled: !s.legal,
      title: why || `${s.name}: ${s.label}`, 'aria-label': `${s.name}: ${s.label}${why ? ' — ' + why : ''}`,
      onClick: () => { if (s.legal) onStep?.(dir, s); },
    }, h('b', {}, voidish ? '✕' : tileGlyph(s.type)), h('span', { class: 'lbl' }, (s.label || '').toUpperCase().slice(0, 12)), s.bridge ? h('span', { class: 'brg' }, 'BRIDGE') : null));
  }
  if (!stop.hidden) {
    root.append(h('button', { class: `hub ${stop.disabled ? 'off' : ''}`, type: 'button', disabled: !!stop.disabled, title: stop.reason || 'Stop here and end the move', 'aria-label': `Stop here${stop.reason ? ' — ' + stop.reason : ''}`, onClick: () => { if (!stop.disabled) onStop?.(); } },
      h('span', {}, (stop.label || 'STOP HERE').split(' ')[0]), h('span', {}, (stop.label || 'STOP HERE').split(' ').slice(1).join(' '))));
  }
  return root;
}
