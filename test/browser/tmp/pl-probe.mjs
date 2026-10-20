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
const phones = [];
for (const name of ['Aj', 'Nick']) { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const p = await c.newPage(); hook(p, name); await p.goto(`${url}/phone/?code=${code}&${Q}`); await p.fill('input[placeholder="Your name at the table"]', name); await p.click('button:has-text("Sit down")'); await p.waitForFunction(() => !!window.__gwf?.ctx?.me); phones.push(p); }
gm.once('dialog', d => d.accept()); await gm.click('button:has-text("Start the run")'); await phones[0].waitForFunction(() => window.__gwf.session.state.phase === 'playing');
const moverFirst = await phones[0].evaluate(() => window.__gwf.session.state.seats[0] === window.__gwf.ctx.me);
const mover = moverFirst ? phones[0] : phones[1], other = moverFirst ? phones[1] : phones[0];
// ── Pets: hatch pick on the mover, then card, then switch flows
await mover.click('nav.tabs button:has-text("Pets")'); await sleep(600);
await mover.screenshot({ path: shots + 'phone-pets-1-wheels.png' });
const keeps = mover.locator('.wheel-col button');
if (await keeps.count()) { await keeps.nth(0).click(); await sleep(600); }
console.log('pets after pick', await mover.evaluate(() => { const c = Object.values(window.__gwf.session.state.characters).find(c => c.playerId === window.__gwf.ctx.me); return { pets: c.pets.map(p => p.name), active: c.activePetId, hatching: !!c.hatching, err: window.__gwf.session.state.lastError }; }));
await mover.screenshot({ path: shots + 'phone-pets-2-card.png' });
// rename
await mover.click('.pet-card button[aria-label="rename"]'); await mover.fill('.pet-card input[aria-label="nickname"]', 'Biscuit'); await mover.click('.pet-card button:has-text("Keep")'); await sleep(300);
console.log('pet card text', (await mover.locator('.pet-card').first().innerText()).slice(0, 300));
// ── Letters: other writes to mover (off-turn, 1 allowed)
await other.click('nav.tabs button:has-text("Letters")'); await sleep(400);
await other.click('.subtabs button:has-text("Write")'); await sleep(300);
await other.click('.recipients button'); await other.fill('.compose textarea', 'Meet me at the Blood Bank. Bring Gold.');
await other.screenshot({ path: shots + 'phone-letters-1-compose.png' });
await other.click('button:has-text("Send by crow")'); await sleep(500);
console.log('letters', await other.evaluate(() => ({ n: window.__gwf.session.state.letters.length, off: window.__gwf.session.state.offTurnLetters, err: window.__gwf.session.state.lastError?.message })));
await other.click('.subtabs button:has-text("Sent")'); await sleep(300);
await other.screenshot({ path: shots + 'phone-letters-2-outbox.png' });
// second off-turn letter should be refused; alliance proposal from the mover (on turn, unlimited)
await mover.click('nav.tabs button:has-text("Letters")'); await sleep(300); await mover.click('.subtabs button:has-text("Write")'); await sleep(200);
await mover.click('.recipients button'); await mover.click('button:has-text("Propose an alliance")'); await mover.click('button:has-text("Send the proposal")'); await sleep(500);
// force delivery: end turns a few times via engine (mover ends turn; other ends; ...)
for (let i = 0; i < 5; i++) { const cur = await gm.evaluate(() => { const s = window.__gwf.session.state; return s.seats[s.turnIdx % s.seats.length]; }); await gm.evaluate((pid) => window.__gwf.session.dispatch('TURN_END', {}, pid), cur); await sleep(250); }
await mover.click('nav.tabs button:has-text("Cage")'); await sleep(200); await mover.click('nav.tabs button:has-text("Letters")'); await sleep(500);
console.log('inbox mover', await mover.evaluate(() => window.__gwf.session.state.letters.map(l => ({ to: l.toId, kind: l.kind, delivered: !!l.deliveredAt }))));
await mover.screenshot({ path: shots + 'phone-letters-3-inbox.png' });
await other.click('nav.tabs button:has-text("Cage")'); await sleep(200); await other.click('nav.tabs button:has-text("Letters")'); await sleep(500);
await other.screenshot({ path: shots + 'phone-letters-4-proposal.png' });
const acc = other.locator('button:has-text("Accept the alliance")');
if (await acc.count()) { await acc.click(); await sleep(500); console.log('alliances', await other.evaluate(() => window.__gwf.session.state.alliances)); await other.screenshot({ path: shots + 'phone-letters-5-allied.png' }); }
console.log('errors', errors);
await browser.close(); dev.close();
