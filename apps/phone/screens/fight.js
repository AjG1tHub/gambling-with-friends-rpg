// The fight screen (SPEC.md › Attacks and spells; Pets; Encounter tile). Shown when state.fight involves me:
// the monster card, my weapons and spells as big buttons, the pet line, consumables and the class active, and the
// round itself played here with the items adapter (controls from packages/ui/minigame.js). Every act mirrors a
// snapshot to the room with ITEM_STEP; the settled result goes out as ITEM_RESOLVE (actor-authoritative). Nudge,
// Reroll and Fork arrive as fight.game.pendingChoice and are honoured on the live round. Solo fights (a spell on
// yourself) and pet battles use the same screen.
import { gameById } from '../../../packages/shared/characters/generator.js';
import { leverView } from '../../../packages/games/lever-view.js';
import { h, toast, buzz } from '../../../packages/ui/dom.js';
import { characterOf } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { startRound, gameMeta } from '../../../packages/games/adapter.js';
import { effectiveStake, canOverstake } from '../../../packages/shared/handlers/items.js';
import { activePet, healthyPets } from '../../../packages/shared/handlers/pets.js';
import { CLASSES } from '../../../packages/shared/characters/character.js';
import { liveRound, dropRound, peekRound, roundView, nudgePicker, seedFor } from '../../../packages/ui/minigame.js';
import { sect, why, itemRow, statLabel, nameOf, consumables, weapons, spells, redraw } from './prompts.js';

const B = (state) => ({ B: (g) => group(state, g), now: Date.now(), payload: {}, actor: 'phone', isGm: false });
const findItem = (c, id) => c?.items?.[id] || Object.values(c?.worn || {}).find(it => it && it.id === id) || null;
let petRound = null;   // { key, petId, idx, fightId }

export function fightScreen(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const f = state.fight; if (!f || f.done) return false;
  if (f.kind === 'petbattle') { petBattle(api, f); return true; }
  const m = f.monsterId ? state.monsters[f.monsterId] : null;
  if (m) screen.append(monsterCard(api, f, m));
  else if (f.kind === 'solo') screen.append(h('div', { class: 'tag center' }, 'A spell on yourself'));
  const g = f.game;
  if (g && !g.result) {
    if (g.attackerPlayerId === me) roundUI(api, f, g);
    else screen.append(h('div', { class: 'prompt' }, h('h3', {}, `${nameOf(state, g.attackerPlayerId)} is playing`), h('p', { class: 'muted' }, `${findItem(characterOf(state, g.attackerPlayerId), g.itemId)?.name || gameMeta(g.gameId).name} for ${g.stake}. ${g.lastText || ''}`)));
    fightLog(api, f); return true;
  }
  if (petRound && petRound.fightId === f.id) { const entry = peekRound(petRound.key); if (entry && !entry.resolved) { petRoundUI(api, f, entry); fightLog(api, f); return true; } petRound = null; }
  if (f.turn === 'monster') {
    const last = f.log.at(-1);
    screen.append(h('div', { class: 'prompt blood' }, h('h3', {}, `${m?.name || 'The monster'} is deciding…`), h('p', { class: 'muted ital' }, 'The table plays its move.'), last ? h('p', {}, lastHitText(state, last, m)) : null));
    fightLog(api, f); return true;
  }
  if (f.playerId !== me) { screen.append(h('div', { class: 'prompt' }, h('h3', {}, `${nameOf(state, f.playerId)}'s move`), h('p', { class: 'muted' }, 'You are in this fight; your move comes on your turn.'))); fightLog(api, f); return true; }
  attackMenu(api, f, m);
  fightLog(api, f);
  return true;
}

