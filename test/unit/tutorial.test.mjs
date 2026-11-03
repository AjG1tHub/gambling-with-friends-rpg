// The table tutorial (packages/ui/tutorial.js): the rule cards read the room's balance and cover every phase; the
// order line names the mover first, marks held and dead seats, and says why the table skipped someone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { table } from './_fixtures-social.mjs';
import { ruleCards, orderLine } from '../../packages/ui/tutorial.js';
import { group } from '../../packages/shared/balance.js';

test('rule cards: every card has an id, a phase, a title and a short text; the numbers are the room\'s balance', () => {
  const t = table(); const cards = ruleCards(t.state);
  assert.ok(cards.length >= 8);
  const ids = new Set();
  for (const c of cards) {
    assert.ok(c.id && !ids.has(c.id), c.id); ids.add(c.id);
    assert.ok(['any', 'lobby', 'creation'].includes(c.phase), c.id);
    assert.ok(c.title.length > 2 && c.text.length > 40 && c.text.length < 400, `${c.id}: ${c.text.length} chars`);
  }
  const turn = cards.find(c => c.id === 'turn'), M = group(t.state, 'movement'), C = group(t.state, 'clock');
  assert.match(turn.text, new RegExp(`plod ${M.barefoot}`)); assert.match(turn.text, new RegExp(`${Math.floor(C.perTurnSeconds / 60)}:${String(C.perTurnSeconds % 60).padStart(2, '0')}`));
  assert.match(cards.find(c => c.id === 'stats').text, /below 3/);
  assert.match(cards.find(c => c.id === 'creation').text, /10 Stat Chips/);
  assert.ok(cards.some(c => c.id === 'bug' && /🐞/.test(c.text)));
});

test('order line: mover first, held seats marked and explained, the dead marked, owed turns named', () => {
  const t = table(); const [a, b, c, d] = t.order;
  const names = (id) => t.char(id).name;
  let o = orderLine(t.state);
  assert.ok(o.text.startsWith(`▶ ${names(a)}`), o.text); assert.equal(o.why, '');
  assert.equal(o.text.split('  ▸  ').length, 4);
  // a duel between a and b holds both: c plays, the line says so
  t.rigEntry('rps5'); t.r.append('CHALLENGE_CALL', { defenderId: b, call: 'duel' }, a); t.r.append('CHALLENGE_SPIN', {}, a);
  o = orderLine(t.state);
  assert.ok(o.text.startsWith(`▶ ${names(c)}`), o.text);
  assert.match(o.text, new RegExp(`${names(a)} \\(held\\)`)); assert.match(o.text, new RegExp(`${names(b)} \\(held\\)`));
  assert.match(o.why, /held in a challenge/);
  // settle: b is owed the slot it missed
  t.r.append('CHALLENGE_REPORT', { winnerId: a }, a); t.r.append('CHALLENGE_REPORT', { winnerId: a }, b);
  o = orderLine(t.state);
  assert.doesNotMatch(o.text, /held/);
  assert.match(o.why, new RegExp(`${names(b)}.*owed a turn`), o.why);
  // a dead seat
  t.char(d).dead = true; t.char(d).missTurns = 2;
  assert.match(orderLine(t.state).text, new RegExp(`${names(d)} \\(dead · 2 to wait\\)`));
});
