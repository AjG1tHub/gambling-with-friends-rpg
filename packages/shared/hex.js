// Axial hex coordinates, pointy-top. A hex is {q, r}; its key is "q,r". Six directions in rosette order
// starting at the top-right and going clockwise, so the phone's six buttons map 1:1 to DIRS.
export const DIRS = [
  { q: 1, r: -1, name: 'NE' }, { q: 1, r: 0, name: 'E' }, { q: 0, r: 1, name: 'SE' },
  { q: -1, r: 1, name: 'SW' }, { q: -1, r: 0, name: 'W' }, { q: 0, r: -1, name: 'NW' },
];
export const key = (h) => `${h.q},${h.r}`;
export const parse = (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; };
export const eq = (a, b) => a.q === b.q && a.r === b.r;
export const add = (a, b) => ({ q: a.q + b.q, r: a.r + b.r });
export const neighbor = (h, i) => add(h, DIRS[((i % 6) + 6) % 6]);
export const neighbors = (h) => DIRS.map(d => add(h, d));
export const toCube = (h) => ({ x: h.q, z: h.r, y: -h.q - h.r });
export const distance = (a, b) => { const A = toCube(a), B = toCube(b); return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z)); };

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { q: rx, r: rz };
}
// Every hex on the straight line from a to b, inclusive. Used by Corvette Broadside and reach checks.
export function line(a, b) {
  const n = distance(a, b); if (n === 0) return [a];
  const A = toCube(a), B = toCube(b), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(cubeRound(A.x + (B.x - A.x) * t + 1e-6, A.y + (B.y - A.y) * t + 1e-6, A.z + (B.z - A.z) * t - 2e-6)); }
  return out;
}
// Hexes at exactly `radius` from the centre, walking the ring clockwise.
export function ring(center, radius) {
  if (radius === 0) return [center];
  const out = []; let h = add(center, { q: DIRS[4].q * radius, r: DIRS[4].r * radius });
  for (let side = 0; side < 6; side++) for (let i = 0; i < radius; i++) { out.push(h); h = neighbor(h, side); }
  return out;
}
// Every hex within `radius` (a filled hexagon), centre first.
export function range(center, radius) { const out = []; for (let r = 0; r <= radius; r++) out.push(...ring(center, r)); return out; }
// Direction index (0-5) from a to an adjacent b, or -1.
export function dirIndex(a, b) { const d = { q: b.q - a.q, r: b.r - a.r }; return DIRS.findIndex(x => x.q === d.q && x.r === d.r); }

// Breadth-first search over passable hexes. `passable(key)` says whether a hex may be entered;
// `maxSteps` bounds the search. Returns { dist: Map(key → steps), prev: Map(key → key) }.
export function bfs(start, passable, maxSteps = Infinity) {
  const s = key(start), dist = new Map([[s, 0]]), prev = new Map(), queue = [start];
  while (queue.length) {
    const h = queue.shift(), d = dist.get(key(h));
    if (d >= maxSteps) continue;
    for (const n of neighbors(h)) { const k = key(n); if (dist.has(k) || !passable(k, n)) continue; dist.set(k, d + 1); prev.set(k, key(h)); queue.push(n); }
  }
  return { dist, prev };
}
// Shortest path from a to b as a list of keys excluding a, or null. `passable(key, hex)` as in bfs.
export function path(a, b, passable, maxSteps = 64) {
  const { dist, prev } = bfs(a, passable, maxSteps), target = key(b);
  if (!dist.has(target)) return null;
  const out = []; let cur = target; const start = key(a);
  while (cur !== start) { out.unshift(cur); cur = prev.get(cur); }
  return out;
}
// Hexes reachable in at most n steps (keys), excluding the start.
export function reachable(start, n, passable) { const { dist } = bfs(start, passable, n); dist.delete(key(start)); return [...dist.keys()]; }

// Pixel layout for pointy-top hexes of the given size (centre to corner).
export function toPixel(h, size) { return { x: size * (Math.sqrt(3) * h.q + Math.sqrt(3) / 2 * h.r), y: size * (1.5 * h.r) }; }
export function fromPixel(x, y, size) { const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size, r = (2 / 3 * y) / size; return cubeRound(q, -q - r, r); }
export function corners(cx, cy, size) { return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return [cx + size * Math.cos(a), cy + size * Math.sin(a)]; }); }
export const polygonPoints = (cx, cy, size) => corners(cx, cy, size).map(p => p.map(v => Math.round(v * 10) / 10).join(',')).join(' ');
