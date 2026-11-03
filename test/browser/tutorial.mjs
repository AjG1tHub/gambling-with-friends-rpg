// The phone tutorial in a browser: one phone against the built site, no dev server (the practice run uses the
// local backend inside the page). The coach card shows on the join → lobby → creation screens and advances, ? opens
// the help sheet with "This screen", and /phone/?practice=1 reaches phase 'playing' with three seats; the human
// gambles a stat, locks in, readies, plods and stops, ends a turn; the practice room has the tutorial opening on
// (handlers/ramp.js), so turn 1 hides the attack panel and shows the ramp card and teaser, the gear and fight goals
// are taken or skipped on turns 2 and 3, and the duel is called on a bot (walked over by the practice GM only once
// the human's turn 4 allows a challenge), Highest Card plays and the duel settles; "You know enough" returns to the
// join screen. Screenshots: test/shots/tutorial-*.png. `npm run build` first; `node test/browser/tutorial.mjs`.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { startServer } from './serve.mjs';

const shotDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const T0 = Date.now();
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, msg, arg = undefined, timeout = 10000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) { if (msg) console.log('  ✓', msg); return true; } await sleep(100); } throw new Error(`TIMEOUT: ${msg}`); }
const shot = (page, name) => page.screenshot({ path: `${shotDir}tutorial-${name}.png` }).catch(() => {});
async function step(name, fn) { console.log(`\n▶ ${name}`); try { await fn(); } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } }
async function clickWhen(page, sel, msg = '', timeout = 15000) {
  const loc = (typeof sel === 'string' ? page.locator(sel) : sel).first();
  try { await loc.click({ timeout }); }
  catch (e) { if (!/Timeout|intercepts pointer events/.test(e.message)) throw e; await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.evaluate(el => el.click()); console.log('  · (DOM click after a pointer timeout)'); }
  if (msg) console.log('  ·', msg);
}
setTimeout(() => { console.error('WATCHDOG: the tutorial run ran past 5 minutes'); process.exit(1); }, 5 * 60 * 1000).unref();

