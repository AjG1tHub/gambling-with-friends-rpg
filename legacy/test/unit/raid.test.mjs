import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, fixedRng, events, gold } from './_helpers.mjs';
const PT = await import('../../site/js/pets.js');
const PB = await import('../../site/js/petbattle.js');
const RD = await import('../../site/js/raid.js');

function table(n = 3, seed = 5) {
  const c = mkGame(['Aj', 'Nick', 'Sam', 'Lee', 'Kim', 'Pat', 'Max'].slice(0, n), seed);
  for (const p of c.players) PT.hatchEgg(c.config, c.state, c.rng, p, { free: true, speciesId: 'boulderox' });
  return c;
}
const start = (c, bossId = 'sewerking', ids = c.players.map(p => p.id), rng = c.rng) => RD.startRaid(c.config, c.state, rng, { playerIds: ids, bossId });
// play the raid out with a simple party plan
function playOut(c, plan = (me) => (me.hp / me.hpMax < 0.4 && me.mends > 0 ? 'mend' : 'element')) {
  let guard = 0;
  while (c.state.raid.phase === 'active' && guard++ < 600) { const me = RD.raidActor(c.state.raid); const r = RD.raidAction(c.config, c.state, c.rng, plan(me)); if (r.error) RD.raidAction(c.config, c.state, c.rng, 'strike'); }
  return c.state.raid;
}

test('a raid needs at least two healthy pets and a known boss', () => {
  const c = table(3);
  assert.equal(start(c, 'nope').error, true);
  assert.match(start(c, 'sewerking', [c.p.id]).text, /at least 2/);
  c.players[1].pets[0].fainted = true; c.players[2].pets = [];
  assert.match(start(c).text, /Nick, Sam can't fight/);
  assert.equal(c.state.raid, undefined);
});

test('party size is capped', () => {
  const c = table(7); assert.match(start(c).text, /At most 6/);
});

test('the boss scales with the party: +75% HP per extra pet, and more Mends', () => {
  const base = PB.previewFighter({}, { bossId: 'sewerking' }).hpMax;
  let c = table(2); start(c); assert.equal(c.state.raid.boss.hpMax, Math.round(base * 1.75)); assert.equal(c.state.raid.boss.mends, 1);
  c = table(4); start(c); assert.equal(c.state.raid.boss.hpMax, Math.round(base * 3.25)); assert.equal(c.state.raid.boss.mends, 2);
});

test('turn order: every party pet once per round, the boss once for every two pets', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const c = table(n); start(c); const o = c.state.raid.order;
    assert.equal(o.filter(x => x !== 'boss').length, n); assert.equal(new Set(o.filter(x => x !== 'boss')).size, n);
    assert.equal(o.filter(x => x === 'boss').length, Math.max(1, Math.ceil(n / 2)), `party of ${n}`);
  }
});

test('raid bosses include the normal bosses plus the raid-only ones', () => {
  const ids = RD.raidBossList({}).map(b => b.id);
  assert.ok(ids.includes('sewerking') && ids.includes('jackpothydra') && ids.includes('thehouse'));
  assert.ok(!PB.bossList({}).some(b => b.raidOnly));
});

test('only the pet whose turn it is may act, attacks land on the boss, and the turn moves on', () => {
  const c = table(3); start(c); const r = c.state.raid;
  const first = RD.raidActor(r); assert.equal(first.isBoss, false);
  const hp = r.boss.hp; RD.raidAction(c.config, c.state, fixedRng([(19 - 0.5) / 20, 0.5, 0.99, 0.99]), 'strike');
  assert.ok(r.boss.hp < hp); assert.notEqual(RD.raidActor(r)?.side, first.side);
  assert.equal(RD.raidAction(c.config, c.state, c.rng, 'dance').error, true);
});

test('an illegal move (Mend at full health) does not use up the turn', () => {
  const c = table(2); start(c); const who = RD.raidActor(c.state.raid).side;
  assert.equal(RD.raidAction(c.config, c.state, c.rng, 'mend').error, true); assert.equal(RD.raidActor(c.state.raid).side, who);
});

