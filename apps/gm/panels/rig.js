// GM panel: Rig & Spotlight. Force the next result of any stream (dice, wheels, loot, colours, challenge, pets),
// see what is queued, pin up to four phones to the TV's 2×2 grid, and the GM's cheat sheet of economy commands.
import { STREAMS } from '../../../packages/shared/rng.js';
import { currentPlayerId } from '../../../packages/shared/state.js';

export function panelRig({ state, h, gm, main, redraw }) {
  const stream = h('select', {}, STREAMS.map(s => h('option', { value: s }, s)));
  const value = h('input', { placeholder: 'e.g. 6 for a die, a segment label for a wheel, an index' });
  const queued = Object.entries(state.rig || {}).flatMap(([s, vals]) => vals.map(v => `${s} → ${JSON.stringify(v)}`));
  const seats = state.seats.map(id => state.players[id]).filter(Boolean);
  const spot = new Set(state.gm.spotlight || []);
  const toggle = (id) => { if (spot.has(id)) spot.delete(id); else if (spot.size < 4) spot.add(id); gm('GM_SPOTLIGHT', { playerIds: [...spot] }); };
  const target = h('select', {}, seats.map(p => h('option', { value: p.id }, p.name)));
  const amount = h('input', { type: 'number', value: 10, style: { maxWidth: '120px' } });
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Rig the next result'), h('p', { class: 'muted' }, 'Nobody sees this. The animation lands where you decide. Dice take a number; wheels take a segment label or index; loot takes a rarity index (0 Common … 3 Legendary); colours take a colour name.'),
      h('div', { class: 'row' }, stream, value, h('button', { class: 'primary', onClick: () => { const raw = value.value.trim(); if (!raw) return; gm('GM_RIG', { stream: stream.value, value: isNaN(Number(raw)) ? raw : Number(raw) }); value.value = ''; } }, 'Queue')),
      queued.length ? h('p', {}, h('b', {}, 'Queued: '), queued.join(' · ')) : h('p', { class: 'muted' }, 'Nothing queued.')),
    h('div', { class: 'panel' }, h('h2', {}, 'Spotlight'), h('p', { class: 'muted' }, 'Pin up to four phones\' games to the TV in a 2 × 2 grid (creation gambles, fights).'),
      h('div', { class: 'row' }, seats.map(p => h('button', { class: spot.has(p.id) ? 'primary' : '', onClick: () => toggle(p.id) }, p.name)), spot.size ? h('button', { class: 'ghost', onClick: () => gm('GM_SPOTLIGHT', { playerIds: [] }) }, 'Clear') : null)),
    h('div', { class: 'panel' }, h('h2', {}, 'Hand of the House'), h('p', { class: 'muted' }, 'Direct interventions. Everything is logged.'),
      h('div', { class: 'row' }, target, amount,
        h('button', { onClick: () => gm('GM_GOLD', { playerId: target.value, amount: Number(amount.value) }) }, '± Gold'),
        h('button', { onClick: () => gm('GM_HEALTH', { playerId: target.value, amount: Number(amount.value) }) }, '± Health'),
        h('button', { onClick: () => { const hex = prompt('Teleport to hex key (q,r):'); if (hex) gm('GM_TELEPORT', { playerId: target.value, hex }); } }, 'Teleport'),
        h('button', { onClick: () => { const spec = prompt('Item: baseId or legendary id, optional rarity (e.g. "potion", "amuletofpotency", "helmet epic")'); if (spec) { const [baseId, rarity] = spec.split(/\s+/); gm('GM_ITEM', { playerId: target.value, baseId, rarity: rarity || 'common' }); } } }, 'Give item'),
        h('button', { onClick: () => { const t = prompt('Quest text:'); if (t) gm('GM_QUEST', { playerId: target.value, text: t }); } }, 'Issue quest'),
        h('button', { class: 'danger', onClick: () => { if (confirm('Reset this character (clears curses, pools, pacts, Chaos effects; moves to the last safe hex)?')) gm('GM_RESET_CHAR', { playerId: target.value }); } }, 'Reset character')),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { onClick: () => { const list = Object.values(state.monsters).filter(m => !m.dead && m.pos).map(m => `${m.id} (${m.name} @ ${m.pos})`).slice(0, 14).join('\n'); const id = prompt(`Move which monster? Type its id:\n${list}`); if (!id) return; const hex = prompt('To hex key (q,r):'); if (hex) gm('GM_MONSTER_MOVE', { monsterId: id.trim().split(' ')[0], hex: hex.trim() }); } }, 'Move a monster'),
        h('button', { onClick: () => { const id = prompt('Monster species id to spawn on the mover\'s hex (see data/monsters.json), or "boss":'); if (id) gm('GM_SPAWN', { speciesId: id, hex: state.characters[state.players[currentPlayerId(state)]?.characterId]?.pos }); } }, 'Spawn monster'),
        h('button', { onClick: () => { const t = prompt('Chaos tier 1–5:'); if (t) gm('GM_CHAOS', { tier: Number(t) }); } }, 'Start Chaos tier'))),
    inventoryPanel({ state, h, gm, seats, redraw }));
}

