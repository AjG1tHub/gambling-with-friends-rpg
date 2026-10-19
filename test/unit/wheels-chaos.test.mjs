// Fortune, Fate and Loot wheels; Chaos tiers, effects, the Collector, votes and the damage mods.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, B } from './_helpers.mjs';
import { makeMap, startRun, makeCharacter, land, landHit, ctxFor, COL, at, characterOf, currentPlayerId } from './_fixtures-economy.mjs';
import { rollLoot, rollRarity, spinWheel, applyChaosToVictim, chaosTierMult, WHEELS } from '../../packages/shared/handlers/wheels.js';
import { monsterAt } from '../../packages/shared/encounters/monsters.js';

function started({ seed = 42, mode = 'ffa', tier = 1 } = {}) {
  const r = room({ seed, mode, tier }).join(names4); makeMap(r.state);
  for (const pid of r.state.seats) makeCharacter(r.state, pid, { pos: at('strip', COL.start), gold: 100, health: 60 });
  startRun(r); return r;
}
const spinAt = (r, pid, col, wheel, rigLabel = null, region = 'strip') => { if (rigLabel) r.append('GM_RIG', { stream: 'wheels', value: rigLabel }); land(r, pid, at(region, col)); r.append('WHEEL_SPIN', { wheel }, pid); return r.state.lastSpin; };

test('wheels.json: every segment has a label, a weight and a known effect; chaos segments carry minTier', () => {
  for (const w of ['fortune', 'fate', 'loot', 'chaos']) for (const s of WHEELS[w]) { assert.ok(s.id && s.label && s.weight > 0 && s.effect, `${w}/${s.id}`); }
  assert.ok(WHEELS.chaos.every(s => s.minTier >= 1 && s.minTier <= B.chaos.maxTier));
  assert.ok(WHEELS.chaos.some(s => s.minTier === 1) && WHEELS.chaos.some(s => s.minTier === B.chaos.maxTier));
});

test('WHEEL_SPIN: needs your own open prompt, honours the rig, writes lastSpin, clears the prompt into the action phase', () => {
  const r = started(); const pid = currentPlayerId(r.state); const other = r.state.seats.find(p => p !== pid);
  assert.match(r.try('WHEEL_SPIN', { wheel: 'fortune' }, pid).message, /no spin is open/);
  land(r, pid, at('strip', COL.wheel));
  assert.match(r.try('WHEEL_SPIN', { wheel: 'fate' }, pid).message, /no spin is open/, 'wrong wheel');
  assert.match(r.try('WHEEL_SPIN', { wheel: 'fortune', playerId: pid }, other).message, /cannot act/);
  assert.match(r.try('WHEEL_SPIN', { wheel: 'nope' }, 'gm').message, /no such wheel/);
  r.append('GM_RIG', { stream: 'wheels', value: 'Payday' });
  r.append('WHEEL_SPIN', { wheel: 'fortune' }, pid);
  const s = r.state.lastSpin; assert.equal(s.wheel, 'fortune'); assert.equal(s.playerId, pid); assert.equal(s.outcomes[s.index], 'Payday'); assert.deepEqual(s.outcomes, WHEELS.fortune.map(x => x.label)); assert.equal(s.ts, r.now());
  assert.equal(r.state.pendingPrompt, null); assert.equal(r.state.turnPhase, 'action');
  assert.equal(characterOf(r.state, pid).gold, 100 + B.wheels.fortuneGold);
  // the GM may spin any wheel for anyone without a prompt (proxy)
  r.append('WHEEL_SPIN', { wheel: 'fortune', playerId: other }, 'gm'); assert.equal(r.state.lastSpin.playerId, other);
  // a paused game refuses players, not the GM
  land(r, pid, at('strip', COL.wheel)); r.append('GM_PAUSE'); assert.match(r.try('WHEEL_SPIN', { wheel: 'fortune' }, pid).message, /paused/); r.append('GM_RESUME');
});

