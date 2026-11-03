// The tutorial opening ("the ramp"): one new mechanic per turn for a player's first few turns, counted on that
// player's own turns (state.turnCounts, bumped in run.js beginTurn). A room option: state.gm.ramp = { on, steps,
// skipped }. ROOM_CREATED { ramp } sets it (default on at tier 1), GM_CONFIG { ramp, rampSteps? } flips it mid-run,
// GM_RAMP_SKIP { playerId? } skips it for one seat or the whole table.
//
// The step list is data (balance ramp.steps, or state.gm.ramp.steps when the room was made with its own list):
// each entry is a feature key or 'all'. Turn N unlocks every feature of steps[0..N-1]; past the end of the list,
// or once 'all' is reached, the ramp is over for that player.
//   move       roll / plod → step → stop → END TURN; hexes resolve; the monsters are asleep; Chaos spins at tier 1
//   gear       Shop, Inn, Bank, the Cage (bag, equip, drop), potions and other consumables, tile loot
//   fight      ITEM_USE / PET_ATTACK / FIGHT_START / AREA_OPEN; the monsters wake for this player
//   challenge  CHALLENGE_CALL (duel / wager / robbery), the Arena prompt, bounties
//   social     letters, alliances, votes, trades, auctions · class: class actives · pets: pet battles · chaos: tiers
//
// Enforcement is one table (LOCKS) checked in a reducer `onBefore` hook, so no handler needs a line of its own:
// a locked event is refused with code 'locked' ("Fights unlock on your turn 3"). The movement module asks
// unlocked(state, pid, 'fight') before a step onto a monster hex, tiles.js before the Arena prompt, wheels.js
// before a Chaos spin, and the bot policy before it proposes anything, so a bot seat never spams refusals.
//
// Pure helpers for the apps:
//   rampStage(state, pid)  → { on, turn, step, index, unlocked: Set, next: { feature, onTurn } | null, locked: [{ feature, onTurn }], done }
//   unlocked(state, pid, feature) → boolean       rampLine(state, pid) → "Next turn: shops and your Cage unlock" | ''
//   lockMessage(state, pid, feature) → "Fights unlock on your turn 3"   rampBanner(state) lives in packages/ui/tutorial.js
import { register, refuse, requireGm, onBefore } from '../reducer.js';
import { note } from '../state.js';
import { group } from '../balance.js';

export const FEATURES = ['move', 'gear', 'fight', 'challenge', 'social', 'class', 'pets', 'chaos'];
export const STEP_FEATURES = { move: ['move'], gear: ['gear'], fight: ['fight'], challenge: ['challenge'], social: ['social'], class: ['class'], pets: ['pets'], chaos: ['chaos'], all: FEATURES };
export const FEATURE_LABEL = { move: 'Moving', gear: 'Shops, the Inn, the Bank and your Cage', fight: 'Fights', challenge: 'Challenges, the Arena and bounties', social: 'Letters, alliances, votes, trades and auctions', class: 'Class actives', pets: 'Pet battles', chaos: 'Chaos' };
// What the next step opens, for the phone's teaser line and the TV banner.
export const STEP_TEASER = { move: 'you move: roll, step, stop, end the turn', gear: 'shops and your Cage unlock', fight: 'fights unlock — the monsters wake', challenge: 'challenges unlock — duels, wagers, robberies, the Arena', social: 'letters, alliances, votes and trades unlock', class: 'your class active unlocks', pets: 'pet battles unlock', chaos: 'Chaos rises as it should', all: 'everything unlocks — letters, alliances, votes, pacts, pets, class actives' };
export const LOCKS = {
  SHOP_BUY: 'gear', SHOP_SELL: 'gear', INN_REST: 'gear', BANK_DEPOSIT: 'gear', BANK_WITHDRAW: 'gear', PACT_TAKE: 'gear', TILE_TAKE_LOOT: 'gear', CONSUMABLE_USE: 'gear',
  GRID_MOVE: 'gear', GRID_EQUIP: 'gear', GRID_UNEQUIP: 'gear', GRID_DROP: 'gear', GRID_SORT: 'gear', GRID_RESIZE: 'gear',
  ITEM_USE: 'fight', PET_ATTACK: 'fight', AREA_OPEN: 'fight', FIGHT_START: 'fight',
  CHALLENGE_CALL: 'challenge', BOUNTY_PLACE: 'challenge',
  LETTER_SEND: 'social', ALLIANCE_PROPOSE: 'social', VOTE_OPEN: 'social', TRADE_OFFER: 'social', AUCTION_OPEN: 'social',
  PET_BATTLE_START: 'pets', CLASS_ACTIVE: 'class',
};