// Any player's inventory: what they wear and carry, remove an item, resize their grid (SPEC.md › Inventory:
// "The GM console can open any player's inventory, add or remove items, and resize their grid"). Adding is the
// Give item button above.
let invFor = null;
function inventoryPanel({ state, h, gm, seats, redraw }) {
  if (!seats.some(p => p.id === invFor)) invFor = null;
  const pick = h('div', { class: 'row' }, seats.map(p => h('button', { class: p.id === invFor ? 'primary' : '', onClick: () => { invFor = invFor === p.id ? null : p.id; redraw?.(); } }, p.name)));
  const box = h('div', { class: 'panel inv-panel' }, h('h3', {}, 'Open a player\'s inventory'), pick);
  const c = invFor && Object.values(state.characters).find(x => x.playerId === invFor);
  if (!invFor) return box;
  if (!c) { box.append(h('p', { class: 'muted ital' }, 'No character yet.')); return box; }
  const wornIds = new Map(Object.entries(c.worn || {}).filter(([, it]) => it).map(([slot, it]) => [it.id, slot]));
  const rows = Object.values(c.items || {}).map(it => ({ it, slot: wornIds.get(it.id) || null }));
  box.append(h('p', { class: 'muted' }, `${c.name}: grid ${c.grid?.cols}×${c.grid?.rows} · ${rows.length} item(s)${(c.pendingLoot || []).length ? ` · ${(c.pendingLoot || []).length} waiting to be placed` : ''}`),
    h('div', { class: 'gm-bar' },
      h('button', { onClick: () => gm('GRID_RESIZE', { playerId: invFor, cols: (c.grid?.cols || 0) + 1 }) }, 'Grid: + column'), h('button', { onClick: () => gm('GRID_RESIZE', { playerId: invFor, cols: (c.grid?.cols || 0) - 1 }) }, '− column'),
      h('button', { onClick: () => gm('GRID_RESIZE', { playerId: invFor, rows: (c.grid?.rows || 0) + 1 }) }, '+ row'), h('button', { onClick: () => gm('GRID_RESIZE', { playerId: invFor, rows: (c.grid?.rows || 0) - 1 }) }, '− row')),
    rows.length ? h('div', { class: 'list' }, rows.map(({ it, slot }) => h('div', { class: 'item' }, h('span', { class: 'grow' }, `${it.name}${(it.qty || 1) > 1 ? ` ×${it.qty}` : ''}`), h('span', { class: 'pill' }, slot ? `worn: ${slot}` : it.slot || 'item'), h('span', { class: `pill r-${it.rarity}` }, it.rarity || ''),
      h('button', { class: 'danger', onClick: async () => { if (!confirm(`Remove ${it.name} from ${c.name}? It leaves the run.`)) return; if (slot) await gm('GRID_UNEQUIP', { playerId: invFor, slot }); gm('GRID_DROP', { playerId: invFor, itemId: it.id, destroy: true }); } }, 'Remove')))) : h('p', { class: 'muted ital' }, 'Nothing carried.'));
  return box;
}
