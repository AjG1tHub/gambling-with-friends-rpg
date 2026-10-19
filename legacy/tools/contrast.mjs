// Theme contrast helpers (WCAG relative luminance). Used by the theme unit tests and `node tools/contrast.mjs`.
import fs from 'node:fs';
export function parseThemes(css) {
  const out = {};
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const ids = [...m[1].matchAll(/\[data-theme="([a-z]+)"\]/g)].map(x => x[1]);
    if (!ids.length) continue;
    const vars = {};
    for (const v of m[2].replace(/\/\*.*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim();
    for (const id of ids) out[id] = { ...(out[id] || {}), ...vars };
  }
  return out;
}
export function rgb(hex) { let h = hex.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
export function luminance(hex) { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const themes = parseThemes(fs.readFileSync(new URL('../site/css/theme.css', import.meta.url), 'utf8'));
  const pairs = [['--ink', '--bg'], ['--ink', '--bg-panel'], ['--ink', '--bg-raised'], ['--ink-dim', '--bg-panel'], ['--ink-dim', '--bg'], ['--accent', '--bg-panel'], ['--accent', '--bg'], ['--bg', '--accent'], ['--good', '--bg-panel'], ['--bad', '--bg-panel'], ['--bad', '--bg-raised'], ['--power', '--bg-panel'], ['--up', '--bg-panel'], ['--down', '--bg-panel']];
  for (const [id, v] of Object.entries(themes)) console.log(id.padEnd(8), pairs.filter(([f, b]) => v[f] && v[b]).map(([f, b]) => `${f.slice(2)}/${b.slice(2)} ${contrast(v[f], v[b]).toFixed(1)}`).join('  '));
}
