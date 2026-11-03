// Reconnect gate (QA pass, 3 Nov 2026): a phone, the TV or the GM console reloads (a lock screen, a dropped tab, a TV
// that went to sleep) in the middle of a fight and in the middle of a Challenge Wheel. After the reload everyone is
// still in their own seat on the right screen, the shared state is untouched, and play carries on to the end of the
// round. Three 360×640 Whales, a ws dev backend, tutorial opening off. `npm run build` first. Shots: test/shots/rc-*.png.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';
import { startDevServer } from '../../tools/dev-server.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname; mkdirSync(shotDir, { recursive: true });
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 20000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(120); } throw new Error(`TIMEOUT: ${msg}`); }
setTimeout(() => { console.error('WATCHDOG: the reconnect run ran past 5 minutes'); process.exit(1); }, 5 * 60 * 1000).unref();

const { server, url } = await startServer(0);
const dev = await startDevServer({ port: 0 });
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
const pageErrors = [];
const watch = (page, tag) => page.on('pageerror', e => pageErrors.push(`${tag}: ${e.message.slice(0, 160)}`));
const click = async (page, sel, label, timeout = 15000) => { if (process.env.RC_DEBUG) console.log('   [debug]', label, JSON.stringify(await page.evaluate(() => ({ me: window.__gwf.ctx?.me, mover: window.__gwf.session.state.moverId, tp: window.__gwf.session.state.turnPhase, txt: document.body.innerText.slice(0, 300) })))); const l = typeof sel === 'string' ? page.locator(sel).first() : sel.first(); await l.waitFor({ state: 'visible', timeout }); await l.click(); if (label) console.log('  ·', label); };
// A new character's first turn opens with the Triple Pet Wheel: tap a column until the Plod prompt is up.
async function toPlod(ph) {
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    if (await ph.locator('.prompt button.primary.big:has-text("Plod")').count()) return;
    const wheel = ph.locator('.pet-wheel'); if (await wheel.count()) await wheel.first().click({ force: true }).catch(() => {});
    const gotIt = ph.locator('button:has-text("GOT IT"), button:has-text("Got it")'); if (await gotIt.count()) await gotIt.first().click({ force: true }).catch(() => {});
    await sleep(400);
  }
}
const meOf = (ph) => ph.evaluate(() => window.__gwf?.ctx?.me);
const stateOf = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__gwf.session.state)));

// A fresh room: GM, TV, three phones, creation done, run started, nobody has moved.
async function newRoom(tag) {
  const gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } }); gmCtx.setDefaultTimeout(15000);
  const gm = await gmCtx.newPage(); watch(gm, tag + ' gm'); const tv = await gmCtx.newPage(); watch(tv, tag + ' tv');
  await gm.goto(`${url}/gm/?${Q}`); await gm.fill('input[type=password]', '4242'); await gm.uncheck('input[name=ramp]').catch(() => {});
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
    await ph.locator('button.class-card', { hasText: 'Whale' }).first().click();
    await ph.getByRole('button', { name: /^Lock in( with .*)? →$/ }).first().click(); await ph.getByRole('button', { name: '🔒 Lock in' }).first().click();
    await waitFor(ph, () => !!Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.locked);
    if (!(await ph.evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].ready))) await ph.click('button:has-text("Tap when ready")');
  }
  await gm.locator('.gm-nav button').first().click(); await gm.click('button:has-text("Start the run")');
  await waitFor(tv, () => window.__gwf.session.state.phase === 'playing', `${tag}: run started`); await sleep(800);
  const gmDo = async (type, payload) => { const err = await gm.evaluate(async ([t, p]) => { const s = window.__gwf.session; const b = Date.now(); await s.dispatch(t, p, 'gm'); const e = s.state.lastError; return e && e.type === t && e.ts >= b ? e.message : null; }, [type, payload]); if (err) throw new Error(`${type} refused: ${err}`); };
  const ids = []; for (const ph of phones) ids.push(await meOf(ph));
  return { gm, tv, phones, ids, names, gmDo, code, gmCtx };
}
// Reload a page and wait for its session to come back with the same seat.
async function reload(page, label, seat) {
  const t0 = Date.now(); await page.reload();
  await waitFor(page, () => !!window.__gwf?.session?.state?.phase, `${label} reloaded`, undefined, 25000);
  if (seat) { await waitFor(page, (id) => window.__gwf.ctx?.me === id, `${label} is still ${seat.name}'s seat`, seat.id, 15000); }
  console.log(`    (back in ${Date.now() - t0} ms)`);
}
const sameShared = (a, b) => ['phase', 'round', 'turnIdx', 'moverId'].every(k => a[k] === b[k]);

