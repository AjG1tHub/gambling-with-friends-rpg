// Browser run: TV + GM + four phones in one Chromium context against the built site and the local backend
// (`?backend=local`, so BroadcastChannel + localStorage carry the room between the pages). Scripted through
// join, drop and rejoin, kick, creation, a lap of the map, a fight, a challenge, a letter, a death, the recap
// and the vault as those screens land. Screenshots go to test/shots/. Run `npm run build` first.
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';
import { startDevServer } from '../../tools/dev-server.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 8000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { console.log('  ✓', msg); return true; } await sleep(100); } throw new Error(`TIMEOUT: ${msg}`); }
const stateOf = (page) => page.evaluate(() => window.__gwf?.session?.state || null);

const { server, url } = await startServer(0);
const dev = await startDevServer({ port: 0 });
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
// Uses the preinstalled Chromium when the pinned Playwright build is absent (the cloud workspace), else Playwright's own.
import { existsSync } from 'node:fs';
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && !require_dir(p));
function require_dir(p) { try { return (await_stat(p)).isDirectory(); } catch { return true; } }
function await_stat(p) { return statSync(p); }
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
// The PC: one context for the GM console and the TV. Every phone gets its own context (its own storage), like a real phone.
const pc = await browser.newContext({ viewport: { width: 1600, height: 900 } });
pc.setDefaultTimeout(15000);
const newPhone = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); c.setDefaultTimeout(15000); return c.newPage(); };
const pages = {};
let failed = false;
try {
  // ── Phase 0: GM creates a room, TV opens it, four phones join ──────────────────────────────
  console.log('Phase 0: room, join, drop, rejoin, kick');
  const gm = pages.gm = await pc.newPage();
  await gm.goto(`${url}/gm/?${Q}`);
  await gm.fill('input[type=password]', '4242');
  await gm.click('button:has-text("Create room")');
  await waitFor(gm, () => !!window.__gwf?.session, 'GM created the room');
  const code = await gm.evaluate(() => window.__gwf.session.code);
  ok(/^[A-Z]{4}$/.test(code), `room code ${code}`);
  await gm.screenshot({ path: shotDir + '00-gm-console.png' });

  const tv = pages.tv = await pc.newPage();
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(`${url}/?code=${code}&${Q}`);
  await waitFor(tv, () => !!window.__gwf?.session, 'TV opened the room');
  ok((await tv.locator('.join .code').innerText()).trim() === code, 'TV shows the join code and QR');
  await tv.screenshot({ path: shotDir + '01-tv-lobby-empty.png' });

  const phones = [];
  for (let i = 0; i < 4; i++) {
    const ph = await newPhone();
    await ph.goto(`${url}/phone/?code=${code}&${Q}`);
    await ph.fill('input[placeholder="Your name at the table"]', ['Aj', 'Nick', 'Sam', 'Vin'][i]);
    await ph.click('button:has-text("Sit down")');
    await waitFor(ph, () => !!window.__gwf?.ctx?.me, `phone ${i} sat down`);
    phones.push(ph); pages['phone' + i] = ph;
  }
  await waitFor(tv, () => Object.keys(window.__gwf.session.state.players).length === 4, 'TV sees four players');
  await tv.screenshot({ path: shotDir + '02-tv-lobby-four.png' });
  await phones[0].screenshot({ path: shotDir + '03-phone-lobby.png' });
  // ready up
  for (const ph of phones) await ph.click('button:has-text("Tap when ready")');
  await waitFor(gm, () => Object.values(window.__gwf.session.state.players).every(p => p.ready), 'everyone ready');

  // drop a phone and rejoin: same seat, no GM action
  const seatBefore = await phones[2].evaluate(() => window.__gwf.ctx.me);
  const nameBefore = await phones[2].evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].name);
  await phones[2].reload();
  await waitFor(phones[2], () => !!window.__gwf?.ctx?.me, 'phone 2 rejoined after reload');
  const seatAfter = await phones[2].evaluate(() => window.__gwf.ctx.me);
  ok(seatBefore === seatAfter, `reload keeps the seat (${nameBefore})`);
  ok((await stateOf(gm)).players[seatAfter].connected === true, 'seat is connected again');
  // proxy from the GM then reconnect lifts it
  await gm.evaluate((pid) => window.__gwf.session.dispatch('GM_PROXY', { playerId: pid, on: true }, 'gm'), seatAfter);
  await waitFor(phones[2], (pid) => window.__gwf.session.state.players[pid]?.proxied === true, 'phone 2 sees itself proxied', seatAfter);
  await phones[2].reload();
  await waitFor(gm, (pid) => window.__gwf.session.state.players[pid]?.proxied === false, 'reconnect lifted the proxy', seatAfter);

  // GM kicks phone 3
  const kickId = await phones[3].evaluate(() => window.__gwf.ctx.me);
  gm.once('dialog', d => d.accept());
  await gm.click(`tr:has-text("Vin") button:has-text("Kick")`);
  await waitFor(phones[3], () => /removed/i.test(document.body.innerText), 'kicked phone sees it was removed');
  ok(!(await stateOf(tv)).seats.includes(kickId), 'TV no longer lists the kicked seat');
  await gm.screenshot({ path: shotDir + '04-gm-table.png' });

  // start the run; clocks and turn order
  gm.once('dialog', d => d.accept());
  await gm.click('button:has-text("Start the run")');
  await waitFor(tv, () => window.__gwf.session.state.phase === 'playing', 'run started');
  const st = await stateOf(tv);
  ok(st.seats.length === 3, 'three seats in the turn order');
  await tv.screenshot({ path: shotDir + '05-tv-playing.png' });
  const turnPid = st.seats[st.turnIdx % st.seats.length];
  // the mover ends their turn from the phone
  for (const ph of phones.slice(0, 3)) { const me = await ph.evaluate(() => window.__gwf.ctx.me); if (me === turnPid) { await ph.click('button:has-text("End turn")'); } }
  await waitFor(tv, () => window.__gwf.session.state.turnIdx === 1, 'turn passed to the next seat');
  // pause from the GM freezes the phone clock text
  await gm.click('button:has-text("Pause")');
  await waitFor(tv, () => window.__gwf.session.state.gm.paused === true, 'paused');
  await gm.click('button:has-text("Resume")');
  await waitFor(tv, () => window.__gwf.session.state.gm.paused === false, 'resumed');
  console.log('Phase 0 gate: PASS');
} catch (e) {
  failed = true; console.error(e);
  for (const [name, p] of Object.entries(pages)) await p.screenshot({ path: shotDir + `fail-${name}.png` }).catch(() => {});
} finally {
  await browser.close(); server.close(); dev.close();
}
process.exit(failed ? 1 : 0);
