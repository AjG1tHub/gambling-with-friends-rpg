// The Coach: the phone's built-in tutorial. One card at the top of the current tab, derived from the room state
// (never a slideshow): what this screen is, what to press, why it is not your turn. Pure parts, unit-tested:
//   coachStep(state, me, ctx)      → { id, title, text, auto } | null   the situation the player is in, as a card
//   turnOrderLine(state, me)       → "Held in a challenge: Jam — Ajax plays their slot. Order: Ajax → Jam → you"
// DOM parts, called from main.js on every render:
//   coachCard(api)                 → the card element (the coach step, plus a GM "📖" rule broadcast when one is fresh)
//   coachPanel({ rerender })       → Self tab controls: show the tips again / hide every tip
// A step is dismissed with "Got it" (persisted per device under gwfrpg:coach:v1) or auto-dismissed when the player
// does the thing (the situation changes while the card was showing). In tutorial mode (the practice run) nothing
// is dismissible and the practice goal rides under the step. The whole layer is wrapped in try/catch: a thrown
// error here never breaks view().
import { h, store } from '../../packages/ui/dom.js';
import { group } from '../../packages/shared/balance.js';
import { tableSeats, currentPlayerId, characterOf } from '../../packages/shared/state.js';
import { challengeView, VERSUS_GAMES } from '../../packages/shared/handlers/challenge.js';
import { bootsOf, bootMode, bootDie, bootAffixes } from '../../packages/shared/handlers/movement.js';
import { livingMonsterAt } from '../../packages/shared/map/query.js';
import { rampStage, rampLine, FEATURE_LABEL } from '../../packages/shared/handlers/ramp.js';

export const COACH_KEY = 'gwfrpg:coach:v1';          // dismissed step ids
export const COACH_OFF_KEY = 'gwfrpg:coach:off';     // "hide all tips"
export const RULES_SEEN_KEY = 'gwfrpg:coach:rules:v1'; // 📖 broadcast ids already dismissed on this device
const RULE_PREFIX = '📖 ';
const RULE_FRESH_MS = 60000;   // a 📖 broadcast older than this is history, not a card

