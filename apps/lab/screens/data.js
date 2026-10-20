// Lab screens: the browsable data pages, so everything in the spec is reachable from the Lab — the 28 Named
// Legendaries with their effect text, the Blockcraft sets, the pet species, every monster species (with "set as
// the dummy" so an item can be played against its stats and Health, and its own items playable as the monster),
// the boots (bases, uniques, affixes, the movement wheel), the six classes (with their actives) and the affix table.
import legendaries from '../../../data/legendaries.json' with { type: 'json' };
import sets from '../../../data/sets.json' with { type: 'json' };
import petsData from '../../../data/pets.json' with { type: 'json' };
import monsters from '../../../data/monsters.json' with { type: 'json' };
import boots from '../../../data/boots.json' with { type: 'json' };
import classes from '../../../data/classes.json' with { type: 'json' };
import affixes from '../../../data/affixes.json' with { type: 'json' };
import regions from '../../../data/regions.json' with { type: 'json' };
import { ITEMS } from '../../../packages/games/items.js';
import { gameMeta } from '../../../packages/games/adapter.js';
import { B } from '../../../packages/shared/balance.js';
import { store } from '../../../packages/ui/dom.js';

export const DATA_PAGES = [
  { id: 'legendaries', name: 'Named Legendaries', icon: '👑' }, { id: 'sets', name: 'Blockcraft sets', icon: '🛡' }, { id: 'pets', name: 'Pet species', icon: '🐾' },
  { id: 'monsters', name: 'Monsters', icon: '💀' }, { id: 'boots', name: 'Boots & movement', icon: '👢' }, { id: 'classes', name: 'Classes & actives', icon: '🎭' }, { id: 'affixes', name: 'Affixes & regions', icon: '✨' },
];
const BAL = (group, key) => { const v = B[group]?.[key]; return v === undefined ? '?' : Array.isArray(v) ? v.join('/') : String(v); };
const tbl = (h, heads, rows) => h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'lab' }, h('thead', {}, h('tr', {}, heads.map(x => h('th', {}, x)))), h('tbody', {}, rows)));

export function screenData(ctx) {
  const { h, main, id } = ctx;
  const page = id.slice('data:'.length);
  const fn = PAGES[page]; if (!fn) { main.append(h('p', { class: 'log error' }, `No data page ${page}`)); return; }
  main.append(h('div', { class: 'row' }, DATA_PAGES.map(p => h('button', { class: p.id === page ? 'primary' : 'ghost', style: { minHeight: '36px', fontSize: '.62rem' }, onClick: () => ctx.open(`data:${p.id}`) }, `${p.icon} ${p.name}`))));
  fn(ctx);
  ctx.lab.mount = null;
}

