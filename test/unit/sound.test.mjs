// packages/ui/sound.js: cuesFor is pure, every cue renders to notes, and the catalogue matches the asset list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuesFor, renderCue, cueLength, CUES, SoundPlayer, WHEEL_SPIN_MS, PACK } from '../../packages/ui/sound.js';
import { SOUND_CUES } from '../../tools/asset-list.mjs';
import { RECIPES } from '../../tools/sounds.mjs';
import { initialState } from '../../packages/shared/state.js';

const NOW = 1_700_000_000_000;
function base() {
  const s = initialState({ roomId: 'r', code: 'ABCD', seed: 1 });
  s.phase = 'playing'; s.seats = ['p1', 'p2'];
  s.players = { p1: { id: 'p1', name: 'A', characterId: 'c1' }, p2: { id: 'p2', name: 'B', characterId: 'c2' } };
  s.characters = { c1: { id: 'c1', playerId: 'p1', name: 'A', health: 100, maxHealth: 100, dead: false, items: {} }, c2: { id: 'c2', playerId: 'p2', name: 'B', health: 100, maxHealth: 100, dead: false, items: {} } };
  return s;
}
const clone = (s) => structuredClone(s);
const names = (cues) => cues.map(c => c.cue);

test('first paint is silent', () => { assert.deepEqual(cuesFor(null, base(), NOW), []); assert.deepEqual(cuesFor(base(), null, NOW), []); });
test('no change, no cues', () => { const s = base(); assert.deepEqual(cuesFor(s, clone(s), NOW), []); });