const g = (state, k) => { try { return group(state, k); } catch { return {}; } };
const nameOf = (state, pid) => characterOf(state, pid)?.name || state.players[pid]?.name || '—';
// The order line uses the seat's name, as the phone's header ("OX TO MOVE") does; the coach cards name characters.
const seatName = (state, pid) => state.players[pid]?.name || characterOf(state, pid)?.name || '—';
const pct = (x) => Math.round((x || 0) * 100);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const list = (xs) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────
// Each situation is a step: a short title, plain second-person text (≈45 words), `auto` when doing the thing
// dismisses it. Text builders get (state, me, c, ctx) so numbers come from the room's balance and the practice
// run can word itself (no GM, no TV).
function statsText(state, c) {
  const C = g(state, 'creation'), S = g(state, 'stats');
  return `${c?.chips ?? C.chips} chips, every stat starts at ${S.creationStart}. Pick a stat and a game, stake ${C.minStake}–${C.maxStake}: a win pays chips × the multiplier into that stat, a loss burns them. Or keep chips and Lock in for 1 point each. Under ${S.neutral} a stat is a debuff; ${S.max} is the cap and a real edge.`;
}
function bootsText(state, c) {
  const MV = g(state, 'movement'); const item = bootsOf(c);
  if (!item) return `Your boots decide how you move. Barefoot means you plod ${MV.barefoot}: tap Plod, then step hex by hex and stop where you like. Boots turn up in chests and shops.`;
  let mode = 'dice'; try { mode = bootMode(item, {}); } catch { mode = 'choose'; }
  if (mode === 'choose') return `${item.name} lets you pick how to move this turn: dice, wheel or card. Pick one, then step hex by hex and stop where you like unless the boots say otherwise.`;
  if (mode === 'wheel') return `${item.name} spins the movement wheel: 1 to 6, Sprint, Stumble, Teleport or Swap. Tap Spin, then step hex by hex; stop where you like unless the boots say otherwise.`;
  if (mode === 'card') return `${item.name} draws a colour: you jump to the nearest hex of that colour within ${MV.cardRange}. Tap Draw, then tap a lit hex.`;
  let die = null; try { die = bootDie(item, bootAffixes(item)); } catch { die = null; }
  return `${item.name} roll a d${die || '?'}: tap Roll, then step hex by hex up to the roll. Stop where you like unless the boots say otherwise. Only the hex you stop on does anything.`;
}
const STEPS = {
  lobby: { title: 'The lobby', auto: true, text: (state, me, c, ctx) => ctx?.tutorial ? 'You have a seat; two bots sit with you. Tap Ready and character creation opens on its own. The ? up top explains any screen.' : 'You have a seat. Tap Ready when you can see the TV. The GM opens character creation from the console; your phone changes on its own. The ? up top explains any screen.' },
  bug: { title: 'The 🐞 button', text: () => 'Something looks wrong tonight? Tap 🐞 and say what happened. Bug hunters get a secret reward wheel from the House.' },
  'creation.look': { title: 'Make your character', auto: true, text: () => 'Pick a name, a crest and a look, then tap That is me. Names are one of a kind: the dead go on the Wall for good.' },
  'creation.class': { title: 'Pick a class', auto: true, text: () => 'Each class fixes your starting weapon and gives +1 to its stat. Read the passive: it shapes how you play all night.' },
  'creation.gamble': { title: 'Gamble your stats', auto: true, text: statsText },
  'creation.blood': { title: 'More games, or lock in', auto: true, text: (state, me, c) => { const C = g(state, 'creation'); return `${c?.chips ?? 0} chips left: play again, or stop. Blood option: bleed ${C.bloodHealthPerChip} max Health per chip for extra chips, once. Lock in turns the chips you kept into points, 1 each.`; } },
  'creation.ready': { title: 'Locked. Now Ready', auto: true, text: (state, me, c, ctx) => `Your character is set. Pull items from your vault, pick a pet team, hatch an egg if one is offered. Then tap Ready: the run starts ${ctx?.tutorial ? 'at once' : 'when the GM says so'}.` },
  'creation.wait': { title: 'Waiting on the table', text: (state, me, c, ctx) => ctx?.tutorial ? 'You are ready. The run starts as soon as the bots have locked in.' : 'You are ready. The GM starts the run once every seat is locked; the TV shows the turn order. Browse Cage and Self meanwhile.' },
  'pets.hatch': { title: 'Triple Pet Wheel', auto: true, text: () => 'Three wheels stopped. Tap one column to keep that pet; a dud hatches nothing.' },
  'challenge.attacker.answer': { title: 'Waiting on the answer', text: (state, me) => `${nameOf(state, state.challenge?.defenderId)} may accept or decline the wager. A decline costs nobody anything.` },
  'challenge.attacker.ready': { title: 'Your challenge', text: (state, me) => { const ch = state.challenge; const def = nameOf(state, ch?.defenderId); return `Calling ${def} ended your turn; both of you sit out until it settles. ${ch?.call === 'duel' ? `${def} picks a weapon or bare hands, then` : 'Now'} you spin the Challenge Wheel: it picks the game. The loser takes the winner's weapon stake.`; } },
  'challenge.spinning': { title: 'The wheel turns', text: (state, me, c, ctx) => ctx?.tutorial ? 'The wheel lands in a moment; at a real table the GM sees the result first and may nudge it.' : `The GM sees the result for ${g(state, 'challenge').gmWindowSeconds} seconds and may nudge it; then it lands.` },
  'challenge.play.hosted': { title: 'Play it here', text: () => 'This one plays on both phones. Follow the prompt; the result settles itself and the table resumes.' },
  'challenge.play.versus': { title: 'A Versus item', text: (state, me) => { const ch = state.challenge; return ch?.attackerId === me ? 'You play the round on your phone; the TV shows the stage. A win takes the round, a loss hands it over, a push is a draw.' : `${nameOf(state, ch?.attackerId)} plays it on their phone. Watch the TV; their phone reports the result.`; } },
  'challenge.play.external': { title: 'Away from the table', text: (state) => `Play it for real at the table. Then both phones tap who won; disagree and the GM decides. Nobody reports before the cap and you both take ${g(state, 'challenge').timeoutDamage}.` },
  'challenge.defender.wager': { title: 'A wager on you', text: (state) => `${nameOf(state, state.challenge?.attackerId)} wagers ${state.challenge?.amount} Gold. Accept and the wheel picks a game; decline and it costs nothing.` },
  'challenge.defender': { title: 'You are challenged', text: (state) => { const ch = state.challenge; const atk = nameOf(state, ch?.attackerId); return `${atk} called you to a ${ch?.call}. Pick a weapon: win the game and it hits them for its stake. Bare hands win nothing and lose nothing extra. Then ${atk} spins the wheel.`; } },
  'challenge.defender.wait': { title: 'Their spin', text: (state) => `${nameOf(state, state.challenge?.attackerId)} spins the Challenge Wheel. It picks the game you both play.` },
  held: { title: 'Held', text: () => 'You are away in a challenge: the table skips your slot and plays on. When it settles you rejoin, and any turn you missed comes back to you.' },
  dead: { title: 'You are dead', text: (state, me, c) => `You miss ${plural(c?.missTurns || 0, 'turn')}: tap Pass when the turn comes. Then you wake at the Graveyard with ${pct(g(state, 'death').wakeFraction)}% Health. Your drops lie where you fell.` },
  'fight.round': { title: 'Play the round', text: (state, me, c) => { const game = state.fight?.game; return `The stake is ${game?.stake ?? '?'} Health and the game is the item's. Win: the target takes the hit. Lose: you lose the stake. The stat on the item is your lever; above ${g(state, 'stats').neutral} it bends the odds your way.`; } },
  'fight.monster': { title: "The monster's move", text: () => 'The table plays the monster\'s swing. Your clock is stopped until it lands.' },
  fight: { title: 'A fight', auto: true, text: (state) => `Tap a weapon to attack (one a turn): you stake its Health cost on its game. Spells heal or shield. Back away ends the fight; End turn gives the monster a free swing and you pick it up next turn.` },
  'area': { title: 'An Area round', text: () => 'Everyone on this hex stakes Health before the countdown ends; winners strike, losers bleed. Pick a stake and tap Stake it.' },
  waiting: { title: 'Not your turn', text: () => 'The boxed line below says why, and who is next: held seats are skipped and the table plays on; a missed turn is owed back. Your phone buzzes on your turn. Meanwhile: Cage to equip, Self for stats, Letters to plot.' },
  'move.roll': { title: 'Your move', auto: true, text: bootsText },
  'move.step': { title: 'Step by step', auto: true, text: () => 'Tap a direction, or a hex on the map, once per step. Only the hex you stop on does something. STOP HERE ends the move early when the boots allow it.' },
  'move.spent': { title: 'Move spent', text: () => 'Your move is done for this turn. End turn passes play to the next seat.' },
  'prompt.spin': { title: 'A wheel hex', auto: true, text: () => 'You stopped on a wheel. Tap Spin; the TV lands it and the result applies to you.' },
  'prompt.portal': { title: 'A portal', auto: true, text: () => 'Pick a region to step through, or stay where you are. An unseen region is a gamble.' },
  'prompt.arena': { title: 'The Arena', auto: true, text: () => 'Call anyone standing to a duel with a Gold pot on the side, a pet battle, or walk on.' },
  'prompt.takeWorn': { title: 'The spoils', auto: true, text: () => 'Take one worn item from the fallen, or nothing.' },
  resolve: { title: 'The hex is working', text: () => 'Wait a beat: the tile resolves itself. If it never does, End turn anyway.' },
  action: { title: 'Action phase', auto: true, text: (state, me, c) => { const here = state.map?.hexes?.[c?.pos]; const m = c?.pos ? livingMonsterAt(state, c.pos) : null; const extra = m ? ` ${m.name} stands here: attack from the fight panel.` : here?.type === 'shop' ? ' You stand in a Shop: buy with Gold below.' : here?.type === 'inn' ? ' The Inn heals once per visit.' : ''; return `Shop, bag, attack and challenge are all optional. END TURN is the button that passes play, and the chess clock is running: not pressing it is how a table stalls.${extra}`; } },
  'tab.cage': { title: 'The Cage', text: () => 'Your gear. Drag items onto the paper doll to wear them; only worn weapons and spells can be used. The grid is your bag: everything in it drops when you die.' },
  'tab.self': { title: 'Self', text: () => 'Your stats and the games each one bends, your class kit, pacts and quests, the Mirror for your look, your claim code, and the full rules at the bottom.' },
  'tab.pets': { title: 'Pets', text: () => 'Your team. The active pet fights beside you and spends Power on its attacks; eggs hatch on the Triple Pet Wheel.' },
  'tab.map': { title: 'The map', text: () => 'Where everyone stands. On your move, tap a hex here to path to it one step at a time.' },
  'tab.letters': { title: 'Letters', text: () => 'Send a letter by crow: it lands two of the recipient\'s turns later, and anyone it crosses may read it. Alliances are proposed here too.' },
  ended: { title: 'The run is over', text: (state, me, c) => { const G = g(state, 'grid'); const alive = c && !c.dead && !(c.deaths > 0); return `Pick up to ${alive ? G.vaultSurvivor : G.vaultDead} items to vault: they come back next run. ${alive ? 'Survivors can save as a veteran and keep their level.' : 'The dead go on the Wall; the look and class may return under a new name.'}`; } },
};
export const STEP_IDS = Object.keys(STEPS);