test('Fortune Wheel: Health (capped at max), Gold, an item spec, nothing', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  spinAt(r, pid, COL.wheel, 'fortune', 'Second Wind'); assert.equal(c.health, 60 + B.wheels.fortuneHealth);
  c.health = c.maxHealth - 5; spinAt(r, pid, COL.wheel, 'fortune', 'Second Wind'); assert.equal(c.health, c.maxHealth);
  r.append('GM_RIG', { stream: 'loot', value: 'rare' }); spinAt(r, pid, COL.wheel, 'fortune', 'A Gift');
  assert.deepEqual(Object.keys(c.pendingLoot.at(-1)).sort(), ['baseId', 'rarity', 'region', 'seed']); assert.equal(c.pendingLoot.at(-1).rarity, 'rare'); assert.equal(c.pendingLoot.at(-1).region, 'strip');
  const g = c.gold; spinAt(r, pid, COL.wheel, 'fortune', 'Nothing But Vibes'); assert.equal(c.gold, g); assert.equal(c.questCounters.spins, 4);
});

test('Fate Wheel: windfall, trapdoor to another region, swap (never with an Enforcer), free item, lose a turn, a bounty on you', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  spinAt(r, pid, COL.event, 'fate', 'Windfall'); assert.equal(c.gold, 100 + B.wheels.fateWindfall);
  spinAt(r, pid, COL.event, 'fate', 'Trapdoor'); assert.notEqual(r.state.map.hexes[c.pos].regionId, 'strip'); assert.equal(c.prevPos, at('strip', COL.event)); assert.equal(r.state.turnPhase, 'action');
  // swap: everyone else is an Enforcer except one
  const others = r.state.seats.filter(p => p !== pid); for (const p of others.slice(1)) characterOf(r.state, p).classId = 'enforcer';
  const target = characterOf(r.state, others[0]); target.pos = at('docks', COL.plain);
  spinAt(r, pid, COL.event, 'fate', 'Switcheroo'); assert.equal(c.pos, at('docks', COL.plain)); assert.equal(target.pos, at('strip', COL.event));
  spinAt(r, pid, COL.event, 'fate', 'Found Property'); assert.equal(c.pendingLoot.at(-1).baseId, 'loot');
  spinAt(r, pid, COL.event, 'fate', 'Blackout'); assert.equal(c.missTurns, B.wheels.fateMissTurns);
  spinAt(r, pid, COL.event, 'fate', 'Wanted'); assert.deepEqual(r.state.bounties.map(b => [b.targetId, b.byId, b.gold]), [[pid, 'house', B.gold.perKO]]);
  // the lost turn is skipped at the next turn start
  const turns = r.state.stats[pid].turns; r.append('TURN_END', {}, pid);
  for (let i = 0; i < r.state.seats.length - 1; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(c.missTurns, 0); assert.ok(r.state.log.some(l => /sits this turn out/.test(l.text))); assert.notEqual(currentPlayerId(r.state), pid, 'their turn was burned');
  assert.equal(r.state.stats[pid].turns, turns + 1, 'a skipped turn still counts as taken');
});

