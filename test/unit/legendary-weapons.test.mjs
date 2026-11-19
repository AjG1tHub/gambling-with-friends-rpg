// The four Legendary weapons whose effect lives in the item round: Big Fancy Gun (its hex and the six neighbours),
// Corvette Broadside (a line), The Shout (a push) and The Joker (wild jokers in Video Poker, five of a kind is a
// double crit). Positions are written straight into the state on a small stub map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playingRoom, mkMonster, give, hit, makeRng, B, shared } from './_fixtures.mjs';
import { generateLegendary } from '../../packages/shared/characters/generator.js';
import { resolveHit, broadsideHexes } from '../../packages/shared/handlers/items.js';
import { startRound, vpWildKey, vpWildAdvice, isCrit, JOKER, FIVE_OF_A_KIND } from '../../packages/games/adapter.js';
import { vpKey } from '../../packages/games/legacy/games-table.js';

const { hex } = shared;
const L = B.legendaries;
const ctxOf = (r) => ({ now: r.now(), B: (g) => B[g], isGm: true, actor: 'tv', payload: {} });
const texts = (r, from = 0) => r.state.log.slice(from).map(l => l.text).join('\n');
// A blob of plain hexes around 0,0; everything outside it is off the map.
function mapOf(r, radius = 4) {
  const hexes = {};
  for (const h of hex.range({ q: 0, r: 0 }, radius)) { const key = hex.key(h); hexes[key] = { q: h.q, r: h.r, key, regionId: 'strip', type: 'plain', colour: 'Bone', void: false, gate: null, monsterId: null }; }
  r.state.map = { hexes, regions: { strip: { id: 'strip', name: 'Casino Strip', tier: 1, family: 'picks', hexKeys: Object.keys(hexes) } }, start: '0,0', revealed: { strip: true } };
  return r.state.map;
}
// The legendary with only its unique affix, so the rolled ones do not move the numbers.
function legendary(r, id) { const it = generateLegendary(r.state, id, { seed: 7 }); it.affixes = it.affixes.filter(a => a.kind === 'unique'); return it; }
function monster(r, id, pos, extra = {}) { const m = mkMonster({ id, name: id, pos, health: 500, ...extra }); r.state.monsters[id] = m; const h = r.state.map?.hexes[pos]; if (h) h.monsterId = id; return m; }
// A room whose current player is the wielder; `others` are the three other characters in seat order.
function setup(id, wear = 'mainhand') {
  const r = playingRoom(); mapOf(r);
  const c = r.curChar(), others = Object.values(r.state.characters).filter(x => x.id !== c.id);
  for (const x of Object.values(r.state.characters)) { x.pos = '0,0'; x.health = x.maxHealth = 400; }
  const item = give(c, legendary(r, id), { wear });
  return { r, st: r.state, c, others, item, pid: r.cur() };
}
const swing = (t, target, kind = 'character', mult = 2, extra = {}) => resolveHit(t.st, ctxOf(t.r), { attackerId: t.c.id, attackerKind: 'character', targetId: target.id, targetKind: kind, item: t.item, stake: t.item.stake, mult, label: 'WIN', ...extra });

