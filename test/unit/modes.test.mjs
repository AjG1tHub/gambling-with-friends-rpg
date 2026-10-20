// Modes: per-mode scaling handed to the generators, PvP conversion, friendly fire, each end condition, placings,
// Royale's circle and the Chicken Dinner Platter, difficulty tiers, the vault, veterans, Hall of Fame and seasons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table, makeMap, makeCharacter, makeItem, room, shared } from './_fixtures-social.mjs';
import { modeAdjust, placings, endCheck, tierAllowed, seasonRollover, standing, canUseChickenDinner, royaleCenter, isOutside } from '../../packages/shared/handlers/modes.js';
import { applyChallengeHit } from '../../packages/shared/handlers/challenge.js';
import { consumables } from '../../packages/shared/hooks.js';
import * as hex from '../../packages/shared/hex.js';

const B = shared.B;
const ctxOf = (t) => ({ now: t.r.now(), B: (g) => shared.group(t.state, g) });
// A death: the character lies in the Graveyard and will wake, so it still *stands* in the run (DECISIONS.md 14).
const kill = (t, pid) => { const c = t.char(pid); c.dead = true; c.health = 0; };
// Out of the run: what death.js does on a player kill in pvp / teams / royale (c.eliminated); the only thing besides a
// kicked seat that takes a character out of `standing`.
const out = (t, pid) => { kill(t, pid); t.char(pid).eliminated = true; };

test('modeAdjust: multipliers per mode, set on state before any other runStart hook', () => {
  const R = B.runs;
  assert.deepEqual(modeAdjust({ mode: 'pvp' }, R), { mode: 'pvp', monsters: false, monsterMult: 0, extraMonstersPerRegion: 0, bossHealthMult: 1, chestMult: R.pvpChestMult, lootMult: 1, encountersBecomeArenas: true });
  assert.equal(modeAdjust({ mode: 'pve' }, R).extraMonstersPerRegion, R.pveExtraMonsters); assert.equal(modeAdjust({ mode: 'pve' }, R).bossHealthMult, R.pveBossMult);
  for (const m of ['ffa', 'teams', 'royale']) assert.deepEqual({ ...modeAdjust({ mode: m }, R), mode: 'x' }, { ...modeAdjust({ mode: 'ffa' }, R), mode: 'x' });
  const seen = []; const spy = (state) => seen.push(state.modeAdjust?.mode); shared.runHooks.runStart.push(spy);
  try { const t = table({ mode: 'pve' }); assert.deepEqual(seen, ['pve']); assert.equal(t.state.modeAdjust.bossHealthMult, R.pveBossMult); }
  finally { shared.runHooks.runStart.splice(shared.runHooks.runStart.indexOf(spy), 1); }
});

test('pvp: Encounter hexes become Arenas and the monsters go, at RUN_START or at the first turn if the map came later', () => {
  const encounters = (state) => Object.values(state.map.hexes).filter(h => h.type === 'encounter').length;
  const t = table({ mode: 'pvp' });
  assert.equal(encounters(t.state), 0);
  assert.equal(Object.values(t.state.map.hexes).filter(h => h.type === 'arena').length, 3);
  assert.ok(Object.values(t.state.map.hexes).every(h => !h.monsterId)); assert.deepEqual(t.state.monsters, {});
  assert.equal(t.state.modeAdjust.pvpConverted, true);
  // the generated map: the map module's runStart hook builds it after this module's conversion hook ran, so the
  // conversion is left pending and the first turn start does it, before anyone moves
  const seen = []; const spy = (state) => seen.push({ pending: state.modeAdjust?.pvpPending, encounters: encounters(state) }); shared.runHooks.runStart.push(spy);
  try {
    const g = table({ mode: 'pvp', map: 'generated' });
    assert.deepEqual(seen.map(s => s.pending), [true]); assert.ok(seen[0].encounters > 0, 'the generated map arrives with Encounters');
    assert.equal(g.state.modeAdjust.pvpPending, false); assert.equal(g.state.modeAdjust.pvpConverted, true);
    assert.equal(encounters(g.state), 0); assert.ok(Object.values(g.state.map.hexes).filter(h => h.type === 'arena').length >= seen[0].encounters);
    assert.deepEqual(g.state.monsters, {}); assert.ok(Object.values(g.state.map.hexes).every(h => !h.monsterId));
  } finally { shared.runHooks.runStart.splice(shared.runHooks.runStart.indexOf(spy), 1); }
  const ffa = table({ mode: 'ffa' }); assert.equal(encounters(ffa.state), 3, 'other modes keep their encounters');
  assert.ok(encounters(table({ mode: 'ffa', map: 'generated' }).state) > 0);
});

