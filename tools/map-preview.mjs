#!/usr/bin/env node
// Print an ASCII hex map for a seed, for the GM guide and for eyeballing the generator.
//   node tools/map-preview.mjs [seed=42] [size=regular] [players=4] [--colours] [--json]
// Each land hex prints as two characters: the region's initial and the tile letter from data/tiles.json
// (S start, T throne, P courier, K boss gate, O portal, E encounter …); bridges print in [brackets] and gated
// bridges in {braces}; void prints as the flavour glyph (~ water, v chasm, | wall). --colours prints the
// secret colour initial instead of the tile letter (never show that one on the TV).
import { initialState, newPlayer } from '../packages/shared/state.js';
import { generateMap, scaleFor } from '../packages/shared/map/generator.js';
import { TILES } from '../packages/shared/map/query.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const seed = Number(args[0] ?? 42), size = args[1] || 'regular', players = Number(args[2] ?? 4);

const state = initialState({ roomId: 'preview', code: 'PREV', seed, size });
for (let i = 0; i < players; i++) { state.players['p' + i] = newPlayer({ id: 'p' + i, name: 'P' + i }); state.seats.push('p' + i); }
const t0 = performance.now();
const map = generateMap(state);
const ms = performance.now() - t0;

if (flags.has('--json')) { console.log(JSON.stringify(map, null, 1)); process.exit(0); }

const REGION_LETTER = { strip: 'S', docks: 'D', blackwood: 'B', caldera: 'C', citadel: 'Z' };
const { minQ, maxQ, minR, maxR } = map.bounds;
// Pointy-top axial → staggered rows: column = q + r/2 (in half steps).
const minCol = Math.min(...Object.values(map.hexes).map(h => 2 * h.q + h.r));
const maxCol = Math.max(...Object.values(map.hexes).map(h => 2 * h.q + h.r));
const width = maxCol - minCol + 1;
const lines = [];
for (let r = minR; r <= maxR; r++) {
  const row = Array.from({ length: width * 2 + 2 }, () => ' ');
  for (let q = minQ; q <= maxQ; q++) {
    const h = map.hexes[`${q},${r}`]; if (!h) continue;
    const col = (2 * q + r - minCol) * 2;
    let cell;
    if (h.void) cell = ' ' + TILES[h.type].letter;
    else {
      const t = flags.has('--colours') ? h.colour[0] : TILES[h.type]?.letter || '?';
      cell = REGION_LETTER[h.regionId] + t;
      if (h.bridge) cell = (h.gate ? '{' : '[') + t;
    }
    row[col] = cell[0]; row[col + 1] = cell[1];
    if (h.bridge) row[col + 2] = h.gate ? '}' : ']';
  }
  lines.push(String(r).padStart(4) + ' ' + row.join('').replace(/\s+$/, ''));
}
console.log(`seed ${seed} · ${size} · ${players} players · ${Object.keys(map.hexes).length} hexes (${Object.values(map.hexes).filter(h => !h.void).length} land) · ${ms.toFixed(1)} ms`);
console.log(`start ${map.start} · throne ${map.throne} · courier ${map.courier}`);
console.log(lines.join('\n'));
console.log('\nregions:');
for (const r of Object.values(map.regions)) {
  const land = r.hexKeys.map(k => map.hexes[k]);
  const counts = {}; for (const h of land) counts[h.type] = (counts[h.type] || 0) + 1;
  console.log(`  ${REGION_LETTER[r.id]} ${r.name.padEnd(13)} tier ${r.tier}  ${land.length} hexes (${r.bridgeKeys.length} bridge)  portal ${r.portalKey}  gate ${r.bossGateKey}  ${Object.entries(counts).map(([t, n]) => `${t}:${n}`).join(' ')}`);
}
console.log('\nlegend: ' + Object.entries(TILES).map(([t, d]) => `${d.letter}=${d.name}`).join('  '));
console.log('scale: ' + JSON.stringify(scaleFor(state)));
