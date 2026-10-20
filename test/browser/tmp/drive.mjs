// Drive the built site: GM creates a room, two phones join, GM starts the run, then exercise the tabs.
// usage: node drive.mjs <serverUrl> <shotDir> [tab]
import { chromium } from 'playwright';
import { startDevServer } from '../../../tools/dev-server.mjs';
const dev = await startDevServer({ port: 0 });
const [url = 'http://127.0.0.1:4180', shotDir = '/home/claude/gambling-with-friends-rpg/test/shots', only = 'all'] = process.argv.slice(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg, timeout = 10000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { console.log('  ✓', msg); return true; } await sleep(100); } throw new Error('TIMEOUT: ' + msg); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pc = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const phoneCtx = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); c.setDefaultTimeout(15000); return c; };
const errors = [];
const hook = (p, name) => { p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); p.on('response', r => { if (r.status() >= 400) errors.push(`${name} HTTP ${r.status()} ${r.url()}`); }); p.on('console', m => { if (m.type() === 'error' && !/404|TUNNEL|MIME/.test(m.text())) errors.push(`${name} console: ${m.text()}`); }); };
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
try {
  const gm = await pc.newPage(); hook(gm, 'gm');
  await gm.goto(`${url}/gm/?${Q}`);
  await gm.fill('input[type=password]', '4242');
  await gm.click('button:has-text("Create room")');
  await waitFor(gm, () => !!window.__gwf?.session, 'GM created the room');
  const code = await gm.evaluate(() => window.__gwf.session.code);
  console.log('room', code);
  // The local backend shares the room through BroadcastChannel + localStorage, so the phones live in the same context.
  const phones = [];
  for (let i = 0; i < 2; i++) {
    const pctx = await phoneCtx(); const ph = await pctx.newPage(); hook(ph, 'phone' + i);
    await ph.goto(`${url}/phone/?code=${code}&${Q}`);
    await ph.fill('input[placeholder="Your name at the table"]', ['Aj', 'Nick'][i]);
    await ph.click('button:has-text("Sit down")');
    await waitFor(ph, () => !!window.__gwf?.ctx?.me, `phone ${i} sat down`);
    phones.push(ph);
  }
  await waitFor(gm, () => Object.keys(window.__gwf.session.state.players).length === 2, 'GM sees two players');
  gm.once('dialog', d => d.accept());
  await gm.click('button:has-text("Start the run")');
  await waitFor(gm, () => window.__gwf.session.state.phase === 'playing', 'run started');
  const ph = phones[0];
  await ph.bringToFront();
  await waitFor(ph, () => window.__gwf.session.state.phase === 'playing', 'phone sees playing');
  const me = await ph.evaluate(() => window.__gwf.ctx.me);
  const dump = async () => ph.evaluate(() => { const s = window.__gwf.session.state; const c = Object.values(s.characters).find(c => c.playerId === window.__gwf.ctx.me); return { worn: Object.fromEntries(Object.entries(c.worn).filter(([k, v]) => v).map(([k, v]) => [k, v.name])), cells: c.grid.cells.map(x => ({ id: x.itemId, name: c.items[x.itemId]?.name, x: x.x, y: x.y, rot: x.rot, fp: c.items[x.itemId]?.footprint })), lastError: s.lastError }; });
  if (only === 'all' || only === 'cage') {
    await ph.click('nav.tabs button:has-text("Cage")');
    await sleep(600);
    await ph.screenshot({ path: `${shotDir}/phone-cage-1-overview.png`, fullPage: false });
    console.log(JSON.stringify(await dump(), null, 0));
    // long-press the first grid item, drag it two cells right
    const first = ph.locator('.cage-grid .gi').first();
    const box = await first.boundingBox();
    const grid = await ph.locator('[data-gwf-grid]').boundingBox();
    const cell = await ph.evaluate(() => Number(document.querySelector('[data-gwf-grid]').dataset.cell));
    const pitch = cell + 2;
    console.log('first item at', box, 'cell', cell);
    const sx = box.x + cell / 2, sy = box.y + cell / 2;
    await ph.mouse.move(sx, sy); await ph.mouse.down(); await sleep(350);
    await ph.mouse.move(sx + 10, sy + 5, { steps: 3 });
    await ph.mouse.move(sx + 4 * pitch, sy + 3 * pitch, { steps: 8 });
    await sleep(150);
    await ph.screenshot({ path: `${shotDir}/phone-cage-2-dragging.png` });
    const lifted = await ph.evaluate(() => ({ ghost: !!document.querySelector('.gi-ghost'), hover: document.querySelector('.grid-hover')?.className }));
    console.log('while dragging', lifted);
    console.log('over', await ph.evaluate(() => { const hv = document.querySelector('.grid-hover'); return { cls: hv?.className, left: hv?.style.left, top: hv?.style.top, display: hv?.style.display }; }));
    await ph.mouse.up(); await sleep(500);
    console.log('after drop', JSON.stringify(await dump()), await ph.evaluate(() => ({ last: window.__gwfGrid.last, scrollY, drag: !!window.__gwfGrid.drag, held: window.__gwfGrid.held })));
    await ph.screenshot({ path: `${shotDir}/phone-cage-3-after-drop.png` });
    // long-press without moving → held; tap → rotate
    const second = ph.locator('.cage-grid .gi').nth(1);
    const b2 = await second.boundingBox();
    await ph.mouse.move(b2.x + cell / 2, b2.y + cell / 2); await ph.mouse.down(); await sleep(350); await ph.mouse.up(); await sleep(300);
    console.log('held', await ph.evaluate(() => ({ held: !!document.querySelector('.gi.held'), toolsText: document.querySelector('.cage-tools')?.innerText })));
    await ph.screenshot({ path: `${shotDir}/phone-cage-4-held.png` });
    const heldBox = await ph.locator('.gi.held').boundingBox();
    await ph.mouse.click(heldBox.x + cell / 2, heldBox.y + cell / 2); await sleep(500);
    console.log('after rotate tap', JSON.stringify(await dump()));
    await ph.screenshot({ path: `${shotDir}/phone-cage-5-rotated.png` });
    // tap an item → sheet
    const third = ph.locator('.cage-grid .gi').first();
    const b3 = await third.boundingBox();
    await ph.mouse.click(b3.x + cell / 2, b3.y + cell / 2); await sleep(400);
    console.log('sheet', await ph.evaluate(() => document.querySelector('.item-sheet')?.innerText.slice(0, 300)));
    await ph.screenshot({ path: `${shotDir}/phone-cage-6-sheet.png` });
    // equip via the sheet if possible
    const eq = ph.locator('.item-sheet button:has-text("Equip")');
    if (await eq.count()) { await eq.click(); await sleep(500); console.log('after equip', JSON.stringify(await dump())); }
    await ph.screenshot({ path: `${shotDir}/phone-cage-7-equipped.png` });
    // drag a worn item from a slot into the grid
    const slot = ph.locator('.doll-slot.full').first();
    if (await slot.count()) {
      const sb = await slot.boundingBox();
      await ph.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await ph.mouse.down(); await sleep(350);
      await ph.mouse.move(sb.x + 20, sb.y + 30, { steps: 3 });
      const g2 = await ph.locator('[data-gwf-grid]').boundingBox();
      // find a free spot: last row, last columns
      await ph.mouse.move(g2.x + g2.width - 8 - pitch * 1.5, g2.y + 8 + pitch * 1.5, { steps: 10 }); await sleep(150);
      await ph.screenshot({ path: `${shotDir}/phone-cage-8-slot-drag.png` });
      await ph.mouse.up(); await sleep(500);
      console.log('after slot→grid', JSON.stringify(await dump()));
    }
    // drag a grid weapon onto the main hand slot
    const weapon = await ph.evaluate(() => { const s = window.__gwf.session.state; const c = Object.values(s.characters).find(c => c.playerId === window.__gwf.ctx.me); const cell = c.grid.cells.find(x => c.items[x.itemId]?.slot === 'weapon'); return cell ? cell.itemId : null; });
    if (weapon) {
      const wb = await ph.locator(`[data-item-id="${weapon}"]`).boundingBox();
      const mh = await ph.locator('[data-slot="mainhand"]').boundingBox();
      await ph.mouse.move(wb.x + cell / 2, wb.y + cell / 2); await ph.mouse.down(); await sleep(350);
      await ph.mouse.move(wb.x + 30, wb.y - 30, { steps: 4 });
      await ph.mouse.move(mh.x + mh.width / 2, mh.y + mh.height / 2, { steps: 10 }); await sleep(150);
      await ph.screenshot({ path: `${shotDir}/phone-cage-9-to-slot.png` });
      await ph.mouse.up(); await sleep(500);
      console.log('after grid→slot', JSON.stringify(await dump()));
    }
    await ph.screenshot({ path: `${shotDir}/phone-cage-10-final.png` });
    // auto-sort
    await ph.click('button:has-text("Auto-sort")'); await sleep(400);
    console.log('after sort', JSON.stringify((await dump()).cells));
  }
  if (only === 'all' || only === 'self') {
    await ph.click('nav.tabs button:has-text("Self")'); await sleep(600);
    await ph.screenshot({ path: `${shotDir}/phone-self-1.png`, fullPage: true });
    console.log('self text', (await ph.locator('#phScreen').innerText()).slice(0, 1200));
  }
  if (only === 'all' || only === 'pets') {
    await ph.click('nav.tabs button:has-text("Pets")'); await sleep(600);
    await ph.screenshot({ path: `${shotDir}/phone-pets-1.png`, fullPage: true });
    console.log('pets text', (await ph.locator('#phScreen').innerText()).slice(0, 800));
  }
  if (only === 'all' || only === 'letters') {
    await ph.click('nav.tabs button:has-text("Letters")'); await sleep(600);
    await ph.screenshot({ path: `${shotDir}/phone-letters-1.png`, fullPage: true });
    console.log('letters text', (await ph.locator('#phScreen').innerText()).slice(0, 800));
  }
} catch (e) { console.error(e); } finally {
  console.log('errors:', errors.slice(0, 20));
  await browser.close(); dev.close();
}