test('turn change: the TV hears turn_start, the mover\'s phone buzzes, the other phone is silent', () => {
  const a = base(), b = clone(a); b.turnIdx = 1;   // p2's turn now
  assert.deepEqual(names(cuesFor(a, b, NOW)), ['turn_start']);
  assert.deepEqual(names(cuesFor(a, b, NOW, { viewer: 'p2' })), ['buzz']);
  assert.deepEqual(names(cuesFor(a, b, NOW, { viewer: 'p1' })), []);
});
test('a wheel spin ratchets now and lands after the animation', () => {
  const a = base(), b = clone(a); b.lastSpin = { wheel: 'loot', outcomes: ['x'], index: 0, playerId: 'p1', ts: NOW };
  const c = cuesFor(a, b, NOW);
  assert.deepEqual(c, [{ cue: 'wheel_ratchet', at: NOW }, { cue: 'wheel_land', at: NOW + WHEEL_SPIN_MS }]);
});
test('dice roll then one hex_step per step', () => {
  const a = base(), b = clone(a); b.moveSession = { playerId: 'p1', mode: 'dice', roll: 4, from: '0,0', path: [] };
  assert.deepEqual(names(cuesFor(a, b, NOW)), ['dice']);
  const c = clone(b); c.moveSession.path = ['1,0'];
  assert.deepEqual(names(cuesFor(b, c, NOW)), ['hex_step']);
  const d = clone(a); d.moveSession = { playerId: 'p1', mode: 'card', from: '0,0', path: [] };
  assert.deepEqual(names(cuesFor(a, d, NOW)), ['card_draw']);
});
test('fight log lines: crit beats hit beats miss; a boss roars when it appears', () => {
  const a = base(); a.monsters = { m1: { id: 'm1', boss: true, dead: false } }; a.fight = { id: 'f1', monsterId: 'm1', log: [{ ts: 1, by: 'c1', damage: 0, loss: 5 }] };
  const b = clone(a); b.fight.log.push({ ts: 2, by: 'c1', damage: 12, crit: false });
  assert.deepEqual(names(cuesFor(a, b, NOW)), ['hit']);
  const c = clone(b); c.fight.log.push({ ts: 3, by: 'c1', damage: 30, crit: true }, { ts: 3, by: 'm1', damage: 0, loss: 4 });
  assert.deepEqual(names(cuesFor(b, c, NOW)), ['crit', 'miss']);
  const z = base(); z.monsters = { m1: { id: 'm1', boss: true, dead: false } }; const y = clone(z); y.fight = { id: 'f2', monsterId: 'm1', log: [] };
  assert.deepEqual(names(cuesFor(z, y, NOW)), ['boss_roar']);
});
test('a new item round plays its family\'s start cue', () => {
  const a = base(); a.characters.c1.items.i1 = { id: 'i1', family: 'dice', rarity: 'common' }; a.fight = { id: 'f1', monsterId: 'm', log: [], game: null };
  const b = clone(a); b.fight.game = { itemId: 'i1', startedTs: NOW };
  assert.deepEqual(names(cuesFor(a, b, NOW)), ['game_dice_roll']);
});
test('death rings the bell; a lantern gutters at the low third; loot plays by rarity', () => {
  const a = base(), b = clone(a); b.characters.c2.dead = true; b.characters.c2.health = 0;
  assert.deepEqual(names(cuesFor(a, b, NOW)), ['death_bell']);
  const c = clone(a); c.characters.c1.health = 20;
  assert.deepEqual(names(cuesFor(a, c, NOW)), ['lantern_gutter']);
  const d = clone(a); d.characters.c1.items.x = { id: 'x', rarity: 'legendary' }; d.characters.c2.items.y = { id: 'y', rarity: 'rare' };
  assert.deepEqual(names(cuesFor(a, d, NOW)), ['loot_legendary', 'loot_rare']);
  const m = base(); m.monsters = { m1: { dead: false } }; const n = clone(m); n.monsters.m1.dead = true;
  assert.deepEqual(names(cuesFor(m, n, NOW)), ['death_bell']);
});
test('chaos, letters, challenges, area windows', () => {
  const a = base(), b = clone(a); b.chaos.tier = 2; assert.deepEqual(names(cuesFor(a, b, NOW)), ['chaos_stinger']);
  const c = clone(a); c.letters = [{ id: 'l1', fromId: 'p1', toId: 'p2' }]; assert.deepEqual(names(cuesFor(a, c, NOW)), ['letter_sent']);
  const d = clone(c); d.letters[0].intercepted = { byId: 'p2', action: 'pass' }; assert.deepEqual(names(cuesFor(c, d, NOW)), ['letter_intercepted']);
  const e = clone(a); e.challenge = { id: 'ch1', attackerId: 'p1', defenderId: 'p2' };
  assert.deepEqual(names(cuesFor(a, e, NOW, { viewer: 'p2' })), ['buzz']);
  assert.deepEqual(names(cuesFor(a, e, NOW)), ['wheel_ratchet']);
  const f = clone(a); f.area = { id: 'ar1', done: false }; assert.deepEqual(names(cuesFor(a, f, NOW, { viewer: 'p2' })), ['buzz']); assert.deepEqual(names(cuesFor(a, f, NOW)), []);
});
test('log kinds the handlers tag are heard once', () => {
  const a = base(); a.log = [{ ts: 1, text: 'x', kind: 'info' }]; const b = clone(a); b.log.push({ ts: 2, text: 'Chaos!', kind: 'chaos' }, { ts: 2, text: 'A drops the Joker', kind: 'legendary' });
  assert.deepEqual(names(cuesFor(a, b, NOW)), ['chaos_stinger', 'loot_legendary']);
});
test('clock warning fires once as the mover crosses the line, only on the mover\'s phone', () => {
  const a = base(); a.clocks = { p1: { bankMs: 60_000, runningSince: NOW - 40_000 } }; a.lastEventTs = NOW - 1000;
  const b = clone(a); b.lastEventTs = NOW;
  assert.deepEqual(names(cuesFor(a, b, NOW + 6_000)), ['clock_warning']);          // 14 s left now, 21 s left at prev
  assert.deepEqual(names(cuesFor(a, b, NOW + 6_000, { viewer: 'p2' })), []);
  assert.deepEqual(names(cuesFor(a, b, NOW + 6_000, { viewer: 'p1' })), ['clock_warning']);
  assert.deepEqual(names(cuesFor(a, b, NOW)), []);                                   // 20 s left: not yet
});
test('the merge keeps one of each cue, loudest first, capped', () => {
  const a = base(), b = clone(a);
  b.chaos.tier = 2; b.characters.c2.dead = true; b.letters = [{ id: 'l' }]; b.moveSession = { playerId: 'p1', mode: 'dice', roll: 2, from: '0,0', path: [] }; b.characters.c1.items.x = { rarity: 'common' };
  const c = names(cuesFor(a, b, NOW, { max: 3 }));
  assert.equal(c.length, 3); assert.deepEqual(c.slice(0, 2).sort(), ['chaos_stinger', 'death_bell']);
  assert.deepEqual(names(cuesFor(a, b, NOW, { max: 10 })), [...new Set(names(cuesFor(a, b, NOW, { max: 10 })))]);
});
test('cuesFor does not mutate its inputs', () => {
  const a = base(), b = clone(a); b.turnIdx = 1; b.lastSpin = { ts: NOW }; const sa = JSON.stringify(a), sb = JSON.stringify(b);
  cuesFor(a, b, NOW); assert.equal(JSON.stringify(a), sa); assert.equal(JSON.stringify(b), sb);
});

