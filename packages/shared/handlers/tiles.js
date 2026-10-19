// Tile effects. The movement module resolves the hex a character ends on by calling
// tileHooks[hex.type](state, ctx, playerId, hex); every hook here ends with state.turnPhase = 'action' unless it
// opened a fight (state.fight) or a prompt (state.pendingPrompt). Also the monster-drop side of loot
// (lootHooks.onDrop), tile loot pickup, the Inn rest and the Shop shelf.
//
// Events: INN_REST { playerId? }            heal health.innHeal once per visit (Pit Boss 5+: twice)
//         TILE_TAKE_LOOT { itemId | null }  take an item lying on your hex, or answer a { kind: 'takeWorn' } prompt
//         TILE_LEAVE {}                     leave a tile's prompt un-answered (declines an Arena / Portal prompt)
// Prompts opened here (state.pendingPrompt): { playerId, kind: 'spin', wheel: 'fortune'|'fate'|'loot'|'chaos', hexKey }
//   { playerId, kind: 'arena', hexKey } (challenge module) · { playerId, kind: 'portal', from, to } (movement: PORTAL_PICK)
// Fights opened here: state.fight = { id, kind: 'encounter'|'boss'|'raid', monsterId, playerIds, playerId, turn: 'player',
//   game: null, log: [], done: false, startedAt } — the same shape FIGHT_START writes.
// Shop shelf: state.shops[hexKey] = { hexKey, regionId, openedRound, stock: [ { sku, name, priceKey, qty, spec } ] };
//   spec is a pendingLoot spec ({ baseId: 'potion'|'nudge'|'reroll'|'fork'|'smokebomb'|'phoenixfeather'|'petrevive'|
//   'satchel'|'spyglass', rarity } or { baseId: 'loot', rarity, region, seed } for gear).
// Tile loot: state.tileLoot[hexKey] = [ { ...item, droppedAt, round, by } ]; swept after death.tileLootRounds rounds.
import { register, refuse, requirePhase, requireActor } from '../reducer.js';
import { registerTile, lootHooks } from '../hooks.js';
import { characterOf, currentPlayerId, livingCharacters, allied, note } from '../state.js';
import { health, gold } from '../health.js';
import { streamRng } from '../rng.js';
import { RARITIES, rarityKey } from '../balance.js';
import * as hexm from '../hex.js';
import { monsterAt, markMonsterDead } from '../encounters/monsters.js';
import { spinWheel, rollLoot, rollRarity, grantLoot, pushLoot, regionOf, regionTier, counter } from './wheels.js';
import { hooks as runHooks } from './run.js';

export { rollLoot, rollRarity, grantLoot, pushLoot };

const SAFE = new Set(['inn', 'graveyard', 'start', 'shop', 'bloodbank', 'bounty']);
export const charactersOn = (state, hexKey) => livingCharacters(state).filter(c => c.pos === hexKey);
const action = (state) => { if (!state.fight && !state.pendingPrompt) state.turnPhase = 'action'; };

function visit(state, ctx, c, hex) {
  c.region = hex.regionId ?? c.region ?? null;
  (c.visitedRegions ||= {}); if (hex.regionId) c.visitedRegions[hex.regionId] = true;
  if (SAFE.has(hex.type)) c.lastSafePos = hex.key;
}
function need(state, playerId) { const c = characterOf(state, playerId); if (!c) refuse(`no character for ${playerId}`); return c; }

