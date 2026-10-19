// Pets (SPEC.md › Pets and Power Level): the Triple Pet Wheel, the active pet that fights first, pet attacks
// as minigame rolls staked from Power, pet-versus-pet battles, Rally, Pet Revive and the Tamer's Snare.
//
// Events (optional playerId for the GM acting for a seat):
//   PET_HATCH {source: 'egg' | 'setup' | 'boss'}   spins three wheels onto c.hatching (and state.lastSpin for the TV)
//   PET_HATCH_PICK {index}                         keep the species on wheel 0, 1 or 2 (a dud keeps nothing)
//   PET_SWITCH {petId}                             change the active pet; costs the turn's move
//   PET_ATTACK {petId?, attackIndex, mult, label}  actor-authoritative result of the pet's minigame (played on the
//        phone in chips mode with the pet's Power as the pool). This module applies monster damage itself by
//        editing state.monsters[id].health through a ledger row (kind 'monsterHealth'); the fight module does
//        not need to do anything for pet hits. Heals (healTrainer / healSelf) and Gold attacks pay out instead.
//   PET_BATTLE_START {opponentId, petId?, wager?}  pet vs pet; PET_BATTLE_LOCK {attackIndex} from each side,
//        resolved with the seeded 'pets' stream using each attack's stake as its weight.
// Hooks: petHooks.beforeCharacterHit → info.redirectToPet (the fight module moves the damage with power());
//        damageHooks.afterHit checks the pet for a faint afterwards (Mucklings lose a body, Beastmaster's first
//        faint is undone). classActives.rally, consumables.petrevive, legendaryEffects.tamersnare.onUse.
import petsData from '../../../data/pets.json' with { type: 'json' };
import { register, refuse, requirePhase, requireActor, requireGm } from '../reducer.js';
import { characterOf, currentPlayerId, note, playerOfCharacter } from '../state.js';
import { hooks as runHooks } from './run.js';
import { petHooks, damageHooks, classActives, consumables, legendaryEffects } from '../hooks.js';
import { power as movePower, health, gold, canPay } from '../health.js';
import { rigAwareWeightedIndex, streamRng } from '../rng.js';
import { hasUpgrade, giveXp } from '../characters/character.js';
import { makeConsumable } from '../characters/generator.js';
import { insert } from '../characters/grid.js';
import { actingCharacter, consumeOne } from './inventory.js';
import { teamCap } from './creation.js';
import { setCooldown } from './classes.js';

export const SPECIES = petsData.species;
export const speciesDef = (id) => SPECIES.find(s => s.id === id) || null;
export const stageName = (pet) => speciesDef(pet.speciesId)?.stages?.[pet.stage || 0]?.name || pet.name;

export function newPet(state, ctx, species, { regionId = null, name = null } = {}) {
  const P = ctx.B('pets'); state.petSeq = (state.petSeq || 0) + 1;
  const pet = { id: `pet${state.petSeq}`, speciesId: species.id, name: name || species.stages[0].name, element: species.element, stage: 0, power: P.startPower, maxPower: P.startPower,
    attacks: species.attacks.slice(0, P.attacks).map(a => ({ ...a })), heldItem: null, fainted: false, caughtAt: ctx.now, caughtIn: regionId };
  if (species.swarm) pet.bodies = P.swarmBodies;
  return pet;
}
export const activePet = (c) => c?.pets?.find(p => p.id === c.activePetId) || null;
export const healthyPets = (c) => (c?.pets || []).filter(p => !p.fainted && p.power > 0);