test('Loot Wheel: segment and rarity rolls, Luck and Citadel shifts, the Legendary cap, Gold by region tier, eggs', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  const ctx = ctxFor(r);
  r.append('GM_RIG', { stream: 'loot', value: 'common' }); assert.equal(rollRarity(r.state, ctx, { regionId: 'strip', charId: c.id }), 'common');
  c.stats.luck = B.stats.neutral + B.wheels.luckRarityShiftPerPoints; r.append('GM_RIG', { stream: 'loot', value: 'common' }); assert.equal(rollRarity(r.state, ctx, { regionId: 'strip', charId: c.id }), 'rare', 'Luck shifts one step');
  r.append('GM_RIG', { stream: 'loot', value: 'common' }); assert.equal(rollRarity(r.state, ctx, { regionId: 'citadel', charId: c.id }), 'epic', 'Citadel adds a step');
  c.stats.luck = B.stats.neutral;
  r.append('GM_RIG', { stream: 'loot', value: 'legendary' }); assert.equal(rollRarity(r.state, ctx, { regionId: 'strip', charId: c.id }), 'legendary'); assert.equal(r.state.legendariesDropped, 0, 'counted when the item is made, not rolled');
  r.state.legendariesDropped = B.items.legendaryPerRun;
  r.append('GM_RIG', { stream: 'loot', value: 'legendary' }); assert.equal(rollRarity(r.state, ctx, { regionId: 'citadel', charId: c.id }), 'epic', 'capped at items.legendaryPerRun'); r.state.legendariesDropped = 0;
  // the loot roll itself
  r.append('GM_RIG', { stream: 'loot', value: 'Gold' }); const g1 = rollLoot(r.state, ctx, { regionId: 'strip', charId: c.id }); assert.deepEqual([g1.kind, g1.gold], ['gold', B.gold.chestGold]);
  r.append('GM_RIG', { stream: 'loot', value: 'Gold' }); assert.equal(rollLoot(r.state, ctx, { regionId: 'caldera', charId: c.id }).gold, B.gold.chestGold + B.gold.chestGoldPerTier * 2);
  r.append('GM_RIG', { stream: 'loot', value: 'Egg' }); const e = rollLoot(r.state, ctx, { regionId: 'docks', charId: c.id }); assert.equal(e.kind, 'egg'); assert.equal(e.item.baseId, 'egg'); assert.equal(e.item.slot, 'egg'); assert.equal(e.item.region, 'docks');
  const i1 = rollLoot(r.state, ctx, { regionId: 'docks', charId: c.id, kind: 'item' }); assert.equal(i1.kind, 'item'); assert.ok(i1.item.seed >= 0);
  // through the Chest tile, the rig on the wheels stream picks the segment
  const g = c.gold; spinAt(r, pid, COL.chest, 'loot', 'Gold', 'docks'); assert.equal(c.gold, g + B.gold.chestGold + B.gold.chestGoldPerTier);
  // distribution sanity: over many rolls the weights show
  const r2 = started({ seed: 9 }); const n = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (let i = 0; i < 400; i++) n[rollRarity(r2.state, ctxFor(r2), { regionId: 'strip' })] += 1;
  assert.ok(n.common > n.rare && n.rare > n.epic && n.epic > n.legendary && n.legendary > 0, JSON.stringify(n));
});