test('Big Fancy Gun: a win hits every player and monster on the wielder\'s hex and the six neighbours with the same damage, and nobody beyond', () => {
  const t = setup('bigfancygun'); const [a, b, far] = t.others;
  assert.equal(t.item.stake, L.bigGunStake); assert.equal(t.item.kind, 'area');
  a.pos = '0,0'; b.pos = '1,0'; far.pos = '2,0';
  const near = monster(t.r, 'near', '0,1'), out = monster(t.r, 'out', '-2,0');
  const n0 = t.st.log.length, info = swing(t, a);
  assert.ok(info.payout > 0); assert.equal(info.damage, info.payout); assert.equal(a.health, 400 - info.payout);
  assert.equal(b.health, 400 - info.payout, 'the neighbour takes the same resolved damage');
  assert.equal(near.health, 500 - info.payout, 'so does the monster next door');
  assert.equal(far.health, 400); assert.equal(out.health, 500); assert.equal(t.c.health, 400, 'the wielder is not in their own blast');
  assert.deepEqual(info.splashed, [{ id: b.id, kind: 'character', damage: info.payout }, { id: 'near', kind: 'monster', damage: info.payout }]);
  assert.match(texts(t.r, n0), new RegExp(`Big Fancy Gun also hits ${b.name} — ${info.payout}`)); assert.match(texts(t.r, n0), /also hits near/);
  assert.equal(t.st.stats[t.pid].damageDealt, info.payout * 3); assert.equal(t.st.stats[t.pid].hits, 1);
  // a loss or a push catches nobody
  const before = [a.health, b.health, near.health]; const miss = swing(t, a, 'character', 0); assert.equal(miss.splashed, undefined); assert.equal(miss.loss, L.bigGunStake);
  swing(t, a, 'character', 1); assert.deepEqual([a.health, b.health, near.health], before);
});
test('Big Fancy Gun: kills in the blast go through the usual death paths, shields soak it, teammates are spared', () => {
  const t = setup('bigfancygun'); const [a, b, mate] = t.others;
  b.pos = '0,-1'; b.health = 1; mate.pos = '-1,0'; a.shield = 1000;
  t.st.players[t.pid].teamId = 'A'; t.st.players[mate.playerId].teamId = 'A'; t.st.players[a.playerId].teamId = 'B';
  const weak = monster(t.r, 'weak', '1,-1', { health: 3 });
  const kills = t.c.kills || 0, n0 = t.st.log.length; const info = swing(t, weak, 'monster');
  assert.ok(weak.dead, 'the primary target dies as usual');
  assert.ok(b.dead && b.health === 0, 'the splash kill is a real death'); assert.equal(t.c.kills, kills + 2); assert.match(texts(t.r, n0), new RegExp(`${b.name} falls to ${t.c.name}`));
  assert.equal(a.health, 400, 'a shield takes the splash'); assert.equal(a.shield, 1000 - info.payout);
  assert.equal(mate.health, 400, 'no friendly fire inside a team');
  // a monster killed by the splash is destroyed and credited
  const t2 = setup('bigfancygun'); const rat = monster(t2.r, 'rat', '1,0', { health: 2 }); const info2 = swing(t2, t2.others[0]);
  assert.ok(rat.dead); assert.match(texts(t2.r), /rat is destroyed by/); assert.equal(info2.splashed.find(x => x.id === 'rat').damage, 2, 'overkill is not counted');
});
test('Big Fancy Gun through AREA_OPEN / AREA_RESOLVE: the blast lands with nobody else on the hex; without positions only the target is hit', () => {
  const t = setup('bigfancygun'); const [a, b, far] = t.others;
  a.pos = '1,0'; b.pos = '0,1'; far.pos = '3,0'; const m = monster(t.r, 'm1', '-1,0');
  t.r.append('AREA_OPEN', { itemId: t.item.id }, t.pid);
  t.r.append('AREA_RESOLVE', { results: { [t.c.id]: { mult: 2, label: 'RED' } } }, t.pid);
  const dmg = 400 - a.health; assert.ok(dmg > 0); assert.equal(b.health, 400 - dmg); assert.equal(m.health, 500 - dmg); assert.equal(far.health, 400);
  assert.equal(t.st.area.results[t.c.id].damage, dmg * 3); assert.equal(t.item.charges, B.items.charges - 1);
  // no map, no positions: just the one hit
  const u = setup('bigfancygun'); u.st.map = null; for (const x of Object.values(u.st.characters)) x.pos = null;
  const info = swing(u, u.others[0]); assert.equal(info.splashed, undefined); assert.equal(u.others[1].health, 400);
});