test('the boss prefers the most hurt pet but sometimes hits anyone; never a fainted one', () => {
  const c = table(3); start(c); const r = c.state.raid;
  r.party[0].hp = 1; r.party[1].hp = 0;
  assert.equal(RD.bossTarget(r, fixedRng([0.9])).side, r.party[0].side);                    // not the random branch → weakest living
  for (let i = 0; i < 200; i++) assert.notEqual(RD.bossTarget(r, c.rng).side, r.party[1].side);
  r.party.forEach(f => { f.hp = 0; }); assert.equal(RD.bossTarget(r, c.rng), null);
});

test('winning: everyone gets a Gold share, XP and a win; the boss win earns Power for each', () => {
  const c = table(3); start(c, 'sewerking'); const r = c.state.raid; r.boss.hp = 1;
  const me = RD.raidActor(r); RD.raidAction(c.config, c.state, fixedRng([(19 - 0.5) / 20, 0.5, 0.5]), 'strike');
  assert.deepEqual([r.phase, r.winner], ['done', 'party']);
  for (const p of c.players) { assert.equal(gold(p), 500 + 90); assert.equal(p.pets[0].wins, 1); assert.equal(p.pets[0].xp, 32); }      // 150 × 0.6; 20 + 6 × L2
  assert.equal(events(c.state, 'PET_BATTLE').filter(e => e.won && e.raid).length, 3);
  PT.accruePower(c.config, c.state); for (const p of c.players) assert.equal(PT.powerOf(p), PT.petRules(c.config).gain.bossWin);
});

test('losing: when the whole party faints the boss wins, nobody is paid, pets are left fainted', () => {
  const c = table(2); start(c, 'thehouse'); const r = c.state.raid; r.party.forEach(f => { f.hp = 1; });
  const out = playOut(c, () => 'guard');
  assert.deepEqual([out.phase, out.winner], ['done', 'boss']);
  for (const p of c.players) { assert.equal(gold(p), 500); assert.equal(p.pets[0].fainted, true); assert.equal(p.pets[0].losses, 1); }
  assert.equal(events(c.state, 'PET_BATTLE').filter(e => e.raid && !e.won).length, 1);
});

test('fainted pets are skipped in the turn order and the raid goes on', () => {
  const c = table(3); start(c); const r = c.state.raid; const down = r.party[1]; down.hp = 0;
  for (let i = 0; i < 12 && r.phase === 'active'; i++) { assert.notEqual(RD.raidActor(r).side, down.side); RD.raidAction(c.config, c.state, c.rng, 'guard').error && RD.raidAction(c.config, c.state, c.rng, 'strike'); }
});

test('raids always end, and a same-level party of three usually beats a normal boss', () => {
  let wins = 0; const N = 60;
  for (let i = 0; i < N; i++) {
    const c = table(3, 900 + i);
    for (const p of c.players) { const pet = p.pets[0]; PT.addXp(c.config, c.state, c.rng, p, pet, 50 * 4 * 3 / 2); pet.hp = pet.hpMax; }     // level 4 vs the L4 boss
    start(c, 'dunestinger'); const r = playOut(c);
    assert.equal(r.phase, 'done', `raid ${i} never ended`); if (r.winner === 'party') wins++;
  }
  assert.ok(wins / N > 0.3, `party win rate ${wins / N}`);
});

test('a raid and a 1-v-1 battle cannot run at the same time; clearing frees the table', () => {
  const c = table(3); start(c);
  assert.match(PB.startPetBattle(c.config, c.state, c.rng, { challengerId: c.p.id, bossId: 'sewerking' }).text, /already running/);
  assert.match(start(c).text, /already running/);
  assert.equal(RD.clearRaid(c.state), true); assert.equal(start(c).error, undefined);
});

test('duplicate player ids and unknown ids are ignored when building the party', () => {
  const c = table(3); const r = start(c, 'sewerking', [c.p.id, c.p.id, 'ghost', c.q.id]);
  assert.equal(r.error, undefined); assert.equal(c.state.raid.party.length, 2);
});
