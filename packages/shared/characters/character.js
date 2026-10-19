// Characters: the shape, XP and levels, stats and titles (SPEC.md › Characters, Classes). Everything that
// changes Health goes through health.js; numbers come from ctx.B('xp' | 'health' | 'stats' | 'grid' | 'creation').
// This module owns XP application: other modules call `levelHooks.onXp` with { charId, amount, why } and the
// consumer pushed here applies it.
import classesData from '../../../data/classes.json' with { type: 'json' };
import setsData from '../../../data/sets.json' with { type: 'json' };
import { maxHealth as moveMaxHealth } from '../health.js';
import { group } from '../balance.js';
import { levelHooks } from '../hooks.js';
import { note, playerOfCharacter } from '../state.js';
import { resize } from './grid.js';

export const STAT_IDS = ['luck', 'nerve', 'greed', 'grit'];
export const WORN_SLOTS = ['mainhand', 'offhand', 'spell1', 'spell2', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring1', 'ring2', 'ring3', 'ring4', 'necklace', 'cape'];
export const CLASSES = classesData.classes;
export const CLASS_IDS = CLASSES.map(c => c.id);
export const classDef = (id) => CLASSES.find(c => c.id === id) || null;
export const SETS = setsData.sets;
export const setDef = (id) => SETS.find(s => s.id === id) || null;

export function emptyWorn() { const w = {}; for (const s of WORN_SLOTS) w[s] = null; return w; }
export function defaultLook() { return { body: 0, skin: 0, face: 0, hair: 0, coat: '#5a1e1e' }; }
// Look ranges match the sprite sheets (SPEC.md › Character sprites): 3 builds, 4 skins, 8 faces, 12 hairstyles.
export const LOOK_RANGES = { body: 3, skin: 4, face: 8, hair: 12 };
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
export function cleanLook(look = {}) {
  const d = defaultLook(); const n = (v, max, dflt) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(0, Math.min(max - 1, x)) : dflt; };
  const coat = typeof look.coat === 'string' && HEX_COLOUR.test(look.coat) ? look.coat.toLowerCase() : d.coat;
  return { body: n(look.body, LOOK_RANGES.body, d.body), skin: n(look.skin, LOOK_RANGES.skin, d.skin), face: n(look.face, LOOK_RANGES.face, d.face), hair: n(look.hair, LOOK_RANGES.hair, d.hair), coat };
}

// A fresh level-1 character. `classId` may be null until CHAR_CLASS; the class bonus is applied by setClass.
export function newCharacter(state, ctx, { playerId, name, look, classId = null, crest = '🂠', id = null }) {
  const S = ctx.B('stats'), H = ctx.B('health'), G = ctx.B('grid'), C = ctx.B('creation');
  const stats = {}; for (const s of STAT_IDS) stats[s] = S.creationStart;
  const c = {
    id: id || `c-${playerId}`, playerId, rosterId: null, name: String(name || '').trim(), crest: crest || '🂠', look: cleanLook(look), classId: null,
    level: 1, xp: 0, statPoints: 0, stats,
    health: H.maxAtLevel1, maxHealth: H.maxAtLevel1, shield: 0, gold: ctx.B('gold').startingGold, bank: 0, chips: C.chips,
    pos: null, lastSafePos: null, region: null,
    worn: emptyWorn(), grid: { cols: G.cols, rows: G.rows, cells: [] }, items: {},
    pets: [], activePetId: null,
    dead: false, missTurns: 0, deaths: 0, graveyardPos: null, diedTo: null,
    cooldowns: { active: 0 }, activeUses: {}, effects: [],
    pactIds: [], wanted: 0, kills: 0, titles: [], quests: [], upgrades: [],
    usedThisTurn: { attack: 0, spell: 0, moved: false }, turnsTaken: 0, streak: 0,
    freeRestakeUsed: false, freeSmokeBombs: 0, buyinSpun: false, locked: false, veteran: false,
    setBonuses: {}, passives: {}, flags: {}, pendingLoot: [], gridEffects: [], hatching: null,
    creation: { gambles: [], blooded: false, bloodStaked: 0, alloc: null, lockedAt: null, auto: false },
  };
  if (classId) setClass(state, ctx, c, classId);
  return c;
}

// Changing class moves the +1 class stat bonus; allowed only before lock (the handler checks).
export function setClass(state, ctx, c, classId) {
  const def = classDef(classId); if (!def) throw new Error(`no such class ${classId}`);
  const S = ctx.B('stats');
  if (c.classId) { const old = classDef(c.classId); if (old) c.stats[old.stat] = Math.max(S.min, c.stats[old.stat] - S.classBonus); }
  c.classId = classId; c.stats[def.stat] = Math.min(S.max, c.stats[def.stat] + S.classBonus);
  return c;
}

// XP needed to go from `level` to the next: perLevelBase × level (100, 200, 300 …).
export const xpToNext = (level, X) => X.perLevelBase * Math.max(1, level);