test('Corvette Broadside: everyone in the three hexes straight ahead (wielder → target) takes the hit; off the line and past the range nobody does', () => {
  const t = setup('broadside'); const [a, b, side] = t.others;
  assert.ok(t.item.twoHand); assert.equal(L.broadsideRange, 3);
  a.pos = '1,0'; b.pos = '2,0'; side.pos = '0,1';
  const third = monster(t.r, 'third', '3,0'), fourth = monster(t.r, 'fourth', '4,0'), behind = monster(t.r, 'behind', '-1,0');
  assert.deepEqual(broadsideHexes(t.st, ctxOf(t.r), t.c, a), ['1,0', '2,0', '3,0']);
  const info = swing(t, a);
  assert.equal(a.health, 400 - info.payout); assert.equal(b.health, 400 - info.payout); assert.equal(third.health, 500 - info.payout);
  assert.equal(fourth.health, 500, 'range is three hexes'); assert.equal(behind.health, 500); assert.equal(side.health, 400); assert.equal(t.c.health, 400);
  assert.deepEqual(info.splashed.map(x => x.id), [b.id, 'third']);
  // the six directions, and a target that is off-axis (Long Arm reach) still gives a straight line through its first step
  assert.deepEqual(broadsideHexes(t.st, ctxOf(t.r), t.c, { pos: '0,-1' }), ['0,-1', '0,-2', '0,-3']);
  assert.deepEqual(broadsideHexes(t.st, ctxOf(t.r), t.c, { pos: '-1,1' }), ['-1,1', '-2,2', '-3,3']);
  const off = broadsideHexes(t.st, ctxOf(t.r), t.c, { pos: '2,-1' }); assert.equal(off.length, 3);
  assert.equal(hex.distance({ q: 0, r: 0 }, hex.parse(off[2])), 3); assert.equal(hex.dirIndex({ q: 0, r: 0 }, hex.parse(off[0])) >= 0, true);
});
test('Corvette Broadside on a shared hex: the shared hex only, or onward in the wielder\'s last move direction when the state has one', () => {
  const t = setup('broadside'); const [a, b, far] = t.others;
  far.pos = '4,0'; const ahead = monster(t.r, 'ahead', '2,0');
  t.st.moveSession = null;
  assert.deepEqual(broadsideHexes(t.st, ctxOf(t.r), t.c, a), ['0,0']);
  const info = swing(t, a);
  assert.equal(a.health, 400 - info.payout); assert.equal(b.health, 400 - info.payout, 'the other player on the shared hex is raked'); assert.equal(ahead.health, 500);
  // someone else's move session does not aim this gun; the wielder's own does (E is DIRS[1])
  t.st.moveSession = { charId: a.id, lastDir: 1 }; assert.deepEqual(broadsideHexes(t.st, ctxOf(t.r), t.c, a), ['0,0']);
  t.st.moveSession = { charId: t.c.id, lastDir: 1 }; assert.deepEqual(broadsideHexes(t.st, ctxOf(t.r), t.c, a), ['0,0', '1,0', '2,0', '3,0']);
  const info2 = swing(t, a); assert.equal(ahead.health, 500 - info2.payout); assert.equal(far.health, 400);
});
test('Corvette Broadside through ITEM_USE / ITEM_RESOLVE: the fight log and the round result list who else was hit', () => {
  const t = setup('broadside'); const [a, b] = t.others; a.pos = '0,1'; b.pos = '0,2';
  hit(t.r, { pid: t.pid, itemId: t.item.id, targetId: a.id, mult: 2, label: 'TRIPLE' });
  const f = t.st.fight, entry = f.log.at(-1);
  assert.equal(a.health, 400 - entry.damage); assert.equal(b.health, 400 - entry.damage);
  assert.deepEqual(entry.splashed, [{ id: b.id, kind: 'character', damage: entry.damage }]); assert.deepEqual(f.lastGame.result.splashed, entry.splashed);
  assert.equal(t.item.charges, B.items.charges - 1);
});