// Power moves through health.js; Beastmaster pets earn double; crossing a threshold evolves the pet.
export function gainPower(state, ctx, c, pet, amount, why) {
  const P = ctx.B('pets');
  if (amount > 0 && c?.classId === 'beastmaster') amount = Math.round(amount * P.beastmasterPowerMult);
  const moved = movePower(state, pet, amount, why, ctx);
  if (pet.power > (pet.maxPower || 0)) pet.maxPower = pet.power;
  const sp = speciesDef(pet.speciesId);
  while (sp && (pet.stage || 0) < sp.stages.length - 1 && pet.power >= P.evolveAt[pet.stage || 0]) {
    const was = stageName(pet); pet.stage = (pet.stage || 0) + 1;
    pet.maxPower += P.powerPerStage * (sp.stages[pet.stage].powerSteps - sp.stages[pet.stage - 1].powerSteps);
    if (pet.name === was) pet.name = sp.stages[pet.stage].name;
    note(state, `${was} evolves into ${sp.stages[pet.stage].name}!`, 'pet', ctx.now);
  }
  return moved;
}
// A pet at 0 Power faints, unless a Mucklings body or the Beastmaster's once-per-run grace takes it.
// Idempotent: the fight module may already have flagged `fainted` when it moved the Power; a swarm body or the
// Beastmaster's grace undoes that here, and a pet with Power left is never fainted.
export function checkFaint(state, ctx, c, pet) {
  if (!pet || pet.power > 0) { if (pet && pet.fainted && pet.power > 0 && pet.faintedAt == null) pet.fainted = false; return false; }
  if (pet.fainted && pet.faintedAt != null) return true;
  const P = ctx.B('pets');
  if (pet.bodies > 1) { pet.bodies -= 1; pet.fainted = false; movePower(state, pet, P.startPower, 'a heap steps up', ctx); note(state, `One of ${c.name}'s Mucklings is squashed (${pet.bodies} left)`, 'pet', ctx.now); return false; }
  if (c.classId === 'beastmaster' && !c.flags.faintUndone) { c.flags.faintUndone = true; pet.fainted = false; movePower(state, pet, P.startPower, 'Beastmaster grace', ctx); note(state, `${pet.name} shakes it off (Beastmaster)`, 'pet', ctx.now); return false; }
  pet.fainted = true; pet.faintedAt = ctx.now; note(state, `${c.name}'s ${pet.name} faints`, 'pet', ctx.now);
  if (c.activePetId === pet.id) c.activePetId = healthyPets(c)[0]?.id || null;
  return true;
}
// For the fight module when it prefers a helper over power(): the active pet takes `amount`.
export function petTakesHit(state, ctx, c, pet, amount, why = 'hit') { movePower(state, pet, -Math.abs(amount), why, ctx); return checkFaint(state, ctx, c, pet); }

export function hitMonster(state, ctx, m, amount, why) {
  const before = m.health; m.health = Math.max(0, m.health - Math.round(amount));
  state.ledgerSeq = (state.ledgerSeq || 0) + 1; state.ledger.push({ n: state.ledgerSeq, ts: ctx.now, kind: 'monsterHealth', charId: m.id, amount: -Math.round(amount), moved: m.health - before, why });
  if (m.health <= 0 && !m.dead) { m.dead = true; note(state, `${m.name} is slain`, 'fight', ctx.now); }
  return before - m.health;
}

// ── the Triple Pet Wheel ─────────────────────────────────────────
export function wheelPools(state, ctx, regionId) {
  const P = ctx.B('pets'), W = ctx.B('map').regionBiasWeight, n = P.wheelSegments;
  const allowed = SPECIES.filter(s => !s.onlyRegion || s.onlyRegion === regionId);
  const cycle = (list) => { if (!list.length) return []; const out = []; for (let i = 0; i < n; i++) out.push(list[i % list.length].id); return out; };
  const common = cycle(allowed.filter(s => s.pool === 'common'));
  const regionList = []; for (const s of allowed) { const w = s.regionBias === regionId ? W : 1; for (let i = 0; i < w; i++) regionList.push(s); }
  const region = cycle(regionList.sort((a, b) => (b.regionBias === regionId) - (a.regionBias === regionId)));
  const rareSpecies = allowed.filter(s => s.pool === 'rare' || (s.onlyRegion && s.onlyRegion === regionId));
  const rare = cycle(rareSpecies).slice(0, Math.max(1, n - P.rareWheelBlanks)); while (rare.length < n) rare.push(null);
  return [{ pool: 'common', outcomes: common }, { pool: 'region', outcomes: region }, { pool: 'rare', outcomes: rare }];
}
export function spinHatch(state, ctx, c, source, regionId) {
  const wheels = wheelPools(state, ctx, regionId).map(w => ({ ...w, index: rigAwareWeightedIndex(state, 'pets', w.outcomes.map(o => ({ label: o || 'dud', weight: 1 }))) }));
  c.hatching = { source, regionId: regionId || null, wheels, picked: null, ts: ctx.now };
  const pid = playerOfCharacter(state, c.id)?.id || c.playerId;
  state.lastSpin = { wheel: 'pets', outcomes: wheels.map(w => w.outcomes[w.index] || 'dud'), index: null, playerId: pid, ts: ctx.now, wheels: wheels.map(w => ({ pool: w.pool, outcomes: w.outcomes.map(o => o || 'dud'), index: w.index })) };
  note(state, `${c.name} spins the Triple Pet Wheel: ${state.lastSpin.outcomes.map(id => speciesDef(id)?.name || 'a dud egg').join(' / ')}`, 'pet', ctx.now);
  return c.hatching;
}

