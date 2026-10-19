import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, G, E, mkGame, DEFAULT_CONFIG } from './_helpers.mjs';
const SND = await import('../../site/js/sound.js');

const clone = (s) => structuredClone(s);
const names = (cues) => cues.map(c => c.cue);
// run `fn` against a copy of the state and return the cues the change produces
function diff(c, fn, now = Date.now()) { const prev = clone(c.state); fn(); return SND.cuesFor(prev, c.state, now); }

test('every theme in the config has a sound pack', () => {
  for (const t of DEFAULT_CONFIG.Themes) assert.ok(SND.PACKS[t.id], `no pack for theme ${t.id}`);
  assert.equal(SND.packFor('does-not-exist').name, SND.PACKS.noir.name);
});

test('SoundPacks config rows override the built-in voice for that theme only', () => {
  const cfg = { SoundPacks: [{ themeId: 'felt', wave: 'square', root: 300, tempo: '' }] };
  const p = SND.packFor('felt', cfg);
  assert.equal(p.wave, 'square'); assert.equal(p.root, 300); assert.equal(p.tempo, SND.PACKS.felt.tempo);
  assert.deepEqual(SND.packFor('noir', cfg), SND.PACKS.noir);
});

test('every cue renders audible, finite, short notes in every pack', () => {
  for (const [id, pack] of Object.entries(SND.PACKS)) for (const cue of Object.keys(SND.CUES)) {
    const notes = SND.renderCue(cue, pack);
    assert.ok(notes.length > 0, `${id}/${cue} is silent`);
    for (const n of notes) {
      assert.ok(Number.isFinite(n.freq) && n.freq >= 60 && n.freq <= 4500, `${id}/${cue} freq ${n.freq}`);
      assert.ok(n.dur > 0 && n.start >= 0 && n.gain > 0 && n.gain <= 1, `${id}/${cue} bad envelope`);
      assert.ok(['sine', 'square', 'triangle', 'sawtooth'].includes(n.wave));
    }
    assert.ok(SND.cueLength(notes) < 4, `${id}/${cue} runs ${SND.cueLength(notes)}s`);
  }
});

test('packs sound different: same cue, different notes', () => {
  const a = JSON.stringify(SND.renderCue('win', SND.PACKS.noir)), b = JSON.stringify(SND.renderCue('win', SND.PACKS.vapor));
  assert.notEqual(a, b);
  assert.ok(SND.renderCue('win', SND.PACKS.vapor).length > SND.renderCue('win', SND.PACKS.noir).length);   // bright packs add sparkle
});

test('unknown cues render nothing', () => { assert.deepEqual(SND.renderCue('kazoo', SND.PACKS.noir), []); });

test('first paint and identical states are silent', () => {
  const c = mkGame();
  assert.deepEqual(SND.cuesFor(null, c.state), []);
  assert.deepEqual(SND.cuesFor(clone(c.state), c.state), []);
});

test('a new wheel spin plays the spin now and the landing 4.3 s later', () => {
  const c = mkGame(); const now = 1000;
  const cues = diff(c, () => { c.state.lastSpin = { wheel: 'x', outcomes: ['a'], index: 0, ts: 5 }; }, now);
  assert.deepEqual(cues, [{ cue: 'wheel_spin', at: 1000 }, { cue: 'wheel_land', at: 5300 }]);
});

test('money moves: small credit = coin, 500+ Gold = jackpot, debit = lose', () => {
  const c = mkGame();
  assert.deepEqual(names(diff(c, () => S.credit(c.state, c.p, 'Gold', 100, 'x'))), ['coin']);
  assert.deepEqual(names(diff(c, () => S.credit(c.state, c.p, 'Gold', 500, 'x'))), ['jackpot']);
  assert.deepEqual(names(diff(c, () => S.credit(c.state, c.p, 'Gems', 900, 'x'))), ['coin']);
  assert.deepEqual(names(diff(c, () => S.credit(c.state, c.p, 'Gold', -50, 'x'))), ['lose']);
});

