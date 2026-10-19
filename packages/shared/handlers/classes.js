// Class passives and actives that belong to the characters module (SPEC.md › Classes). The items module owns
// the Whale (Double Down, stake discount, damage bonus, crit bonus) and the Croupier's Rig the Deck / free Reroll
// / spell discount; this file has the rest and the shared cooldown bookkeeping.
//
// Cooldowns: c.cooldowns.active counts the owner's own turns and is decremented ONLY here, in a turnStart hook.
// The items module must not decrement it. Actives set it through setCooldown(state, ctx, c, key), which applies
// Tempo affixes and the level-20 upgradedCooldown.
//
// classActives[id](state, ctx, c, payload):
//   houserules {mode: 'chaos' | 'push' | 'voidwin'}  arms a one-shot effect on c.effects ({id: 'houserules', data: {mode}});
//        the Chaos module cancels its next effect for a 'chaos' arm, the fight module turns a losing roll into a push
//        for 'push' and voids one enemy win per fight for 'voidwin' (level 20), removing the effect when spent.
//   sleight {mode: 'swap', targetId} | {mode: 'steal', targetId, itemId?}  swap tiles with any player (never an
//        Enforcer), or steal a random grid cell (a chosen one at level 10) from a player in reach.
//   callout {targetId}  state.pendingPrompt = {playerId: target, kind: 'callout', byId}; the target gets the
//        'calledout' effect (no Smoke Bomb); reach challenge.callOutRange, the whole region at level 20.
//   rally lives in handlers/pets.js.
import { refuse } from '../reducer.js';
import { characterOf, note, playerOfCharacter } from '../state.js';
import { hooks as runHooks } from './run.js';
import { classActives, damageHooks, deathHooks } from '../hooks.js';
import { health } from '../health.js';
import { streamRng } from '../rng.js';
import * as hex from '../hex.js';
import { hasUpgrade, classDef } from '../characters/character.js';
import * as G from '../characters/grid.js';

const posOf = (c) => c?.pos ? hex.parse(c.pos) : null;
export const distanceBetween = (a, b) => (posOf(a) && posOf(b)) ? hex.distance(posOf(a), posOf(b)) : Infinity;
const charOf = (state, id) => state.characters[id] || Object.values(state.characters).find(c => c.playerId === id) || null;

export function setCooldown(state, ctx, c, key) {
  const C = ctx.B('classes');
  let turns = C[key]; if (hasUpgrade(c, 'fastcd')) turns = Math.min(turns, C.upgradedCooldown);
  turns = Math.max(1, turns - (c.passives?.tempo || 0));
  c.cooldowns.active = Math.max(c.cooldowns.active || 0, turns);
  return turns;
}
export const onCooldown = (c) => (c?.cooldowns?.active || 0) > 0;

classActives.houserules = (state, ctx, c, payload = {}) => {
  const mode = payload.mode || 'chaos'; if (!['chaos', 'push', 'voidwin'].includes(mode)) refuse('mode is chaos, push or voidwin', 'mode');
  if (mode === 'voidwin') { if (!hasUpgrade(c, 'voidwin')) refuse('void an enemy win unlocks at level 20', 'level'); if (state.fight && c.flags.voidwinFight === state.fight.id) refuse('once per fight', 'uses'); c.flags.voidwinFight = state.fight?.id || null; }
  c.effects = c.effects.filter(e => e.id !== 'houserules'); c.effects.push({ id: 'houserules', kind: 'class', turnsLeft: -1, data: { mode } });
  setCooldown(state, ctx, c, 'pitBossCooldown');
  note(state, `${c.name} calls House Rules (${mode})`, 'class', ctx.now);
};
classActives.sleight = (state, ctx, c, payload = {}) => {
  const t = charOf(state, payload.targetId); if (!t || t.id === c.id) refuse('pick a player', 'target');
  const mode = payload.mode || (payload.itemId ? 'steal' : 'swap');
  if (mode === 'swap') {
    if (t.classId === 'enforcer') refuse('an Enforcer cannot be swapped', 'target');
    if (!c.pos || !t.pos) refuse('nowhere to swap', 'target');
    [c.pos, t.pos] = [t.pos, c.pos]; note(state, `${c.name} swaps places with ${t.name}`, 'class', ctx.now);
  } else if (mode === 'steal') {
    if (distanceBetween(c, t) > (c.passives?.reach ?? ctx.B('items').reachDefault)) refuse(`${t.name} is out of reach`, 'range');
    const items = G.gridItems(t); if (!items.length) refuse(`${t.name}'s grid is empty`, 'empty');
    let item = null;
    if (payload.itemId) { if (!hasUpgrade(c, 'chosencell')) refuse('choosing the cell unlocks at level 10', 'level'); item = items.find(it => it.id === payload.itemId) || refuse('no such item in their grid', 'item'); }
    else item = streamRng(state, 'misc').pick(items);
    const spot = G.firstFit(c, item); if (!spot) refuse(`no room in your grid for ${item.name}`, 'room');
    G.remove(t, item.id, { forget: true }); c.items[item.id] = item; G.place(c, item, spot.x, spot.y, spot.rot);
    note(state, `${c.name} lifts ${item.name} from ${t.name}'s pack`, 'class', ctx.now);
  } else refuse('mode is swap or steal', 'mode');
  setCooldown(state, ctx, c, 'cutpurseCooldown');
};
classActives.callout = (state, ctx, c, payload = {}) => {
  const t = charOf(state, payload.targetId); if (!t || t.id === c.id || t.dead) refuse('pick a player', 'target');
  const CH = ctx.B('challenge');
  const sameRegion = c.region && t.region === c.region;
  if (!(hasUpgrade(c, 'regioncall') && sameRegion) && distanceBetween(c, t) > CH.callOutRange) refuse(`${t.name} is more than ${CH.callOutRange} tiles away`, 'range');
  const tp = playerOfCharacter(state, t.id), cp = playerOfCharacter(state, c.id);
  state.pendingPrompt = { playerId: tp?.id || t.playerId, kind: 'callout', byId: cp?.id || c.playerId, targetId: t.id, ts: ctx.now };
  t.effects = t.effects.filter(e => e.id !== 'calledout'); t.effects.push({ id: 'calledout', kind: 'class', turnsLeft: 1, data: { byId: c.id } });
  setCooldown(state, ctx, c, 'enforcerCooldown');
  note(state, `${c.name} calls out ${t.name}`, 'class', ctx.now);
};

