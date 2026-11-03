// The table's tutorial, shared by the TV and the GM console (the phones have their own Coach in apps/phone/coach.js).
// Two things live here:
//   ruleCards(state) — the "How to play" cards the TV cycles in the lobby and during creation, and the GM can push to
//                      every phone with one tap (GM_BROADCAST). Numbers come from the room's balance, never typed in.
//   orderLine(state) — "Milkiee ▸ Jam (held) ▸ Ajax" plus why the table is where it is: held seats, owed turns, the
//                      dead. The TV prints it under To Move so the room never asks "whose turn is it?" again.
//   rampBanner(state) — "Milkiee's turn 3 — fights unlock — the monsters wake" while the tutorial opening
//                      (handlers/ramp.js) is on and the mover's turn is one that unlocks a step; the TV rail line.
import { group } from '../shared/balance.js';
import { tableSeats, currentPlayerId, characterOf } from '../shared/state.js';
import { rampStage, STEP_TEASER } from '../shared/handlers/ramp.js';

const mins = (s) => `${Math.round(s / 60)} min`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// phase: 'lobby' cards show before creation opens, 'creation' during creation, 'any' both. Order matters: it is the order
// the TV cycles and the order the console lists them.
export function ruleCards(state) {
  const g = (k) => group(state, k);
  const C = g('clock'), M = g('movement'), S = g('stats'), I = g('items'), D = g('death'), T = g('table'), CR = g('creation'), CH = g('challenge');
  const modeGoal = { ffa: 'Reach the throne at the heart of the Citadel, or be the last one standing.', royale: 'Be the last one standing; the circle closes.', pvp: 'Be the last one standing. Only players can eliminate players.', pve: 'Kill the Dealer before it kills all of you.', teams: 'Last team standing, or the team that kills the Dealer.' }[state.mode] || 'Reach the throne, or be the last one standing.';
  return [
    { id: 'goal', phase: 'any', title: 'The goal', text: `${modeGoal} Your Health is your bankroll: every fight stakes it. At ${mins(T.lastCallMinutes)} the House calls Last Call and placings decide.` },
    { id: 'phone', phase: 'any', title: 'Your phone is your character', text: 'Everything you do, you do on your phone: Play is the current prompt, Cage is your gear grid, Self is stats and rules, Pets, Map, Letters. Tap ? on any screen for help. Your phone buzzes on your turn.' },
    { id: 'creation', phase: 'creation', title: 'Making a character', text: `Look → class → stats. You get ${CR.chips} Stat Chips: stake ${CR.minStake}–${CR.maxStake} on a quick game and a win turns them into stat points, or keep them and take 1 point each. Then Lock in, hatch a pet, tap Ready.` },
    { id: 'stats', phase: 'any', title: 'Luck · Nerve · Greed · Grit', text: `Every weapon runs on one stat. Neutral is ${S.neutral}: below ${S.neutral} that weapon is worse than its base odds (−${Math.round(I.leverPenaltyPerPoint * 100)}% per point), above it is better (+${Math.round(I.leverBonusPerPoint * 100)}% per point). ${S.max} is the cap and a real edge. Find gear that fits your stats.` },
    { id: 'turn', phase: 'any', title: 'A turn', text: `Roll your boots (barefoot = plod ${M.barefoot}) → step hex by hex, stop where you like → the hex does its thing → shop, bag, attack or challenge if you want → END TURN. The clock gives you ${mmss(C.perTurnSeconds)} a turn, banked up to ${mmss(C.bankCapSeconds)}; at zero the turn ends for you.` },
    { id: 'fight', phase: 'any', title: 'Fights', text: `Step onto a monster or attack one next to you. Your weapon is a casino game: stake Health, play the round on your phone, win and the monster takes the hit, lose and you do. One attack a turn. Potions and the Inn heal.` },
    { id: 'wheel', phase: 'any', title: 'The Challenge Wheel', text: `Call a player next to you to a Duel, Wager or Robbery. The wheel picks a game: some play on the attacker's phone, some you play for real at the table and both phones report who won. The call ends your turn and both of you sit out until it settles.` },
    { id: 'death', phase: 'any', title: 'Dying', text: `Die to a monster: your grid and ${D.wornDropsOnMonsterDeath} worn item drop where you fell, you miss ${D.monsterMissTurns} turn and wake at the Graveyard at ${Math.round(D.wakeFraction * 100)}% Health. Die to a player or a boss: the same drops, miss ${D.playerMissTurns} turns and lose a level. Pick your drops back up if you can.` },
    { id: 'bug', phase: 'any', title: 'See something broken?', text: `Tap 🐞 on your phone and say what happened. The GM spins a secret reward wheel for bug hunters. First nights are for finding what breaks — say so, don't suffer it.` },
    { id: 'timeout', phase: 'any', title: 'Away from the table', text: `A game played off the phones has a time cap: nobody reports by then and both players take ${CH.timeoutDamage}. Disagree on who won? The GM decides from the console.` },
  ];
}

// The seat order from the current mover round the table, with why each seat is where it is.
export function orderLine(state) {
  const seats = tableSeats(state); if (!seats.length) return { text: '', why: '' };
  const cur = currentPlayerId(state);
  const name = (id) => characterOf(state, id)?.name || state.players[id]?.name || id;
  const mark = (id) => {
    const c = characterOf(state, id), h = state.held?.[id];
    if (c?.dead) return ` (dead · ${c.missTurns || 0} to wait)`;
    if (h && !h.owedWait) return ' (held)';
    if (h?.owedWait) return '';
    return '';
  };
  const start = Math.max(0, seats.indexOf(cur));
  const ring = seats.map((_, i) => seats[(start + i) % seats.length]);
  const text = ring.map((id, i) => `${i === 0 ? '▶ ' : ''}${name(id)}${mark(id)}`).join('  ▸  ');
  const held = seats.filter(id => state.held?.[id] && !state.held[id].owedWait);
  const owed = (state.owedTurns || []).filter(o => seats.includes(o.playerId));
  const why = [];
  if (held.length) why.push(`${held.map(name).join(' and ')} ${held.length === 1 ? 'is' : 'are'} held in a challenge: the table plays on without them`);
  if (owed.length) why.push(`${[...new Set(owed.map(o => name(o.playerId)))].join(', ')} ${owed.length === 1 ? 'is' : 'are'} owed a turn and get it next`);
  const owner = seats[state.turnIdx % seats.length];
  if (owner && owner !== cur && !held.includes(owner) && !why.length) why.push(`${name(cur)} plays ${name(owner)}'s slot`);
  return { text, why: why.join(' · ') };
}

// The tutorial opening on the TV rail: the mover's new step this turn, or null (ramp off, skipped, or over).
export function rampBanner(state) {
  if (state.phase !== 'playing') return null;
  const pid = currentPlayerId(state); if (!pid) return null;
  const st = rampStage(state, pid);
  if (!st.on || st.index < 0 || st.turn !== st.index + 1) return null;
  const name = characterOf(state, pid)?.name || state.players[pid]?.name || pid;
  return { playerId: pid, turn: st.turn, step: st.step, text: `${name}'s turn ${st.turn} — ${STEP_TEASER[st.step] || `${st.step} unlocks`}` };
}
