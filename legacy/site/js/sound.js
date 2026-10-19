// Sound packs (Phase 6). No audio files: every cue is a few synthesized notes, voiced
// differently per theme. Three layers, the first two pure (and unit-tested):
//   cuesFor(prev, next)  → which cues a state change deserves  [{ cue, at }]
//   renderCue(cue, pack) → the notes for that cue                [{ freq, start, dur, wave, gain }]
//   SoundPlayer          → plays notes through WebAudio on the shared screen
import { PLINKO_STEP_MS, SLOTS_REEL_MS, KENO_BALL_MS } from './games.js';

// ── Packs: one voice per theme ───────────────────────────────────
// wave = oscillator shape, root = base pitch (Hz), scale = semitone steps used for melodies,
// tempo = seconds per melodic step, bright = extra octave sparkle on happy cues.
export const PACKS = {
  noir:    { name: 'Casino Noir',    wave: 'triangle', root: 220.00, scale: [0, 3, 5, 7, 10, 12], tempo: 0.11, bright: false },
  vapor:   { name: 'Neon Vapor',     wave: 'square',   root: 261.63, scale: [0, 2, 4, 7, 9, 12],  tempo: 0.08, bright: true },
  felt:    { name: 'Royal Felt',     wave: 'sine',     root: 196.00, scale: [0, 4, 7, 9, 12, 16], tempo: 0.13, bright: false },
  riviera: { name: 'Sunset Riviera', wave: 'sawtooth', root: 246.94, scale: [0, 2, 5, 7, 9, 12],  tempo: 0.10, bright: true },
};
export const DEFAULT_SOUND = { on: true, volume: 0.6 };
export function packFor(themeId, config) {
  const fromConfig = (config?.SoundPacks || []).find(p => p.themeId === themeId);
  const base = PACKS[themeId] || PACKS.noir;
  if (!fromConfig) return base;
  return { ...base, ...Object.fromEntries(Object.entries(fromConfig).filter(([k, v]) => k !== 'themeId' && v !== '' && v != null)) };
}

// ── Cue catalogue: melody = scale degrees (null = rest), shape = how it is voiced ──
// priority: higher wins when one GM click produces several cues.
export const CUES = {
  wheel_spin: { priority: 3, steps: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5], len: 0.5, gain: 0.25, tick: true },
  wheel_land: { priority: 3, steps: [5, null, 5], len: 1.6, gain: 0.5 },
  coin:       { priority: 2, steps: [3, 5], len: 0.9, gain: 0.45 },
  jackpot:    { priority: 5, steps: [0, 2, 3, 5, 3, 5, 5], len: 1.2, gain: 0.6, sparkle: true },
  win:        { priority: 4, steps: [0, 2, 3, 5], len: 1.1, gain: 0.55, sparkle: true },
  lose:       { priority: 2, steps: [2, 0], len: 1.4, gain: 0.4, down: true },
  lose_game:  { priority: 4, steps: [3, 2, 1, 0], len: 1.5, gain: 0.5, down: true },
  push:       { priority: 3, steps: [2, 2], len: 0.8, gain: 0.35 },
  jail:       { priority: 5, steps: [0, 0, null, 0], len: 2.2, gain: 0.6, down: true, low: true },
  free:       { priority: 4, steps: [0, 3, 5], len: 1.0, gain: 0.5, sparkle: true },
  chaos:      { priority: 6, steps: [5, 0, 4, 1, 3, 2, 5, 0], len: 0.7, gain: 0.6, low: true, down: true },
  void:       { priority: 5, steps: [5, 4, 3, 2, 1, 0], len: 1.3, gain: 0.5, low: true },
  battle:     { priority: 4, steps: [0, 0, 3, 0, 5], len: 0.9, gain: 0.55 },
  powerup:    { priority: 3, steps: [1, 3, 5], len: 0.7, gain: 0.45, sparkle: true },
  shop:       { priority: 1, steps: [3, 4], len: 0.6, gain: 0.3 },
  turn:       { priority: 1, steps: [1], len: 0.7, gain: 0.25 },
  card:       { priority: 2, steps: [4], len: 0.25, gain: 0.3, tick: true },
  peg:        { priority: 1, steps: [5], len: 0.2, gain: 0.2, tick: true },
  drop:       { priority: 2, steps: [5, 3], len: 0.5, gain: 0.3 },
  launch:     { priority: 3, steps: [0, 1, 2, 3, 4, 5], len: 0.6, gain: 0.45 },
  explode:    { priority: 5, steps: [5, 0], len: 2.0, gain: 0.6, low: true, down: true },
  gem:        { priority: 2, steps: [4, 5], len: 0.5, gain: 0.35, sparkle: true },
  fanfare:    { priority: 6, steps: [0, 0, 2, 3, null, 3, 5], len: 1.4, gain: 0.6, sparkle: true },
};

