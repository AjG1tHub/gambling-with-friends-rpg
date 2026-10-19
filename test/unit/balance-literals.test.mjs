// "No stray numeric literal" lint (docs/STATE.md rule 5): rule code reads its numbers from data/balance.json, never
// types them. This scan flags a numeric literal in a rules file when its value equals some tunable's value, which
// is the pragmatic version of "looks like a tunable". Exempt: 0, 1, 2, -1 and 0.5 (indices and halves), array
// indices like `[4]`, `* 100` / `* 1000` / `* 60` conversions, loop guards, lines ending in `// literal`, named
// ALL_CAPS constants and the bodies of ALL_CAPS data tables, and entries in
// test/unit/balance-literals.allow.json. The lead tightens this as the handlers settle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCAN = ['packages/shared/handlers', 'packages/shared/characters', 'packages/shared/encounters', 'packages/shared/challenge', 'packages/shared/map', 'packages/games/adapter.js', 'packages/games/levers.js'];
const TRIVIAL = new Set([0, 1, 2, -1, 0.5]);

function listFiles(rel) {
  const abs = path.join(ROOT, rel); if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap(e => listFiles(path.posix.join(rel, e))).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
}
export function tunableValues(balance = JSON.parse(readFileSync(path.join(ROOT, 'data/balance.json'), 'utf8'))) {
  const vals = new Map();
  for (const [g, keys] of Object.entries(balance)) { if (g.startsWith('_')) continue; for (const [k, def] of Object.entries(keys)) { const list = Array.isArray(def.v) ? def.v : [def.v]; for (const v of list) if (typeof v === 'number') { if (!vals.has(v)) vals.set(v, []); vals.get(v).push(`${g}.${k}`); } } }
  return vals;
}
// Strip comments and string contents, keeping `${…}` expressions inside template literals. Also returns whether
// the line's trailing comment says `literal`.
export function stripLine(line, carry) {
  let out = '', i = 0, state = carry.state, tplDepth = carry.tplDepth || 0; let literalComment = false;
  while (i < line.length) {
    const ch = line[i], nx = line[i + 1];
    if (state === 'block') { if (ch === '*' && nx === '/') { state = 'code'; i += 2; } else i++; continue; }
    if (state === 'sq' || state === 'dq') { if (ch === '\\') { i += 2; continue; } if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"')) state = 'code'; i++; continue; }
    if (state === 'tpl') { if (ch === '\\') { i += 2; continue; } if (ch === '`') { state = 'code'; i++; continue; } if (ch === '$' && nx === '{') { state = 'code'; tplDepth++; out += ' '; i += 2; continue; } i++; continue; }
    // code
    if (ch === '/' && nx === '/') { if (/^\/\/\s*literal\b/i.test(line.slice(i))) literalComment = true; break; }
    if (ch === '/' && nx === '*') { state = 'block'; i += 2; continue; }
    if (ch === "'") { state = 'sq'; out += ' '; i++; continue; }
    if (ch === '"') { state = 'dq'; out += ' '; i++; continue; }
    if (ch === '`') { state = 'tpl'; out += ' '; i++; continue; }
    if (ch === '}' && tplDepth > 0) { const open = (out.match(/\{/g) || []).length, close = (out.match(/\}/g) || []).length; if (close >= open) { tplDepth--; state = 'tpl'; i++; continue; } }
    out += ch; i++;
  }
  if (state === 'sq' || state === 'dq') state = 'code';   // strings do not span lines
  return { code: out, carry: { state, tplDepth }, literalComment };
}
export function scanFile(rel, vals, allow) {
  const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n'); const hits = [];
  let carry = { state: 'code', tplDepth: 0 }, tableDepth = 0;
  lines.forEach((raw, idx) => {
    const n = idx + 1; const { code, carry: next, literalComment } = stripLine(raw, carry); carry = next;
    // ALL_CAPS data tables: `const NAME = {` / `[` … until the brackets close.
    const opensTable = /^\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=\s*[\[{(]/.test(code) || /^\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=\s*(Object\.freeze|new Map|new Set)\(/.test(code);
    const inTable = tableDepth > 0 || opensTable;
    if (inTable) { for (const ch of code) { if ('{[('.includes(ch)) tableDepth++; else if ('}])'.includes(ch)) tableDepth = Math.max(0, tableDepth - 1); } }
    if (inTable || literalComment) return;
    if (/^\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=/.test(code)) return;          // named ALL_CAPS constant (scalar or table)
    if (/\bguard\s*(\+\+|<|>)/.test(code)) return;                                    // loop guards are not rules
    if (allow.has(`${rel}:${n}`)) return;
    const re = /(?<![\w.$])(-?\d+(?:\.\d+)?)(?![\w.]|\s*:)/g; let m;
    while ((m = re.exec(code))) {
      const v = Number(m[1]); if (!Number.isFinite(v) || TRIVIAL.has(v) || !vals.has(v)) continue;
      const before = code.slice(0, m.index), after = code.slice(m.index + m[0].length);
      if (/\[\s*$/.test(before) && /^\s*\]/.test(after)) continue;                       // array index
      if (/\.(slice|substr|substring|padStart|padEnd|toFixed|toString|at|repeat|charAt)\(\s*(-?\d+\s*,\s*)?$/.test(before)) continue;   // string/array plumbing
      if (/(\*|\/)\s*$/.test(before) && (v === 1000 || v === 60 || v === 100)) continue;   // ms, minute and percent conversions
      if (v === 100 && /^\s*\)?\s*\/\s*100\b/.test(after)) continue;                        // `v * 100 + 1e-9) / 100` rounding idiom
      if (allow.has(`${rel}::${m[1]}`)) continue;
      hits.push({ file: rel, line: n, literal: m[1], tunables: vals.get(v).slice(0, 3), text: raw.trim().slice(0, 110) });
    }
  });
  return hits;
}
export function scan() {
  const vals = tunableValues();
  const allowJ = JSON.parse(readFileSync(path.join(ROOT, 'test/unit/balance-literals.allow.json'), 'utf8'));
  const allow = new Set(allowJ.allow || []);
  const files = SCAN.flatMap(listFiles);
  return { files, hits: files.flatMap(f => scanFile(f, vals, allow)) };
}

test('stripLine removes strings and comments but keeps template expressions', () => {
  assert.equal(stripLine("x = '100' + 5; // 50", { state: 'code' }).code.trim(), 'x =   + 5;');
  const r = stripLine('note(`${c.name} heals ${n * 25} now 90`); // literal', { state: 'code' });
  assert.ok(r.code.includes('n * 25') && !r.code.includes('90') && r.literalComment);
  assert.equal(stripLine('a = /* 35 */ b; /* open', { state: 'code' }).carry.state, 'block');
});

test('rule files carry no stray tunable-valued numeric literals', () => {
  const { files, hits } = scan();
  assert.ok(files.length > 0, 'nothing to scan: check SCAN paths');
  const report = hits.map(h => `${h.file}:${h.line}  ${h.literal}  (${h.tunables.join(', ')})  ${h.text}`);
  assert.equal(hits.length, 0, `${hits.length} stray literal(s) in ${new Set(hits.map(h => h.file)).size} file(s). Read the value through ctx.B()/bal(), end the line with \`// literal\`, move it into an ALL_CAPS table, or allow it in test/unit/balance-literals.allow.json:\n` + report.slice(0, 60).join('\n') + (report.length > 60 ? `\n… and ${report.length - 60} more` : ''));
});
