// Browser run of the Game Lab: opens every game on the menu, plays several rounds by clicking whatever the
// controls offer, and checks each round ends in a result with no page errors.  node test/lab.mjs [rounds=3]
import { createRequire } from 'module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve('site'); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f)); }).listen(8768);
const rounds = Number(process.argv[2] || 3), out = 'test/shots/lab'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } }); const pg = await ctx.newPage(); const errors = [];
pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await pg.addInitScript(() => { localStorage.setItem('gwf_state', '{"marker":"real session"}'); });
await pg.goto('http://localhost:8768/lab/'); await pg.waitForSelector('.lab-item');
const ids = await pg.locator('.lab-item').evaluateAll(els => els.map(e => e.dataset.id));
const failures = [], lines = []; let seed = 1; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (const id of ids) {
  await pg.click(`.lab-item[data-id="${id}"]`); const results = []; let shot = false;
  for (let r = 0; r < rounds; r++) {
    if (r) await pg.click('#labAgain');
    let done = false;
    for (let step = 0; step < 90 && !done; step++) {
      const res = (await pg.locator('#labResult').innerText()).trim();
      if (res) { results.push(res); done = true; break; }
      const btns = pg.locator('#gameControls button:not([disabled])'); const n = await btns.count();
      if (n) { // prefer buttons that move the round forward; sometimes take the cautious one
        const labels = await btns.allInnerTexts(); let pick = Math.floor(rnd() * n);
        const forward = labels.findIndex(l => /Accept|Settle|DRAW|SET HANDS|ROLL|Spin|Drop|GO|Deal|Place bet|LAUNCH|Draw|Pull the lever|Roll/i.test(l)); if (forward >= 0 && rnd() < 0.6) pick = forward;
        if (id === 'keno' && step === 0) pick = labels.findIndex(l => /Quick pick/.test(l));
        if (id === 'crash' && step > 0) pick = labels.findIndex(l => /CASH OUT/.test(l));
        if (pick < 0) pick = 0;
        await btns.nth(pick).click({ timeout: 2000 }).catch(() => {});
      }
      await pg.waitForTimeout(n ? 160 : 260);
      if (!shot && step === 2) { shot = true; await pg.locator('.lab-stage').screenshot({ path: `${out}/${id}.png` }); }
    }
    if (!done) { failures.push(`${id}: round ${r + 1} never finished`); await pg.locator('.lab-main').screenshot({ path: `${out}/${id}-STUCK.png` }); await pg.click('#labCancel').catch(() => {}); }
  }
  await pg.locator('.lab-stage').screenshot({ path: `${out}/${id}-end.png` });
  lines.push(`${id.padEnd(12)} ${results.map(x => x.replace(/\s+/g, ' ').slice(0, 46)).join(' | ')}`);
}
await pg.click(`.lab-item[data-id="${ids[0]}"]`); await pg.keyboard.press('1'); await pg.keyboard.press('n'); await pg.keyboard.press('2'); await pg.fill('#labNote', 'test note'); await pg.waitForTimeout(100);
const progress = await pg.locator('#labProgress').innerText(); const marks = await pg.evaluate(() => JSON.parse(localStorage.getItem('gwf_lab')));
const real = await pg.evaluate(() => localStorage.getItem('gwf_state')); const gold = await pg.locator('#labGold').innerText();
await pg.screenshot({ path: `${out}/_page.png` });
console.log(lines.join('\n'));
console.log(`\n${ids.length} games × ${rounds} rounds | progress "${progress}" | marks ${JSON.stringify([marks[ids[0]].status, marks[ids[1]].status, marks[ids[1]].note])} | real session untouched: ${real === '{"marker":"real session"}'} | tester ${gold} Gold`);
console.log('failures:', failures.length ? failures : 'none'); console.log('errors:', errors.length ? [...new Set(errors)] : 'none');
await b.close(); srv.close(); process.exit(failures.length || errors.length ? 1 : 0);