// The tutorial opening (handlers/ramp.js): while the ramp is on, the card for each of the player's first turns is
// the step's own text, keyed by the step name (a feature key or 'all'). It replaces the plain turn cards
// (move.roll, move.spent, action) on the player's turn; the sharper situational cards (a prompt, a round, a fight)
// still win when they apply. Dismissed per step like any other card; never dismissible in the practice run.
export const RAMP_STEPS = {
  move: { title: 'Turn 1: the walk', text: (state, me, c) => `${bootsText(state, c)} The hex you stop on still does its thing, but the monsters are asleep for you and nothing else is open yet. Then END TURN.` },
  gear: { title: 'Turn 2: gear', text: (state) => `Shops, the Inn, the Bank and your Cage open. Stop on a Shop to BUY (a Common weapon is always on the shelf), on the Inn to Rest (+${g(state, 'health').innHeal}). Open the Cage to equip, bag or drop; potions and loot on the ground are yours to take.` },
  fight: { title: 'Turn 3: fights', text: () => 'The monsters wake. Walk onto one, or ATTACK from the fight panel: you stake your weapon\'s Health cost on its game; win and the monster takes the hit, lose and you do. Spells and Area items open too. From now on a monster swings back.' },
  challenge: { title: 'Turn 4: challenges', text: () => 'Duels, wagers and robberies: call a player in reach from the Attack panel and the Challenge Wheel picks the game. The call ends your turn. The Arena and the Bounty Board open as well.' },
  social: { title: 'Turn 5: the table', text: () => 'Letters by crow, alliances, votes, trades and auctions are open. Plot.' },
  class: { title: 'Your class active', text: () => 'Your class active is open: find it under the attack panel, on a cooldown.' },
  pets: { title: 'Pet battles', text: () => 'Pet battles are open: your pets fight another player\'s pets for a Gold wager.' },
  chaos: { title: 'Chaos', text: () => 'Chaos rises as it should from here: the Chaos wheel spins at the table\'s tier for you.' },
  all: { title: 'Turn 5: everything', text: () => 'Letters, alliances, votes, pacts, trades, pet battles and your class active are open, and Chaos rises as it should. The opening is over: it is the whole game from here.' },
};
const RAMP_OVER = new Set(['move.roll', 'move.spent', 'action', 'resolve']);
// The ramp card for this turn, or null when the ramp is off / over for the player, it is not their turn, or the
// situation is one the ramp card should not cover.
function rampCard(state, me, sit, ctx) {
  let st = null; try { st = rampStage(state, me); } catch { return null; }
  if (!st?.on || st.index < 0 || !st.step || !RAMP_STEPS[st.step]) return null;
  if (currentPlayerId(state) !== me || !RAMP_OVER.has(sit)) return null;
  const id = `ramp.${st.step}`;
  if (!ctx.tutorial && ctx.dismissed?.has(id)) return null;
  const def = RAMP_STEPS[st.step]; const c = characterOf(state, me);
  let text = ''; try { text = def.text(state, me, c, ctx); } catch { text = ''; }
  let tease = ''; try { tease = rampLine(state, me); } catch { tease = ''; }
  return { id, title: def.title, text: tease ? `${text} ${tease}.` : text, auto: false, ramp: st.step };
}
// What the ramp still holds back from this player, for the help sheet: [{ feature, label, onTurn }].
export function rampLocks(state, me) {
  let st = null; try { st = rampStage(state, me); } catch { return []; }
  if (!st?.on || st.done) return [];
  return st.locked.map(l => ({ ...l, label: FEATURE_LABEL[l.feature] || l.feature }));
}

