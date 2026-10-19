// Synthesized placeholder sounds: one small WAV (48 kHz, 16-bit mono PCM) per cue in tools/asset-list.mjs
// SOUND_CUES, plus the nine music "loops" as short ambient drones. Every file carries a LIST/INFO chunk whose
// ICMT comment is `gwf-placeholder`, and assets/sound/.placeholders.json lists the sha1 of every file written,
// so real audio dropped in by filename is never overwritten. Deterministic: the noise generator is seeded by cue.
//   node tools/sounds.mjs           write assets/sound/*.wav
//   node tools/sounds.mjs --check   report what would change, exit 1 if anything
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, SOUND_CUES, MUSIC_LOOPS } from './asset-list.mjs';
import { hashKey, mulberry32 } from './png.mjs';

export const SAMPLE_RATE = 48000;
export const MUSIC_SECONDS = 2;       // the spec asks for 2–3 minute loops; placeholders are 2 s drones with fades to keep assets/ under ~6 MB
export const SIDECAR = 'assets/sound/.placeholders.json';
export const WAV_MARKER = 'gwf-placeholder';

// ── Recipes ────────────────────────────────────────────────────────
// A recipe is a list of voices: { t, dur, freq, wave, gain, slide? } or { t, dur, noise: true, gain, lp? }.
// `seq(root, steps, step, dur, wave, gain)` lays notes along a minor-ish scale from `root` Hz.
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const st = (root, n) => root * Math.pow(2, n / 12);
const seq = (root, steps, step, dur, wave = 'triangle', gain = 0.5, scale = SCALE) => steps.map((d, i) => d == null ? null : ({ t: i * step, dur, freq: st(root, scale[d % scale.length]) * (d >= scale.length ? 2 : 1), wave, gain })).filter(Boolean);
const tone = (t, dur, freq, wave = 'sine', gain = 0.5, slide = 1) => ({ t, dur, freq, wave, gain, slide });
const noise = (t, dur, gain = 0.4, lp = 0) => ({ t, dur, noise: true, gain, lp });

