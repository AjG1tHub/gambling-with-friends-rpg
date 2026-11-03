// "Learn to play": a five-minute solo run on one phone with no backend, TV or GM. /phone/?practice=1 boots the
// local backend in its own namespace, makes a short FFA room (tier 1, no fog, the In Person challenge list, Last
// Call at PRACTICE_MINUTES), seats the human and two bots, and runs packages/ui/autopilot.js on the phone itself:
// the bots play their seats and the autopilot performs the table duties the TV normally does (monster turns,
// deadlines, GM decisions). This file is also the GM of the practice room: it opens creation once the human is
// ready, starts the run once every seat is locked, rigs the first duel's wheel to Highest Card (no TV to watch for
// a Quick-Draw flash) and walks a bot over when it is time to call a duel. Progress through the goals below is
// read from the events the human sends and kept in localStorage, so a reload resumes where it was.
//   practiceGoal(state, me, progress) → { id, title, text, index, total, skippable }   pure; the Coach shows it
//   startPractice({ ctx, view, app })  → wires everything into main.js's ctx and renders
import { h, render, store, toast } from '../../packages/ui/dom.js';
import { boot, attach, dispatchOrToast } from '../../packages/ui/client.js';
import { startAutopilot, seatBots } from '../../packages/ui/autopilot.js';
import { roomCode, seed32, shortId } from '../../packages/shared/ids.js';
import { currentPlayerId, characterOf, activeSeats } from '../../packages/shared/state.js';
import { hexDistance } from '../../packages/shared/map/query.js';

export const PRACTICE_KEY = 'gwfrpg:practice:v1';
const PRACTICE_MINUTES = 20;          // Last Call for the practice room
const PRACTICE_BOTS = 2;
const PRACTICE_DUEL_ENTRY = 'highestcard';   // one card each, highest wins: nothing to watch on a TV
const BOT_PREFIX = 'bot';
const PULSE_MS = 1500;