// Which situation the player is in. `me` is the player id; ctx = { tab, dismissed: Set, tutorial, now }.
export function situation(state, me, ctx = {}) {
  const p = state.players?.[me]; if (!p) return null;
  const c = characterOf(state, me);
  const tab = ctx.tab || 'play';
  if (tab !== 'play') return `tab.${tab}`;
  if (state.phase === 'lobby') return ctx.dismissed?.has('lobby') ? 'bug' : 'lobby';
  if (state.phase === 'creation') {
    if (p.spectator) return null;
    if (c?.hatching) return 'pets.hatch';
    if (!c) return 'creation.look';
    if (!c.classId) return 'creation.class';
    if (!c.locked) return (c.creation?.gambles?.length || 0) > 0 ? 'creation.blood' : 'creation.gamble';
    return p.ready ? 'creation.wait' : 'creation.ready';
  }
  if (state.phase === 'ended') return 'ended';
  if (state.phase !== 'playing' || !c || p.spectator) return null;
  const pid = currentPlayerId(state), myTurn = pid === me;
  if (c.hatching) return 'pets.hatch';
  const ch = state.challenge && !state.challenge.done ? state.challenge : null;
  if (ch && (ch.attackerId === me || ch.defenderId === me)) {
    let v = null; try { v = challengeView(state, me, ctx.now ?? Date.now()); } catch { v = null; }
    const role = ch.attackerId === me ? 'attacker' : 'defender';
    const phase = v?.phase || (ch.spun ? 'playing' : 'ready');
    if (phase === 'answer') return role === 'attacker' ? 'challenge.attacker.answer' : 'challenge.defender.wager';
    if (phase === 'ready') return role === 'attacker' ? 'challenge.attacker.ready' : (v?.needsWeapon || (!ch.defenderAnswered && ch.call !== 'wager')) ? 'challenge.defender' : 'challenge.defender.wait';
    if (phase === 'spinning') return 'challenge.spinning';
    if (phase === 'playing' || phase === 'done') { const e = v?.entry || ch.entry; if (e?.hosted && (ch.hostedGame || v?.hosted)) return 'challenge.play.hosted'; if (e?.hosted && VERSUS_GAMES.includes(e.game)) return 'challenge.play.versus'; return 'challenge.play.external'; }
  }
  if (state.held[me] && !state.held[me].owedWait) return 'held';
  if (state.area && !state.area.done && state.area.hexKey === c.pos && !c.dead) return 'area';
  const pr = state.pendingPrompt;
  if (pr && pr.playerId === me && ['spin', 'portal', 'arena', 'takeWorn'].includes(pr.kind)) return `prompt.${pr.kind}`;
  const f = state.fight && !state.fight.done ? state.fight : null;
  if (f && (f.playerId === me || (f.playerIds || []).includes(me))) {
    if (f.game && !f.game.result && f.game.attackerPlayerId === me) return 'fight.round';
    if (f.turn === 'monster') return 'fight.monster';
    if (myTurn) return 'fight';
  }
  if (!myTurn) return 'waiting';
  if (c.dead) return 'dead';
  if (state.turnPhase === 'move') { const s = state.moveSession; if (s && s.playerId === me && !s.done) return 'move.step'; return c.usedThisTurn?.moved ? 'move.spent' : 'move.roll'; }
  if (state.turnPhase === 'resolve') return 'resolve';
  return 'action';
}

