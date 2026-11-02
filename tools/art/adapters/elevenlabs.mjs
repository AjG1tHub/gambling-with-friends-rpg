// ElevenLabs Sound Effects adapter for the ~40 cues in SOUND_CUES. Three variations per cue; the pick is by
// target length and loudness (closest to the cue's intended duration, then the one with the strongest peak
// that is not clipped); post.py normalises the pick to −16 LUFS, 44.1 kHz, 16-bit WAV.
//   ELEVENLABS_API_KEY   required
//   ELEVENLABS_SFX_MODEL optional model id (the endpoint picks its default when unset)
import { env } from '../lib.mjs';
import { request, charge, assertBudget } from './_http.mjs';

const COST = () => Number(env('ELEVENLABS_COST_SFX', 0.05));
const key = () => { const k = env('ELEVENLABS_API_KEY'); if (!k) throw new Error('ELEVENLABS_API_KEY missing from .env.local'); return k; };
// Intended length per cue, seconds (the prompt template can override with a `seconds:` line).
export const SECONDS = { hex_step: 0.4, dice: 0.8, wheel_ratchet: 1.2, wheel_land: 1.0, card_draw: 0.5, hit: 0.6, crit: 1.0, miss: 0.6, death_bell: 3.0, lantern_gutter: 1.2, letter_sent: 0.8, letter_intercepted: 1.0, loot_common: 0.8, loot_rare: 1.0, loot_epic: 1.4, loot_legendary: 2.2, chaos_stinger: 2.0, boss_roar: 2.5, buzz: 0.5, clock_warning: 1.0, turn_start: 0.8, game_dice_roll: 1.0, game_dice_land: 0.5, game_cards_flip: 0.4, game_cards_shuffle: 1.2, game_wheels_spin: 2.0, game_wheels_land: 0.8, game_nerve_tick: 0.3, game_nerve_boom: 1.4, game_nerve_cashout: 1.0, game_picks_drop: 0.5, game_picks_peg: 0.3, game_picks_hit: 0.6 };
const secondsFor = (cue) => SECONDS[cue] || (cue.startsWith('ui_tap') ? 0.25 : 0.8);

async function sfx(text, seconds) {
  assertBudget(COST());
  const body = { text: text.slice(0, 450), duration_seconds: Math.max(0.5, Math.min(22, seconds)), prompt_influence: Number(env('ELEVENLABS_PROMPT_INFLUENCE', 0.5)) };
  const m = env('ELEVENLABS_SFX_MODEL'); if (m) body.model_id = m;
  const buf = await request('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_44100', { method: 'POST', headers: { 'xi-api-key': key() }, body, expect: 'buffer', label: 'elevenlabs sfx' });
  charge(COST());
  return buf;   // raw 16-bit mono PCM at 44.1 kHz
}
const peakAndRms = (pcm) => { let peak = 0, sum = 0; const n = Math.floor(pcm.length / 2); for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; peak = Math.max(peak, Math.abs(v)); sum += v * v; } return { peak, rms: Math.sqrt(sum / Math.max(1, n)), seconds: n / 44100 }; };

export async function generate(row, prompt, { log = () => {}, variations = Number(env('ELEVENLABS_VARIATIONS', 3)) } = {}) {
  const cue = row.meta.cue; const want = secondsFor(cue);
  const takes = [];
  for (let i = 0; i < variations; i++) { log(`  sfx take ${i + 1}/${variations} (${want}s)`); const pcm = await sfx(prompt, want); takes.push({ pcm, ...peakAndRms(pcm) }); }
  // Pick: unclipped, then loudest RMS, then closest length.
  takes.sort((a, b) => (a.peak >= 0.999) - (b.peak >= 0.999) || b.rms - a.rms || Math.abs(a.seconds - want) - Math.abs(b.seconds - want));
  const pick = takes[0];
  return Object.assign(pick.pcm, { _format: 'pcm_s16le_44100_mono', _takes: takes.map(t => ({ peak: +t.peak.toFixed(3), rms: +t.rms.toFixed(4), seconds: +t.seconds.toFixed(2) })) });
}

export async function probe() { const r = await request('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key() }, label: 'elevenlabs subscription', retries: 1 }); return [`tier ${r.tier}: ${r.character_count}/${r.character_limit} characters used`]; }