test('Chaos: tiers rise with the rounds, segments unlock by tier, the tier multiplies damage, effects expire', () => {
  const r = started(); const ctx = ctxFor(r);
  assert.deepEqual(r.state.chaos, { tier: 1, roundsAtTier: 0, effects: [] });
  for (let i = 0; i < 4 * B.chaos.tierUpEveryRounds; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.chaos.tier, 2); assert.equal(r.state.chaos.roundsAtTier, 0);
  assert.equal(chaosTierMult(r.state, ctx), B.chaos.tierDamageMult[1]);
  const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid); const m = monsterAt(r.state, at('strip', COL.enc1));
  c.classId = 'cutpurse';   // a class with no damage passive (the Whale's +15% lives in the items module), so only Chaos touches this hit
  const hit = landHit(r, c.id, m.id); assert.equal(hit.damageMult, B.chaos.tierDamageMult[1]); assert.equal(hit.mult, 2, 'the game multiplier is never touched'); assert.ok(hit.notes.some(n => /Chaos tier/.test(n)));
  // segments on the wheel at tier 2 exclude minTier 3+
  r.append('GM_CHAOS', { tier: 2 }); land(r, pid, at('strip', COL.chaos)); r.append('GM_RIG', { stream: 'wheels', value: 'Mercy' }); r.append('CHAOS_SPIN', {}, pid);
  assert.deepEqual(r.state.lastSpin.outcomes, WHEELS.chaos.filter(s => s.minTier <= 2).map(s => s.label)); assert.equal(r.state.lastSpin.wheel, 'chaos'); assert.equal(r.state.turnPhase, 'action');
  // Escalation and the cap
  r.append('GM_CHAOS', { tier: 3 }); r.append('GM_CHAOS', { effect: 'tierup', playerId: pid }); assert.equal(r.state.chaos.tier, 4);
  r.append('CHAOS_TICK', {}); r.append('CHAOS_TICK', {}); assert.equal(r.state.chaos.tier, B.chaos.maxTier);
  assert.match(r.try('CHAOS_TICK', {}, pid).message, /GM only/);
  // a region effect doubles damage for attackers standing in that region, then fades
  r.append('GM_CHAOS', { tier: 1 }); r.append('GM_CHAOS', { effect: 'region', playerId: pid });
  const eff = r.state.chaos.effects[0]; assert.equal(eff.kind, 'region'); assert.equal(eff.regionId, 'strip'); assert.equal(eff.roundsLeft, B.wheels.chaosRegionRounds);
  assert.equal(landHit(r, c.id, m.id).damageMult, B.chaos.regionMult);
  c.pos = at('docks', COL.plain); assert.equal(landHit(r, m.id, c.id, 'character').damageMult, 1, 'the target is not in the region'); c.pos = at('strip', COL.chaos);
  assert.equal(landHit(r, c.id, m.id, 'monster', { kind: 'spell' }).damageMult, 1, 'spells are not damage');
  for (let i = 0; i < 4 * B.wheels.chaosRegionRounds; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.chaos.effects.length, 0); assert.equal(landHit(r, c.id, m.id).damageMult, 1);
  // a marked class takes more
  r.append('GM_CHAOS', { effect: 'class', playerId: pid }); const ce = r.state.chaos.effects[0]; assert.equal(ce.kind, 'class'); assert.ok(ce.classId);
  const victim = Object.values(r.state.characters).find(x => x.classId === ce.classId);
  assert.equal(landHit(r, m.id, victim.id, 'character').damageMult, B.chaos.classMult);
  victim.classId = 'croupier'; assert.equal(landHit(r, m.id, victim.id, 'character').damageMult, 1);
});

test('Chaos: the Collector (floor, Inn shelter, Pit Boss 15), grid flags, scatter, apocalypse, House Rules', () => {
  const r = started(); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, 60 - B.chaos.collectorTakes);
  c.health = B.bloodPact.collectorFloor + 3; r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, B.bloodPact.collectorFloor, 'never below the floor');
  c.health = 50; c.innSafeRound = r.state.round; r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, 50, 'sheltered at the Inn this round'); c.innSafeRound = null;
  c.classId = 'pitboss'; c.level = B.xp.upgradeLevels[2]; r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, 50, 'Pit Boss 15 is never visited'); c.classId = 'whale'; c.level = 1;
  c.shield = 10; r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, 40); assert.equal(c.shield, 10, 'the Collector ignores shields');
  for (const e of ['scramble', 'steal', 'shrink']) { r.append('GM_CHAOS', { effect: e, playerId: pid }); assert.equal(c.gridEffects.at(-1), e); }
  assert.deepEqual(c.gridEffects, ['scramble', 'steal', 'shrink'], 'a queue of flags the inventory module drains');
  const before = Object.fromEntries(Object.values(r.state.characters).map(x => [x.id, x.pos]));
  r.append('GM_CHAOS', { effect: 'scatter', playerId: pid });
  for (const x of Object.values(r.state.characters)) { assert.equal(r.state.map.hexes[x.pos].regionId, r.state.map.hexes[before[x.id]].regionId, 'scatter keeps you in your region'); assert.ok(!r.state.map.hexes[x.pos].void); }
  assert.ok(Object.values(r.state.characters).some(x => x.pos !== before[x.id]));
  // House Rules cancels the next Chaos effect for its holder
  c.effects.push({ id: 'houserules', kind: 'class', turnsLeft: -1, data: { mode: 'push' } }); const h = c.health;
  r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, h - B.chaos.collectorTakes, 'House Rules armed against a roll does not cancel Chaos'); assert.equal(c.effects.length, 1);
  c.effects = [{ id: 'houserules', kind: 'class', turnsLeft: -1, data: { mode: 'chaos' } }]; c.health = h;
  r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, h); assert.equal(c.effects.length, 0); assert.match(r.state.log.at(-1).text, /House Rules/);
  r.append('GM_CHAOS', { effect: 'collector', playerId: pid }); assert.equal(c.health, h - B.chaos.collectorTakes, 'spent');
  // apocalypse: everyone pays, every region bleeds, the tier is pinned
  const hs = Object.values(r.state.characters).map(x => x.health);
  r.append('GM_CHAOS', { tier: 1, effect: 'apocalypse', playerId: pid });
  assert.equal(r.state.chaos.tier, B.chaos.maxTier); assert.equal(r.state.chaos.effects.filter(e => e.kind === 'region').length, 5);
  Object.values(r.state.characters).forEach((x, i) => assert.equal(x.health, hs[i] - B.chaos.collectorTakes));
  assert.match(r.try('GM_CHAOS', { effect: 'nope' }).message, /no Chaos effect/);
});