// ---- fights -----------------------------------------------------------------------------------------------
export function openFight(state, ctx, playerId, monster, kind) {
  const c = need(state, playerId);
  const allies = charactersOn(state, c.pos).filter(o => o.id !== c.id && allied(state, playerId, o.playerId)).map(o => o.playerId);
  if (state.fight && !state.fight.done && state.fight.kind !== 'solo') refuse('a fight is already open', 'busy');
  state.fight = { id: `f_${ctx.event?.id || ctx.now}`, kind, monsterId: monster.id, playerIds: [playerId, ...allies], playerId, turn: 'player', game: null, log: [], done: false, result: null, startedAt: ctx.now, rig: null, fled: false };
  state.turnPhase = 'resolve';
  note(state, `${monster.name} appears before ${c.name}${allies.length ? ` and ${allies.map(id => state.players[id]?.name).join(', ')}` : ''}`, 'fight', ctx.now);
  return state.fight;
}
// A monster on any hex (the movement module calls this for a blocker it is walked into).
export function openEncounter(state, ctx, playerId, hex) {
  const m = monsterAt(state, hex.key); if (!m) return null;
  const M = ctx.B('monsters');
  if (m.raid && charactersOn(state, hex.key).length < M.raidMinPlayers) { note(state, `${m.name} needs ${M.raidMinPlayers} players on the tile`, 'fight', ctx.now); return null; }
  return openFight(state, ctx, playerId, m, m.final || m.boss ? 'boss' : m.raid ? 'raid' : 'encounter');
}
export function gateBlocks(state, c, hex) {
  const g = hex.gate; if (!g) return false;
  if (g.level != null && (c.level || 1) >= g.level) return false;
  if (g.keyItem && Object.values(c.items || {}).some(it => it.baseId === g.keyItem || it.legendaryId === g.keyItem || it.id === g.keyItem)) return false;
  return !!(g.level != null || g.keyItem);
}
function bounce(state, ctx, c, hex, steps) {
  if (!c.prevPos || !state.map?.hexes?.[c.prevPos]) { note(state, `${c.name} is turned away at the gate`, 'move', ctx.now); return c.pos; }
  const line = hexm.line(hexm.parse(hex.key), hexm.parse(c.prevPos)).map(hexm.key).filter(k => state.map.hexes[k] && !state.map.hexes[k].void);
  const to = line[Math.min(steps, line.length - 1)] || c.prevPos;
  c.pos = to; c.region = state.map.hexes[to]?.regionId ?? c.region;
  note(state, `The gate throws ${c.name} back ${steps} hexes`, 'move', ctx.now);
  return to;
}

// ---- the tiles --------------------------------------------------------------------------------------------
const spinPrompt = (state, playerId, wheel, hex) => { state.pendingPrompt = { playerId, kind: 'spin', wheel, hexKey: hex.key }; state.turnPhase = 'resolve'; };