register({
  PET_HATCH(state, ev, ctx) {
    requirePhase(state, 'lobby', 'creation', 'playing');
    const { c } = actingCharacter(state, ctx); const source = ctx.payload.source || 'setup';
    if (c.hatching) refuse('pick from the wheels first', 'hatching');
    if (c.pets.length >= teamCap(ctx, c)) refuse('your team is full', 'pets');
    let regionId = c.region || null;
    if (source === 'setup') { if (c.pets.length) refuse('you already have a pet', 'pets'); if (c.flags.setupHatched) refuse('setup hatch already used', 'once'); c.flags.setupHatched = true; }
    else if (source === 'egg') { const egg = Object.values(c.items).find(it => it.slot === 'egg' && (!ctx.payload.itemId || it.id === ctx.payload.itemId)); if (!egg) refuse('you have no egg', 'item'); regionId = egg.region || regionId; consumeOne(state, c, egg); }
    else if (source === 'boss') { requireGm(ctx); }
    else refuse('source is egg, setup or boss', 'source');
    spinHatch(state, ctx, c, source, regionId);
  },
  PET_HATCH_PICK(state, ev, ctx) {
    const { pid, c } = actingCharacter(state, ctx);
    if (!c.hatching) refuse('nothing is hatching', 'hatching');
    const w = c.hatching.wheels[Number(ctx.payload.index)]; if (!w) refuse('pick wheel 0, 1 or 2', 'index');
    const speciesId = w.outcomes[w.index]; const h = c.hatching; c.hatching = null;
    if (!speciesId) { note(state, `${c.name} cracks a dud egg`, 'pet', ctx.now); return; }
    const pet = newPet(state, ctx, speciesDef(speciesId), { regionId: h.regionId });
    c.pets.push(pet); if (!c.activePetId) c.activePetId = pet.id;
    if (state.stats[pid]) state.stats[pid].petsCaught += 1;
    note(state, `${c.name} hatches a ${pet.name}`, 'pet', ctx.now);
  },
  PET_SWITCH(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actingCharacter(state, ctx);
    if (currentPlayerId(state) !== pid) refuse('not your turn', 'turn');
    const pet = c.pets.find(p => p.id === ctx.payload.petId); if (!pet) refuse('no such pet', 'pet');
    if (pet.fainted || pet.power <= 0) refuse(`${pet.name} is down`, 'fainted');
    if (c.activePetId === pet.id) refuse(`${pet.name} is already out`, 'pet');
    if (c.usedThisTurn.moved) refuse('switching costs your move and it is spent', 'move');
    c.usedThisTurn.moved = true; c.activePetId = pet.id;
    note(state, `${c.name} sends out ${pet.name}`, 'pet', ctx.now);
  },
  PET_ATTACK(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actingCharacter(state, ctx); const P = ctx.B('pets');
    const f = state.fight; if (!f || f.done || f.kind === 'petbattle') refuse('not in a fight', 'fight');
    if (f.playerId !== pid && !(f.playerIds || []).includes(pid)) refuse('not your fight', 'fight');
    const pet = activePet(c); if (!pet) refuse('no active pet', 'pet');
    if (ctx.payload.petId && ctx.payload.petId !== pet.id) refuse('only the active pet attacks', 'pet');
    if (pet.fainted || pet.power <= 0) refuse(`${pet.name} is down`, 'fainted');
    if (c.usedThisTurn.petAttack) refuse('your pet has attacked this turn', 'used');
    const atk = pet.attacks[Number(ctx.payload.attackIndex)]; if (!atk) refuse('no such attack', 'attack');
    const mult = Number(ctx.payload.mult); if (!Number.isFinite(mult) || mult < 0) refuse('bad multiplier', 'mult');
    let stake = atk.stake; if (atk.perBody && pet.bodies) stake = Math.max(1, Math.round(atk.stake * pet.bodies / P.swarmBodies));
    if (pet.power < stake) refuse(`${pet.name} needs ${stake} Power`, 'power');
    c.usedThisTurn.petAttack = true;
    const m = f.monsterId ? state.monsters[f.monsterId] : null;
    const label = ctx.payload.label ? ` (${String(ctx.payload.label).slice(0, 40)})` : '';
    if (mult > 1) {
      let amount = Math.round(stake * mult); if (hasUpgrade(c, 'petattack')) amount = Math.round(amount * (1 + P.beastmasterAttackBonus));
      if (atk.doubling) amount *= 2;
      if (atk.effect === 'healTrainer') { health(state, c, amount, `${pet.name}: ${atk.name}`, ctx); note(state, `${pet.name}'s ${atk.name} heals ${c.name} ${amount}${label}`, 'pet', ctx.now); }
      else if (atk.effect === 'healSelf') { gainPower(state, ctx, c, pet, amount, atk.name); note(state, `${pet.name} restores ${amount} Power${label}`, 'pet', ctx.now); }
      else if (atk.effect === 'gold') { gold(state, c, amount, `${pet.name}: ${atk.name}`, ctx); if (state.stats[pid]) state.stats[pid].goldEarned += amount; note(state, `${pet.name} scratches up ${amount} Gold${label}`, 'pet', ctx.now); }
      else if (!m) refuse('no monster to hit', 'target');
      else { if (m.dead) refuse(`${m.name} is already down`, 'target'); const dealt = hitMonster(state, ctx, m, amount, `${pet.name}: ${atk.name}`); if (atk.effect === 'eatTurn') m.skipTurns = (m.skipTurns || 0) + 1; if (state.stats[pid]) { state.stats[pid].damageDealt += dealt; state.stats[pid].hits += 1; if (m.dead) { state.stats[pid].kills += 1; c.kills = (c.kills || 0) + 1; } } note(state, `${pet.name}'s ${atk.name} hits ${m.name} for ${dealt}${label}`, 'pet', ctx.now); }
      gainPower(state, ctx, c, pet, P.winPower, 'a winning attack');
    } else if (mult < 1) {
      const lost = Math.round(stake * (1 - mult)); movePower(state, pet, -lost, `${atk.name} fails`, ctx);
      note(state, `${pet.name}'s ${atk.name} fails: −${lost} Power${label}`, 'pet', ctx.now); checkFaint(state, ctx, c, pet);
    } else note(state, `${pet.name}'s ${atk.name} is a push${label}`, 'pet', ctx.now);
  },
  PET_BATTLE_START(state, ev, ctx) {
    requirePhase(state, 'playing');
    const { pid, c } = actingCharacter(state, ctx);
    if (state.fight && !state.fight.done) refuse('a fight is already on', 'fight');
    const opp = state.players[ctx.payload.opponentId]; const oc = opp ? characterOf(state, opp.id) : null; if (!oc || oc.id === c.id) refuse('pick an opponent', 'target');
    const mine = ctx.payload.petId ? c.pets.find(p => p.id === ctx.payload.petId) : activePet(c) || healthyPets(c)[0]; const theirs = activePet(oc) || healthyPets(oc)[0];
    if (!mine || mine.fainted || mine.power <= 0) refuse('you need a healthy pet', 'pet'); if (!theirs || theirs.fainted || theirs.power <= 0) refuse(`${oc.name} has no healthy pet`, 'pet');
    const wager = Math.max(0, Math.round(Number(ctx.payload.wager) || 0)); if (wager && (!canPay(c, wager) || !canPay(oc, wager))) refuse('both sides must cover the wager', 'gold');
    state.fight = { id: `pb-${state.turnIdx}-${state.round}`, kind: 'petbattle', monsterId: null, playerIds: [pid, opp.id], playerId: pid, turn: 'player', pets: { [pid]: mine.id, [opp.id]: theirs.id }, locks: {}, round: 1, wager, game: null, log: [], done: false, result: null, startedAt: ctx.now };
    note(state, `${c.name}'s ${mine.name} squares up to ${oc.name}'s ${theirs.name}`, 'pet', ctx.now);
  },
  PET_BATTLE_LOCK(state, ev, ctx) {
    requirePhase(state, 'playing');
    const f = state.fight; if (!f || f.kind !== 'petbattle' || f.done) refuse('no pet battle', 'fight');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid); if (!f.playerIds.includes(pid)) refuse('not your battle', 'fight');
    const c = characterOf(state, pid); const pet = c.pets.find(p => p.id === f.pets[pid]);
    const atk = pet.attacks[Number(ctx.payload.attackIndex)]; if (!atk) refuse('no such attack', 'attack');
    if (f.locks[pid] != null) refuse('already locked', 'locked');
    f.locks[pid] = Number(ctx.payload.attackIndex);
    if (f.playerIds.some(id => f.locks[id] == null)) return;
    resolvePetRound(state, ctx, f);
  },
});

