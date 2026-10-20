// Lab screen: the QA run. Every wheel in order — Buy-in, Chaos (tiers 1, 3, 5), Fortune, Fate, Loot, Boss, Movement
// (Croupier's Heels), Challenge, Triple Pet Wheel, Bug Reward Wheel — three spins each, one spin on screen at a time.
// Each spin shows the face landing, then "the calculation": the segment table with odds, the landed segment's rule
// text from data/wheels.json with the balance numbers it names resolved, a before → after diff of the sandbox tester,
// the log lines the spin wrote, and a few arithmetic checks against what the rule says. ✅ Works / ❌ Problem / Skip
// (keys O / X / N) record a verdict per spin under `qa:<wheel>:<k>` in the Lab's marks store, so a reload resumes.
//   /lab/?qa=1            the run     /lab/?phone=1&qa=1   phone layout     &fast=1  short spins (the browser test)
//   &spins=5              five spins per wheel instead of three
// Every wheel starts on a fresh sandbox room (makeSandbox is cheap) with a known sheet (QA_SHEET) so the diffs read.
import '../../../packages/shared/index.js';   // first: the handlers' import cycle leaves hooks.runStart empty (no map, no monsters) when a handler module loads before index.js
import { spinWheel, spinWheelSecret, segmentsFor, chaosOf } from '../../../packages/shared/handlers/wheels.js';
import { spinHatch, speciesDef } from '../../../packages/shared/handlers/pets.js';
import { activeList } from '../../../packages/shared/handlers/challenge.js';
import { BOOTS, wheelSegments, bootAffixes } from '../../../packages/shared/handlers/movement.js';
import { makeItem } from '../../../packages/games/items.js';
import { group } from '../../../packages/shared/balance.js';
import { makeRng, hash32, weightedIndex } from '../../../packages/shared/rng.js';
import { wheelSvg, makeSandbox, copyText, download } from '../../../packages/ui/labkit.js';
import { setStatus, setNote, recordPlay } from '../../../packages/games/lab-core.js';
import { qs } from '../../../packages/ui/dom.js';
import wheelsData from '../../../data/wheels.json' with { type: 'json' };

