// Regression tests for the 2 Nov 2026 QA pass (docs/PROGRESS.md): the pure parts of four UI fixes. Plain Node, no DOM.
//   1. the phone's item icon URL never points at the paper-doll sheet (/worn/<id>.png 404'd)
//   2. the odds sentence quotes the odds table's own Win chance row (it printed 51% under a 50% row)
//   3. a wheel-game round's result is held back until its wheel lands (TV fight panel, log, ticker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iconUrl } from '../../apps/phone/screens/prompts.js';
import { winLine } from '../../packages/ui/lever.js';
import { leverView, oddsLines } from '../../packages/games/lever-view.js';
import curves from '../../data/lever-curves.json' with { type: 'json' };
import { roundWheelHolding } from '../../packages/ui/stage.js';
import { visibleLog } from '../../apps/tv/screens/play.js';
import { WHEEL_SPIN_MS } from '../../packages/ui/sound.js';

test('iconUrl: an item whose sprite key is worn/<id> still gets an icon path, never /worn/', () => {
  const weapon = { id: 'i1', baseId: 'coinblade', gameId: 'fifty', slot: 'mainhand', sprite: 'worn/coinblade' };
  assert.equal(iconUrl(weapon), '/items/coinblade.png');
  assert.ok(!iconUrl({ ...weapon, sprite: 'worn/loadeddice', baseId: 'loadeddice' }).includes('/worn/'));
  assert.equal(iconUrl({ id: 'c1', baseId: 'potion', slot: 'consumable', sprite: 'consumables/potion' }), '/consumables/potion.png');
  assert.equal(iconUrl({ id: 'x', slot: 'egg', baseId: 'egg' }), '/consumables/egg.png');
  assert.equal(iconUrl({ id: 'g7', gameId: 'mend' }), '/items/mend.png', 'no baseId: the game id, then the item id');
  assert.ok(!iconUrl(null).includes('/worn/'), 'no item at all must not throw');
});

test('winLine: the sentence quotes the table row (50% / 58%), not the simulated 51% / 59%', () => {
  const v = leverView('fifty', 7);
  assert.ok(v.base.win !== 0.5, 'precondition: the curve carries a simulated win rate that is not the nominal 50%');
  const rows = oddsLines('fifty', 7);
  const text = winLine(v, rows);
  const row = rows.find(r => /^win chance$/i.test(r.label));
  assert.ok(text.includes(`Wins ${row.yours} of rounds`), text);
  assert.ok(text.includes(`(${row.base} at neutral)`), text);
  assert.ok(text.includes('(50% at neutral)'), text);
});

test('winLine: with no Win chance row it falls back to the curve, and every game agrees with its own table', () => {
  const v = leverView('fifty', 7);
  assert.match(winLine(v, []), /Wins 59% of rounds at your luck \(51% at neutral\)/);
  assert.match(winLine(v, undefined), /Wins 59%/);
  for (const id of Object.keys(curves.games)) {
    const view = leverView(id, curves.neutral + 2); if (!view) continue;
    const rows = oddsLines(id, curves.neutral + 2);
    const row = rows.find(r => /^win chance$/i.test(r.label));
    const text = winLine(view, rows);
    if (row) assert.ok(text.includes(row.yours) && text.includes(row.base), `${id}: ${text} vs table ${row.base} → ${row.yours}`);
    else assert.match(text, /Wins \d+% of rounds/, id);
  }
});

// A fight state with one landed wheel round: result already in the state, the wheel still turning on the TV.
const wheelRound = (t) => ({ fight: { done: false, game: null, lastGame: { itemId: 'w' + t, startedTs: t, attackerId: 'm1', gameId: 'fifty', result: { mult: 0, loss: 6, label: 'LOSE' }, legacy: { spin: { outcomes: ['WIN', 'LOSE'], index: 1 } } } } });

