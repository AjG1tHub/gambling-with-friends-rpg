// Ad-hoc run 5 (not part of CI): 8-seat lobby on the TV, Teams mode with fog, small phones (360x640) through
// creation and every tab with overflow checks, a fight where the TV is sampled for result spoilers, and a tour of
// every GM console panel. Screenshots: test/shots/r5-*.png. Console/page errors are collected per page.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';
import { startDevServer } from '../../tools/dev-server.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const findings = [];
const note = (m) => { findings.push(m); console.log('  ⚠', m); };
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) findings.push('FAILED: ' + m); };
async function waitFor(page, fn, msg, arg, timeout = 15000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(100); } throw new Error('TIMEOUT: ' + msg); }
const shot = (page, name) => page.screenshot({ path: `${shotDir}r5-${name}.png` }).catch(() => {});
const errors = [];
const IGNORE = [/ERR_TUNNEL_CONNECTION_FAILED/, /fonts\.googleapis/, /Expected a JavaScript-or-Wasm module script/, /boots-.*\.json/, /favicon/];
const bad = new Set();
const wire = (page, tag) => { page.on('response', r => { if (r.status() >= 400) bad.add(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); }); page.on('console', m => { if (m.type() === 'error' && !IGNORE.some(r => r.test(m.text()))) errors.push(`${tag}: ${m.text()}`); }); page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`)); };
async function section(name, fn) { console.log(`\n▶ ${name}`); try { await fn(); } catch (e) { console.log('  ✗ ' + e.message); findings.push(`SECTION "${name}" aborted: ${e.message}`); } }
setTimeout(() => { console.error('WATCHDOG'); process.exit(1); }, 9 * 60 * 1000).unref();

const { server, url } = await startServer(0);
const dev = await startDevServer({ port: 0 });
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
const pc = await browser.newContext({ viewport: { width: 1600, height: 900 } });
pc.setDefaultTimeout(15000);
const gm = await pc.newPage(); gm.on('dialog', d => d.accept()); wire(gm, 'gm');
const tv = await pc.newPage(); wire(tv, 'tv');
const phones = [], names = ['Aj', 'Nick', 'Sam', 'Vin', 'Kit', 'Mo', 'Rae', 'Zed'];
let code = '';

await section('A. Teams mode + fog room, GM console tour (lobby)', async () => {
  await gm.goto(`${url}/gm/?${Q}`);
  await gm.fill('input[type=password]', '4242');
  await shot(gm, '00-gm-create');
  const sels = gm.locator('select');
  const n = await sels.count();
  console.log('  selects on the create form:', n, await sels.evaluateAll(els => els.map(e => [...e.options].map(o => o.value).join('/'))));
  await sels.nth(0).selectOption('teams');
  await gm.click('button:has-text("Create room")');
  await waitFor(gm, () => !!window.__gwf?.session, 'room created');
  code = await gm.evaluate(() => window.__gwf.session.code);
  const st = await gm.evaluate(() => ({ mode: window.__gwf.session.state.mode, fog: window.__gwf.session.state.fog }));
  ok(st.mode === 'teams', `mode is ${st.mode}, fog=${JSON.stringify(st.fog)}`);
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(`${url}/?code=${code}&${Q}`);
  await waitFor(tv, () => !!window.__gwf?.session, 'TV open');
});

await section('B. eight small phones (360x640) join; TV lobby with 8 seats', async () => {
  for (let i = 0; i < 8; i++) {
    const c = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    c.setDefaultTimeout(15000);
    const ph = await c.newPage(); wire(ph, 'phone' + i);
    await ph.goto(`${url}/phone/?code=${code}&${Q}`);
    await ph.fill('input[placeholder="Your name at the table"]', names[i]);
    await ph.click('button:has-text("Sit down")');
    await waitFor(ph, () => !!window.__gwf?.ctx?.me, `${names[i]} sat down`);
    phones.push(ph);
  }
  await waitFor(tv, () => Object.keys(window.__gwf.session.state.players).length === 8, 'TV sees 8 players');
  await shot(tv, '01-tv-lobby-8');
  await shot(phones[7], '02-phone-lobby-small');
  const ov = await phones[7].evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(ov.sw <= ov.cw, `lobby phone has no horizontal overflow (${ov.sw} ≤ ${ov.cw})`);
});

await section('C. GM console: every panel', async () => {
  const n = await gm.locator('.gm-nav button').count();
  for (let i = 0; i < n; i++) {
    const b = gm.locator('.gm-nav button').nth(i);
    const label = (await b.innerText()).replace(/\s+/g, ' ').trim().slice(0, 20);
    await b.click(); await sleep(400);
    await shot(gm, `04-gm-panel-${i}`);
    const ov = await gm.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, err: document.querySelector('.log.error')?.textContent || null }));
    console.log(`  panel ${i} "${label}" overflowX=${ov.sw > ov.cw} error=${ov.err}`);
    if (ov.err) note(`GM panel "${label}" shows an error: ${ov.err}`);
  }
});

await section('D. kick to three, creation on small phones', async () => {
  await gm.locator('.gm-nav button').first().click(); await sleep(300);
  for (const nm of ['Zed', 'Rae', 'Mo', 'Kit', 'Vin']) { await gm.locator('tr', { has: gm.locator('td b', { hasText: new RegExp('^' + nm + '$') }) }).locator('button:has-text("Kick")').first().click().catch(e => note(`kick ${nm}: ${e.message.split('\n')[0]}`)); await sleep(250); }
  await waitFor(tv, () => window.__gwf.session.state.seats.length === 3, 'three seats left');
  const live = phones.slice(0, 3);
  for (const ph of live) await ph.click('button:has-text("Tap when ready")').catch(() => {});
  await gm.click('button:has-text("Open character creation")');
  await waitFor(tv, () => window.__gwf.session.state.phase === 'creation', 'creation open');
  await shot(tv, '10-tv-creation');
  const plan = [['Ajax', 'Whale'], ['Nickel', 'Enforcer'], ['Samson', 'Pit Boss']];
  for (let i = 0; i < 3; i++) {
    const ph = live[i], [cname, klass] = plan[i];
    await ph.fill('input[placeholder="Character name"]', cname);
    if (i === 0) await shot(ph, '11-creation-look-small');
    await ph.click('button:has-text("That is me")');
    await waitFor(ph, (n) => Object.values(window.__gwf.session.state.characters).some(c => c.name === n), `${cname} exists`, cname);
    await ph.locator('button.class-card', { hasText: klass }).first().click();
    if (i === 0) { await sleep(400); await shot(ph, '12-creation-class-small'); const ov = await ph.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(ov[0] <= ov[1], `class step no overflow ${ov}`); }
    await ph.locator('button.stat-chip:has-text("Luck")').first().click();
    await ph.locator('button.chip:has-text("50/50")').first().click();
    await ph.locator('button.primary.big:has-text("Play for Luck")').first().click();
    await ph.locator('.mg-buttons button:has-text("SPIN")').first().click();
    if (i === 0) { await sleep(500); await shot(ph, '13-creation-gamble-small'); }
    await waitFor(ph, () => { const c = Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me); return (c?.creation?.gambles?.length || 0) >= 1; }, `${cname} gamble settled`, undefined, 25000);
    await ph.getByRole('button', { name: /^Lock in( with .*)? →$/ }).first().click();
    if (i === 0) { await sleep(300); await shot(ph, '14-creation-lockstep-small'); }
    await ph.getByRole('button', { name: '🔒 Lock in' }).first().click();
    await waitFor(ph, () => !!Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.locked, `${cname} locked`);
    // Ready is already on from the lobby unless creation reset it
    const ready = await ph.evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].ready);
    if (!ready) { await ph.click('button:has-text("Tap when ready")'); }
  }
  await shot(tv, '15-tv-creation-done');
  await gm.locator('.gm-nav button').first().click(); await sleep(300);
  await shot(gm, '16-gm-table-teams-before');
  const hasEditor = await gm.locator('text=Save teams').count();
  ok(hasEditor > 0, 'GM Table panel shows the teams editor in Teams mode');
  const teamsBefore = await tv.evaluate(() => Object.values(window.__gwf.session.state.players).map(p => p.teamId));
  console.log('  teamIds before start:', JSON.stringify(teamsBefore));
  await gm.click('button:has-text("Start the run")');
  await sleep(1500);
  const ph0 = await tv.evaluate(() => ({ phase: window.__gwf.session.state.phase, err: window.__gwf.session.state.lastError?.message || null }));
  console.log('  after Start with NO teams assigned:', JSON.stringify(ph0));
  await shot(gm, '17-gm-after-start-no-teams');
  if (ph0.phase === 'playing') note('Teams mode: the GM can start the run with nobody on a team (no warning/refusal); every player is teamless');
  else {
    console.log('  start refused → assigning teams through the editor');
    const selects = gm.locator('select');
    const cnt = await selects.count(); console.log('  selects on table panel', cnt);
  }
  await waitFor(tv, () => window.__gwf.session.state.phase === 'playing', 'run started', undefined, 8000).catch(async () => { note('run did not start after Start the run in Teams mode without teams'); });
  await sleep(1200);
  await shot(tv, '20-tv-run-start-fog');
});

const seatOf = (ph) => ph.evaluate(() => window.__gwf.ctx.me);
await section('E. every phone tab on a 360x640 screen', async () => {
  const mv = await tv.evaluate(() => window.__gwf.session.state.moverId);
  let ph = null; for (const p of phones.slice(0, 3)) if ((await seatOf(p)) === mv) ph = p;
  ph = ph || phones[0];
  // keep a pet from the triple wheel if it opens
  for (let k = 0; k < 3; k++) { const w = ph.locator('.pet-wheel'); if (await w.count()) { await w.first().click(); await sleep(400); } }
  const labels = ['Play', 'Cage', 'Self', 'Pets', 'Map', 'Letters'];
  for (const p of phones.slice(0, 3)) {
    const nm = await p.evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].name);
    await shot(p, `29-${nm}-start`);
    for (const l of labels) {
      const hit = await p.evaluate((lab) => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim().startsWith(lab)); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { tab: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], vh: innerHeight, top: e === b || b.contains(e) ? 'tab' : `${e?.tagName}.${(e?.className || '').toString().slice(0, 30)}` }; }, l);
      if (hit.top !== 'tab') note(`${nm}: the ${l} tab (y=${hit.tab[1]}..${hit.tab[1] + hit.tab[3]}, viewport ${hit.vh}px) is covered by ${hit.top} on a 360x640 phone`);
      await p.locator('.tabs button', { hasText: l }).first().click({ force: true }); await sleep(350);
      const m = await p.evaluate(() => { const d = document.documentElement; const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > d.clientWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => (e.className || e.tagName).toString().slice(0, 40)); return { sw: d.scrollWidth, cw: d.clientWidth, wide }; });
      if (p === phones[0] || l === 'Cage') await shot(p, `30-${nm}-${l.toLowerCase()}`);
      if (m.sw > m.cw && l === 'Play') { const d = await p.evaluate(() => [...document.querySelectorAll('.top, .top > *, .top *, .coach-slot, .coach-slot > *, .tabs')].slice(0, 14).map(e => `${e.tagName}.${(e.className?.baseVal ?? e.className).toString().slice(0, 24)} w=${Math.round(e.getBoundingClientRect().width)} sw=${e.scrollWidth} x=${Math.round(e.getBoundingClientRect().x)} txt="${(e.textContent || '').trim().slice(0, 28)}"`)); console.log(`  ${nm} wide-probe (viewport ${m.cw}):\n    ` + d.join('\n    ')); }
      if (m.sw > m.cw) note(`${nm}'s ${l} tab overflows horizontally on 360px (${m.sw} > ${m.cw}); wide elements: ${m.wide.join(', ')}`);
    }
    await p.locator('.tabs button', { hasText: 'Play' }).first().click({ force: true });
  }
  console.log('  tab sweep done');
});