function resolvePetRound(state, ctx, f) {
  const P = ctx.B('pets'), X = ctx.B('xp'); const rng = streamRng(state, 'pets');
  const [a, b] = f.playerIds; const ca = characterOf(state, a), cb = characterOf(state, b);
  const pa = ca.pets.find(p => p.id === f.pets[a]), pb = cb.pets.find(p => p.id === f.pets[b]);
  const atkA = pa.attacks[f.locks[a]], atkB = pb.attacks[f.locks[b]];
  const aWins = rng.next() < atkA.stake / (atkA.stake + atkB.stake);
  const [winC, winPet, winAtk, loseC, losePet] = aWins ? [ca, pa, atkA, cb, pb] : [cb, pb, atkB, ca, pa];
  movePower(state, losePet, -winAtk.stake, `${winPet.name}: ${winAtk.name}`, ctx);
  f.log.push({ round: f.round, text: `${winPet.name}'s ${winAtk.name} beats ${losePet.name}'s ${(aWins ? atkB : atkA).name} for ${winAtk.stake}`, winnerId: winC.playerId });
  const fainted = checkFaint(state, ctx, loseC, losePet);
  f.locks = {}; f.round += 1;
  if (fainted || f.round > P.battleMaxRounds) {
    const victor = fainted ? winC : (pa.power === pb.power ? winC : (pa.power > pb.power ? ca : cb)); const loser = victor === ca ? cb : ca;
    f.done = true; f.result = { winnerId: victor.playerId, loserId: loser.playerId, rounds: f.round - 1 };
    if (f.wager) { gold(state, loser, -f.wager, 'pet battle wager', ctx); gold(state, victor, f.wager, 'pet battle wager', ctx); }
    giveXp(state, ctx, victor, X.petWin, 'pet battle');
    gainPower(state, ctx, victor, victor.pets.find(p => p.id === f.pets[victor.playerId]), P.winPower, 'battle won');
    const vp = state.stats[victor.playerId]; if (vp) vp.challengesWon += 1; const lp = state.stats[loser.playerId]; if (lp) lp.challengesLost += 1;
    note(state, `${victor.name} wins the pet battle`, 'pet', ctx.now);
    state.lastPetBattle = f; state.fight = null;
  }
}