function monsterCard(api, f, m) {
  const { h, state } = api;
  const pct = m.maxHealth ? Math.max(0, Math.min(100, Math.round(m.health / m.maxHealth * 100))) : 0;
  return h('div', { class: `monster-card ${m.boss || m.final ? 'boss' : ''}` },
    h('img', { class: 'portrait', src: `/${(m.sprite || `monsters/${m.speciesId}`).replace(/^assets\//, '')}.png`, alt: '', onError: (e) => { e.target.style.visibility = 'hidden'; } }),
    h('div', { class: 'body' }, h('div', { class: 'row between' }, h('b', { class: 'nm' }, m.name), h('span', { class: 'pill' }, m.final ? 'THE DEALER' : m.raid ? 'RAID' : m.boss ? 'BOSS' : f.kind.toUpperCase())),
      h('div', { class: 'hbar', role: 'progressbar', 'aria-valuenow': m.health, 'aria-valuemax': m.maxHealth }, h('div', { class: 'fill', style: { width: `${pct}%` } }), h('span', {}, `${m.health} / ${m.maxHealth}`)),
      h('span', { class: 'meta' }, (m.items || []).map(it => `${gameMeta(it.gameId).icon} ${it.name} (${it.stake})`).join(' · ') || 'unarmed'),
      m.mood ? h('span', { class: 'meta ital' }, `Mood: ${m.mood.label || m.mood}`) : null, m.gmControlled ? h('span', { class: 'meta bad' }, 'The GM has taken over this monster') : null));
}
const lastHitText = (state, l, m) => { const by = state.characters[l.by]?.name || (m && l.by === m.id ? m.name : l.by); return `${by}: ${l.label || gameMeta(l.gameId).name}${l.damage ? ` — ${l.damage} damage` : l.loss ? ` — lost ${l.loss}` : l.healed ? ` — healed ${l.healed}` : l.shielded ? ` — shield ${l.shielded}` : ' — nothing'}${l.crit ? ' · CRIT' : ''}`; };
function fightLog(api, f) { const { state, h, screen } = api; if (!f.log?.length) return; const m = f.monsterId ? state.monsters[f.monsterId] : null; screen.append(h('div', { class: 'log small fight-log' }, f.log.slice(-4).map(l => h('div', {}, lastHitText(state, l, m))))); }

