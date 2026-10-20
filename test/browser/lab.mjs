// Game Lab browser run: opens the built Lab (`npm run build` first), plays every one of the 36 items once with the
// bot (auto-play), spins every wheel once, plays the creation gamble, a hosted duel and a pet attack, opens the
// phone mode and every data page, runs a short bot run, and walks the QA run (every wheel ×3, fast spins) on the PC
// and the phone — asserting no console errors and that every round settles. Screenshots go to test/shots/lab-*.png.
//   node test/browser/lab.mjs            serves dist/ itself on a free port
//   LAB_URL=http://127.0.0.1:4190 node test/browser/lab.mjs    against a server already running
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { startServer } from './serve.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 15000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(80); } throw new Error(`TIMEOUT: ${msg}`); }
// Known noise that is not the Lab's: the font CDN is unreachable in the test box, and generator.js's optional
// dynamic import of boots.json fails in a Vite build (the fallback list stands).
const IGNORE = [/ERR_TUNNEL_CONNECTION_FAILED/, /fonts\.googleapis/, /Expected a JavaScript-or-Wasm module script/, /boots-.*\.json/, /favicon/];
const noise = (t) => IGNORE.some(re => re.test(t));

let server = null, url = process.env.LAB_URL;
if (!url) { server = await startServer(0); url = server.url; }
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
const errors = [];
const wire = (page, tag) => { page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(`${tag} console: ${m.text()}`); }); page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`)); };
let failed = false;
try {
  const pc = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  pc.setDefaultTimeout(20000);
  const page = await pc.newPage(); wire(page, 'lab');
  await page.goto(`${url}/lab/`);
  await waitFor(page, () => !!window.__lab, 'Lab booted');
  const cat = await page.evaluate(() => window.__lab.catalog.map(g => ({ label: g.label, ids: g.items.map(i => i.id) })));
  const items = cat.filter(g => g.label.endsWith(' items')).flatMap(g => g.ids);
  ok(items.length === 36, `catalog lists ${items.length} items`);
  await page.screenshot({ path: shotDir + 'lab-00-home.png' });

  // ── every item once with the bot ──
  console.log('Items: play all 36 with auto-play');
  const openId = async (id) => { await page.evaluate((id) => { window.__lab.autoNext = false; window.__lab.autoSettle = true; location.hash = '#' + id; }, id); await waitFor(page, (id) => window.__lab.current === id && !!window.__lab.mount?.round, null, id); };
  const playCurrent = async (id) => {
    await page.evaluate(() => window.__lab.mount.auto());
    await waitFor(page, (id) => (window.__lab.marks[id]?.plays || 0) >= 1 && window.__lab.mount?.settled, null, id, 20000);
  };
  let shot = 0;
  for (const id of items) {
    await openId(id); await playCurrent(id);
    const r = await page.evaluate((id) => ({ plays: window.__lab.marks[id].plays, result: document.querySelector('.lab-result')?.textContent || '' }), id);
    ok(r.plays >= 1 && /WIN|LOSS|PUSH/.test(r.result), `${id}: ${r.result.slice(0, 70)}`);
    if (['coinblade', 'minefield', 'ward', 'rockslide', 'fusebomb', 'thebus'].includes(id) || shot < 3) { await page.screenshot({ path: shotDir + `lab-item-${id}.png` }); shot++; }
  }
  // A hand-played round through the real buttons: Coin Blade's SPIN.
  await openId('coinblade');
  await page.click('.gwf-controls .btns button:has-text("SPIN")');
  await waitFor(page, () => window.__lab.mount?.settled, 'Coin Blade settles after tapping SPIN');
  // Levers and quick stakes: Legendary stake via key 2.
  await page.keyboard.press('2');
  await waitFor(page, () => window.__lab.mount?.round?.stake === 50, 'key 2 restarts at the Legendary stake');
  await page.keyboard.press('a'); await waitFor(page, () => window.__lab.mount?.settled, 'key A auto-plays');
  await page.keyboard.press('o'); ok(await page.evaluate(() => window.__lab.marks.coinblade.status === 'ok'), 'key O ticks Works');
  await page.keyboard.press('n'); await waitFor(page, () => window.__lab.current === 'wheelofruin', 'key N steps to the next item');
  await page.screenshot({ path: shotDir + 'lab-02-levers.png', fullPage: true });

  // ── every wheel once ──
  console.log('Wheels: spin each once');
  const wheels = cat.find(g => g.label === 'Wheels').ids;
  for (const id of wheels) {
    await page.evaluate((id) => { location.hash = '#' + id; }, id);
    await waitFor(page, (id) => window.__lab.current === id && !!document.querySelector('.gwf-wheel'), null, id);
    await page.click('.lab-main button.primary:has-text("Spin")');
    await waitFor(page, (id) => (window.__lab.marks[id]?.plays || 0) >= 1, `${id} spun`, id);
    if (id === 'wheel:pets' || id === 'wheel:chaos') await page.screenshot({ path: shotDir + `lab-${id.replace(':', '-')}.png` });
  }
  await sleep(3400);
  ok(await page.evaluate(() => document.querySelector('.log-box')?.textContent.trim().length > 0), 'the pet wheel logged its result');

  // ── creation gamble, a duel, a pet ──
  console.log('Creation, duels, pets');
  for (const id of ['creation:fifty', 'creation:dice', 'creation:hilo']) {
    await page.evaluate((id) => { location.hash = '#' + id; }, id); await waitFor(page, (id) => window.__lab.current === id && !!window.__lab.mount?.round, null, id);
    await page.evaluate(() => window.__lab.mount.auto()); await waitFor(page, (id) => (window.__lab.marks[id]?.plays || 0) >= 1, `${id} settled`, id);
  }
  await page.evaluate(() => { location.hash = '#creation:buyin'; }); await waitFor(page, () => window.__lab.current === 'creation:buyin');
  await page.click('button:has-text("Spin the Buy-in Wheel")'); await waitFor(page, () => (window.__lab.marks['creation:buyin']?.plays || 0) >= 1, 'Buy-in Wheel spun');
  await page.screenshot({ path: shotDir + 'lab-03-creation.png' });
  for (const id of ['duel:speedmath', 'duel:highestcard', 'duel:trivia']) {
    await page.evaluate((id) => { location.hash = '#' + id; }, id); await waitFor(page, (id) => window.__lab.current === id, null, id);
    await page.click('button:has-text("Auto-play both sides")'); await waitFor(page, (id) => (window.__lab.marks[id]?.plays || 0) >= 1, `${id} finished`, id);
  }
  await page.evaluate(() => { location.hash = '#duel:memorymatch'; }); await waitFor(page, () => window.__lab.current === 'duel:memorymatch' && document.querySelectorAll('.duel-grid button').length === 12, 'Memory Match renders 12 cards');
  await page.screenshot({ path: shotDir + 'lab-04-duel.png' });
  await page.evaluate(() => { location.hash = '#pet:emberfox'; }); await waitFor(page, () => window.__lab.current === 'pet:emberfox' && !!window.__lab.mount?.round);
  await page.evaluate(() => window.__lab.mount.auto()); await waitFor(page, () => (window.__lab.marks['pet:emberfox']?.plays || 0) >= 1, 'Cinderfox attack settled');
  await page.screenshot({ path: shotDir + 'lab-05-pet.png' });

  // ── data pages ──
  for (const p of ['legendaries', 'sets', 'pets', 'monsters', 'boots', 'classes', 'affixes']) {
    await page.evaluate((p) => { location.hash = '#data:' + p; }, p); await waitFor(page, (p) => window.__lab.current === 'data:' + p && document.querySelectorAll('table.lab tr').length > 3, `data page ${p} lists rows`, p);
  }
  ok((await page.locator('table.lab tbody tr').count()) >= 5, 'affixes page has rows');
  await page.evaluate(() => { location.hash = '#data:legendaries'; }); await sleep(200);
  ok((await page.locator('table.lab tbody tr').count()) === 28, 'legendaries page lists all 28');
  await page.screenshot({ path: shotDir + 'lab-06-legendaries.png' });
  // Monster as the dummy, playing its item as the monster.
  await page.evaluate(() => { location.hash = '#data:monsters'; }); await sleep(200);
  await page.click('table.lab button:has-text("as monster") >> nth=0');
  await waitFor(page, () => window.__lab.attackerSide === 'dummy' && !!window.__lab.mount?.round && window.__lab.state.dummy.speciesId, 'a monster swings its item at the tester');
  await page.evaluate(() => window.__lab.mount.auto()); await waitFor(page, () => window.__lab.mount?.settled, 'monster round settles');
  await page.screenshot({ path: shotDir + 'lab-07-monster.png' });
  // Report text.
  const report = await page.evaluate(() => { const m = window.__lab; return (window.__labReport = m); }) && await page.evaluate(() => document.querySelector('#labProgress')?.textContent);
  ok(/played/.test(report || ''), `progress: ${report}`);

  // ── phone mode ──
  console.log('Phone mode');
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ph.newPage(); wire(phone, 'phone-lab');
  await phone.goto(`${url}/lab/?phone=1`); await waitFor(phone, () => !!window.__lab && document.body.classList.contains('lab-phone'), 'phone Lab booted');
  await phone.screenshot({ path: shotDir + 'lab-phone-00-catalog.png' });
  await phone.click('.lab-nav button:has-text("Minefield")');
  await waitFor(phone, () => window.__lab.current === 'minefield' && !!window.__lab.mount?.round, 'phone opened Minefield');
  const tap = await phone.evaluate(() => { const b = document.querySelector('.gwf-controls .grid button'); return b ? b.getBoundingClientRect().height : 0; });
  ok(tap >= 48, `phone grid buttons are ${Math.round(tap)}px tall`);
  await phone.click('.gwf-controls .grid button >> nth=0'); await phone.click('.gwf-controls .btns button:has-text("STOP")');
  await waitFor(phone, () => window.__lab.mount?.settled, 'phone Minefield settles after a reveal and STOP');
  await phone.screenshot({ path: shotDir + 'lab-phone-01-minefield.png' });
  await phone.click('.lab-head button:has-text("Next")'); await waitFor(phone, () => window.__lab.current !== 'minefield', 'phone Next works');
  await phone.evaluate(() => { location.hash = '#wheel:fortune'; }); await waitFor(phone, () => window.__lab.current === 'wheel:fortune');
  await phone.click('.lab-main button.primary:has-text("Spin")'); await waitFor(phone, () => (window.__lab.marks['wheel:fortune']?.plays || 0) >= 1, 'phone spun the Fortune Wheel');
  await phone.screenshot({ path: shotDir + 'lab-phone-02-wheel.png' });

  // ── bot run ──
  console.log('Bot run in the browser');
  const br = await pc.newPage(); wire(br, 'botrun');
  await br.goto(`${url}/lab/?botrun=ffa&bots=3&seed=3&size=short`);
  await waitFor(br, () => !!window.__botrun, 'bot run finished', undefined, 180000);
  const rep = await br.evaluate(() => ({ turns: window.__botrun.turns, ended: window.__botrun.ended, stalls: window.__botrun.stalls, events: window.__botrun.events }));
  ok(rep.turns > 0 && rep.events > 50, `bot run: ${rep.turns} turns, ${rep.events} events, ended "${rep.ended}", stalls ${rep.stalls}`);
  ok((await br.locator('svg polyline').count()) >= 3, 'curves drawn');
  await br.screenshot({ path: shotDir + 'lab-08-botrun.png', fullPage: true });

  // ── QA run: every wheel ×3, one spin at a time (fast spins), verdicts by key and button, resume, phone ──
  console.log('QA run: every wheel ×3');
  const qc = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); qc.setDefaultTimeout(20000);
  const qa = await qc.newPage(); wire(qa, 'qa');
  await qa.goto(`${url}/lab/?qa=1&fast=1`);
  await waitFor(qa, () => !!window.__lab && window.__lab.current === 'qa' && !!document.querySelector('.qa-spin') && !!document.querySelector('.lab-nav button[data-id="qa"]'), 'QA run opened on its first spin and sits in the catalog under Runs');
  const spinInfo = () => qa.evaluate(() => { const s = document.querySelector('.qa-spin'); return { wheel: s?.dataset.wheel, k: s?.dataset.k, landed: document.querySelector('.qa-landed')?.textContent || '', hit: !!document.querySelector('tr.qa-hit'), diffRows: document.querySelectorAll('.qa-row').length, changed: document.querySelectorAll('.qa-row.changed').length, checks: document.querySelectorAll('.qa-checks li').length, badChecks: [...document.querySelectorAll('.qa-checks li.bad')].map(x => x.textContent), logs: document.querySelector('.qa-log')?.textContent || '', wheels: document.querySelectorAll('.qa-face .gwf-wheel').length }; });
  let qaSeen = 0, qaShots = 0;
  for (let guard = 0; guard < 40; guard++) {
    if (!(await spinInfo()).wheel) break;
    await waitFor(qa, () => window.__lab.mount?.landed === true, null);
    const info = await spinInfo();
    ok(info.hit && info.diffRows >= 10 && info.checks >= 1 && /^Landed: /.test(info.landed), `${info.wheel} ${info.k}/3 ${info.landed} · ${info.diffRows} diff rows (${info.changed} changed) · ${info.checks} checks${info.badChecks.length ? ' · ✗ ' + info.badChecks.join(' | ') : ''}`);
    if (info.wheel === 'pets') ok(info.wheels === 3, 'pet wheel shows three faces');
    if (info.wheel === 'bugreward') ok(/no public log line ✓/.test(info.logs), 'bug reward wheel asserts no public log line');
    if (['buyin', 'chaos', 'fortune', 'fate', 'loot', 'boss', 'pets', 'bugreward'].includes(info.wheel) && info.k === '1') await qa.screenshot({ path: shotDir + `lab-qa-${String(qaShots++).padStart(2, '0')}-${info.wheel}.png`, fullPage: true });
    // Verdicts: key O on most; ❌ Problem + a note + Next on fate 2; Skip (N) on movement 3; the Works button on loot 1.
    if (info.wheel === 'fate' && info.k === '2') { await qa.keyboard.press('x'); await waitFor(qa, () => document.querySelector('.qa-note')?.style.display === '', 'Problem reveals the note field'); await qa.fill('.qa-note textarea', 'QA walk: sample problem note'); await qa.click('.qa-verdict button:has-text("Next")'); }
    else if (info.wheel === 'movement' && info.k === '3') await qa.keyboard.press('n');
    else if (info.wheel === 'loot' && info.k === '1') await qa.click('.qa-verdict button:has-text("Works")');
    else await qa.keyboard.press('o');
    await waitFor(qa, (prev) => { const s = document.querySelector('.qa-spin'); return !s || s.dataset.wheel !== prev.wheel || s.dataset.k !== prev.k; }, null, { wheel: info.wheel, k: info.k });
    qaSeen++;
  }
  ok(qaSeen === 30, `walked ${qaSeen} spins`);
  await waitFor(qa, () => !!document.querySelector('.qa-done'), 'summary shown at the end');
  const qaSum = await qa.evaluate(() => ({ title: document.querySelector('.qa-done h2')?.textContent, cells: document.querySelectorAll('.qa-summary td button').length, report: document.querySelector('.qa-report')?.textContent || '', qa: window.__lab.marks.qa?.status }));
  ok(/30 \/ 30 · 1 problem/.test(qaSum.title) && qaSum.cells === 30 && /PROBLEM.*sample problem note/.test(qaSum.report) && /skipped/.test(qaSum.report) && qaSum.qa === 'bad', `summary: ${qaSum.title} · 30 cells · report carries the note and the skip · catalog mark ${qaSum.qa}`);
  await qa.screenshot({ path: shotDir + 'lab-qa-90-summary.png', fullPage: true });
  await qa.reload(); await waitFor(qa, () => !!window.__lab && !!document.querySelector('.qa-done'), 'reload resumes at the summary');
  await qa.click('.qa-verdict button:has-text("Start over")');
  await waitFor(qa, () => { const s = document.querySelector('.qa-spin'); return s?.dataset.wheel === 'buyin' && s.dataset.k === '1'; }, 'Start over returns to Buy-in 1/3');
  await qa.keyboard.press('o'); await waitFor(qa, () => document.querySelector('.qa-spin')?.dataset.k === '2', 'verdict advances to 2/3');
  await qa.reload(); await waitFor(qa, () => document.querySelector('.qa-spin')?.dataset.wheel === 'buyin' && document.querySelector('.qa-spin')?.dataset.k === '2', 'reload resumes at Buy-in 2/3');
  const qph = await ph.newPage(); wire(qph, 'qa-phone');
  await qph.goto(`${url}/lab/?phone=1&qa=1&fast=1`); await waitFor(qph, () => !!window.__lab && document.body.classList.contains('lab-phone') && !!document.querySelector('.qa-spin'), 'phone QA run opened');
  await waitFor(qph, () => window.__lab.mount?.landed === true, null);
  const qpm = await qph.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, btn: Math.min(...[...document.querySelectorAll('.qa-verdict button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height)) }));
  ok(qpm.sw <= qpm.cw && qpm.btn >= 60, `phone QA: no horizontal overflow (${qpm.sw} ≤ ${qpm.cw}), verdict buttons ${Math.round(qpm.btn)} px`);
  await qph.screenshot({ path: shotDir + 'lab-qa-phone-00.png' });
  await qph.click('.qa-verdict button:has-text("Works")'); await waitFor(qph, () => document.querySelector('.qa-spin')?.dataset.k === '2', 'phone verdict advances');
  await qph.screenshot({ path: shotDir + 'lab-qa-phone-01.png', fullPage: true });

  if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); throw new Error(`${errors.length} console error(s)`); }
  console.log('  ✓ no console errors');
  console.log('\nLAB RUN PASSED');
} catch (e) {
  failed = true; console.error(e.message || e);
  if (errors.length) console.error('Console errors so far:\n' + errors.join('\n'));
} finally {
  await browser.close(); server?.server.close();
  process.exit(failed ? 1 : 0);
}