// Pets fight first: the active pet (and, for a level-15 Beastmaster, the next one) takes the hit.
petHooks.beforeCharacterHit.push((state, ctx, info) => {
  if (info.targetKind !== 'character') return;
  const c = state.characters[info.targetId] || Object.values(state.characters).find(x => x.playerId === info.targetId); if (!c) return;
  const candidates = [activePet(c), ...(hasUpgrade(c, 'twopets') ? healthyPets(c).filter(p => p.id !== c.activePetId) : [])].filter(p => p && !p.fainted && p.power > 0);
  if (candidates.length) { info.redirectToPet = candidates[0].id; info.redirectToCharId = c.id; info.notes?.push(`${candidates[0].name} takes the hit`); }
});
damageHooks.afterHit.push((state, ctx, info) => {
  if (!info.redirectToPet) return;
  const c = state.characters[info.redirectToCharId] || Object.values(state.characters).find(x => x.pets.some(p => p.id === info.redirectToPet)); if (!c) return;
  checkFaint(state, ctx, c, c.pets.find(p => p.id === info.redirectToPet));
});

// Rally: heal the active pet to full; at level 20 it also revives a fainted one.
classActives.rally = (state, ctx, c) => {
  const pet = activePet(c) || c.pets.find(p => p.fainted); if (!pet) refuse('no pet to rally', 'pet');
  if (pet.fainted) { if (!hasUpgrade(c, 'revive')) refuse(`${pet.name} has fainted; Rally revives only with the final upgrade`, 'fainted'); pet.fainted = false; pet.faintedAt = null; }
  movePower(state, pet, pet.maxPower - pet.power, 'Rally', ctx); if (!c.activePetId) c.activePetId = pet.id;
  setCooldown(state, ctx, c, 'beastmasterCooldown');
  note(state, `${c.name} rallies ${pet.name}`, 'pet', ctx.now);
};
consumables.petrevive = (state, ctx, c, payload, item) => {
  const pet = c.pets.find(p => p.id === payload?.petId) || c.pets.find(p => p.fainted); if (!pet || !pet.fainted) refuse('no fainted pet', 'pet');
  pet.fainted = false; pet.faintedAt = null; movePower(state, pet, pet.maxPower - pet.power, 'Pet Revive', ctx); if (!c.activePetId) c.activePetId = pet.id;
  if (item) consumeOne(state, c, item); note(state, `${pet.name} is back on its feet`, 'pet', ctx.now);
};
// Tamer's Snare: a monster under the threshold becomes a pet (its items become its attacks).
export function petFromMonster(state, ctx, m) {
  const P = ctx.B('pets'); const sp = speciesDef(m.speciesId);
  if (sp) return newPet(state, ctx, sp, { regionId: m.regionId });
  state.petSeq = (state.petSeq || 0) + 1;
  const attacks = (m.items || []).filter(it => it.gameId).slice(0, P.attacks).map(it => ({ name: it.name, gameId: it.gameId, stake: Math.max(1, Math.round(it.stake / 2)) }));
  while (attacks.length < P.attacks) attacks.push({ name: 'Bite', gameId: 'fifty', stake: Math.max(1, Math.round(P.startPower / 5)) });
  return { id: `pet${state.petSeq}`, speciesId: `monster:${m.speciesId || m.id}`, name: m.name, element: 'Soot', stage: 0, power: P.startPower, maxPower: P.startPower, attacks, heldItem: null, fainted: false, caughtAt: ctx.now, caughtIn: m.regionId || null, monsterSpecies: m.speciesId || null };
}
legendaryEffects.tamersnare = { onUse(state, ctx, c, payload, item) {
  const m = state.monsters[payload?.monsterId || state.fight?.monsterId]; if (!m || m.dead) refuse('no monster to snare', 'target');
  if (m.health / m.maxHealth >= ctx.B('monsters').snareThreshold) refuse(`${m.name} is not weak enough yet`, 'threshold');
  if (c.pets.length >= teamCap(ctx, c)) refuse('your team is full', 'pets');
  const pet = petFromMonster(state, ctx, m); c.pets.push(pet); if (!c.activePetId) c.activePetId = pet.id;
  m.dead = true; m.caught = true; m.caughtBy = c.id; if (item) consumeOne(state, c, item);
  const pid = playerOfCharacter(state, c.id)?.id; if (pid && state.stats[pid]) state.stats[pid].petsCaught += 1;
  if (state.fight && state.fight.monsterId === m.id) { state.fight.done = true; state.fight.result = { caught: true, by: c.id }; }
  note(state, `${c.name} snares ${m.name}!`, 'pet', ctx.now);
} };