export const RECIPES = {
  hex_step: [noise(0, 0.04, 0.35, 0.6), tone(0, 0.09, 90, 'sine', 0.5, 0.7)],
  dice: [noise(0, 0.015, 0.5), noise(0.06, 0.015, 0.45), noise(0.13, 0.02, 0.4), tone(0.13, 0.05, 1200, 'triangle', 0.25)],
  wheel_ratchet: [0, 0.05, 0.11, 0.18, 0.26, 0.35, 0.45, 0.56].map(t => tone(t, 0.014, 2000, 'triangle', 0.35)),
  wheel_land: [...seq(220, [5, null, 5], 0.12, 0.5, 'triangle', 0.5), noise(0, 0.03, 0.3)],
  card_draw: [noise(0, 0.07, 0.35, 0.3), tone(0.02, 0.05, 800, 'sine', 0.15, 1.4)],
  hit: [tone(0, 0.14, 150, 'sine', 0.6, 0.5), noise(0, 0.05, 0.5, 0.4)],
  crit: [...seq(220, [0, 2, 4, 6], 0.07, 0.5, 'square', 0.35), ...seq(440, [0, 2, 4, 6], 0.07, 0.5, 'sine', 0.25), noise(0, 0.08, 0.4)],
  miss: seq(196, [2, 0], 0.16, 0.35, 'triangle', 0.4),
  death_bell: [tone(0, 1.2, 440, 'sine', 0.5), tone(0, 0.9, 1108, 'sine', 0.2), tone(0, 1.3, 220, 'sine', 0.35), noise(0, 0.02, 0.3)],
  lantern_gutter: [0, 0.05, 0.13, 0.18, 0.27, 0.3].map((t, i) => noise(t, 0.03 + (i % 2) * 0.02, 0.25, 0.5)),
  letter_sent: seq(392, [0, 4], 0.11, 0.3, 'sine', 0.4),
  letter_intercepted: [...seq(392, [4, 0], 0.11, 0.3, 'triangle', 0.4), noise(0.22, 0.08, 0.3, 0.5)],
  loot_common: seq(261.6, [0], 0.1, 0.35, 'triangle', 0.45),
  loot_rare: seq(261.6, [0, 2], 0.1, 0.4, 'triangle', 0.45),
  loot_epic: seq(261.6, [0, 2, 4], 0.1, 0.45, 'triangle', 0.5),
  loot_legendary: [...seq(261.6, [0, 2, 4, 7], 0.1, 0.6, 'triangle', 0.5), ...seq(523.2, [0, 2, 4, 7], 0.1, 0.5, 'sine', 0.25)],
  chaos_stinger: [...seq(110, [0, 1, 0, 6, 0], 0.14, 0.5, 'sawtooth', 0.4), tone(0, 0.9, 55, 'sawtooth', 0.3)],
  boss_roar: [tone(0, 0.9, 55, 'sawtooth', 0.5, 0.8), tone(0, 0.8, 82, 'square', 0.25, 0.8), noise(0, 0.7, 0.35, 0.7)],
  ui_tap_1: [tone(0, 0.04, 660, 'sine', 0.35)], ui_tap_2: [tone(0, 0.04, 784, 'sine', 0.35)], ui_tap_3: [tone(0, 0.04, 880, 'sine', 0.35)],
  ui_tap_4: [tone(0, 0.04, 523, 'sine', 0.35)], ui_tap_5: [tone(0, 0.05, 440, 'triangle', 0.35)], ui_tap_6: [tone(0, 0.03, 1046, 'sine', 0.3)],
  buzz: [tone(0, 0.25, 120, 'square', 0.4), tone(0, 0.25, 123, 'square', 0.3)],
  clock_warning: [tone(0, 0.08, 880, 'square', 0.35), tone(0.16, 0.08, 880, 'square', 0.35)],
  turn_start: seq(220, [1], 0.1, 0.45, 'triangle', 0.35),
  game_dice_roll: [0, 0.05, 0.11, 0.16, 0.24].map(t => noise(t, 0.015, 0.4)),
  game_dice_land: [noise(0, 0.03, 0.5), tone(0, 0.08, 500, 'triangle', 0.3, 0.6)],
  game_cards_flip: [noise(0, 0.05, 0.35, 0.3), tone(0.01, 0.04, 1200, 'sine', 0.15, 0.6)],
  game_cards_shuffle: [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28].map(t => noise(t, 0.03, 0.25, 0.4)),
  game_wheels_spin: seq(220, [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1], 0.06, 0.07, 'triangle', 0.3),
  game_wheels_land: seq(330, [5, null, 5], 0.12, 0.5, 'triangle', 0.5),
  game_nerve_tick: [tone(0, 0.03, 1500, 'square', 0.2)],
  game_nerve_boom: [tone(0, 0.7, 60, 'sine', 0.6, 0.4), noise(0, 0.4, 0.5, 0.6)],
  game_nerve_cashout: seq(392, [0, 2, 4], 0.06, 0.3, 'sine', 0.45),
  game_picks_drop: seq(440, [5, 3], 0.07, 0.2, 'triangle', 0.35),
  game_picks_peg: [tone(0, 0.03, 1760, 'triangle', 0.25)],
  game_picks_hit: seq(523, [4, 5], 0.07, 0.3, 'sine', 0.4),
};
// Music: drone roots per loop; three detuned voices, a fifth, an octave breath and a slow tremolo.
const MUSIC = { music_lobby: 110, music_strip: 98, music_docks: 87.3, music_blackwood: 82.4, music_caldera: 73.4, music_citadel: 123.5, music_fight: 92.5, music_boss: 65.4, music_recap: 130.8 };