const { server, url } = await startServer(0);
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
phoneCtx.setDefaultTimeout(15000);
const ph = await phoneCtx.newPage();
ph.on('pageerror', (e) => console.log('  [pageerror]', e.message));
let failed = false;
const coachStep = () => ph.evaluate(() => document.querySelector('.coach-slot .coach:not(.rule)')?.dataset.step || null);
const goal = () => ph.evaluate(() => window.__gwf?.practice?.goal(window.__gwf.session.state)?.id || null);
const view = () => ph.evaluate(() => {
  const s = window.__gwf.session.state, me = window.__gwf.ctx.me;
  const c = Object.values(s.characters).find(x => x.playerId === me) || null;
  const ms = s.moveSession && s.moveSession.playerId === me && !s.moveSession.done ? s.moveSession : null;
  const ch = s.challenge && !s.challenge.done ? s.challenge : null, f = s.fight && !s.fight.done ? s.fight : null;
  return { me, phase: s.phase, mover: s.moverId, turnIdx: s.turnIdx, turnPhase: s.turnPhase, moved: !!c?.usedThisTurn?.moved, dead: !!c?.dead, hatching: !!c?.hatching, pos: c?.pos,
    session: ms ? { movesLeft: ms.movesLeft, stepsTaken: ms.stepsTaken, atomic: !!ms.atomic } : null,
    prompt: s.pendingPrompt && s.pendingPrompt.playerId === me ? s.pendingPrompt.kind : null,
    fight: f && (f.playerId === me || (f.playerIds || []).includes(me)) ? { turn: f.turn, game: !!(f.game && !f.game.result), mine: f.playerId === me } : null,
    challenge: ch && (ch.attackerId === me || ch.defenderId === me) ? { role: ch.attackerId === me ? 'attacker' : 'defender', spun: !!ch.spun, entry: ch.entry?.id || null, answered: !!ch.defenderAnswered } : null,
    held: !!(s.held[me] && !s.held[me].owedWait), goal: window.__gwf.practice.goal(s)?.id || null, progress: { ...window.__gwf.practice.progress },
    rampTurn: s.turnCounts?.[me] || 0, rampOn: !!s.gm.ramp?.on, attackPanel: !!document.querySelector('.ph-sect button.danger.big'), teaser: document.querySelector('.ramp-line')?.textContent || '' };
});
// One tap towards the current goal; returns after at most one click.
async function act(v) {
  if (v.hatching) { await clickWhen(ph, '.pet-wheel', 'keeps a pet'); return; }
  if (v.challenge) {
    if (v.challenge.role === 'defender') { const bare = ph.locator('button:has-text("Bare hands")'); if (await bare.count()) await bare.first().click(); const acc = ph.locator('button:has-text("Accept")'); if (await acc.count()) await acc.first().click(); }
    else if (!v.challenge.spun) { const spin = ph.locator('.prompt button:has-text("Spin")'); if (await spin.count()) { await spin.first().click(); console.log('  · spins the Challenge Wheel'); } }
    const draw = ph.locator('button:has-text("Draw")'); if (await draw.count()) { await draw.first().click(); console.log('  · draws a card'); }
    const won = ph.locator('.btn-grid button.primary.big'); if (v.challenge.spun && await won.count() && (await ph.locator('text=Who won?').count())) await won.first().click();
    return;
  }
  if (v.mover !== v.me || v.held) return;
  if (v.prompt === 'spin') return clickWhen(ph, '.prompt button.primary.big:has-text("Spin")', 'spins the tile wheel');
  if (v.prompt === 'portal') { const stay = ph.locator('.prompt button:has-text("Stay here")'); if (await stay.count()) return stay.first().click(); return clickWhen(ph, '.prompt .col button'); }
  if (v.prompt === 'arena') return clickWhen(ph, '.prompt button:has-text("Walk on")');
  if (v.prompt === 'takeWorn') return clickWhen(ph, '.prompt button:has-text("Take nothing")');
  if (v.fight) {
    if (v.fight.turn === 'monster' || !v.fight.mine) return;
    if (v.fight.game) { const accept = ph.locator('.mg-buttons button:has-text("Accept")'); if (await accept.count()) return accept.first().click(); const any = ph.locator('.mg-buttons button:not([disabled]), .mg-grid button:not([disabled])'); if (await any.count()) return any.first().click(); return; }
    const back = ph.locator('button:has-text("Back away")').first(); if (await back.isEnabled().catch(() => false)) return back.click(); return clickWhen(ph, 'button:has-text("End turn")');
  }
  if (v.dead) return clickWhen(ph, 'button:has-text("Pass")');
  if (v.turnPhase === 'move') {
    if (!v.session) { if (v.moved) return clickWhen(ph, 'button:has-text("End turn")'); return clickWhen(ph, '.prompt button.primary.big', 'plods', 8000); }
    if (v.session.atomic) return clickWhen(ph, '.btn-grid button.primary');
    await ph.locator('.rosette').first().waitFor({ timeout: 8000 });
    const steps = ph.locator('.rosette .hexbtn.ok:not(.hot)'), hub = ph.locator('.rosette .hub:not([disabled])');
    if (v.session.stepsTaken === 0 && await steps.count()) return steps.first().click();
    if (await hub.count()) return hub.first().click();
    if (await steps.count()) return steps.first().click();
    return;
  }
  if (v.turnPhase === 'resolve') return;
  // action phase
  // gear (turn 2) and fight (turn 3): take the lesson when the map offers it, else skip it once the ramp has reached that step
  if (v.goal === 'gear' || v.goal === 'fight') {
    const buy = ph.locator('.ph-sect button:has-text("BUY"):not([disabled])'); if (v.goal === 'gear' && await buy.count()) { await buy.first().click(); console.log('  · buys from the shelf'); return; }
    const atk = ph.locator('.ph-sect button:has-text("ATTACK"):not([disabled])'); if (v.goal === 'fight' && await atk.count()) { await atk.first().click(); console.log('  · attacks the monster'); return; }
    const skip = ph.locator('.coach-goal button:has-text("Skip")'); if (await skip.count()) { await skip.first().click(); console.log(`  · skips ${v.goal} (turn ${v.rampTurn})`); return; }
  }
  if (v.goal === 'duel') {
    const duelBtn = ph.locator('.ph-sect button.danger.big:has-text("Duel")');
    if (await duelBtn.count() && await duelBtn.first().isEnabled()) { const chip = ph.locator('.chips button.chip:has-text("Duel")'); if (await chip.count()) await chip.first().click(); await duelBtn.first().click(); console.log('  · calls a Duel on the bot'); return; }
    if (v.rampTurn < 4) return clickWhen(ph, 'button.end-turn', `ends turn ${v.rampTurn} (the duel waits for turn 4)`);
    return;   // the practice GM is walking a bot over
  }
  return clickWhen(ph, 'button.end-turn', 'ends the turn');
}

