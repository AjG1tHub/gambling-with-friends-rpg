// The room state. One JSON object per room; every client holds a copy and applies the same events to it
// through applyEvent (reducer.js). Nothing here is written outside a handler.
//
// Shape (see docs/STATE.md for the full field list):
//   meta        v, roomId, code, seed, rng (stream positions), rig (GM-forced next results), balance (overrides)
//   run         mode, tier, size, phase ('lobby' | 'creation' | 'playing' | 'ended'), createdAt, startedAt, endedAt
//   gm          pinHash, deviceId, paused, spotlight[], proxies{}, challengePreset, challengeLists{}
//   players     { id → player }   a seat at the table: device, name, connection, readiness, character id
//   seats       [playerId]        turn order; turnIdx counts every turn ever taken and never resets
//   characters  { id → character } the RPG layer (health, stats, worn gear, grid, pets, position)
//   roster      { id → rosterEntry } saved characters known to this room (mirror of the backend roster)
//   wall        [name]            the Wall of Names: names retired forever
//   map         hexes {key → hex}, regions {id → region}, start, throne, courier, revealed{}
//   monsters    { id → monster }
//   fight       the active encounter or null; challenge: the active PvP challenge or null; held {playerId → heldTurn}
//   clocks      { playerId → { bankMs, runningSince } }
//   wheels      lastSpin (what the TV animates), area (open Area bet window)
//   economy     pacts, bounties, shops{hexKey→stock}, tileLoot{hexKey→[item]}, auction, ledger (money rows)
//   social      letters, alliances, votes, emotes, sideBets, quests
//   chaos       { tier, roundsAtTier, effects[] }
//   records     stats{playerId→…}, log[] (short human log), banner, toasts, hallOfFame, metaLedger
import { makeStreams } from './rng.js';

export const STATE_VERSION = 1;
export const PHASES = ['lobby', 'creation', 'playing', 'ended'];
export const MODES = ['ffa', 'pvp', 'pve', 'teams', 'royale'];
export const SIZES = ['short', 'regular', 'long'];

export function initialState({ roomId, code, seed, mode = 'ffa', tier = 1, size = 'regular', gmPinHash = '', createdAt = 0, gmDeviceId = null } = {}) {
  return {
    v: STATE_VERSION, roomId: roomId || null, code: code || null, seed: seed >>> 0,
    rng: makeStreams(seed >>> 0), rig: {}, balance: {},
    mode, tier, size, phase: 'lobby', createdAt, startedAt: null, endedAt: null, winner: null,
    gm: { pinHash: gmPinHash, deviceId: gmDeviceId, paused: false, pausedAt: null, spotlight: [], proxies: {}, challengePreset: 'inperson', challengeLists: {}, duelsEnabled: true, fogOfWar: true, teams: {} },
    players: {}, seats: [], turnIdx: 0, round: 1, turnStartedAt: null, turnPhase: 'move', moveSession: null,
    characters: {}, roster: {}, wall: [],
    map: null, monsters: {}, fight: null, challenge: null, held: {}, clocks: {},
    lastSpin: null, area: null, pendingPrompt: null,
    pacts: {}, bounties: [], shops: {}, tileLoot: {}, auction: null, ledger: [], ledgerSeq: 0,
    letters: [], alliances: [], votes: null, emotes: [], sideBets: [], quests: { public: [], personal: {} },
    chaos: { tier: 1, roundsAtTier: 0, effects: [] },
    stats: {}, log: [], banner: '', toasts: [], hallOfFame: [], metaLedger: [], restorePoints: [],
    legendariesDropped: 0, eventCount: 0, lastEventTs: 0,
  };
}

export function newPlayer({ id, name = 'Player', deviceId = null, spectator = false, isGm = false, joinedAt = 0 }) {
  return { id, name, deviceId, spectator, isGm, joinedAt, connected: true, lastSeenTs: joinedAt, ready: false, teamId: null, rosterId: null, characterId: null, proxied: false, autopilot: false, kicked: false, crest: '🂠' };
}

// Derivations used everywhere. The current player is derived from turnIdx; players in a held challenge,
// disconnected-and-proxied players still take turns (the GM acts for them), dead players still get a turn
// which they spend missing (so penalties count down).
export function activeSeats(state) { return state.seats.filter(id => state.players[id] && !state.players[id].kicked && !state.players[id].spectator); }
export function currentPlayerId(state) {
  const seats = activeSeats(state); if (!seats.length) return null;
  // Held turns (players away in a challenge) are skipped by derivation, never by editing the order.
  for (let i = 0; i < seats.length; i++) { const id = seats[(state.turnIdx + i) % seats.length]; if (!state.held[id]) return id; }
  return seats[state.turnIdx % seats.length];
}
export const currentPlayer = (state) => state.players[currentPlayerId(state)] || null;
export const characterOf = (state, playerId) => { const p = state.players[playerId]; return p?.characterId ? state.characters[p.characterId] || null : null; };
export const currentCharacter = (state) => characterOf(state, currentPlayerId(state));
export const playerOfCharacter = (state, charId) => Object.values(state.players).find(p => p.characterId === charId) || null;
export const alive = (c) => !!c && !c.dead;
export const livingCharacters = (state) => Object.values(state.characters).filter(c => alive(c) && playerOfCharacter(state, c.id));
export const teamOf = (state, playerId) => state.players[playerId]?.teamId ?? null;
export function sameTeam(state, a, b) { if (a === b) return true; const ta = teamOf(state, a), tb = teamOf(state, b); return ta != null && ta === tb; }
export function allied(state, a, b) { return sameTeam(state, a, b) || state.alliances.some(al => al.active && al.members.includes(a) && al.members.includes(b)); }
// A short human line for the TV log; the event stream is the real record.
export function note(state, text, kind = 'info', ts = state.lastEventTs) {
  state.log.push({ ts, text, kind });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}
