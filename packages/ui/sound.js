// Sound for RPG Edition. Three layers, the first two pure and unit-tested (test/unit/sound.test.mjs):
//   cuesFor(prev, next, now, opts) → which cues a state change deserves            [{ cue, at }]
//   renderCue(cue, pack)           → the synthesized notes for that cue            [{ freq, start, dur, wave, gain }]
//   SoundPlayer                    → plays notes through WebAudio, or the WAV from assets/manifest.json when
//                                    `manifest.sound[cue]` exists and is not a placeholder
// The note renderer, cue-priority merge and WebAudio scheduling are carried over from legacy/site/js/sound.js
// (the previous build's synthesized cue engine) and re-keyed to the RPG cues; nothing is imported from legacy at
// runtime. Cue names match tools/asset-list.mjs SOUND_CUES, so a real WAV dropped at assets/sound/<cue>.wav is
// picked up the next time the manifest is built.
import { B } from '../shared/balance.js';

// ── Voice ──────────────────────────────────────────────────────────
export const PACK = { name: 'Dead House', wave: 'triangle', root: 196.0, scale: [0, 3, 5, 7, 10, 12], tempo: 0.11, bright: false };
export const DEFAULT_SOUND = { on: true, volume: 0.6, files: true };
export const WHEEL_SPIN_MS = 4300;   // how long the TV's wheel animation runs before it lands (UI timing, not a rule)

// ── Cue catalogue: melody = scale degrees (null = rest); priority: higher wins when one event makes several ──
export const CUES = {
  turn_start:         { priority: 1, steps: [1], len: 0.7, gain: 0.25 },
  hex_step:           { priority: 1, steps: [0], len: 0.15, gain: 0.2, tick: true, low: true },
  dice:               { priority: 2, steps: [5, 5, 4], len: 0.2, gain: 0.3, tick: true },
  wheel_ratchet:      { priority: 3, steps: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5], len: 0.5, gain: 0.25, tick: true },
  wheel_land:         { priority: 3, steps: [5, null, 5], len: 1.6, gain: 0.5 },
  card_draw:          { priority: 2, steps: [4], len: 0.25, gain: 0.3, tick: true },
  hit:                { priority: 4, steps: [2, 0], len: 0.9, gain: 0.5, low: true },
  crit:               { priority: 5, steps: [0, 2, 3, 5, 3, 5, 5], len: 1.2, gain: 0.6, sparkle: true },
  miss:               { priority: 3, steps: [2, 0], len: 1.4, gain: 0.4, down: true },
  death_bell:         { priority: 6, steps: [0, 0, null, 0], len: 2.4, gain: 0.6, down: true, low: true },
  lantern_gutter:     { priority: 2, steps: [1, 0, 1, 0], len: 0.5, gain: 0.25, tick: true, low: true },
  letter_sent:        { priority: 2, steps: [3, 5], len: 0.9, gain: 0.4 },
  letter_intercepted: { priority: 3, steps: [5, 3, 1], len: 1.0, gain: 0.4, down: true },
  loot_common:        { priority: 2, steps: [3], len: 0.6, gain: 0.35 },
  loot_rare:          { priority: 3, steps: [3, 5], len: 0.8, gain: 0.4 },
  loot_epic:          { priority: 4, steps: [1, 3, 5], len: 1.0, gain: 0.5, sparkle: true },
  loot_legendary:     { priority: 6, steps: [0, 0, 2, 3, null, 3, 5], len: 1.4, gain: 0.6, sparkle: true },
  chaos_stinger:      { priority: 6, steps: [5, 0, 4, 1, 3, 2, 5, 0], len: 0.7, gain: 0.6, low: true, down: true },
  boss_roar:          { priority: 6, steps: [0, 0, 3, 0, 5], len: 1.6, gain: 0.6, low: true },
  ui_tap_1: { priority: 0, steps: [3], len: 0.15, gain: 0.2, tick: true }, ui_tap_2: { priority: 0, steps: [4], len: 0.15, gain: 0.2, tick: true }, ui_tap_3: { priority: 0, steps: [5], len: 0.15, gain: 0.2, tick: true },
  ui_tap_4: { priority: 0, steps: [2], len: 0.15, gain: 0.2, tick: true }, ui_tap_5: { priority: 0, steps: [1], len: 0.15, gain: 0.2, tick: true }, ui_tap_6: { priority: 0, steps: [0], len: 0.15, gain: 0.2, tick: true },
  buzz:               { priority: 5, steps: [0, 0], len: 0.6, gain: 0.5, low: true },
  clock_warning:      { priority: 4, steps: [5, null, 5], len: 0.3, gain: 0.4, tick: true },
  game_dice_roll:     { priority: 2, steps: [5, 4, 5, 4, 5], len: 0.2, gain: 0.25, tick: true },
  game_dice_land:     { priority: 2, steps: [2], len: 0.4, gain: 0.35, low: true },
  game_cards_flip:    { priority: 2, steps: [4], len: 0.25, gain: 0.3, tick: true },
  game_cards_shuffle: { priority: 2, steps: [4, 3, 4, 3, 4, 3], len: 0.15, gain: 0.2, tick: true },
  game_wheels_spin:   { priority: 3, steps: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1], len: 0.4, gain: 0.3, tick: true },
  game_wheels_land:   { priority: 3, steps: [5, null, 5], len: 1.4, gain: 0.5 },
  game_nerve_tick:    { priority: 1, steps: [5], len: 0.12, gain: 0.2, tick: true },
  game_nerve_boom:    { priority: 5, steps: [5, 0], len: 2.0, gain: 0.6, low: true, down: true },
  game_nerve_cashout: { priority: 3, steps: [1, 3, 5], len: 0.7, gain: 0.45, sparkle: true },
  game_picks_drop:    { priority: 2, steps: [5, 3], len: 0.5, gain: 0.3 },
  game_picks_peg:     { priority: 1, steps: [5], len: 0.2, gain: 0.2, tick: true },
  game_picks_hit:     { priority: 2, steps: [4, 5], len: 0.5, gain: 0.35, sparkle: true },
};
export const FAMILY_START_CUE = { dice: 'game_dice_roll', cards: 'game_cards_shuffle', wheels: 'game_wheels_spin', nerve: 'game_nerve_tick', picks: 'game_picks_drop' };