test('Chaos: Scapegoat opens a vote the social module closes; applyChaosToVictim applies the pending effect', () => {
  const r = started(); const pid = currentPlayerId(r.state); const victimPid = r.state.seats.find(p => p !== pid); const v = characterOf(r.state, victimPid);
  r.append('GM_CHAOS', { tier: 2, effect: 'vote', playerId: pid });
  assert.equal(r.state.votes.kind, 'chaos'); assert.deepEqual([...r.state.votes.options].sort(), [...r.state.seats].sort()); assert.equal(r.state.votes.deadline, r.now() + B.chaos.voteSeconds * 1000);
  assert.equal(r.state.chaos.pendingVictimEffect.effect, 'collector');
  const res = applyChaosToVictim(r.state, ctxFor(r), victimPid);
  assert.equal(res.taken, B.chaos.collectorTakes); assert.equal(v.health, 60 - B.chaos.collectorTakes); assert.equal(r.state.votes, null); assert.equal(r.state.chaos.pendingVictimEffect, null);
  assert.equal(applyChaosToVictim(r.state, ctxFor(r), victimPid), null, 'nothing pending twice');
  // with one player alive the scapegoat is the spinner
  for (const p of r.state.seats) if (p !== pid) characterOf(r.state, p).dead = true;
  const c = characterOf(r.state, pid); const h = c.health; r.append('GM_CHAOS', { effect: 'vote', playerId: pid }); assert.equal(c.health, h - B.chaos.collectorTakes); assert.equal(r.state.votes, null);
});

test('damage mods: monster tier scaling and boss mood apply to monsters, never to characters', () => {
  const r = started({ tier: 2 }); const pid = currentPlayerId(r.state); const c = characterOf(r.state, pid);
  const m = monsterAt(r.state, at('strip', COL.enc1)); const boss = monsterAt(r.state, at('strip', COL.bossgate));
  assert.equal(landHit(r, m.id, c.id, 'character').damageMult, 1 + B.monsters.tierScale);
  assert.equal(landHit(r, c.id, m.id).damageMult, 1);
  spinWheel(r.state, ctxFor(r), 'boss', pid, { monsterId: boss.id }); boss.mood.damageMult = 1.5;
  assert.equal(landHit(r, boss.id, c.id, 'character').damageMult, (1 + B.monsters.tierScale) * 1.5);
  assert.throws(() => spinWheel(r.state, ctxFor(r), 'boss', pid, { monsterId: m.id }), /no such wheel/, 'commons have no moods');
});
