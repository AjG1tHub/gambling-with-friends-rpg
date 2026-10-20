// Standalone QA walk against dist/ (the same steps go into test/browser/lab.mjs).
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';
const shotDir = '/home/claude/gambling-with-friends-rpg/test/shots/'; mkdirSync(shotDir, { recursive: true });
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 15000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(60); } throw new Error(`TIMEOUT: ${msg}`); }
const IGNORE = [/ERR_TUNNEL_CONNECTION_FAILED/, /fonts\.googleapis/, /Expected a JavaScript-or-Wasm module script/, /boots-.*\.json/, /favicon/];
const server = await startServer(0); const url = server.url;
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const browser = await chromium.launch({ executablePath: pre });
const errors = [];
const wire = (page, tag) => { page.on('console', m => { if (m.type() === 'error' && !IGNORE.some(re => re.test(m.text()))) errors.push(`${tag} console: ${m.text()}`); }); page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`)); };
let failed = false;
const t0 = Date.now();
try {
  // ── QA run ──
  console.log('QA run: every wheel ×3');
  const qc = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); qc.setDefaultTimeout(20000);
  const qa = await qc.newPage(); wire(qa, 'qa');
  await qa.goto(`${url}/lab/?qa=1&fast=1`);
  await waitFor(qa, () => !!window.__lab && window.__lab.current === 'qa' && !!document.querySelector('.qa-spin'), 'QA run opened on its first spin');
  const total = await qa.evaluate(() => document.querySelectorAll('.lab-nav button[data-id="qa"]').length && 30);
  ok(total === 30, 'QA run is in the catalog under Runs');
  const spinInfo = () => qa.evaluate(() => { const s = document.querySelector('.qa-spin'); const m = window.__lab.mount; return { wheel: s?.dataset.wheel, k: s?.dataset.k, landed: document.querySelector('.qa-landed')?.textContent || '', hit: !!document.querySelector('tr.qa-hit'), diffRows: document.querySelectorAll('.qa-row').length, changed: document.querySelectorAll('.qa-row.changed').length, checks: document.querySelectorAll('.qa-checks li').length, badChecks: [...document.querySelectorAll('.qa-checks li.bad')].map(x => x.textContent), keys: document.querySelectorAll('.qa-keys li').length, logs: document.querySelector('.qa-log')?.textContent || '', wheels: document.querySelectorAll('.qa-face .gwf-wheel').length, landedFlag: m?.landed, progress: document.querySelector('.qa-progress')?.textContent }; });
  let seen = 0, shots = 0; const landedAll = [];
  for (let guard = 0; guard < 40; guard++) {
    const cur = await spinInfo(); if (!cur.wheel) break;
    await waitFor(qa, () => window.__lab.mount?.landed === true, null);
    const info = await spinInfo();
    ok(info.hit && info.diffRows >= 10 && info.checks >= 1 && /Landed: /.test(info.landed), `${info.wheel} ${info.k}/3 landed (${info.landed.slice(8, 40)}) · ${info.diffRows} diff rows, ${info.changed} changed · ${info.checks} checks${info.badChecks.length ? ' · ✗ ' + info.badChecks.join(' | ') : ''}`);
    if (info.wheel === 'pets') ok(info.wheels === 3, 'pet wheel shows three faces');
    if (info.wheel === 'bugreward') ok(/no public log line ✓/.test(info.logs), 'bug reward wheel asserts no public log line');
    if (['buyin', 'fortune', 'fate', 'loot', 'chaos', 'boss'].includes(info.wheel) && info.k === '1') { await qa.screenshot({ path: shotDir + `lab-qa-${String(shots++).padStart(2, '0')}-${info.wheel}.png`, fullPage: true }); }
    landedAll.push(`${info.wheel}:${info.landed.slice(8)}`);
    // Verdicts: key O on most, ❌ Problem + note + Next on fate 2, Skip (N) on movement 3, the Works button on loot 1.
    if (info.wheel === 'fate' && info.k === '2') { await qa.keyboard.press('x'); await waitFor(qa, () => document.querySelector('.qa-note')?.style.display === '', 'Problem reveals the note field'); await qa.fill('.qa-note textarea', 'QA walk: sample problem note'); await qa.click('.qa-verdict button:has-text("Next")'); }
    else if (info.wheel === 'movement' && info.k === '3') await qa.keyboard.press('n');
    else if (info.wheel === 'loot' && info.k === '1') await qa.click('.qa-verdict button:has-text("Works")');
    else await qa.keyboard.press('o');
    await waitFor(qa, (prev) => { const s = document.querySelector('.qa-spin'); return !s || s.dataset.wheel !== prev.wheel || s.dataset.k !== prev.k; }, null, { wheel: info.wheel, k: info.k });
    seen++;
  }
  ok(seen === 30, `walked ${seen} spins`);
  await waitFor(qa, () => !!document.querySelector('.qa-done'), 'summary shown at the end');
  const sum = await qa.evaluate(() => ({ title: document.querySelector('.qa-done h2')?.textContent, cells: document.querySelectorAll('.qa-summary td button').length, report: document.querySelector('.qa-report')?.textContent || '', marks: Object.keys(window.__lab.marks).filter(k => k.startsWith('qa:')).length, qa: window.__lab.marks.qa?.status }));
  ok(/30 \/ 30 · 1 problem/.test(sum.title), `summary: ${sum.title}`);
  ok(sum.cells === 30 && /PROBLEM.*sample problem note/.test(sum.report) && /skipped/.test(sum.report) && sum.qa === 'bad', `summary table has 30 cells, the report carries the note and the skip (marks: ${sum.marks}, catalog mark ${sum.qa})`);
  await qa.screenshot({ path: shotDir + 'lab-qa-90-summary.png', fullPage: true });
  // Reload resumes on the summary (every spin is recorded); Start over returns to spin 1.
  await qa.reload(); await waitFor(qa, () => !!window.__lab && !!document.querySelector('.qa-done'), 'reload resumes at the summary');
  await qa.click('.qa-verdict button:has-text("Start over")');
  await waitFor(qa, () => { const s = document.querySelector('.qa-spin'); return s?.dataset.wheel === 'buyin' && s.dataset.k === '1'; }, 'Start over returns to Buy-in 1/3');
  await qa.keyboard.press('o'); await waitFor(qa, () => document.querySelector('.qa-spin')?.dataset.k === '2', 'verdict advances to 2/3');
  await qa.reload(); await waitFor(qa, () => document.querySelector('.qa-spin')?.dataset.wheel === 'buyin' && document.querySelector('.qa-spin')?.dataset.k === '2', 'reload resumes at Buy-in 2/3');
  // Phone mode: one column, 60 px buttons, no horizontal overflow at 390 px.
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ph = await pc.newPage(); wire(ph, 'qa-phone');
  await ph.goto(`${url}/lab/?phone=1&qa=1&fast=1`); await waitFor(ph, () => !!window.__lab && document.body.classList.contains('lab-phone') && !!document.querySelector('.qa-spin'), 'phone QA run opened');
  await waitFor(ph, () => window.__lab.mount?.landed === true, null);
  const pm = await ph.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, btn: Math.min(...[...document.querySelectorAll('.qa-verdict button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height)), wheelW: document.querySelector('.qa-face .gwf-wheel')?.getBoundingClientRect().width }));
  ok(pm.sw <= pm.cw && pm.btn >= 60, `phone QA: no horizontal overflow (${pm.sw} ≤ ${pm.cw}), verdict buttons ${Math.round(pm.btn)} px, wheel ${Math.round(pm.wheelW)} px`);
  await ph.screenshot({ path: shotDir + 'lab-qa-phone-00.png' });
  await ph.click('.qa-verdict button:has-text("Works")'); await waitFor(ph, () => document.querySelector('.qa-spin')?.dataset.k === '2', 'phone verdict advances');
  await ph.screenshot({ path: shotDir + 'lab-qa-phone-01.png', fullPage: true });
  console.log('landed:', landedAll.join(' · '));
  if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); throw new Error(`${errors.length} console error(s)`); }
  console.log(`QA WALK PASSED in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { failed = true; console.error(e.message || e); if (errors.length) console.error('Console errors so far:\n' + errors.join('\n')); }
finally { await browser.close(); server.server.close(); process.exit(failed ? 1 : 0); }
