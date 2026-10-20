// Wheels and Chaos. One rig-aware spin (`spinWheel`) drives the Fortune, Fate, Loot, Boss and Chaos wheels from
// data/wheels.json and writes `state.lastSpin` for the TV. The Loot roll (`rollLoot` / `rollRarity`) lives here
// too because the Fortune and Fate wheels hand out items through it; tiles.js re-exports it.
//
// Events: WHEEL_SPIN { wheel, playerId? }  — answers a pendingPrompt { kind: 'spin', wheel, hexKey }
//         CHAOS_SPIN { playerId? }         — the same spin with wheel 'chaos'
//         CHAOS_TICK {}                    — GM/system: Chaos rises one tier now
//         GM_CHAOS { tier?, effect?, playerId? } — force a tier and/or a Chaos segment on a player
//
// Contracts with sibling modules:
//   c.pendingLoot   [ { baseId: 'loot'|'egg', rarity, region, seed } | { item } ]  the characters/inventory module
//                   turns specs into generated items (eggs into pet eggs) and places them in the grid, spilling to
//                   state.tileLoot[c.pos] when the grid is full.
//   c.gridEffects   [ 'scramble' | 'shrink' | 'steal' ]  a queue the inventory module drains at the owner's next turn
//                   start (the shrink's length is wheels.chaosGridShrinkRounds, kept by the inventory module).
//   state.votes     { kind: 'chaos', options: [playerId], deadline, openedAt, openedBy, votes: {} }  the social
//                   module runs VOTE_CAST/VOTE_CLOSE and calls applyChaosToVictim(state, ctx, playerId) with the result.
//   damageHooks     one incoming mod multiplies info.damageMult by the Chaos tier, a region effect (the target's
//                   region, else the attacker's), a class mark on the target, and, for a monster attacker, the
//                   difficulty tier scale (monsters.tierScale) and the boss mood. The fight module must not re-apply them.
//   lootHooks.rarity mods shift info.rarityIndex (Citadel +map.citadelLootShift is pushed here; the Gilt set and
//                   Economy affixes belong to the characters module).
import wheelsData from '../../../data/wheels.json' with { type: 'json' };
import { register, refuse, requireGm, requirePhase, requireActor } from '../reducer.js';
import { currentPlayerId, characterOf, livingCharacters, note } from '../state.js';
import { streamRng, rigAwareWeightedIndex } from '../rng.js';
import { health, gold, maxHealth as maxHealthMove } from '../health.js';
import { materialisePendingLoot } from '../characters/generator.js';
import { RARITIES, rarityKey } from '../balance.js';
import { damageHooks, lootHooks, runMods } from '../hooks.js';
import { hooks as runHooks } from '../handlers/run.js';
import { speciesOf } from '../encounters/monsters.js';

export const WHEELS = wheelsData;
const VOID_TYPES = new Set(['water', 'chasm', 'wall', 'blocker']);
export const isLandable = (h) => !!h && !h.void && !VOID_TYPES.has(h.type);
export const regionOfPos = (state, pos) => state.map?.hexes?.[pos]?.regionId ?? null;
export const regionOf = (state, c) => (c ? regionOfPos(state, c.pos) ?? c.region ?? null : null);
export const regionTier = (state, regionId) => state.map?.regions?.[regionId]?.tier || 1;
export const landableHexes = (state, regionId = null) => Object.values(state.map?.hexes || {}).filter(h => isLandable(h) && (regionId == null || h.regionId === regionId));
export const nameOf = (state, playerId) => state.players[playerId]?.name || playerId;
export const counter = (c, key, by = 1) => { c.questCounters ||= {}; c.questCounters[key] = (c.questCounters[key] || 0) + by; return c.questCounters[key]; };
const seed32 = (rng) => Math.floor(rng.next() * 4294967296) >>> 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- loot -------------------------------------------------------------------------------------------------
export function pushLoot(c, spec) { (c.pendingLoot ||= []).push(spec); return spec; }