test('The Shout: a win pushes every adjacent player and monster two hexes straight away, stopping at the edge, void, blockers and monster hexes', () => {
  const t = setup('theshout', 'spell2'); const [a, b, c3] = t.others; const map = mapOf(t.r, 2);
  assert.equal(t.item.stake, L.shoutStake); assert.equal(t.item.slot, 'spell'); assert.equal(t.item.kind, 'attack'); assert.equal(L.shoutPush, 2);
  for (const k of ['3,0', '-2,0']) map.hexes[k] = { q: hex.parse(k).q, r: hex.parse(k).r, key: k, regionId: 'strip', type: k === '-2,0' ? 'blocker' : 'plain', void: false, gate: null, monsterId: null };
  map.hexes['3,0'].regionId = 'docks';
  a.pos = '1,0'; b.pos = '0,1'; c3.pos = '-1,0';                       // a: free run east · b: one hex then the map's edge · c3: a blocker behind
  const m = monster(t.r, 'm1', '0,-1'), boss = monster(t.r, 'boss', '1,-1', { boss: true }), gone = monster(t.r, 'gone', '-1,1'); gone.dead = true;
  const n0 = t.st.log.length; const info = swing(t, a);
  assert.equal(a.pos, '3,0'); assert.equal(a.region, 'docks'); assert.equal(b.pos, '0,2'); assert.equal(c3.pos, '-1,0');
  assert.equal(m.pos, '0,-2', 'the edge of the map stops the monster after one hex'); assert.equal(map.hexes['0,-1'].monsterId, null); assert.equal(map.hexes['0,-2'].monsterId, 'm1');
  assert.equal(boss.pos, '1,-1', 'a boss does not budge'); assert.equal(gone.pos, '-1,1');
  assert.equal(t.c.health, 400); assert.equal(t.c.pos, '0,0');
  assert.deepEqual(info.pushed.map(p => [p.id, p.from, p.to]), [[a.id, '1,0', '3,0'], [b.id, '0,1', '0,2'], ['m1', '0,-1', '0,-2']]);
  const log = texts(t.r, n0); assert.match(log, new RegExp(`The Shout throws ${a.name} back 2 hexes`)); assert.match(log, new RegExp(`throws ${b.name} back 1 hex\\b`)); assert.match(log, new RegExp(`${c3.name} is braced`));
  assert.equal(a.health, 400 - info.payout, 'the round\'s target takes the hit'); assert.equal(b.health, 400, 'the push itself deals no damage'); assert.equal(m.health, 500);
  // a hex a living monster holds stops the slide in front of it; void does too; players on the caster's own hex stay
  const u = setup('theshout', 'spell2'); const [x, y, z] = u.others; x.pos = '1,0'; y.pos = '0,1'; z.pos = '0,0';
  monster(u.r, 'wall', '3,0'); u.st.map.hexes['0,2'].void = true;
  swing(u, z); assert.equal(x.pos, '2,0'); assert.equal(y.pos, '0,1'); assert.equal(z.pos, '0,0');
});
test('The Shout: a loss costs the stake and moves nobody; through events the push is on the fight log', () => {
  const t = setup('theshout', 'spell2'); const [a] = t.others; a.pos = '1,0';
  const miss = swing(t, a, 'character', 0); assert.equal(miss.loss, L.shoutStake); assert.equal(t.c.health, 400 - L.shoutStake); assert.equal(a.pos, '1,0'); assert.equal(miss.pushed, undefined);
  swing(t, a, 'character', 1); assert.equal(a.pos, '1,0');
  hit(t.r, { pid: t.pid, itemId: t.item.id, targetId: a.id, mult: 3, label: '3 in a row' });
  assert.equal(a.pos, '3,0'); assert.deepEqual(t.st.fight.log.at(-1).pushed, [{ id: a.id, kind: 'character', from: '1,0', to: '3,0' }]); assert.equal(t.c.health, 400 - L.shoutStake);
});