test('friendly fire: PvE cancels every character-on-character hit; Teams cancels it inside a team only', () => {
  const t = table({ mode: 'pve' }); const [a, b] = t.order;
  let r = applyChallengeHit(t.state, ctxOf(t), a, b, t.char(a).worn.mainhand); assert.equal(r.dmg, 0); assert.equal(r.info.cancel, true); assert.equal(t.char(b).health, 100);
  const tt = table({ mode: 'teams', start: false }); const [x, y, z] = tt.ids;
  tt.r.append('GM_SET_TEAMS', { teams: { red: { name: 'Red', members: [x, y] }, blue: { name: 'Blue', members: [z, tt.ids[3]] } } }); tt.r.append('RUN_START');
  assert.equal(applyChallengeHit(tt.state, ctxOf(tt), x, y, tt.char(x).worn.mainhand).dmg, 0, 'same team');
  assert.equal(applyChallengeHit(tt.state, ctxOf(tt), x, z, tt.char(x).worn.mainhand).dmg, 10, 'other team');
  const f = table(); assert.equal(applyChallengeHit(f.state, ctxOf(f), f.order[0], f.order[1], f.char(f.order[0]).worn.mainhand).dmg, 10, 'ffa: full');
});

test('end conditions: throne or last standing (ffa), last standing (pvp), the Dealer or everyone dead (pve), last team (teams)', () => {
  // ffa: nobody has a character yet → no verdict (core tests rely on this); throne
  const bare = room().join(['A', 'B']); bare.append('RUN_START'); bare.append('TURN_END', {}, shared.currentPlayerId(bare.state)); assert.equal(bare.state.phase, 'playing');
  let t = table(); let [a, b, c, d] = t.order;
  assert.equal(endCheck(t.state, ctxOf(t)), null);
  t.state.throneReachedBy = b; t.r.append('EMOTE', { emoji: '👑' }, b);
  assert.equal(t.state.phase, 'ended'); assert.equal(t.state.winner, b); assert.match(t.state.endReason, /throne/);
  // ffa: last standing — the dead wake at the Graveyard, so three deaths in a row do not end the night; only
  // characters out of the run (eliminated, kicked) leave the count
  t = table(); [a, b, c, d] = t.order; kill(t, a); kill(t, b); kill(t, c); t.r.append('EMOTE', { emoji: '💀' }, d); assert.equal(t.state.phase, 'playing', 'the dead still stand');
  for (const id of [a, b, c]) assert.equal(standing(t.state, id), true);
  out(t, a); out(t, b); t.r.append('EMOTE', { emoji: '💀' }, c); assert.equal(t.state.phase, 'playing');
  out(t, c); t.r.append('EMOTE', { emoji: '💀' }, d); assert.equal(t.state.phase, 'ended'); assert.equal(t.state.winner, d); assert.match(t.state.endReason, /last one standing/);
  // a table of one never ends by "last standing"
  const solo = table({ names: ['Aj'] }); solo.r.append('EMOTE', { emoji: '🙂' }, 'p0'); assert.equal(solo.state.phase, 'playing');
  // pvp: a player kill eliminates
  t = table({ mode: 'pvp' }); [a, b, c, d] = t.order; out(t, b); out(t, c); kill(t, d); t.r.append('EMOTE', { emoji: '⚔' }, a); assert.equal(t.state.phase, 'playing', 'a death that was not a player kill is not an elimination');
  out(t, d); t.r.append('EMOTE', { emoji: '⚔' }, a); assert.equal(t.state.winner, a);
  // pve: the Dealer
  t = table({ mode: 'pve' }); [a, b, c, d] = t.order;
  t.state.monsters.the_dealer = { id: 'the_dealer', name: 'The Dealer', final: true, dead: false, health: 400, maxHealth: 400 };
  t.char(c).gold = 500; t.r.append('EMOTE', { emoji: '🃏' }, a); assert.equal(t.state.phase, 'playing');
  t.state.monsters.the_dealer.dead = true; t.r.append('EMOTE', { emoji: '🃏' }, a);
  assert.equal(t.state.phase, 'ended'); assert.equal(t.state.cleared, true); assert.equal(t.state.winner, c, 'the top placing survivor carries the name'); assert.match(t.state.endReason, /Dealer/);
  // pve: everyone fell to the House — the dead wake, so a table in the Graveyard plays on; only when nobody is
  // left in the run (eliminated or kicked) does the House win
  t = table({ mode: 'pve' }); [a, b, c, d] = t.order; for (const id of [a, b, c, d]) kill(t, id); t.r.append('EMOTE', { emoji: '💀' }, a); assert.equal(t.state.phase, 'playing');
  for (const id of [a, b, c]) t.char(id).eliminated = true; t.r.append('GM_KICK', { playerId: d });
  assert.equal(t.state.phase, 'ended'); assert.equal(t.state.winner, null); assert.match(t.state.endReason, /everyone fell to the House/);
  // teams
  t = table({ mode: 'teams', start: false }); const [x, y, z, w] = t.ids;
  t.r.append('GM_SET_TEAMS', { teams: { red: { name: 'Red', members: [x, y] }, blue: { name: 'Blue', members: [z, w] } } }); t.r.append('RUN_START');
  out(t, x); t.r.append('EMOTE', { emoji: '🟥' }, y); assert.equal(t.state.phase, 'playing');
  out(t, y); t.r.append('EMOTE', { emoji: '🟦' }, z); assert.equal(t.state.phase, 'ended'); assert.equal(t.state.winner, 'blue'); assert.match(t.state.endReason, /Blue is the last team/);
  const p = placings(t.state); assert.equal(p[0].teamPlace, 1); assert.ok(['p2', 'p3'].includes(p[0].playerId)); assert.equal(p[3].teamPlace, 2);
  // Last Call: whatever the mode, a run still going table.lastCallMinutes after RUN_START ends on placings
  t = table(); [a, b, c, d] = t.order; t.char(b).gold = 900; t.r.tick(B.table.lastCallMinutes * 60000 - 1); t.r.append('EMOTE', { emoji: '🕛' }, a); assert.equal(t.state.phase, 'playing');
  t.r.tick(1); t.r.append('EMOTE', { emoji: '🕛' }, a); assert.equal(t.state.phase, 'ended'); assert.equal(t.state.winner, b, 'the top placing'); assert.equal(t.state.endReason, 'Last Call: the House closed');
  t = table({ mode: 'teams', start: false }); t.r.append('GM_SET_TEAMS', { teams: { red: { name: 'Red', members: [x, y] }, blue: { name: 'Blue', members: [z, w] } } }); t.r.append('RUN_START'); t.char(w).gold = 900;
  t.r.tick(B.table.lastCallMinutes * 60000); t.r.append('EMOTE', { emoji: '🕛' }, x); assert.equal(t.state.phase, 'ended'); assert.equal(t.state.winner, 'blue', 'teams: the top placing\'s team');
  // 0 turns it off
  t = table({ balance: { table: { lastCallMinutes: 0 } } }); t.r.tick(24 * 3600000); t.r.append('EMOTE', { emoji: '🕛' }, t.order[0]); assert.equal(t.state.phase, 'playing');
});