export function coachStep(state, me, ctx = {}) {
  const id = situation(state, me, ctx); if (!id || !STEPS[id]) return null;
  const ramp = state.phase === 'playing' ? rampCard(state, me, id, ctx) : null; if (ramp) return ramp;
  if (!ctx.tutorial && ctx.dismissed?.has(id)) return null;
  const def = STEPS[id]; const c = characterOf(state, me);
  let text = ''; try { text = def.text(state, me, c, ctx); } catch (e) { text = ''; }
  return { id, title: def.title, text, auto: !!def.auto };
}

// Why it is not your turn, in one line: held seats and who plays their slot, owed turns, then the order round the
// table from the mover. Pure; used by the waiting screen and the 'waiting' step.
export function turnOrderLine(state, me) {
  const seats = tableSeats(state); if (!seats.length) return '';
  const cur = currentPlayerId(state);
  const name = (id) => (id === me ? 'you' : seatName(state, id));
  const Name = (id) => (id === me ? 'You' : seatName(state, id));
  const held = seats.filter(id => state.held?.[id] && !state.held[id].owedWait);
  const owed = (state.owedTurns || []).filter(o => seats.includes(o.playerId));
  const parts = [];
  if (held.includes(me)) parts.push(`Held in a challenge: ${list(held.map(name))}. ${Name(cur)} ${cur === me ? 'play' : 'plays'} your slot; you rejoin when it settles.`);
  else if (held.length) parts.push(`Held in a challenge: ${list(held.map(name))} — ${name(cur)} plays their slot.`);
  const mine = owed.find(o => o.playerId === me);
  if (mine && cur !== me) parts.push(`You are owed a turn from slot ${(mine.at % seats.length) + 1}; it comes right after this one.`);
  else if (owed.length) { const who = [...new Set(owed.map(o => o.playerId))].filter(id => id !== me); if (who.length) parts.push(`${list(who.map(Name))} ${who.length === 1 ? 'is' : 'are'} owed a turn; it comes right after this one.`); }
  const start = Math.max(0, seats.indexOf(cur));
  const ring = seats.map((_, i) => seats[(start + i) % seats.length]).filter(id => !held.includes(id) || id === cur);
  parts.push(`Order: ${ring.map(id => `${seatName(state, id)}${id === me ? ' (you)' : ''}`).join(' → ')}.`);
  if (cur !== me && !owed.length && ring[1] === me) parts.push('You are next.');
  return parts.join(' ');
}