export function giveXp(state, ctx, c, amount, why = '') {
  if (!c) return 0;
  const X = ctx.B('xp');
  let gain = Math.max(0, Math.round(Number(amount) || 0));
  const xpBonus = wornAffixes(c).filter(a => a.kind === 'economy' && a.effect === 'xp').reduce((s, a) => s + Number(a.value || 0), 0);
  if (xpBonus) gain = Math.round(gain * (1 + xpBonus));
  if (!gain || c.level >= X.levelCap) { if (c.level >= X.levelCap) c.xp = 0; return 0; }
  c.xp += gain;
  let levels = 0;
  while (c.level < X.levelCap && c.xp >= xpToNext(c.level, X)) { c.xp -= xpToNext(c.level, X); levelUp(state, ctx, c); levels++; }
  if (c.level >= X.levelCap) c.xp = 0;
  titleCheck(state, ctx, c);
  return levels;
}

function levelUp(state, ctx, c) {
  const X = ctx.B('xp'), H = ctx.B('health'), G = ctx.B('grid');
  c.level += 1;
  c.statPoints = (c.statPoints || 0) + X.statPointsPerLevel;
  moveMaxHealth(state, c, H.maxPerLevel, `level ${c.level}`, ctx);
  if (G.rowLevels.includes(c.level)) c.grid.rows += 1;
  unlockUpgrades(c, X);
  recomputePassives(state, ctx, c);
  const p = playerOfCharacter(state, c.id);
  note(state, `${c.name} reaches level ${c.level}`, 'level', ctx.now);
  for (const h of levelHooks.onLevel) h(state, ctx, { charId: c.id, playerId: p?.id || c.playerId, level: c.level });
}
export function unlockUpgrades(c, X) {
  const def = classDef(c.classId); if (!def) return;
  c.upgrades = c.upgrades || [];
  for (const u of def.upgrades) if (c.level >= u.level && X.upgradeLevels.includes(u.level) && !c.upgrades.includes(u.id)) c.upgrades.push(u.id);
}
export const hasUpgrade = (c, id) => !!c?.upgrades?.includes(id);

export function spendStatPoint(state, ctx, c, stat) {
  const S = ctx.B('stats');
  if (!STAT_IDS.includes(stat)) throw new Error(`no such stat ${stat}`);
  if ((c.statPoints || 0) <= 0) throw new Error('no stat points to spend');
  if (c.stats[stat] >= S.max) throw new Error(`${stat} is already ${S.max}`);
  c.statPoints -= 1; c.stats[stat] += 1;
  return c.stats[stat];
}

// A level lost to a player or boss kill: the class upgrade for that level goes with it, max Health comes down,
// an unspent point is taken first. Stats already spent stay. The grid row is taken back only if it is empty.
export function loseLevel(state, ctx, c, levels = 1) {
  const X = ctx.B('xp'), H = ctx.B('health'), G = ctx.B('grid');
  for (let i = 0; i < levels && c.level > 1; i++) {
    const from = c.level; c.level -= 1; c.xp = 0;
    moveMaxHealth(state, c, -H.maxPerLevel, `lost level ${from}`, ctx);
    if (c.statPoints > 0) c.statPoints -= 1;
    const def = classDef(c.classId);
    if (def) c.upgrades = (c.upgrades || []).filter(id => (def.upgrades.find(u => u.id === id)?.level || 0) <= c.level);
    if (G.rowLevels.includes(from)) { try { resize(c, c.grid.cols, c.grid.rows - 1, { maxCols: G.maxCols }); } catch { /* keep the row until it empties */ } }
  }
  recomputePassives(state, ctx, c);
  return c.level;
}

// Worn items and their affixes, flattened (the hot path for the damage hooks).
export const wornItems = (c) => WORN_SLOTS.map(s => c?.worn?.[s]).filter(Boolean);
export function wornAffixes(c) { const out = []; for (const it of wornItems(c)) for (const a of it.affixes || []) out.push(a); return out; }

// Base stats + set piece stats + Amulet of Potency + Infernal Mantle, clamped to the stat range.
export function effectiveStats(state, c, B = null) {
  const S = B?.stats || groupSafe(state, 'stats'), SETS_B = B?.sets || groupSafe(state, 'sets'), L = B?.legendaries || groupSafe(state, 'legendaries');
  const out = { ...c.stats };
  for (const it of wornItems(c)) {
    const set = it.setId ? setDef(it.setId) : null;
    if (set) for (const eff of set.perPiece) if (eff.kind === 'stat' && eff.stat) out[eff.stat] += Number(SETS_B[eff.valueKey] || 0);
    if (it.legendaryId === 'amuletofpotency') for (const s of STAT_IDS) out[s] += L.potencyStats;
    if (it.legendaryId === 'infernalmantle') out.grit += L.mantleGrit;
  }
  for (const s of STAT_IDS) out[s] = Math.max(S.min, Math.min(S.max, out[s]));
  return out;
}
const groupSafe = (state, g) => group(state, g);