const semis = (root, n) => root * Math.pow(2, n / 12);

// Pure: the notes that make up one cue in one pack.
export function renderCue(cue, pack) {
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
const round = (x) => Math.round(x * 1000) / 1000;
export const cueLength = (notes) => notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);

// ── State diff → cues ────────────────────────────────────────────
const LEDGER_CUES = {
  JAIL_IN: 'jail', JAIL_OUT: 'free', JAIL_ESCALATE: 'jail', CHAOS: 'chaos', CHAOS_UNDO: 'void', VOID_TRIGGER: 'void',
  SHOP_BUY_POWERUP: 'powerup', POWERUP_USED: 'powerup', SHOP_EXCHANGE: 'shop', TURN_END: 'turn',
  SESSION_START: 'fanfare', SESSION_END: 'fanfare', SOUND_TEST: 'fanfare', LOAN: 'coin', LOAN_DEFAULT: 'jail', LOAN_PAID: 'free', CONTEST: 'battle', AUCTION_START: 'battle', AUCTION_END: 'fanfare', PET_HATCH: 'fanfare', PET_LEVEL: 'powerup', PET_CAPTURE: 'fanfare', PET_EVOLVE: 'fanfare', RANK_UP: 'fanfare', SHOP_BUY_PET: 'powerup', PARDON_USED: 'free', AUCTION: 'coin', TRANSFER: 'coin',
};
function newLedgerRows(prev, next) {
  const last = prev.ledger.at(-1);
  if (!last) return next.ledger.slice(-20);
  // Rows carry a sequence number (state.log) — anything past prev's last one is new.
  if (last.n != null) return next.ledger.filter(r => r.n != null && r.n > last.n);
  // Saves from before sequence numbers: fall back to matching prev's last row by content.
  for (let i = next.ledger.length - 1; i >= 0; i--) {
    const r = next.ledger[i];
    if (r.ts === last.ts && r.type === last.type && r.playerId === last.playerId) return next.ledger.slice(i + 1);
    if (r.ts < last.ts) return next.ledger.slice(i + 1);
  }
  return next.ledger.slice(-20);
}
const allCards = (g) => !g || !g.view ? [] : [...(g.view.player || []), ...(g.view.dealer || []), ...(g.view.banker || []), ...(g.view.cards || []), ...(g.view.hands || []).flatMap(h => h.cards || [])].filter(c => c && c.t != null);