registerTile('encounter', (state, ctx, playerId, hex) => {
  const c = need(state, playerId); visit(state, ctx, c, hex);
  if (state.mode === 'pvp') { state.pendingPrompt = { playerId, kind: 'arena', hexKey: hex.key }; state.turnPhase = 'resolve'; return; }
  if (!openEncounter(state, ctx, playerId, hex)) { if (!monsterAt(state, hex.key)) note(state, `Nothing stirs where ${c.name} stands`, 'tile', ctx.now); action(state); }
});
registerTile('wheel', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); spinPrompt(state, playerId, 'fortune', hex); });
registerTile('event', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); spinPrompt(state, playerId, 'fate', hex); });
registerTile('chaos', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); spinPrompt(state, playerId, 'chaos', hex); });
registerTile('chest', (state, ctx, playerId, hex) => {
  const c = need(state, playerId); visit(state, ctx, c, hex);
  if (hex.lootSeen) { note(state, `The chest is empty; ${c.name} was late`, 'tile', ctx.now); action(state); return; }
  spinPrompt(state, playerId, 'loot', hex);
});
registerTile('shop', (state, ctx, playerId, hex) => { const c = need(state, playerId); visit(state, ctx, c, hex); ensureShopStock(state, ctx, hex.key, hex.regionId); action(state); });
registerTile('inn', (state, ctx, playerId, hex) => {
  const c = need(state, playerId); visit(state, ctx, c, hex);
  c.innSafeRound = state.round; c.innVisit = { hexKey: hex.key, turn: c.turnsTaken || 0, rests: 0 };
  note(state, `${c.name} shelters at the Inn`, 'tile', ctx.now); action(state);
});
registerTile('bloodbank', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); action(state); });
registerTile('graveyard', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); action(state); });
registerTile('bounty', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); action(state); });
registerTile('start', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); action(state); });
registerTile('plain', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); action(state); });
registerTile('courier', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); action(state); });
registerTile('arena', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); state.pendingPrompt = { playerId, kind: 'arena', hexKey: hex.key }; state.turnPhase = 'resolve'; });
registerTile('portal', (state, ctx, playerId, hex) => { visit(state, ctx, need(state, playerId), hex); state.pendingPrompt = { playerId, kind: 'portal', from: hex.key, to: hex.portalTo || null }; state.turnPhase = 'resolve'; });
registerTile('bossgate', (state, ctx, playerId, hex) => {
  const c = need(state, playerId); visit(state, ctx, c, hex);
  if (gateBlocks(state, c, hex)) { bounce(state, ctx, c, hex, ctx.B('movement').bossGateBounce); action(state); return; }
  const m = monsterAt(state, hex.key);
  if (!m) { note(state, `The gate stands open; its keeper is dead`, 'tile', ctx.now); action(state); return; }
  const M = ctx.B('monsters');
  if (m.raid && charactersOn(state, hex.key).length < M.raidMinPlayers) { note(state, `${m.name} needs ${M.raidMinPlayers} players on the tile`, 'fight', ctx.now); action(state); return; }
  if (!m.mood && (m.boss || m.raid || m.final)) spinWheel(state, ctx, 'boss', playerId, { monsterId: m.id });
  openFight(state, ctx, playerId, m, m.raid ? 'raid' : 'boss');
});
registerTile('throne', (state, ctx, playerId, hex) => {
  const c = need(state, playerId); visit(state, ctx, c, hex);
  const m = monsterAt(state, hex.key);
  if (m) { if (!m.mood) spinWheel(state, ctx, 'boss', playerId, { monsterId: m.id }); openFight(state, ctx, playerId, m, 'boss'); return; }
  if (state.mode !== 'pve' && state.mode !== 'teams' && !state.throneReachedBy) { state.throneReachedBy = playerId; note(state, `${c.name} sits on the Dealer's throne`, 'end', ctx.now); }
  action(state);
});

// ---- the Shop shelf ---------------------------------------------------------------------------------------
const STAPLES = [
  { sku: 'potion', name: 'Potion', priceKey: 'potion', qtyKey: 'stock', baseId: 'potion' },
  { sku: 'nudge', name: 'Nudge', priceKey: 'nudge', qty: 2, baseId: 'nudge' },
  { sku: 'reroll', name: 'Reroll', priceKey: 'reroll', qty: 2, baseId: 'reroll' },
  { sku: 'fork', name: 'Fork', priceKey: 'fork', qty: 1, baseId: 'fork' },
  { sku: 'smokebomb', name: 'Smoke Bomb', priceKey: 'smokeBomb', qty: 1, baseId: 'smokebomb' },
  { sku: 'phoenixfeather', name: 'Phoenix Feather', priceKey: 'phoenixFeather', qty: 1, baseId: 'phoenixfeather' },
  { sku: 'petrevive', name: 'Pet Revive', priceKey: 'petRevive', qty: 1, baseId: 'petrevive' },
  { sku: 'satchel', name: 'Satchel', priceKey: 'satchel', qty: 1, baseId: 'satchel' },
  { sku: 'spyglass', name: 'Spyglass', priceKey: 'spyglass', qty: 1, baseId: 'spyglass' },
];
export function ensureShopStock(state, ctx, hexKey, regionId = null) {
  const S = ctx.B('shop');
  const old = state.shops[hexKey];
  if (old && !(old.openedRound != null && state.round - old.openedRound >= S.restockRounds)) return old;
  const rng = streamRng(state, 'loot');
  const stock = STAPLES.map(s => ({ sku: s.sku, name: s.name, priceKey: s.priceKey, qty: s.qtyKey ? S[s.qtyKey] : s.qty, spec: { baseId: s.baseId, rarity: 'common' } }));
  const epic = RARITIES.indexOf('epic');
  for (let i = 0; i < S.stock; i++) {
    let rarity = rollRarity(state, ctx, { regionId });
    if (RARITIES.indexOf(rarity) > epic) rarity = RARITIES[epic];           // the Shop never sells Legendaries
    stock.push({ sku: `gear${i + 1}`, name: `${rarity[0].toUpperCase()}${rarity.slice(1)} gear`, priceKey: rarityKey(rarity, 'item'), qty: 1, spec: { baseId: 'loot', rarity, region: regionId, seed: Math.floor(rng.next() * 4294967296) >>> 0 } });
  }
  state.shops[hexKey] = { hexKey, regionId, openedRound: state.round, openedAt: ctx.now, stock };
  return state.shops[hexKey];
}

