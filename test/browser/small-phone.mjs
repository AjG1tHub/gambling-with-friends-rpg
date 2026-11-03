// Small-phone + Teams gate (QA pass, 2 Nov 2026). Three 360×640 phones with long character names through creation
// into a Teams run, against the built site (`npm run build` first) and the ws dev backend. Asserts:
//   · no phone page is wider than its screen on any tab, and the header stays inside it (a long name used to stretch
//     the grid to ~390px and clip the coach card and the Letters tab)
//   · nothing ever requests /worn/<id>.png (item icons used to 404 there)
//   · the tab bar is not covered by anything on the play screen
//   · the GM is asked before a Teams run starts with nobody on a team
// Screenshots: test/shots/small-NN-*.png. `node test/browser/small-phone.mjs`.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';
import { startDevServer } from '../../tools/dev-server.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 15000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(100); } throw new Error(`TIMEOUT: ${msg}`); }
const shot = (page, name) => page.screenshot({ path: `${shotDir}small-${name}.png` }).catch(() => {});
setTimeout(() => { console.error('WATCHDOG: the small-phone run ran past 4 minutes'); process.exit(1); }, 4 * 60 * 1000).unref();

const { server, url } = await startServer(0);
const dev = await startDevServer({ port: 0 });
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
const pc = await browser.newContext({ viewport: { width: 1600, height: 900 } });
pc.setDefaultTimeout(15000);
const dialogs = [], badUrls = new Set(), pageErrors = [];
const watch = (page, tag) => { page.on('response', r => { if (r.status() >= 400) badUrls.add(`${r.status()} ${new URL(r.url()).pathname}`); }); page.on('pageerror', e => pageErrors.push(`${tag}: ${e.message}`)); };
let failed = false;
try {
  const gm = await pc.newPage(); gm.on('dialog', d => { dialogs.push(d.message()); d.accept(); }); watch(gm, 'gm');
  const tv = await pc.newPage(); watch(tv, 'tv');
  await gm.goto(`${url}/gm/?${Q}`);
  await gm.fill('input[type=password]', '4242');
  await gm.locator('select').nth(0).selectOption('teams');
  await gm.uncheck('input[name=ramp]').catch(() => {});   // fights and everything else open from turn 1
  await gm.click('button:has-text("Create room")');
  await waitFor(gm, () => !!window.__gwf?.session, 'Teams room created');
  const code = await gm.evaluate(() => window.__gwf.session.code);
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(`${url}/?code=${code}&${Q}`);
  await waitFor(tv, () => !!window.__gwf?.session, 'TV opened');

  const names = ['Bartholomew', 'Nickolaus', 'Samsonite'], chars = ['Bartholomew the Bold', 'Nickolaus Longname', 'Samsonite Pitbull'], classes = ['Whale', 'Enforcer', 'Pit Boss'];
  const phones = [];
  for (let i = 0; i < 3; i++) {
    const c = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    c.setDefaultTimeout(15000);
    const ph = await c.newPage(); watch(ph, 'phone' + i);
    await ph.goto(`${url}/phone/?code=${code}&${Q}`);
    await ph.fill('input[placeholder="Your name at the table"]', names[i]);
    await ph.click('button:has-text("Sit down")');
    await waitFor(ph, () => !!window.__gwf?.ctx?.me, `${names[i]} sat down`);
    await ph.click('button:has-text("Tap when ready")');
    phones.push(ph);
  }
  await gm.click('button:has-text("Open character creation")');
  await waitFor(tv, () => window.__gwf.session.state.phase === 'creation', 'creation open');
  for (let i = 0; i < 3; i++) {
    const ph = phones[i];
    await ph.fill('input[placeholder="Character name"]', chars[i]);
    await ph.click('button:has-text("That is me")');
    await ph.locator('button.class-card', { hasText: classes[i] }).first().click();
    await ph.getByRole('button', { name: /^Lock in( with .*)? →$/ }).first().click();
    await ph.getByRole('button', { name: '🔒 Lock in' }).first().click();
    await waitFor(ph, () => !!Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.locked, `${chars[i]} locked in`);
    if (!(await ph.evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].ready))) await ph.click('button:has-text("Tap when ready")');
  }
  await gm.locator('.gm-nav button').first().click();
  await gm.click('button:has-text("Start the run")');
  await sleep(1200);
  ok(dialogs.some(m => /on no team/.test(m) && /Bartholomew/.test(m)), `Teams: the GM was asked before starting with nobody on a team (${JSON.stringify(dialogs.filter(m => /team/i.test(m)))})`);
  await waitFor(tv, () => window.__gwf.session.state.phase === 'playing', 'run started after the GM said yes');
  await sleep(800);

  for (let i = 0; i < 3; i++) {
    const ph = phones[i];
    for (const label of ['Play', 'Cage', 'Self', 'Pets', 'Map', 'Letters']) {
      await ph.locator('.tabs button', { hasText: label }).first().click({ force: true }); await sleep(250);
      const m = await ph.evaluate(() => { const d = document.documentElement; const top = document.querySelector('.top')?.getBoundingClientRect(); return { sw: d.scrollWidth, cw: d.clientWidth, topRight: top ? Math.round(top.right) : 0 }; });
      ok(m.sw <= m.cw && m.topRight <= m.cw, `${chars[i]} · ${label}: page ${m.sw}px in a ${m.cw}px screen, header ends at ${m.topRight}`);
      if (i === 0) await shot(ph, `${label.toLowerCase()}`);
    }
    await ph.locator('.tabs button', { hasText: 'Play' }).first().click({ force: true });
  }
  // The tab bar must be tappable on a plain play screen (the mover's phone may be mid-prompt; check the one that is not).
  const mover = await tv.evaluate(() => window.__gwf.session.state.moverId);
  for (const ph of phones) {
    if ((await ph.evaluate(() => window.__gwf.ctx.me)) === mover) continue;
    const covered = await ph.evaluate(() => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim().startsWith('Cage')); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === b || b.contains(e) ? null : `${e?.tagName}.${e?.className}`; });
    ok(covered === null, 'the tab bar is not covered on a waiting phone' + (covered ? ` (covered by ${covered})` : ''));
    break;
  }
  const worn = [...badUrls].filter(u => /\/worn\//.test(u));
  ok(worn.length === 0, `no request for /worn/<id>.png (${worn.join(', ') || 'none'})`);
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nSMALL-PHONE RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await browser.close(); server.close(); dev.close?.();
process.exit(failed ? 1 : 0);
