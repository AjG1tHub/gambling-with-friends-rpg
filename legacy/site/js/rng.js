// Gambling With Friends — seeded RNG + weighted random (Phase 0)
// mulberry32: fast, seedable, good enough for a party game.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    getState: () => a >>> 0,
    setState: (s) => { a = s >>> 0; },
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

// Weighted pick: items = [{weight, ...}] → returns index
export function weightedIndex(rng, items, weightKey = 'weight') {
  const total = items.reduce((s, it) => s + Number(it[weightKey] || 0), 0);
  if (total <= 0) return Math.floor(rng.next() * items.length);
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= Number(items[i][weightKey] || 0);
    if (roll < 0) return i;
  }
  return items.length - 1;
}

export function weightedPick(rng, items, weightKey = 'weight') {
  return items[weightedIndex(rng, items, weightKey)];
}

// Fisher–Yates with seeded rng (used by chaos shuffles later)
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