// ── the attack menu ─────────────────────────────────────────────────────────────────────────────
export function attackMenu(api, f, m, { inFight = true } = {}) {
  const { state, me, c, h, dispatch, screen } = api;
  const I = group(state, 'items'), ctx = B(state);
  const used = c.usedThisTurn || {};
  const spellCap = I.spellsPerTurn + ((c.upgrades || []).includes('twospells') ? 1 : 0);
  const box = sect(m ? `Fight ${m.name}` : 'Spells and area items');
  const list = m || inFight ? [...weapons(c), ...spells(c)] : [...weapons(c).filter(it => it.kind === 'area'), ...spells(c)];
  if (!list.length) { if (m || inFight) box.append(why('Nothing worn that carries a game. Equip a weapon or spell in the Cage.')); else return; }
  for (const it of list) {
    let stake = it.stake; try { stake = effectiveStake(state, ctx, c, it); } catch { /* keep the base */ }
    const isSpell = it.kind === 'spell', isArea = it.kind === 'area', isVersus = it.kind === 'versus';
    let reason = '';
    if (!(it.charges > 0)) reason = 'no charges left';
    else if (stake > c.health && !canOverstake(c)) reason = `stake ${stake} is more than your Health`;
    else if (isSpell && (used.spell || 0) >= spellCap) reason = 'spell used this turn';
    else if (!isSpell && (used.attack || 0) >= I.attacksPerTurn) reason = 'attack used this turn';
    else if (isVersus && m) reason = 'a versus item needs a player';
    else if (!isSpell && !isArea && !m) reason = 'no monster here: challenge a player from the attack panel';
    const goal = gameById(it.gameId)?.goal; const edge = leverView(it.gameId, c.stats?.[it.stat]); const meta = `${gameMeta(it.gameId).icon} ${gameMeta(it.gameId).name}${goal ? ` — ${goal}` : ''} · ${isSpell ? (it.spellEffect || 'spell') : it.kind} · stake ${stake}${edge ? ` · return ${Math.round(edge.yours.rtp * 100)}% (${edge.deltaPts >= 0 ? '+' : ''}${edge.deltaPts} from ${edge.stat})` : ''} · ${it.charges} charge${it.charges === 1 ? '' : 's'} · ${statLabel(it.stat)} ${c.stats?.[it.stat] ?? '?'}${it.inGrid ? ' · from the grid' : ''}`;
    box.append(itemRow({ item: it, meta, action: isSpell ? 'CAST' : isArea ? 'OPEN' : 'ATTACK', disabled: !!reason, reason, hot: !isSpell && !reason,
      onTap: () => { if (isArea) dispatch('AREA_OPEN', { itemId: it.id }); else if (isSpell) dispatch('ITEM_USE', { itemId: it.id, targetKind: 'self' }); else dispatch('ITEM_USE', { itemId: it.id, targetId: m.id, targetKind: 'monster' }); } }));
  }
  screen.append(box);
  if (m) petLine(api, f, m);
  if (!inFight) return;   // the action screen draws its own consumables and class active rows
  consumableRow(api, f);
  classActiveRow(api, f, m);
  {
    const row = h('div', { class: 'btn-grid' });
    const fleeWhy = f?.calledOut ? 'you were called out' : f?.game && !f.game.result ? 'finish the round first' : '';
    row.append(h('button', { class: 'danger big', disabled: !!fleeWhy, title: fleeWhy, onClick: () => dispatch('FIGHT_FLEE', {}) }, '🏃 Back away'));
    row.append(h('button', { class: 'big', onClick: () => dispatch('TURN_END', {}) }, 'End turn'));
    screen.append(row, fleeWhy ? why(`Back away: ${fleeWhy}.`) : why('Backing away ends the fight; ending the turn gives the monster a free swing and you pick it up next turn.'));
  }
}
function petLine(api, f, m) {
  const { state, c, h, dispatch, screen } = api;
  const pets = c.pets || []; if (!pets.length) return;
  const pet = activePet(c); const box = sect('Your pet');
  if (!pet) { box.append(why('No pet standing.')); screen.append(box); return; }
  box.append(h('div', { class: 'row between' }, h('b', {}, `${pet.name} · Power ${pet.power}/${pet.maxPower}`), h('span', { class: 'muted' }, pet.element)));
  const usedPet = c.usedThisTurn?.petAttack;
  box.append(h('div', { class: 'btn-grid' }, (pet.attacks || []).map((a, i) => { const stake = a.perBody && pet.bodies ? Math.max(1, Math.round(a.stake * pet.bodies / group(state, 'pets').swarmBodies)) : a.stake; const no = usedPet ? 'pet attacked this turn' : pet.power < stake ? `needs ${stake} Power` : ''; return h('button', { class: `pet-atk ${no ? '' : 'primary'}`, disabled: !!no, title: no, onClick: () => startPetRound(api, f, pet, i, stake) }, h('b', {}, a.name), h('span', { class: 'meta' }, `${gameMeta(a.gameId).icon} ${gameMeta(a.gameId).name} · ${stake}${a.effect ? ` · ${a.effect}` : ''}`)); })));
  if (usedPet) box.append(why('Your pet has attacked this turn.'));
  const others = healthyPets(c).filter(p => p.id !== pet.id);
  if (others.length) box.append(h('div', { class: 'chips' }, others.map(p => h('button', { class: 'chip', disabled: !!c.usedThisTurn?.moved, title: c.usedThisTurn?.moved ? 'switching costs your move' : '', onClick: () => dispatch('PET_SWITCH', { petId: p.id }) }, `Switch to ${p.name}`))), c.usedThisTurn?.moved ? why('Switching the pet costs the move, which is spent.') : null);
  screen.append(box);
}
function startPetRound(api, f, pet, idx, stake) {
  const { state, c } = api; const atk = pet.attacks[idx];
  const key = seedFor('pet', f.id, pet.id, idx, state.turnIdx, Date.now());
  liveRound(key, () => startRound({ state, B: (g) => group(state, g) }, { gameId: atk.gameId, mode: 'chips', stake, attacker: { id: pet.id, name: pet.name, stats: c.stats, classId: c.classId }, rng: makeRng(hash32(key)), now: Date.now(), holdPending: false }));
  petRound = { key, petId: pet.id, idx, fightId: f.id };
  redraw(api);
}
function petRoundUI(api, f, entry) {
  const { c, h, dispatch, screen } = api; const round = entry.round; const pet = c.pets.find(p => p.id === petRound.petId); const atk = pet?.attacks?.[petRound.idx];
  const box = sect(`${pet?.name || 'Pet'} uses ${atk?.name || ''}`);
  const finish = () => { if (entry.resolved) return; entry.resolved = true; const o = round.outcome(); dispatch('PET_ATTACK', { petId: pet.id, attackIndex: petRound.idx, mult: o.mult, label: o.label }).then(() => { dropRound(entry.key); petRound = null; }); };
  const after = () => { if (round.done) setTimeout(finish, Math.max(0, (round.revealAt?.() || 0) - Date.now()) + 800); redraw(api); };
  box.append(roundView({ round, stage: true, onAct: (a, p) => { round.act(a, p, Date.now()); after(); }, onFork: (i) => { round.pickFork(i); after(); } }));
  if (round.done) box.append(why('Settling…'));
  screen.append(box);
}
function consumableRow(api, f) {
  const { state, c, h, dispatch, screen } = api;
  const list = consumables(c); const free = (c.freeSmokeBombs || 0) > 0;
  if (!list.length && !free) return;
  const g = f?.game && !f.game.result ? f.game : null; const it0 = g ? findItem(c, g.itemId) : null;
  const inFight = !!f && !f.done && f.kind !== 'solo' && !!f.monsterId;
  const box = sect('Consumables');
  const row = h('div', { class: 'cons-row' });
  const reasonFor = (base) => {
    if (base === 'nudge') return !g ? 'needs a round in play' : !['dice', 'wheels'].includes(it0?.family) ? 'dice and wheel items only' : g.pending ? 'too late: the result is in' : '';
    if (base === 'reroll') return !g ? 'needs a round in play' : (it0?.family !== 'cards' && c.classId !== 'croupier') ? 'card items only' : '';
    if (base === 'fork') return !g ? 'needs a round in play' : '';
    if (base === 'smokebomb') return !inFight ? 'no fight to leave' : f?.calledOut ? 'you were called out' : '';
    if (base === 'phoenixfeather') return (c.effects || []).some(e => e.id === 'phoenix') ? 'already burning' : '';
    if (base === 'potion') return c.health >= c.maxHealth ? 'already at full Health' : '';
    return '';
  };
  const ICON = { potion: '🧪', nudge: '👉', reroll: '🔁', fork: '🔱', smokebomb: '💨', phoenixfeather: '🪶', petrevive: '💗', egg: '🥚' };
  for (const it of list) { const r = reasonFor(it.baseId); row.append(h('button', { class: `cons ${r ? '' : 'primary'}`, disabled: !!r, title: r || it.name, onClick: () => dispatch('CONSUMABLE_USE', { itemId: it.id }) }, h('b', {}, `${ICON[it.baseId] || '▪'} ${it.name}`), h('span', { class: 'meta' }, `×${it.qty ?? 1}${r ? ` · ${r}` : ''}`))); }
  if (free && !list.some(it => it.baseId === 'smokebomb')) { const r = reasonFor('smokebomb'); row.append(h('button', { class: `cons ${r ? '' : 'primary'}`, disabled: !!r, title: r, onClick: () => dispatch('CONSUMABLE_USE', { baseId: 'smokebomb' }) }, h('b', {}, '💨 Smoke Bomb'), h('span', { class: 'meta' }, `free (Cutpurse)${r ? ` · ${r}` : ''}`))); }
  box.append(row); screen.append(box);
}
export function classActiveRow(api, f, m) {
  const { state, me, c, h, dispatch, screen } = api;
  const k = CLASSES.find(x => x.id === c.classId); if (!k) return;
  const cd = c.cooldowns?.active || 0; const id = k.active.id;
  const box = sect(`${k.active.name} (${k.name})`);
  const inFight = f && !f.done;
  const others = Object.values(state.players).filter(p => p.id !== me && !p.spectator && !p.kicked && characterOf(state, p.id) && !characterOf(state, p.id).dead);
  let reason = cd > 0 ? `on cooldown: ${cd} turn${cd === 1 ? '' : 's'}` : '';
  if (!reason && id === 'rigthedeck' && !inFight) reason = 'needs a fight';
  if (!reason && id === 'rally' && !(c.pets || []).length) reason = 'no pet to rally';
  if (!reason && (id === 'sleight' || id === 'callout') && !others.length) reason = 'nobody to target';
  if (!reason && id === 'doubledown' && (c.effects || []).some(e => e.id === 'doubledown')) reason = 'already armed';
  box.append(h('p', { class: 'meta' }, k.active.text));
  if (reason) { box.append(why(reason)); screen.append(box); return; }
  if (id === 'doubledown' || id === 'rally') box.append(h('button', { class: 'primary big', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id }) }, k.active.name));
  else if (id === 'houserules') box.append(h('div', { class: 'btn-grid' }, h('button', { class: 'primary', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, mode: 'chaos' }) }, 'Cancel next Chaos'), h('button', { class: 'primary', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, mode: 'push' }) }, 'Next loss → push'), (c.upgrades || []).includes('voidwin') ? h('button', { class: 'primary', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, mode: 'voidwin' }) }, 'Void an enemy win') : null));
  else if (id === 'rigthedeck') { const who = [{ id: null, name: 'anyone' }, ...others.map(p => ({ id: characterOf(state, p.id).id, name: p.name }))]; box.append(h('div', { class: 'btn-grid' }, h('button', { class: 'primary', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, outcome: 'win', forId: c.id }) }, 'Next 50/50: WIN'), h('button', { class: 'danger', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, outcome: 'lose', forId: null }) }, 'Next 50/50: LOSE'))); }
  else if (id === 'sleight') {
    const reach = group(state, 'items').reachDefault;
    box.append(h('div', { class: 'tag' }, 'Swap tiles with'), h('div', { class: 'chips' }, others.map(p => h('button', { class: 'chip', disabled: characterOf(state, p.id).classId === 'enforcer', title: characterOf(state, p.id).classId === 'enforcer' ? 'an Enforcer cannot be swapped' : '', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, mode: 'swap', targetId: p.id }) }, p.name))),
      h('div', { class: 'tag' }, `Steal a grid cell from (within ${reach})`), h('div', { class: 'chips' }, others.map(p => h('button', { class: 'chip', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, mode: 'steal', targetId: p.id }) }, p.name))));
  } else if (id === 'callout') box.append(h('div', { class: 'tag' }, 'Call out'), h('div', { class: 'chips' }, others.map(p => h('button', { class: 'chip', onClick: () => dispatch('CLASS_ACTIVE', { activeId: id, targetId: p.id }) }, p.name))));
  screen.append(box);
}

