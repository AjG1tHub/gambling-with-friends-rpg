// Quests, the ledger at run end, and a four-character scripted run through the whole module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { room, names4, B } from './_helpers.mjs';
import { makeMap, makeCharacter, makeItem, land, landHit, slayMonster, slayCharacter, rawEvent, ctxFor, COL, at, characterOf, currentPlayerId } from './_fixtures-economy.mjs';
import { questMet, completeQuest, QUEST_DECK } from '../../packages/shared/handlers/quests.js';
import { placings } from '../../packages/shared/handlers/ledger.js';
import { levelHooks } from '../../packages/shared/hooks.js';
import { monsterAt } from '../../packages/shared/encounters/monsters.js';
import { openPacts } from '../../packages/shared/handlers/economy.js';

function started({ seed = 42, mode = 'ffa' } = {}) {
  const r = room({ seed, mode }).join(names4); makeMap(r.state);
  for (const pid of r.state.seats) makeCharacter(r.state, pid, { pos: at('strip', COL.start), gold: 100, health: 90, level: 2, maxHealth: 110 });
  r.append('RUN_START'); return r;
}
const lap = (r) => { for (let i = 0; i < r.state.seats.length; i++) r.append('TURN_END', {}, currentPlayerId(r.state)); };

test('quests.json: every quest has a condition the checker knows, a pool and a tunable where it names one', () => {
  const known = new Set(['hitsInRegion', 'holdGold', 'bankGold', 'beatPlayer', 'killPlayer', 'visitAllRegions', 'visitRegion', 'bosses', 'monsterKills', 'petsCaught', 'lettersSent', 'surviveChaos', 'reachLevel', 'openChests', 'pactRepaid', 'innRests', 'auctionsWon', 'fullHealthRound', 'spins', 'bountiesCollected']);
  assert.ok(QUEST_DECK.length >= 20);
  for (const q of QUEST_DECK) { assert.ok(known.has(q.cond.type), q.id); assert.ok(['public', 'personal', 'any'].includes(q.pool), q.id); if (q.cond.key) assert.ok(q.cond.key in B.quests, `${q.id} key ${q.cond.key}`); }
});