export const rampOf = (state) => state.gm?.ramp || null;
export function rampSteps(state) {
  const own = rampOf(state)?.steps;
  const list = Array.isArray(own) && own.length ? own : group(state, 'ramp').steps;
  return (list || []).filter(s => STEP_FEATURES[s]);
}
export const rampOn = (state) => !!rampOf(state)?.on;
const ALL = () => new Set(FEATURES);
const done = (on, turn) => ({ on, turn, step: null, index: -1, unlocked: ALL(), next: null, locked: [], done: true });

// Where a player stands on the ramp. Before their first turn they are treated as being on turn 1.
export function rampStage(state, pid) {
  const r = rampOf(state);
  const turn = Math.max(1, state.turnCounts?.[pid] || 0);
  if (!r || !r.on || !pid || !state.players?.[pid] || r.skipped?.[pid]) return done(false, turn);
  const steps = rampSteps(state);
  if (!steps.length) return done(true, turn);
  const index = Math.min(turn, steps.length) - 1;
  if (turn > steps.length) return done(true, turn);
  const unlocked = new Set();
  for (let i = 0; i <= index; i++) for (const f of STEP_FEATURES[steps[i]]) unlocked.add(f);
  if (unlocked.size === FEATURES.length) return { ...done(true, turn), step: steps[index], index };
  const locked = FEATURES.filter(f => !unlocked.has(f)).map(f => ({ feature: f, onTurn: unlockTurn(steps, f) }));
  let next = null;
  for (let i = index + 1; i < steps.length && !next; i++) if (STEP_FEATURES[steps[i]].some(f => !unlocked.has(f))) next = { feature: steps[i], onTurn: i + 1 };
  if (!next) next = { feature: 'all', onTurn: steps.length + 1 };
  return { on: true, turn, step: steps[index], index, unlocked, next, locked, done: false };
}
function unlockTurn(steps, feature) { const i = steps.findIndex(s => STEP_FEATURES[s].includes(feature)); return i < 0 ? steps.length + 1 : i + 1; }
export const unlocked = (state, pid, feature) => rampStage(state, pid).unlocked.has(feature);
export function lockMessage(state, pid, feature) {
  const st = rampStage(state, pid); const at = st.locked.find(l => l.feature === feature)?.onTurn ?? st.next?.onTurn ?? st.turn + 1;
  return `${FEATURE_LABEL[feature] || feature} unlock on your turn ${at}`;
}
export function monstersAsleepMessage(state, pid) { const at = rampStage(state, pid).locked.find(l => l.feature === 'fight')?.onTurn; return `the monsters are asleep until your turn ${at || '?'}`; }
// One teaser line for the end of the action phase: what the next turn opens.
export function rampLine(state, pid) {
  const st = rampStage(state, pid); if (st.done || !st.next) return '';
  const when = st.next.onTurn === st.turn + 1 ? 'Next turn' : `On your turn ${st.next.onTurn}`;
  return `${when}: ${STEP_TEASER[st.next.feature] || `${st.next.feature} unlocks`}`;
}

// Which seat an event acts for: the payload's seat when the GM proxies a phone, else the actor when it is a seat.
function seatOf(state, ev, ctx) {
  const p = ctx.payload || {};
  const pid = p.playerId || p.fromId || p.attackerId || null;
  if (pid) return state.players?.[pid] ? pid : null;
  return state.players?.[ev.actor] ? ev.actor : null;
}
onBefore((state, ev, ctx) => {
  const feature = LOCKS[ev.type]; if (!feature || state.phase !== 'playing' || !rampOn(state)) return;
  const pid = seatOf(state, ev, ctx); if (!pid) return;
  // Answering a "take a worn item" prompt is part of a kill, never gear shopping; it must not freeze the turn.
  if (ev.type === 'TILE_TAKE_LOOT' && state.pendingPrompt?.kind === 'takeWorn' && state.pendingPrompt.playerId === pid) return;
  if (!unlocked(state, pid, feature)) refuse(lockMessage(state, pid, feature), 'locked');
});

register({
  GM_RAMP_SKIP(state, ev, ctx) {
    requireGm(ctx);
    const r = (state.gm.ramp ||= { on: false, steps: null, skipped: {} }); r.skipped ||= {};
    const pid = ctx.payload.playerId || null;
    if (pid) { if (!state.players[pid]) refuse(`no such player ${pid}`, 'player'); r.skipped[pid] = true; note(state, `${state.players[pid].name} skips the tutorial opening`, 'gm', ctx.now); return; }
    r.on = false; note(state, 'The tutorial opening is over for everyone', 'gm', ctx.now);
  },
});