// ── the round ───────────────────────────────────────────────────────────────────────────────────
function roundUI(api, f, g) {
  const { state, me, c, h, dispatch, screen } = api;
  const item = findItem(c, g.itemId);
  const key = seedFor('round', f.id, g.itemId, g.startedTs);
  const target = g.targetKind === 'monster' ? state.monsters[g.targetId] : g.targetKind === 'character' ? state.characters[g.targetId] : null;
  const entry = liveRound(key, () => startRound({ state, B: (gr) => group(state, gr) }, { item: item || { id: g.itemId, gameId: g.gameId, name: gameMeta(g.gameId).name, kind: g.kind, stake: g.stake, rarity: 'common', stat: 'luck' }, mode: 'health', stake: g.stake, attacker: c, target, rng: makeRng(hash32(seedFor(g.itemId, f.id, Date.now()))), now: Date.now(), holdPending: true, rig: g.rig ? { outcome: g.rig.outcome } : null }));
  const round = entry.round;
  const step = (text) => dispatch('ITEM_STEP', { game: round.snapshot(), text: text || round.text || '' });
  const resolve = () => { if (entry.resolved) return; entry.resolved = true; const o = round.outcome(); dispatch('ITEM_RESOLVE', { mult: o.mult, label: o.label, crit: o.crit, game: round.snapshot() }).then(() => dropRound(key)); if (o.crit) buzz([40, 30, 40, 30, 120]); else if (o.mult > 1) buzz(60); };
  const after = (text) => { step(text); if (round.done && !entry.resolved) { entry.timer = setTimeout(resolve, Math.max(0, (round.revealAt?.() || 0) - Date.now()) + 1000); } redraw(api); };
  if (round.done && !entry.resolved && !entry.timer) entry.timer = setTimeout(resolve, Math.max(0, (round.revealAt?.() || 0) - Date.now()) + 1000);
  // Nudge / Reroll / Fork from a consumable just used.
  const pc = g.pendingChoice; let note = '';
  if (pc && entry.handledChoice !== pc.ts) {
    if (pc.kind === 'nudge') {
      if (round.canNudge()) {
        const box = sect('Nudge'); box.append(nudgePicker(round, (label) => { round.nudge(label); entry.handledChoice = pc.ts; after(label ? `Nudged towards ${label}` : 'Nudged'); })); screen.append(box);
      } else { entry.handledChoice = pc.ts; note = 'The Nudge came too late for this round.'; }
    } else if (pc.kind === 'reroll') {
      if (round.canReroll()) { entry.handledChoice = pc.ts; const r = round.reroll(); after(`Rerolled: ${r.text || ''}`); return; }
      note = 'Reroll armed: it will take the next result.';
    } else if (pc.kind === 'fork') {
      if (round.canFork()) { entry.handledChoice = pc.ts; const r = round.fork(); after(r.text); return; }
      note = 'Fork armed: the next result splits in two.';
    }
  }
  const targetName = g.targetKind === 'monster' ? target?.name : g.targetKind === 'self' ? 'yourself' : target?.name;
  const box = sect(`${item?.name || gameMeta(g.gameId).name} on ${targetName || '?'}`);
  box.append(roundView({ round, stage: true, note, onAct: (a, p) => { const r = round.act(a, p, Date.now()); if (r?.error) toast(r.text, 'bad'); after(r?.text); }, onFork: (i) => { round.pickFork(i); after(); } }));
  if (round.done && !entry.resolved) box.append(why('Settling the hit…'));
  consumableRow(api, f);
  screen.append(box);
}

