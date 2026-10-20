// Phone tab: Pets. The team as cards (species sprite, stage, element, Power, four attacks, held item, fainted),
// set the active pet (PET_SWITCH, on your turn, costs the move), the Triple Pet Wheel when something is hatching
// (PET_HATCH_PICK), the pet battle screen (PET_BATTLE_LOCK + reveal), revive with a Pet Revive (CONSUMABLE_USE),
// and a nickname kept on this phone (there is no rename event in the engine).
import { petElement } from '../../../packages/ui/sprite.js';
import { onRerender, rerenderSoon, itemIcon } from '../../../packages/ui/grid.js';
import { characterOf, currentPlayerId } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { speciesDef, stageName } from '../../../packages/shared/handlers/pets.js';
import { teamCap } from '../../../packages/shared/handlers/creation.js';
import { gameById } from '../../../packages/shared/characters/generator.js';
import { store, toast } from '../../../packages/ui/dom.js';

const petsUi = { renaming: null, reviving: null, confirmSwitch: null };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const ELEMENT_COLOUR = { Oxblood: '#c0262e', Bone: '#e9e1cf', Brass: '#c9a45c', Verdigris: '#6fd36a', Violet: '#8f6cff', Soot: '#9aa7b0' };
const nickKey = (pet) => `gwfrpg:petnick:${pet.id}`;
export const petName = (pet) => store.get(nickKey(pet)) || pet.name;

export function tabPets(args) {
  const { state, session, me, c, myTurn, h, dispatch, screen } = args;
  onRerender(() => { if (!screen.isConnected) return; screen.replaceChildren(); const s = session?.state || state; tabPets({ ...args, state: s, c: characterOf(s, me.id) || c, myTurn: s.phase === 'playing' && currentPlayerId(s) === me.id }); });
  if (!c) { screen.append(h('div', { class: 'hero' }, h('h2', {}, 'Pets'), h('p', { class: 'muted ital' }, me.spectator ? 'Spectators keep no pets.' : 'Your team appears with your character.'))); return; }
  const P = safeGroup(state, 'pets'); const capN = safeCap(state, c);
  const pets = c.pets || []; const active = pets.find(p => p.id === c.activePetId) || null;
  const revives = Object.values(c.items || {}).filter(it => it?.baseId === 'petrevive');
  const eggs = Object.values(c.items || {}).filter(it => it?.slot === 'egg');

  // ── pet battle ──
  const f = state.fight;
  if (f && f.kind === 'petbattle' && !f.done && (f.playerIds || []).includes(me.id)) screen.append(battlePanel({ state, me, c, f, h, dispatch }));
  else if (state.lastPetBattle && (state.lastPetBattle.playerIds || []).includes(me.id) && Date.now() - (state.lastPetBattle.startedAt || 0) < 180000) {
    const b = state.lastPetBattle; const won = b.result?.winnerId === me.id;
    screen.append(h('div', { class: `panel ${won ? 'gold' : 'blood'}` }, h('h3', {}, 'Last pet battle'), h('p', {}, won ? `You won in ${b.result?.rounds || 0} round${b.result?.rounds === 1 ? '' : 's'}${b.wager ? ` and ${b.wager} Gold` : ''}.` : `${state.players[b.result?.winnerId]?.name || 'They'} won${b.wager ? ` the ${b.wager} Gold wager` : ''}.`), h('div', { class: 'log small' }, (b.log || []).map(l => h('div', {}, `${l.round}. ${l.text}`)))));
  }

  // ── hatching ──
  if (c.hatching) screen.append(hatchPanel({ c, h, dispatch }));

  // ── team header ──
  screen.append(h('div', { class: 'row between' }, h('h2', {}, 'Your team'), h('span', { class: 'pill' }, `${pets.length} / ${capN}`)));
  if (!pets.length && !c.hatching) {
    const canSetup = ['lobby', 'creation', 'playing'].includes(state.phase) && !c.flags?.setupHatched;
    screen.append(h('div', { class: 'panel' }, h('p', { class: 'muted ital' }, 'No pets yet. Eggs come from Chests, bosses and the Beastmaster’s bonus; every hatch is the Triple Pet Wheel.'),
      canSetup ? h('button', { class: 'primary big', onClick: () => dispatch('PET_HATCH', { source: 'setup' }) }, 'Hatch your first pet') : null));
  }
  for (const pet of pets) screen.append(petCard({ pet, c, state, me, myTurn, active, revives, h, dispatch, P }));

  // ── eggs ──
  if (eggs.length && !c.hatching) screen.append(h('div', { class: 'panel' }, h('h3', {}, `${eggs.length} egg${eggs.length === 1 ? '' : 's'} in the Cage`),
    h('div', { class: 'row' }, eggs.map(e => h('div', { class: 'vault-item' }, itemIcon(e, 44), h('span', { class: 'small' }, e.region ? cap(e.region) : 'Egg')))),
    pets.length >= capN ? h('p', { class: 'muted small ital' }, 'Your team is full; trade or wait.') : h('button', { class: 'primary', disabled: state.phase !== 'playing' && state.phase !== 'creation' && state.phase !== 'lobby', onClick: () => dispatch('PET_HATCH', { source: 'egg', itemId: eggs[0].id }) }, 'Spin the Triple Pet Wheel')));
  screen.append(h('p', { class: 'muted small ital center' }, 'Pets fight first: the active pet takes the hits until it faints. Switching costs your move. A fainted pet stays down unless revived.'));
}