test('placings: Gold + 50 per kill + Health, standing first', () => {
  const t = table(); const [a, b, c, d] = t.order;
  t.char(a).gold = 300; t.char(a).health = 50; t.char(b).kills = 3; t.char(b).health = 100; t.char(b).gold = 50; kill(t, c); t.char(c).gold = 999; t.char(d).gold = 0; t.char(d).health = 100;
  // dead but due to wake, c still stands and its Gold leads the table
  assert.equal(standing(t.state, c), true); assert.deepEqual(placings(t.state, B.gold, B.runs).map(r => r.playerId), [c, a, b, d]);
  // out of the run, c drops to the bottom whatever its score
  out(t, c); const p = placings(t.state, B.gold, B.runs);
  assert.deepEqual(p.map(r => [r.playerId, r.score, r.place]), [[a, 350, 1], [b, 300, 2], [d, 100, 3], [c, 999, 4]]);
  assert.equal(p[3].standing, false); assert.equal(standing(t.state, c), false);
});

test('royale: the circle closes every shrinkEveryRounds rounds toward the throne; outside it you bleed each turn; the Platter is for the last one standing', () => {
  const t = table({ mode: 'royale' }); const [a, b, c, d] = t.order;
  assert.deepEqual(royaleCenter(t.state), hex.parse(t.state.map.throne));
  const far = '3,0';   // six hexes from the throne at -3,0
  for (let i = 0; i < 12; i++) t.endTurn();   // three laps → round 4 → first shrink
  assert.equal(t.state.round, 4); assert.equal(t.state.royale.shrinks, 1); assert.equal(t.state.royale.radius, 5);
  assert.equal(t.state.map.hexes[far].outside, true); assert.equal(t.state.map.hexes['2,0'].outside, undefined);
  assert.equal(Object.values(t.state.map.hexes).filter(h => h.outside).length, hex.ring(hex.parse(t.state.map.throne), 6).filter(h => t.state.map.hexes[hex.key(h)]).length);
  const cur = t.cur(); t.place(cur, far); assert.equal(isOutside(t.state, t.char(cur)), true);
  const next = t.order[(t.order.indexOf(cur) + 1) % 4]; t.place(next, far);
  t.endTurn(); assert.equal(t.cur(), next); assert.equal(t.char(next).health, 100 - B.royale.outsideDamage, 'bled at the start of the turn outside');
  t.place(cur, '-3,0'); t.place(next, '-2,0');
  for (let i = 0; i < 12; i++) t.endTurn(); assert.equal(t.state.royale.shrinks, 2); assert.equal(t.state.royale.radius, 4);
  for (let i = 0; i < 60; i++) t.endTurn(); assert.equal(t.state.royale.radius, B.royale.minRadius, 'never closer than minRadius');
  // the Platter
  assert.equal(canUseChickenDinner(t.state, a), false);
  assert.throws(() => consumables.chickendinner(t.state, ctxOf(t), t.char(a)), /last one standing/);
  kill(t, b); kill(t, c); kill(t, d); assert.equal(canUseChickenDinner(t.state, a), false, 'the dead wake at the Graveyard: not yet the last one standing');
  for (const id of [b, c, d]) out(t, id);   // player kills in Royale eliminate
  assert.equal(canUseChickenDinner(t.state, a), true);
  t.char(a).health = 30; consumables.chickendinner(t.state, ctxOf(t), t.char(a));
  assert.equal(t.char(a).health, t.char(a).maxHealth); assert.equal(t.char(a).vaultBonus, 1);
  assert.equal(canUseChickenDinner(table().state, 'p0'), false, 'not in other modes');
});