export const QA_WHEELS = [
  { id: 'buyin', name: 'Buy-in Wheel' }, { id: 'chaos', name: 'Chaos Wheel', tiers: [1, 3, 5] }, { id: 'fortune', name: 'Fortune Wheel' }, { id: 'fate', name: 'Fate Wheel' },
  { id: 'loot', name: 'Loot Wheel' }, { id: 'boss', name: 'Boss Wheel (moods)' }, { id: 'movement', name: "Movement Wheel (Croupier's Heels)" }, { id: 'challenge', name: 'Challenge Wheel' },
  { id: 'pets', name: 'Triple Pet Wheel' }, { id: 'bugreward', name: 'Bug Reward Wheel' },
];
export const QA_SHEET = { health: 80, maxHealth: 100, gold: 200 };
export const qaKey = (wheel, k) => `qa:${wheel}:${k}`;
const SEED_KEY = 'qa:seed';
export const qaSpins = () => Math.max(1, Math.min(9, Number(qs('spins')) || 3));
export const qaSteps = (spins = qaSpins()) => QA_WHEELS.flatMap(w => Array.from({ length: spins }, (_, i) => ({ wheel: w.id, name: w.name, k: i + 1, tier: w.tiers ? w.tiers[i % w.tiers.length] : null })));
const isDone = (marks, step) => { const e = marks[qaKey(step.wheel, step.k)]; return !!e && (e.status === 'ok' || e.status === 'bad' || e.plays > 0); };
export function qaProgress(marks, spins = qaSpins()) {
  const steps = qaSteps(spins), done = steps.filter(s => isDone(marks, s)), bad = steps.filter(s => marks[qaKey(s.wheel, s.k)]?.status === 'bad').length;
  return { total: steps.length, done: done.length, bad, text: `${done.length} / ${steps.length} · ${bad} problem${bad === 1 ? '' : 's'}`, next: steps.find(s => !isDone(marks, s)) || null };
}
export function qaReportText(marks, seed, spins = qaSpins(), now = new Date()) {
  const p = qaProgress(marks, spins), lines = [`GWF RPG Edition — QA wheel run (${now.toISOString().slice(0, 10)}) · seed ${seed} · ${spins} spins per wheel · sheet ${QA_SHEET.health}/${QA_SHEET.maxHealth} HP, ${QA_SHEET.gold} Gold`, `${p.text}`, ''];
  for (const w of QA_WHEELS) {
    lines.push(`## ${w.name}`);
    for (let k = 1; k <= spins; k++) {
      const e = marks[qaKey(w.id, k)] || {};
      const st = e.status === 'ok' ? 'OK' : e.status === 'bad' ? 'PROBLEM' : e.plays ? 'skipped' : 'not tested';
      lines.push(`- ${k}/${spins}${w.tiers ? ` (tier ${w.tiers[(k - 1) % w.tiers.length]})` : ''} [${st}]${e.landed ? ` ${e.landed}` : ''}${e.text ? ` — ${e.text}` : ''}${e.checks ? ` (${e.checks})` : ''}${e.note ? ` — NOTE: ${e.note.replace(/\s+/g, ' ').trim()}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// ── the sheet, snapshots and diffs ───────────────────────────────────────────────────────────────
const regionName = (state, id) => state.map?.regions?.[id]?.name || id || '—';
function freshSandbox(seed, wheel, classId) {
  const sb = makeSandbox({ seed: hash32(`${seed}:qa:${wheel}`), classId });
  const c = sb.tester(); c.maxHealth = QA_SHEET.maxHealth; c.health = QA_SHEET.health; c.gold = QA_SHEET.gold;
  return sb;
}
const livingBoss = (state) => { const bs = Object.values(state.monsters).filter(m => m.boss && !m.dead); return bs.find(b => !b.raid && !b.final) || bs[0] || null; };
function snapshot(sb, bossId = null) {
  const c = sb.tester(), st = sb.state, ch = chaosOf(st), m = bossId ? st.monsters[bossId] : null;
  const items = Object.values(c.items || {}).map(i => i.name);
  return {
    rows: {
      'Health': `${c.health}/${c.maxHealth}`, 'Gold': c.gold, 'Stat points': c.statPoints || 0, 'Chips': c.chips || 0,
      'Position': `${c.pos} · ${regionName(st, c.region)}`, 'Items': `${items.length} in the grid`, 'Pending loot': (c.pendingLoot || []).length, 'Pets': c.pets.length,
      'Miss turns': c.missTurns || 0, 'Bounties on the tester': st.bounties.filter(b => b.targetId === c.playerId).length, 'Grid effects queued': (c.gridEffects || []).join(', ') || '—',
      'Chaos': `tier ${ch.tier} · ${ch.effects.length} effect${ch.effects.length === 1 ? '' : 's'}${ch.effects.length ? ` (${ch.effects.map(e => e.label).join('; ')})` : ''}`, 'Vote open': st.votes ? `${st.votes.kind}: ${st.votes.question}` : '—',
      ...(m ? { [`${m.name}`]: `${m.mood ? m.mood.name : 'no mood'} · ${m.health}/${m.maxHealth} HP` } : {}),
    },
    items, potions: Object.values(c.items || {}).filter(it => it.baseId === 'potion').reduce((n, it) => n + (it.qty || 1), 0), health: c.health, maxHealth: c.maxHealth, gold: c.gold, statPoints: c.statPoints || 0, pos: c.pos, region: c.region, pendingLoot: (c.pendingLoot || []).length, pets: c.pets.length, missTurns: c.missTurns || 0,
    bounties: st.bounties.length, gridEffects: (c.gridEffects || []).length, tier: ch.tier, effects: ch.effects.length, vote: !!st.votes, logLen: st.log.length, lastSpinTs: st.lastSpin?.ts ?? null,
    boss: m ? { maxHealth: m.maxHealth, health: m.health, mood: m.mood?.id || null } : null, luck: c.stats.luck,
    positions: Object.fromEntries(Object.values(st.characters).map(x => [x.id, x.pos])),
  };
}
function diffRows(before, after) {
  const keys = [...new Set([...Object.keys(before.rows), ...Object.keys(after.rows)])];
  const rows = keys.map(k => ({ label: k, before: String(before.rows[k] ?? '—'), after: String(after.rows[k] ?? '—'), changed: String(before.rows[k] ?? '—') !== String(after.rows[k] ?? '—') }));
  const pool = before.items.slice(), added = [];
  for (const n of after.items) { const i = pool.indexOf(n); if (i >= 0) pool.splice(i, 1); else added.push(n); }
  if (added.length) rows.push({ label: 'Items added', before: '—', after: added.join(', '), changed: true });
  if (pool.length) rows.push({ label: 'Items removed', before: pool.join(', '), after: '—', changed: true });
  return rows;
}

// ── the rule and the balance numbers it names ────────────────────────────────────────────────────
const KEY_RE = /\b([a-z][A-Za-z]*)\.([a-z][A-Za-z]*)\b/g;
const fmt = (v) => (Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v));
function resolveKeys(state, texts, extra = []) {
  const out = [], seen = new Set();
  const push = (path) => { if (seen.has(path)) return; const [g, k] = path.split('.'); try { const v = group(state, g)[k]; if (v !== undefined) { seen.add(path); out.push({ path, value: fmt(v) }); } } catch { /* not a balance key */ } };
  for (const t of texts) for (const m of String(t || '').matchAll(KEY_RE)) push(`${m[1]}.${m[2]}`);
  for (const p of extra) push(p);
  return out;
}
const LOOT_KEYS = ['wheels.lootWeightCommon', 'wheels.lootWeightRare', 'wheels.lootWeightEpic', 'wheels.lootWeightLegendary', 'wheels.luckRarityShiftPerPoints', 'stats.neutral', 'items.legendaryPerRun'];
const EXTRA_KEYS = {
  'fortune.item': LOOT_KEYS, 'fate.item': LOOT_KEYS, 'loot.item': LOOT_KEYS, 'bugreward.legendary': ['items.legendaryPerRun'],
  'chaos.collector': ['bloodPact.collectorFloor'], 'chaos.vote': ['chaos.voteSeconds', 'chaos.collectorTakes'], 'chaos.tierup': ['chaos.maxTier', 'chaos.tierDamageMult'], 'chaos.apocalypse': ['chaos.maxTier', 'chaos.collectorTakes', 'chaos.regionMult', 'wheels.chaosRegionRounds'],
  'fate.bounty': ['gold.perKO'], 'bugreward.heal': ['wheels.bugMaxHealth'],
};

// ── one spin ─────────────────────────────────────────────────────────────────────────────────────
// Returns { segs:[{label, weight, text}], index, landed, text, rule:{text, keys:[{path,value}], notes:[]}, before, after, logs, checks:[{label, ok}], wheels? } and applies the spin to the sandbox.
function runSpin(sb, step, seed) {
  const { wheel, k, tier } = step, state = sb.state, c = sb.tester();
  const labRng = () => makeRng(hash32(`${seed}:qa:${wheel}:${k}`));
  const pct = (segs) => { const t = segs.reduce((s, x) => s + Number(x.weight || 0), 0); return segs.map(s => ({ ...s, weight: Number(s.weight || 0), pct: t > 0 ? (100 * Number(s.weight || 0) / t) : 100 / segs.length })); };
  const rec = { wheel, k, tier, segs: [], index: null, landed: '', text: '', rule: { text: '', keys: [], notes: [] }, logs: [], checks: [], wheels: null, engine: true };
  const H = group(state, 'health'), W = group(state, 'wheels'), G = group(state, 'gold'), C = group(state, 'chaos'), MV = group(state, 'movement'), CH = group(state, 'challenge'), P = group(state, 'pets');
  const bossId = wheel === 'boss' ? livingBoss(state)?.id : null;
  if (wheel === 'chaos') { sb.apply('GM_CHAOS', { tier }); if (state.votes?.kind === 'chaos') { state.votes = null; chaosOf(state).pendingVictimEffect = null; } }
  const before = snapshot(sb, bossId);
  const logFrom = state.log.length;
  sb.tick(1500);
  const ctx = sb.ctx();
  const check = (label, ok) => rec.checks.push({ label, ok: !!ok });
  const noChange = (after) => check('sheet unchanged (the Lab draws this index itself; the engine applies nothing here)', after.health === before.health && after.gold === before.gold && after.pos === before.pos && after.items.length === before.items.length);

  if (wheel === 'buyin') {
    const steps = 8, span = H.buyinMax - H.buyinMin;
    rec.segs = pct(Array.from({ length: steps }, (_, i) => ({ id: String(i), label: String(Math.round(H.buyinMin + span * i / (steps - 1))), weight: 1, text: 'Max Health for the run' })));
    rec.index = weightedIndex(labRng(), rec.segs); rec.landed = rec.segs[rec.index].label; rec.engine = false;
    rec.text = `Max Health for the run would be ${rec.landed}`;
    rec.rule = { text: `Max Health for the run, one spin per player before the start (or health.flatStart). Eight segments from health.buyinMin to health.buyinMax.`, keys: resolveKeys(state, [], ['health.buyinMin', 'health.buyinMax', 'health.flatStart']), notes: ['Lab-picked index (weightedIndex over equal weights); run.js applies the buy-in at RUN_START, so the sandbox sheet does not change here.'] };
    rec.after = snapshot(sb, bossId); noChange(rec.after);
    check(`landed value within ${H.buyinMin}–${H.buyinMax}`, Number(rec.landed) >= H.buyinMin && Number(rec.landed) <= H.buyinMax);
  } else if (wheel === 'movement') {
    const base = BOOTS.bases.find(b => b.id === 'croupiers_heels') || BOOTS.bases.find(b => b.mode === 'wheel');
    const item = { ...makeItem(null, { baseId: 'coinblade' }), baseId: base.id, bootMode: 'wheel', unique: null, affixes: [] };
    rec.segs = pct(wheelSegments(item, bootAffixes(item), MV).map(s => ({ ...s, weight: s.weight || 1, text: s.steps != null ? `${s.steps} steps` : s.special ? `special: ${s.special}` : '' })));
    rec.index = weightedIndex(labRng(), rec.segs); const s = rec.segs[rec.index]; rec.landed = s.label; rec.engine = false;
    rec.text = s.steps != null ? `${s.steps} steps` : `special: ${s.special}`;
    rec.rule = { text: `${base.name} (wheel boots) spin this instead of rolling. ${s.stepsKey ? `Segment ${s.label.split(' ')[0]} reads movement.${s.stepsKey}.` : s.steps != null ? `Walk ${s.steps} hex${s.steps === 1 ? '' : 'es'}.` : `Special move: ${s.special}.`}`, keys: resolveKeys(state, [s.stepsKey ? `movement.${s.stepsKey}` : ''], ['movement.barefoot']), notes: ['Lab-picked index (weightedIndex over the segment weights); the move itself (MOVE_ROLL / MOVE_STEP) is not played here.'] };
    rec.after = snapshot(sb, bossId); noChange(rec.after);
    before.rows['Movement steps'] = '—'; rec.after.rows['Movement steps'] = s.steps != null ? String(s.steps) : `special: ${s.special}`;
    if (s.stepsKey) check(`steps = movement.${s.stepsKey} = ${MV[s.stepsKey]}`, s.steps === MV[s.stepsKey]);
  } else if (wheel === 'challenge') {
    const entries = activeList(state).filter(e => e.enabled && e.weight > 0);
    rec.segs = pct(entries.map(e => ({ ...e, label: e.name, text: `${e.hosted ? `hosted: ${e.game}` : 'external (at the table)'}${e.rules ? ` — ${e.rules}` : ''}` })));
    rec.index = weightedIndex(labRng(), rec.segs); const e = rec.segs[rec.index]; rec.landed = e.label; rec.engine = false;
    const cap = e.hosted ? CH.hostedCapSeconds : (e.capSeconds || CH.externalCapSeconds);
    rec.text = `${e.hosted ? `hosted duel on the phones (${e.game})` : 'external, played at the table'} · cap ${cap}s`;
    rec.rule = { text: `${e.rules || ''} Preset "${state.gm.challengePreset || 'inperson'}"; weights decide the odds. Hosted entries are capped at challenge.hostedCapSeconds, external ones at challenge.externalCapSeconds (or the entry's own cap); a timeout costs both challenge.timeoutDamage.`, keys: resolveKeys(state, [], ['challenge.hostedCapSeconds', 'challenge.externalCapSeconds', 'challenge.timeoutDamage', 'challenge.winMult', 'challenge.critMult']), notes: ['Lab-picked index (weightedIndex over the entry weights); no CHALLENGE_CALL is open, so nothing is applied to the sandbox.'] };
    rec.after = snapshot(sb, bossId); noChange(rec.after);
    before.rows['Entry'] = '—'; rec.after.rows['Entry'] = `${e.hosted ? 'hosted' : 'external'} · game ${e.game || '—'} · cap ${cap}s`;
    check(`entry kind resolves (${e.hosted ? 'hosted' : 'external'})`, e.hosted ? !!e.game : e.game == null);
  } else if (wheel === 'pets') {
    const hatch = spinHatch(state, ctx, c, 'setup', c.region);
    rec.wheels = hatch.wheels.map(w => ({ pool: w.pool, index: w.index, outcomes: w.outcomes.map(o => (o ? speciesDef(o)?.name || o : 'dud')), segs: pct(w.outcomes.map(o => ({ id: o || 'dud', label: o ? speciesDef(o)?.name || o : 'dud egg', weight: 1, text: o ? `${speciesDef(o)?.element || ''} · ${speciesDef(o)?.rarity || ''}`.replace(/^ · | · $/g, '') : 'dud: no pet' }))) }));
    rec.segs = rec.wheels[0].segs; rec.index = rec.wheels[0].index;
    const picked = rec.wheels.map(w => w.outcomes[w.index]);
    rec.landed = picked.join(' / '); rec.text = `common: ${picked[0]} · region: ${picked[1]} · rare: ${picked[2]}`;
    rec.rule = { text: `Three wheels of pets.wheelSegments segments: the common species, the region's species (${regionName(state, c.region)}), and the rare wheel with pets.rareWheelBlanks dud segments. The player keeps one of the three (PET_HATCH_PICK; not picked here).`, keys: resolveKeys(state, [], ['pets.wheelSegments', 'pets.rareWheelBlanks', 'pets.startPower', 'pets.teamMax']), notes: [] };
    rec.after = snapshot(sb, bossId);
    before.rows['Hatching (3 wheels)'] = '—'; rec.after.rows['Hatching (3 wheels)'] = rec.landed;
    check(`three wheels of ${P.wheelSegments}`, hatch.wheels.length === 3 && hatch.wheels.every(w => w.outcomes.length === P.wheelSegments));
    check(`rare wheel carries ${P.rareWheelBlanks} dud segments`, hatch.wheels[2].outcomes.filter(o => !o).length === P.rareWheelBlanks);
    check('lastSpin.wheel = pets with 3 wheels', state.lastSpin?.wheel === 'pets' && state.lastSpin.wheels?.length === 3);
    check('pets count unchanged until the pick', rec.after.pets === before.pets);
    c.hatching = null;
  } else if (wheel === 'bugreward') {
    const r = spinWheelSecret(state, ctx, 'bugreward', 'tester', {});
    rec.segs = pct(segmentsFor(state, 'bugreward')); rec.index = r.index; rec.landed = r.seg.label; rec.text = r.result?.text || '—';
    rec.rule = { text: r.seg.text, keys: resolveKeys(state, [r.seg.text], EXTRA_KEYS[`bugreward.${r.seg.effect}`] || []), notes: ['Secret spin (spinWheelSecret): no lastSpin, no public log line; loot lands in the grid at once (materialisePendingLoot).'] };
    rec.after = snapshot(sb, bossId);
    const a = rec.after, b = before;
    check('no public log line', state.log.length === logFrom);
    check('lastSpin untouched', a.lastSpinTs === b.lastSpinTs);
    switch (r.seg.effect) {
      case 'gold': check(`gold +wheels.bugGold (${W.bugGold}): ${b.gold} → ${a.gold}`, a.gold === b.gold + W.bugGold); break;
      case 'potions': check(`potions +wheels.bugPotions (${W.bugPotions}), stacking onto the ones held: ${b.potions} → ${a.potions}`, a.potions === b.potions + W.bugPotions); break;
      case 'heal': check(`max +wheels.bugMaxHealth (${W.bugMaxHealth}) and full: ${b.health}/${b.maxHealth} → ${a.health}/${a.maxHealth}`, a.maxHealth === b.maxHealth + W.bugMaxHealth && a.health === a.maxHealth); break;
      case 'stat': check(`stat points +1: ${b.statPoints} → ${a.statPoints}`, a.statPoints === b.statPoints + 1); break;
      case 'rare': case 'epic': case 'legendary': { const it = r.result?.item ? c.items[r.result.item] : null; check(`one ${r.seg.effect} item in the grid at once${it ? ` (${it.name}, ${it.rarity})` : ''}`, a.items.length === b.items.length + 1 && !!it && (it.rarity === r.seg.effect || (r.seg.effect === 'legendary' && it.rarity === 'epic'))); break; }
      case 'egg': check(`one egg in the grid at once: ${b.items.length} → ${a.items.length}`, a.items.length === b.items.length + 1); break;
      default: break;
    }
  } else {
    // fortune, fate, loot, chaos, boss: the engine's spin with the effect really applied.
    const extra = wheel === 'boss' ? { monsterId: bossId } : {};
    const segsNow = segmentsFor(state, wheel, extra) || [];
    const r = spinWheel(state, ctx, wheel, wheel === 'boss' ? null : 'tester', extra);
    rec.segs = pct(segsNow.map(s => ({ ...s, label: s.label || s.name, text: s.text || '' }))); rec.index = r.index; rec.landed = rec.segs[r.index]?.label || r.seg.label; rec.text = r.result?.text || state.lastSpin?.text || '—';
    const eff = r.seg.effect || r.seg.id;
    rec.rule = { text: r.seg.text || '', keys: resolveKeys(state, [r.seg.text], EXTRA_KEYS[`${wheel}.${eff}`] || []), notes: [] };
    if (wheel === 'chaos') rec.rule.notes.push(`Tier ${tier}: only segments with minTier ≤ ${tier} are on the wheel (${segsNow.length} of ${wheelsData.chaos.length}). Damage multiplier at this tier: chaos.tierDamageMult[${tier - 1}] = ${C.tierDamageMult[tier - 1]}.`);
    if (wheel === 'boss') { const m = state.monsters[bossId]; rec.rule.text = `${r.seg.text || ''} Mood multipliers: healthMult ${r.seg.healthMult ?? 1}, damageMult ${r.seg.damageMult ?? 1}, lootMult ${r.seg.lootMult ?? 1}.`; rec.rule.notes.push(`Max Health is rescaled from the monster's current max (${before.boss.maxHealth} × ${r.seg.healthMult ?? 1} → ${Math.max(1, Math.round(before.boss.maxHealth * (r.seg.healthMult ?? 1)))}); a second spin compounds on the already-scaled max. ${m.parts ? 'A multi-part boss splits the total across its parts.' : ''}`); }
    rec.after = snapshot(sb, bossId);
    const a = rec.after, b = before, tierOf = (rid) => state.map?.regions?.[rid]?.tier || 1;
    const lootShift = Math.floor(Math.max(0, b.luck - group(state, 'stats').neutral) / W.luckRarityShiftPerPoints);
    if (eff === 'item') rec.rule.notes.push(`Tester Luck ${b.luck} → rarity shift +${lootShift} step${lootShift === 1 ? '' : 's'}; region ${regionName(state, c.region)}${c.region === 'citadel' ? ' (+map.citadelLootShift)' : ''}.`);
    if (wheel === 'fortune') {
      if (eff === 'health') check(`health +wheels.fortuneHealth (${W.fortuneHealth}) capped at max: ${b.health} → ${a.health}`, a.health === Math.min(b.maxHealth, b.health + W.fortuneHealth));
      else if (eff === 'gold') check(`gold +wheels.fortuneGold (${W.fortuneGold}): ${b.gold} → ${a.gold}`, a.gold === b.gold + W.fortuneGold);
      else if (eff === 'item') check(`pending loot +1 (${r.result?.loot?.rarity || '?'} item): ${b.pendingLoot} → ${a.pendingLoot}`, a.pendingLoot === b.pendingLoot + 1);
      else check('nothing changes', a.health === b.health && a.gold === b.gold && a.pendingLoot === b.pendingLoot);
    } else if (wheel === 'fate') {
      if (eff === 'windfall') check(`gold +wheels.fateWindfall (${W.fateWindfall}): ${b.gold} → ${a.gold}`, a.gold === b.gold + W.fateWindfall);
      else if (eff === 'teleport') check(`moved to another region: ${b.pos} (${regionName(state, b.region)}) → ${a.pos} (${regionName(state, a.region)})`, a.pos !== b.pos && a.region !== b.region);
      else if (eff === 'swap') { const w = r.result?.withId, wp = w ? b.positions[w] : null; check(w ? `took ${state.characters[w]?.name}'s hex ${wp}${wp === b.pos ? ' (same hex: a no-op swap)' : ''}: ${b.pos} → ${a.pos}` : `no partner (${r.result?.text}), position kept`, w ? a.pos === wp && state.characters[w]?.pos === b.pos : a.pos === b.pos); }
      else if (eff === 'item') check(`pending loot +1 (${r.result?.loot?.rarity || '?'} item): ${b.pendingLoot} → ${a.pendingLoot}`, a.pendingLoot === b.pendingLoot + 1);
      else if (eff === 'loseturn') check(`miss turns +wheels.fateMissTurns (${W.fateMissTurns}): ${b.missTurns} → ${a.missTurns}`, a.missTurns === b.missTurns + W.fateMissTurns);
      else if (eff === 'bounty') check(`a house bounty of gold.perKO (${G.perKO}) on the tester: ${b.bounties} → ${a.bounties} bounties`, a.bounties === b.bounties + 1 && state.bounties[state.bounties.length - 1]?.gold === G.perKO);
    } else if (wheel === 'loot') {
      if (eff === 'gold') { const exp = Math.round(G.chestGold + G.chestGoldPerTier * (tierOf(c.region) - 1)); check(`gold +gold.chestGold + gold.chestGoldPerTier × (region tier ${tierOf(c.region)} − 1) = ${exp}: ${b.gold} → ${a.gold}`, a.gold === b.gold + exp); }
      else check(`pending loot +1 (${eff === 'egg' ? 'egg' : `${r.result?.loot?.rarity || '?'} item`}): ${b.pendingLoot} → ${a.pendingLoot}`, a.pendingLoot === b.pendingLoot + 1);
    } else if (wheel === 'chaos') {
      const floor = group(state, 'bloodPact').collectorFloor;
      if (r.result?.cancelled) check('House Rules cancelled it', true);
      else if (eff === 'collector') check(`health −chaos.collectorTakes (${C.collectorTakes}, floor ${floor}): ${b.health} → ${a.health}`, a.health === Math.max(floor, b.health - C.collectorTakes));
      else if (eff === 'region' || eff === 'class') check(`one timed effect added (${r.result?.effect?.label || '?'}, ${r.result?.effect?.roundsLeft ?? '?'} rounds): ${b.effects} → ${a.effects}`, a.effects === b.effects + 1);
      else if (eff === 'scramble' || eff === 'shrink' || eff === 'steal') check(`grid effect "${eff}" queued for the inventory module: ${b.gridEffects} → ${a.gridEffects}`, a.gridEffects === b.gridEffects + 1);
      else if (eff === 'vote') check(r.result?.vote ? 'a chaos vote is open for the table' : `only one living player: the Collector visits instead (${b.health} → ${a.health})`, r.result?.vote ? a.vote : a.health < b.health);
      else if (eff === 'tierup') check(`tier +1 (max chaos.maxTier ${C.maxTier}): ${b.tier} → ${a.tier}`, a.tier === Math.min(C.maxTier, b.tier + 1));
      else if (eff === 'scatter') check(`thrown to another hex of the same region: ${b.pos} → ${a.pos}`, a.region === b.region);
      else if (eff === 'apocalypse') { const regions = Object.keys(state.map?.regions || {}).length; check(`tier pinned at ${C.maxTier}, Collector's cut (${C.collectorTakes}) taken, one region effect per region (${regions}): tier ${b.tier} → ${a.tier}, HP ${b.health} → ${a.health}, effects ${b.effects} → ${a.effects}`, a.tier === C.maxTier && a.health === Math.max(floor, b.health - C.collectorTakes) && a.effects === b.effects + regions); }
      else check('mercy: nothing changes', a.health === b.health && a.effects === b.effects && a.gridEffects === b.gridEffects);
    } else if (wheel === 'boss') {
      const base = state.monsters[bossId].baseMaxHealth ?? b.boss.maxHealth;   // moods scale from the unmooded Health, never compounding
      const exp = Math.max(1, Math.round(base * (r.seg.healthMult ?? 1)));
      check(`mood set to ${r.seg.name} (${r.seg.id})`, a.boss.mood === r.seg.id);
      check(`max Health ${base} (unmooded) × ${r.seg.healthMult ?? 1} = ${exp}, healed to full: ${b.boss.health}/${b.boss.maxHealth} → ${a.boss.health}/${a.boss.maxHealth}`, state.monsters[bossId].parts ? a.boss.health === a.boss.maxHealth : a.boss.maxHealth === exp && a.boss.health === exp);
    }
    check('lastSpin written for the TV', state.lastSpin?.wheel === wheel && state.lastSpin.index === r.index);
  }
  rec.before = before;
  rec.logs = state.log.slice(logFrom).map(l => `${l.text} [${l.kind}]`);
  if (wheel !== 'bugreward' && rec.engine) check('at least one log line', rec.logs.length > 0);
  return rec;
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────────
export function screenQa(ctx) {
  const { lab, h, main, phone, toast, drawNav } = ctx;
  const spins = qaSpins(), steps = qaSteps(spins), fast = qs('fast') === '1';
  const spinMs = fast ? 120 : 3200;
  const marks = () => lab.marks;
  if (!marks()[SEED_KEY]?.note) { setNote(marks(), SEED_KEY, String(hash32(`${lab.seed}:qa`))); lab.save(); }
  const seed = () => marks()[SEED_KEY].note;
  const save = () => { lab.save(); drawNav?.(); };
  // Sandboxes per wheel, replayed up to the spin on screen so a reload resumes with the same results.
  const boxes = {};
  const box = (wheel) => (boxes[wheel] ||= { sb: freshSandbox(seed(), wheel, lab.classId), done: 0 });
  const spinTo = (step) => { let bx = box(step.wheel); if (bx.done >= step.k) { boxes[step.wheel] = null; bx = box(step.wheel); } while (bx.done < step.k - 1) { runSpin(bx.sb, steps.find(s => s.wheel === step.wheel && s.k === bx.done + 1), seed()); bx.done++; } const rec = runSpin(bx.sb, step, seed()); bx.done++; return rec; };
  let timer = null, cur = null, landed = false, advancePending = false;
  const stop = () => { if (timer) clearTimeout(timer); timer = null; };
  const progressEl = h('p', { class: 'muted qa-progress' });
  const drawProgress = () => { progressEl.textContent = `${qaProgress(marks(), spins).text} · seed ${seed()} · keys O works · X problem · N skip`; };
  const body = h('div', { class: 'col qa-body' });
  main.append(h('div', { class: 'panel' }, h('h3', {}, '🔍 QA: every wheel ×' + spins), h('p', { class: 'muted' }, `Every wheel in order, ${spins} spins each, one spin at a time. Each wheel starts on a fresh sandbox room with the tester at ${QA_SHEET.health}/${QA_SHEET.maxHealth} Health, ${QA_SHEET.gold} Gold, the starter kit in the grid, no pets, Chaos tier 1. Check the calculation against the game, then tick it.`), progressEl), body);

  const record = (status) => {
    if (!cur) return;
    const key = qaKey(cur.step.wheel, cur.step.k), e = marks()[key] || (marks()[key] = { status: '', note: '', plays: 0, staked: 0, returned: 0, crits: 0 });
    setStatus(marks(), key, status); e.plays = (e.plays || 0) + 1; e.landed = cur.rec.landed; e.text = cur.rec.text; e.checks = cur.rec.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.label}`).join('; ');
    const p = qaProgress(marks(), spins); if (p.done >= p.total) setStatus(marks(), 'qa', p.bad ? 'bad' : 'ok'); else if (marks().qa) { marks().qa.plays = p.done; }
    save(); drawProgress();
  };
  const next = () => { const p = qaProgress(marks(), spins); if (p.next) show(p.next); else showSummary(); };
  const advance = () => { if (landed) next(); else advancePending = true; };
  const verdict = (status) => { if (!cur || cur.verdict) return; cur.verdict = status; record(status); if (status === 'ok') advance(); else { cur.noteBox.style.display = ''; cur.nextBtn.style.display = ''; cur.note.focus(); toast('Noted as a problem — add a note, then Next (N).', 'bad'); } };
  const skip = () => { if (!cur) return next(); if (!cur.verdict) { recordPlay(marks(), qaKey(cur.step.wheel, cur.step.k), 0, 0); const e = marks()[qaKey(cur.step.wheel, cur.step.k)]; e.landed = cur.rec.landed; e.text = cur.rec.text; save(); drawProgress(); } next(); };

  function show(step) {
    stop(); landed = false; advancePending = false;
    const rec = spinTo(step);
    const idx = steps.indexOf(steps.find(s => s.wheel === step.wheel && s.k === step.k));
    const size = phone ? 250 : 300;
    const face = h('div', { class: rec.wheels ? 'cards3 qa-face' : 'center qa-face' });
    if (rec.wheels) for (const w of rec.wheels) face.append(wheelSvg({ outcomes: w.outcomes, index: w.index, size: phone ? 104 : 190 }));
    else face.append(wheelSvg({ outcomes: rec.segs.map(s => s.label), weights: rec.segs.map(s => Number(s.weight ?? 1) || 0), index: rec.index, size }));
    if (fast) for (const g of face.querySelectorAll('g.face')) g.style.transition = 'transform .1s linear';
    const landedEl = h('p', { class: 'qa-landed muted' }, 'Spinning…');
    const segTable = (segs, index, title = null) => h('div', { class: 'qa-table' }, title ? h('h4', {}, title) : null, h('table', { class: 'lab' }, h('thead', {}, h('tr', {}, h('th', {}, 'Segment'), h('th', {}, 'Weight'), h('th', {}, 'Odds'), h('th', {}, 'What it does'))),
      h('tbody', {}, segs.map((s, i) => h('tr', { class: i === index ? 'qa-hit' : '', dataset: { seg: s.id || s.label } }, h('td', {}, i === index ? '▶ ' : '', s.label), h('td', {}, String(s.weight)), h('td', {}, `${s.pct.toFixed(1)}%`), h('td', { class: 'muted' }, s.text || ''))))));
    const tables = rec.wheels ? h('div', { class: 'col' }, rec.wheels.map(w => segTable(w.segs, w.index, `${w.pool} wheel`))) : segTable(rec.segs, rec.index);
    const rule = h('div', { class: 'qa-rule' }, h('p', {}, h('b', {}, rec.landed), rec.rule.text ? ` — ${rec.rule.text}` : ''), h('p', { class: 'qa-result' }, 'Result: ', h('b', {}, rec.text)),
      rec.rule.keys.length ? h('ul', { class: 'qa-keys mono' }, rec.rule.keys.map(k => h('li', {}, `${k.path} = ${k.value}`))) : h('p', { class: 'muted' }, 'No balance numbers named.'),
      rec.rule.notes.map(n => h('p', { class: 'muted' }, n)));
    const rows = diffRows(rec.before, rec.after);
    const diff = h('div', { class: 'qa-diff' }, rows.map(r => h('div', { class: `qa-row ${r.changed ? 'changed' : ''}` }, h('span', { class: 'k' }, r.label), h('span', { class: 'v' }, r.changed ? [h('s', {}, r.before), ' → ', h('b', {}, r.after)] : r.before))));
    const checks = h('ul', { class: 'qa-checks' }, rec.checks.map(c => h('li', { class: c.ok ? 'ok' : 'bad' }, `${c.ok ? '✓' : '✗'} ${c.label}`)));
    const logs = h('div', { class: 'log log-box qa-log' }, rec.logs.length ? rec.logs.map(l => h('div', {}, l)) : h('div', { class: 'muted' }, rec.wheel === 'bugreward' ? `no public log line ${rec.logs.length === 0 ? '✓' : '✗'} (secret spin: expected none)` : 'no log line written'));
    if (rec.wheel === 'bugreward' && rec.logs.length) logs.prepend(h('div', { class: 'error' }, `no public log line ✗ — ${rec.logs.length} line${rec.logs.length === 1 ? '' : 's'} leaked`));
    const note = h('textarea', { rows: 3, placeholder: 'What went wrong? What did you expect?' });
    const e0 = marks()[qaKey(step.wheel, step.k)]; note.value = e0?.note || '';
    note.addEventListener('input', () => { setNote(marks(), qaKey(step.wheel, step.k), note.value); lab.save(); });
    const noteBox = h('div', { class: 'qa-note', style: { display: 'none' } }, h('label', { class: 'muted' }, 'Problem note'), note);
    const nextBtn = h('button', { class: 'primary', style: { display: 'none' }, title: 'N', onClick: next }, 'Next →');
    const buttons = h('div', { class: 'row qa-verdict' }, h('button', { class: 'primary', title: 'O', onClick: () => verdict('ok') }, '✅ Works'), h('button', { class: 'danger', title: 'X', onClick: () => verdict('bad') }, '❌ Problem'), h('button', { class: 'ghost', title: 'N', onClick: skip }, 'Skip'), nextBtn);
    body.replaceChildren(
      h('div', { class: 'panel col qa-spin', dataset: { wheel: step.wheel, k: String(step.k) } }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', { class: 'qa-title' }, `${step.name} · spin ${step.k}/${spins}${step.tier ? ` · tier ${step.tier}` : ''}`), h('span', { class: 'muted' }, `${idx + 1} of ${steps.length}`)), face, landedEl),
      h('div', { class: 'panel qa-calc' }, h('h3', {}, 'The calculation'),
        h('h4', {}, 'a · Segments and odds'), tables,
        h('h4', {}, 'b · The rule and its numbers'), rule,
        h('h4', {}, `c · Sandbox tester, before → after (start of wheel: ${QA_SHEET.health}/${QA_SHEET.maxHealth} HP · ${QA_SHEET.gold} Gold · starter kit · Chaos tier 1)`), diff,
        h('h4', {}, 'Checks'), checks,
        h('h4', {}, 'd · Log lines this spin wrote'), logs),
      h('div', { class: 'panel' }, h('h3', {}, 'Did it work?'), buttons, noteBox));
    cur = { step, rec, verdict: null, note, noteBox, nextBtn };
    drawProgress();
    timer = setTimeout(() => { landed = true; landedEl.textContent = `Landed: ${rec.landed}`; landedEl.classList.add('on'); landedEl.classList.remove('muted'); if (advancePending) next(); }, spinMs + 50);
    main.scrollIntoView?.({ block: 'start' });
  }
  function showSummary() {
    stop(); cur = null; landed = true;
    const p = qaProgress(marks(), spins);
    const cell = (w, k) => { const e = marks()[qaKey(w.id, k)] || {}; const st = e.status === 'ok' ? '✅' : e.status === 'bad' ? '❌' : e.plays ? '⏭' : '—'; return h('td', {}, h('button', { class: `ghost qa-cell ${e.status || ''}`, title: 'Redo this spin', onClick: () => { delete marks()[qaKey(w.id, k)]; setStatus(marks(), 'qa', ''); save(); show(steps.find(s => s.wheel === w.id && s.k === k)); } }, `${st} ${e.landed || ''}`)); };
    const table = h('table', { class: 'lab qa-summary' }, h('thead', {}, h('tr', {}, h('th', {}, 'Wheel'), Array.from({ length: spins }, (_, i) => h('th', {}, `Spin ${i + 1}`)), h('th', {}, 'Notes'))),
      h('tbody', {}, QA_WHEELS.map(w => h('tr', {}, h('td', {}, w.name), Array.from({ length: spins }, (_, i) => cell(w, i + 1)), h('td', { class: 'muted wrap' }, Array.from({ length: spins }, (_, i) => marks()[qaKey(w.id, i + 1)]?.note).filter(Boolean).map((n, i) => h('div', {}, `${i + 1}. ${n}`)))))));
    const text = () => qaReportText(marks(), seed(), spins);
    body.replaceChildren(h('div', { class: `panel ${p.bad ? 'blood' : 'gold'} qa-done` }, h('h2', {}, `${p.bad ? '⚠️' : '✅'} Run complete · ${p.text}`), h('p', { class: 'muted' }, 'Tap a cell to redo that spin.'), h('div', { class: 'qa-table' }, table),
      h('div', { class: 'row qa-verdict', style: { marginTop: '10px' } },
        h('button', { class: 'primary', onClick: async () => { const t = text(); toast((await copyText(t)) ? 'QA report copied — paste it into the chat.' : 'Clipboard blocked — downloading instead'); if (!navigator.clipboard) download('gwf-lab-qa-report.txt', t, 'text/plain'); } }, '📋 Copy report'),
        h('button', { onClick: () => download('gwf-lab-qa-report.txt', text(), 'text/plain') }, 'Download'),
        h('button', { class: 'ghost', onClick: () => { for (const k of Object.keys(marks())) if (k.startsWith('qa:')) delete marks()[k]; setStatus(marks(), 'qa', ''); if (marks().qa) marks().qa.plays = 0; setNote(marks(), SEED_KEY, String(hash32(`${lab.seed}:qa:${Date.now()}`))); for (const k of Object.keys(boxes)) boxes[k] = null; save(); toast('QA run cleared.'); next(); } }, 'Start over')),
      h('pre', { class: 'mono wrap qa-report' }, text())));
    drawProgress();
  }
  lab.mount = { stop, keys: { o: () => verdict('ok'), x: () => verdict('bad'), n: () => (cur?.verdict === 'bad' ? next() : skip()) }, get cur() { return cur; }, get landed() { return landed; }, next, show, verdict, skip };
  next();
}