function petCard({ pet, c, state, me, myTurn, active, revives, h, dispatch, P }) {
  const sp = speciesDef(pet.speciesId); const isActive = active?.id === pet.id; const nick = petName(pet);
  const pct = pet.maxPower ? Math.max(0, Math.min(100, Math.round((pet.power / pet.maxPower) * 100))) : 0;
  const stage = sp ? `${stageName(pet)} · stage ${(pet.stage || 0) + 1} of ${sp.stages.length}` : cap(pet.speciesId?.replace('monster:', '') || 'wild');
  const card = h('div', { class: `panel pet-card ${isActive ? 'active' : ''} ${pet.fainted ? 'fainted' : ''}` },
    h('div', { class: 'pet-head' }, petElement(pet, { scale: 1.5 }),
      h('div', { class: 'grow' }, h('div', { class: 'pet-name' }, nick, nick !== pet.name ? h('span', { class: 'muted small' }, ` (${pet.name})`) : null, isActive ? h('span', { class: 'pill gold' }, 'out') : null, pet.fainted ? h('span', { class: 'pill bad' }, 'fainted') : null),
        h('div', { class: 'muted small' }, stage), h('div', { class: 'small' }, h('span', { class: 'element', style: { color: ELEMENT_COLOUR[pet.element] || 'inherit' } }, pet.element || ''), pet.bodies ? h('span', { class: 'muted' }, ` · ${pet.bodies} bodies`) : null, pet.caughtIn ? h('span', { class: 'muted' }, ` · from ${cap(pet.caughtIn)}`) : null)),
      h('button', { class: 'ghost mini', 'aria-label': 'rename', onClick: () => { petsUi.renaming = petsUi.renaming === pet.id ? null : pet.id; rerenderSoon(); } }, '✎')),
    h('div', { class: `bar power ${pct > 66 ? 'high' : pct >= 33 ? 'mid' : 'low'}` }, h('div', { class: 'fill', style: { width: `${pct}%` } }), h('span', { class: 'bar-text' }, `${pet.power} / ${pet.maxPower} Power`)),
    h('div', { class: 'attacks' }, (pet.attacks || []).map((a, i) => { const g = gameById(a.gameId); return h('div', { class: 'attack' }, h('div', { class: 'atk-name' }, a.name), h('div', { class: 'muted small' }, `${g?.name || a.gameId} · stakes ${a.stake}${a.effect ? ` · ${EFFECT_TEXT[a.effect] || a.effect}` : ''}`)); })),
    pet.heldItem ? h('div', { class: 'row small' }, h('span', { class: 'tag' }, 'Holds'), itemIcon(pet.heldItem, 32), h('span', {}, pet.heldItem.name)) : null);
  if (petsUi.renaming === pet.id) {
    const input = h('input', { value: nick, maxlength: 18, placeholder: pet.name, 'aria-label': 'nickname' });
    card.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, input), h('button', { class: 'primary mini', onClick: () => { const v = input.value.trim(); if (v && v !== pet.name) store.set(nickKey(pet), v); else store.del(nickKey(pet)); petsUi.renaming = null; rerenderSoon(); } }, 'Keep')), h('p', { class: 'muted small ital' }, 'A nickname lives on this phone only; the table knows the pet by its species name.'));
  }
  const actions = h('div', { class: 'row' });
  if (!pet.fainted && !isActive) {
    const switchNote = c.usedThisTurn?.moved ? 'your move is spent this turn' : 'costs your move';
    actions.append(h('button', { class: 'primary', disabled: !myTurn || !!c.usedThisTurn?.moved, title: myTurn ? switchNote : 'on your turn', onClick: () => dispatch('PET_SWITCH', { petId: pet.id }) }, 'Send out'), h('span', { class: 'muted small ital' }, myTurn ? switchNote : 'switch on your turn — costs the move'));
  }
  if (pet.fainted) {
    if (revives.length) actions.append(h('button', { class: 'primary', disabled: state.phase !== 'playing', onClick: () => dispatch('CONSUMABLE_USE', { itemId: revives[0].id, petId: pet.id }) }, `Revive (${revives.length} Pet Revive)`));
    else actions.append(h('span', { class: 'muted small ital' }, 'Needs a Pet Revive (Rare, or a boss drop) or a level-20 Beastmaster’s Rally.'));
  }
  if (actions.childElementCount) card.append(actions);
  return card;
}
const EFFECT_TEXT = { healTrainer: 'heals you', healSelf: 'restores its Power', gold: 'pays Gold', eatTurn: 'the monster skips a turn' };

