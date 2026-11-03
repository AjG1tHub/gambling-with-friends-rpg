// The Help sheet (the ? in the top bar): "This screen" (the coach step for the situation plus every button on the
// current screen and what it does, from SCREEN_HELP keyed by the coach's situation ids), "A turn in 30 seconds",
// "The rules in 10 cards" (packages/ui/tutorial.js ruleCards, the same text the TV cycles and the GM pushes),
// the glossary, the full rules drawer, the tip controls, and "Quit practice" in the practice run. Same overlay
// pattern as feedback.js's bug sheet; a thrown error inside never reaches view().
import { h, store } from '../../packages/ui/dom.js';
import { group } from '../../packages/shared/balance.js';
import { rulesDrawer } from '../../packages/ui/roster.js';
import { ruleCards } from '../../packages/ui/tutorial.js';
import { situation, coachStep, coachPanel, rampLocks } from './coach.js';

const ui = { open: false };
const g = (state, k) => { try { return group(state, k); } catch { return {}; } };
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`;

export function helpButton({ rerender }) {
  return h('button', { class: `help-btn${ui.open ? ' on' : ''}`, 'aria-label': 'Help', title: 'Help', onClick: () => { ui.open = !ui.open; rerender(); } }, '?');
}
export const openHelp = () => { ui.open = true; };

// Every button on a screen and what it does, by situation id (a family prefix matches: 'challenge.' covers them all).
const SCREEN_HELP = {
  lobby: [['Tap when ready', 'Tells the GM you can see the TV. Tap again to unready.'], ['Return / Start over as…', 'Bring back a character from your roster, or reuse a dead one\'s look under a new name.'], ['🐞', 'Report a bug; the House rewards bug hunters in secret.']],
  bug: [['🐞', 'Report a bug with the screen, turn and round attached.'], ['Tap when ready', 'Ready for the GM to open creation.']],
  'creation.look': [['Name', 'One of a kind for all time; the phone checks the Wall.'], ['Crest', 'The emoji that marks you on the TV map.'], ['Body · skin · face · hair · coat', 'Your sprite. The Mirror on Self changes it later.'], ['That is me →', 'Saves the look and moves to Class.']],
  'creation.class': [['A class card', 'Picks the class: its starting weapon, +1 to its stat, a passive and an active.']],
  'creation.gamble': [['Luck · Nerve · Greed · Grit', 'Pick the stat you are playing for.'], ['Game chips', 'The quick game you stake on: fifty, dice, hi-lo or the Buy-in Wheel.'], ['Stake (chips)', 'How many chips ride on this game.'], ['Play for …', 'Plays the round here; a win pays chips × multiplier into the stat.'], ['🩸 Bleed for chips', 'The Blood option: max Health for extra chips, once.'], ['Lock in →', 'Stop gambling; place the chips you kept at 1 point each.']],
  'creation.blood': [['Play for …', 'Another gamble on any stat under the cap.'], ['🩸 Bleed for chips', 'Max Health for extra chips, once per creation.'], ['Lock in →', 'Finish: unstaked chips become points.']],
  'creation.ready': [['Pull into the grid', 'Items from your vault come into this run (a limited number).'], ['Set the team', 'Which of your pets come along.'], ['🥚 Hatch a pet', 'The Triple Pet Wheel: keep one of three.'], ['Tap when ready', 'Tells the GM you are set.']],
  'creation.wait': [['✓ Ready — tap to unready', 'Take it back if you need a minute.']],
  'pets.hatch': [['KEEP (a column)', 'Keeps that pet; the other two are gone.']],
  'challenge.': [['Accept / Decline', 'A Wager only: a decline costs nothing.'], ['PICK (a weapon)', 'The defender\'s weapon: wins hit for its stake.'], ['✊ Bare hands', 'No weapon: win nothing, lose nothing extra.'], ['🎡 Spin', 'The attacker spins; the wheel picks the game.'], ['Who won?', 'External games: both phones report; disagree and the GM decides.'], ['↗ Open the link', 'An online game played in the browser.']],
  held: [['—', 'Nothing to press: your seat is held until the challenge settles.']],
  dead: [['Pass', 'Spends the turn you must miss.']],
  'fight.round': [['The game controls', 'Play the round; the TV mirrors it. The result settles the hit.'], ['Nudge · Reroll · Fork', 'Consumables that bend a round in play.']],
  'fight.monster': [['—', 'The table plays the monster. Your clock is stopped.']],
  fight: [['ATTACK (a weapon)', 'Stake the item\'s Health cost on its game; one attack a turn.'], ['CAST (a spell)', 'Heal, shield or steal; one spell a turn.'], ['Your pet', 'A pet attack spends its Power on its own game.'], ['🏃 Back away', 'Ends the fight; the monster stays.'], ['End turn', 'The monster gets a free swing; you pick the fight up next turn.']],
  area: [['Stake it', 'Your Health stake in the Area round; everyone on the hex plays at once.']],
  waiting: [['Cage · Self · Pets · Map · Letters', 'Everything but Play is open while you wait.'], ['🐞', 'Report a bug any time.']],
  'move.': [['🦶 Plod / 🎲 Roll / 🎡 Spin / 🂠 Draw', 'Starts the move the way your boots allow.'], ['The rosette', 'One tap per step in that direction; greyed hexes cannot be entered.'], ['The map', 'Tap a hex to path there one step at a time.'], ['STOP HERE / STAY PUT', 'Ends the move early when the boots allow it.'], ['LACE UP', 'Swap boots; costs the move.'], ['Skip the move and end the turn', 'Passes play without moving.']],
  'prompt.spin': [['🎡 Spin', 'Spins the hex\'s wheel; the result applies to you.']],
  'prompt.portal': [['A region', 'Step through to it.'], ['Stay here', 'Ignore the portal.']],
  'prompt.arena': [['Opponent · Call · Weapon', 'Who, which call, and what you stake.'], ['Arena wager', 'Gold from both sides into a pot for the winner.'], ['⚔ Call …', 'Starts the Challenge Wheel.'], ['🐾 Pet battle instead', 'Your pets fight instead of you.'], ['Walk on', 'No challenge.']],
  'prompt.takeWorn': [['TAKE', 'One worn item from the fallen.'], ['Take nothing', 'Leave it.']],
  resolve: [['End turn anyway', 'If the hex never finishes, pass play.']],
  action: [['BUY / SELL', 'Shop with Gold; selling pays half.'], ['🛏 Rest', 'The Inn heals once per visit.'], ['🩸 Sign a Blood Pact', 'Borrow Health at interest; repay at a Blood Bank before the Collector comes.'], ['Deposit / Withdraw', 'Gold in the bank is safe from robbery.'], ['TAKE', 'Loot on the ground.'], ['ATTACK', 'A monster on your hex; one attack a turn.'], ['⚔ Duel / Wager / Rob', 'Call a player in reach to the Challenge Wheel; it ends your turn.'], ['Use now', 'Potions, feathers, eggs.'], ['The class active', 'Your class power, on a cooldown.'], ['Emotes', 'Show on the TV.'], ['End turn', 'Passes play. The only button that must be pressed.']],
  'tab.cage': [['Drag an item', 'Onto the paper doll to wear it, into the grid to bag it.'], ['Rotate · Sort · Drop', 'Make it fit; drop leaves it on the hex.']],
  'tab.self': [['+1 (a stat)', 'Spend a level-up point.'], ['Change my look', 'The Mirror, between turns.'], ['Claim code', 'Recovers your roster on a new phone.'], ['The rules', 'The whole rulebook.']],
  'tab.pets': [['Make active', 'The pet that fights beside you.'], ['Rename', 'A nickname.']],
  'tab.map': [['A hex (on your move)', 'Path there one step at a time.']],
  'tab.letters': [['Write', 'A letter by crow: lands two of their turns later.'], ['Propose an alliance', 'A truce both must sign.'], ['Pass · Destroy · Forge', 'When a letter crosses your path.']],
  ended: [['PICK / Vault', 'Items to keep for the next run.'], ['🏅 Save as a veteran', 'Survivors keep their level for harder runs.']],
};
const helpFor = (id) => { if (!id) return []; if (SCREEN_HELP[id]) return SCREEN_HELP[id]; const fam = Object.keys(SCREEN_HELP).find(k => k.endsWith('.') && id.startsWith(k)); return fam ? SCREEN_HELP[fam] : []; };

function glossary(state) {
  const S = g(state, 'stats'), I = g(state, 'items'), C = g(state, 'clock'), T = g(state, 'table'), D = g(state, 'death'), BP = g(state, 'bloodPact'), Gd = g(state, 'grid'), M = g(state, 'movement');
  return [
    ['Health · stake', `Your bankroll. Every weapon stakes some of it (Common ${I.stakeCommon}, Rare ${I.stakeRare}, Epic ${I.stakeEpic}, Legendary ${I.stakeLegendary}); lose the round, lose the stake. Only you see the number; the TV shows a lantern.`],
    ['Gold', 'Buys gear, potions and bounties; wagered and robbed through the Challenge Wheel. The bank keeps it safe.'],
    ['Luck · Nerve · Greed · Grit', `Four stats, ${S.min} to ${S.max}. Luck: rerolls and loot. Nerve: clock seconds. Greed: streak damage, dearer pacts. Grit: less damage taken. Every game runs on one stat: under ${S.neutral} is a debuff (−${Math.round(I.leverPenaltyPerPoint * 100)}% a point), over it a boon (+${Math.round(I.leverBonusPerPoint * 100)}% a point); ${S.max} is the cap and a real edge.`],
    ['Lever', 'How your stat bends a game\'s odds. The bar under a round shows it.'],
    ['Boots', `How you move: dice roll, wheel spin, or a colour card. Barefoot plods ${M.barefoot}.`],
    ['Held · owed turn', 'Held: you are away in a challenge and the table skips your slot. Owed: a turn you missed while held; it comes back right after the current one.'],
    ['Challenge Wheel', 'Duel, Wager or Robbery against a player in reach. The call ends your turn; the wheel picks the game; the defender skips their next slot.'],
    ['Wanted', 'After a robbery: the bank will not pay you and the Enforcer hunts you for a few turns.'],
    ['Pact', `A Blood Pact borrows Health at ${Math.round(BP.interest * 100)}% interest, due in ${BP.dueTurns} turns at a Blood Bank, or the Collector takes ${BP.collectorPerTurn} a turn.`],
    ['Vault', `At the end of a run a survivor banks ${Gd.vaultSurvivor} item${Gd.vaultSurvivor === 1 ? '' : 's'} (the dead ${Gd.vaultDead}); they come back next run.`],
    ['Veteran', 'A survivor saved with its level; it can enter harder dungeons.'],
    ['Last Call', `${T.lastCallMinutes} minutes after the start the House ends the run on placings.`],
    ['Chess clock', `${mmss(C.perTurnSeconds)} added at the start of your turn, banked up to ${mmss(C.bankCapSeconds)}; at zero the turn ends where it stands. Stops while the monster acts or you are held.`],
    ['Dying', `Miss ${D.monsterMissTurns} turn (a monster) or ${D.playerMissTurns} (a player or boss, and a level), drops lie where you fell, wake at the Graveyard at ${Math.round(D.wakeFraction * 100)}% Health.`],
  ];
}

export function helpSheet({ state, ctx, me, rerender }) {
  if (!ui.open) return null;
  const close = () => { ui.open = false; rerender(); };
  const pid = me.id;
  let sit = null, step = null; try { sit = situation(state, pid, { tab: ctx.tab, dismissed: new Set(), tutorial: true }); step = coachStep(state, pid, { tab: ctx.tab, dismissed: new Set(), tutorial: true }); } catch (e) { console.error(e); }
  const buttons = helpFor(sit);
  let locks = []; try { locks = rampLocks(state, pid); } catch { locks = []; }
  const sect = (title, open, ...kids) => h('details', { class: 'help-sect', open: open || null }, h('summary', {}, title), h('div', { class: 'help-body' }, ...kids));
  const M = g(state, 'movement'), C = g(state, 'clock');
  let cards = []; try { cards = ruleCards(state); } catch (e) { cards = []; }
  const el = h('div', { class: 'help-sheet', role: 'dialog', 'aria-label': 'Help' },
    h('div', { class: 'help-head' }, h('h2', {}, `? Help${ctx.practice ? ' · practice' : ''}`), h('button', { class: 'help-close', 'aria-label': 'Close help', onClick: close }, '✕')),
    sect('This screen', true,
      step ? h('div', { class: 'help-now' }, h('b', {}, step.title), h('p', {}, step.text)) : h('p', { class: 'muted ital' }, 'Nothing to explain here.'),
      buttons.length ? h('ul', { class: 'help-buttons' }, buttons.map(([b, what]) => h('li', {}, h('b', {}, b), h('span', {}, what)))) : null,
      locks.length ? h('div', { class: 'help-locks' }, h('b', {}, 'The tutorial opening'), h('p', { class: 'muted small' }, 'One new mechanic per turn. Still to come for you:'), h('ul', { class: 'help-buttons' }, locks.map(l => h('li', {}, h('b', {}, l.label), h('span', {}, `your turn ${l.onTurn}`))))) : null),
    sect('A turn in 30 seconds', false,
      h('p', {}, `Your phone buzzes. Roll, spin or draw as your boots decide (barefoot plods ${M.barefoot}), then step hex by hex up to the roll and stop where you like unless the boots say otherwise. Only the hex you stop on does anything: a wheel, a shop, a chest, a monster. Then the action phase: shop, bag, one attack, one spell, a challenge — all optional — and END TURN, which is not. The clock gives you ${mmss(C.perTurnSeconds)} a turn, banked up to ${mmss(C.bankCapSeconds)}; at zero the turn ends where it stands.`)),
    sect('The rules in 10 cards', false, h('div', { class: 'help-cards' }, cards.map(cd => h('div', { class: 'card' }, h('b', {}, cd.title), h('span', {}, cd.text))))),
    sect('Glossary', false, h('dl', { class: 'help-gloss' }, glossary(state).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
    sect('The full rules', false, rulesDrawer({ open: true })),
    h('div', { class: 'help-actions' }, coachPanel({ rerender }),
      ctx.practice ? h('button', { class: 'danger big', onClick: () => ctx.practice.quit() }, 'Quit practice') : null,
      h('button', { class: 'primary big', onClick: close }, 'Back to the game')));
  return el;
}