test('vault and veterans: only after the run ends; survivors bank 3, the dead 1, the Platter adds one; only survivors return', () => {
  // VAULT_BANK / VETERAN_SAVE are roster.js's: the payload names the seat, vaulted items leave the character and
  // land on the roster mirror, the cap counts across calls, extraVault / vaultBonus widen it, and anyone who died
  // at any point in the run (deaths > 0) counts as dead.
  const t = table(); const [a, b, c] = t.order; const weapon = `${a}-weapon`;
  const extra = [makeItem({ id: 'x1', name: 'X1' }), makeItem({ id: 'x2', name: 'X2' }), makeItem({ id: 'x3', name: 'X3' })];
  for (const id of [a, b]) for (const it of extra) t.char(id).items[it.id] = structuredClone(it);
  assert.match(t.r.try('VAULT_BANK', { playerId: a, itemIds: ['x1'] }, a).message, /not in ended/);
  kill(t, b); t.char(c).deaths = 1; t.r.append('GM_END_RUN', { reason: 'the GM called it' }); assert.equal(t.state.phase, 'ended');
  assert.match(t.r.try('VAULT_BANK', { playerId: a, itemIds: ['x1', 'x2', 'x3', weapon] }, a).message, /you may vault 3 items/);
  assert.match(t.r.try('VAULT_BANK', { playerId: a, itemIds: ['x1', 'nope'] }, a).message, /not yours/);
  assert.match(t.r.try('VAULT_BANK', { playerId: b, itemIds: ['x1'] }, a).message, /cannot act/);
  t.r.append('VAULT_BANK', { playerId: a, itemIds: ['x1', weapon, 'x1'] }, a);
  assert.deepEqual(t.char(a).vaulted.map(i => i.id), ['x1', weapon], 'duplicates collapse; worn items count');
  assert.equal(t.char(a).items.x1, undefined); assert.equal(t.char(a).worn.mainhand, null, 'vaulted items leave the character');
  assert.deepEqual(t.state.roster[t.char(a).rosterId].vault.map(i => i.id), ['x1', weapon], 'the roster mirror carries the vault');
  t.r.append('VAULT_BANK', { playerId: a, itemIds: ['x2'] }, a); assert.equal(t.char(a).vaulted.length, 3, 'the cap counts across calls');
  assert.match(t.r.try('VAULT_BANK', { playerId: a, itemIds: ['x3'] }, a).message, /you may vault 3 items/);
  t.char(a).flags.extraVault = 1; t.r.append('VAULT_BANK', { playerId: a, itemIds: ['x3'] }, a); assert.equal(t.char(a).vaulted.length, 4, 'extraVault widens the cap');
  assert.match(t.r.try('VAULT_BANK', { playerId: b, itemIds: ['x1', 'x2'] }).message, /you may vault 1 item\b/);
  t.char(b).vaultBonus = 1; t.r.append('VAULT_BANK', { playerId: b, itemIds: ['x1', 'x2'] }); assert.equal(t.char(b).vaulted.length, 2, 'the Platter adds one');
  assert.match(t.r.try('VAULT_BANK', { playerId: c, itemIds: [`${c}-weapon`, 'x9'] }).message, /you may vault 1 item\b/, 'a death earlier in the run counts');
  t.r.append('VETERAN_SAVE', { playerId: a }, a); assert.equal(t.char(a).veteran, true);
  assert.equal(t.state.roster[t.char(a).rosterId].alive, true); assert.equal(t.state.roster[t.char(b).rosterId].alive, false);
  assert.match(t.r.try('VETERAN_SAVE', { playerId: b }).message, /did not survive/);
  assert.match(t.r.try('VETERAN_SAVE', { playerId: c }).message, /did not survive/);
});

