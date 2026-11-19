// REVIVE (handlers/revive.js): a Shop revive for Gold with the Grit discount, a Phoenix Feather revive at the
// Graveyard in PvE-only and Teams, and the phone's option list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table, shared } from './_fixtures-social.mjs';
import { revivePrice, reviveOptions } from '../../packages/shared/handlers/revive.js';

const kill = (t, pid) => { const c = t.char(pid); c.dead = true; c.missTurns = 2; c.graveyardPos = c.graveyardPos || c.pos; c.health = 0; };
const shopHex = (t, key) => { t.state.map.hexes[key].type = 'shop'; };

test('Shop revive: costs shop.revive Gold, cheaper with Grit (never under half), wakes the dead at once', () => {
  const t = table({ gold: 300 }); const [a, b] = t.order; t.until(a);
  const ca = t.char(a); const base = shared.group(t.state, 'shop').revive;
  ca.stats.grit = 3; assert.equal(revivePrice(t.state, ca), base);
  ca.stats.grit = 7; assert.equal(revivePrice(t.state, ca), Math.round(base * 0.8), '4 points over neutral: 20% off');
  ca.stats.grit = 99; assert.equal(revivePrice(t.state, ca), Math.round(base * 0.65), 'stats cap at 10: 7 over neutral is 35% off, and it can never pass half');
  ca.stats.grit = 3;
  assert.match(t.r.try('REVIVE', { targetId: b, how: 'shop' }, a).message, /not dead/);
  kill(t, b);
  assert.deepEqual(reviveOptions(t.state, a), [], 'not on a Shop: nothing to offer');
  assert.match(t.r.try('REVIVE', { targetId: b, how: 'shop' }, a).message, /sold at a Shop/);
  shopHex(t, ca.pos);
  const opt = reviveOptions(t.state, a); assert.equal(opt.length, 1); assert.equal(opt[0].how, 'shop'); assert.equal(opt[0].price, base); assert.equal(opt[0].why, '');
  const g0 = t.char(a).gold;
  t.r.append('REVIVE', { targetId: b, how: 'shop' }, a);
  assert.equal(t.char(b).dead, false); assert.ok(t.char(b).health > 0); assert.equal(t.char(a).gold, g0 - base);
  assert.ok(t.state.log.some(l => /buys .* back from the Graveyard/.test(l.text)));
  // Broke, or not your turn: refused.
  kill(t, b); t.char(a).gold = 0; assert.match(t.r.try('REVIVE', { targetId: b, how: 'shop' }, a).message, /costs/);
  assert.ok(reviveOptions(t.state, a)[0].why, 'the phone says why the button is off');
  assert.deepEqual(reviveOptions(t.state, t.order[2]), [], 'only on your own turn');
});

test('Feather revive: PvE-only and Teams, at their Graveyard, burns one feather; refused in a free-for-all', () => {
  const t = table({ mode: 'pve' }); const [a, b] = t.order; t.until(a);
  kill(t, b); const ca = t.char(a), cb = t.char(b);
  assert.match(t.r.try('REVIVE', { targetId: b, how: 'feather' }, a).message, /Graveyard|Feather/);
  ca.pos = cb.graveyardPos; ca.items.f1 = { id: 'f1', baseId: 'phoenixfeather', slot: 'consumable', name: 'Phoenix Feather', qty: 1 };
  assert.ok(reviveOptions(t.state, a).some(o => o.how === 'feather'));
  t.r.append('REVIVE', { targetId: b, how: 'feather' }, a);
  assert.equal(t.char(b).dead, false); assert.equal(t.char(a).items.f1, undefined, 'the feather burned');
  const f = table({ mode: 'ffa' }); const [x, y] = f.order; f.until(x); kill(f, y); f.char(x).pos = f.char(y).graveyardPos; f.char(x).items.f1 = { id: 'f1', baseId: 'phoenixfeather', slot: 'consumable', name: 'Phoenix Feather', qty: 1 };
  assert.match(f.r.try('REVIVE', { targetId: y, how: 'feather' }, x).message, /PvE-only and Teams/);
  assert.equal(reviveOptions(f.state, x).filter(o => o.how === 'feather').length, 0);
});