// ---- monster drops ----------------------------------------------------------------------------------------
// `credited`: the fight module's monsterDied already counted kills / stats.bosses / XP for the killer.
export function dropFromMonster(state, ctx, m, byId, { credited = false } = {}) {
  const killer = state.characters[byId] || characterOf(state, byId) || null;
  const rng = streamRng(state, 'loot'), M = ctx.B('monsters');
  markMonsterDead(state, m);
  if (m.linkedTo && state.monsters[m.linkedTo] && !state.monsters[m.linkedTo].dead) { markMonsterDead(state, state.monsters[m.linkedTo]); note(state, `${state.monsters[m.linkedTo].name} dies with its link`, 'fight', ctx.now); }
  const tierScale = 1 + M.lootGoldTierScale * (Math.max(1, state.tier || 1) - 1);
  const moodMult = m.mood?.lootMult || 1;
  const [lo, hi] = m.loot.gold; const total = Math.round(rng.int(lo, hi) * tierScale * moodMult);
  const party = (state.fight && state.fight.monsterId === m.id && (m.raid || m.boss)) ? state.fight.playerIds.map(pid => characterOf(state, pid)).filter(c => c && !c.dead) : [];
  const receivers = party.length ? party : killer ? [killer] : [];
  const share = receivers.length ? Math.floor(total / receivers.length) : 0;
  for (const c of receivers) { if (share > 0) { gold(state, c, share, `${m.name} drops`, ctx); if (state.stats[c.playerId]) state.stats[c.playerId].goldEarned += share; } }
  const drops = { gold: total, items: [], egg: false, monsterId: m.id };
  for (const c of receivers) {
    if (rng.chance(Math.min(1, m.loot.dropChance * moodMult))) {
      const rarity = rollRarity(state, ctx, { regionId: m.regionId, charId: c.id, weights: m.loot.rarity });
      const item = pushLoot(c, { baseId: 'loot', rarity, region: m.regionId, seed: Math.floor(rng.next() * 4294967296) >>> 0 });
      drops.items.push({ charId: c.id, rarity }); note(state, `${m.name} drops a ${rarity} item for ${c.name}`, 'loot', ctx.now);
    }
    if (rng.chance(Math.min(1, m.loot.egg * M.eggChanceScale))) { pushLoot(c, { baseId: 'egg', slot: 'egg', rarity: 'common', region: m.regionId, seed: Math.floor(rng.next() * 4294967296) >>> 0 }); drops.egg = true; note(state, `${m.name} leaves an egg for ${c.name}`, 'loot', ctx.now); }
    counter(c, 'monsterKills');
    if (m.boss || m.raid || m.final) { counter(c, 'bosses'); if (!credited && state.stats[c.playerId]) state.stats[c.playerId].bosses += 1; }
  }
  if (killer && !receivers.includes(killer)) counter(killer, 'monsterKills');
  if (m.final) {
    state.finalBossDeadBy = killer?.playerId || null;
    if (killer && state.mode !== 'pve' && state.mode !== 'teams' && !state.throneReachedBy && killer.pos === state.map?.throne) { state.throneReachedBy = killer.playerId; note(state, `${killer.name} takes the Dealer's chair`, 'end', ctx.now); }
  }
  note(state, `${m.name} is destroyed${total ? `; ${total} Gold spills out` : ''}`, 'fight', ctx.now);
  state.lastDrop = drops;
  return drops;
}
lootHooks.onDrop.push((state, ctx, info) => { const m = state.monsters[info.monsterId] || info.monster; if (m) dropFromMonster(state, ctx, m, info.byId, { credited: !!info.monster }); });

