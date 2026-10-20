// Lab screen: the wheels. Buy-in, Chaos, Fortune, Fate, Loot, Boss, Movement, Challenge and the Triple Pet Wheel
// spin on the Lab's sandbox room (an in-memory room with the tester in play) through the same functions the
// handlers use, so Gold, loot, teleports and moods really apply to the sandbox sheet.
import { spinWheel, segmentsFor, chaosOf } from '../../../packages/shared/handlers/wheels.js';
import { spinHatch, speciesDef } from '../../../packages/shared/handlers/pets.js';
import { activeList } from '../../../packages/shared/handlers/challenge.js';
import { BOOTS, wheelSegments, bootAffixes } from '../../../packages/shared/handlers/movement.js';
import { makeItem } from '../../../packages/games/items.js';
import { group } from '../../../packages/shared/balance.js';
import { makeRng, hash32, weightedIndex } from '../../../packages/shared/rng.js';
import { characterOf } from '../../../packages/shared/state.js';
import { wheelSvg } from '../../../packages/ui/labkit.js';
import wheelsData from '../../../data/wheels.json' with { type: 'json' };

export const WHEEL_IDS = [
  { id: 'buyin', name: 'Buy-in Wheel' }, { id: 'chaos', name: 'Chaos Wheel' }, { id: 'fortune', name: 'Fortune Wheel' }, { id: 'fate', name: 'Fate Wheel' }, { id: 'loot', name: 'Loot Wheel' },
  { id: 'boss', name: 'Boss Wheel (moods)' }, { id: 'movement', name: 'Movement Wheel (boots)' }, { id: 'challenge', name: 'Challenge Wheel' }, { id: 'pets', name: 'Triple Pet Wheel' },
];