// Rarity from the four loot weights, shifted up by Luck (one step per wheels.luckRarityShiftPerPoints above
// neutral) and by lootHooks.rarity mods; Legendary is capped per run (items.legendaryPerRun).
export function rollRarity(state, ctx, { regionId = null, charId = null, weights = null } = {}) {
  const W = ctx.B('wheels'), I = ctx.B('items'), S = ctx.B('stats');
  const capped = (state.legendariesDropped || 0) >= I.legendaryPerRun;
  const segs = RARITIES.map(r => ({ label: r, weight: r === 'legendary' && capped ? 0 : (weights ? weights[r] || 0 : W[rarityKey(r, 'lootWeight')]) }));
  const base = rigAwareWeightedIndex(state, 'loot', segs);
  const c = charId ? state.characters[charId] : null;
  const luck = c?.stats?.luck ?? S.neutral;
  const luckShift = Math.floor(Math.max(0, luck - S.neutral) / W.luckRarityShiftPerPoints);
  const info = runMods(lootHooks.rarity, state, ctx, { rarityIndex: base + luckShift, baseIndex: base, luckShift, regionId, charId });
  const idx = clamp(Math.round(info.rarityIndex), 0, capped ? RARITIES.length - 2 : RARITIES.length - 1);
  return RARITIES[idx];           // state.legendariesDropped is counted by the characters module when the item is made
}
// The Citadel rolls one rarity higher (map.citadelLootShift).
lootHooks.rarity.push((state, ctx, info) => {
  const r = info.regionId ? state.map?.regions?.[info.regionId] : null;
  if (info.regionId === 'citadel' || r?.modifier?.key === 'citadel') info.rarityIndex += ctx.B('map').citadelLootShift;
});

// Loot Wheel → { kind: 'gold'|'item'|'egg', rarity, gold, item }. `kind` forces a segment (the Fortune and Fate
// wheels want an item); otherwise the loot stream picks one. Items are placeholder specs the characters module
// generates from (seeded, so every client builds the same item).
export function rollLoot(state, ctx, { regionId = null, charId = null, kind = null } = {}) {
  const segs = wheelsData.loot;
  const index = kind ? Math.max(0, segs.findIndex(s => s.id === kind)) : rigAwareWeightedIndex(state, 'loot', segs);
  const seg = segs[index];
  const rng = streamRng(state, 'loot');
  const G = ctx.B('gold');
  const out = { kind: seg.effect, rarity: null, gold: 0, item: null, index, outcomes: segs.map(s => s.label) };
  if (seg.effect === 'gold') out.gold = Math.round(G.chestGold + G.chestGoldPerTier * (regionTier(state, regionId) - 1));
  else if (seg.effect === 'item') { out.rarity = rollRarity(state, ctx, { regionId, charId }); out.item = { baseId: 'loot', rarity: out.rarity, region: regionId, seed: seed32(rng) }; }
  else { out.rarity = 'common'; out.item = { baseId: 'egg', slot: 'egg', rarity: 'common', region: regionId, seed: seed32(rng) }; }
  return out;
}
export function grantLoot(state, ctx, c, loot, why) {
  const pid = c.playerId;
  if (loot.kind === 'gold') { gold(state, c, loot.gold, why, ctx); if (state.stats[pid]) state.stats[pid].goldEarned += loot.gold; note(state, `${c.name} finds ${loot.gold} Gold (${why})`, 'loot', ctx.now); }
  else if (loot.kind === 'egg') { pushLoot(c, loot.item); note(state, `${c.name} finds a pet egg (${why})`, 'loot', ctx.now); }
  else { pushLoot(c, loot.item); note(state, `${c.name} finds a${loot.rarity === 'epic' ? 'n' : ''} ${loot.rarity} item (${why})`, 'loot', ctx.now); }
  return loot;
}

