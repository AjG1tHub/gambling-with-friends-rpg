// State + persistence + cross-window sync (Phase 0).
// The GM window is the single writer. The player view only renders.
// Sync: BroadcastChannel 'gwf' + localStorage snapshot (reload safety).
import { pushLedgerRow } from './config.js';
import { safeSave, recoverState, STATE_VERSION } from './recovery.js';

const STATE_KEY = 'gwf_state';
export const channel = new BroadcastChannel('gwf');
// Unique id per window — lets GM tabs detect writes from OTHER GM tabs so a
// stale tab never clobbers newer state with its in-memory copy.
export const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

export function newPlayer(id, name, iconUrl, startPos, startingBank) {
  return {
    id, name, iconUrl: iconUrl || '',
    pos: startPos,
    balances: { Gold: startingBank },
    jailTier: 0,            // 0 = free, 1–4 = jail depth
    jailSkipNextSpin: false,
    jailSpinsNextTurn: 1,   // Solitary sets 2
    skipTurns: 0,           // Extended / Work Release
    winMult: null,          // BUFF_NEXT_WIN: {mult} consumed on next game win
    pardons: 0,
    collector: null,        // {perTurn, turnsLeft}
    heldPowerUps: [],
    debuffs: [],            // free-text tags (Social Barter etc.)
    loans: [],              // see loans.js
    power: 0,               // Power Level ⚡ 0–1000 (pets.js) — the side game's currency
    pets: [], activePetId: null,
  };
}

export function initialState(config, seed) {
  return {
    v: STATE_VERSION,
    seed,
    rngState: seed >>> 0,
    createdAt: Date.now(),
    themeId: 'noir',
    players: [],
    board: [],              // filled by board.generateBoard
    turnOrder: [],          // player ids
    turnIdx: 0,
    round: 1,
    phase: 'setup',         // setup | playing
    move: null,             // active move session (engine)
    lastSpin: null,         // {wheel, outcomes, index, playerId, ts} for the view
    shopRates: {},          // {currencyName: rate} cached per session
    banner: '',             // big text on player view
    ledger: [],
    ledgerSeq: 0,           // last ledger row number handed out
    stakes: [],             // IRL bets, record-only
    configSource: 'defaults',
  };
}

// One GM click often saves twice (e.g. Resolve Tile → spin → sync, then the
// resolver's own sync). The player view treats a NEWER savedAt as "next GM
// action" and hides the wheel — so saves inside the same 120 ms window share
// one savedAt. (Was: GOOD/BAD wheel flashing then vanishing after Magnetism /
// Benevolence / any Resolve Tile.)
let lastSaveWall = -Infinity;   // wall-clock time of this window's previous save
export function saveState(state) {
  // savedAt only ever moves forward: a save carrying a timestamp from the future (a session file or restore
  // point from a computer whose clock runs ahead) must not freeze it, or the shared screen would never
  // see a "next action" again and the last wheel would stay up all night.
  const now = Date.now();
  const sameClick = state.savedAt && now - lastSaveWall >= 0 && now - lastSaveWall < 120;
  if (!sameClick) state.savedAt = Math.max(now, (Number(state.savedAt) || 0) + 1);
  lastSaveWall = now;
  // A full browser must not stop the game: the shared screen still gets the state over the channel,
  // and safeSave gives up old backups to make room. lastSaveResult tells the GM window if it failed.
  lastSaveResult = safeSave(JSON.stringify(state), { key: STATE_KEY });
  channel.postMessage({ type: 'state', state, sender: TAB_ID });
  return lastSaveResult;
}
export let lastSaveResult = { ok: true, dropped: 0 };
// How the last load went: { source: 'live' | 'backup' | 'backup-only' | 'corrupt' | 'none', notes, backup }
export let lastLoad = { source: 'none', notes: [] };

export function loadState() {
  // Old saves are migrated on the way in; an unreadable save falls back to the newest backup.
  try { lastLoad = recoverState({ key: STATE_KEY }); return lastLoad.state; }
  catch { lastLoad = { source: 'corrupt', notes: [] }; return null; }
}

export function clearState() {
  localStorage.removeItem(STATE_KEY);
  // Force every other GWF window (GM or player) to reload fresh — prevents any
  // open tab from resurrecting the wiped session from its in-memory copy.
  channel.postMessage({ type: 'reset', sender: TAB_ID });
}

// The ledger lives inside the saved game, so it is capped (oldest rows go first; ledgerDropped counts them).
export const LEDGER_MAX = 5000;
export function log(state, eventType, playerId, data = {}) {
  // data is spread FIRST so a data key can never clobber the event type
  // n = running sequence number: rows can share a millisecond, so ts alone can't order or identify them
  state.ledgerSeq = (state.ledgerSeq || 0) + 1;
  const row = { ts: Date.now(), ...data, type: eventType, playerId: playerId ?? null, n: state.ledgerSeq };
  state.ledger.push(row);
  if (state.ledger.length > LEDGER_MAX) { const cut = state.ledger.length - LEDGER_MAX; state.ledger.splice(0, cut); state.ledgerDropped = (state.ledgerDropped || 0) + cut; }
  pushLedgerRow(row);
  return row;
}

// ── Currency helpers ─────────────────────────────────────────────
export function bal(player, cur) { return player.balances[cur] || 0; }

export function credit(state, player, cur, amount, why) {
  const before = player.balances[cur] || 0;
  player.balances[cur] = before + amount;
  // Only Gold may go negative; secondaries floor at 0
  if (cur !== 'Gold' && player.balances[cur] < 0) player.balances[cur] = 0;
  // The ledger records what actually moved, so balances can always be rebuilt from it; if a secondary
  // hit the floor, `asked` keeps the amount that was requested.
  const moved = player.balances[cur] - before;
  log(state, amount >= 0 ? 'CREDIT' : 'DEBIT', player.id, moved === amount ? { cur, amount, why } : { cur, amount: moved, asked: amount, why });
}

export function goldValue(config, player) {
  const rates = Object.fromEntries(config.Currencies.map(c => [c.name, c.goldRate]));
  return Object.entries(player.balances)
    .reduce((sum, [cur, amt]) => sum + amt * (rates[cur] ?? 0), 0);
}

// What a player is actually worth: holdings minus unpaid loans (borrowed Gold is not wealth).
export function debtOwed(player) { return (player.loans || []).reduce((s, l) => s + (l.owed > 0 ? l.owed : 0), 0); }
export function netWorth(config, player) { return goldValue(config, player) - debtOwed(player); }

export function richest(config, state, excludeId) {
  const list = state.players.filter(p => p.id !== excludeId);
  return list.sort((a, b) => netWorth(config, b) - netWorth(config, a))[0] || null;
}
export function poorest(config, state, excludeId) {
  const list = state.players.filter(p => p.id !== excludeId);
  return list.sort((a, b) => netWorth(config, a) - netWorth(config, b))[0] || null;
}

export function currentPlayer(state) {
  if (!state.turnOrder.length) return null;
  const id = state.turnOrder[state.turnIdx % state.turnOrder.length];
  return state.players.find(p => p.id === id) || null;
}
