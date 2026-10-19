// Tunables. data/balance.json is the single source; every numeric knob in game code is read here.
// `B` is the flattened defaults (B.health.maxAtLevel1 === 100). A room may carry overrides from the
// GM config screen in `state.balance`; `bal(state, 'health.maxAtLevel1')` resolves override-then-default.
import raw from '../../data/balance.json' with { type: 'json' };

export const BALANCE_RAW = raw;
export const GROUPS = Object.keys(raw).filter(k => !k.startsWith('_'));

function flatten(src) {
  const out = {};
  for (const g of GROUPS) { out[g] = {}; for (const [k, def] of Object.entries(src[g])) out[g][k] = structuredClone(def.v); }
  return out;
}
export const B = flatten(raw);

// Every tunable as a flat list, for the config screen, the balance doc and the staleness test.
export function listTunables(src = raw) {
  const rows = [];
  for (const g of GROUPS) for (const [k, def] of Object.entries(src[g])) rows.push({ path: `${g}.${k}`, group: g, key: k, value: def.v, unit: def.unit, spec: def.spec, note: def.note });
  return rows;
}

export function bal(state, path) {
  const [g, k] = path.split('.');
  const o = state?.balance?.[g]?.[k];
  if (o !== undefined) return o;
  if (!(g in B) || !(k in B[g])) throw new Error(`unknown tunable ${path}`);
  return B[g][k];
}
// A whole group with the room's overrides applied (what the handlers normally use).
export function group(state, g) {
  if (!(g in B)) throw new Error(`unknown balance group ${g}`);
  return state?.balance?.[g] ? { ...B[g], ...state.balance[g] } : B[g];
}
// Rarity helpers that read the four rarity tunables in one place.
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const rarityKey = (rarity, prefix) => prefix + rarity.charAt(0).toUpperCase() + rarity.slice(1);
export const stakeFor = (state, rarity) => group(state, 'items')[rarityKey(rarity, 'stake')];
export const bonusFor = (state, rarity) => (rarity === 'common' ? 0 : group(state, 'items')[rarityKey(rarity, 'bonus')]);
export const affixCountFor = (state, rarity) => group(state, 'items')[rarityKey(rarity, 'affixes')];

// Validate an override object shape: same groups, same keys, same types as the defaults.
export function checkOverrides(overrides) {
  const problems = [];
  for (const [g, keys] of Object.entries(overrides || {})) {
    if (!(g in B)) { problems.push(`unknown group ${g}`); continue; }
    for (const [k, v] of Object.entries(keys || {})) {
      if (!(k in B[g])) { problems.push(`unknown tunable ${g}.${k}`); continue; }
      const def = B[g][k];
      if (Array.isArray(def) !== Array.isArray(v) || (!Array.isArray(def) && typeof def !== typeof v)) problems.push(`${g}.${k} should be ${Array.isArray(def) ? 'a list' : typeof def}`);
      else if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${g}.${k} is not a number`);
    }
  }
  return problems;
}