test('jail, release, chaos and void have their own cues', () => {
  const c = mkGame();
  assert.ok(names(diff(c, () => E.sendToJail(c.config, c.state, c.p, 't'))).includes('jail'));
  assert.ok(names(diff(c, () => E.releaseFromJail(c.config, c.state, c.p, 't'))).includes('free'));
  assert.ok(names(diff(c, () => E.chaosShuffle(c.config, c.state, c.rng, 2))).includes('chaos'));
  assert.ok(names(diff(c, () => S.log(c.state, 'VOID_TRIGGER', c.p.id, {}))).includes('void'));
});

test('settling a game: win / loss / push', () => {
  const c = mkGame(); const stake = () => { c.state.game = { id: 'fifty', playerId: c.p.id, wagers: [{ amount: 100, cur: 'Gold' }], view: {} }; };
  stake(); assert.ok(names(diff(c, () => G.settle(c.config, c.state, c.p, 2))).includes('win'));
  stake(); assert.ok(names(diff(c, () => G.settle(c.config, c.state, c.p, 0))).includes('lose_game'));
  stake(); assert.deepEqual(names(diff(c, () => G.settle(c.config, c.state, c.p, 1))), ['push']);
});

test('one click never produces more than four immediate cues, loudest first, no duplicates', () => {
  const c = mkGame();
  const cues = diff(c, () => {
    for (let i = 0; i < 6; i++) S.credit(c.state, c.p, 'Gold', 10, 'x');
    S.credit(c.state, c.p, 'Gold', -10, 'x'); E.sendToJail(c.config, c.state, c.p, 't');
    E.chaosShuffle(c.config, c.state, c.rng, 1); S.log(c.state, 'TURN_END', null, {}); S.log(c.state, 'SHOP_EXCHANGE', c.p.id, {});
  });
  assert.equal(cues.length, 4); assert.equal(new Set(names(cues)).size, 4);
  assert.equal(names(cues)[0], 'chaos'); assert.ok(names(cues).includes('jail')); assert.ok(!names(cues).includes('turn'));
});

test('blackjack: each dealt card clicks at its own time; the hole-card flip clicks too', () => {
  const c = mkGame(); const now = Date.now();
  const cues = diff(c, () => G.startGame(c.config, c.state, c.rng, 'blackjack', c.p, []), now).filter(x => x.cue === 'card');
  assert.ok(cues.length >= 4); assert.deepEqual(cues.map(x => x.at), cues.map(x => x.at).slice().sort((a, b) => a - b));
  assert.ok(cues[0].at > now);
  if (c.state.game.phase === 'player') {
    const more = diff(c, () => G.gameAction(c.config, c.state, c.rng, 'stand'), Date.now()).filter(x => x.cue === 'card');
    assert.ok(more.length >= 1);                                   // at least the flip
  }
});

test('a re-delivered identical game state does not replay its cards', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'baccarat', c.p, []);
  G.gameAction(c.config, c.state, c.rng, 'bet', { side: 'player' }); G.gameAction(c.config, c.state, c.rng, 'deal');
  assert.deepEqual(SND.cuesFor(clone(c.state), clone(c.state)), []);
});

test('plinko: a drop, then one peg tick per row', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'plinko', c.p, []);
  const cues = diff(c, () => G.gameAction(c.config, c.state, c.rng, 'spin', {}));
  assert.equal(cues.filter(x => x.cue === 'peg').length, 12); assert.equal(cues.filter(x => x.cue === 'drop').length, 1);
  const pegs = cues.filter(x => x.cue === 'peg').map(x => x.at);
  assert.equal(pegs[1] - pegs[0], G.PLINKO_STEP_MS);
});

