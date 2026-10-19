// Shared test fixtures. The game modules expect a browser (localStorage, BroadcastChannel),
// so tiny in-memory stand-ins are installed before anything is imported.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  _store: store,
};
export const sentMessages = [];
globalThis.BroadcastChannel = class { postMessage(m) { sentMessages.push(m); } addEventListener() {} };

export const S = await import('../../site/js/state.js');
export const E = await import('../../site/js/engine.js');
export const G = await import('../../site/js/games.js');
export const R = await import('../../site/js/rng.js');
export const { DEFAULT_CONFIG } = await import('../../site/js/config-default.js');

// A started session: players on START, board generated, turn order set.
export function mkGame(names = ['Aj', 'Nick', 'Sam'], seed = 42, tweak = null) {
  const config = structuredClone(DEFAULT_CONFIG);
  if (tweak) tweak(config);
  const rng = R.makeRng(seed);
  const state = S.initialState(config, seed);
  names.forEach((n, i) => state.players.push(S.newPlayer('p' + i, n, '', 0, config.Config.StartingBank)));
  state.board = E.generateBoard(config, rng);
  const start = E.startPositions(state)[0];
  state.players.forEach(p => { p.pos = start; });
  state.turnOrder = state.players.map(p => p.id);
  state.phase = 'playing';
  return { config, state, rng, players: state.players, p: state.players[0], q: state.players[1] };
}

// Scripted rng: next() replays `values` (then repeats the last one). int/pick/chance derive from it.
export function fixedRng(values) {
  let i = 0;
  const next = () => values[Math.min(i++, values.length - 1)];
  return {
    next, getState: () => 0, setState() {},
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export const gold = (p) => p.balances.Gold;
export const card = (r, s = '♠') => ({ r, s });
export const cards = (...ranks) => ranks.map(r => card(String(r)));
export const types = (state, type) => state.board.filter(t => t.type === type);
export const events = (state, type) => state.ledger.filter(r => r.type === type);