// ── pet battles ─────────────────────────────────────────────────────────────────────────────────
function petBattle(api, f) {
  const { state, me, c, h, dispatch, screen } = api;
  const oppId = f.playerIds.find(id => id !== me); const oc = characterOf(state, oppId);
  const mine = c.pets.find(p => p.id === f.pets[me]), theirs = oc?.pets?.find(p => p.id === f.pets[oppId]);
  const box = sect(`Pet battle · round ${f.round}`);
  box.append(h('div', { class: 'row between' }, h('div', {}, h('b', {}, mine?.name || '?'), h('span', { class: 'meta' }, ` Power ${mine?.power}/${mine?.maxPower}`)), h('span', { class: 'tag' }, 'vs'), h('div', { class: 'right' }, h('b', {}, theirs?.name || '?'), h('span', { class: 'meta' }, ` Power ${theirs?.power}/${theirs?.maxPower}`))));
  if (f.wager) box.append(why(`${f.wager} Gold on the line.`));
  if (f.locks?.[me] != null) box.append(why(`Locked ${mine?.attacks?.[f.locks[me]]?.name}. Waiting for ${nameOf(state, oppId)}…`));
  else box.append(h('p', { class: 'muted ital' }, 'Lock an attack. Both reveal at once; the heavier stake wins more often.'), h('div', { class: 'btn-grid' }, (mine?.attacks || []).map((a, i) => h('button', { class: 'pet-atk primary', onClick: () => dispatch('PET_BATTLE_LOCK', { attackIndex: i }) }, h('b', {}, a.name), h('span', { class: 'meta' }, `${gameMeta(a.gameId).icon} stake ${a.stake}`)))));
  if (f.log?.length) box.append(h('div', { class: 'log small' }, f.log.slice(-3).map(l => h('div', { class: l.winnerId === me ? 'ok' : 'bad' }, l.text))));
  screen.append(box);
}