// ── the goals ─────────────────────────────────────────────────────────────────────────────────────
// Each goal is done when its predicate says so; the first one not done is the current goal. `skippable` goals get a
// Skip button (the map may put no monster or shop within reach in five minutes).
const GOALS = [
  { id: 'gamble', title: 'Gamble one stat', text: 'Pick a stat, pick a game, set a stake and tap Play. One real gamble, then Lock in.', done: (s, me, c) => (c?.creation?.gambles?.length || 0) >= 1 || !!c?.locked },
  { id: 'lock', title: 'Lock in', text: 'Tap Lock in → place your spare chips (or Spread for me) → 🔒 Lock in.', done: (s, me, c) => !!c?.locked },
  { id: 'ready', title: 'Tap Ready', text: 'The two bots are ready. Tap Ready and the run starts.', done: (s, me) => !!s.players[me]?.ready || s.phase === 'playing' || s.phase === 'ended' },
  { id: 'move', title: 'Plod and stop', text: 'Tap Plod, step once or twice on the rosette, then STOP HERE. Only the hex you stop on does anything.', done: (s, me, c, p) => !!p.moved || (p.turnsEnded || 0) >= 1 },
  { id: 'end', title: 'End your turn', text: 'Let the hex resolve, then press END TURN. Everything else in the action phase is optional; End turn is not.', done: (s, me, c, p) => (p.turnsEnded || 0) >= 1 },
  { id: 'fightOrShop', title: 'Fight or shop', text: 'Next turn: walk onto the nearest monster and ATTACK it, or stop on a Shop and BUY. Skip if the map is unkind.', skippable: true, done: (s, me, c, p) => !!p.attacked || !!p.bought || !!p.skipped?.fightOrShop },
  { id: 'duel', title: 'Call a duel', text: 'In your action phase a bot steps next to you. In the Attack panel pick it, pick Duel and a weapon, tap ⚔ Duel. The call ends your turn.', done: (s, me, c, p) => !!p.duelCalled },
  { id: 'result', title: 'Read the result', text: 'The bot picks a weapon, you spin, the wheel lands. Play it. Then read the banner: who won and what it cost.', done: (s, me, c, p) => !!p.duelSettled },
  { id: 'done', title: 'You know enough', text: 'A turn, a fight and a duel: that is the game. Join a real table.', done: () => false },
];
export const GOAL_IDS = GOALS.map(x => x.id);
export function practiceGoal(state, me, progress = {}) {
  const c = characterOf(state, me);
  for (let i = 0; i < GOALS.length; i++) { const x = GOALS[i]; let done = false; try { done = x.done(state, me, c, progress); } catch { done = false; } if (!done) return { id: x.id, title: x.title, text: x.text, index: i, total: GOALS.length, skippable: !!x.skippable }; }
  return null;
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────────
export async function startPractice({ ctx, view, app }) {
  render(app, h('div', { class: 'boot' }, h('h1', {}, 'Learn to play'), h('p', { class: 'muted' }, 'Setting a table for one…')));
  const { backend, identity } = await boot({ kind: 'local', namespace: 'practice' });
  ctx.backend = backend; ctx.deviceId = identity.deviceId;
  const saved = store.get(PRACTICE_KEY, null) || {};
  const progress = saved.progress || {};
  const save = () => store.set(PRACTICE_KEY, { code: ctx.code, playerId: ctx.me, progress });
  let session = null, me = null;
  const presence = (pid) => ({ role: 'phone', playerId: pid || undefined });
  // Resume the saved room when it is still open, else make a fresh one.
  if (saved.code && saved.playerId) {
    try { const info = await backend.findRoom(saved.code); if (info && info.status !== 'ended') { ({ session } = await attach({ backend, code: saved.code, role: 'phone', view, presence: presence(saved.playerId) })); if (session.state.players[saved.playerId] && session.state.phase !== 'ended') me = saved.playerId; else { session.close(); session = null; } } } catch (e) { console.warn('practice resume', e); session = null; }
  }
  if (!session) {
    const code = roomCode();
    const create = { code, seed: seed32(), mode: 'ffa', tier: 1, size: 'short', gmPinHash: '', fogOfWar: false, challengePreset: 'inperson', balance: { table: { lastCallMinutes: PRACTICE_MINUTES } }, gmDeviceId: identity.deviceId };
    ({ session } = await attach({ backend, code, role: 'phone', view, presence: presence(null), create }));
    me = shortId('p');
    const last = store.get('gwfrpg:phone:last');
    await session.dispatch('PLAYER_JOIN', { playerId: me, name: last?.name || 'You', deviceId: identity.deviceId }, me);
    for (const k of Object.keys(progress)) delete progress[k];
  }
  ctx.session = session; ctx.me = me; ctx.code = session.code;
  const botSeats = new Set(activeSeats(session.state).filter(id => id.startsWith(`${BOT_PREFIX}-`)));
  if (botSeats.size < PRACTICE_BOTS) { try { for (const id of await seatBots(session, PRACTICE_BOTS, { prefix: BOT_PREFIX })) botSeats.add(id); } catch (e) { console.error(e); toast(`bots: ${e.message}`, 'bad'); } }
  save();
  // The bots and the table duties, on this phone. No GM console is ever online here.
  const autopilot = startAutopilot(session, { botSeats, autostart: false, intervalMs: 1500, isGmOnline: () => false });
  const gm = (type, payload = {}) => dispatchOrToast(session, type, payload, 'gm');
  const busy = {};
  const once = async (key, fn) => { if (busy[key]) return; busy[key] = true; try { await fn(); } finally { busy[key] = false; } };

  const controller = {
    code: session.code, progress, session,
    goal: (state) => practiceGoal(state, me, progress),
    skip: (id) => { (progress.skipped ||= {})[id] = true; save(); duties(session.state); },
    async quit() { try { if (session.state.phase !== 'ended') await session.dispatch('GM_END_RUN', { reason: 'practice over' }, 'gm'); } catch { /* the room is gone anyway */ } leave(); },
    finish() { controller.quit(); },
  };
  const leave = () => { try { autopilot.stop(); off?.(); clearInterval(pulse); session.close(); backend._reset?.(); } catch { /* ignore */ } store.del(PRACTICE_KEY); location.href = location.pathname; };
  ctx.practice = controller;
  window.__gwf = { session, ctx, autopilot, practice: controller };

  // Progress from the human's own events; the practice GM's duties from the state after each event.
  const off = session.onChange((state, ev) => {
    try {
      if (ev && (ev.actor === me || ev.payload?.playerId === me) && !(state.lastError && state.lastError.ts === ev.ts && state.lastError.type === ev.type)) {
        let changed = true;
        if (ev.type === 'MOVE_STOP' || ev.type === 'MOVE_STEP' || ev.type === 'MOVE_PATH') progress.moved = true;
        else if (ev.type === 'TURN_END') progress.turnsEnded = (progress.turnsEnded || 0) + 1;
        else if (ev.type === 'ITEM_USE' || ev.type === 'PET_ATTACK') progress.attacked = true;
        else if (ev.type === 'SHOP_BUY') progress.bought = true;
        else if (ev.type === 'CHALLENGE_CALL') { progress.duelCalled = true; progress.duelId = state.challenge?.id || null; once('rig', () => gm('GM_RIG', { stream: 'challenge', value: PRACTICE_DUEL_ENTRY })); }
        else changed = false;
        if (changed) save();
      }
      const lc = state.lastChallenge;
      if (!progress.duelSettled && progress.duelCalled && lc && lc.endedAt && lc.id === progress.duelId && lc.attackerId === me) { progress.duelSettled = true; save(); }   // the human's own call, not a bot's earlier duel on them
      duties(state);
    } catch (e) { console.error('practice', e); }
  });
  function duties(state) {
    const p = state.players[me]; if (!p) return;
    const seats = activeSeats(state);
    if (state.phase === 'lobby' && seats.every(id => state.players[id]?.ready)) return once('open', () => gm('CREATION_OPEN', {}));
    if (state.phase === 'creation') {
      // The lobby Ready carries into creation; take it back once so the human taps Ready after locking in (the lesson).
      if (!progress.unreadied && p.ready && !characterOf(state, me)?.locked) { progress.unreadied = true; save(); return once('unready', () => gm('PLAYER_READY', { playerId: me, ready: false })); }
      const locked = seats.every(id => { const c = characterOf(state, id); return c && c.locked && !c.hatching && state.players[id]?.ready; });
      if (locked) return once('start', () => gm('RUN_START', {}));
      return;
    }
    if (state.phase !== 'playing') return;
    // Time for the duel: on the human's action phase, with no fight or challenge open, bring a bot within reach.
    const goal = practiceGoal(state, me, progress);
    const c = characterOf(state, me);
    if (goal?.id === 'duel' && c && !c.dead && currentPlayerId(state) === me && state.turnPhase === 'action' && !(state.fight && !state.fight.done) && !state.challenge && !state.pendingPrompt && busy.teleTurn !== state.turnIdx) {
      const near = [...botSeats].some(id => { const bc = characterOf(state, id); return bc && !bc.dead && bc.pos && hexDistance(bc.pos, c.pos) <= 1 && !state.held[id]; });
      if (near) return;
      const bot = [...botSeats].map(id => ({ id, c: characterOf(state, id) })).find(x => x.c && !x.c.dead && !state.held[x.id]);
      if (!bot) return;
      busy.teleTurn = state.turnIdx;
      once('tele', async () => { const ok = await gm('GM_TELEPORT', { playerId: bot.id, hex: c.pos }); if (ok) toast(`${bot.c.name} wanders over to your hex`, '', 3000); });
    }
  }
  // Duties also run on a pulse: a goal can change without an event (a Skip), and a refused dispatch leaves no trace.
  const pulse = setInterval(() => { try { duties(session.state); } catch (e) { console.error('practice', e); } }, PULSE_MS);
  duties(session.state);
  view(session.state, session);
}
