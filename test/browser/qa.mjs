// QA flow in the browser (UI-CHEATSHEET.md › QA): a GM console, a TV and two phones against the built site and the
// ws dev backend. Phone A reports a bug through the 🐞 sheet, the GM rewards it from the Bugs & rewards panel,
// phone A shows the secret wheel with the exact message and the result (and never re-animates it on reload),
// phone B shows nothing, the TV log has no reward line and the TV DOM has no wheel or label for it. The GM's own
// report line, the status select, the notes field and the "Reward a seat" box are exercised too.
// Screenshots: test/shots/qa-*.png. `npm run build` first; `node test/browser/qa.mjs`.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';
import { startDevServer } from '../../tools/dev-server.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const T0 = Date.now();
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 10000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(100); } throw new Error(`TIMEOUT: ${msg}`); }
const stateOf = (page) => page.evaluate(() => window.__gwf?.session?.state || null);
const shot = (page, name) => page.screenshot({ path: `${shotDir}qa-${name}.png` }).catch(() => {});
async function step(name, fn) { console.log(`\n▶ ${name}`); try { await fn(); } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } }
setTimeout(() => { console.error('WATCHDOG: the QA run ran past 3 minutes'); process.exit(1); }, 3 * 60 * 1000).unref();

const MESSAGE = 'You get a secret reward for helping squash a bug. Don’t tell anyone 🤫';
const { server, url } = await startServer(0);
const dev = await startDevServer({ port: 0 });
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
const pc = await browser.newContext({ viewport: { width: 1600, height: 900 } });
pc.setDefaultTimeout(15000);
const newPhone = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); c.setDefaultTimeout(15000); return c.newPage(); };
const pages = {};
let failed = false;
try {
  const gm = pages.gm = await pc.newPage(); gm.on('dialog', d => d.accept());
  const tv = pages.tv = await pc.newPage();
  let code = '', seatA = '', seatB = '';
  const phA = pages.phoneA = await newPhone(), phB = pages.phoneB = await newPhone();

  await step('room, TV, two phones, one character', async () => {
    await gm.goto(`${url}/gm/?${Q}`);
    await gm.fill('input[type=password]', '4242');
    await gm.click('button:has-text("Create room")');
    await waitFor(gm, () => !!window.__gwf?.session, 'GM created the room');
    code = await gm.evaluate(() => window.__gwf.session.code);
    await tv.setViewportSize({ width: 1920, height: 1080 });
    await tv.goto(`${url}/?code=${code}&${Q}`);
    await waitFor(tv, () => !!window.__gwf?.session, 'TV opened the room');
    for (const [ph, name] of [[phA, 'Aj'], [phB, 'Nick']]) {
      await ph.goto(`${url}/phone/?code=${code}&${Q}`);
      await ph.fill('input[placeholder="Your name at the table"]', name);
      await ph.click('button:has-text("Sit down")');
      await waitFor(ph, () => !!window.__gwf?.ctx?.me, `${name} sat down`);
    }
    seatA = await phA.evaluate(() => window.__gwf.ctx.me); seatB = await phB.evaluate(() => window.__gwf.ctx.me);
    ok((await phA.locator('.top .bug-btn').count()) === 1, 'the 🐞 button is in the phone top bar in the lobby');
    // A character for Aj (the reward needs one); Nick stays without.
    await gm.click('button:has-text("Open character creation")');
    await waitFor(phA, () => window.__gwf.session.state.phase === 'creation', 'creation is open');
    await phA.fill('input[placeholder="Character name"]', 'Ajax');
    await phA.click('button:has-text("That is me")');
    await waitFor(phA, () => Object.values(window.__gwf.session.state.characters).some(c => c.name === 'Ajax'), 'Ajax exists');
    ok((await phA.locator('.top .bug-btn').count()) === 1, 'the 🐞 button is still there during creation (not my turn)');
  });

  await step('phone A reports a bug through the sheet', async () => {
    await phA.click('.top .bug-btn');
    await phA.locator('.bug-sheet textarea.bug-text').waitFor();
    const where = (await phA.locator('.bug-sheet .bug-where').innerText()).trim();
    ok(/^Play · creation/.test(where), `the sheet shows the screen and phase: "${where}"`);
    await phA.fill('.bug-sheet textarea.bug-text', 'The crest picker skipped a crest');
    // the draft survives a re-render (any event redraws the phone)
    await gm.evaluate(() => window.__gwf.session.dispatch('GM_BROADCAST', { text: 'hello table' }, 'gm')).catch(() => {});
    await sleep(400);
    ok((await phA.locator('.bug-sheet textarea.bug-text').inputValue()) === 'The crest picker skipped a crest', 'the draft survives a re-render');
    await shot(phA, '01-phone-sheet');
    await phA.click('.bug-sheet button.bug-send');
    await waitFor(phA, () => (window.__gwf.session.state.bugReports || []).length === 1, 'BUG_REPORT landed in state.bugReports');
    await phA.locator('.toast', { hasText: 'the House owes you one' }).waitFor({ timeout: 4000 });
    ok(true, 'the thank-you toast showed');
    ok((await phA.locator('.bug-sheet').count()) === 0, 'the sheet closed');
    const b = (await stateOf(tv)).bugReports[0];
    ok(b.playerId === seatA && b.screen === 'Play' && b.text === 'The crest picker skipped a crest' && b.status === 'open', `report by ${b.name} on ${b.screen}: "${b.text}"`);
    ok(b.context && b.context.tab === 'play' && b.context.phase === 'creation' && b.context.myTurn === false && b.context.fight === false && b.context.challenge === false, `context ${JSON.stringify(b.context)}`);
    ok((await gm.locator('.gm-nav button:has-text("Bugs & rewards") .dot').innerText()).trim() === '1', 'the Bugs tab shows a badge of 1');
  });

  await step('the GM rewards it from the Bugs panel', async () => {
    await gm.click('.gm-nav button:has-text("Bugs & rewards")');
    await gm.locator('table.gm.bugs tr[data-bug]').first().waitFor();
    ok(/1 report, 1 open/i.test(await gm.locator('.gm-main h2').first().innerText()), 'the heading counts the report');
    await shot(gm, '02-gm-bugs');
    await gm.click('table.gm.bugs tr[data-bug] button:has-text("Reward")');
    await waitFor(gm, (pid) => !!window.__gwf.session.state.secretSpins?.[pid], 'GM_BUG_REWARD wrote state.secretSpins[A]', seatA);
    const st = await stateOf(gm), r = st.secretSpins[seatA];
    ok(r.message === MESSAGE && Array.isArray(r.outcomes) && r.outcomes[r.index] === r.label && r.seen === false, `secret spin: ${r.label} (index ${r.index} of ${r.outcomes.length}), unseen`);
    ok(st.bugReports[0].status === 'rewarded' && st.bugReports[0].reward?.label === r.label, 'the report is marked rewarded');
    ok(!st.lastSpin || st.lastSpin.wheel !== 'bugreward', 'no state.lastSpin for the secret wheel');
    await gm.locator('.reward-spin .wheel').first().waitFor();
    ok((await gm.locator('.reward-spin .wheel .wheel-face path[data-index]').count()) === r.outcomes.length, 'the console draws a wheel with one segment per outcome');
    await shot(gm, '03-gm-wheel-spinning');
  });

  await step('phone A sees the secret wheel; phone B and the TV see nothing', async () => {
    const r = (await stateOf(gm)).secretSpins[seatA];
    await phA.locator('.qa-reward').waitFor();
    ok((await phA.locator('.qa-reward .reward-note').innerText()).trim() === MESSAGE, 'the exact message sits at the top of the overlay');
    ok((await phA.locator('.qa-reward .wheel .wheel-face path[data-index]').count()) === r.outcomes.length, 'the wheel has one segment per outcome');
    if (!(await phA.locator('.qa-reward.landed').count())) ok(await phA.locator('.qa-reward button.reward-ok').isDisabled(), 'Got it is disabled while the wheel turns');
    ok((await phA.locator('.tabs').count()) === 1, 'the tabs are still there under the overlay');
    await shot(phA, '05-phone-wheel-spinning');
    await gm.locator('.reward-spin.landed').first().waitFor({ timeout: 8000 });
    ok((await gm.locator('.reward-spin.landed .reward-label').first().evaluate(e => e.textContent)).trim() === r.label, `the console wheel landed on "${r.label}"`);
    ok(/waiting for the phone/.test(await gm.locator('.reward-row').first().innerText()), 'the console says the phone has not shown it yet');
    await shot(gm, '04-gm-wheel-landed');
    await phA.locator('.qa-reward.landed').waitFor({ timeout: 8000 });
    ok((await phA.locator('.qa-reward .reward-label').evaluate(e => e.textContent)).trim() === r.label, `the phone reveals "${r.label}"`);
    ok((await phA.locator('.qa-reward .reward-text').innerText()).trim() === (r.text || ''), `and the text "${r.text}"`);
    await shot(phA, '06-phone-wheel-landed');
    ok((await phB.locator('.qa-reward').count()) === 0, 'phone B shows no overlay');
    ok(!(await phB.evaluate(() => document.body.innerText)).includes('secret reward'), 'phone B has no reward text');
    await shot(phB, '07-phone-b');
    const tvState = await stateOf(tv);
    ok(tvState.log.some(l => /reports a bug/.test(l.text)), 'the TV log has the report line');
    ok(!tvState.log.some(l => l.text.includes(r.label) || /reward/i.test(l.text)), 'the TV log has no reward line');
    const tvText = await tv.evaluate(() => document.body.innerText);
    ok(!tvText.includes(r.label) && !tvText.includes('secret reward') && !/Bug Reward/i.test(tvText), 'the TV DOM never shows the label or the message');
    ok((await tv.locator('.wheel, .wheel-overlay, .qa-reward').count()) === 0, 'the TV DOM has no wheel');
    await shot(tv, '08-tv');
    // The reward id was remembered: a reload shows the wheel already landed, no second animation.
    await phA.reload();
    await waitFor(phA, () => !!window.__gwf?.ctx?.me, 'phone A reloaded');
    await phA.locator('.qa-reward').waitFor();
    ok(await phA.locator('.qa-reward.landed').count() === 1, 'after a reload the overlay is already landed (no re-animation)');
    ok(!(await phA.locator('.qa-reward button.reward-ok').isDisabled()), 'Got it is enabled at once');
    await phA.click('.qa-reward button.reward-ok');
    await waitFor(phA, (pid) => window.__gwf.session.state.secretSpins[pid].seen === true, 'BUG_REWARD_SEEN: seen is true', seatA);
    ok((await phA.locator('.qa-reward').count()) === 0, 'the overlay is gone');
    await phA.reload();
    await waitFor(phA, () => !!window.__gwf?.ctx?.me, 'phone A reloaded again');
    await sleep(500);
    ok((await phA.locator('.qa-reward').count()) === 0, 'a seen reward never shows again');
    await gm.locator('.reward-row', { hasText: 'seen on phone' }).first().waitFor();
    ok(true, 'the console shows the "seen on phone" tick');
    await shot(gm, '09-gm-seen');
  });

  await step('GM report line, status, notes, Reward a seat', async () => {
    await gm.click('.gm-nav .gm-report button:has-text("Report a bug")');
    await gm.fill('.gm-nav .gm-report textarea', 'The Monsters panel scrolls under the nav');
    await gm.click('.gm-nav .gm-report button:has-text("Send")');
    await waitFor(gm, () => (window.__gwf.session.state.bugReports || []).length === 2, 'the GM report is in state');
    const st = await stateOf(gm), g = st.bugReports[1];
    ok(g.playerId === null && g.name === 'GM' && g.screen === 'GM', `GM report: ${g.name} on ${g.screen}`);
    ok((await gm.locator('.gm-nav button:has-text("Bugs & rewards") .dot').innerText()).trim() === '1', 'badge counts the one open report');
    const row = gm.locator(`table.gm.bugs tr[data-bug="${g.id}"]`);
    ok(await row.locator('button:has-text("Reward")').isDisabled(), 'Reward is disabled for a report with no character (the GM)');
    await row.locator('select').selectOption('fixed');
    await waitFor(gm, (id) => window.__gwf.session.state.bugReports.find(b => b.id === id)?.status === 'fixed', 'GM_BUG_STATUS set it to fixed', g.id);
    await row.locator('input[aria-label="notes"]').fill('fixed in the next build');
    await row.locator('input[aria-label="notes"]').press('Enter');
    await waitFor(gm, (id) => window.__gwf.session.state.bugReports.find(b => b.id === id)?.notes === 'fixed in the next build', 'GM_BUG_STATUS saved the notes on blur', g.id);
    ok((await gm.locator('.gm-nav button:has-text("Bugs & rewards") .dot').count()) === 0, 'no badge once nothing is open');
    // Reward a seat: Nick has no character, so only Aj can be picked.
    const opts = await gm.locator('.gm-main select[aria-label="seat"] option').evaluateAll(os => os.map(o => ({ text: o.textContent, disabled: o.disabled })));
    ok(opts.some(o => /Nick/.test(o.text) && o.disabled) && opts.some(o => /^Aj$/.test(o.text) && !o.disabled), 'the seat picker greys out the seat with no character');
    await gm.locator('.gm-main select[aria-label="seat"]').selectOption(seatA);
    await gm.click('.gm-main button:has-text("Spin 🎡")');
    await waitFor(gm, (pid) => window.__gwf.session.state.bugRewards.length === 2 && window.__gwf.session.state.secretSpins[pid].seen === false, 'a second secret spin for Aj (no report)', seatA);
    await phA.locator('.qa-reward').waitFor();
    ok((await phA.locator('.qa-reward .reward-note').innerText()).trim() === MESSAGE, 'phone A shows the second reward');
    await gm.click('button:has-text("Copy all as Markdown")');
    await gm.locator('.toast', { hasText: 'Copied as Markdown' }).waitFor({ timeout: 3000 });
    ok(true, 'Copy all as Markdown toasts');
    await shot(gm, '10-gm-after');
  });
  console.log(`\nQA FLOW PASSED in ${Math.round((Date.now() - T0) / 1000)}s`);
} catch (e) {
  failed = true; console.error(e);
  for (const [name, p] of Object.entries(pages)) {
    await p.screenshot({ path: shotDir + `qa-fail-${name}.png` }).catch(() => {});
    const v = await p.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200), err: window.__gwf?.session?.state?.lastError || null })).catch(() => null);
    console.error(`  ${name}:`, JSON.stringify(v));
  }
} finally {
  await browser.close(); server.close(); dev.close();
}
process.exit(failed ? 1 : 0);