test('roundWheelHolding: holds from the first look until the spin plus 4 s, then lets go', () => {
  const t = 1_800_000_000_000, state = wheelRound(t);
  assert.equal(roundWheelHolding(state, t), t, 'holds, and reports the round start so later log lines can be held');
  assert.equal(roundWheelHolding(state, t + WHEEL_SPIN_MS), t, 'still holding when the spin ends (the overlay marks it landed)');
  assert.equal(roundWheelHolding(state, t + WHEEL_SPIN_MS + 4001), null, 'gives up eventually: a stuck wheel must not hide the log forever');
});

test('roundWheelHolding: nothing to hold when there is no result yet, no wheel, or no fight', () => {
  const t = 1_800_000_100_000;
  assert.equal(roundWheelHolding({}, t), null);
  assert.equal(roundWheelHolding({ fight: { done: false, lastGame: null, game: null } }, t), null);
  const noResult = wheelRound(t + 1); noResult.fight.lastGame.result = null;
  assert.equal(roundWheelHolding(noResult, t), null, 'no result yet: nothing to spoil');
  const noWheel = wheelRound(t + 2); noWheel.fight.lastGame.legacy = { view: {} };
  assert.equal(roundWheelHolding(noWheel, t), null, 'a non-wheel game has no spin to wait for');
  const noSnap = wheelRound(t + 3); noSnap.fight.lastGame.legacy = null;
  assert.equal(roundWheelHolding(noSnap, t), null, 'a bot\'s headless round has no snapshot');
});

test('visibleLog: lines logged at or after a holding round start are hidden; earlier ones stay', () => {
  const t = 1_800_000_200_000, state = wheelRound(t);
  state.log = [{ ts: t - 5000, text: 'Samson misses with Coin Blade', kind: '' }, { ts: t, text: 'Drunk Croupier misses with Coin Blade: LOSE — loses 6', kind: '' }, { ts: t + 10, text: 'later line', kind: '' }];
  const held = visibleLog(state, t + 100).map(l => l.text);
  assert.deepEqual(held, ['Samson misses with Coin Blade'], 'the monster\'s result and anything after wait for the wheel');
  const later = visibleLog(state, t + WHEEL_SPIN_MS + 4500).map(l => l.text);
  assert.equal(later.length, 3, 'after the window everything shows');
});

// 4. A seat the TV proxied for silence is the phone's to take back; one the GM took on purpose is not.
import { shouldReclaimSeat } from '../../packages/shared/handlers/lobby.js';
import { room, names4 } from './_fixtures-characters.mjs';
test('shouldReclaimSeat: only a seat proxied for silence, and PLAYER_RECONNECT clears it', () => {
  const r = room().join(names4); const pid = 'p0';
  assert.equal(shouldReclaimSeat(r.state, pid), false, 'not proxied: nothing to reclaim');
  r.append('GM_PROXY', { playerId: pid, on: true }, 'gm');
  assert.equal(shouldReclaimSeat(r.state, pid), false, 'the GM chose to act for the seat: the phone waits for the hand-back');
  r.append('GM_PROXY', { playerId: pid, on: false }, 'gm');
  r.append('GM_PROXY', { playerId: pid, on: true, reason: 'silent' }, 'system');
  assert.equal(r.state.gm.proxyReasons[pid], 'silent');
  assert.equal(shouldReclaimSeat(r.state, pid), true, 'proxied for silence: the phone may take it back');
  r.append('PLAYER_RECONNECT', { playerId: pid }, pid);
  assert.equal(r.state.players[pid].proxied, false); assert.equal(r.state.gm.proxyReasons[pid], undefined);
  assert.equal(shouldReclaimSeat(r.state, pid), false);
  assert.equal(shouldReclaimSeat(r.state, 'nobody'), false);
});

// 5. The GM nav's TV pill.
import { tvStatus } from '../../packages/ui/presence.js';
test('tvStatus: no TV, live, dropped', () => {
  const now = 1_800_000_300_000;
  assert.deepEqual(tvStatus(0, now), { cls: 'bad', text: 'No TV' });
  assert.deepEqual(tvStatus(now - 4000, now), { cls: 'ok', text: 'TV live' });
  assert.deepEqual(tvStatus(now - 60000, now), { cls: 'bad', text: 'TV dropped 60s ago' });
});
