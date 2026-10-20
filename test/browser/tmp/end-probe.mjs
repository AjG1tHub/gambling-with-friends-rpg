import { chromium } from 'playwright';
import { startDevServer } from '../../../tools/dev-server.mjs';
const dev = await startDevServer({ port: 0 });
const url = 'http://127.0.0.1:4181'; const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`; const shots = '/home/claude/gambling-with-friends-rpg/test/shots/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = []; const hook = (p, n) => { p.on('pageerror', e => errors.push(`${n}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/404|TUNNEL|MIME/.test(m.text())) errors.push(`${n} console: ${m.text()}`); }); };
const pc = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const gm = await pc.newPage(); hook(gm, 'gm'); await gm.goto(`${url}/gm/?${Q}`); await gm.fill('input[type=password]', '4242'); await gm.click('button:has-text("Create room")');
await gm.waitForFunction(() => !!window.__gwf?.session); const code = await gm.evaluate(() => window.__gwf.session.code);
const phones = [], ctxs = [];
for (const name of ['Aj', 'Nick']) { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); ctxs.push(c); const p = await c.newPage(); hook(p, name); await p.goto(`${url}/phone/?code=${code}&${Q}`); await p.fill('input[placeholder="Your name at the table"]', name); await p.click('button:has-text("Sit down")'); await p.waitForFunction(() => !!window.__gwf?.ctx?.me); phones.push(p); }
gm.once('dialog', d => d.accept()); await gm.click('button:has-text("Start the run")'); await phones[0].waitForFunction(() => window.__gwf.session.state.phase === 'playing');
const moverFirst = await phones[0].evaluate(() => window.__gwf.session.state.seats[0] === window.__gwf.ctx.me);
const mover = moverFirst ? phones[0] : phones[1], other = moverFirst ? phones[1] : phones[0];
const stateOf = (p) => p.evaluate(() => { const s = window.__gwf.session.state; const me = window.__gwf.ctx.me; const c = Object.values(s.characters).find(c => c.playerId === me); return { me, c, s }; });
// ── held + rotate in place + tap-a-cell placement on the Cage
await mover.click('nav.tabs button:has-text("Cage")'); await sleep(500);
const cell = await mover.evaluate(() => Number(document.querySelector('[data-gwf-grid]').dataset.cell)); const pitch = cell + 2;
const { c: c0 } = await stateOf(mover); const tall = c0.grid.cells.find(x => c0.items[x.itemId].footprint.h === 3);
const el = mover.locator(`[data-item-id="${tall.itemId}"]`); const b = await el.boundingBox();
await mover.mouse.move(b.x + cell / 2, b.y + cell / 2); await mover.mouse.down(); await sleep(350); await mover.mouse.up(); await sleep(300);
// tap a free cell far right / bottom-ish: (5,4)
const g = await mover.locator('[data-gwf-grid]').boundingBox();
await mover.mouse.click(g.x + 8 + 5 * pitch + cell / 2, g.y + 8 + 2 * pitch + cell / 2); await sleep(500);
let st = await stateOf(mover); console.log('after tap-place', st.c.grid.cells.find(x => x.itemId === tall.itemId), st.s.lastError?.message);
// hold again and tap to rotate in place (should fit: row 2..4 → cols 5..7)
const b2 = await mover.locator(`[data-item-id="${tall.itemId}"]`).boundingBox();
await mover.mouse.move(b2.x + cell / 2, b2.y + cell / 2); await mover.mouse.down(); await sleep(350); await mover.mouse.up(); await sleep(300);
await mover.mouse.click(b2.x + cell / 2, b2.y + cell / 2); await sleep(500);
st = await stateOf(mover); console.log('after rotate-in-place', st.c.grid.cells.find(x => x.itemId === tall.itemId), st.s.lastError?.message);
await mover.screenshot({ path: shots + 'phone-cage-11-rotated.png' });
// bad placement: hold and drop onto the occupied potion cell → shake, no event
const potion = st.c.grid.cells.find(x => st.c.items[x.itemId].baseId === 'potion');
const b3 = await mover.locator(`[data-item-id="${tall.itemId}"]`).boundingBox(); const pb = await mover.locator(`[data-item-id="${potion.itemId}"]`).boundingBox();
const before = JSON.stringify(st.c.grid.cells);
await mover.mouse.move(b3.x + cell / 2, b3.y + cell / 2); await mover.mouse.down(); await sleep(350); await mover.mouse.move(b3.x + 30, b3.y + 20, { steps: 3 }); await mover.mouse.move(pb.x + cell / 2, pb.y + cell / 2, { steps: 6 }); await sleep(100);
console.log('hover bad?', await mover.evaluate(() => document.querySelector('.grid-hover')?.className));
await mover.mouse.up(); await sleep(400);
st = await stateOf(mover); console.log('bad drop unchanged', before === JSON.stringify(st.c.grid.cells), 'shake class', await mover.evaluate(() => !!document.querySelector('.gi.shake')));
// ── pet battle: both hatch, then start
for (const p of [mover, other]) { await p.click('nav.tabs button:has-text("Pets")'); await sleep(400); const k = p.locator('.wheel-col button'); if (await k.count()) { await k.nth(0).click(); await sleep(400); } }
const oppId = (await stateOf(other)).me;
await mover.evaluate((oppId) => window.__gwf.session.dispatch('PET_BATTLE_START', { opponentId: oppId, wager: 0 }, window.__gwf.ctx.me), oppId); await sleep(500);
console.log('fight', (await stateOf(mover)).s.fight?.kind, (await stateOf(mover)).s.lastError?.message);
await mover.click('nav.tabs button:has-text("Cage")'); await sleep(150); await mover.click('nav.tabs button:has-text("Pets")'); await sleep(400);
await mover.screenshot({ path: shots + 'phone-pets-3-battle.png' });
await mover.click('.attack-btn >> nth=0'); await sleep(400);
await mover.screenshot({ path: shots + 'phone-pets-4-locked.png' });
await other.click('nav.tabs button:has-text("Cage")'); await sleep(150); await other.click('nav.tabs button:has-text("Pets")'); await sleep(300);
for (let i = 0; i < 6; i++) { const btn = other.locator('.attack-btn'); const mb = mover.locator('.attack-btn'); if (await btn.count()) await btn.nth(1).click(); await sleep(300); if (await mb.count()) await mb.nth(0).click(); await sleep(300); if (!(await stateOf(other)).s.fight) break; }
console.log('battle done', (await stateOf(other)).s.lastPetBattle?.result);
await mover.screenshot({ path: shots + 'phone-pets-5-result.png' });
// ── end the run: GM_END_RUN, then Self on both; vault one item from mover via engine
await gm.evaluate(() => window.__gwf.session.dispatch('GM_END_RUN', { reason: 'test' }, 'gm')); await sleep(600);
console.log('phase', (await stateOf(mover)).s.phase, (await stateOf(mover)).s.lastError?.message);
st = await stateOf(mover); const anyItem = Object.keys(st.c.items)[0];
await mover.evaluate((id) => window.__gwf.session.dispatch('VAULT_BANK', { playerId: window.__gwf.ctx.me, itemIds: [id] }, window.__gwf.ctx.me), anyItem); await sleep(300);
await mover.evaluate(() => window.__gwf.session.dispatch('VETERAN_SAVE', { playerId: window.__gwf.ctx.me }, window.__gwf.ctx.me)); await sleep(300);
await mover.click('nav.tabs button:has-text("Self")'); await sleep(1500);
await mover.evaluate(() => document.querySelector('.end-panel')?.scrollIntoView()); await sleep(300);
console.log('end panel', (await mover.locator('.end-panel').innerText()).slice(0, 500));
await mover.screenshot({ path: shots + 'phone-self-4-ended.png' });
const roster = await gm.evaluate(() => null);
const ownerCode = await mover.evaluate(() => document.querySelector('.claim')?.textContent);
const backendRoster = dev.backend; const owners = Object.values(JSON.parse((await backendRoster.roster.get) ? '{}' : '{}'));
const o = await (async () => { const all = []; for (const k of ['ws:roster', 'roster']) { try { const v = await backendRoster.roster.claim(ownerCode, 'probe-device'); return v; } catch { } } return null; })();
console.log('owner saved', o ? { code: o.claimCode, chars: o.data.characters.map(e => ({ name: e.name, alive: e.alive, level: e.level, vault: e.vault.length, veteran: e.veteran, pets: e.pets.length })), vault: o.data.vault.length, vets: o.data.veterans } : 'none');
// ── recover on a third phone context (new device): enter the code on Self
const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p3 = await c3.newPage(); hook(p3, 'p3');
await p3.goto(`${url}/phone/?code=${code}&${Q}`); await p3.fill('input[placeholder="Your name at the table"]', 'Late'); await p3.click('button:has-text("Watch and wager")'); await p3.waitForFunction(() => !!window.__gwf?.ctx?.me);
await p3.click('nav.tabs button:has-text("Self")'); await sleep(800);
await p3.fill('input[aria-label="Claim code to recover"]', ownerCode); await p3.click('button:has-text("Recover")'); await sleep(800);
console.log('recovered text', (await p3.locator('.claim-panel').innerText()).slice(0, 200));
console.log('errors', errors);
await browser.close(); dev.close();
