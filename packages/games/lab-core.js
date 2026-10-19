// Game Lab logic (pure; apps/lab is the page glue). The Lab is a sandbox: every item playable against a dummy
// target in Health or chip mode, with a tick-list and a report, as legacy/site/js/lab-core.js did for the GM window.
import { ITEM_DEFS, ITEMS, makeItem, FAMILIES } from './items.js';
import { startRound, gameMeta, CLASSIC_IDS, topMult, baseOdds } from './adapter.js';
import { LEVERS } from './levers.js';
import { EXTRA_GROUPS } from './legacy/games-extra.js';
import { B, group } from '../shared/balance.js';
import { makeRng, hash32 } from '../shared/rng.js';

export const LAB_KEY = 'gwf-rpg-lab';
export const LAB_HEALTH = 1000;
export const LAB_CHIPS = 100;

// Catalog: the 36 items grouped the way the legacy lab grouped the games (classics, quick, show, table), each row
// carrying the item it has become. Wheels (Buy-in, Loot, Chaos …) join as a fifth group when their module lands.
export function labCatalog(extraGroups = []) {
  const row = (gameId) => { const d = ITEM_DEFS.find(x => x.gameId === gameId); const m = gameMeta(gameId); return d ? { id: d.id, gameId, name: d.name, game: m.name, icon: m.icon, kind: d.kind, family: d.family, stat: d.stat, lever: d.lever } : null; };
  const groups = [{ label: 'Classics', items: CLASSIC_IDS.map(row).filter(Boolean) }, ...EXTRA_GROUPS.map(g => ({ label: g.label, items: g.ids.map(row).filter(Boolean) })), ...extraGroups];
  return groups.filter(g => g.items.length);
}
export const labOrder = (catalog) => catalog.flatMap(g => g.items.map(x => x.id));
export function stepId(order, cur, delta) { if (!order.length) return null; const i = order.indexOf(cur); return order[((i < 0 ? (delta > 0 ? -1 : 0) : i) + delta + order.length) % order.length]; }

// The tester and the dummy: a lab state is a pretend character sheet, not a room.
export function newLabState({ seed = 1, health = LAB_HEALTH, chips = LAB_CHIPS, stats = null, classId = 'enforcer' } = {}) {
  const n = B.stats.neutral;
  return { seed, tester: { id: 'tester', name: 'Tester', classId, level: 1, stats: stats || { luck: n, nerve: n, greed: n, grit: n }, health, maxHealth: health, chips, shield: 0 },
    dummy: { id: 'dummy', name: 'Training Dummy', stats: { luck: n, nerve: n, greed: n, grit: n }, health: B.monsters.healthCommon, maxHealth: B.monsters.healthCommon }, rounds: 0, lab: true };
}
// Start a round of `itemId` against the dummy. opts: { rarity, stake, seed, rng, now, mode, holdPending, rig, statValue }
export function newLabRound(lab, itemId, mode = 'health', opts = {}) {
  const def = ITEMS[itemId]; if (!def) throw new Error(`unknown item ${itemId}`);
  const rarity = opts.rarity || 'common';
  const item = opts.item || makeItem(null, { baseId: itemId, rarity, seed: opts.seed ?? hash32(`${lab.seed}:${itemId}:${lab.rounds}`) });
  const rng = opts.rng || makeRng(hash32(`${lab.seed}:${lab.rounds}:${itemId}`));
  lab.rounds += 1;
  const stake = opts.stake ?? (mode === 'chips' ? Math.min(B.creation.maxStake, Math.max(B.creation.minStake, 1)) : item.stake);
  return startRound(null, { item, mode, stake, attacker: lab.tester, target: lab.dummy, rng, now: opts.now ?? 0, holdPending: !!opts.holdPending, rig: opts.rig || null, statValue: opts.statValue });
}
// Apply a finished round to the lab sheet the way the room would (no hooks: the Lab shows raw item maths).
export function settleLab(lab, round) {
  const o = round.outcome(); if (!o) return null;
  const bonus = round.item.rarity === 'common' ? 0 : B.items[`bonus${round.item.rarity[0].toUpperCase()}${round.item.rarity.slice(1)}`];
  const line = { mult: o.mult, label: o.label, crit: o.crit, damage: 0, loss: 0, healed: 0, shielded: 0, chips: 0 };
  if (round.mode === 'chips') { line.chips = o.mult > 1 ? Math.round(round.stake * (o.mult - 1)) : o.mult < 1 ? -Math.round(round.stake * (1 - o.mult)) : 0; lab.tester.chips = Math.max(0, lab.tester.chips + line.chips); return line; }
  if (o.mult > 1) {
    const pay = Math.round(round.stake * (o.mult - 1) * (1 + bonus));
    if (round.item.kind === 'spell') { if (round.item.spellEffect === 'shield') { lab.tester.shield += pay; line.shielded = pay; } else { const before = lab.tester.health; lab.tester.health = Math.min(lab.tester.maxHealth, before + pay); line.healed = lab.tester.health - before; } }
    else { lab.dummy.health = Math.max(0, lab.dummy.health - pay); line.damage = pay; if (lab.dummy.health === 0) lab.dummy.health = lab.dummy.maxHealth; }
  } else if (o.mult < 1) { line.loss = Math.round(round.stake * (1 - o.mult)); lab.tester.health = Math.max(0, lab.tester.health - line.loss); if (lab.tester.health === 0) lab.tester.health = lab.tester.maxHealth; }
  return line;
}
export const outcomeOf = (round) => (round ? round.result || round.pending || null : null);
export function readyToSettle(round, now) {
  if (!round || !round.settled) return false;
  if (round.g.forkOptions) return false;
  return now >= (round.g.view.revealAt || 0);
}

