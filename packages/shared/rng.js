// Seeded randomness. One room seed fans out into named streams (map, loot, wheels, dice, colours,
// challenge, games, pets, misc) so that rigging or replaying one purpose never shifts another.
// mulberry32 is the same generator the legacy build used; its whole state is one 32-bit int, which is
// why a stream's position can live inside the room state and travel with it.
export const STREAMS = ['map', 'loot', 'wheels', 'dice', 'colours', 'challenge', 'games', 'pets', 'monsters', 'creation', 'misc'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, getState: () => a >>> 0, setState: (s) => { a = s >>> 0; } };
}

// A full rng object over a raw generator: int (inclusive), pick, chance, shuffle, weighted.
export function wrap(gen) {
  const r = {
    next: gen.next, getState: gen.getState, setState: gen.setState,
    int: (min, max) => min + Math.floor(gen.next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(gen.next() * arr.length)],
    chance: (p) => gen.next() < p,
    shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(gen.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    weightedIndex: (items, key = 'weight') => weightedIndex(r, items, key),
    weightedPick: (items, key = 'weight') => items[weightedIndex(r, items, key)],
  };
  return r;
}
export const makeRng = (seed) => wrap(mulberry32(seed));

export function weightedIndex(rng, items, weightKey = 'weight') {
  const total = items.reduce((s, it) => s + Number(it[weightKey] || 0), 0);
  if (total <= 0) return Math.floor(rng.next() * items.length);
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) { roll -= Number(items[i][weightKey] || 0); if (roll < 0) return i; }
  return items.length - 1;
}
export const weightedPick = (rng, items, key = 'weight') => items[weightedIndex(rng, items, key)];
export function shuffle(rng, arr) { return wrap(rng).shuffle ? wrap(rng).shuffle(arr) : arr.slice(); }

// Hash a string to a 32-bit seed (FNV-1a). Room codes, item seeds and sub-streams derive this way.
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Stream table for a room: every stream starts at a seed derived from the room seed and its name.
export function makeStreams(seed) {
  const out = {};
  for (const s of STREAMS) out[s] = hash32(`${seed >>> 0}:${s}`);
  return out;
}

// Bind an rng to a stream stored in `state.rng`. Every call advances the stored position, so any
// client replaying the same events draws the same numbers. The GM's rig for a stream is a queue of
// forced results: `rigged(state, stream)` hands the next one out (or null) before the stream is asked.
export function streamRng(state, stream) {
  if (!state.rng) state.rng = makeStreams(state.seed || 1);
  if (state.rng[stream] == null) state.rng[stream] = hash32(`${state.seed}:${stream}`);
  const gen = mulberry32(state.rng[stream]);
  const base = wrap({ next: () => { const v = gen.next(); state.rng[stream] = gen.getState(); return v; }, getState: gen.getState, setState: gen.setState });
  return base;
}
export function rig(state, stream, value) { (state.rig ||= {}); (state.rig[stream] ||= []).push(value); }
export function rigged(state, stream) {
  const q = state.rig?.[stream];
  if (!q || !q.length) return null;
  const v = q.shift();
  if (!q.length) delete state.rig[stream];
  return { value: v };
}
// Weighted pick that honours a rig: a rigged label or index wins, otherwise the stream decides.
export function rigAwareWeightedIndex(state, stream, items, key = 'weight') {
  const r = rigged(state, stream);
  if (r) {
    const v = r.value;
    if (typeof v === 'number' && items[v]) return v;
    const i = items.findIndex(it => it.label === v || it.id === v);
    if (i >= 0) return i;
  }
  return weightedIndex(streamRng(state, stream), items, key);
}
// Integer draw that honours a rig (used for dice and movement rolls).
export function rigAwareInt(state, stream, min, max) {
  const r = rigged(state, stream);
  if (r && Number.isFinite(Number(r.value))) return Math.max(min, Math.min(max, Math.round(Number(r.value))));
  return streamRng(state, stream).int(min, max);
}