await section('F. fight on the TV: sample for result spoilers during the spin', async () => {
  const st = await tv.evaluate(() => window.__gwf.session.state);
  const mover = st.moverId; let ph = null; for (const p of phones.slice(0, 3)) if ((await seatOf(p)) === mover) ph = p;
  const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
  const m = Object.values(st.monsters).filter(x => !x.dead && x.pos && !x.boss && !x.raid && !x.final && st.map.hexes[x.pos]?.type === 'encounter').sort((a, b) => a.health - b.health)[0];
  if (!m) throw new Error('no encounter monster');
  await gm.evaluate(([pid, hex]) => window.__gwf.session.dispatch('GM_TELEPORT', { playerId: pid, hex }, 'gm'), [mover, m.pos]);
  await waitFor(ph, ([me, k]) => Object.values(window.__gwf.session.state.characters).find(x => x.playerId === me)?.pos === k, 'teleported', [mover, m.pos]);
  await ph.locator('.tabs button', { hasText: 'Play' }).first().click({ force: true });
  for (let k = 0; k < 3 && await ph.locator('.pet-wheel').count(); k++) { await ph.locator('.pet-wheel').first().click(); await sleep(400); }
  await ph.locator('.prompt button.primary.big:has-text("Plod")').first().click();
  await waitFor(ph, () => { const s = window.__gwf.session.state; return !!(s.moveSession && !s.moveSession.done); });
  await sleep(500);
  const probe = await ph.evaluate(() => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim().startsWith('Play')); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const t = document.querySelector('.tabs'); const cs = getComputedStyle(t); const sc = document.getElementById('phScreen'); return { vh: innerHeight, tabRect: [r.y, r.height], over: e === b ? 'tab' : `${e?.tagName}.${e?.className?.baseVal ?? e?.className}`, tabPos: cs.position, tabZ: cs.zIndex, scrollY, docH: document.documentElement.scrollHeight, screenScroll: sc ? [sc.scrollTop, sc.scrollHeight, sc.clientHeight] : null }; });
  console.log('  tab-bar probe during move on 360x640:', JSON.stringify(probe));
  if (probe.over !== 'tab') note(`During a move on a 360x640 phone the Play tab is covered by ${probe.over} (tab bar ${probe.tabPos}, z ${probe.tabZ}, doc height ${probe.docH} vs viewport ${probe.vh})`);
  await shot(ph, '39-move-tabbar-small');
  await ph.locator('.rosette .hub:not([disabled])').first().click();
  await waitFor(ph, (id) => { const f = window.__gwf.session.state.fight; return !!f && !f.done && f.monsterId === id; }, `fight with ${m.name}`, m.id, 25000);
  await shot(ph, '40-fight-small'); await shot(tv, '41-tv-fight-open');
  await ph.locator('button.item-row:not([disabled])', { hasText: 'Coin Blade' }).first().click();
  await ph.locator('.mg-buttons button:has-text("SPIN")').first().click();
  // sample TV text while the round and the monster's reply play out
  const samples = []; const t0 = Date.now();
  let accepted = false, shots = 0;
  while (Date.now() - t0 < 14000) {
    if (!accepted) { const a = ph.locator('.mg-buttons button:has-text("Accept")'); if (await a.count()) { await a.first().click(); accepted = true; } }
    const s = await tv.evaluate(() => ({ t: document.body.innerText, spin: /WHEEL TURNS|turns…/i.test(document.body.innerText) }));
    samples.push({ ms: Date.now() - t0, spin: s.spin, result: /MISS ·|HIT ·|LOST|WIN —|LOSE —/.test(s.t), text: s.t });
    if (shots < 3 && (Date.now() - t0) > shots * 2500) { await shot(tv, `42-tv-fight-sample-${shots}`); shots++; }
    await sleep(250);
  }
  const spoil = samples.filter(s => s.spin && s.result);
  console.log(`  ${samples.length} TV samples; ${spoil.length} had a result text while "THE WHEEL TURNS…" was showing`);
  if (spoil.length) note(`TV shows the round's result in the fight panel/log while the wheel is still turning (${spoil.length}/${samples.length} samples; first at ${spoil[0].ms} ms)`);
  await shot(ph, '43-fight-after-small');
  const fs = await tv.evaluate(() => { const f = window.__gwf.session.state.fight; return f ? { exchanges: f.exchanges, log: f.log.length, done: f.done } : null; });
  console.log('  fight state', JSON.stringify(fs));
});

console.log('\nHTTP >=400:'); [...bad].slice(0, 15).forEach(b => console.log('  ' + b));
console.log(`\nconsole/page errors: ${errors.length}`); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log(`\nFINDINGS (${findings.length}):`); findings.forEach(f => console.log(' - ' + f));
await browser.close(); dev.close?.(); server.close(); process.exit(0);
