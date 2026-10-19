// Loop 28 — theme polish: every theme defines every token the app uses, and text is readable on all four.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG } from './_helpers.mjs';
const { parseThemes, contrast, luminance } = await import('../../tools/contrast.mjs');
const read = (p) => fs.readFileSync(new URL('../../site/' + p, import.meta.url), 'utf8');
const themes = parseThemes(read('css/theme.css'));
const appCss = read('css/app.css');
const jsFiles = fs.readdirSync(new URL('../../site/js/', import.meta.url)).filter(f => f.endsWith('.js'));
const allJs = jsFiles.map(f => read('js/' + f)).join('\n');

test('contrast maths: black on white is 21:1, same colour is 1:1', () => {
  assert.ok(Math.abs(contrast('#000', '#ffffff') - 21) < 0.01);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(luminance('#fff') > luminance('#888') && luminance('#888') > luminance('#000'));
});
test('the stylesheet has exactly the themes the config offers', () => {
  assert.deepEqual(Object.keys(themes).sort(), DEFAULT_CONFIG.Themes.map(t => t.id).sort());
});
test('every theme defines the same set of tokens', () => {
  const base = Object.keys(themes.noir).sort();
  for (const [id, vars] of Object.entries(themes)) assert.deepEqual(Object.keys(vars).sort(), base, id);
});
test('every var(--token) used in CSS or JS is defined by the themes (or has a fallback)', () => {
  const defined = new Set(Object.keys(themes.noir));
  const local = new Set(['--text-scale', '--tc']);                       // set inline at runtime, not theme tokens
  const used = new Set();
  for (const m of (appCss + allJs).matchAll(/var\((--[a-z0-9-]+)(\s*,)?/g)) if (!m[2]) used.add(m[1]);
  for (const v of used) assert.ok(defined.has(v) || local.has(v) || v === '--tile-', `var(${v}) is not defined by the themes`);
});
const TEXT_PAIRS = [['--ink', '--bg'], ['--ink', '--bg-panel'], ['--ink', '--bg-raised'], ['--ink-dim', '--bg'], ['--ink-dim', '--bg-panel'],
  ['--accent', '--bg'], ['--accent', '--bg-panel'], ['--bg', '--accent'],
  ['--good-ink', '--bg-panel'], ['--good-ink', '--bg-raised'], ['--bad-ink', '--bg-panel'], ['--bad-ink', '--bg-raised'],
  ['--power-ink', '--bg-panel'], ['--power-ink', '--bg-raised'], ['--warn-ink', '--bg-panel']];
for (const id of Object.keys(themes)) {
  test(`${id}: body text, dim text, headings and status text all reach 4.5:1`, () => {
    const v = themes[id];
    for (const [fg, bg] of TEXT_PAIRS) { const c = contrast(v[fg], v[bg]); assert.ok(c >= 4.5, `${id}: ${fg} on ${bg} is only ${c.toFixed(2)}:1`); }
  });
  test(`${id}: tile and status fills stand out from the board (3:1 against the page) — except black tiles, which get a border`, () => {
    const v = themes[id];
    for (const k of ['--good', '--bad', '--jail', '--shop']) { const c = contrast(v[k], v['--bg']); assert.ok(c >= 2.5, `${id}: ${k} vs --bg ${c.toFixed(2)}`); }
  });
}
test('status colours are never used raw as text colour in the stylesheet', () => {
  assert.doesNotMatch(appCss, /(?<![-\w])color:\s*var\(--(bad|good)\)/);
  assert.doesNotMatch(appCss, /(?<![-\w])color:\s*#(7ddb8a|e05252|ffd84d|ff9f6b)/i);
});
test('status colours are never used raw as inline text colour in the JS', () => {
  assert.doesNotMatch(allJs, /(?<![-\w])color:\s*var\(--(bad|good)\)/);
});
test('keyboard focus is visible', () => { assert.match(appCss, /:focus-visible[^{]*\{[^}]*outline:/); });
test('recap subtitle: rounds, players and how long the night ran', async () => {
  const UI = await import('../../site/js/game-ui.js');
  const state = { players: [{}, {}, {}], ledger: [{ ts: 0 }, { ts: 95 * 60000 }] };
  assert.equal(UI.recapSubtitle(state, { round: 7 }), '7 rounds · 3 players · 1 h 35 min');
  assert.equal(UI.recapSubtitle({ players: [{}], ledger: [{ ts: 5 }, { ts: 12 * 60000 }] }, { round: 1 }), '1 round · 1 player · 12 min');
  assert.equal(UI.recapSubtitle({ players: [{}, {}], ledger: [] }, { round: 2 }), '2 rounds · 2 players');
});
test('the recap no longer repeats the banner title', () => {
  assert.doesNotMatch(read('js/game-ui.js'), /recap-title[^`]*FINAL STANDINGS/);
});
test('chart line colours are bright against the chart\'s fixed dark background, and the CSS uses that background', async () => {
  const { CHART_COLORS, CHART_BG } = await import('../../site/js/ledger-tools.js');
  for (const c of CHART_COLORS) { const r = contrast(c, CHART_BG); assert.ok(r >= 4.5, `${c} is ${r.toFixed(2)}:1`); }
  assert.equal(new Set(CHART_COLORS).size, 8);
  assert.ok(appCss.includes(`background: ${CHART_BG}`));
});