// ── Synthesis ──────────────────────────────────────────────────────
function osc(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'square': return p < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * p - 1;
    case 'triangle': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    default: return Math.sin(2 * Math.PI * p);
  }
}
export function renderRecipe(voices, seed, { rate = SAMPLE_RATE } = {}) {
  const end = Math.max(...voices.map(v => v.t + v.dur)) + 0.05;
  const n = Math.ceil(end * rate), out = new Float64Array(n);
  const rnd = mulberry32(hashKey(seed));
  for (const v of voices) {
    const s0 = Math.floor(v.t * rate), len = Math.floor(v.dur * rate); let phase = 0, lpState = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const u = i / len, env = Math.min(1, i / (0.005 * rate)) * Math.exp(-4 * u);
      let x;
      if (v.noise) { const w = rnd() * 2 - 1; lpState += (w - lpState) * (1 - (v.lp || 0)); x = lpState; }
      else { const f = v.freq * (v.slide === 1 || v.slide == null ? 1 : Math.pow(v.slide, u)); phase += f / rate; x = osc(v.wave, phase); }
      out[s0 + i] += x * env * v.gain;
    }
  }
  return out;
}
export function renderDrone(root, seed, seconds = MUSIC_SECONDS, rate = SAMPLE_RATE) {
  const n = seconds * rate, out = new Float64Array(n), rnd = mulberry32(hashKey(seed));
  const voices = [[root, 0.28, 'sine'], [root * 1.003, 0.2, 'triangle'], [root * 0.997, 0.2, 'sine'], [root * 1.5, 0.12, 'sine'], [root * 2, 0.08, 'triangle'], [root * 3.01, 0.04, 'sine']];
  const phases = voices.map(() => rnd());
  for (let i = 0; i < n; i++) {
    const t = i / rate, trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t), fade = Math.min(1, t / 0.4, (seconds - t) / 0.4);
    let x = 0; voices.forEach(([f, g, w], k) => { phases[k] += f / rate; x += osc(w, phases[k]) * g; });
    out[i] = x * trem * fade;
  }
  return out;
}
export function encodeWAV(samples, { rate = SAMPLE_RATE, comment = WAV_MARKER } = {}) {
  let peak = 0; for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0.9 ? 0.9 / peak : 1;
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * norm * 32767))), i * 2);
  const icmt = Buffer.from(comment + '\0' + (comment.length % 2 ? '' : '\0'), 'latin1');
  const list = Buffer.concat([Buffer.from('LIST'), u32(4 + 8 + icmt.length), Buffer.from('INFO'), Buffer.from('ICMT'), u32(icmt.length), icmt]);
  const fmt = Buffer.concat([Buffer.from('fmt '), u32(16), u16(1), u16(1), u32(rate), u32(rate * 2), u16(2), u16(16)]);
  const data = Buffer.concat([Buffer.from('data'), u32(pcm.length), pcm]);
  return Buffer.concat([Buffer.from('RIFF'), u32(4 + fmt.length + list.length + data.length), Buffer.from('WAVE'), fmt, list, data]);
}
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; };
export const isPlaceholderWAV = (buf) => buf.subarray(0, 256).toString('latin1').includes(WAV_MARKER);
export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

export function renderCueFile(cue) {
  if (MUSIC[cue]) return encodeWAV(renderDrone(MUSIC[cue], cue));
  const r = RECIPES[cue]; if (!r) throw new Error(`no recipe for cue ${cue}`);
  return encodeWAV(renderRecipe(r, cue));
}
export const ALL_CUES = [...SOUND_CUES, ...MUSIC_LOOPS];

export function generate({ check = false, quiet = false } = {}) {
  const dir = path.join(ROOT, 'assets/sound'); if (!check) mkdirSync(dir, { recursive: true });
  const stats = { new: 0, same: 0, updated: 0, kept: 0 }, hashes = {}, changed = []; let bytes = 0;
  for (const cue of ALL_CUES) {
    const abs = path.join(dir, `${cue}.wav`), buf = renderCueFile(cue); bytes += buf.length;
    let write = true;
    if (existsSync(abs)) { const cur = readFileSync(abs); if (cur.equals(buf)) { stats.same++; write = false; } else if (!isPlaceholderWAV(cur)) { stats.kept++; write = false; } else stats.updated++; }
    else stats.new++;
    if (write) { changed.push(`assets/sound/${cue}.wav`); if (!check) writeFileSync(abs, buf); }
    if (write || isPlaceholderWAV(readFileSync(abs))) hashes[`${cue}.wav`] = sha1(buf);
  }
  const side = JSON.stringify({ _about: 'sha1 of every placeholder WAV tools/sounds.mjs wrote; a file whose hash differs is real audio and is left alone.', files: Object.fromEntries(Object.entries(hashes).sort()) }, null, 2) + '\n';
  const sideAbs = path.join(ROOT, SIDECAR);
  if (!existsSync(sideAbs) || readFileSync(sideAbs, 'utf8') !== side) { changed.push(SIDECAR); if (!check) writeFileSync(sideAbs, side); }
  if (!quiet) console.log(`sound ${ALL_CUES.length} files (${SOUND_CUES.length} cues + ${MUSIC_LOOPS.length} loops), ${(bytes / 1024).toFixed(0)} KB  new ${stats.new}  same ${stats.same}  updated ${stats.updated}  real-audio-kept ${stats.kept}`);
  return { stats, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'); const t0 = Date.now();
  const { changed } = generate({ check }); console.log(`${check ? 'checked' : 'wrote'} in ${Date.now() - t0} ms`);
  if (check && changed.length) process.exit(1);
}