const semis = (root, n) => root * Math.pow(2, n / 12);
const round = (x) => Math.round(x * 1000) / 1000;

// Pure: the notes that make up one cue in one pack (from legacy renderCue).
export function renderCue(cue, pack = PACK) {
  const def = CUES[cue]; if (!def || !pack) return [];
  const notes = []; const step = def.tick ? pack.tempo * 0.55 : pack.tempo;
  def.steps.forEach((deg, i) => {
    if (deg == null) return;
    const last = i === def.steps.length - 1;
    const base = semis(pack.root, pack.scale[deg % pack.scale.length]) * (def.low ? 0.5 : 1);
    const dur = last ? Math.max(step, step * def.len * 4) : step * 0.95;
    notes.push({ freq: round(base), start: round(i * step), dur: round(dur), wave: def.down && !def.tick ? (pack.wave === 'sine' ? 'triangle' : pack.wave) : pack.wave, gain: def.gain });
    if (def.sparkle && pack.bright) notes.push({ freq: round(base * 2), start: round(i * step), dur: round(dur * 0.6), wave: 'sine', gain: def.gain * 0.35 });
  });
  return notes;
}
export const cueLength = (notes) => notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);

// ── State diff → cues ────────────────────────────────────────────
// New rows of a capped array (state.log keeps 300, fight.log grows): everything after prev's last row.
function newRows(prevArr, nextArr) {
  const prev = prevArr || [], next = nextArr || [];
  if (!prev.length) return next.length > 20 ? next.slice(-20) : next;
  const last = prev[prev.length - 1];
  for (let i = next.length - 1; i >= 0; i--) { const r = next[i]; if (r === last || (r.ts === last.ts && r.text === last.text && r.by === last.by)) return next.slice(i + 1); if (r.ts < last.ts) return next.slice(i + 1); }
  return next.slice(-20);
}
const third = (c) => { const f = c.maxHealth ? c.health / c.maxHealth : 0; return c.dead || c.health <= 0 ? 'dead' : f > B.health.tellHigh ? 'high' : f >= B.health.tellLow ? 'mid' : 'low'; };
const currentPid = (s) => { const seats = (s.seats || []).filter(id => s.players?.[id] && !s.players[id].kicked && !s.players[id].spectator); if (!seats.length) return null; for (let i = 0; i < seats.length; i++) { const id = seats[(s.turnIdx + i) % seats.length]; if (!s.held?.[id]) return id; } return seats[s.turnIdx % seats.length]; };
const familyOfGame = (state, game) => { if (!game) return null; for (const c of Object.values(state.characters || {})) { const it = c.items?.[game.itemId]; if (it) return it.family || null; } return null; };
const isBoss = (m) => !!m && (m.boss || m.raid || m.final || ['boss', 'raid', 'final'].includes(m.role));