// ---- the spin ---------------------------------------------------------------------------------------------
export function segmentsFor(state, wheel, extra = {}) {
  if (wheel === 'boss') { const m = state.monsters[extra.monsterId]; const sp = m && speciesOf(m.speciesId); return (sp?.moods || []).map(mo => ({ ...mo, label: mo.name })); }
  if (wheel === 'chaos') return wheelsData.chaos.filter(s => (s.minTier || 1) <= (state.chaos?.tier || 1));
  return wheelsData[wheel] || null;
}
export function spinWheel(state, ctx, wheel, playerId, extra = {}) {
  const segs = segmentsFor(state, wheel, extra);
  if (!segs || !segs.length) refuse(`no such wheel: ${wheel}`);
  const index = rigAwareWeightedIndex(state, 'wheels', segs);
  const seg = segs[index];
  state.lastSpin = { wheel, outcomes: segs.map(s => s.label), index, playerId, ts: ctx.now, effect: seg.effect || seg.id };
  const c = characterOf(state, playerId);
  if (c) counter(c, 'spins');
  if (c || wheel === 'boss') note(state, `${c ? c.name : 'The house'} spins the ${wheel} wheel: ${seg.label}`, 'wheel', ctx.now);
  const apply = APPLY[wheel]; const result = apply ? apply(state, ctx, seg, playerId, extra) : null;
  if (result?.text) state.lastSpin.text = result.text;
  return { seg, index, result };
}
// A spin nobody else sees (the Bug Reward Wheel): same streams and rig, no lastSpin, no public log line. Whatever
// the effect logged (loot pickups) is trimmed back out of the room log; the caller stores the result where only
// the player and the GM read it.
export function spinWheelSecret(state, ctx, wheel, playerId, extra = {}) {
  const segs = segmentsFor(state, wheel, extra);
  if (!segs || !segs.length) refuse(`no such wheel: ${wheel}`);
  const index = rigAwareWeightedIndex(state, 'wheels', segs);
  const seg = segs[index];
  const logLen = state.log.length;
  const apply = APPLY[wheel]; const result = apply ? apply(state, ctx, seg, playerId, extra) : null;
  if (state.log.length > logLen) state.log.splice(logLen);
  return { seg, index, result, outcomes: segs.map(s => s.label) };
}

function needChar(state, playerId) { const c = characterOf(state, playerId); if (!c) refuse(`no character for ${playerId}`); return c; }