const card = (s) => (s === 'JK' ? { ...JOKER } : { r: s.slice(0, -1), s: s.slice(-1) });
const hand = (str) => str.split(' ').map(card);
test('The Joker: jokers are wild in the hand evaluation; five of a kind needs one', () => {
  assert.deepEqual(vpWildKey(hand('K♠ K♥ K♦ K♣ JK')), { key: 'quads', five: true });
  assert.deepEqual(vpWildKey(hand('JK 7♠ 7♥ JK 7♦')), { key: 'quads', five: true });
  assert.deepEqual(vpWildKey(hand('A♠ K♠ Q♠ J♠ JK')), { key: 'royal', five: false });
  assert.deepEqual(vpWildKey(hand('9♥ 8♥ JK 6♥ 5♥')), { key: 'sf', five: false });
  assert.deepEqual(vpWildKey(hand('K♠ K♥ K♦ 4♣ JK')), { key: 'quads', five: false });
  assert.deepEqual(vpWildKey(hand('K♠ K♥ 4♦ 4♣ JK')), { key: 'fh', five: false });
  assert.deepEqual(vpWildKey(hand('2♥ 9♥ JK K♥ 5♥')), { key: 'flush', five: false });
  assert.deepEqual(vpWildKey(hand('5♠ 6♥ 7♦ 8♣ JK')), { key: 'straight', five: false });
  assert.deepEqual(vpWildKey(hand('K♠ K♥ 4♦ 9♣ JK')), { key: 'trips', five: false });
  assert.deepEqual(vpWildKey(hand('2♠ 7♥ 9♦ J♣ JK')), { key: 'jacks', five: false });
  assert.deepEqual(vpWildKey(hand('2♠ 7♥ 9♦ 10♣ JK')), { key: null, five: false }, 'a pair of tens still pays nothing');
  assert.deepEqual(vpWildKey(hand('2♠ 7♥ 9♦ JK JK')), { key: 'trips', five: false });
  for (const h of ['K♠ K♥ K♦ K♣ 2♠', 'A♠ K♠ Q♠ J♠ 10♠', '2♠ 7♥ 9♦ J♣ 4♠']) assert.deepEqual(vpWildKey(hand(h)), { key: vpKey(hand(h)), five: false }, 'no joker: the legacy reading');
  assert.deepEqual(vpWildAdvice(hand('2♠ 7♥ 9♦ JK 4♣')).includes(3), true, 'the advice never throws a joker away');
});
test('The Joker: its Video Poker round shuffles the jokers into the deck; any other Video Poker item plays the 52-card game', () => {
  const r = playingRoom(); const joker = legendary(r, 'thejoker'); assert.equal(joker.gameId, 'videopoker');
  const plain = startRound(null, { gameId: 'videopoker', rng: makeRng(5), stake: 10 });
  assert.equal(plain.wild, false); assert.equal(plain.g.secret.deck.length, 47); assert.ok(![...plain.g.view.cards, ...plain.g.secret.deck].some(c => c.joker));
  const round = startRound(null, { item: joker, rng: makeRng(5), stake: 10 });
  assert.equal(round.wild, true); const all = [...round.g.view.cards, ...round.g.secret.deck];
  assert.equal(all.length, 52 + L.jokerCount); assert.equal(all.filter(c => c.joker).length, L.jokerCount); assert.equal(round.g.view.cards.length, 5);
  assert.equal(new Set(all.filter(c => !c.joker).map(c => c.r + c.s)).size, 52, 'every real card exactly once');
  assert.ok(round.g.view.cards.every(c => c.t != null), 'the deal keeps its timings'); assert.ok(!JSON.stringify(round.snapshot()).includes('secret'));
  // four kings and a joker, all held: five of a kind, paid as four of a kind, a crit
  round.g.view.cards = hand('K♠ K♥ K♦ K♣ JK'); for (let i = 0; i < 5; i++) round.act('hold', { i });
  const res = round.act('draw'); const o = round.outcome(), odds = round.odds();
  assert.ok(res.done); assert.ok(o.label.startsWith(FIVE_OF_A_KIND)); assert.equal(o.mult, Number(odds.quads)); assert.equal(o.crit, true); assert.equal(round.g.view.five, true);
  assert.equal(isCrit('videopoker', odds, null, { mult: Number(odds.quads), label: 'Four of a kind — 25×' }), false, 'plain quads are not the top hand');
  // a joker rescues a hand the legacy reading calls nothing, and "suggest" holds it
  const r2 = startRound(null, { item: joker, rng: makeRng(9), stake: 10 }); r2.g.view.cards = hand('2♠ 7♥ JK J♣ 4♠'); r2.act('auto'); assert.equal(r2.g.view.held[2], true);
  r2.g.view.held = [true, true, true, true, true]; r2.act('draw'); assert.match(r2.outcome().label, /^Jacks or better .*jokers wild/); assert.equal(r2.outcome().mult, Number(r2.odds().jacks));
  // the bot always finishes a wild round, and over many deals the jokers show up
  let wilds = 0;
  for (let seed = 1; seed <= 150; seed++) { const b = startRound(null, { item: joker, rng: makeRng(seed), stake: 10 }); const out = b.play(makeRng(seed + 1000), seed % 2 === 0); assert.ok(out, `seed ${seed} settles`); if (/jokers wild/.test(out.label)) wilds++; }
  assert.ok(wilds > 0);
});
test('The Joker: a five-of-a-kind hit is a double crit in the payoff; four of a kind, or any other weapon, is not', () => {
  const t = setup('thejoker'); const m = monster(t.r, 'dummy', '0,0', { health: 100000 });
  const five = `${FIVE_OF_A_KIND} — 25× (jokers wild)`;
  const quads = swing(t, m, 'monster', 25, { label: 'Four of a kind — 25×', crit: false });
  const n0 = t.st.log.length; const dbl = swing(t, m, 'monster', 25, { label: five, crit: true });
  assert.equal(dbl.doubleCrit, true); assert.equal(dbl.payout, quads.payout * L.jokerCritMult); assert.equal(dbl.damage, dbl.payout); assert.match(texts(t.r, n0), /DOUBLE CRIT/);
  assert.ok(!quads.doubleCrit);
  const plain = { ...t.item, legendaryId: null }; const other = resolveHit(t.st, ctxOf(t.r), { attackerId: t.c.id, attackerKind: 'character', targetId: 'dummy', targetKind: 'monster', item: plain, stake: t.item.stake, mult: 25, label: five, crit: true });
  assert.equal(other.payout, quads.payout); assert.ok(!other.doubleCrit);
  const lost = swing(t, m, 'monster', 0, { label: five, crit: true }); assert.ok(!lost.doubleCrit); assert.equal(lost.damage, 0);
});
