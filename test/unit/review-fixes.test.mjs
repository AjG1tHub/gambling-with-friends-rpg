// Fixes from the independent review of the 18–19 Nov work (see docs/PROGRESS.md). Each test is the reviewer's scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table, shared } from './_fixtures-social.mjs';
import { damageHooks, legendaryEffects } from '../../packages/shared/hooks.js';
import { tableBusiness } from '../../apps/phone/screens/table.js';

const ctxOf = (t) => ({ now: t.r.now(), B: (g) => shared.group(t.state, g), isGm: false, actor: 'x', payload: {} });

test('a spectator can side-bet while the table is still in its tutorial turns', () => {
  const t = table({ ramp: true, balance: { social: { sideBetsOn: 1 } } }); const [a, b] = t.order;
  t.r.append('PLAYER_JOIN', { playerId: 'spec', name: 'Watcher', deviceId: 'w', spectator: true }, 'system');
  t.state.challenge = { id: 'ch1', attackerId: a, defenderId: b, done: false };
  const e = t.r.try('SIDE_BET', { challengeId: 'ch1', onId: a, amount: 3 }, 'spec');
  assert.notEqual(e?.code, 'locked', `a spectator has no turns to wait for (${e?.message || 'accepted'})`);
  assert.equal(t.r.try('SIDE_BET', { challengeId: 'ch1', onId: a, amount: 3 }, t.order[2])?.code, 'locked', 'a seated player on turn 1 still waits');
});

test('Nerve\'s free re-stake gives back only what another refund has not already returned', () => {
  const t = table(); const [a] = t.order; const c = t.char(a); c.stats.nerve = 9; c.freeRestakeUsed = false; c.health = 60; c.maxHealth = 200;
  const run = (info) => { for (const h of damageHooks.afterMiss) h(t.state, ctxOf(t), info); };
  // A miss another hook fully refunded (a Rail Lance push): Nerve adds nothing and is not spent.
  run({ attackerId: c.id, attackerKind: 'character', targetId: 'm', targetKind: 'monster', lost: 0, loss: 35, refunded: 35, notes: [] });
  assert.equal(c.health, 60, 'no second refund'); assert.equal(c.freeRestakeUsed, false, 'and the re-stake is still in hand');
  // A plain miss: the whole stake comes back, once.
  run({ attackerId: c.id, attackerKind: 'character', targetId: 'm', targetKind: 'monster', loss: 20, notes: [] });
  assert.equal(c.health, 80); assert.equal(c.freeRestakeUsed, true);
});

test('the Spiny Blue Carapace kills a leader it drops to zero', () => {
  const t = table(); const [a, b] = t.order; t.until(a); const ca = t.char(a), cb = t.char(b);
  cb.gold = 999; cb.health = 5; ca.activeUses ||= {}; ca.effects ||= []; ca.flags ||= {};
  legendaryEffects.carapace.onUse(t.state, { ...ctxOf(t), isGm: true }, ca, {}, null);
  assert.equal(cb.dead, true, 'zero Health from the shell is a death, with its drops and missed turns');
});

test('trades: one open offer per item; an unanswered offer lapses at the offerer\'s next turn end, or when a seat is kicked', () => {
  const t = table(); const [a, b, c] = t.order; t.until(a); const ca = t.char(a);
  const it = Object.values(ca.items).find(x => !Object.values(ca.worn || {}).some(w => w && w.id === x.id)) || (() => { ca.items.z1 = { id: 'z1', name: 'Trinket', slot: 'ring', rarity: 'common' }; return ca.items.z1; })();
  t.r.append('TRADE_OFFER', { toId: b, give: { itemIds: [it.id] }, want: {} }, a);
  assert.match(t.r.try('TRADE_OFFER', { toId: c, give: { itemIds: [it.id] }, want: {} }, a).message, /already on offer/);
  t.endTurn(); assert.equal(t.state.trades.at(-1).status, 'offered', 'still open after the turn it was made on');
  t.until(a); t.endTurn(); assert.equal(t.state.trades.at(-1).status, 'expired', 'lapsed at the offerer\'s next turn end');
  assert.equal(tableBusiness(t.state, b).incoming.length, 0); assert.equal(tableBusiness(t.state, a).outgoing.length, 0);
  t.until(a); t.r.append('TRADE_OFFER', { toId: b, give: { itemIds: [it.id] }, want: {} }, a);
  t.r.append('GM_KICK', { playerId: b }, 'gm'); t.endTurn();
  assert.equal(t.state.trades.at(-1).status, 'expired', 'an offer to a kicked seat does not linger');
});