test('every cue in the catalogue renders to notes with an envelope, and matches the asset list and the WAV recipes', () => {
  const catalogue = Object.keys(CUES).sort(), listed = [...SOUND_CUES].sort(), recipes = Object.keys(RECIPES).sort();
  assert.deepEqual(catalogue, listed, 'CUES in packages/ui/sound.js must equal SOUND_CUES in tools/asset-list.mjs');
  assert.deepEqual(recipes, listed, 'RECIPES in tools/sounds.mjs must equal SOUND_CUES');
  for (const cue of catalogue) {
    const notes = renderCue(cue, PACK);
    assert.ok(notes.length > 0, cue);
    for (const n of notes) { assert.ok(n.freq > 20 && n.freq < 20000, cue); assert.ok(n.dur > 0 && n.start >= 0, cue); assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(n.wave)); }
    assert.ok(cueLength(notes) <= 3, `${cue} is too long`);
  }
  assert.deepEqual(renderCue('nope'), []);
});

test('SoundPlayer picks a file only when the manifest has a real one', () => {
  const manifest = { sound: { hit: { path: 'assets/sound/hit.wav', placeholder: false }, miss: { path: 'assets/sound/miss.wav', placeholder: true } } };
  const p = new SoundPlayer({ AudioCtx: null, manifest, base: '/' });
  assert.equal(p.fileFor('hit'), '/sound/hit.wav', 'manifest paths are under assets/, which Vite serves at the root'); assert.equal(p.fileFor('miss'), null); assert.equal(p.fileFor('crit'), null);
  assert.equal(p.supported, false); assert.equal(p.unlocked, false);
  assert.equal(p.playNotes(renderCue('hit')), 0);
  assert.equal(p.schedule([{ cue: 'hit', at: 0 }, { cue: 'bogus', at: 0 }], { on: true, volume: 1 }, 0), 1);
  assert.equal(p.schedule([{ cue: 'hit', at: 0 }], { on: false }, 0), 0);
  // A fake AudioContext: notes are scheduled as oscillators.
  const made = []; const fake = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.resume = async () => {}; this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect(x) { return x; } }); this.createOscillator = () => { const o = { frequency: {}, connect(x) { return x; }, start() { made.push(o); }, stop() {} }; return o; }; };
  const q = new SoundPlayer({ AudioCtx: fake });
  return q.unlock().then(ok => { assert.equal(ok, true); assert.equal(q.playNotes(renderCue('crit'), 0.5), renderCue('crit').length); assert.equal(made.length, renderCue('crit').length); });
});