test('hall of fame rows, tier cleared, the season counter and the roster rollover', () => {
  let t = table({ mode: 'pve', tier: 2 }); let [a, b, c, d] = t.order;
  t.state.monsters.the_dealer = { id: 'the_dealer', final: true, dead: true }; kill(t, d); t.char(a).kills = 2;
  t.r.append('EMOTE', { emoji: '🎉' }, a);
  assert.equal(t.state.phase, 'ended'); assert.equal(t.state.hallOfFame.length, 4); assert.equal(t.state.runRecorded, true);
  const rowA = t.state.hallOfFame.find(r => r.playerId === a), rowD = t.state.hallOfFame.find(r => r.playerId === d);
  assert.equal(rowA.tierCleared, 2); assert.equal(rowA.kills, 2); assert.equal(rowA.mode, 'pve'); assert.equal(rowA.survived, true); assert.equal(rowA.seasonId, 1);
  assert.equal(rowD.tierCleared, 2, 'PvE: the whole table clears when the Dealer dies'); assert.equal(rowD.survived, false); assert.equal(rowD.placing, 4);
  assert.deepEqual(t.state.season, { id: 1, nights: 1 });
  t.r.append('EMOTE', { emoji: '🎉' }, a); assert.equal(t.state.hallOfFame.length, 4, 'recorded once');
  // a GM-called run clears nothing; an ffa throne clears only for the winner
  t = table(); t.r.append('GM_END_RUN', {}); assert.ok(t.state.hallOfFame.every(r => r.tierCleared === 0));
  t = table(); [a] = t.order; t.state.throneReachedBy = a; t.r.append('EMOTE', { emoji: '👑' }, a);
  assert.equal(t.state.hallOfFame.find(r => r.playerId === a).tierCleared, 1); assert.equal(t.state.hallOfFame.filter(r => r.tierCleared).length, 1);
  // season end
  t = table({ balance: { runs: { seasonNights: 1 } } }); t.r.append('GM_END_RUN', {});
  assert.deepEqual(t.state.season, { id: 2, nights: 0 }); assert.equal(t.state.seasonEnded, true);
  const entry = { id: 'r1', name: 'Vex', level: 14, xp: 900, statPoints: 2, quests: ['q1'], pets: [{ id: 'pet' }], titles: ['Dealer Slayer'], worn: { mainhand: { id: 'w' } }, vault: ['x'], character: { level: 14, xp: 900, quests: ['q1'], pets: [{ id: 'pet' }], titles: ['t'], worn: { mainhand: { id: 'w' } } } };
  const rolled = seasonRollover(entry);
  assert.equal(rolled.level, 1); assert.equal(rolled.xp, 0); assert.deepEqual(rolled.quests, []); assert.equal(rolled.character.level, 1); assert.deepEqual(rolled.character.quests, []);
  assert.deepEqual(rolled.pets, entry.pets); assert.deepEqual(rolled.titles, entry.titles); assert.deepEqual(rolled.worn, entry.worn); assert.deepEqual(rolled.vault, entry.vault); assert.deepEqual(rolled.character.pets, entry.character.pets); assert.equal(rolled.seasonsPlayed, 1);
  assert.equal(entry.level, 14, 'the input is not mutated');
});