export function screenWheels(ctx) {
  const { lab, h, main, phone, id } = ctx;
  const wheel = id.slice('wheel:'.length);
  const sb = lab.sb();
  const state = sb.state, c = sb.tester();
  const log = h('div', { class: 'log log-box' });
  const msg = (t, cls = '') => { log.prepend(h('div', { class: cls }, t)); while (log.children.length > 10) log.lastChild.remove(); };
  const sheet = h('div', { class: 'muted' });
  const drawSheet = () => { const cc = sb.tester(); sheet.textContent = `Sandbox: ${cc.name} · ${cc.health}/${cc.maxHealth} HP · ${cc.gold} Gold · at ${cc.pos} (${state.map?.regions?.[cc.region]?.name || cc.region}) · pending loot ${(cc.pendingLoot || []).length} · Chaos tier ${chaosOf(state).tier}`; };
  drawSheet();
  const face = h('div', { class: 'center' });
  const options = h('div', { class: 'row' });
  let extra = {}, segs = [], labels = [];
  const info = h('p', { class: 'muted' });
  // Which segments are on the wheel right now.
  const build = () => {
    const MV = group(state, 'movement'), CH = group(state, 'challenge');
    if (wheel === 'buyin') { const H = group(state, 'health'), steps = 8, span = H.buyinMax - H.buyinMin; segs = Array.from({ length: steps }, (_, i) => ({ label: String(Math.round(H.buyinMin + span * i / (steps - 1))), weight: 1 })); info.textContent = 'Max Health for the run, one spin per player before the start (or a flat start). Also one of the four creation gambles.'; }
    else if (wheel === 'movement') { const base = BOOTS.bases.find(b => b.id === (extra.bootsId || 'croupiers_heels')) || BOOTS.bases.find(b => b.mode === 'wheel') || BOOTS.bases[0]; const item = { ...makeItem(null, { baseId: 'coinblade' }), baseId: base.id, bootMode: 'wheel', unique: extra.unique || null, affixes: extra.affix ? [{ id: extra.affix, kind: 'movement' }] : [] }; segs = wheelSegments(item, bootAffixes(item), MV).map(s => ({ ...s, weight: s.weight || 1 })); info.textContent = `Wheel boots spin this instead of rolling: ${segs.map(s => s.label).join(' · ')}.`; }
    else if (wheel === 'challenge') { segs = activeList(state).filter(e => e.enabled && e.weight > 0); info.textContent = `The active preset (${state.gm.challengePreset}); weights decide the odds. Hosted entries play on the phones, external ones at the table. Caps ${CH.hostedCapSeconds}s / ${CH.externalCapSeconds}s.`; }
    else if (wheel === 'pets') { segs = []; info.textContent = 'Three wheels: common species, the region\'s species, and the rare wheel with dud segments. The player keeps one of the three results.'; }
    else if (wheel === 'boss') { const bosses = Object.values(state.monsters).filter(m => m.boss && !m.dead); const m = bosses.find(b => b.id === extra.monsterId) || bosses[0]; extra.monsterId = m?.id; segs = m ? segmentsFor(state, 'boss', { monsterId: m.id }) : []; info.textContent = m ? `${m.name}'s moods; the spin rescales its Health and damage.` : 'No boss standing in the sandbox.'; }
    else { segs = segmentsFor(state, wheel, extra) || []; info.textContent = { fortune: 'Lands on a Wheel tile: heal, Gold, an item or nothing.', fate: 'Lands on an Event tile: windfall, trapdoor, switcheroo, found property, blackout or a bounty.', loot: 'Opened by a chest: item (rarity shifted by Luck and region), Gold or an egg.', chaos: `Chaos tier ${chaosOf(state).tier}: only segments at or under the tier are on the wheel.` }[wheel] || ''; }
    labels = segs.map(s => s.label || s.name || s.id);
  };
  const drawFace = (index = null, wheels = null) => {
    face.replaceChildren();
    if (wheel === 'pets') { const ws = wheels || [{ outcomes: Array(8).fill('?') }, { outcomes: Array(8).fill('?') }, { outcomes: Array(8).fill('?') }]; face.className = 'cards3'; for (const w of ws) face.append(wheelSvg({ outcomes: w.outcomes.map(o => speciesDef(o)?.name || (o === null ? 'dud' : o)), index: w.index ?? null, size: phone ? 110 : 200 })); return; }
    face.className = 'center'; face.append(wheelSvg({ outcomes: labels.length ? labels : ['—'], weights: labels.length ? segs.map(s => Number(s.weight ?? 1) || 0) : null, index, size: phone ? 260 : 320 }));
  };
  const spin = () => {
    const ctxN = sb.ctx(); sb.tick(1500);
    try {
      if (wheel === 'buyin' || wheel === 'movement' || wheel === 'challenge') {
        const rng = makeRng(hash32(`${lab.seed}:${wheel}:${Date.now()}`)); const i = weightedIndex(rng, segs); drawFace(i);
        setTimeout(() => msg(`The ${wheel} wheel lands on ${labels[i]}${wheel === 'movement' && segs[i].steps != null ? ` (${segs[i].steps} steps)` : ''}`, 'turn'), 3200);
        lab.record(id, 1, 1, false); return;
      }
      if (wheel === 'pets') { const hatch = spinHatch(state, ctxN, sb.tester(), 'setup', extra.regionId || sb.tester().region); drawFace(null, hatch.wheels); setTimeout(() => { msg(`Pet wheels: ${hatch.wheels.map(w => speciesDef(w.outcomes[w.index])?.name || 'a dud egg').join(' / ')}`, 'turn'); sb.tester().hatching = null; }, 3200); lab.record(id, 1, 1, false); return; }
      const r = spinWheel(state, ctxN, wheel, 'tester', extra);
      drawFace(r.index);
      setTimeout(() => { msg(`${labels[r.index]}: ${r.result?.text || state.lastSpin?.text || '—'}`, 'turn'); for (const l of state.log.slice(-3)) msg(l.text); drawSheet(); build(); }, 3200);
      lab.record(id, 1, 1, false);
    } catch (e) { msg(e.message, 'error'); }
  };
  // Per-wheel options.
  const drawOptions = () => {
    options.replaceChildren();
    if (wheel === 'chaos') options.append(h('label', { class: 'row' }, 'Tier ', h('select', { onChange: (e) => { sb.apply('GM_CHAOS', { tier: Number(e.target.value) }); build(); drawFace(); drawSheet(); } }, [1, 2, 3, 4, 5].map(t => h('option', { value: t, selected: chaosOf(state).tier === t }, `Tier ${t}`)))));
    if (wheel === 'boss') { const bosses = Object.values(state.monsters).filter(m => m.boss && !m.dead); options.append(h('select', { onChange: (e) => { extra.monsterId = e.target.value; build(); drawFace(); } }, bosses.map(m => h('option', { value: m.id, selected: m.id === extra.monsterId }, `${m.name} (${m.final ? 'final' : m.raid ? 'raid' : 'boss'})`)))); }
    if (wheel === 'movement') options.append(h('select', { onChange: (e) => { extra.bootsId = e.target.value; build(); drawFace(); } }, BOOTS.bases.map(b => h('option', { value: b.id, selected: b.id === (extra.bootsId || 'croupiers_heels') }, `${b.name} (${b.mode})`))),
      h('select', { onChange: (e) => { extra.unique = e.target.value || null; build(); drawFace(); } }, h('option', { value: '' }, 'no unique'), Object.keys(BOOTS.uniques || {}).map(u => h('option', { value: u }, `unique: ${u}`))),
      h('select', { onChange: (e) => { extra.affix = e.target.value || null; build(); drawFace(); } }, h('option', { value: '' }, 'no affix'), Object.keys(BOOTS.affixes || {}).map(a => h('option', { value: a }, `affix: ${a}`))));
    if (wheel === 'pets') options.append(h('select', { onChange: (e) => { extra.regionId = e.target.value; } }, Object.values(state.map.regions).map(r => h('option', { value: r.id, selected: r.id === (extra.regionId || sb.tester().region) }, `eggs from ${r.name}`))));
    if (wheel === 'loot' || wheel === 'fortune' || wheel === 'fate') { const cc = sb.tester(); options.append(h('label', { class: 'row' }, 'Luck ', h('input', { type: 'number', min: 1, max: 10, value: cc.stats.luck, style: { maxWidth: '80px', minHeight: '36px' }, onChange: (e) => { cc.stats.luck = Number(e.target.value); } }))); }
  };
  build(); drawOptions(); drawFace();
  const segTable = h('table', { class: 'lab' }, h('thead', {}, h('tr', {}, h('th', {}, 'Segment'), h('th', {}, 'Weight'), h('th', {}, 'What it does'))), h('tbody', {}, wheel === 'pets' ? h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'See the Pets data page for the pools.')) : segs.map(s => h('tr', {}, h('td', {}, s.label || s.name), h('td', {}, s.weight ?? 1), h('td', { class: 'muted' }, s.text || s.rules || (s.steps != null ? `${s.steps} steps` : s.hosted != null ? (s.hosted ? `hosted: ${s.game}` : 'external') : ''))))));
  main.append(h('div', { class: 'panel col' }, info, face, h('div', { class: 'row' }, h('button', { class: 'primary big', style: { width: 'auto', minWidth: '200px' }, onClick: spin }, '🎡 Spin'), options), log, sheet),
    h('div', { class: 'panel' }, h('h3', {}, 'Segments'), segTable),
    wheel === 'chaos' ? h('div', { class: 'panel' }, h('h3', {}, 'Chaos effects'), h('ul', { class: 'muted' }, wheelsData.chaos.map(s => h('li', {}, h('b', {}, s.label), ` (tier ${s.minTier}+): ${s.text}`)))) : null);
  lab.mount = { stop() {}, auto: spin, settle: () => false };
}
