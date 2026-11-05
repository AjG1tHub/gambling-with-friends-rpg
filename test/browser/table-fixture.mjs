// Shared fixture for the browser gates that need a live table: GM console + TV + three 360×640 phones on the ws
// dev backend, through creation into a running Free-for-all (tutorial opening off). Used by reconnect.mjs and
// offline.mjs. Call `await openTable()` once, then `newRoom(tag)` per scenario; `closeTable()` at the end.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';
import { startDevServer } from '../../tools/dev-server.mjs';

export const shotDir = new URL('../shots/', import.meta.url).pathname; mkdirSync(shotDir, { recursive: true });
export const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function waitFor(page, fn, msg, arg = undefined, timeout = 20000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(120); } throw new Error(`TIMEOUT: ${msg}`); }
export const pageErrors = [];
export const watch = (page, tag) => page.on('pageerror', e => pageErrors.push(`${tag}: ${e.message.slice(0, 160)}`));
export const click = async (page, sel, label, timeout = 15000) => { const l = typeof sel === 'string' ? page.locator(sel).first() : sel.first(); await l.waitFor({ state: 'visible', timeout }); await l.click(); if (label) console.log('  ·', label); };
export const meOf = (ph) => ph.evaluate(() => window.__gwf?.ctx?.me);
export const stateOf = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__gwf.session.state)));
// A new character's first turn opens with the Triple Pet Wheel: tap a column until the Plod prompt is up.
export async function toPlod(ph) {
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    if (await ph.locator('.prompt button.primary.big:has-text("Plod")').count()) return;
    const wheel = ph.locator('.pet-wheel'); if (await wheel.count()) await wheel.first().click({ force: true }).catch(() => {});
    const gotIt = ph.locator('button:has-text("GOT IT"), button:has-text("Got it")'); if (await gotIt.count()) await gotIt.first().click({ force: true }).catch(() => {});
    await sleep(400);
  }
}
// Plod, stay put on the current hex, and reach the action phase (answering a tile prompt is the caller's job).
export async function stayPut(ph, name) {
  await toPlod(ph);
  await click(ph, '.prompt button.primary.big:has-text("Plod")', `${name} plods`);
  await waitFor(ph, () => { const s = window.__gwf.session.state; return !!(s.moveSession && !s.moveSession.done); }, '', undefined, 8000);
  await click(ph, '.rosette .hub:not([disabled])', `${name} stays put`);
}

let server, url, dev, Q, browser;
export async function openTable() {
  ({ server, url } = await startServer(0));
  dev = await startDevServer({ port: 0 });
  Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
  return { browser, url, Q };
}
export async function closeTable() { await browser?.close(); server?.close(); dev?.close?.(); }

// A fresh room: GM, TV, three phones, creation done, run started, nobody has moved.
export async function newRoom(tag, { mode = 'ffa', classes = ['Whale', 'Whale', 'Whale'], onDialog = null } = {}) {
  const gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } }); gmCtx.setDefaultTimeout(15000);
  const gm = await gmCtx.newPage(); watch(gm, tag + ' gm'); gm.on('dialog', d => { onDialog?.(d.message()); d.accept(); });
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); tvCtx.setDefaultTimeout(15000);   // its own context: the TV can go offline without the GM
  const tv = await tvCtx.newPage(); watch(tv, tag + ' tv');
  await gm.goto(`${url}/gm/?${Q}`); await gm.fill('input[type=password]', '4242'); await gm.uncheck('input[name=ramp]').catch(() => {}); if (mode !== 'ffa') await gm.locator('select').nth(0).selectOption(mode);
  await gm.click('button:has-text("Create room")'); await waitFor(gm, () => !!window.__gwf?.session, `${tag}: room created`);
  const code = await gm.evaluate(() => window.__gwf.session.code);
  await tv.setViewportSize({ width: 1920, height: 1080 }); await tv.goto(`${url}/?code=${code}&${Q}`); await waitFor(tv, () => !!window.__gwf?.session, 'TV opened');
  const names = ['Ada', 'Bo', 'Cy'], phones = [];
  for (let i = 0; i < 3; i++) {
    const c = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); c.setDefaultTimeout(15000);
    const ph = await c.newPage(); watch(ph, `${tag} phone${i}`);
    await ph.goto(`${url}/phone/?code=${code}&${Q}`); await ph.fill('input[placeholder="Your name at the table"]', names[i]); await ph.click('button:has-text("Sit down")');
    await waitFor(ph, () => !!window.__gwf?.ctx?.me); await ph.click('button:has-text("Tap when ready")'); phones.push(ph);
  }
  await gm.click('button:has-text("Open character creation")'); await waitFor(tv, () => window.__gwf.session.state.phase === 'creation', 'creation open');
  for (let i = 0; i < 3; i++) {
    const ph = phones[i]; await ph.fill('input[placeholder="Character name"]', names[i] + ' the Bold'); await ph.click('button:has-text("That is me")');
    await ph.locator('button.class-card', { hasText: classes[i] }).first().click();
    await ph.getByRole('button', { name: /^Lock in( with .*)? →$/ }).first().click(); await ph.getByRole('button', { name: '🔒 Lock in' }).first().click();
    await waitFor(ph, () => !!Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.locked);
    if (!(await ph.evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].ready))) await ph.click('button:has-text("Tap when ready")');
  }
  await gm.locator('.gm-nav button').first().click(); await gm.click('button:has-text("Start the run")');
  await waitFor(tv, () => window.__gwf.session.state.phase === 'playing', `${tag}: run started`); await sleep(800);
  const gmDo = async (type, payload) => { const err = await gm.evaluate(async ([t, p]) => { const s = window.__gwf.session; const b = Date.now(); await s.dispatch(t, p, 'gm'); const e = s.state.lastError; return e && e.type === t && e.ts >= b ? e.message : null; }, [type, payload]); if (err) throw new Error(`${type} refused: ${err}`); };
  const ids = []; for (const ph of phones) ids.push(await meOf(ph));
  return { gm, tv, phones, ids, names, gmDo, code, gmCtx, tvCtx, close: async () => { await gmCtx.close(); await tvCtx.close(); for (const p of phones) await p.context().close(); } };
}
// Reload a page and wait for its session to come back with the same seat.
export async function reload(page, label, seat) {
  const t0 = Date.now(); await page.reload();
  await waitFor(page, () => !!window.__gwf?.session?.state?.phase, `${label} reloaded`, undefined, 25000);
  if (seat) { await waitFor(page, (id) => window.__gwf.ctx?.me === id, `${label} is still ${seat.name}'s seat`, seat.id, 15000); }
  console.log(`    (back in ${Date.now() - t0} ms)`);
}