// Pure: what should be heard when a screen goes from `prev` to `next`.
// opts.viewer: the phone's player id (buzz on your turn / being challenged / an Area window); null for the TV.
// Returns [{ cue, at }] with `at` an absolute ms timestamp (the wheel landing is scheduled ahead).
export function cuesFor(prev, next, now = Date.now(), { viewer = null, max = 4, warnMs = B.clock.warningSeconds * 1000 } = {}) {
  if (!prev || !next) return [];            // first paint: never blast a backlog
  const out = []; const add = (cue, at = now) => out.push({ cue, at });
  const isViewerTurn = viewer && currentPid(next) === viewer;

  // Turns
  if (next.phase === 'playing' && (next.turnIdx !== prev.turnIdx || prev.phase !== 'playing')) { if (viewer) { if (isViewerTurn) add('buzz'); } else add('turn_start'); }
  // Wheels: one spin → ratchet now, landing when the TV animation stops.
  if (next.lastSpin && next.lastSpin.ts !== prev.lastSpin?.ts) { add('wheel_ratchet'); add('wheel_land', now + WHEEL_SPIN_MS); }
  // Movement: a fresh dice roll, then one step per hex walked.
  const ms = next.moveSession, pms = prev.moveSession;
  if (ms && (!pms || pms.playerId !== ms.playerId || ms.from !== pms.from || (ms.roll && !pms.roll))) { if (ms.mode === 'dice' || ms.mode === 'barefoot') add('dice'); if (ms.mode === 'card') add('card_draw'); }
  if (ms && pms && ms.playerId === pms.playerId && (ms.path?.length || 0) > (pms.path?.length || 0)) add('hex_step');
  // Fights: a boss appearing roars; each log line is a hit, a crit or a miss; a new item round plays its family.
  const f = next.fight, pf = prev.fight;
  if (f && (!pf || pf.id !== f.id) && isBoss(next.monsters?.[f.monsterId])) add('boss_roar');
  if (f && (!pf || pf.id !== f.id) && f.kind === 'boss') add('boss_roar');
  if (f && pf && pf.id === f.id) {
    for (const l of newRows(pf.log, f.log)) add(l.crit ? 'crit' : l.damage > 0 ? 'hit' : l.healed > 0 || l.shielded > 0 ? 'game_nerve_cashout' : l.loss > 0 ? 'miss' : 'card_draw');
    if (f.game && f.game.startedTs !== pf.game?.startedTs) { const fam = familyOfGame(next, f.game); if (fam && FAMILY_START_CUE[fam]) add(FAMILY_START_CUE[fam]); }
  }
  // Characters: deaths ring the bell, a lantern guttering (dropping into the low third), new items by rarity.
  for (const [id, c] of Object.entries(next.characters || {})) {
    const pc = prev.characters?.[id]; if (!pc) continue;
    if (c.dead && !pc.dead) add('death_bell');
    else if (third(c) === 'low' && third(pc) !== 'low') add('lantern_gutter');
    for (const itemId of Object.keys(c.items || {})) if (!pc.items?.[itemId]) { const r = c.items[itemId]?.rarity; add(r === 'legendary' ? 'loot_legendary' : r === 'epic' ? 'loot_epic' : r === 'rare' ? 'loot_rare' : 'loot_common'); }
  }
  for (const [id, m] of Object.entries(next.monsters || {})) if (m.dead && prev.monsters?.[id] && !prev.monsters[id].dead) add('death_bell');
  // Chaos, letters, challenges, Area windows, log kinds the handlers tag.
  if ((next.chaos?.tier || 0) > (prev.chaos?.tier || 0)) add('chaos_stinger');
  const letters = next.letters || [], pl = prev.letters || [];
  if (letters.length > pl.length) add('letter_sent');
  for (const l of letters) { const o = pl.find(x => x.id === l.id); if (l.intercepted && !(o && o.intercepted)) add('letter_intercepted'); }
  const ch = next.challenge;
  if (ch && (!prev.challenge || prev.challenge.id !== ch.id)) { if (viewer ? (ch.attackerId === viewer || ch.defenderId === viewer) : false) add('buzz'); else if (!viewer) add('wheel_ratchet'); }
  if (viewer && next.area && !next.area.done && next.area.id !== prev.area?.id) add('buzz');
  if (viewer && next.pendingPrompt && next.pendingPrompt.playerId === viewer && next.pendingPrompt !== prev.pendingPrompt && next.pendingPrompt.kind !== prev.pendingPrompt?.kind) add('ui_tap_3');
  for (const r of newRows(prev.log, next.log)) {
    if (r.kind === 'chaos' && !out.some(c => c.cue === 'chaos_stinger')) add('chaos_stinger');
    else if (r.kind === 'boss') add('boss_roar');
    else if (r.kind === 'legendary') add('loot_legendary');
    else if (r.kind === 'loot' && !out.some(c => c.cue.startsWith('loot_'))) add('loot_common');
    else if (r.kind === 'letter' && !out.some(c => c.cue === 'letter_sent')) add('letter_sent');
    else if (r.kind === 'gold' || r.kind === 'shop' || r.kind === 'trade') add('ui_tap_4');
  }
  // Clock: the mover's clock crossing the warning line.
  const pid = currentPid(next), ck = next.clocks?.[pid], pck = prev.clocks?.[pid];
  if (ck && ck.runningSince != null && !next.gm?.paused) {
    const left = ck.bankMs - (now - ck.runningSince), prevLeft = pck && pck.runningSince != null ? pck.bankMs - (Math.min(now, prev.lastEventTs || now) - pck.runningSince) : Infinity;
    if (left <= warnMs && left > 0 && prevLeft > warnMs && (!viewer || isViewerTurn)) add('clock_warning');
  }
  // Merge as legacy did: timed cues always play; of the instant ones keep the loudest few, one per cue.
  const timed = out.filter(c => c.at > now), instant = out.filter(c => c.at <= now);
  const best = new Map(); for (const c of instant) if (!best.has(c.cue)) best.set(c.cue, c);
  const kept = [...best.values()].sort((a, b) => (CUES[b.cue]?.priority || 0) - (CUES[a.cue]?.priority || 0)).slice(0, max);
  return [...kept, ...timed].sort((a, b) => a.at - b.at);
}