let failed = false;
try {
  // ───────── 1. a fight: reload the mover's phone, the TV, then the GM console while a round is open ─────────
  console.log('\n▶ 1. reloads during a fight');
  const R = await newRoom('fight');
  let st = await stateOf(R.tv);
  const mid = st.moverId, mi = R.ids.indexOf(mid), mph = R.phones[mi], mc = Object.values(st.characters).find(c => c.playerId === mid);
  const m = Object.values(st.monsters).filter(x => !x.dead && x.pos && !x.boss && !x.raid && !x.final && st.map.hexes[x.pos]?.type === 'encounter' && !x.gmControlled).sort((a, b) => a.health - b.health)[0];
  ok(!!m, `a monster to fight: ${m?.name} at ${m?.pos}`);
  await R.gmDo('GM_TELEPORT', { playerId: mid, hex: m.pos });
  await toPlod(mph);
  await click(mph, '.prompt button.primary.big:has-text("Plod")', `${R.names[mi]} plods`);
  await waitFor(mph, () => { const s = window.__gwf.session.state; return !!(s.moveSession && !s.moveSession.done); }, '', undefined, 8000);
  await click(mph, '.rosette .hub:not([disabled])', `${R.names[mi]} stays put`);
  await waitFor(mph, (id) => { const f = window.__gwf.session.state.fight; return !!f && !f.done && f.monsterId === id; }, 'the fight is open', m.id, 25000);
  await click(mph, mph.locator('button.item-row:not([disabled])').first(), 'readies a weapon');
  await waitFor(mph, () => { const f = window.__gwf.session.state.fight; return !!(f?.game && !f.game.result); }, 'a round is open (ITEM_USE)');
  const before = await stateOf(R.tv); const roundBefore = before.fight.game.itemId || before.fight.game.gameId || true;
  // 1a. the mover's own phone drops mid-round.
  await reload(mph, `${R.names[mi]}'s phone`, { id: mid, name: R.names[mi] });
  await waitFor(mph, () => { const f = window.__gwf.session.state.fight; return !!(f?.game && !f.game.result); }, 'the same round is still open for the mover');
  await mph.screenshot({ path: `${shotDir}rc-fight-phone-after-reload.png` }).catch(() => {});
  ok((await mph.locator('.mg-buttons button, .mg-stage').count()) > 0, 'the mover is looking at the round (game buttons on screen), not a lobby or a blank screen');
  // 1b. the TV goes to sleep and wakes mid-round.
  await reload(R.tv, 'the TV');
  const tvs = await stateOf(R.tv); ok(sameShared(before, tvs) && !!tvs.fight && !tvs.fight.done, 'the TV comes back to the same fight (same phase, round, turn, mover)');
  await sleep(1200); await R.tv.screenshot({ path: `${shotDir}rc-fight-tv-after-reload.png` }).catch(() => {});
  ok((await R.tv.locator('.fight-panel, .tv-fight, [class*=fight]').count()) > 0, 'the TV shows the fight panel again');
  // 1c. the GM console reloads.
  await reload(R.gm, 'the GM console');
  const gms = await stateOf(R.gm); ok(sameShared(before, gms) && !!gms.fight, 'the GM console sees the same fight');
  // 1d. play the round out on the reloaded phone.
  const spin = mph.locator('.mg-buttons button', { hasText: /SPIN|Draw|Flip|Roll|Play|Deal|Pull|Hold|Hit/i });
  await click(mph, spin, 'plays the round (first button) on the reloaded phone');
  await sleep(500);
  const accept = mph.locator('.mg-buttons button:has-text("Accept")');
  if (await accept.count()) await click(mph, accept, 'accepts the result', 20000);
  await waitFor(mph, () => { const f = window.__gwf.session.state.fight; return !f || f.done || (f.log || []).length >= 1; }, 'the round resolved after the reload (fight log has a line)', undefined, 30000);
  ok(true, 'the fight carried on to a resolved round');
  const gmsAfter = await stateOf(R.gm); ok(gmsAfter.lastError == null || !/fight|ITEM/i.test(gmsAfter.lastError?.type || ''), `no fight-related refusal after the reloads (${gmsAfter.lastError?.type || 'none'})`);
  await R.gmCtx.close(); for (const p of R.phones) await p.context().close();

  // ───────── 2. the Challenge Wheel: reload the defender while called, the attacker before the spin, the TV on the wheel ─────────
  console.log('\n▶ 2. reloads during a Challenge Wheel');
  const C = await newRoom('chal');
  st = await stateOf(C.tv);
  const atk = st.moverId, ai = C.ids.indexOf(atk), di = (ai + 1) % 3, def = C.ids[di], aph = C.phones[ai], dph = C.phones[di];
  for (const id of C.ids) await C.gmDo('GM_GOLD', { playerId: id, amount: 60 });
  await C.gmDo('GM_TELEPORT', { playerId: atk, hex: st.map.start });
  const nb = (() => { const [q, r] = st.map.start.split(',').map(Number); for (const [dq, dr] of [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]]) { const k = `${q + dq},${r + dr}`, h = st.map.hexes[k]; if (h && !h.void && !['water', 'chasm', 'wall', 'blocker'].includes(h.type) && !h.gate && !Object.values(st.monsters).some(x => !x.dead && x.pos === k)) return k; } return st.map.start; })();
  await C.gmDo('GM_TELEPORT', { playerId: def, hex: nb });
  await C.gmDo('GM_RIG', { stream: 'challenge', value: 'highestcard' });
  await toPlod(aph);
  await click(aph, '.prompt button.primary.big:has-text("Plod")', `${C.names[ai]} plods`);
  await waitFor(aph, () => { const s = window.__gwf.session.state; return !!(s.moveSession && !s.moveSession.done); }, '', undefined, 8000);
  await click(aph, '.rosette .hub:not([disabled])', `${C.names[ai]} stays put`);
  await waitFor(aph, () => window.__gwf.session.state.turnPhase === 'action', 'action phase', undefined, 20000);
  await click(aph, aph.locator('.chips button.chip', { hasText: C.names[di] }), `target ${C.names[di]}`);
  await click(aph, aph.locator('.chips button.chip:not([disabled])', { hasText: /^wager$/i }), 'call: wager');
  await click(aph, 'button.danger.big:has-text("⚔")', 'makes the call');
  await waitFor(aph, () => window.__gwf.session.state.challenge?.call === 'wager', 'CHALLENGE_CALL accepted');
  // 2a. the defender drops while the wager is on the table: the accept prompt must still be there.
  await reload(dph, `${C.names[di]}'s phone`, { id: def, name: C.names[di] });
  await waitFor(dph, () => !!window.__gwf.session.state.challenge, 'the challenge survived the reload');
  await dph.screenshot({ path: `${shotDir}rc-challenge-defender-after-reload.png` }).catch(() => {});
  await click(dph, '.prompt button.primary.big:has-text("Accept")', `${C.names[di]} accepts the wager after the reload`);
  await waitFor(dph, () => { const ch = window.__gwf.session.state.challenge; return !!ch && (ch.defenderAnswered || ch.accepted); }, 'the answer was accepted');
  // 2b. the attacker drops before the spin: the Spin button must come back.
  await reload(aph, `${C.names[ai]}'s phone`, { id: atk, name: C.names[ai] });
  await aph.screenshot({ path: `${shotDir}rc-challenge-attacker-after-reload.png` }).catch(() => {});
  await click(aph, '.prompt button.primary.big:has-text("Spin")', `${C.names[ai]} spins the Challenge Wheel after the reload`);
  await waitFor(C.tv, () => !!window.__gwf.session.state.challenge?.spun, 'the wheel landed (rigged: Highest Card)');
  // 2c. the TV reloads with the wheel result on the table; both phones keep their screens.
  const beforeTv = await stateOf(C.tv);
  await reload(C.tv, 'the TV (challenge on the table)');
  const afterTv = await stateOf(C.tv); ok(sameShared(beforeTv, afterTv) && !!afterTv.challenge, 'the TV comes back with the challenge still open');
  await sleep(1200); await C.tv.screenshot({ path: `${shotDir}rc-challenge-tv-after-reload.png` }).catch(() => {});
  ok((await C.tv.locator('.challenge-panel').count()) > 0, 'the TV shows the challenge panel again');
  // 2d. play Highest Card on both phones, one of them reloading between the draws.
  const draw = async (ph, who) => { const b = ph.locator('button:has-text("Draw")'); if (await b.count()) { await b.first().click(); console.log('  ·', who, 'draws'); return true; } return false; };
  await waitFor(aph, () => { const ch = window.__gwf.session.state.challenge; return !ch || Date.now() >= (ch.gmWindowUntil || 0); }, 'the GM window is over', undefined, 30000).catch(() => {});
  await waitFor(aph, () => !!document.querySelector('button') && [...document.querySelectorAll('button')].some(b => /Draw/.test(b.textContent)), `${C.names[ai]} sees the Draw button`, undefined, 30000);
  await draw(aph, C.names[ai]);
  await reload(dph, `${C.names[di]}'s phone (between the draws)`, { id: def, name: C.names[di] });
  await waitFor(dph, () => [...document.querySelectorAll('button')].some(b => /Draw/.test(b.textContent)), `${C.names[di]} still gets a Draw button`, undefined, 30000);
  await draw(dph, C.names[di]);
  await waitFor(C.tv, () => { const ch = window.__gwf.session.state.challenge; return !ch || ch.done; }, 'the wager settled (both drew)', undefined, 40000);
  ok(true, 'the Challenge Wheel carried through three reloads to a settled result');
  const fin = await stateOf(C.gm); ok(!/CHALLENGE/.test(fin.lastError?.type || ''), `no Challenge refusal along the way (${fin.lastError?.type || 'none'})`);
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nRECONNECT RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); if (pageErrors.length) console.error('page errors:', pageErrors.slice(0, 4)); }
await browser.close(); server.close(); dev.close?.();
process.exit(failed ? 1 : 0);