// Pure: what should be heard when the shared screen goes from `prev` to `next`.
// Returns [{ cue, at }] — `at` is an absolute ms timestamp (cards and pegs are scheduled ahead).
export function cuesFor(prev, next, now = Date.now(), { max = 4 } = {}) {
  if (!prev || !next) return [];            // first paint: never blast a backlog of sounds
  const out = [];
  const add = (cue, at = now) => out.push({ cue, at });

  if (next.lastSpin && next.lastSpin.ts !== prev.lastSpin?.ts) { add('wheel_spin'); add('wheel_land', now + 4300); }

  for (const r of newLedgerRows(prev, next)) {
    if (r.type === 'GAME' && 'won' in r) add(r.won ? 'win' : r.mult < 1 ? 'lose_game' : 'push');
    else if (r.type === 'CREDIT') add(r.cur === 'Gold' && r.amount >= 500 ? 'jackpot' : 'coin');
    else if (r.type === 'DEBIT') add('lose');
    else if (r.type === 'BATTLE' && r.won) add('battle');
    else if (LEDGER_CUES[r.type]) add(LEDGER_CUES[r.type]);
  }

  // Pet battle: one cue per new log line
  const pb = next.petBattle, ppb = prev.petBattle;
  if (pb && (!ppb || ppb.id !== pb.id)) add('battle');
  if (pb && ppb && ppb.id === pb.id && pb.log.length !== ppb.log.length) {
    const seen = new Set(ppb.log.map(l => l.text));
    for (const l of pb.log.filter(x => !seen.has(x.text))) add({ crit: 'explode', hit: 'lose', miss: 'push', mend: 'free', guard: 'shop', end: 'fanfare', status: 'void' }[l.kind] || 'turn');
  }
  const au = next.auction, pau = prev.auction;
  if (au && pau && au.id === pau.id && au.log.length !== pau.log.length) add(/Going/.test(au.log.at(-1)) ? 'turn' : /SOLD/.test(au.log.at(-1)) ? 'jackpot' : 'coin');
  const rd = next.raid, prd = prev.raid;
  if (rd && (!prd || prd.id !== rd.id)) add('chaos');
  if (rd && prd && prd.id === rd.id && rd.log.length !== prd.log.length) {
    const seen = new Set(prd.log.map(l => l.text));
    for (const l of rd.log.filter(x => !seen.has(x.text))) add({ crit: 'explode', hit: 'lose', miss: 'push', mend: 'free', guard: 'shop', end: 'fanfare', status: 'void' }[l.kind] || 'turn');
  }
  const pg = prev.game, ng = next.game;
  if (ng) {
    const seen = new Set(allCards(pg && pg.id === ng.id && pg.startedTs === ng.startedTs ? pg : null).map(c => `${c.r}${c.s}@${c.t}`));
    for (const c of allCards(ng)) if (!seen.has(`${c.r}${c.s}@${c.t}`)) add('card', Math.max(now, c.t));
    const flip = ng.view?.dealer?.[1]?.flipAt, hadFlip = pg?.view?.dealer?.[1]?.flipAt;
    if (flip && !hadFlip) add('card', Math.max(now, flip));
    const d = ng.view?.drop;
    if (d && d.ts !== pg?.view?.drop?.ts) {
      add('drop', Math.max(now, d.ts));
      for (let i = 1; i <= d.path.length; i++) add('peg', Math.max(now, d.ts + i * PLINKO_STEP_MS));
    }
    if (ng.view?.rollAt && ng.view.rollAt !== pg?.view?.rollAt) { add('launch'); add('wheel_land', Math.max(now, ng.view.revealAt || now)); }
    if (ng.view?.spinAt && ng.view.spinAt !== pg?.view?.spinAt) { add('launch'); for (const ms of SLOTS_REEL_MS) add('card', Math.max(now, ng.view.spinAt + ms)); }
    if (ng.view?.drawAt && ng.view.drawAt !== pg?.view?.drawAt) for (let i = 1; i <= ng.view.draw.length; i++) add(ng.view.picks.includes(ng.view.draw[i - 1]) ? 'gem' : 'peg', Math.max(now, ng.view.drawAt + i * KENO_BALL_MS));
    if (ng.id === 'crash') {
      if (ng.phase === 'running' && pg?.phase !== 'running') add('launch');
      if (ng.phase === 'done' && pg?.phase === 'running') add(ng.view.crashed ? 'explode' : 'coin');
    }
    if (ng.id === 'mines' && pg?.id === 'mines') {
      if (ng.view.hit != null && pg.view.hit == null) add('explode');
      else if (ng.view.revealed.length > pg.view.revealed.length) add('gem');
    }
  }

  // Timed cues (cards, pegs, wheel landing) always play. Of the immediate ones keep the
  // loudest few, so one GM click never turns into a wall of noise.
  const timed = out.filter(c => c.at > now);
  const instant = out.filter(c => c.at <= now);
  const best = new Map();
  for (const c of instant) if (!best.has(c.cue)) best.set(c.cue, c);
  const kept = [...best.values()].sort((a, b) => CUES[b.cue].priority - CUES[a.cue].priority).slice(0, max);
  return [...kept, ...timed].sort((a, b) => a.at - b.at);
}

// ── WebAudio player (shared screen) ──────────────────────────────
export class SoundPlayer {
  constructor(AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.AudioCtx = AudioCtx; this.ctx = null; this.timers = new Set();
  }
  get supported() { return !!this.AudioCtx; }
  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }
  // Browsers only allow audio after a click in THIS window — call from a click handler.
  async unlock() {
    if (!this.supported) return false;
    if (!this.ctx) this.ctx = new this.AudioCtx();
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (_) {} }
    return this.unlocked;
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
  // Schedule a batch from cuesFor(). Returns how many cues were queued.
  schedule(cues, pack, settings = DEFAULT_SOUND, now = Date.now()) {
    if (!settings || settings.on === false) return 0;
    let n = 0;
    for (const c of cues) {
      const notes = renderCue(c.cue, pack); if (!notes.length) continue;
      const delay = Math.max(0, c.at - now);
      if (delay < 15) this.playNotes(notes, settings.volume);
      else { const id = setTimeout(() => { this.timers.delete(id); this.playNotes(notes, settings.volume); }, delay); this.timers.add(id); }
      n++;
    }
    return n;
  }
  cancelPending() { for (const id of this.timers) clearTimeout(id); this.timers.clear(); }
}