// ── Player ────────────────────────────────────────────────────────
// `manifest` is assets/manifest.json (or just its `sound` map); `base` is the URL prefix for its paths.
export class SoundPlayer {
  constructor({ AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext, manifest = null, base = '/', fetchFn = globalThis.fetch } = {}) {
    this.AudioCtx = AudioCtx; this.ctx = null; this.timers = new Set(); this.manifest = manifest; this.base = base; this.fetchFn = fetchFn; this.buffers = new Map(); this.music = null;
  }
  get supported() { return !!this.AudioCtx; }
  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }
  // Browsers only allow audio after a click in THIS window — call from a click handler.
  async unlock() {
    if (!this.supported) return false;
    if (!this.ctx) this.ctx = new this.AudioCtx();
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* blocked */ } }
    return this.unlocked;
  }
  // A real file exists for the cue when the manifest lists it and it is not one of our placeholders.
  fileFor(cue) { const s = (this.manifest?.sound || this.manifest)?.[cue]; return s && s.path && s.placeholder === false ? this.base.replace(/\/?$/, '/') + s.path : null; }
  async buffer(cue) {
    const url = this.fileFor(cue); if (!url || !this.ctx || !this.fetchFn) return null;
    if (this.buffers.has(cue)) return this.buffers.get(cue);
    const p = this.fetchFn(url).then(r => r.arrayBuffer()).then(ab => this.ctx.decodeAudioData(ab)).catch(() => null);
    this.buffers.set(cue, p); return p;
  }
  playNotes(notes, volume = DEFAULT_SOUND.volume) {
    if (!this.unlocked || !notes.length || volume <= 0) return 0;
    const t0 = this.ctx.currentTime + 0.01;
    for (const n of notes) {
      const osc = this.ctx.createOscillator(), amp = this.ctx.createGain();
      osc.type = n.wave; osc.frequency.value = n.freq;
      const peak = Math.max(0.0001, n.gain * volume * 0.5);
      amp.gain.setValueAtTime(0.0001, t0 + n.start);
      amp.gain.exponentialRampToValueAtTime(peak, t0 + n.start + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + n.start + n.dur);
      osc.connect(amp).connect(this.ctx.destination);
      osc.start(t0 + n.start); osc.stop(t0 + n.start + n.dur + 0.03);
    }
    return notes.length;
  }
  playBuffer(buf, volume = DEFAULT_SOUND.volume, { loop = false } = {}) {
    if (!this.unlocked || !buf || volume <= 0) return null;
    const src = this.ctx.createBufferSource(), amp = this.ctx.createGain(); src.buffer = buf; src.loop = loop; amp.gain.value = volume;
    src.connect(amp).connect(this.ctx.destination); src.start(); return src;
  }
  // One cue now: the WAV when there is a real one (and files are on), else the synthesized notes.
  async play(cue, settings = DEFAULT_SOUND) {
    if (!settings || settings.on === false) return 'off';
    if (settings.files !== false && this.fileFor(cue)) { const buf = await this.buffer(cue); if (buf) { this.playBuffer(buf, settings.volume); return 'file'; } }
    return this.playNotes(renderCue(cue, PACK), settings.volume) ? 'notes' : 'silent';
  }
  // Schedule a batch from cuesFor(). Returns how many cues were queued.
  schedule(cues, settings = DEFAULT_SOUND, now = Date.now()) {
    if (!settings || settings.on === false) return 0;
    let n = 0;
    for (const c of cues) {
      if (!CUES[c.cue] && !this.fileFor(c.cue)) continue;
      const delay = Math.max(0, c.at - now);
      if (delay < 15) this.play(c.cue, settings);
      else { const id = setTimeout(() => { this.timers.delete(id); this.play(c.cue, settings); }, delay); this.timers.add(id); }
      n++;
    }
    return n;
  }
  // Music loops play only from real files (placeholder drones are two seconds long and would grate).
  async playMusic(name, settings = DEFAULT_SOUND) {
    this.stopMusic(); if (!settings || settings.on === false) return false;
    const buf = await this.buffer(name); if (!buf) return false;
    this.music = this.playBuffer(buf, settings.volume * 0.5, { loop: true }); return !!this.music;
  }
  stopMusic() { if (this.music) { try { this.music.stop(); } catch { /* already stopped */ } this.music = null; } }
  cancelPending() { for (const id of this.timers) clearTimeout(id); this.timers.clear(); }
}