// Set bookkeeping: { [setId]: { pieces, complete } } recomputed on every worn change.
export function recomputeSets(state, ctx, c) {
  const need = ctx.B('sets').pieces; const counts = {};
  for (const it of wornItems(c)) if (it.setId) counts[it.setId] = (counts[it.setId] || 0) + 1;
  c.setBonuses = {}; for (const [id, n] of Object.entries(counts)) c.setBonuses[id] = { pieces: n, complete: n >= need };
  return c.setBonuses;
}
export const hasSetBonus = (c, setId) => !!c?.setBonuses?.[setId]?.complete;

// Derived passives other modules read instead of re-deriving: reach, movement bonus, Caldera immunity, clock
// seconds, stake cap, maxHealth bonus. Recomputed on level and worn changes.
export function recomputePassives(state, ctx, c) {
  const I = ctx.B('items'), L = ctx.B('legendaries'), A = wornAffixes(c);
  let reach = I.reachDefault;
  if (hasUpgrade(c, 'longarm')) reach = Math.max(reach, I.reachLongArm);
  const pedestal = wornItems(c).find(it => it.legendaryId === 'pedestalblade');
  if (pedestal && c.maxHealth && c.health / c.maxHealth >= L.pedestalFullHealth) reach = Math.max(reach, L.pedestalReach);
  c.passives = {
    reach,
    moveBonus: (hasSetBonus(c, 'hide') ? ctx.B('sets').hideMove : 0) - (wornItems(c).some(it => it.legendaryId === 'broadside') ? L.broadsideMovePenalty : 0),
    calderaImmune: wornItems(c).some(it => it.legendaryId === 'infernalmantle'),
    clockSeconds: A.filter(a => a.kind === 'utility' && a.effect === 'nerveSeconds').reduce((s, a) => s + Number(a.value || 0), 0),
    stakeCap: A.filter(a => a.kind === 'utility' && a.effect === 'stakeCap').reduce((m, a) => Math.min(m, Number(a.value || Infinity)), Infinity),
    peeks: A.filter(a => a.kind === 'utility' && a.effect === 'peek').reduce((s, a) => s + Number(a.value || 0), 0),
    tempo: A.filter(a => a.kind === 'tempo').reduce((s, a) => s + Number(a.value || 0), 0),
    minStakeAgainst: wornItems(c).some(it => it.legendaryId === 'croupierscoat') ? L.coatMinStake : 0,
    pipBuoy: wornItems(c).some(it => it.legendaryId === 'pipbuoy') ? L.pipBuoyRange : 0,
    waterWalk: wornItems(c).some(it => it.legendaryId === 'deepseasuit'),
    digs: wornItems(c).some(it => it.legendaryId === 'blockbreaker') ? 1 : 0,
    sets: Object.keys(c.setBonuses || {}).filter(id => c.setBonuses[id].complete),
  };
  if (c.passives.stakeCap === Infinity) c.passives.stakeCap = null;
  return c.passives;
}

// Titles (SPEC.md › Characters): earned from the recap counters in state.stats, kept forever on the character.
export const TITLES = [
  { id: 'glasscannon', name: 'Glass Cannon', when: (s, c, X) => s.damageDealt >= X.titleDamage && s.deaths >= 1 },
  { id: 'undying', name: 'Undying', when: (s, c, X) => s.turns >= X.titleTurns && s.deaths === 0 },
  { id: 'dragonslayer', name: 'Dragon Slayer', when: (s, c, X) => s.bosses >= X.titleBosses },
  { id: 'headhunter', name: 'Headhunter', when: (s, c, X) => s.kills >= X.titleKills },
  { id: 'sharpshooter', name: 'Sharpshooter', when: (s, c, X) => s.crits >= X.titleCrits },
  { id: 'tamer', name: 'Tamer', when: (s, c, X) => s.petsCaught >= X.titlePets },
  { id: 'tycoon', name: 'Tycoon', when: (s, c, X) => s.goldEarned >= X.titleGold },
  { id: 'duelist', name: 'Duelist', when: (s, c, X) => s.challengesWon >= X.titleChallenges },
  { id: 'punchingbag', name: 'Punching Bag', when: (s, c, X) => s.damageTaken >= X.titleDamage },
  { id: 'lazarus', name: 'Lazarus', when: (s, c, X) => s.deaths >= X.titleDeaths && !c.dead },
];
export function titleCheck(state, ctx, c) {
  const p = playerOfCharacter(state, c.id); const s = state.stats?.[p?.id || c.playerId]; if (!s) return [];
  const X = ctx.B('xp'); const earned = [];
  c.titles = c.titles || [];
  for (const t of TITLES) if (!c.titles.includes(t.name) && t.when(s, c, X)) { c.titles.push(t.name); earned.push(t.name); note(state, `${c.name} earns the title ${t.name}`, 'title', ctx.now); }
  return earned;
}

// Other modules award XP through the hook list; this is the only place XP is applied.
levelHooks.onXp.push((state, ctx, { charId, amount, why }) => { const c = state.characters[charId]; if (c) giveXp(state, ctx, c, amount, why); });