// ---- tile loot --------------------------------------------------------------------------------------------
// Tile loot entries are the item itself plus { droppedAt, round, by } (the same shape the inventory module writes).
export function dropOnTile(state, ctx, hexKey, item, by = null) {
  (state.tileLoot[hexKey] ||= []).push({ ...item, droppedAt: ctx.now, round: state.round, by });
}
const liftFromTile = (entry) => { const { droppedAt, round, by, ...item } = entry; return item; };
runHooks.roundEnd.push((state, ctx) => {
  const keep = ctx.B('death').tileLootRounds;
  for (const [k, list] of Object.entries(state.tileLoot)) {
    const left = list.filter(e => state.round - e.round <= keep);
    if (left.length !== list.length) note(state, `The rain takes what was left at ${k}`, 'tile', ctx.now);
    if (left.length) state.tileLoot[k] = left; else delete state.tileLoot[k];
  }
});

// ---- events -----------------------------------------------------------------------------------------------
register({
  INN_REST(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = ctx.payload.playerId || (ctx.isGm ? currentPlayerId(state) : ctx.actor); requireActor(state, ctx, pid);
    const c = need(state, pid); const hex = state.map?.hexes?.[c.pos];
    if (!hex || hex.type !== 'inn') refuse('not at an Inn', 'tile');
    const X = ctx.B('xp'), H = ctx.B('health');
    const v = c.innVisit; if (!v || v.hexKey !== hex.key || v.turn !== (c.turnsTaken || 0)) refuse('rest when you arrive at the Inn', 'tile');
    const max = c.classId === 'pitboss' && (c.level || 1) >= X.upgradeLevels[0] ? 2 : 1;
    if (v.rests >= max) refuse('already rested this visit', 'tile');
    v.rests += 1; c.innSafeRound = state.round;
    const healed = health(state, c, H.innHeal, 'Inn', ctx);
    counter(c, 'innRests');
    note(state, `${c.name} rests at the Inn (+${healed})`, 'tile', ctx.now);
  },
  TILE_TAKE_LOOT(state, ev, ctx) {
    requirePhase(state, 'playing');
    const prompt = state.pendingPrompt;
    const pid = ctx.payload.playerId || (prompt?.kind === 'takeWorn' ? prompt.playerId : ctx.isGm ? currentPlayerId(state) : ctx.actor); requireActor(state, ctx, pid);
    const c = need(state, pid); const itemId = ctx.payload.itemId ?? null;
    if (prompt && prompt.kind === 'takeWorn' && prompt.playerId === pid) {
      const v = state.characters[prompt.victimId];
      if (!itemId) { state.pendingPrompt = null; note(state, `${c.name} takes nothing from ${v?.name || 'the body'}`, 'death', ctx.now); return; }
      if (!v) refuse('victim is gone');
      const slot = Object.keys(v.worn || {}).find(s => v.worn[s]?.id === itemId); if (!slot) refuse('not a worn item of the victim', 'item');
      state.pendingPrompt = null;
      const item = v.worn[slot]; v.worn[slot] = null; delete v.items[item.id];
      pushLoot(c, { item }); note(state, `${c.name} takes ${v.name}'s ${item.name}`, 'death', ctx.now);
      return;
    }
    const list = state.tileLoot[c.pos] || [];
    const i = itemId ? list.findIndex(e => e.id === itemId) : (list.length ? 0 : -1);
    if (i < 0) refuse('nothing like that on this hex', 'item');
    const [entry] = list.splice(i, 1); if (!list.length) delete state.tileLoot[c.pos];
    const item = liftFromTile(entry); pushLoot(c, { item });
    note(state, `${c.name} picks up ${item.name || 'something'}`, 'loot', ctx.now);
  },
  TILE_LEAVE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const p = state.pendingPrompt; if (!p) return;
    requireActor(state, ctx, p.playerId);
    if (!['arena', 'portal', 'spin'].includes(p.kind)) refuse('that prompt cannot be walked away from', 'prompt');
    state.pendingPrompt = null; if (!state.fight) state.turnPhase = 'action';
  },
});