// ── persistence ──────────────────────────────────────────────────────────────────────────────────
const dismissedSet = () => { const v = store.get(COACH_KEY, []); return new Set(Array.isArray(v) ? v : []); };
export function dismissStep(id) { const s = dismissedSet(); s.add(id); store.set(COACH_KEY, [...s]); }
export const resetCoach = () => { store.del(COACH_KEY); store.set(COACH_OFF_KEY, false); };
export const coachHidden = () => !!store.get(COACH_OFF_KEY, false);

// ── the card ─────────────────────────────────────────────────────────────────────────────────────
// api = main.js's tab api ({ state, ctx, me (player object), c, rerender, h }). Returns an element or null.
export function coachCard(api) {
  const kids = [];
  try { const r = ruleBroadcastCard(api); if (r) kids.push(r); } catch (e) { console.error('coach rule card', e); }
  try { const s = stepCard(api); if (s) kids.push(s); } catch (e) { console.error('coach', e); }
  if (!kids.length) return null;
  return h('div', { class: 'coach-slot' }, kids);
}
function stepCard({ state, ctx, me, rerender }) {
  const pid = me.id; const tutorial = !!ctx.practice;
  if (!tutorial && coachHidden()) return null;
  const dismissed = dismissedSet();
  const step = coachStep(state, pid, { tab: ctx.tab, dismissed, tutorial });
  // Auto-dismiss: the card that was showing on the Play tab is gone because the player did the thing.
  const mem = ctx.coach ||= { last: null };
  if (!tutorial && mem.last && mem.last.auto && mem.last.tab === ctx.tab && step?.id !== mem.last.id) { dismissStep(mem.last.id); dismissed.add(mem.last.id); }
  mem.last = step ? { id: step.id, auto: step.auto, tab: ctx.tab } : null;
  // The GM window ends on a timer, not an event: redraw the card when the wheel lands.
  if (step?.id === 'challenge.spinning') { const until = state.challenge?.gmWindowUntil || 0; clearTimeout(mem.timer); mem.timer = setTimeout(() => { try { rerender(); } catch { /* ignore */ } }, Math.max(200, until - Date.now() + 150)); }
  const goal = tutorial ? safeGoal(ctx.practice, state, pid) : null;
  if (!step && !goal) return null;
  const el = h('div', { class: `coach${tutorial ? ' tutorial' : ''}`, role: 'note', dataset: { step: step?.id || '' } });
  if (step) el.append(h('div', { class: 'coach-title' }, step.title), h('p', { class: 'coach-text' }, step.text));
  if (goal) el.append(h('div', { class: 'coach-goal' }, h('span', { class: 'tag' }, `Practice ${goal.index + 1} / ${goal.total} · ${goal.title}`), h('p', {}, goal.text),
    goal.skippable ? h('button', { class: 'ghost mini', onClick: () => { ctx.practice.skip(goal.id); rerender(); } }, 'Skip this one') : null,
    goal.id === 'done' ? h('button', { class: 'primary big coach-done', onClick: () => ctx.practice.finish() }, 'You know enough. Join a real table.') : null));
  if (step && !tutorial) el.append(h('div', { class: 'coach-row' }, h('button', { class: 'coach-ok', onClick: () => { dismissStep(step.id); rerender(); } }, 'Got it')));
  return el;
}
const safeGoal = (practice, state, pid) => { try { return practice?.goal?.(state, pid) || null; } catch (e) { console.error('practice goal', e); return null; } };

