// GM console layout gate (4 Nov 2026): every panel at 1280×720 and 1024×768 during a run. The page must never grow
// wider than the screen (the Challenge lists editor and the Config tables used to push the whole console sideways);
// a wide table scrolls inside its panel. `npm run build` first. Shots: test/shots/gm-1280-N.png.
import { shotDir, ok, sleep, waitFor, pageErrors, stateOf, openTable, closeTable, newRoom } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the GM layout run ran past 4 minutes'); process.exit(1); }, 4 * 60 * 1000).unref();
let failed = false;
try {
await openTable(); const R = await newRoom('gm-layout');
const out = {};
for (const [w, h] of [[1280, 720], [1024, 768]]) {
  await R.gm.setViewportSize({ width: w, height: h });
  const n = Math.min(await R.gm.locator(".gm-nav button").count(), 11);
  for (let i = 0; i < n; i++) {
    const b = R.gm.locator('.gm-nav button').nth(i); const label = (await b.textContent()).trim().slice(0, 18);
    await b.click(); await sleep(300);
    const m = await R.gm.evaluate(() => { const d = document.documentElement; const clipped = [...document.querySelectorAll('.gm-main *')].filter(e => e.children.length === 0 && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2 && !['hidden', 'clip'].includes(getComputedStyle(e).overflowX) && getComputedStyle(e).textOverflow !== 'ellipsis').slice(0, 3).map(e => (e.className || e.tagName) + ':' + (e.textContent || '').trim().slice(0, 30)); const main = document.querySelector('.gm-main'); return { sw: d.scrollWidth, cw: d.clientWidth, mainSW: main?.scrollWidth, mainCW: main?.clientWidth, clipped }; });
    out[`${w}x${h} ${label}`] = m;
    if (w === 1280) await R.gm.screenshot({ path: `${shotDir}gm-${w}-${i}.png` }).catch(() => {});
  }
}
const bad = Object.entries(out).filter(([, m]) => m.sw > m.cw || m.mainSW > m.mainCW + 2 || m.clipped.length);
ok(Object.keys(out).length >= 20, `${Object.keys(out).length} panel/size pairs measured`);
ok(bad.length === 0, `no GM panel widens the page or clips text${bad.length ? ': ' + bad.map(([k, m]) => `${k} (${m.sw}/${m.cw}${m.clipped.length ? ', ' + m.clipped.join(' ') : ''})`).join('; ') : ''}`);
ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
console.log('\nGM LAYOUT RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await closeTable(); process.exit(failed ? 1 : 0);
