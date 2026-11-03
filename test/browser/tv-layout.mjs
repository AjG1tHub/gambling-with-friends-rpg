// TV layout gate (QA pass, 2 Nov 2026): an 8-seat Royale table of demo bots on the TV page at 1920×1080 and 1280×720
// (`npm run build` first; the page makes its own local room). With eight standings in the footer the page used to
// grow wider than the screen and push the whole right rail (To Move, clock, fight panel, log, join QR) off it.
// Asserts, once the run has started and again a few turns in: no horizontal overflow, the rail is on screen, and
// every standing in the footer is fully visible. Screenshots: test/shots/tv-layout-WxH.png.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, timeout = 60000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) { console.log('  ✓', msg); return true; } await sleep(250); } throw new Error(`TIMEOUT: ${msg}`); }
setTimeout(() => { console.error('WATCHDOG: the TV layout run ran past 4 minutes'); process.exit(1); }, 4 * 60 * 1000).unref();

const { server, url } = await startServer(0);
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
const measure = (page) => page.evaluate(() => {
  const d = document.documentElement, rail = document.querySelector('.tv-rail')?.getBoundingClientRect(), foot = document.querySelector('.tv-foot')?.getBoundingClientRect();
  const ticks = [...document.querySelectorAll('.tv-foot .tick')].map(t => { const r = t.getBoundingClientRect(); return { name: t.querySelector('.tick-name')?.textContent, in: r.left >= foot.left - 1 && r.right <= foot.right + 1 && r.top >= foot.top - 1 && r.bottom <= foot.bottom + 1 }; });
  return { sw: d.scrollWidth, cw: d.clientWidth, railRight: rail ? Math.round(rail.right) : null, footBottom: foot ? Math.round(foot.bottom) : null, vh: innerHeight, ticks };
});
let failed = false;
try {
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    console.log(`\n▶ ${w}×${h}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${url}/?backend=local&bots=8&autostart=1&mode=royale&ramp=0`);
    await waitFor(page, () => window.__gwf?.session?.state?.phase === 'playing', 'the 8-seat Royale run started');
    for (const label of ['at the start', 'a few turns in']) {
      if (label !== 'at the start') await waitFor(page, () => window.__gwf.session.state.turnIdx >= 3, 'three turns played (about 12 s each: fights animate on the TV)', 150000);
      await sleep(600);
      const m = await measure(page);
      ok(m.sw <= m.cw, `${label}: page ${m.sw}px in a ${m.cw}px screen`);
      ok(m.railRight !== null && m.railRight <= m.cw, `${label}: the right rail ends at ${m.railRight} (screen ${m.cw})`);
      ok(m.footBottom <= m.vh + 1, `${label}: the footer ends at ${m.footBottom} (screen ${m.vh})`);
      ok(m.ticks.length === 8 && m.ticks.every(t => t.in), `${label}: all ${m.ticks.length} standings visible in the footer${m.ticks.filter(t => !t.in).length ? ' — clipped: ' + m.ticks.filter(t => !t.in).map(t => t.name).join(', ') : ''}`);
    }
    await page.screenshot({ path: `${shotDir}tv-layout-${w}x${h}.png` });
    // The recap after the GM ends the run: eight seats used to push both charts below the fold (a TV has no scroll wheel).
    await page.evaluate(() => window.__gwf.session.dispatch('GM_END_RUN', { reason: 'the GM called it' }, 'gm'));
    await waitFor(page, () => window.__gwf.session.state.phase === 'ended' && !!document.querySelector('.recap-chart'), 'the recap is up', 20000);
    await sleep(800);
    const r = await page.evaluate(() => {
      const vh = innerHeight, main = document.querySelector('.recap')?.parentElement.getBoundingClientRect();
      const boxes = [...document.querySelectorAll('.recap-chart, .hof, .recap-cards')].map(e => { const b = e.getBoundingClientRect(); return { cls: e.getAttribute('class').split(' ')[0], bottom: Math.round(b.bottom), right: Math.round(b.right) }; });
      return { vh, mainBottom: Math.round(main.bottom), mainRight: Math.round(main.right), boxes, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    ok(r.boxes.filter(b => b.cls === 'recap-chart').length === 2, 'recap: both charts are drawn');
    ok(r.boxes.every(b => b.bottom <= r.mainBottom + 1 && b.right <= r.mainRight + 1), `recap: cards, both charts and the Hall of Fame are inside the screen (${r.boxes.map(b => b.cls + '→' + b.bottom).join(', ')}; panel ends ${r.mainBottom})`);
    ok(r.sw <= r.cw, 'recap: no horizontal overflow');
    await page.screenshot({ path: `${shotDir}tv-layout-${w}x${h}-recap.png` });
    await ctx.close();
  }
  console.log('\nTV LAYOUT RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