try {
  await step('a real lobby: the coach card, Got it, and a 📖 broadcast as a card', async () => {
    // A TV tab on the local backend makes a room with one bot; a phone tab in the same context joins it by code.
    const tv = await phoneCtx.newPage();
    await tv.setViewportSize({ width: 1280, height: 720 });
    await tv.goto(`${url}/?backend=local&bots=1`);
    await waitFor(tv, () => !!window.__gwf?.session && Object.keys(window.__gwf.session.state.players).length === 1, 'TV made a local room with a bot', undefined, 20000);
    const code = await tv.evaluate(() => window.__gwf.session.code);
    await ph.goto(`${url}/phone/?code=${code}&backend=local`);
    await ph.fill('input[placeholder="Your name at the table"]', 'Aj');
    await ph.click('button:has-text("Sit down")');
    await waitFor(ph, () => !!window.__gwf?.ctx?.me, 'Aj sat down');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'lobby', 'the coach shows the lobby card');
    ok((await ph.locator('.coach .coach-ok').count()) === 1, 'with a Got it button');
    await shot(ph, 'a0-real-lobby');
    await ph.click('.coach .coach-ok');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'bug', 'Got it: the card advances to the 🐞 step');
    ok(await ph.evaluate(() => (JSON.parse(localStorage.getItem('gwfrpg:coach:v1') || '[]')).includes('lobby')), 'the dismissal is remembered on the device');
    await ph.click('.coach .coach-ok');
    await waitFor(ph, () => !document.querySelector('.coach-slot .coach'), 'both lobby cards dismissed: no card');
    // the GM teaches: a 📖 broadcast becomes a card, not a toast
    await tv.evaluate(() => window.__gwf.session.dispatch('GM_BROADCAST', { text: '📖 A turn: Roll, step, resolve the hex, then End turn.' }, 'gm'));
    await waitFor(ph, () => !!document.querySelector('.coach-slot .coach.rule'), 'the 📖 broadcast shows as a rule card');
    ok(/A turn/.test(await ph.locator('.coach.rule .coach-title').textContent()) && /then End turn/.test(await ph.locator('.coach.rule .coach-text').textContent()), 'title and text split at the colon');
    ok((await ph.locator('.toast').count()) === 0, 'and no toast for it');
    await shot(ph, 'a1-rule-card');
    await ph.click('.coach.rule .coach-ok');
    await waitFor(ph, () => !document.querySelector('.coach-slot .coach.rule'), 'Got it dismisses the rule card');
    await tv.evaluate(() => window.__gwf.session.dispatch('GM_BROADCAST', { text: 'Pizza is here' }, 'gm'));
    await waitFor(ph, () => !!document.querySelector('.toast'), 'an ordinary broadcast is still a toast');
    // Self tab: Show tips again brings the lobby card back
    await ph.click('.tabs button:has-text("Self")');
    await clickWhen(ph, '.coach-panel button:has-text("Show tips again")', 'Self › Show tips again');
    await ph.click('.tabs button:has-text("Play")');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'lobby', 'the lobby card is back');
    await tv.close();
  });

  await step('join screen → Learn to play → lobby with the coach', async () => {
    await ph.goto(`${url}/phone/`);
    ok((await ph.locator('button:has-text("Learn to play")').count()) === 1, 'the join screen offers Learn to play');
    await shot(ph, '00-join');
    await ph.click('button:has-text("Learn to play")');
    await waitFor(ph, () => !!window.__gwf?.practice && window.__gwf.session.state.phase === 'lobby', 'the practice room is open', undefined, 20000);
    await waitFor(ph, () => Object.keys(window.__gwf.session.state.players).length === 3, 'three seats: the human and two bots');
    ok(/practice=1/.test(ph.url()), 'URL carries ?practice=1');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'lobby', 'the coach card shows the lobby step');
    ok((await ph.locator('.banner.practice-tag').count()) === 1, 'PRACTICE tag in the header');
    ok(/Practice 1 \/ \d+/.test(await ph.locator('.coach-goal .tag').textContent()), 'the practice goal rides under the step');
    ok((await ph.locator('.coach .coach-ok').count()) === 0, 'tutorial mode: no Got it');
    await shot(ph, '01-lobby-coach');
  });

  await step('? opens the help sheet', async () => {
    await ph.click('.top .help-btn');
    await waitFor(ph, () => !!document.querySelector('.help-sheet'), 'the help sheet is open');
    const text = await ph.locator('.help-sheet').textContent();
    ok(/This screen/.test(text) && /The lobby/.test(text), '"This screen" explains the lobby');
    ok(/A turn in 30 seconds/.test(text) && /Glossary/.test(text) && /rules in 10 cards/i.test(text), 'the turn, the 10 cards and the glossary are listed');
    ok((await ph.locator('.help-sheet button:has-text("Quit practice")').count()) === 1, 'Quit practice is offered');
    await shot(ph, '02-help');
    await ph.click('.help-sheet .help-close');
    await waitFor(ph, () => !document.querySelector('.help-sheet'), 'the help sheet closes');
  });

  await step('ready → creation → one gamble → lock in → ready → the run starts', async () => {
    await ph.click('button:has-text("Tap when ready")');
    await waitFor(ph, () => window.__gwf.session.state.phase === 'creation', 'creation opened on its own', undefined, 15000);
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'creation.look', 'the coach advanced to the Look step');
    await ph.fill('input[placeholder="Character name"]', 'Pupil');
    await ph.click('button:has-text("That is me")');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'creation.class', 'coach: Class');
    await clickWhen(ph, ph.locator('button.class-card', { hasText: 'Whale' }), 'picks Whale');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'creation.gamble', 'coach: the stat gamble');
    ok((await goal()) === 'gamble', 'practice goal: gamble');
    await shot(ph, '03-creation-gamble');
    await clickWhen(ph, 'button.stat-chip:has-text("Luck")');
    await clickWhen(ph, 'button.chip:has-text("50/50")');
    await clickWhen(ph, 'button.primary.big:has-text("Play for Luck")', 'stakes a chip on the 50/50 Wheel');
    await clickWhen(ph, '.mg-buttons button:has-text("SPIN")', 'SPIN');
    await waitFor(ph, () => { const c = Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me); return (c?.creation?.gambles?.length || 0) >= 1; }, 'the gamble settled', undefined, 20000);
    await waitFor(ph, () => window.__gwf.practice.goal(window.__gwf.session.state)?.id === 'lock', 'practice goal: lock in');
    await clickWhen(ph, ph.getByRole('button', { name: /^Lock in( with .*)? →$/ }));
    await clickWhen(ph, ph.getByRole('button', { name: '🔒 Lock in' }), 'locks in');
    await waitFor(ph, () => window.__gwf.practice.goal(window.__gwf.session.state)?.id === 'ready', 'practice goal: ready (the lobby Ready was taken back)');
    await waitFor(ph, () => document.querySelector('.coach-slot .coach')?.dataset.step === 'creation.ready', 'coach: Ready');
    await clickWhen(ph, 'button:has-text("Tap when ready")', 'ready');
    await waitFor(ph, () => window.__gwf.session.state.phase === 'playing', 'the run started', undefined, 30000);
    const st = await ph.evaluate(() => { const s = window.__gwf.session.state; return { seats: s.seats.length, hexes: Object.keys(s.map?.hexes || {}).length, lastCall: s.balance?.table?.lastCallMinutes, fog: s.gm.fogOfWar, preset: s.gm.challengePreset }; });
    ok(st.seats === 3 && st.hexes > 20, `three seats on a map of ${st.hexes} hexes`);
    ok(st.lastCall === 20 && st.fog === false && st.preset === 'inperson', 'short room: Last Call 20 min, no fog, In Person list');
    await shot(ph, '04-playing');
  });

  await step('a move, an end turn, a duel on a bot, the result', async () => {
    const t0 = Date.now(); let last = null, seen = new Set(), spun = false, firstTurn = null, duelTurn = null;
    ok((await view()).rampOn, 'the practice room has the tutorial opening on');
    while (Date.now() - t0 < 220000) {
      const v = last = await view();
      if (v.phase !== 'playing') throw new Error(`the run ended early: ${v.phase}`);
      const cs = await coachStep(); if (cs && !seen.has(cs)) { seen.add(cs); console.log(`  · coach: ${cs} · goal: ${v.goal}`); }
      if (v.goal === 'move' && v.mover === v.me && !spun) { await shot(ph, '05-first-turn'); spun = true; }
      // turn 1, action phase: no attack panel, the ramp teaser under the buttons
      if (v.mover === v.me && v.rampTurn === 1 && v.turnPhase === 'action' && !firstTurn) { firstTurn = { attackPanel: v.attackPanel, teaser: v.teaser }; await shot(ph, '05b-first-action'); }
      if (v.challenge?.role === 'attacker' && duelTurn == null) duelTurn = v.rampTurn;
      if (v.goal === 'result' && v.challenge?.spun) await shot(ph, '06-duel');
      if (v.goal === 'done') break;
      await act(v);
      await sleep(350);
    }
    ok(last.goal === 'done', `every practice goal done: ${JSON.stringify(last.progress)}`);
    ok(last.progress.moved && last.progress.turnsEnded >= 1, 'the human moved and ended a turn');
    ok(last.progress.duelCalled && last.progress.duelSettled, 'a duel against a bot was called and settled');
    ok(firstTurn && !firstTurn.attackPanel && /Next turn: shops and your Cage unlock/.test(firstTurn.teaser), `turn 1 hid the attack panel and teased turn 2 (${JSON.stringify(firstTurn)})`);
    ok(seen.has('ramp.move'), 'the ramp card for the first turn showed');
    ok(duelTurn == null || duelTurn >= 4, `the duel was called on the human's turn ${duelTurn} (ramp: challenge on turn 4)`);
    const lc = await ph.evaluate(() => { const s = window.__gwf.session.state; return { entry: s.lastChallenge?.entry?.id, winner: s.lastChallenge?.winnerId, how: s.lastChallenge?.how }; });
    ok(lc.entry === 'highestcard', `the practice wheel was rigged to Highest Card (winner ${lc.winner || 'draw'}, ${lc.how})`);
    ok(seen.has('waiting') && [...seen].some(s => s.startsWith('ramp.')), `coach steps seen: ${[...seen].join(', ')}`);
    await shot(ph, '07-done');
  });

  await step('You know enough → back to the join screen', async () => {
    await clickWhen(ph, '.coach-done', 'taps You know enough');
    await waitFor(ph, () => /join the table/i.test(document.body.innerText) && !/practice=1/.test(location.search), 'back on the join screen', undefined, 15000);
    ok(await ph.evaluate(() => localStorage.getItem('gwfrpg:practice:v1') == null), 'the practice record is cleared');
    await shot(ph, '08-join-again');
  });

  console.log(`\nTUTORIAL RUN PASSED in ${Math.round((Date.now() - T0) / 1000)} s`);
} catch (e) {
  failed = true; console.error('\n✗', e.message);
  await ph.screenshot({ path: `${shotDir}tutorial-fail.png` }).catch(() => {});
} finally {
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
}
