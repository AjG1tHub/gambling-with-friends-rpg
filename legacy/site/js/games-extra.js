// Registry of the plug-in minigames. games.js routes start/act here; gm-games.js and game-ui.js ask for
// controls() and stage(). Adding a game = adding one object to one of the three files below.
import { QUICK } from './games-quick.js';
import { SHOW } from './games-show.js';
import { TABLE } from './games-table.js';

export const EXTRA_LIST = [...QUICK, ...SHOW, ...TABLE];
export const EXTRA = Object.fromEntries(EXTRA_LIST.map(g => [g.id, g]));
export const extraDef = (id) => EXTRA[id] || null;
export const EXTRA_ODDS = Object.fromEntries(EXTRA_LIST.map(g => [g.id, g.odds]));
export const EXTRA_GROUPS = [
  { label: 'Quick games', ids: QUICK.map(g => g.id) },
  { label: 'Show games', ids: SHOW.map(g => g.id) },
  { label: 'Table games', ids: TABLE.map(g => g.id) },
];
// Config rows for the Games tab (odds stay {} so the built-ins in the game files apply until the Sheet overrides a number).
export const extraConfigRows = () => EXTRA_LIST.map(g => ({ id: g.id, name: g.name, icon: g.icon, built: true, odds: {} }));