// ── Ticks, notes and play counts (persisted by the page in localStorage) ─────────────────────────
export function loadMarks(storage) { try { const m = JSON.parse(storage.getItem(LAB_KEY) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; } }
export function saveMarks(storage, marks) { try { storage.setItem(LAB_KEY, JSON.stringify(marks)); return true; } catch { return false; } }
const entry = (marks, id) => marks[id] || (marks[id] = { status: '', note: '', plays: 0, staked: 0, returned: 0, crits: 0 });
export function setStatus(marks, id, status) { entry(marks, id).status = ['ok', 'bad'].includes(status) ? status : ''; return marks; }
export function setNote(marks, id, note) { entry(marks, id).note = String(note || '').slice(0, 2000); return marks; }
export function recordPlay(marks, id, stake, mult, crit = false) { const e = entry(marks, id); e.plays += 1; e.staked += stake; e.returned += stake * mult; if (crit) e.crits += 1; return marks; }
export function statsLine(marks, id) {
  const e = marks[id]; if (!e || !e.plays) return 'Not played yet.';
  const net = Math.round(e.returned - e.staked);
  return `${e.plays} round${e.plays === 1 ? '' : 's'} · staked ${Math.round(e.staked).toLocaleString('en-US')} · net ${net >= 0 ? '+' : ''}${net.toLocaleString('en-US')} · returned ${(e.returned / e.staked * 100).toFixed(0)}%${e.crits ? ` · ${e.crits} crit${e.crits === 1 ? '' : 's'}` : ''}`;
}
export function progress(catalog, marks) {
  const ids = labOrder(catalog), ok = ids.filter(id => marks[id]?.status === 'ok').length, bad = ids.filter(id => marks[id]?.status === 'bad').length, played = ids.filter(id => marks[id]?.plays).length;
  return { total: ids.length, ok, bad, played, left: ids.length - ok - bad, text: `${ok + bad} of ${ids.length} checked${bad ? ` · ${bad} with problems` : ''} · ${played} played` };
}
export function reportText(catalog, marks, now = new Date()) {
  const p = progress(catalog, marks), lines = [`GWF RPG Edition — item lab report (${now.toISOString().slice(0, 10)})`, p.text, ''];
  for (const grp of catalog) {
    lines.push(`## ${grp.label}`);
    for (const it of grp.items) { const e = marks[it.id] || {}; lines.push(`- [${e.status === 'ok' ? 'OK' : e.status === 'bad' ? 'PROBLEM' : e.plays ? 'played, not marked' : 'not tested'}] ${it.name} (${it.game}, ${it.kind}, ${it.stat})${e.plays ? ` (${e.plays} rounds)` : ''}${e.note ? ` — ${e.note.replace(/\s+/g, ' ').trim()}` : ''}`); }
    lines.push('');
  }
  return lines.join('\n').trim();
}
// Side-panel rows: the item card facts plus the game's top multiplier (the crit line).
export function itemRows(itemId) {
  const d = ITEMS[itemId]; if (!d) return [];
  const lv = LEVERS[d.gameId], top = topMult(d.gameId, baseOdds(d.gameId));
  return [{ label: 'Game', value: gameMeta(d.gameId).name }, { label: 'Kind', value: d.kind }, { label: 'Family', value: FAMILIES[d.family]?.name || d.family }, { label: 'Stat', value: d.stat },
    { label: 'Lever', value: lv ? lv.text : d.lever }, { label: 'Crit at', value: Number.isFinite(top) ? `${Number(top.toFixed(2))}×` : 'the full ride' },
    { label: 'Stakes', value: `C ${B.items.stakeCommon} · R ${B.items.stakeRare} · E ${B.items.stakeEpic} · L ${B.items.stakeLegendary}` }];
}