const PAGES = {
  legendaries({ h, main }) {
    const L = B.legendaries || {};
    main.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, legendaries._about.split('.')[0] + '. Numbers come from balance.json › legendaries; the effect key says which module switches on it.'),
      tbl(h, ['Legendary', 'Slot · game', 'Nods to', 'Effect', 'Tunables'], legendaries.legendaries.map(l => h('tr', {}, h('td', {}, h('b', {}, l.name), h('div', { class: 'mono muted' }, l.id)), h('td', {}, l.slot, l.gameId ? h('div', { class: 'muted' }, `${gameMeta(l.gameId).icon} ${gameMeta(l.gameId).name}`) : null, h('div', { class: 'muted' }, `${l.footprint?.w}×${l.footprint?.h}`)), h('td', { class: 'muted' }, l.nodsTo || ''), h('td', {}, l.text, h('div', { class: 'mono muted' }, `${l.effect?.key} · ${l.effect?.owner}`)), h('td', { class: 'mono muted' }, (l.effect?.params || []).map(p => `${p}=${L[p] ?? '?'}`).join(' ')))))));
  },
  sets({ h, main }) {
    main.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, `Five four-piece sets over ${sets.slots.join(', ')}; pieces drop singly from Chests (${BAL('items', 'setDropChance')} chance per armour slot). The four-piece bonus needs ${BAL('sets', 'pieces')} pieces worn.`),
      tbl(h, ['Set', 'Per piece', 'Four-piece bonus', 'Pieces'], sets.sets.map(s => h('tr', {}, h('td', {}, h('b', {}, s.name), h('div', { class: 'muted' }, `${s.rarity} · ${s.flavour}`), s.dyeable ? h('div', { class: 'muted' }, 'dyeable') : null, s.crumbles ? h('div', { class: 'muted' }, s.crumbles.text) : null), h('td', {}, h('ul', { style: { margin: 0, paddingLeft: '18px' } }, (s.perPiece || []).map(p => h('li', {}, p.text, p.valueKey ? h('span', { class: 'mono muted' }, ` (${p.valueKey}=${B.sets?.[p.valueKey] ?? '?'})`) : null)))), h('td', {}, s.bonus?.text, h('div', { class: 'mono muted' }, `${s.bonus?.key} · ${s.bonus?.owner}${s.bonus?.valueKey ? ` · ${s.bonus.valueKey}=${B.sets?.[s.bonus.valueKey] ?? '?'}` : ''}`)), h('td', { class: 'muted' }, Object.values(s.pieceNames || {}).join(', ')))))));
  },
  pets({ h, main, open }) {
    const P = B.pets;
    main.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, `${petsData.species.length} species over the elements ${petsData.elements.join(', ')}. Pools: common (left wheel), region (middle, biased ×${BAL('map', 'regionBiasWeight')} to the region's species), rare (right, ${P.rareWheelBlanks} dud segments). Evolve at ${(P.evolveAt || []).join(' and ')} Power.`),
      tbl(h, ['Species', 'Element · pool', 'Stages', 'Attacks', ''], petsData.species.map(s => h('tr', {}, h('td', {}, h('b', {}, s.name), h('div', { class: 'muted' }, s.flavour || s.legacy || '')), h('td', {}, s.element, h('div', { class: 'muted' }, `${s.pool}${s.regionBias ? ` · ${s.regionBias}` : ''}${s.onlyRegion ? ` · only ${s.onlyRegion}` : ''}${s.swarm ? ' · swarm' : ''}`)), h('td', { class: 'muted' }, (s.stages || []).map(x => x.name).join(' → ')), h('td', { class: 'muted' }, s.attacks.map(a => `${a.name} (${a.gameId} ${a.stake}${a.effect ? `, ${a.effect}` : ''})`).join(' · ')), h('td', {}, h('button', { onClick: () => open(`pet:${s.id}`) }, 'Play')))))));
  },
  monsters({ h, main, lab, open, toast }) {
    const M = B.monsters;
    const base = (role) => (role === 'final' ? M.healthFinal : role === 'raid' ? M.healthRaid : role === 'boss' ? M.healthBoss : M.healthCommon);
    const hp = (s) => Math.max(1, Math.round(base(s.role) * (s.healthMult || 1)));
    const setDummy = (s) => { lab.state.dummy = { id: 'dummy', name: s.name, speciesId: s.id, stats: { ...s.stats }, health: hp(s), maxHealth: hp(s), items: s.items.slice() }; toast(`${s.name} is the dummy now: ${hp(s)} Health, its stats drive the target levers.`); };
    main.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, `${monsters.species.length} species. Health = base (common ${M.healthCommon} / boss ${M.healthBoss} / raid ${M.healthRaid} / final ${M.healthFinal}) × healthMult × (1 + ${M.tierScale} × (tier − 1)). Monsters stake ${Math.round(M.monsterStakeFraction * 100)}% of their items' stake from their own Health. "Set as dummy" makes the Lab's opponent this monster; "as monster" plays one of its items with the monster attacking the tester.`),
      tbl(h, ['Monster', 'Region · role', 'Health (t1)', 'Stats L/N/G/G', 'Items', 'Loot', ''], monsters.species.map(s => h('tr', {}, h('td', {}, h('b', {}, s.name), h('div', { class: 'muted' }, s.flavour || ''), s.special ? h('div', { class: 'mono muted' }, `special: ${s.special}`) : null, s.moods ? h('div', { class: 'muted' }, `moods: ${s.moods.map(m => m.name).join(', ')}`) : null),
        h('td', {}, regions.regions.find(r => r.id === s.regionId)?.name || s.regionId || 'anywhere', h('div', {}, h('span', { class: `pill ${['boss', 'raid', 'final'].includes(s.role) ? 'gold' : ''}` }, s.role)), h('div', { class: 'muted' }, `tier ${s.tier}`)), h('td', {}, hp(s)), h('td', { class: 'mono' }, `${s.stats.luck}/${s.stats.nerve}/${s.stats.greed}/${s.stats.grit}`),
        h('td', {}, h('div', { class: 'pill-list' }, s.items.map(it => h('button', { style: { minHeight: '32px', fontSize: '.6rem' }, title: 'Play this item with the monster attacking', onClick: () => { setDummy(s); lab.attackerSide = 'dummy'; open(it); } }, `${ITEMS[it]?.name || it} as monster`)))),
        h('td', { class: 'muted' }, `Gold ${s.loot.gold.join('–')} · drop ${Math.round(s.loot.dropChance * 100)}% · egg ${Math.round((s.loot.egg || 0) * 100)}%`), h('td', {}, h('button', { onClick: () => { setDummy(s); lab.attackerSide = 'tester'; open(lab.order[0]); } }, 'Set as dummy')))))));
  },
  boots({ h, main, open }) {
    const MV = B.movement;
    main.append(h('div', { class: 'panel' }, h('h3', {}, 'Bases'), h('p', { class: 'muted' }, 'The Boots slot is the movement engine: roll a die, spin the movement wheel, or draw a colour card. Stop rules: any die in movement.halfStopDice stops only after half the roll, movement.fullWalkDice walks it all.'),
      tbl(h, ['Boots', 'Mode', 'Die', 'Stop', 'Floor', 'Text'], boots.bases.map(b => h('tr', {}, h('td', {}, h('b', {}, b.name), h('div', { class: 'mono muted' }, b.id)), h('td', {}, b.mode), h('td', {}, b.die ? `d${b.die}` : '—'), h('td', {}, b.stop), h('td', {}, b.rarityFloor), h('td', { class: 'muted' }, b.text))))),
      h('div', { class: 'grid2', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' } },
        h('div', { class: 'panel' }, h('h3', {}, 'Uniques'), h('ul', { class: 'muted' }, Object.entries(boots.uniques || {}).map(([k, u]) => h('li', {}, h('b', {}, u.name || k), ` — ${u.text}`)))),
        h('div', { class: 'panel' }, h('h3', {}, 'Movement affixes'), h('ul', { class: 'muted' }, Object.entries(boots.affixes || {}).map(([k, a]) => h('li', {}, h('b', {}, k), ` (${a.mode}) — ${a.text}`))))),
      h('div', { class: 'panel' }, h('h3', {}, 'The movement wheel and the colour deck'), h('p', { class: 'muted' }, `Segments: ${boots.wheel.segments.map(s => s.label + (s.stepsKey ? ` (${MV[s.stepsKey]})` : '')).join(' · ')}${boots.wheel.boost ? ` · Octane adds ${boots.wheel.boost.label} ${MV[boots.wheel.boost.stepsKey]} twice` : ''}. Colour deck: ${JSON.stringify(boots.colourDeck || {})}, ${MV.colourDoubles} doubles. Barefoot: ${BAL('movement', 'barefootSteps')} step(s).`),
        h('button', { onClick: () => open('wheel:movement') }, '🎡 Spin the movement wheel')));
  },
  classes({ h, main, lab, toast }) {
    const C = B.classes || {};
    main.append(h('div', { class: 'panel' }, h('p', { class: 'muted' }, `Six classes; the class stat gets +${BAL('stats', 'classBonus')} at creation. The active's cooldown and every percentage live in balance.json › classes. Pick one as the Lab's practice class: Croupier shows the Rig the Deck control on item rounds, Whale the Double Down toggle.`),
      tbl(h, ['Class', 'Plays like', 'Passive', 'Active', 'Upgrades', ''], classes.classes.map(c => h('tr', {}, h('td', {}, h('b', {}, c.name), h('div', { class: 'muted' }, `${c.stat} · mark: ${c.mark} · starts with ${ITEMS[c.startWeapon]?.name || c.startWeapon}`)), h('td', { class: 'muted' }, c.playsLike), h('td', {}, c.passive?.text, h('div', { class: 'mono muted' }, (c.passive?.effects || []).join(', '))), h('td', {}, h('b', {}, c.active?.name), ` — ${c.active?.text}`, h('div', { class: 'mono muted' }, `${c.active?.id} · cooldown ${C[c.active?.cooldownKey] ?? '?'} (${c.active?.cooldownKey})`)), h('td', { class: 'muted' }, h('ul', { style: { margin: 0, paddingLeft: '18px' } }, (c.upgrades || []).map(u => h('li', {}, `Lv ${u.level}: ${u.text}`)))), h('td', {}, h('button', { class: lab.classId === c.id ? 'primary' : '', onClick: () => { lab.classId = c.id; lab.state.tester.classId = c.id; store.set('gwfrpg:lab:class', c.id); toast(`Practice class: ${c.name}`); } }, 'Use'))))),
      h('p', { class: 'muted' }, `Starter kit: ${classes.starterKit.map(i => ITEMS[i]?.name || i).join(', ')} plus the class weapon and ${BAL('items', 'starterPotions')} Potion(s).`)));
  },
  affixes({ h, main }) {
    const A = B.affixes || {};
    main.append(h('div', { class: 'panel' }, h('h3', {}, 'Affixes'), h('p', { class: 'muted' }, `Rolled on Rare (${BAL('items', 'affixesRare')}), Epic (${BAL('items', 'affixesEpic')}) and Legendary (${BAL('items', 'affixesLegendary')}) items; values from balance.json › affixes.`),
      tbl(h, ['Affix', 'Kind · slots', 'Target', 'Text', 'Names'], affixes.affixes.map(a => h('tr', {}, h('td', {}, h('b', {}, a.id)), h('td', { class: 'muted' }, `${a.kind} · ${(a.slots || []).join(', ')}`), h('td', { class: 'muted' }, a.target || '—'), h('td', {}, a.text, h('div', { class: 'mono muted' }, (a.valueKeys || []).map(k => `${k}=${A[k] ?? '?'}`).join(' '))), h('td', { class: 'muted' }, [...(a.prefixes || []), ...(a.suffixes || [])].join(', ')))))),
      h('div', { class: 'panel' }, h('h3', {}, 'Regions'), tbl(h, ['Region', 'Tier', 'Family', 'Accent', 'Modifier', 'Neighbours'], regions.regions.map(r => h('tr', {}, h('td', {}, h('b', {}, r.name), h('div', { class: 'muted' }, r.look || '')), h('td', {}, r.tier), h('td', {}, r.family), h('td', {}, h('span', { style: { color: r.accent } }, r.accentName || r.accent)), h('td', { class: 'muted' }, r.modifier?.text || ''), h('td', { class: 'muted' }, (r.neighbours || []).join(', ')))))));
  },
};
