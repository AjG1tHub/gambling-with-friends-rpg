// The phone's side-bet view (apps/phone/screens/sidebet.js): pure, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sideBetView, sideBetRecord } from '../../apps/phone/screens/sidebet.js';
import { room, names4 } from './_fixtures-characters.mjs';
import { playingRoom, charOf } from './_fixtures-characters.mjs';

test('sideBetView: nothing when off, when nothing is on, or when you are in it; the max follows Health and open bets', () => {
  const r = playingRoom({ balance: { social: { sideBetsOn: 1 } } }); const st = r.state; const [a, b, c] = st.seats;
  assert.equal(sideBetView(st, c), null, 'no fight or challenge: nothing to bet on');
  // A challenge between a and b.
  r.append('GM_GOLD', { playerId: a, amount: 60 }); r.append('GM_GOLD', { playerId: b, amount: 60 });
  r.append('CHALLENGE_CALL', { defenderId: b, call: 'wager', amount: 10 }, a);
  assert.ok(st.challenge, 'precondition: a challenge is open');
  assert.equal(sideBetView(st, a), null, 'the attacker cannot bet'); assert.equal(sideBetView(st, b), null, 'nor the defender');
  const v = sideBetView(st, c);
  assert.ok(v && v.kind === 'challenge' && v.sides.length === 2 && !v.placed && !v.spectator, JSON.stringify(v));
  assert.equal(v.max, Math.min(20, charOf(r, c).health - 1), 'max = sideBetMax or Health - 1');
  r.append('SIDE_BET', { challengeId: st.challenge.id, onId: a, amount: 7 }, c);
  const v2 = sideBetView(st, c); assert.equal(v2.placed, true); assert.equal(v2.mine.length, 1); assert.equal(v2.riding[a], 7);
  // A spectator sees it too, with no Health cap.
  r.append('PLAYER_JOIN', { playerId: 'spec', name: 'Watcher', deviceId: 'w', spectator: true }, 'system');
  const vs = sideBetView(st, 'spec'); assert.ok(vs && vs.spectator && vs.max === 20, JSON.stringify(vs));
  // Off tonight: nothing.
  st.balance.social.sideBetsOn = 0; assert.equal(sideBetView(st, c), null);
});

test('sideBetRecord: counts won, lost and void and nets the Health', () => {
  const st = { sideBets: [{ playerId: 'x', settled: true, won: true, amount: 5 }, { playerId: 'x', settled: true, won: false, amount: 3 }, { playerId: 'x', settled: true, won: null, amount: 9 }, { playerId: 'x', settled: false, won: null, amount: 9 }, { playerId: 'y', settled: true, won: true, amount: 1 }] };
  assert.deepEqual(sideBetRecord(st, 'x'), { won: 1, lost: 1, voided: 1, net: 2 });
});

import { ridingLine } from '../../packages/ui/stage.js';
test('ridingLine: totals open bets per side by name, monsters included; nothing when none are open', () => {
  const st = { players: { a: { name: 'Marrow' }, b: { name: 'Ox' } }, monsters: { m1: { name: 'Croupier' } }, sideBets: [{ refId: 'f1', onId: 'a', amount: 6 }, { refId: 'f1', onId: 'm1', amount: 3 }, { refId: 'f1', onId: 'a', amount: 2 }, { refId: 'f1', onId: 'b', amount: 1, settled: true }, { refId: 'f2', onId: 'b', amount: 9 }] };
  assert.equal(ridingLine(st, 'f1'), 'Side bets · 8 on Marrow · 3 on Croupier');
  assert.equal(ridingLine(st, 'nope'), null);
});