test('difficulty tiers: a veteran cannot drop below its level band, and a tier opens only once the one before is cleared', () => {
  const st = (tier) => ({ tier });
  assert.equal(tierAllowed(st(1), { level: 1 }, B.runs).ok, true);
  assert.equal(tierAllowed(st(1), { level: 7 }, B.runs).ok, true, 'level 7 is still band 1');
  const r8 = tierAllowed(st(1), { level: 8 }, B.runs); assert.equal(r8.ok, false); assert.match(r8.reason, /cannot enter tier 1/); assert.equal(r8.minTier, 2);
  assert.equal(tierAllowed(st(2), { level: 8, tierCleared: 1 }, B.runs).ok, true);
  assert.equal(tierAllowed(st(2), { level: 8, tierCleared: 0 }, B.runs).ok, false, 'tier 2 is locked until tier 1 is cleared');
  assert.equal(tierAllowed(st(3), { level: 20, tierCleared: 2 }, B.runs).ok, true);
  assert.equal(tierAllowed(st(3), { level: 20, tierCleared: 1 }, B.runs).ok, false);
  assert.equal(tierAllowed(st(3), { character: { level: 20, tierCleared: 3 } }, B.runs).ok, true, 'reads a nested character too');
  assert.equal(tierAllowed(st(1), {}, B.runs).ok, true, 'a fresh character');
});