const APPLY = {
  fortune(state, ctx, seg, playerId) {
    const c = needChar(state, playerId), W = ctx.B('wheels');
    if (seg.effect === 'health') { const h = health(state, c, W.fortuneHealth, 'Fortune Wheel', ctx); return { text: `${c.name} heals ${h}` }; }
    if (seg.effect === 'gold') { gold(state, c, W.fortuneGold, 'Fortune Wheel', ctx); state.stats[playerId] && (state.stats[playerId].goldEarned += W.fortuneGold); return { text: `${c.name} wins ${W.fortuneGold} Gold` }; }
    if (seg.effect === 'item') { const l = grantLoot(state, ctx, c, rollLoot(state, ctx, { regionId: regionOf(state, c), charId: c.id, kind: 'item' }), 'Fortune Wheel'); return { text: `a ${l.rarity} item`, loot: l }; }
    return { text: 'nothing' };
  },
  fate(state, ctx, seg, playerId) {
    const c = needChar(state, playerId), W = ctx.B('wheels'), G = ctx.B('gold'), rng = streamRng(state, 'wheels');
    switch (seg.effect) {
      case 'windfall': gold(state, c, W.fateWindfall, 'Fate: Windfall', ctx); state.stats[playerId] && (state.stats[playerId].goldEarned += W.fateWindfall); return { text: `${c.name} wins ${W.fateWindfall} Gold` };
      case 'teleport': {
        const here = regionOf(state, c);
        const pool = landableHexes(state).filter(h => h.regionId !== here && h.key !== c.pos);
        if (!pool.length) return { text: 'nowhere to fall' };
        const to = rng.pick(pool); c.prevPos = c.pos; c.pos = to.key; c.region = to.regionId;
        note(state, `${c.name} falls through a trapdoor into ${state.map.regions?.[to.regionId]?.name || to.regionId}`, 'move', ctx.now);
        return { text: `trapdoor to ${to.key}`, to: to.key };
      }
      case 'swap': {
        const others = livingCharacters(state).filter(o => o.id !== c.id && o.pos && o.classId !== 'enforcer');
        if (!others.length) return { text: 'nobody to swap with' };
        const o = rng.pick(others); const a = c.pos; c.prevPos = a; o.prevPos = o.pos; c.pos = o.pos; o.pos = a;
        c.region = regionOfPos(state, c.pos); o.region = regionOfPos(state, o.pos);
        note(state, `${c.name} and ${o.name} swap places`, 'move', ctx.now);
        return { text: `swapped with ${o.name}`, withId: o.id };
      }
      case 'item': { const l = grantLoot(state, ctx, c, rollLoot(state, ctx, { regionId: regionOf(state, c), charId: c.id, kind: 'item' }), 'Fate'); return { text: `a ${l.rarity} item`, loot: l }; }
      case 'loseturn': c.missTurns = (c.missTurns || 0) + W.fateMissTurns; note(state, `${c.name} blacks out and will miss ${W.fateMissTurns} turn${W.fateMissTurns === 1 ? '' : 's'}`, 'wheel', ctx.now); return { text: 'lose a turn' };
      case 'bounty': {
        state.bountySeq = (state.bountySeq || 0) + 1;
        state.bounties.push({ id: `b${state.bountySeq}`, targetId: playerId, byId: 'house', gold: G.perKO, placedAt: ctx.now });
        note(state, `The house puts ${G.perKO} Gold on ${c.name}'s head`, 'wheel', ctx.now); return { text: 'wanted' };
      }
      default: return { text: 'nothing' };
    }
  },
  loot(state, ctx, seg, playerId, extra = {}) {
    const c = needChar(state, playerId);
    const chest = extra.hexKey ? state.map?.hexes?.[extra.hexKey] : null;
    if (chest && chest.type === 'chest') { chest.lootSeen = true; counter(c, 'openChests'); }
    const l = grantLoot(state, ctx, c, rollLoot(state, ctx, { regionId: regionOf(state, c), charId: c.id, kind: seg.id }), 'Chest');
    return { text: l.kind === 'gold' ? `${l.gold} Gold` : l.kind === 'egg' ? 'an egg' : `a ${l.rarity} item`, loot: l };
  },
  boss(state, ctx, seg, playerId, extra) {
    const m = state.monsters[extra.monsterId]; if (!m) refuse('no such monster');
    m.mood = { id: seg.id, name: seg.name, healthMult: seg.healthMult, damageMult: seg.damageMult, lootMult: seg.lootMult, text: seg.text };
    const scaled = Math.max(1, Math.round(m.maxHealth * (seg.healthMult || 1)));
    if (m.parts) { const each = Math.max(1, Math.round(scaled / m.parts.length)); for (const p of m.parts) { p.maxHealth = p.health = each; } m.maxHealth = m.health = each * m.parts.length; }
    else { m.maxHealth = m.health = scaled; }
    note(state, `${m.name} is ${seg.name}: ${seg.text}`, 'boss', ctx.now);
    return { text: seg.name };
  },
  chaos(state, ctx, seg, playerId) { return applyChaos(state, ctx, seg, playerId); },
  // The Bug Reward Wheel: the GM spins it for a player who reported a bug (handlers/qa.js). Items land in the grid
  // at once rather than waiting for the next turn boundary.
  bugreward(state, ctx, seg, playerId) {
    const c = needChar(state, playerId), W = ctx.B('wheels'), rng = streamRng(state, 'wheels'), region = regionOf(state, c);
    const seed = () => Math.floor(rng.next() * 4294967296) >>> 0;
    const land = (spec) => { pushLoot(c, spec); const out = materialisePendingLoot(state, ctx, c); return out[out.length - 1]?.item || null; };
    switch (seg.effect) {
      case 'rare': case 'epic': case 'legendary': { const slot = rng.pick(['weapon', 'weapon', 'spell', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace']); const it = land({ baseId: 'loot', rarity: seg.effect, slot, region, seed: seed() }); return { text: `${c.name} is handed ${it?.name || `a ${seg.effect} item`}`, item: it?.id || null }; }
      case 'gold': gold(state, c, W.bugGold, 'Bug Reward Wheel', ctx); if (state.stats[playerId]) state.stats[playerId].goldEarned += W.bugGold; return { text: `${c.name} pockets ${W.bugGold} Gold` };
      case 'potions': { for (let i = 0; i < W.bugPotions; i++) land({ baseId: 'potion', rarity: 'common', region, seed: seed() }); return { text: `${c.name} gets ${W.bugPotions} Potions` }; }
      case 'heal': { maxHealthMove(state, c, W.bugMaxHealth, 'Bug Reward Wheel', ctx); const healed = health(state, c, c.maxHealth - c.health, 'Bug Reward Wheel', ctx); return { text: `${c.name} is patched up: full Health, +${W.bugMaxHealth} max` }; }
      case 'stat': c.statPoints = (c.statPoints || 0) + 1; return { text: `${c.name} gains a stat point` };
      case 'egg': land({ baseId: 'egg', slot: 'egg', rarity: 'common', region, seed: seed() }); return { text: `${c.name} finds a pet egg` };
      default: return { text: 'nothing' };
    }
  },
};

// ---- Chaos ------------------------------------------------------------------------------------------------
export const chaosOf = (state) => (state.chaos ||= { tier: 1, roundsAtTier: 0, effects: [] });
// House Rules (Pit Boss): the classes module arms { id: 'houserules', data: { mode: 'chaos' | 'push' | 'voidwin' } }.
export function consumeHouseRules(c) {
  const i = (c?.effects || []).findIndex(e => e.id === 'houserules' && (!e.data?.mode || e.data.mode === 'chaos'));
  if (i < 0) return false; c.effects.splice(i, 1); return true;
}
export function bumpTier(state, ctx, by = 1) {
  const ch = chaosOf(state), C = ctx.B('chaos');
  const before = ch.tier; ch.tier = clamp(ch.tier + by, 1, C.maxTier); ch.roundsAtTier = 0;
  if (ch.tier !== before) note(state, `Chaos rises to tier ${ch.tier}`, 'chaos', ctx.now);
  return ch.tier;
}
// The Collector takes a cut; Pit Boss level 15 is immune, an Inn visit this round shelters you, and he never kills.
export function collectorVisit(state, ctx, c, why, amount = null) {
  const C = ctx.B('chaos'), BP = ctx.B('bloodPact'), X = ctx.B('xp');
  if (!c || c.dead) return 0;
  if (c.classId === 'pitboss' && (c.level || 1) >= X.upgradeLevels[2]) { note(state, `The Collector does not visit ${c.name} (Pit Boss)`, 'chaos', ctx.now); return 0; }
  if (c.innSafeRound != null && c.innSafeRound === state.round) { note(state, `${c.name} is at the Inn; the Collector waits outside`, 'chaos', ctx.now); return 0; }
  const take = Math.min(amount ?? C.collectorTakes, Math.max(0, c.health - BP.collectorFloor));
  if (take <= 0) return 0;
  health(state, c, -take, why, ctx, { ignoreShield: true });
  note(state, `The Collector takes ${take} Health from ${c.name} (${why})`, 'chaos', ctx.now);
  return take;
}
function addEffect(state, ctx, eff) { state.chaosSeq = (state.chaosSeq || 0) + 1; const e = { id: `ch${state.chaosSeq}`, since: ctx.now, ...eff }; chaosOf(state).effects.push(e); return e; }
function scatter(state, ctx, rng) {
  for (const c of livingCharacters(state)) {
    if (consumeHouseRules(c)) { note(state, `${c.name} invokes House Rules and stays put`, 'chaos', ctx.now); continue; }
    const pool = landableHexes(state, regionOf(state, c)).filter(h => h.key !== c.pos);
    if (pool.length) { c.prevPos = c.pos; c.pos = rng.pick(pool).key; }
  }
  note(state, 'Chaos scatters everyone', 'chaos', ctx.now);
}
function regionEffect(state, ctx, regionId, rounds = null) {
  const C = ctx.B('chaos'), W = ctx.B('wheels');
  const e = addEffect(state, ctx, { kind: 'region', regionId, mult: C.regionMult, roundsLeft: rounds ?? W.chaosRegionRounds, label: `×${C.regionMult} damage in ${state.map?.regions?.[regionId]?.name || regionId}` });
  note(state, `Blood in the water: ${e.label} for ${e.roundsLeft} rounds`, 'chaos', ctx.now);
  return e;
}
export function applyChaos(state, ctx, seg, playerId) {
  const c = characterOf(state, playerId), C = ctx.B('chaos'), W = ctx.B('wheels'), rng = streamRng(state, 'wheels');
  if (c && seg.effect !== 'nothing' && consumeHouseRules(c)) { note(state, `${c.name} invokes House Rules: ${seg.label} is cancelled`, 'chaos', ctx.now); return { text: 'House Rules', cancelled: true }; }
  switch (seg.effect) {
    case 'collector': return { text: `the Collector takes ${collectorVisit(state, ctx, c, 'Chaos: The Collector')}` };
    case 'region': { const e = regionEffect(state, ctx, regionOf(state, c)); return { text: e.label, effect: e }; }
    case 'class': {
      const classes = [...new Set(livingCharacters(state).map(x => x.classId).filter(Boolean))];
      if (!classes.length) return { text: 'no one to mark' };
      const classId = rng.pick(classes);
      const e = addEffect(state, ctx, { kind: 'class', classId, mult: C.classMult, roundsLeft: W.chaosClassRounds, label: `×${C.classMult} damage against every ${classId}` });
      note(state, `Marked: ${e.label} for ${e.roundsLeft} rounds`, 'chaos', ctx.now); return { text: e.label, effect: e };
    }
    case 'scramble': case 'steal': case 'shrink': if (!c) return { text: 'no cage to touch' }; (c.gridEffects ||= []).push(seg.effect); note(state, `${c.name}'s cage: ${seg.label}`, 'chaos', ctx.now); return { text: seg.label };
    case 'vote': {
      const options = livingCharacters(state).map(x => x.playerId);
      if (options.length < 2) return { text: `the Collector takes ${collectorVisit(state, ctx, c, 'Chaos: Scapegoat')}` };
      // Same shape social.js's VOTE_OPEN writes, so VOTE_CAST / VOTE_CLOSE and the phones' voteView read it.
      state.votes = { id: `vote-${ctx.now.toString(36)}`, kind: 'chaos', question: 'Who does Chaos visit?', options, openedBy: playerId, openedAt: ctx.now, deadline: ctx.now + C.voteSeconds * 1000, ballots: {}, eligible: options.slice(), closed: false, result: null };
      chaosOf(state).pendingVictimEffect = { effect: 'collector', label: seg.label, openedBy: playerId, ts: ctx.now };
      note(state, 'The table votes for a scapegoat', 'chaos', ctx.now); return { text: 'vote', vote: true };
    }
    case 'tierup': return { text: `tier ${bumpTier(state, ctx, 1)}` };
    case 'scatter': scatter(state, ctx, rng); return { text: 'scatter' };
    case 'apocalypse': {
      chaosOf(state).tier = C.maxTier; chaosOf(state).roundsAtTier = 0;
      for (const x of livingCharacters(state)) if (!consumeHouseRules(x)) collectorVisit(state, ctx, x, 'Chaos: Apocalypse');
      for (const rid of Object.keys(state.map?.regions || {})) regionEffect(state, ctx, rid);
      note(state, 'APOCALYPSE', 'chaos', ctx.now); return { text: 'apocalypse' };
    }
    default: return { text: 'mercy' };
  }
}
// The social module calls this with the VOTE_CLOSE result of a { kind: 'chaos' } vote.
export function applyChaosToVictim(state, ctx, victimPlayerId) {
  const pending = chaosOf(state).pendingVictimEffect; if (!pending) return null;
  chaosOf(state).pendingVictimEffect = null;
  if (state.votes?.kind === 'chaos') state.votes = null;
  const c = characterOf(state, victimPlayerId); if (!c) return null;
  if (consumeHouseRules(c)) { note(state, `${c.name} invokes House Rules against the vote`, 'chaos', ctx.now); return { cancelled: true }; }
  note(state, `The table chose ${c.name}`, 'chaos', ctx.now);
  return { taken: collectorVisit(state, ctx, c, `Chaos: ${pending.label}`) };
}

// Tier rises every chaos.tierUpEveryRounds rounds; timed effects run down.
runHooks.roundEnd.push((state, ctx) => {
  const ch = chaosOf(state), C = ctx.B('chaos');
  ch.roundsAtTier = (ch.roundsAtTier || 0) + 1;
  if (ch.roundsAtTier >= C.tierUpEveryRounds && ch.tier < C.maxTier) bumpTier(state, ctx, 1);
  for (const e of ch.effects) if (e.roundsLeft != null) e.roundsLeft -= 1;
  const gone = ch.effects.filter(e => e.roundsLeft != null && e.roundsLeft <= 0);
  for (const e of gone) note(state, `Chaos fades: ${e.label}`, 'chaos', ctx.now);
  ch.effects = ch.effects.filter(e => !(e.roundsLeft != null && e.roundsLeft <= 0));
});

// ---- damage mods ------------------------------------------------------------------------------------------
// The items module's pipeline: info.mult is the game's multiplier (win / lose), info.damageMult scales the damage.
// `outgoing` only runs for character attackers, so everything lives in `incoming`, which runs for every damaging
// hit (never spells or self-targets).
export const chaosTierMult = (state, ctx) => { const C = ctx.B('chaos'); const t = chaosOf(state).tier || 1; return C.tierDamageMult[Math.min(t, C.tierDamageMult.length) - 1] ?? 1; };
function regionOfParty(state, id) {
  const c = state.characters?.[id]; if (c) return regionOf(state, c);
  const m = state.monsters?.[id]; if (m) return m.regionId ?? regionOfPos(state, m.pos);
  return null;
}
damageHooks.incoming.push((state, ctx, info) => {
  if (info.kind === 'spell' || info.targetKind === 'self') return;
  const notes = (info.notes ||= []); if (info.damageMult == null) info.damageMult = 1;
  const t = chaosTierMult(state, ctx); if (t !== 1) { info.damageMult *= t; notes.push(`Chaos tier ×${t}`); }
  const rid = regionOfParty(state, info.targetId) ?? regionOfParty(state, info.attackerId);
  for (const e of chaosOf(state).effects) if (e.kind === 'region' && e.regionId === rid) { info.damageMult *= e.mult; notes.push(e.label); }
  const target = info.targetKind === 'character' ? state.characters?.[info.targetId] : null;
  if (target) for (const e of chaosOf(state).effects) if (e.kind === 'class' && e.classId === target.classId) { info.damageMult *= e.mult; notes.push(e.label); }
  const m = state.monsters?.[info.attackerId];
  if (m) {
    const M = ctx.B('monsters'); const scale = 1 + M.tierScale * (Math.max(1, state.tier || 1) - 1);
    if (scale !== 1) { info.damageMult *= scale; notes.push(`tier ${state.tier} ×${scale}`); }
    if (m.mood?.damageMult && m.mood.damageMult !== 1) { info.damageMult *= m.mood.damageMult; notes.push(`${m.mood.name} ×${m.mood.damageMult}`); }
  }
});

// ---- handlers ---------------------------------------------------------------------------------------------
function spinHandler(state, ctx, wheelOverride = null) {
  requirePhase(state, 'playing');
  const prompt = state.pendingPrompt;
  const wheel = wheelOverride || ctx.payload.wheel || prompt?.wheel; if (!wheel) refuse('wheel required');
  const pid = ctx.payload.playerId || prompt?.playerId || currentPlayerId(state);
  requireActor(state, ctx, pid);
  if (state.gm.paused && !ctx.isGm) refuse('paused', 'paused');
  const mine = prompt && prompt.kind === 'spin' && prompt.playerId === pid && prompt.wheel === wheel;
  if (!mine && !ctx.isGm) refuse('no spin is open for you', 'prompt');
  const r = spinWheel(state, ctx, wheel, pid, { hexKey: prompt?.hexKey, ...ctx.payload });
  if (mine) { state.pendingPrompt = null; if (!state.fight && state.turnPhase !== 'done') state.turnPhase = 'action'; }
  return r;
}
register({
  WHEEL_SPIN(state, ev, ctx) { spinHandler(state, ctx); },
  CHAOS_SPIN(state, ev, ctx) { spinHandler(state, ctx, 'chaos'); },
  CHAOS_TICK(state, ev, ctx) { requireGm(ctx); bumpTier(state, ctx, Number(ctx.payload.by ?? 1)); },
  GM_CHAOS(state, ev, ctx) {
    requireGm(ctx);
    const C = ctx.B('chaos'); const ch = chaosOf(state);
    if (ctx.payload.tier != null) { ch.tier = clamp(Math.round(Number(ctx.payload.tier)), 1, C.maxTier); ch.roundsAtTier = 0; note(state, `GM sets Chaos to tier ${ch.tier}`, 'gm', ctx.now); }
    if (ctx.payload.effect) {
      const seg = wheelsData.chaos.find(s => s.id === ctx.payload.effect || s.effect === ctx.payload.effect); if (!seg) refuse(`no Chaos effect ${ctx.payload.effect}`);
      const pid = ctx.payload.playerId || currentPlayerId(state);
      state.lastSpin = { wheel: 'chaos', outcomes: wheelsData.chaos.map(s => s.label), index: wheelsData.chaos.indexOf(seg), playerId: pid, ts: ctx.now, effect: seg.effect, forced: true };
      applyChaos(state, ctx, seg, pid);
    }
  },
});
