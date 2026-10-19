// Encounters: FIGHT_START, the player ↔ monster alternation, MONSTER_ACT through the same payoff path, fights to the
// death (loot hook, kills, XP), fleeing, walking away at end of turn, GM takeover, and the monster Health ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playingRoom, mkMonster, makeItem, give, hit, B, shared, makeRng } from './_fixtures.mjs';
import { monsterHealth, playMonsterTurn, makeDummy, headlessCtx } from '../../packages/shared/handlers/fight.js';
import { lootHooks, deathHooks, levelHooks } from '../../packages/shared/hooks.js';
import { startRound } from '../../packages/games/adapter.js';

const err = (r, type, payload, actor) => { const e = r.try(type, payload, actor); assert.ok(e, `${type} should have been refused`); return e; };
const monsterWith = (r, games, extra = {}) => mkMonster({ id: 'm1', items: games.map((g, i) => makeItem(r.state, { gameId: g, seed: 100 + i })), ...extra });
const toTurn = (r, pid) => { let g = 0; while (r.cur() !== pid && g++ < 8) r.append('TURN_END', {}, r.cur()); };

test('FIGHT_START opens an encounter (or a training dummy) for the current player only; a second fight is refused until the first ends', () => {
  const r = playingRoom(); const pid = r.cur(), other = Object.keys(r.state.players).find(p => p !== pid);
  r.state.monsters.m1 = monsterWith(r, ['fifty']);
  err(r, 'FIGHT_START', { monsterId: 'm1' }, other); err(r, 'FIGHT_START', { monsterId: 'nope' }, pid);
  r.append('FIGHT_START', { monsterId: 'm1' }, pid);
  const f = r.state.fight; assert.equal(f.kind, 'encounter'); assert.equal(f.monsterId, 'm1'); assert.equal(f.playerId, pid); assert.equal(f.turn, 'player'); assert.equal(f.game, null); assert.ok(!f.done);
  err(r, 'FIGHT_START', { monsterId: 'm1' }, pid); err(r, 'FIGHT_START', { opponent: 'dummy' }, pid);
  r.append('FIGHT_END', {}, 'gm'); assert.equal(r.state.fight, null); assert.equal(r.state.lastFight.monsterId, 'm1');
  r.append('FIGHT_START', { opponent: 'dummy' }, pid); assert.ok(r.state.monsters.dummy && r.state.monsters.dummy.health === B.monsters.healthCommon); assert.equal(r.state.fight.monsterId, 'dummy');
  r.state.monsters.m2 = mkMonster({ id: 'm2', boss: true, health: B.monsters.healthBoss }); r.append('FIGHT_END', {}, 'gm'); r.append('FIGHT_START', { monsterId: 'm2' }, pid); assert.equal(r.state.fight.kind, 'boss');
  // an attack on a monster with no fight open opens one by itself
  r.append('FIGHT_END', {}, 'gm'); const c = r.curChar(); r.append('ITEM_USE', { itemId: r.itemOf(c, 'coinblade').id, targetId: 'm1', targetKind: 'monster' }, pid); assert.equal(r.state.fight.monsterId, 'm1');
});
test('monsterHealth floors at 0, caps at max and writes a ledger row per move', () => {
  const r = playingRoom(); const m = monsterWith(r, ['fifty']); r.state.monsters.m1 = m; const ctx = { now: 5, B: (g) => B[g] };
  assert.equal(monsterHealth(r.state, m, -25, 'test', ctx), -25); assert.equal(m.health, 35);
  assert.equal(monsterHealth(r.state, m, +100, 'heal', ctx), 25); assert.equal(m.health, 60);
  assert.equal(monsterHealth(r.state, m, -500, 'nuke', ctx), -60); assert.equal(m.health, 0);
  const rows = r.state.ledger.filter(x => x.kind === 'monsterHealth'); assert.equal(rows.length, 3); assert.deepEqual(rows.map(x => x.moved), [-25, 25, -60]); assert.equal(rows[0].monsterId, 'm1'); assert.equal(rows[0].ts, 5);
});
test('alternation: after ITEM_RESOLVE the monster acts (MONSTER_ACT by the TV or GM only), then the player again; spells are allowed between', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar(); r.state.monsters.m1 = monsterWith(r, ['fifty', 'dice']); const m = r.state.monsters.m1;
  r.append('FIGHT_START', { monsterId: 'm1' }, pid);
  err(r, 'MONSTER_ACT', { itemId: m.items[0].id, mult: 2 }, 'tv');                      // not the monster's turn
  hit(r, { pid, itemId: r.itemOf(c, 'coinblade').id, targetId: 'm1', targetKind: 'monster', mult: 2, label: 'WIN' });
  assert.equal(m.health, 50); assert.equal(r.state.fight.turn, 'monster');
  assert.match(err(r, 'ITEM_USE', { itemId: r.itemOf(c, 'loadeddice').id, targetId: 'm1', targetKind: 'monster' }, pid).message, /acting|one attack/);
  err(r, 'MONSTER_ACT', { itemId: m.items[0].id, mult: 2 }, pid);                      // a player cannot play the monster
  err(r, 'MONSTER_ACT', { itemId: m.items[0].id, mult: 'lots' }, 'tv');
  r.append('MONSTER_ACT', { itemId: m.items[0].id, mult: 2, label: 'WIN', stake: 10 }, 'tv');
  assert.equal(c.health, 90); assert.equal(r.state.fight.turn, 'player'); assert.equal(r.state.stats[pid].damageTaken, 10); assert.equal(r.state.fight.log.length, 2); assert.equal(r.state.fight.lastGame.attackerId, 'm1');
  // a monster miss costs the monster its stake
  r.state.fight.turn = 'monster'; r.append('MONSTER_ACT', { itemId: m.items[1].id, mult: 0, label: 'miss' }, 'gm'); assert.equal(m.health, 40); assert.equal(c.health, 90);
  // the player may still cast a spell on themselves this turn
  r.append('ITEM_USE', { itemId: r.itemOf(c, 'mend').id }, pid); r.append('ITEM_RESOLVE', { mult: 2, label: 'heal' }, pid); assert.equal(c.health, 100);
});
test('a full encounter to the death through events: the TV plays the monster headlessly with playMonsterTurn; loot, kills and XP follow', () => {
  const drops = [], xps = []; const onDrop = (s, ctx, info) => drops.push(info.monsterId); lootHooks.onDrop.push(onDrop); const onXp = (s, ctx, info) => xps.push(info); levelHooks.onXp.push(onXp);
  try {
    const r = playingRoom({ chars: [{ health: 400, maxHealth: 400 }, {}, {}, {}] }); toTurn(r, 'p0'); const c = r.char(0);
    const blade = give(c, makeItem(r.state, { baseId: 'coinblade', rarity: 'legendary', charges: 999 }), { wear: 'offhand' });
    r.state.monsters.m1 = monsterWith(r, ['fifty', 'underover7', 'chuckaluck'], { health: 90 }); const m = r.state.monsters.m1;
    r.append('FIGHT_START', { monsterId: 'm1' }, 'p0');
    const rng = makeRng(99), pick = makeRng(7); let rounds = 0;
    while (!r.state.fight.done && rounds++ < 200) {
      // the phone: play the item through the adapter, step, resolve
      const round = startRound({ B: (g) => B[g] }, { item: blade, mode: 'health', stake: blade.stake, attacker: c, target: m, rng, now: r.now() });
      r.append('ITEM_USE', { itemId: blade.id, targetId: 'm1', targetKind: 'monster' }, 'p0');
      r.append('ITEM_STEP', { game: round.snapshot(), text: 'ready' }, 'p0');
      const o = round.play(pick, true); r.append('ITEM_RESOLVE', { ...o, game: round.snapshot() }, 'p0');
      if (r.state.fight.done) break;
      assert.equal(r.state.fight.turn, 'monster');
      // the TV: play the monster's item headlessly and append the result
      const payload = playMonsterTurn(r.state, headlessCtx(r.state, r.now()), rng, { pick });
      assert.ok(payload && Number.isFinite(payload.mult) && payload.snapshot && !JSON.stringify(payload.snapshot).includes('secret'));
      r.append('MONSTER_ACT', payload, 'tv');
      if (!r.state.fight.done) { assert.equal(r.state.fight.turn, 'player'); assert.equal(c.usedThisTurn.attack, 0, 'a new combat turn'); }
    }
    assert.ok(r.state.fight.done, 'the fight ended'); assert.ok(rounds < 200);
    if (r.state.fight.result === 'won') { assert.ok(m.dead && m.health === 0); assert.deepEqual(drops, ['m1']); assert.equal(c.kills, 1); assert.equal(r.state.stats.p0.kills, 1); assert.ok(xps.some(x => x.why === 'ko' && x.amount === B.xp.ko) && xps.some(x => x.why === 'hit' || x.why === 'crit')); }
    const kinds = new Set(r.state.ledger.map(x => x.kind)); assert.ok(kinds.has('monsterHealth') && kinds.has('health'));
    assert.ok(r.state.fight.log.length >= 2 && r.state.fight.log.some(l => l.by === 'm1'));
    assert.ok(r.state.log.some(l => /hits|misses/.test(l.text)));
  } finally { lootHooks.onDrop.splice(lootHooks.onDrop.indexOf(onDrop), 1); levelHooks.onXp.splice(levelHooks.onXp.indexOf(onXp), 1); }
});
test('to the death: a player at 0 loses the fight and is dead; a monster at 0 is destroyed with a boss paying boss XP', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar(); c.health = 12;
  r.state.monsters.m1 = monsterWith(r, ['fifty']); const m = r.state.monsters.m1;
  r.append('FIGHT_START', { monsterId: 'm1' }, pid); hit(r, { pid, itemId: r.itemOf(c, 'coinblade').id, targetId: 'm1', targetKind: 'monster', mult: 2 });
  r.append('MONSTER_ACT', { itemId: m.items[0].id, mult: 3, label: 'WIN' }, 'tv');
  assert.ok(c.dead && c.health === 0 && c.diedTo === 'monster'); assert.ok(r.state.fight.done && r.state.fight.result === 'lost'); assert.equal(r.state.stats[pid].deaths, 1);
  // a lost stake can also kill you: dying to your own miss is the minor (monster) penalty
  const r2 = playingRoom(); const p2 = r2.cur(), c2 = r2.curChar(); c2.health = 10; r2.state.monsters.m1 = monsterWith(r2, ['fifty']);
  r2.append('FIGHT_START', { monsterId: 'm1' }, p2); hit(r2, { pid: p2, itemId: r2.itemOf(c2, 'coinblade').id, targetId: 'm1', targetKind: 'monster', mult: 0 });
  assert.ok(c2.dead && c2.diedTo === 'monster'); assert.ok(r2.state.fight.done);
  // boss kill
  const r3 = playingRoom(); const p3 = r3.cur(), c3 = r3.curChar(); r3.state.monsters.b = mkMonster({ id: 'b', boss: true, health: 5, items: [makeItem(r3.state, { gameId: 'fifty' })] });
  r3.append('FIGHT_START', { monsterId: 'b' }, p3); hit(r3, { pid: p3, itemId: r3.itemOf(c3, 'coinblade').id, targetId: 'b', targetKind: 'monster', mult: 2 });
  assert.ok(r3.state.monsters.b.dead); assert.equal(r3.state.fight.result, 'won'); assert.ok(c3.level >= 2 || c3.xp === B.xp.hit + B.xp.boss, 'boss XP was granted (the characters module levels the character)'); assert.equal(r3.state.stats[p3].bosses, 1);
  assert.match(err(r3, 'MONSTER_ACT', { itemId: 'x', mult: 2 }, 'tv').message, /no fight/);
});
test('FIGHT_FLEE: only between rounds on the player\'s turn, never when called out; TURN_END mid-fight hands the monster a parting blow, after which the player has walked away', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar(); r.state.monsters.m1 = monsterWith(r, ['fifty']); const m = r.state.monsters.m1;
  err(r, 'FIGHT_FLEE', {}, pid);
  r.append('FIGHT_START', { monsterId: 'm1' }, pid);
  r.append('ITEM_USE', { itemId: r.itemOf(c, 'coinblade').id, targetId: 'm1', targetKind: 'monster' }, pid);
  assert.match(err(r, 'FIGHT_FLEE', {}, pid).message, /finish the round/);
  r.append('ITEM_RESOLVE', { mult: 1, label: 'push' }, pid);
  assert.match(err(r, 'FIGHT_FLEE', {}, pid).message, /monster is acting/);
  r.append('MONSTER_ACT', { itemId: m.items[0].id, mult: 1, label: 'push' }, 'tv');
  const other = Object.keys(r.state.players).find(p => p !== pid); err(r, 'FIGHT_FLEE', {}, other);
  r.state.fight.calledOut = true; assert.match(err(r, 'FIGHT_FLEE', {}, pid).message, /called out/); r.state.fight.calledOut = false;
  r.append('FIGHT_FLEE', {}, pid); assert.ok(r.state.fight.done && r.state.fight.fled && r.state.fight.result === 'fled');
  err(r, 'FIGHT_END', {}, other); r.append('FIGHT_END', {}, pid); assert.equal(r.state.fight, null);
  // walking away: end the turn with the fight open → the monster gets a blow → the fight is over as 'left'
  const r2 = playingRoom(); const p = r2.cur(), ch = r2.curChar(); r2.state.monsters.m1 = monsterWith(r2, ['fifty']); const mm = r2.state.monsters.m1;
  r2.append('FIGHT_START', { monsterId: 'm1' }, p); hit(r2, { pid: p, itemId: r2.itemOf(ch, 'coinblade').id, targetId: 'm1', targetKind: 'monster', mult: 2 });
  r2.append('MONSTER_ACT', { itemId: mm.items[0].id, mult: 0, label: 'miss' }, 'tv');
  r2.append('TURN_END', {}, p);
  assert.ok(r2.state.fight && !r2.state.fight.done && r2.state.fight.turn === 'monster' && r2.state.fight.passed);
  const next = r2.cur(); assert.notEqual(next, p);
  assert.match(err(r2, 'ITEM_USE', { itemId: r2.itemOf(r2.curChar(), 'coinblade').id, targetId: 'm1', targetKind: 'monster' }, next).message, /someone else/);
  r2.append('MONSTER_ACT', { itemId: mm.items[0].id, mult: 2, label: 'WIN' }, 'tv');
  assert.equal(ch.health, 90); assert.ok(r2.state.fight.done && r2.state.fight.result === 'left');
  r2.append('TURN_END', {}, next); assert.equal(r2.state.fight, null, 'a finished fight is cleared at the next end of turn');
  // a solo (PvP) fight is spent at the end of the turn too
  const r3 = playingRoom(); const p3 = r3.cur(), c3 = r3.curChar(), t3 = r3.char(p3 === 'p0' ? 1 : 0);
  hit(r3, { pid: p3, itemId: r3.itemOf(c3, 'coinblade').id, targetId: t3.id, mult: 2 }); assert.equal(r3.state.fight.kind, 'solo'); r3.append('TURN_END', {}, p3); assert.equal(r3.state.fight, null);
});
test('GM_TAKEOVER flags a monster; MONSTER_ACT then records the GM\'s pick; playMonsterTurn picks only attack-kind items and honours a forced item', () => {
  const r = playingRoom(); const pid = r.cur(), c = r.curChar();
  r.state.monsters.m1 = monsterWith(r, ['hilo', 'fifty', 'roulette']); const m = r.state.monsters.m1; m.items[0].kind = 'spell'; m.items[2].kind = 'area';
  err(r, 'GM_TAKEOVER', { monsterId: 'm1', on: true }, pid);
  r.append('GM_TAKEOVER', { monsterId: 'm1', on: true }, 'gm'); assert.ok(m.gmControlled);
  r.append('FIGHT_START', { monsterId: 'm1' }, pid); hit(r, { pid, itemId: r.itemOf(c, 'coinblade').id, targetId: 'm1', targetKind: 'monster', mult: 2 });
  for (let i = 0; i < 20; i++) { const p = playMonsterTurn(r.state, { now: r.now() }, makeRng(i)); assert.equal(p.itemId, m.items[1].id, 'spells and area items are not monster moves'); }
  const forced = playMonsterTurn(r.state, headlessCtx(r.state, r.now()), makeRng(3), { itemId: m.items[1].id }); assert.equal(forced.itemId, m.items[1].id);
  r.append('MONSTER_ACT', { ...forced, gmPick: 'spin' }, 'gm'); assert.equal(r.state.fight.log.at(-1).gmPick, 'spin');
  r.append('GM_TAKEOVER', { monsterId: 'm1', on: false }, 'gm'); assert.ok(!m.gmControlled);
  assert.equal(playMonsterTurn(r.state, { now: 0 }, makeRng(1)), null, 'nothing to do on the player\'s turn');
  const d = makeDummy(r.state, { B: (g) => B[g] }, { id: 'd2', health: 10 }); assert.equal(d.health, 10); assert.ok(r.state.monsters.d2.dummy);
});
test('a monster\'s stats drive its levers: a Nerve-10 monster with a Fuse Bomb crashes later than a Nerve-1 one (paired dice)', () => {
  const r = playingRoom(); const c = r.char(0); let hi = 0, lo = 0; const n = 2000;
  for (let i = 0; i < n; i++) {
    for (const [v, acc] of [[10, 'hi'], [1, 'lo']]) {
      const m = mkMonster({ id: 'm', stats: { luck: 3, nerve: v, greed: 3, grit: 3 }, items: [makeItem(r.state, { gameId: 'crash', seed: 1 })] });
      const round = startRound({ B: (g) => B[g] }, { item: m.items[0], stake: 10, attacker: m, target: c, rng: makeRng(500 + i), now: 0 });
      round.act('launch', { target: 2 }); if (acc === 'hi') hi += round.result.mult; else lo += round.result.mult;
    }
  }
  assert.ok(hi > lo + n * 0.05, `${hi / n} vs ${lo / n}`);
});
