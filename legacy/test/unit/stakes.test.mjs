import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame, events } from './_helpers.mjs';
const ST = await import('../../site/js/stakes.js');

test('adding a stake records it with the named players and never touches balances', () => {
  const c = mkGame(); const before = JSON.stringify(c.players.map(p => p.balances));
  const r = ST.addStake(c.state, { text: ' loser buys pizza ', playerIds: [c.p.id, c.q.id, c.p.id, 'ghost'] });
  assert.equal(r.stake.text, 'loser buys pizza'); assert.deepEqual(r.stake.playerIds, [c.p.id, c.q.id]);
  assert.equal(r.stake.settled, false);
  assert.equal(JSON.stringify(c.players.map(p => p.balances)), before);
  assert.equal(events(c.state, 'STAKE').length, 1);
});

test('an empty stake is rejected', () => {
  const c = mkGame(); assert.equal(ST.addStake(c.state, { text: '   ' }).error, true); assert.equal(c.state.stakes.length, 0);
});

test('settling names a winner once; reopening clears it', () => {
  const c = mkGame(); const { stake } = ST.addStake(c.state, { text: 'dishes', playerIds: [c.p.id, c.q.id] });
  const r = ST.settleStake(c.state, stake.id, { winnerId: c.q.id, note: 'paid' });
  assert.match(r.text, /Nick wins/); assert.equal(stake.settled, true); assert.equal(stake.winnerId, c.q.id);
  assert.equal(ST.settleStake(c.state, stake.id).error, true);
  assert.equal(ST.openStakes(c.state).length, 0);
  ST.reopenStake(c.state, stake.id);
  assert.deepEqual([stake.settled, stake.winnerId, stake.note], [false, null, '']);
  assert.equal(ST.reopenStake(c.state, stake.id).error, true);
  assert.deepEqual(events(c.state, 'STAKE_SETTLED').map(e => e.playerId), [c.q.id]);
});

test('settling without a winner, or with an unknown one, just marks it settled', () => {
  const c = mkGame(); const { stake } = ST.addStake(c.state, { text: 'x' });
  ST.settleStake(c.state, stake.id, { winnerId: 'ghost' });
  assert.equal(stake.settled, true); assert.equal(stake.winnerId, null);
});

test('unknown stake ids are reported', () => {
  const c = mkGame(); assert.equal(ST.settleStake(c.state, 'nope').error, true); assert.equal(ST.reopenStake(c.state, 'nope').error, true);
});

test('old saves ({ts, text, settled}) are upgraded in place and keep unique ids', () => {
  const c = mkGame(); c.state.stakes = [{ ts: 5, text: 'old one', settled: false }, { ts: 5, text: 'old two', settled: true }];
  const s = ST.normalizeStakes(c.state);
  assert.equal(new Set(s.map(x => x.id)).size, 2); assert.deepEqual(s[0].playerIds, []);
  assert.equal(ST.openStakes(c.state).length, 1);
  assert.equal(ST.settleStake(c.state, s[0].id).error, undefined);
});

test('stakeLine reads naturally for open and settled stakes', () => {
  const c = mkGame(); const { stake } = ST.addStake(c.state, { text: 'loser buys pizza', playerIds: [c.p.id, c.q.id] });
  assert.equal(ST.stakeLine(c.state, stake), 'Aj vs Nick — loser buys pizza');
  ST.settleStake(c.state, stake.id, { winnerId: c.p.id });
  assert.equal(ST.stakeLine(c.state, stake), 'Aj vs Nick — loser buys pizza (Aj won)');
  const solo = ST.addStake(c.state, { text: 'first to jail does a shot' }).stake;
  assert.equal(ST.stakeLine(c.state, solo), 'first to jail does a shot');
});