// A GM "📖 Title: text" broadcast (GM_BROADCAST, state.toasts with to == null) shown as a card instead of a toast:
// the newest one under 60 s old that this device has not dismissed. main.js skips the toast for these.
export const isRuleBroadcast = (t) => !!t && t.to == null && typeof t.text === 'string' && t.text.startsWith(RULE_PREFIX);
export function parseRuleBroadcast(text) { const body = String(text || '').slice(RULE_PREFIX.length); const i = body.indexOf(': '); return i > 0 ? { title: body.slice(0, i).trim(), text: body.slice(i + 2).trim() } : { title: 'From the GM', text: body.trim() }; }
const rulesSeen = () => { const v = store.get(RULES_SEEN_KEY, []); return new Set(Array.isArray(v) ? v : []); };
function ruleBroadcastCard({ state, rerender }) {
  const seen = rulesSeen(); const now = Date.now();
  const t = (state.toasts || []).filter(x => isRuleBroadcast(x) && now - x.ts < RULE_FRESH_MS && !seen.has(x.id)).at(-1);
  if (!t) return null;
  const { title, text } = parseRuleBroadcast(t.text);
  return h('div', { class: 'coach rule', role: 'note', dataset: { toast: t.id } }, h('div', { class: 'coach-title' }, `📖 ${title}`), h('p', { class: 'coach-text' }, text),
    h('div', { class: 'coach-row' }, h('button', { class: 'coach-ok', onClick: () => { seen.add(t.id); store.set(RULES_SEEN_KEY, [...seen].slice(-40)); rerender(); } }, 'Got it')));
}

// Self tab: bring the tips back, or hide the coach entirely.
export function coachPanel({ rerender }) {
  const off = coachHidden();
  return h('div', { class: 'panel coach-panel' }, h('h3', {}, 'Tips'),
    h('p', { class: 'muted small ital' }, off ? 'The coach is hidden on this phone.' : 'The coach shows one card per situation and goes quiet once you have seen it.'),
    h('div', { class: 'row' }, h('button', { class: 'grow', onClick: () => { resetCoach(); rerender(); } }, 'Show tips again'),
      h('button', { class: `grow ${off ? 'primary' : ''}`, onClick: () => { store.set(COACH_OFF_KEY, !off); rerender(); } }, off ? 'Show the coach' : 'Hide all tips')));
}
