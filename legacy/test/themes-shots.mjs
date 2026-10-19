// Screenshots of the shared screen in every theme (board mid-game + recap) for eyeballing.  node test/themes-shots.mjs
import { createRequire } from 'module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve('site'); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f)); }).listen(8766);
const out = 'test/shots'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const gm = await ctx.newPage(), pv = await ctx.newPage(); const errors = [];
for (const pg of [gm, pv]) pg.on('pageerror', e => errors.push(e.message));
gm.on('dialog', d => d.accept());
await gm.goto('http://localhost:8766/gm/'); await pv.goto('http://localhost:8766/');
for (const n of ['Aj', 'Nick', 'Sam', 'Dee']) { await gm.fill('#npName', n); await gm.click('#btnAddPlayer'); await gm.waitForTimeout(120); }
await gm.click('#btnStart'); await gm.waitForTimeout(300);
// give the table some texture: pets, power, a loan, a jail, a few currencies
await gm.evaluate(() => { const s = JSON.parse(localStorage.getItem('gwf_state'));
  s.players[0].power = 340; s.players[1].power = 90; s.players[1].jailTier = 2; s.players[2].balances.Gems = 12; s.players[2].balances.Keys = 3; s.players[3].pardons = 1; s.players[0].winMult = { mult: 2 };
  s.players[3].balances.Gold = -120; s.savedAt = Date.now() + 5; localStorage.setItem('gwf_state', JSON.stringify(s)); });
await gm.reload(); await gm.waitForTimeout(400);
await gm.click('#btnPets'); await gm.waitForTimeout(150); if (await gm.locator('#ptHatch').count()) await gm.click('#ptHatch'); await gm.keyboard.press('Escape');
await gm.keyboard.press('Control+Alt+KeyL'); await gm.fill('#lnAmount', '300'); await gm.click('#lnGo'); await gm.keyboard.press('Escape');
for (const theme of ['noir', 'vapor', 'felt', 'riviera']) {
  await gm.selectOption('#themeSel', theme); await pv.waitForTimeout(250);
  await pv.screenshot({ path: `${out}/theme-${theme}-board.png` });
  await gm.screenshot({ path: `${out}/theme-${theme}-gm.png` });
}
await gm.click('#btnEndSession'); await pv.waitForTimeout(400);
for (const theme of ['riviera', 'felt']) { await gm.selectOption('#themeSel', theme); await pv.waitForTimeout(250); await pv.screenshot({ path: `${out}/theme-${theme}-recap.png` }); }
console.log('themes shot; errors:', errors.length ? errors : 'none');
await browser.close(); srv.close();
