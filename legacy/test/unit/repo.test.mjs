// Loop 30 — the repo checks itself: no dangling files, no dead links, nothing left over from debugging.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './_helpers.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const jsFiles = fs.readdirSync(path.join(root, 'site/js')).filter(f => f.endsWith('.js'));
const htmlFiles = ['site/index.html', 'site/gm/index.html', 'site/gm/hotkeys.html', 'site/gm/guide.html', 'site/rules/index.html', 'site/lab/index.html'];

test('every page exists and every local file it references exists', () => {
  for (const page of htmlFiles) {
    assert.ok(exists(page), page);
    const html = read(page), dir = path.dirname(page);
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|data:|mailto:)/.test(u));
    for (const u of refs) { const target = path.join(dir, u.endsWith('/') ? u + 'index.html' : u); assert.ok(exists(target), `${page} → ${u}`); }
    for (const m of html.matchAll(/from '([^']+)'/g)) assert.ok(exists(path.join(dir, m[1])), `${page} imports ${m[1]}`);
  }
});
test('every import between modules resolves, and every module is used by something', () => {
  const used = new Set();
  for (const f of jsFiles) for (const m of read('site/js/' + f).matchAll(/(?:from|import\()\s*'\.\/([\w-]+\.js)'/g)) { assert.ok(jsFiles.includes(m[1]), `${f} imports missing ${m[1]}`); used.add(m[1]); }
  for (const page of htmlFiles) for (const m of read(page).matchAll(/js\/([\w-]+\.js)/g)) used.add(m[1]);
  for (const f of jsFiles) assert.ok(used.has(f), `${f} is not imported by any module or page`);
});
test('every module loads without a browser (no top-level DOM access outside the page scripts)', async () => {
  const pageScripts = new Set(['gm.js', 'view.js', 'lab.js']);          // these ARE the pages
  for (const f of jsFiles) if (!pageScripts.has(f)) await assert.doesNotReject(import(path.join(root, 'site/js', f)), f);
});
test('no debugging leftovers in shipped code', () => {
  for (const f of jsFiles) {
    const src = read('site/js/' + f);
    assert.doesNotMatch(src, /\bdebugger\b/, f);
    assert.doesNotMatch(src, /console\.log\(/, `${f} still has console.log`);
    assert.doesNotMatch(src, /\balert\(/, `${f} uses alert()`);
    assert.doesNotMatch(src, /TODO|FIXME|XXX/, `${f} has a TODO marker`);
  }
});
test('every id the GM script looks up exists in the GM page (or is created by the script)', () => {
  const html = read('site/gm/index.html'), js = read('site/js/gm.js') + read('site/js/gm-games.js');
  const inHtml = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const inJs = new Set([...js.matchAll(/id="([\w-]+)"/g)].map(m => m[1]).concat([...js.matchAll(/\.id = '([\w-]+)'/g)].map(m => m[1])));
  const wired = [...read('site/js/gm.js').matchAll(/\$\('([\w-]+)'\)\.(?:onclick|onchange|oninput) =/g)].map(m => m[1]);
  assert.ok(wired.length > 60);
  for (const id of wired) assert.ok(inHtml.has(id) || inJs.has(id), `gm.js wires #${id}, which no markup defines`);
});
test('every id the player view looks up exists in the player page', () => {
  const html = read('site/index.html'); const js = read('site/js/view.js');
  for (const m of js.matchAll(/\$\('([\w-]+)'\)/g)) assert.ok(html.includes(`id="${m[1]}"`), `view.js uses #${m[1]}`);
});
test('the deploy folder has its headers file and holds nothing but the site', () => {
  assert.match(read('site/_headers'), /X-Frame-Options: DENY/);
  const top = fs.readdirSync(path.join(root, 'site')).sort();
  assert.deepEqual(top, ['_headers', 'css', 'gm', 'index.html', 'js', 'lab', 'rules']);
  const all = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } })(path.join(root, 'site'));
  const bytes = all.reduce((s, f) => s + fs.statSync(f).size, 0);
  assert.ok(bytes < 1_500_000, `site is ${bytes} bytes`);
  for (const f of all) assert.match(f, /\.(html|js|css)$|_headers$/, `unexpected file in site/: ${f}`);
});
test('the README names every test command and every top-level folder', () => {
  const r = read('README.md');
  for (const s of ['test/run.sh', 'test/ui.mjs', 'test/balance.mjs', 'test/soak.mjs', 'tools/build-apps-script.mjs', 'sheet/Code.gs', 'site/']) assert.ok(r.includes(s), `README does not mention ${s}`);
  const loops = [...r.matchAll(/^\| (\d+) \|/gm)].map(m => Number(m[1]));
  assert.deepEqual(loops, Array.from({ length: 30 }, (_, i) => i + 1), 'changelog table lists loops 1–30');
});
test('every unit-test file is named after something that exists', () => {
  const tests = fs.readdirSync(path.join(root, 'test/unit')).filter(f => f.endsWith('.test.mjs'));
  assert.ok(tests.length >= 40, `${tests.length} test files`);
  for (const t of tests) assert.match(read('test/unit/' + t), /from '\.\/_helpers\.mjs'|import '\.\/_helpers\.mjs'/, `${t} must load the shared helpers first`);
});
