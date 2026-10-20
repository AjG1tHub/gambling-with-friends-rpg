// Import this to get a fully registered reducer. Every handler module registers itself on import. Order matters
// only for hooks that run in registration order (runStart especially):
//   modes (unshifts modeAdjust) → creation (locks seats, default characters) → movement (map + placement)
//   → encounters (monsters on the map, quests) → the rest. roster.js registers the vault events.
import './handlers/lobby.js';
import './handlers/run.js';
import './handlers/modes.js';
import './handlers/creation.js';
import './handlers/movement.js';
import './handlers/tiles.js';
import './handlers/wheels.js';
import './handlers/death.js';
import './handlers/economy.js';
import './handlers/quests.js';
import './handlers/ledger.js';
import './handlers/items.js';
import './handlers/fight.js';
import './handlers/inventory.js';
import './handlers/roster.js';
import './handlers/pets.js';
import './handlers/classes.js';
import './handlers/challenge.js';
import './handlers/social.js';
import './handlers/qa.js';
export * from './reducer.js';
export * from './state.js';
export * from './events.js';
export * from './balance.js';
export * as hex from './hex.js';
export * as rngx from './rng.js';
export * as clock from './clock.js';
export * as money from './health.js';
export { hooks as runHooks, beginTurn, endTurn, endRun, finishTurn } from './handlers/run.js';