// Run start: the session Power bonus, the Beastmaster's extra egg, the Uddered Maw's potion, and a setup hatch
// for anyone who came without a pet.
runHooks.runStart.push((state, ctx) => {
  const P = ctx.B('pets'), Gb = ctx.B('grid');
  for (const c of Object.values(state.characters)) {
    if (!state.players[c.playerId] || state.players[c.playerId].kicked) continue;
    for (const pet of c.pets) { gainPower(state, ctx, c, pet, P.sessionPowerBonus, 'session bonus'); if (speciesDef(pet.speciesId)?.stages?.[pet.stage]?.perk === 'potionOncePerRun') { const pot = makeConsumable(state, 'potion'); if (!insert(c, pot, { stackMax: Gb.stack })) delete c.items[pot.id]; } }
    if (c.classId === 'beastmaster') { const egg = makeConsumable(state, 'egg'); if (!insert(c, egg, { stackMax: Gb.stack })) { delete c.items[egg.id]; (state.tileLoot[c.pos || 'start'] ||= []).push({ ...egg, droppedAt: ctx.now, round: state.round }); } note(state, `${c.name} finds an egg in the pack (Beastmaster)`, 'pet', ctx.now); }
    if (!c.pets.length && !c.hatching && !c.flags.setupHatched) { c.flags.setupHatched = true; spinHatch(state, ctx, c, 'setup', c.region || null); }
  }
});