test('dealing: public and personal counts, filled text, targets never yourself, no PvP quests in pve, deterministic by seed', () => {
  const r = started();
  assert.equal(r.state.quests.public.length, B.quests.perRun);
  for (const q of r.state.quests.public) { assert.equal(q.status, 'open'); assert.ok(!/\{/.test(q.text), q.text); assert.ok(q.pool !== 'personal'); assert.equal(q.ownerId, null); }
  for (const pid of r.state.seats) {
    const mine = r.state.quests.personal[pid]; assert.equal(mine.length, B.quests.personalPerPlayer);
    for (const q of mine) { assert.equal(q.ownerId, pid); assert.ok(!r.state.quests.public.some(p => p.questId === q.questId), 'not also public'); if (q.cond.targetId) assert.notEqual(q.cond.targetId, pid); }
  }
  const ids = new Set(r.state.quests.public.map(q => q.id)); assert.equal(ids.size, B.quests.perRun);
  assert.deepEqual(started().state.quests.public.map(q => q.questId), r.state.quests.public.map(q => q.questId));
  const pve = started({ mode: 'pve' }); for (const list of Object.values(pve.state.quests.personal)) for (const q of list) assert.ok(!['beatPlayer', 'killPlayer'].includes(q.cond.type));
  assert.ok(r.state.log.some(l => /Quests posted/.test(l.text)));
});

test('conditions: each check reads the right counter; completion pays Gold and XP through levelHooks.onXp', () => {
  const r = started(); const ctx = ctxFor(r); const [a, b] = r.state.seats; const c = characterOf(r.state, a);
  const q = (cond) => ({ id: 'x', questId: 'x', title: 'T', cond, rewardMult: 1, status: 'open', ownerId: null });
  c.questCounters = { hitsByRegion: { blackwood: 3 }, beaten: { [b]: true }, killed: {}, bosses: 1, monsterKills: 2, openChests: 2, pactRepaid: 1, innRests: 1, auctionsWon: 0, spins: 3, bountiesCollected: 1 };
  c.visitedRegions = { strip: true, docks: true }; c.gold = 2000; c.bank = 500; c.level = 5;
  assert.equal(questMet(r.state, ctx, q({ type: 'hitsInRegion', regionId: 'blackwood', n: 3 }), c), true);
  assert.equal(questMet(r.state, ctx, q({ type: 'hitsInRegion', regionId: 'docks', n: 1 }), c), false);
  assert.equal(questMet(r.state, ctx, q({ type: 'holdGold', n: 2000 }), c), true); assert.equal(questMet(r.state, ctx, q({ type: 'bankGold', n: 501 }), c), false);
  assert.equal(questMet(r.state, ctx, q({ type: 'beatPlayer', targetId: b }), c), true); assert.equal(questMet(r.state, ctx, q({ type: 'killPlayer', targetId: b }), c), false);
  assert.equal(questMet(r.state, ctx, q({ type: 'visitAllRegions' }), c), false); c.visitedRegions = Object.fromEntries(Object.keys(r.state.map.regions).map(k => [k, true])); assert.equal(questMet(r.state, ctx, q({ type: 'visitAllRegions' }), c), true);
  assert.equal(questMet(r.state, ctx, q({ type: 'visitRegion', regionId: 'citadel' }), c), true);
  for (const [type, n, ok] of [['bosses', 1, true], ['monsterKills', 3, false], ['openChests', 2, true], ['pactRepaid', 1, true], ['innRests', 2, false], ['auctionsWon', 1, false], ['spins', 3, true], ['bountiesCollected', 1, true], ['reachLevel', 5, true]]) assert.equal(questMet(r.state, ctx, q({ type, n }), c), ok, type);
  r.state.stats[a].petsCaught = 1; r.state.stats[a].lettersSent = 0; assert.equal(questMet(r.state, ctx, q({ type: 'petsCaught', n: 1 }), c), true); assert.equal(questMet(r.state, ctx, q({ type: 'lettersSent', n: 1 }), c), false);
  r.state.chaos.tier = 3; assert.equal(questMet(r.state, ctx, q({ type: 'surviveChaos', n: 3 }), c), true); c.dead = true; assert.equal(questMet(r.state, ctx, q({ type: 'surviveChaos', n: 3 }), c), false); c.dead = false;
  c.health = c.maxHealth; assert.equal(questMet(r.state, ctx, q({ type: 'fullHealthRound' }), c), true); c.health -= 1; assert.equal(questMet(r.state, ctx, q({ type: 'fullHealthRound' }), c), false);
  assert.equal(questMet(r.state, ctx, q({ type: 'manual' }), c), false);
  const xp = []; levelHooks.onXp.push((s, cx, info) => xp.push(info));
  const quest = q({ type: 'bosses', n: 1 }); quest.rewardMult = 2; completeQuest(r.state, ctx, quest, c);
  assert.equal(quest.status, 'done'); assert.equal(quest.doneBy, a); assert.equal(c.gold, 2000 + 2 * B.quests.goldReward); assert.deepEqual(xp, [{ charId: c.id, amount: B.xp.quest, why: 'quest x' }]); assert.deepEqual(c.quests, ['x']); assert.equal(c.questCounters.questsDone, 1);
  levelHooks.onXp.length = 0;
});

test('flow: hits complete a regional quest at turn end, holdGold waits for the round, QUEST_TAKE reserves, GM_QUEST posts and completes', () => {
  const r = started(); const [a, b] = r.state.seats; const ca = characterOf(r.state, a), cb = characterOf(r.state, b);
  const mk = (id, cond, extra = {}) => ({ id, questId: id, title: id, text: id, cond, pool: 'public', rewardMult: 1, status: 'open', takenBy: null, doneBy: null, doneAt: null, ownerId: null, ...extra });
  r.state.quests.public = [mk('hits', { type: 'hitsInRegion', regionId: 'docks', n: 2 }), mk('hoard', { type: 'holdGold', n: 150 }), mk('tour', { type: 'visitRegion', regionId: 'caldera' })];
  r.state.quests.personal = { [a]: [mk('secret', { type: 'beatPlayer', targetId: b }, { ownerId: a, pool: 'personal' })], [b]: [] };
  while (currentPlayerId(r.state) !== a) r.append('TURN_END', {}, currentPlayerId(r.state));
  ca.pos = at('docks', COL.plain); const m = monsterAt(r.state, at('docks', COL.enc1));
  landHit(r, ca.id, m.id); assert.equal(ca.questCounters.hitsByRegion.docks, 1); landHit(r, ca.id, m.id);
  ca.gold = 200;
  assert.equal(r.state.quests.public[0].status, 'open', 'checked at turn end, not on the hit');
  r.append('TURN_END', {}, a);
  assert.equal(r.state.quests.public[0].status, 'done'); assert.equal(r.state.quests.public[0].doneBy, a); assert.equal(ca.gold, 200 + B.quests.goldReward);
  assert.equal(r.state.quests.public[1].status, 'open', 'holdGold waits for the round end');
  for (let i = 0; i < 3; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(r.state.quests.public[1].status, 'done'); assert.equal(r.state.quests.public[1].doneBy, a);
  // a hit on a character counts as beating them: the secret quest
  landHit(r, ca.id, cb.id, 'character'); assert.ok(ca.questCounters.beaten[b]);
  while (currentPlayerId(r.state) !== a) r.append('TURN_END', {}, currentPlayerId(r.state)); r.append('TURN_END', {}, a);
  assert.equal(r.state.quests.personal[a][0].status, 'done'); assert.match(r.state.log.find(l => /personal quest/.test(l.text)).text, /completes a personal quest/, 'the TV never names it');
  // QUEST_TAKE: only at the board, then only the taker can finish it
  assert.match((() => { try { rawEvent(r, 'QUEST_TAKE', { questId: 'tour' }, b); } catch (e) { return e; } })().message, /Bounty Board/);
  cb.pos = at('strip', COL.bounty); rawEvent(r, 'QUEST_TAKE', { questId: 'tour' }, b); assert.equal(r.state.quests.public[2].takenBy, b);
  ca.pos = at('strip', COL.bounty); assert.match((() => { try { rawEvent(r, 'QUEST_TAKE', { questId: 'tour' }, a); } catch (e) { return e; } })().message, /already took it/);
  ca.visitedRegions = { caldera: true }; lap(r); assert.equal(r.state.quests.public[2].status, 'open', 'reserved for b');
  cb.visitedRegions = { caldera: true }; lap(r); assert.equal(r.state.quests.public[2].doneBy, b);
  // GM quests
  assert.match(r.try('GM_QUEST', { title: 'Sing' }, a).message, /GM only/);
  r.append('GM_QUEST', { title: 'Sing for the table', text: 'Judged by the GM', rewardMult: 0.5 }); const gq = r.state.quests.public.at(-1); assert.equal(gq.cond.type, 'manual'); assert.equal(gq.status, 'open');
  lap(r); assert.equal(gq.status, 'open', 'manual quests never auto-complete');
  const g = cb.gold; r.append('GM_QUEST', { complete: gq.id, playerId: b }); assert.equal(gq.status, 'done'); assert.equal(cb.gold, g + Math.round(B.quests.goldReward * 0.5));
  r.append('GM_QUEST', { title: 'Psst', playerId: a }); assert.equal(r.state.quests.personal[a].at(-1).ownerId, a);
});

test('ledger: placings (winner, survivors by score, the dead by when they fell), rows keep the GM-typed buy-in, a Hall of Fame row, once', () => {
  const r = started(); const [a, b, c, d] = r.state.seats;
  r.append('META_LEDGER', { playerId: a, buyIn: '$20', notes: 'paid cash' });
  const ca = characterOf(r.state, a), cb = characterOf(r.state, b), cc = characterOf(r.state, c), cd = characterOf(r.state, d);
  cb.gold = 300; cb.kills = 1; cc.gold = 500; cc.vaulted = ['it1', 'it2'];
  slayCharacter(r, ca.id, { killerKind: 'monster' }); r.tick(5000); slayCharacter(r, cd.id, { killerKind: 'monster' });
  assert.equal(r.state.metaLedgerFinal, undefined);
  r.append('GM_END_RUN', { winner: b, reason: 'the throne' });
  assert.equal(r.state.phase, 'ended'); assert.equal(r.state.metaLedgerFinal, true);
  const rows = r.state.metaLedger; assert.equal(rows.length, 4);
  const by = Object.fromEntries(rows.map(x => [x.playerId, x]));
  assert.equal(by[b].placing, 1); assert.equal(by[b].winner, true); assert.equal(by[c].placing, 2); assert.equal(by[d].placing, 3, 'died later'); assert.equal(by[a].placing, 4);
  assert.equal(by[a].buyIn, '$20'); assert.equal(by[a].notes, 'paid cash'); assert.equal(by[a].survived, false); assert.equal(by[c].vaulted.length, 2); assert.equal(by[c].characterName, cc.name); assert.equal(by[c].mode, 'ffa'); assert.equal(by[b].score, 300 + B.gold.scorePerKill + cb.health);
  const hof = r.state.hallOfFame.at(-1); assert.equal(hof.code, 'ABCD'); assert.equal(hof.winner, b); assert.equal(hof.players.length, 4); assert.equal(hof.players[0].playerId, b); assert.equal(hof.kills, 1); assert.equal(hof.endReason, 'the throne');
  r.append('META_LEDGER', { playerId: b, buyIn: '$10' }); assert.equal(r.state.hallOfFame.length, 1, 'finalised once'); assert.equal(r.state.metaLedger.find(x => x.playerId === b).buyIn, '$10');
  // a team win places the whole team first
  const t = started({ mode: 'teams' }); t.state.gm.teams = { red: { members: [a, b] } }; t.state.players[a].teamId = 'red'; t.state.players[b].teamId = 'red';
  t.state.winner = 'red'; const p = placings(t.state, ctxFor(t)); assert.deepEqual(p.slice(0, 2).map(x => x.pid).sort(), [a, b].sort()); assert.ok(p[0].winner && p[1].winner && !p[2].winner);
});

test('a four-character scripted run: fights, loot, pacts, the Collector, Chaos, auction, bounty, a death and a wake, quests, the ledger', () => {
  const r = started({ seed: 11 }); const [A, Bp, C, D] = r.state.seats; const cA = characterOf(r.state, A), cB = characterOf(r.state, Bp), cC = characterOf(r.state, C), cD = characterOf(r.state, D);
  const turnOf = (pid, fn) => { assert.equal(currentPlayerId(r.state), pid); fn(); r.append('TURN_END', {}, pid); };
  r.append('META_LEDGER', { playerId: A, buyIn: '$20' });
  // round 1
  turnOf(A, () => { land(r, A, at('strip', COL.enc1)); assert.equal(r.state.fight.kind, 'encounter'); const m = r.state.monsters[r.state.fight.monsterId]; assert.equal(m.speciesId, 'drunk_revenant'); slayMonster(r, m.id, A); assert.ok(cA.gold > 100); });
  turnOf(Bp, () => { r.append('GM_RIG', { stream: 'wheels', value: 'Gold' }); land(r, Bp, at('strip', COL.chest)); r.append('WHEEL_SPIN', { wheel: 'loot' }, Bp); assert.equal(cB.gold, 100 + B.gold.chestGold); });
  turnOf(C, () => { cC.health = 30; land(r, C, at('docks', COL.bloodbank)); r.append('PACT_TAKE', { amount: 30 }, C); assert.equal(cC.health, 60); assert.equal(openPacts(r.state, cC).length, 1); });
  turnOf(D, () => { land(r, D, at('strip', COL.shop)); r.append('SHOP_BUY', { sku: 'potion' }, D); assert.equal(cD.pendingLoot.length, 1); });
  assert.equal(r.state.round, 2);
  // round 2
  turnOf(A, () => { r.append('GM_RIG', { stream: 'wheels', value: 'The Collector' }); land(r, A, at('strip', COL.chaos)); r.append('CHAOS_SPIN', {}, A); assert.equal(cA.health, 90 - B.chaos.collectorTakes); });
  turnOf(Bp, () => {
    const ring = makeItem({ name: 'Brass Ring', slot: 'ring', rarity: 'rare' }); cB.items[ring.id] = ring; cB.grid.cells.push({ itemId: ring.id, x: 0, y: 0 });
    land(r, Bp, at('strip', COL.arena)); r.append('TILE_LEAVE', {}, Bp); r.append('AUCTION_OPEN', { itemId: ring.id }, Bp);
    r.append('AUCTION_BID', { amount: 50 }, C); r.append('AUCTION_BID', { amount: 55 }, D); r.append('AUCTION_CLOSE', {}, 'system');
    assert.equal(r.state.auction.result.winnerId, D); assert.equal(cD.pendingLoot.at(-1).item.id, ring.id);
  });
  turnOf(C, () => { land(r, C, at('docks', COL.bounty)); r.append('BOUNTY_PLACE', { targetId: A, gold: 50 }, C); assert.equal(r.state.bounties.length, 1); });
  turnOf(D, () => {
    cD.pos = cA.pos; const blade = makeItem({ name: 'Blade' }); cA.worn.mainhand = blade; cA.items[blade.id] = blade; cA.level = 3;
    const g = cD.gold; slayCharacter(r, cA.id, { killerId: cD.id, killerKind: 'player' });
    assert.equal(r.state.pendingPrompt.kind, 'takeWorn'); r.append('TILE_TAKE_LOOT', { itemId: blade.id }, D);
    assert.equal(cD.gold, g + B.gold.perKO + 50); assert.deepEqual(r.state.bounties, []); assert.ok(cA.dead); assert.equal(cA.missTurns, B.death.playerMissTurns); assert.equal(cA.level, 2);
  });
  // rounds 3-4: A sits out twice then wakes; C's pact runs overdue and the Collector calls
  assert.notEqual(currentPlayerId(r.state), A, 'A is in the Graveyard'); assert.equal(cA.missTurns, B.death.playerMissTurns - 1);
  for (let i = 0; i < 3; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.notEqual(currentPlayerId(r.state), A); assert.equal(cA.missTurns, 0); assert.ok(cA.dead);
  for (let i = 0; i < 3; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(currentPlayerId(r.state), A); assert.ok(!cA.dead); assert.equal(cA.pos, at('strip', COL.graveyard)); assert.equal(cA.health, Math.round(cA.maxHealth * B.death.wakeFraction));
  const pact = openPacts(r.state, cC)[0]; assert.equal(r.state.round, 5);
  while (pact.status !== 'overdue') r.append('TURN_END', {}, currentPlayerId(r.state));
  const hc = cC.health; while (currentPlayerId(r.state) !== C) r.append('TURN_END', {}, currentPlayerId(r.state)); r.append('TURN_END', {}, C);
  for (let i = 0; i < 3; i++) r.append('TURN_END', {}, currentPlayerId(r.state));
  assert.equal(cC.health, hc - B.bloodPact.collectorPerTurn); assert.ok(pact.paid >= B.bloodPact.collectorPerTurn);
  assert.ok(r.state.chaos.tier >= 2, 'Chaos has risen'); assert.ok(r.state.round > B.chaos.tierUpEveryRounds);
  // a quest completes along the way or by hand
  r.append('GM_QUEST', { title: 'Survive the night' }); const q = r.state.quests.public.at(-1); r.append('GM_QUEST', { complete: q.id, playerId: D }); assert.equal(q.doneBy, D);
  assert.ok(Object.values(cD.questCounters).length > 0);
  // the end
  r.append('GM_END_RUN', { winner: D, reason: 'last call' });
  const rows = r.state.metaLedger; assert.equal(rows.find(x => x.playerId === D).placing, 1); assert.equal(rows.find(x => x.playerId === A).buyIn, '$20'); assert.equal(rows.find(x => x.playerId === D).kills, 1);
  assert.equal(r.state.hallOfFame.length, 1); assert.ok(r.state.hallOfFame[0].bossesBeaten === 0 && r.state.hallOfFame[0].kills === 1);
  assert.ok(r.state.ledger.length >= 12, 'every move of Health and Gold left a ledger row'); assert.ok(r.state.ledger.every(x => x.kind && x.charId && typeof x.amount === 'number'));
  assert.ok(r.state.log.length <= 300);
});
