// Phone tab: Map (SPEC.md › Map; Phone UI). The revealed map centred on me, pannable, with tile glyphs, tokens,
// monsters and region names. Tap a hex: during my move it paths there (MOVE_PATH, or a Card jump when the hex is
// lit); otherwise it opens the tile info sheet. Hex colours appear only through cardView (Card boots, in range).
import { currentPlayerId } from '../../../packages/shared/state.js';
import { cardView } from '../../../packages/shared/handlers/movement.js';
import { tileLabel, TILES } from '../../../packages/shared/map/query.js';
import { hexMini, hexInfo } from '../../../packages/ui/hexmini.js';
import { colourHex, colourInk } from '../../../packages/ui/cards.js';

let picked = null;
export function tabMap(raw) {
  const { state, c, myTurn, h, dispatch, screen } = raw; const me = raw.me?.id || raw.ctx?.me;
  if (!state.map?.hexes || !Object.keys(state.map.hexes).length) { screen.append(h('div', { class: 'hero' }, h('h2', {}, 'The map'), h('p', { class: 'muted ital' }, state.phase === 'playing' ? 'No map rolled yet.' : 'The map is rolled when the run starts.'))); return; }
  const s = state.moveSession && state.moveSession.playerId === me && !state.moveSession.done ? state.moveSession : null;
  const moving = myTurn && !!s;
  const cv = c ? cardView(state, me) : null;
  const colours = cv ? Object.fromEntries(cv.hexes.map(x => [x.key, x.colour])) : null;
  const lit = s?.atomic ? new Set(s.destinations || []) : null;
  const here = c?.pos ? state.map.hexes[c.pos] : null; const region = here ? state.map.regions[here.regionId] : null;
  screen.append(h('div', { class: 'row between tile-line' }, h('span', { class: 'tag' }, region ? region.name : 'The map'), h('span', { class: 'muted' }, moving ? (s.atomic ? 'tap a lit hex' : `${s.movesLeft} moves left · tap to path`) : 'drag to pan · tap for info')));
  screen.append(hexMini({ state, me, c, height: 380, size: 28, colours, lit, path: s?.path || null, onTap: (key) => {
    if (moving) { if (s.atomic) { if (lit.has(key)) dispatch('MOVE_STEP', { to: key }); else picked = key; } else if (key !== c.pos) dispatch('MOVE_PATH', { to: key }); else picked = key; }
    else picked = key;
    sheet.replaceChildren(infoSheet(state, picked, c, h, colours));
  } }));
  if (cv) screen.append(h('div', { class: 'colour-key' }, h('span', { class: 'tag' }, `Card boots · range ${cv.range} · deck ${cv.deckLeft}`), ...Object.keys({ oxblood: 1, bone: 1, brass: 1, verdigris: 1, violet: 1, soot: 1 }).map(k => h('span', { class: 'swatch', style: { background: colourHex(k), color: colourInk(k) } }, k))));
  const sheet = h('div', { class: 'tile-sheet' }, infoSheet(state, picked || c?.pos, c, h, colours));
  screen.append(sheet);
}
function infoSheet(state, key, c, h, colours) {
  const info = key ? hexInfo(state, key) : null;
  if (!info) return h('p', { class: 'muted ital' }, 'Tap a hex to read it.');
  const t = TILES[info.hex.type] || {};
  return h('div', { class: 'col' }, h('div', { class: 'row between' }, h('b', { class: 'nm' }, `${info.glyph} ${info.label}`), h('span', { class: 'pill', style: { borderColor: info.region?.accent } }, info.region?.name || '')),
    h('p', { class: 'muted' }, t.text || ''),
    info.hex.bridge ? h('span', { class: 'meta' }, 'A bridge between regions.') : null,
    info.hex.gate ? h('span', { class: 'meta bad' }, `Gated: ${[info.hex.gate.level != null ? `level ${info.hex.gate.level}` : '', info.hex.gate.keyItem ? String(info.hex.gate.keyItem).replace(/_/g, ' ') : '', info.hex.gate.toll != null ? `${info.hex.gate.toll} Gold toll` : ''].filter(Boolean).join(' or ')}`) : null,
    info.monster ? h('span', { class: 'meta bad' }, `${info.monster.name} · ${info.monster.health}/${info.monster.maxHealth} Health${info.monster.boss ? ' · boss' : ''}`) : null,
    info.who.length ? h('span', { class: 'meta' }, `Here: ${info.who.join(', ')}`) : null,
    info.loot.length ? h('span', { class: 'meta' }, `On the ground: ${info.loot.map(l => (l.item || l).name).join(', ')}`) : null,
    colours?.[key] ? h('span', { class: 'meta', style: { color: colourHex(colours[key]) } }, `Colour: ${colours[key]}`) : null,
    key === c?.pos ? h('span', { class: 'meta ok' }, 'You are here.') : h('span', { class: 'meta faint' }, key));
}
export { tileLabel };