// The Triple Pet Wheel: three columns (common / region / rare), the stopped segment lit, Keep under each.
function hatchPanel({ c, h, dispatch }) {
  const H = c.hatching; const titles = ['Common pool', 'This region', 'Rare pool'];
  return h('div', { class: 'panel gold hatch' }, h('h3', {}, 'The Triple Pet Wheel'), h('p', { class: 'muted small' }, 'Three wheels, one choice. Keep one; the other two eggs go cold.'),
    h('div', { class: 'wheels' }, (H.wheels || []).map((w, i) => {
      const id = w.outcomes[w.index]; const sp = id ? speciesDef(id) : null;
      return h('div', { class: `wheel-col ${sp ? '' : 'dud'}` }, h('div', { class: 'tag' }, titles[i] || w.pool),
        h('div', { class: 'wheel-segs' }, w.outcomes.map((o, j) => h('div', { class: `seg ${j === w.index ? 'hit' : ''}` }, o ? (speciesDef(o)?.name || o) : '— dud —'))),
        sp ? petElement({ speciesId: sp.id, stage: 0, name: sp.name }, { scale: 1.25 }) : h('div', { class: 'dud-egg' }, '🥚'),
        h('div', { class: 'wheel-pick' }, sp ? sp.name : 'A dud egg', sp ? h('div', { class: 'muted small' }, `${sp.element} · ${sp.pool}`) : null),
        h('button', { class: sp ? 'primary' : 'ghost', onClick: () => dispatch('PET_HATCH_PICK', { index: i }) }, sp ? 'Keep' : 'Crack it'));
    })));
}

// Pet versus pet: lock one of the four attacks; the reveal comes when both have locked.
function battlePanel({ state, me, c, f, h, dispatch }) {
  const oppId = (f.playerIds || []).find(id => id !== me.id); const oc = characterOf(state, oppId);
  const mine = (c.pets || []).find(p => p.id === f.pets?.[me.id]); const theirs = (oc?.pets || []).find(p => p.id === f.pets?.[oppId]);
  const locked = f.locks?.[me.id]; const theyLocked = f.locks?.[oppId] != null;
  const side = (pet, who, right) => h('div', { class: `pb-side ${right ? 'right' : ''}` }, pet ? petElement(pet, { scale: 1.5 }) : null, h('div', {}, h('div', { class: 'pet-name' }, pet ? petName(pet) : '?'), h('div', { class: 'muted small' }, who), pet ? h('div', { class: `bar power ${pet.power / pet.maxPower > .66 ? 'high' : pet.power / pet.maxPower >= .33 ? 'mid' : 'low'}` }, h('div', { class: 'fill', style: { width: `${Math.round((pet.power / (pet.maxPower || 1)) * 100)}%` } }), h('span', { class: 'bar-text' }, `${pet.power} Power`)) : null));
  return h('div', { class: 'panel blood pet-battle' }, h('h3', {}, `Pet battle · round ${f.round || 1}${f.wager ? ` · ${f.wager} Gold on it` : ''}`),
    h('div', { class: 'pb-sides' }, side(mine, 'yours'), h('div', { class: 'pb-vs' }, 'VS'), side(theirs, oc?.name || 'them', true)),
    h('p', { class: 'muted small ital' }, 'Both of you lock an attack in secret; the heavier stake is the likelier to land. The loser’s pet pays the winner’s stake in Power.'),
    locked != null ? h('p', { class: 'center' }, h('span', { class: 'pill gold' }, `Locked: ${mine?.attacks?.[locked]?.name || '?'}`), ' ', theyLocked ? 'revealing…' : `waiting for ${oc?.name || 'them'}…`)
      : h('div', { class: 'attacks pick' }, (mine?.attacks || []).map((a, i) => { const g = gameById(a.gameId); return h('button', { class: 'attack-btn', disabled: !mine, onClick: () => dispatch('PET_BATTLE_LOCK', { attackIndex: i }) }, h('b', {}, a.name), h('span', { class: 'muted small' }, `${g?.name || a.gameId} · stakes ${a.stake}${mine && mine.power < a.stake ? ' · more than it has left' : ''}`)); })),
    (f.log || []).length ? h('div', { class: 'log small' }, f.log.map(l => h('div', { class: l.winnerId === me.id ? 'turn' : '' }, `${l.round}. ${l.text}`))) : null);
}

const safeGroup = (state, g) => { try { return group(state, g); } catch { return {}; } };
const safeCap = (state, c) => { try { return teamCap({ B: (g) => group(state, g) }, c); } catch { return 6; } };