test('crash and mines: launch, explode, gem', () => {
  const c = mkGame(); G.startGame(c.config, c.state, c.rng, 'crash', c.p, []);
  assert.ok(names(diff(c, () => G.gameAction(c.config, c.state, c.rng, 'launch'))).includes('launch'));
  c.state.game.secret.crashAt = 1; c.state.game.startedTs = Date.now() - 3000;
  assert.ok(names(diff(c, () => G.gameAction(c.config, c.state, c.rng, 'cashout'))).includes('explode'));
  G.startGame(c.config, c.state, c.rng, 'mines', c.p, []); const g = c.state.game;
  const safe = [...Array(25).keys()].find(i => !g.secret.mines.includes(i));
  assert.ok(names(diff(c, () => G.gameAction(c.config, c.state, c.rng, 'reveal', { idx: safe }))).includes('gem'));
  assert.ok(names(diff(c, () => G.gameAction(c.config, c.state, c.rng, 'reveal', { idx: g.secret.mines[0] }))).includes('explode'));
});

test('new ledger rows are found even after the row cap trims the front', () => {
  const c = mkGame(); for (let i = 0; i < S.LEDGER_MAX; i++) S.log(c.state, 'NOTE', null, {});
  const cues = diff(c, () => { S.log(c.state, 'JAIL_IN', c.p.id, {}); });
  assert.deepEqual(names(cues), ['jail']); assert.equal(c.state.ledger.length, S.LEDGER_MAX);
});

test('rows logged in the same millisecond for the same player are all heard (sequence numbers)', () => {
  const c = mkGame();
  S.credit(c.state, c.p, 'Gold', 10, 'a');
  const cues = diff(c, () => { S.credit(c.state, c.p, 'Gold', 10, 'b'); S.credit(c.state, c.p, 'Gold', 700, 'c'); });
  assert.deepEqual(names(cues), ['jackpot', 'coin']);
  const ns = c.state.ledger.map(r => r.n); assert.deepEqual(ns, ns.slice().sort((a, b) => a - b)); assert.equal(new Set(ns).size, ns.length);
});

test('saves from before sequence numbers still diff by content', () => {
  const prev = { ledger: [{ ts: 1, type: 'NOTE', playerId: null }], lastSpin: null, game: null };
  const next = { ledger: [{ ts: 1, type: 'NOTE', playerId: null }, { ts: 2, type: 'JAIL_IN', playerId: 'p0' }], lastSpin: null, game: null };
  assert.deepEqual(names(SND.cuesFor(prev, next)), ['jail']);
});

// A stand-in AudioContext records what would have been played.
class FakeCtx {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.started = []; this.destination = {}; }
  async resume() { this.state = 'running'; }
  createOscillator() { const o = { frequency: { value: 0 }, connect: (x) => x, start: (t) => this.started.push({ t, f: o.frequency.value, type: o.type }), stop() {} }; return o; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x }; }
}

test('SoundPlayer stays silent until unlocked by a click, then plays every note', async () => {
  const sp = new SND.SoundPlayer(FakeCtx); const notes = SND.renderCue('coin', SND.PACKS.noir);
  assert.equal(sp.playNotes(notes), 0);
  assert.equal(await sp.unlock(), true);
  assert.equal(sp.playNotes(notes), notes.length); assert.equal(sp.ctx.started.length, notes.length);
  assert.equal(sp.playNotes(notes, 0), 0);                          // volume 0 = nothing
});

test('SoundPlayer honours the GM mute switch and defers future cues', async () => {
  const sp = new SND.SoundPlayer(FakeCtx); await sp.unlock(); const now = 1000;
  assert.equal(sp.schedule([{ cue: 'coin', at: now }], SND.PACKS.noir, { on: false, volume: 1 }, now), 0);
  assert.equal(sp.schedule([{ cue: 'coin', at: now }, { cue: 'card', at: now + 60000 }], SND.PACKS.noir, { on: true, volume: 1 }, now), 2);
  assert.equal(sp.timers.size, 1); assert.ok(sp.ctx.started.length > 0);
  sp.cancelPending(); assert.equal(sp.timers.size, 0);
});

test('SoundPlayer without WebAudio support degrades quietly', async () => {
  const sp = new SND.SoundPlayer(null);
  assert.equal(sp.supported, false); assert.equal(await sp.unlock(), false); assert.equal(sp.playNotes([{}]), 0);
});
