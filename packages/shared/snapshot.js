// Snapshots and shared objects. In a running room one object is often reachable two ways: a worn weapon is both
// c.worn.mainhand and c.items[id], and the handlers count on a change through one showing through the other (a
// charge spent in a fight). A snapshot travels as JSON, which writes that object out twice, so a phone that
// reloaded and started from the snapshot held two copies and drifted from the table: its worn weapon kept the old
// charges while the TV's went down (found 19 Nov by replaying bot games through a snapshot every 25 events).
//
// pack() notes every object that is reachable by more than one path; unpack() points the later paths back at the
// first. A snapshot from before this (no __aliases) gets the one link we know of: worn → items.
const isObj = (v) => v && typeof v === 'object';

export function pack(state) {
  const first = new Map(), aliases = [], nonfinite = [];
  const walk = (v, path) => {
    if (typeof v === 'number' && !Number.isFinite(v)) { nonfinite.push([path, String(v)]); return; }   // JSON writes Infinity as null: a monster's endless charges
    if (!isObj(v)) return;
    const seen = first.get(v); if (seen) { aliases.push([seen, path]); return; }
    first.set(v, path);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i])); else for (const k of Object.keys(v)) if (k !== '__aliases' && k !== '__nonfinite') walk(v[k], [...path, k]);
  };
  walk(state, []);
  return { ...state, __aliases: aliases, __nonfinite: nonfinite };
}

const at = (root, path) => { let o = root; for (const k of path) { if (!isObj(o)) return undefined; o = o[k]; } return o; };
export function unpack(snap) {
  if (!isObj(snap)) return snap;
  const aliases = Array.isArray(snap.__aliases) ? snap.__aliases : null; delete snap.__aliases;
  const nonfinite = Array.isArray(snap.__nonfinite) ? snap.__nonfinite : null; delete snap.__nonfinite;
  if (nonfinite) for (const [path, v] of nonfinite) { const holder = at(snap, path.slice(0, -1)); if (isObj(holder)) holder[path.at(-1)] = Number(v); }
  else for (const m of Object.values(snap.monsters || {})) for (const it of m.items || []) if (it && it.charges == null) it.charges = Infinity;
  // An older room kept visited regions as properties on an array, which JSON drops; they are a plain map now.
  for (const c of Object.values(snap.characters || {})) if (Array.isArray(c.visitedRegions)) c.visitedRegions = { ...c.visitedRegions };
  if (aliases) {
    for (const [from, to] of aliases) { const target = at(snap, from), holder = at(snap, to.slice(0, -1)); if (isObj(target) && isObj(holder)) holder[to.at(-1)] = target; }
  } else {
    for (const c of Object.values(snap.characters || {})) for (const [slot, it] of Object.entries(c.worn || {})) if (it && c.items?.[it.id]) c.worn[slot] = c.items[it.id];
  }
  return snap;
}