// Cooldown tick: own turns only, decremented here and nowhere else.
runHooks.turnStart.push((state, ctx, pid) => {
  const c = characterOf(state, pid); if (!c) return;
  if ((c.cooldowns?.active || 0) > 0) c.cooldowns.active -= 1;
  for (const e of c.effects.filter(e => e.id === 'calledout')) { e.turnsLeft -= 1; if (e.turnsLeft <= 0) c.effects.splice(c.effects.indexOf(e), 1); }
  c.usedThisTurn.petAttack = false;
});
// Run start: the Cutpurse's free Smoke Bomb(s).
runHooks.runStart.push((state, ctx) => {
  for (const c of Object.values(state.characters)) { if (c.classId === 'cutpurse') c.freeSmokeBombs = ctx.B('social').smokeBombFree; c.flags.noSwap = c.classId === 'enforcer'; }
});

// Damage: Pit Boss healing and monster guard, Croupier Cards bonus, Enforcer PvP bonus and first hit.
damageHooks.outgoing.push((state, ctx, info) => {
  const a = charOf(state, info.attackerId); if (!a) return;
  const C = ctx.B('classes'), CH = ctx.B('challenge'); let mult = 1;
  if (a.classId === 'pitboss' && info.kind === 'spell' && (info.item?.spellEffect === 'heal' || info.heal)) { mult *= 1 + C.pitBossHealBonus; info.notes.push('Pit Boss: healing +50%'); }
  if (a.classId === 'croupier' && hasUpgrade(a, 'cardsplus') && (info.item?.family || info.family) === 'cards') { mult *= 1 + C.croupierCardsBonus; info.notes.push('Croupier: Cards family'); }
  if (a.classId === 'enforcer' && info.targetKind === 'character') { mult *= 1 + CH.enforcerPvpBonus; info.notes.push('Enforcer: vs players'); }
  if (a.classId === 'enforcer' && hasUpgrade(a, 'firsthit') && state.fight && a.flags.firstHitFight !== state.fight.id) { a.flags.firstHitFight = state.fight.id; mult *= 1 + CH.enforcerPvpBonus; info.notes.push('Enforcer: first hit'); }
  if (mult !== 1) info.mult *= mult;
});
damageHooks.incoming.push((state, ctx, info) => {
  if (info.targetKind !== 'character') return;
  const t = charOf(state, info.targetId); if (!t) return;
  if (t.classId === 'pitboss' && state.monsters?.[info.attackerId]) { info.mult *= 1 - ctx.B('monsters').pitBossReduce; info.notes.push('Pit Boss: the house takes less'); }
});
deathHooks.onDeath.push((state, ctx, info) => {
  const killerId = info?.killerId ?? info?.byId ?? null; const k = killerId ? charOf(state, killerId) : null; const v = state.characters[info?.charId];
  if (k && v && k.classId === 'enforcer' && hasUpgrade(k, 'killheal')) health(state, k, ctx.B('classes').enforcerKillHeal, 'Enforcer: a kill heals', ctx);
});
export const cooldownKeyFor = (classId) => classDef(classId)?.active?.cooldownKey || null;
