// Browser gate: TV + GM console + four phones against the built site (`npm run build` first) and the ws dev backend
// (`?backend=ws&ws=…`), each phone in its own Chromium context like a real handset. The run goes well past the lobby:
//   0. room, join ×4, drop/rejoin, kick, start, pause/resume
//   1. creation: Look → Class → a stat gamble → Lock in → Ready on every phone, then the GM starts the run
//   2. a lap of the map: ~8 turns of plod / step / stop / end turn from the mover's phone
//   3. a fight: the mover on a monster hex, Coin Blade played through SPIN → Accept, the TV plays the monster
//   4. the Challenge Wheel: a Duel (hosted Highest Card), a Wager (external, "Who won?"), a Robbery
//   5. a letter by crow, delivered two of the recipient's turns later
//   6. a death by the hand of the house, the Graveyard, the skipped turn
//   7. the GM ends the run: the TV recap, the phone recap, one item into the vault
// Every step asserts and screenshots into test/shots/gate-NN-*.png; a failure screenshots every page as fail-*.png.
// Exits non-zero on any failure. `npm run test:browser`.
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
const shot = (page, name) => page.screenshot({ path: `${shotDir}gate-${name}.png` }).catch(() => {});
async function step(name, fn) { console.log(`\n▶ ${name}`); try { await fn(); } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } }
// Click the first match of a selector/locator, waiting for it to appear and be enabled.
async function clickWhen(page, sel, msg = '', timeout = 15000) { const loc = (typeof sel === 'string' ? page.locator(sel) : sel).first(); await loc.click({ timeout }); if (msg) console.log('  ·', msg); }
// Whole-run watchdog: the gate must finish in well under six minutes.
setTimeout(() => { console.error('WATCHDOG: the gate ran past 6 minutes'); process.exit(1); }, 6 * 60 * 1000).unref();

const { server, url } = await startServer(0);
const dev = await startDevServer({ port: 0 });
const Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
// The preinstalled Chromium when the pinned Playwright build is absent (the cloud workspace), else Playwright's own.
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
// The PC: one context for the GM console and the TV. Every phone gets its own context (its own storage).
const pc = await browser.newContext({ viewport: { width: 1600, height: 900 } });
pc.setDefaultTimeout(15000);
const newPhone = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); c.setDefaultTimeout(15000); return c.newPage(); };
const pages = {};
let failed = false;
try {
  // ════════════════════════════════════════ 0. lobby ═══════════════════════════════════════════════
  const gm = pages.gm = await pc.newPage();
  gm.on('dialog', d => d.accept());   // the console confirms kicks, starts and the end of the run
  const tv = pages.tv = await pc.newPage();
  const phones = [];
  const seat = {};        // phone index → player id
  const phoneOf = (pid) => phones[Object.values(seat).indexOf(pid)];
  const nameOfSeat = {};  // player id → name
  let code = '';
  await step('0. room, join, drop, rejoin, kick', async () => {
    await gm.goto(`${url}/gm/?${Q}`);
    await gm.fill('input[type=password]', '4242');
    await gm.click('button:has-text("Create room")');
    await waitFor(gm, () => !!window.__gwf?.session, 'GM created the room');
    code = await gm.evaluate(() => window.__gwf.session.code);
    ok(/^[A-Z]{4}$/.test(code), `room code ${code}`);
    await shot(gm, '00-gm-console');

    await tv.setViewportSize({ width: 1920, height: 1080 });
    await tv.goto(`${url}/?code=${code}&${Q}`);
    await waitFor(tv, () => !!window.__gwf?.session, 'TV opened the room');
    ok((await tv.locator('.join .code').innerText()).trim() === code, 'TV shows the join code and QR');
    await shot(tv, '01-tv-lobby-empty');

    const names = ['Aj', 'Nick', 'Sam', 'Vin'];
    for (let i = 0; i < 4; i++) {
      const ph = await newPhone();
      await ph.goto(`${url}/phone/?code=${code}&${Q}`);
      await ph.fill('input[placeholder="Your name at the table"]', names[i]);
      await ph.click('button:has-text("Sit down")');
      await waitFor(ph, () => !!window.__gwf?.ctx?.me, `phone ${i} (${names[i]}) sat down`);
      phones.push(ph); pages['phone' + i] = ph;
      seat[i] = await ph.evaluate(() => window.__gwf.ctx.me); nameOfSeat[seat[i]] = names[i];
    }
    await waitFor(tv, () => Object.keys(window.__gwf.session.state.players).length === 4, 'TV sees four players');
    await shot(tv, '02-tv-lobby-four');
    await shot(phones[0], '03-phone-lobby');
    for (const ph of phones) await ph.click('button:has-text("Tap when ready")');
    await waitFor(gm, () => Object.values(window.__gwf.session.state.players).every(p => p.ready), 'everyone ready');

    // drop a phone and rejoin: same seat, no GM action
    const nameBefore = await phones[2].evaluate(() => window.__gwf.session.state.players[window.__gwf.ctx.me].name);
    await phones[2].reload();
    await waitFor(phones[2], () => !!window.__gwf?.ctx?.me, 'phone 2 rejoined after reload');
    ok((await phones[2].evaluate(() => window.__gwf.ctx.me)) === seat[2], `reload keeps the seat (${nameBefore})`);
    ok((await stateOf(gm)).players[seat[2]].connected === true, 'seat is connected again');
    // proxy from the GM, then a reconnect lifts it
    await gm.evaluate((pid) => window.__gwf.session.dispatch('GM_PROXY', { playerId: pid, on: true }, 'gm'), seat[2]);
    await waitFor(phones[2], (pid) => window.__gwf.session.state.players[pid]?.proxied === true, 'phone 2 sees itself proxied', seat[2]);
    await phones[2].reload();
    await waitFor(gm, (pid) => window.__gwf.session.state.players[pid]?.proxied === false, 'reconnect lifted the proxy', seat[2]);

    // GM kicks phone 3
    await gm.click('tr:has-text("Vin") button:has-text("Kick")');
    await waitFor(phones[3], () => /removed/i.test(document.body.innerText), 'kicked phone sees it was removed');
    ok(!(await stateOf(tv)).seats.includes(seat[3]), 'TV no longer lists the kicked seat');
    await shot(gm, '04-gm-table');
  });
  const live = () => phones.slice(0, 3);

  // ── shared helpers for the run ───────────────────────────────────────────────────────────────────
  // Dispatch as the GM from the console page and surface a refusal as a thrown error.
  async function gmDo(type, payload) {
    const err = await gm.evaluate(async ([t, p]) => { const s = window.__gwf.session; const before = Date.now(); await s.dispatch(t, p, 'gm'); const e = s.state.lastError; return e && e.type === t && e.ts >= before ? e.message : null; }, [type, payload]);
    if (err) throw new Error(`${type} refused: ${err}`);
  }
  const compact = (page) => page.evaluate(() => { const s = window.__gwf.session.state; return { phase: s.phase, mover: s.moverId, turnIdx: s.turnIdx, turnPhase: s.turnPhase, round: s.round }; });
  const charOf = (st, pid) => Object.values(st.characters).find(c => c.playerId === pid) || null;
  // What the mover's phone is looking at, as data.
  const turnView = (ph) => ph.evaluate(() => {
    const s = window.__gwf.session.state, me = window.__gwf.ctx.me;
    const c = Object.values(s.characters).find(x => x.playerId === me) || null;
    const ms = s.moveSession && s.moveSession.playerId === me && !s.moveSession.done ? s.moveSession : null;
    const f = s.fight && !s.fight.done ? s.fight : null, ch = s.challenge && !s.challenge.done ? s.challenge : null;
    return { me, phase: s.phase, mover: s.moverId, turnIdx: s.turnIdx, turnPhase: s.turnPhase, pos: c?.pos || null, dead: !!c?.dead, moved: !!c?.usedThisTurn?.moved, hatching: !!c?.hatching,
      prompt: s.pendingPrompt && (s.pendingPrompt.playerId === me || s.pendingPrompt.targetId === me) ? { kind: s.pendingPrompt.kind, mine: s.pendingPrompt.playerId === me, source: s.pendingPrompt.source || null } : null,
      fight: f ? { playerId: f.playerId, turn: f.turn, game: !!(f.game && !f.game.result), kind: f.kind } : null,
      session: ms ? { movesLeft: ms.movesLeft, stepsTaken: ms.stepsTaken, atomic: !!ms.atomic, awaiting: ms.awaiting || null } : null,
      challenge: !!(ch && (ch.attackerId === me || ch.defenderId === me)), held: !!s.held[me] && !s.held[me].owedWait, lastError: s.lastError && Date.now() - s.lastError.ts < 3000 ? `${s.lastError.type}: ${s.lastError.message}` : null };
  });
  async function answerPrompt(ph, pr) {
    if (pr.kind === 'spin') return clickWhen(ph, '.prompt button.primary.big:has-text("Spin")', 'spins the tile wheel');
    if (pr.kind === 'portal') { const stay = ph.locator('.prompt button:has-text("Stay here")'); if (await stay.count()) return clickWhen(ph, stay, 'stays off the portal'); return clickWhen(ph, '.prompt .col button', 'takes the portal'); }
    if (pr.kind === 'arena') return clickWhen(ph, '.prompt button:has-text("Walk on")', 'walks past the Arena');
    if (pr.kind === 'takeWorn') return clickWhen(ph, '.prompt button:has-text("Take nothing")', 'takes nothing from the fallen');
    if (pr.kind === 'callout') { const b = ph.locator('.prompt button:has-text("Noted")'); if (await b.count()) return b.first().click(); return sleep(300); }
    return sleep(300);
  }
  // Click through whatever minigame controls are showing (Accept first, then the primary button, then any button).
  async function playRoundButtons(ph) {
    const accept = ph.locator('.mg-buttons button:has-text("Accept")');
    if (await accept.count()) return accept.first().click();
    const primary = ph.locator('.mg-buttons button.primary:not([disabled])');
    if (await primary.count()) return primary.first().click();
    const any = ph.locator('.mg-buttons button:not([disabled]), .mg-grid button:not([disabled])');
    if (await any.count()) return any.first().click();
    return sleep(300);
  }
  // Play the mover's turn from their phone by clicking the real screens until the turn ends (or a challenge /
  // the end of the run takes over). Monster hexes are avoided unless asked for.
  async function playTurn(ph, { label = 'turn', timeoutMs = 60000, avoidMonsters = true } = {}) {
    const t0 = Date.now(); let idle = 0, last = null;
    while (Date.now() - t0 < timeoutMs) {
      const v = last = await turnView(ph);
      if (v.phase !== 'playing') return v;
      if (v.hatching) { await clickWhen(ph, '.pet-wheel', 'keeps a pet from the Triple Pet Wheel'); await sleep(250); continue; }
      if (v.challenge) return v;
      if (v.mover !== v.me) return v;
      if (v.prompt && v.prompt.mine) { await answerPrompt(ph, v.prompt); await sleep(300); continue; }
      if (v.fight && v.fight.playerId === v.me) {
        if (v.fight.turn === 'monster') { await sleep(300); continue; }
        if (v.fight.game) { await playRoundButtons(ph); await sleep(300); continue; }
        const back = ph.locator('button:has-text("Back away")').first();
        if (await back.isEnabled().catch(() => false)) await back.click(); else await clickWhen(ph, 'button:has-text("End turn")');
        await sleep(300); continue;
      }
      if (v.dead) { await clickWhen(ph, 'button:has-text("Pass")', `${label}: passes (dead)`); await sleep(300); continue; }
      if (v.turnPhase === 'move') {
        if (!v.session) {
          if (v.moved) { await clickWhen(ph, 'button:has-text("End turn")'); await sleep(300); continue; }
          await clickWhen(ph, '.prompt button.primary.big', '', 8000);   // Plod / Roll / Spin / Draw / a mode
          await sleep(300); continue;
        }
        if (v.session.atomic) { await clickWhen(ph, '.btn-grid button.primary', 'jumps to a lit hex'); await sleep(300); continue; }
        await ph.locator('.rosette').first().waitFor({ timeout: 8000 });
        const steps = ph.locator(avoidMonsters ? '.rosette .hexbtn.ok:not(.hot)' : '.rosette .hexbtn.ok');
        const hub = ph.locator('.rosette .hub:not([disabled])');
        if (v.session.movesLeft > 0 && await steps.count()) await steps.first().click();
        else if (await hub.count()) await hub.first().click();
        else if (await ph.locator('.rosette .hexbtn.ok').count()) await ph.locator('.rosette .hexbtn.ok').first().click();
        else await sleep(300);
        await sleep(300); continue;
      }
      if (v.turnPhase === 'resolve') { if (++idle > 25) await clickWhen(ph, 'button:has-text("End turn anyway")'); else await sleep(300); continue; }
      await clickWhen(ph, 'button.end-turn'); await sleep(300);
      return { ...v, ended: true };
    }
    throw new Error(`${label}: playTurn timed out at ${JSON.stringify(last)}`);
  }
  // End the current turn from the mover's phone and wait for the next seat.
  async function nextTurn(label = 'turn') {
    const before = await compact(tv);
    if (!before.mover) { await waitFor(tv, () => !!window.__gwf.session.state.moverId, `${label}: table resumes`); return nextTurn(label); }
    await playTurn(phoneOf(before.mover), { label });
    await waitFor(tv, (n) => window.__gwf.session.state.turnIdx > n || window.__gwf.session.state.phase !== 'playing', `${label}: turn ${before.turnIdx + 1} → ${before.turnIdx + 2}`, before.turnIdx, 20000);
    return compact(tv);
  }
  // Get the mover to the action phase on the spot (plod, stay put, answer the tile) without moving off the hex.
  async function stayPut(ph, label) {
    await clickWhen(ph, '.prompt button.primary.big:has-text("Plod")', `${label}: plods`);
    await waitFor(ph, () => { const s = window.__gwf.session.state; return !!(s.moveSession && !s.moveSession.done); }, '', undefined, 8000);
    await clickWhen(ph, '.rosette .hub:not([disabled])', `${label}: stays put`);
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { const v = await turnView(ph); if (v.turnPhase === 'action' || v.fight || v.mover !== v.me) return v; if (v.hatching) await clickWhen(ph, '.pet-wheel'); else if (v.prompt?.mine) await answerPrompt(ph, v.prompt); await sleep(250); }
    throw new Error(`${label}: never reached the action phase`);
  }
  const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
  const landable = (h) => !!h && !h.void && !['water', 'chasm', 'wall', 'blocker'].includes(h.type);
  const monsterOn = (st, key) => Object.values(st.monsters).some(m => !m.dead && m.pos === key);
  const neighbourHex = (st, key) => { const [q, r] = key.split(',').map(Number); for (const [dq, dr] of DIRS) { const k = `${q + dq},${r + dr}`; const h = st.map.hexes[k]; if (landable(h) && !monsterOn(st, k) && !h.gate) return k; } return null; };

  // ════════════════════════════════════════ 1. creation ════════════════════════════════════════════
  await step('1. creation on every phone', async () => {
    await gm.click('button:has-text("Open character creation")');
    await waitFor(tv, () => window.__gwf.session.state.phase === 'creation', 'creation is open');
    const plan = [['Ajax', 'Whale'], ['Nickel', 'Enforcer'], ['Samson', 'Pit Boss']];
    for (let i = 0; i < 3; i++) {
      const ph = live()[i], [cname, klass] = plan[i], tag = `phone ${i}`;
      // Look
      await ph.fill('input[placeholder="Character name"]', cname);
      await ph.click('button[aria-label="next hair"]');
      await ph.click('.crests .crest-btn >> nth=3');
      if (i === 0) await shot(ph, '10-creation-look');
      await ph.click('button:has-text("That is me")');
      await waitFor(ph, (n) => Object.values(window.__gwf.session.state.characters).some(c => c.name === n), `${tag}: ${cname} exists`, cname);
      // Class
      await clickWhen(ph, ph.locator('button.class-card', { hasText: klass }), `${tag}: picks ${klass}`);
      await waitFor(ph, () => { const s = window.__gwf.session.state; return !!Object.values(s.characters).find(c => c.playerId === window.__gwf.ctx.me)?.classId; }, `${tag}: class set`);
      if (i === 1) await shot(ph, '11-creation-class');
      // Stats: one round of the 50/50 Wheel for Luck, 1 chip
      await clickWhen(ph, 'button.stat-chip:has-text("Luck")');
      await clickWhen(ph, 'button.chip:has-text("50/50")');
      await clickWhen(ph, 'button.primary.big:has-text("Play for Luck")', `${tag}: stakes a chip on the 50/50 Wheel`);
      await clickWhen(ph, '.mg-buttons button:has-text("SPIN")', `${tag}: SPIN`);
      if (i === 0) await sleep(400), await shot(ph, '12-creation-gamble');
      await waitFor(ph, () => { const c = Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me); return (c?.creation?.gambles?.length || 0) >= 1; }, `${tag}: the gamble settled (CHAR_STAT_GAMBLE)`, undefined, 20000);
      // Lock in
      await clickWhen(ph, ph.getByRole('button', { name: /^Lock in( with .*)? →$/ }), `${tag}: to the Lock in step`);
      await clickWhen(ph, ph.getByRole('button', { name: '🔒 Lock in' }), `${tag}: locks in`);
      await waitFor(ph, () => !!Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.locked, `${tag}: character is locked`);
      // Ready: the seat was readied in the lobby, so toggle it off and on through the real button.
      await clickWhen(ph, 'button:has-text("tap to unready")');
      await waitFor(ph, () => window.__gwf.session.state.players[window.__gwf.ctx.me].ready === false, `${tag}: unready`);
      await clickWhen(ph, 'button:has-text("Tap when ready")');
      await waitFor(ph, () => window.__gwf.session.state.players[window.__gwf.ctx.me].ready === true, `${tag}: ready`);
      if (i === 2) await shot(ph, '13-creation-locked');
    }
    const st = await stateOf(gm);
    for (let i = 0; i < 3; i++) { const c = charOf(st, seat[i]); ok(c && c.locked && c.classId && c.creation.gambles.length >= 1, `${plan[i][0]} is locked as a ${c?.classId} with ${c?.creation.gambles.length} gamble(s), L${c?.stats.luck} N${c?.stats.nerve} G${c?.stats.greed} T${c?.stats.grit}`); }
    await shot(tv, '14-tv-creation');
    await gm.click('button:has-text("Start the run")');
    await waitFor(tv, () => window.__gwf.session.state.phase === 'playing', 'run started');
    const st2 = await stateOf(tv);
    ok(st2.seats.length === 3 && st2.map && Object.keys(st2.map.hexes).length > 20, `three seats, a map of ${Object.keys(st2.map.hexes).length} hexes`);
    ok(live().every((_, i) => charOf(st2, seat[i]).pos === st2.map.start), 'everyone stands on the start hex');
    await shot(tv, '20-tv-playing');
    // pause from the GM freezes the clocks, resume restarts them
    await gm.click('button:has-text("Pause")');
    await waitFor(tv, () => window.__gwf.session.state.gm.paused === true, 'paused');
    await gm.click('button:has-text("Resume")');
    await waitFor(tv, () => window.__gwf.session.state.gm.paused === false, 'resumed');
  });

  // ════════════════════════════════════════ 2. a lap of the map ════════════════════════════════════
  await step('2. a lap of the map (8 turns)', async () => {
    const start = await compact(tv);
    const posBefore = Object.fromEntries(Object.values((await stateOf(tv)).characters).map(c => [c.id, c.pos]));
    for (let t = 0; t < 8; t++) {
      const cur = await compact(tv);
      if (cur.phase !== 'playing') break;
      const ph = phoneOf(cur.mover);
      if (t < 2) { // the first turns open on the Triple Pet Wheel (the run-start egg); keep one, then the move screen
        for (let k = 0; k < 3 && (await turnView(ph)).hatching; k++) { await clickWhen(ph, '.pet-wheel', `${nameOfSeat[cur.mover]} keeps a pet from the Triple Pet Wheel`); await sleep(300); }
        if (t === 0) { await ph.locator('.prompt button.primary.big').first().waitFor(); await shot(ph, '21-phone-move'); }
        if (t === 1) { await clickWhen(ph, '.prompt button.primary.big:has-text("Plod")'); await ph.locator('.rosette').first().waitFor(); await shot(ph, '22-phone-rosette'); }
      }
      const v = await playTurn(ph, { label: `lap turn ${t + 1} (${nameOfSeat[cur.mover]})` });
      if (v.challenge) throw new Error('a challenge opened during the lap');
      await waitFor(tv, (n) => window.__gwf.session.state.turnIdx > n, `turn ${cur.turnIdx + 1} ended by ${nameOfSeat[cur.mover]}`, cur.turnIdx, 20000);
    }
    const st = await stateOf(tv);
    ok(st.turnIdx >= start.turnIdx + 8, `turnIdx advanced ${start.turnIdx} → ${st.turnIdx}`);
    const moved = Object.values(st.characters).filter(c => c.pos !== posBefore[c.id]);
    ok(moved.length >= 2, `${moved.length} of 3 characters changed position (${moved.map(c => `${c.name}@${c.pos}`).join(', ')})`);
    ok(st.round >= 2, `round ${st.round}`);
    await shot(tv, '23-tv-after-lap');
  });

  // ════════════════════════════════════════ 3. a fight ═════════════════════════════════════════════
  await step('3. a fight on an encounter hex', async () => {
    let cur = await compact(tv);
    if (cur.turnPhase !== 'move') cur = await nextTurn('before the fight');
    const st = await stateOf(tv);
    const mover = cur.mover, ph = phoneOf(mover), c = charOf(st, mover);
    const m = Object.values(st.monsters).filter(x => !x.dead && x.pos && !x.boss && !x.raid && !x.final && st.map.hexes[x.pos]?.type === 'encounter' && !x.gmControlled).sort((a, b) => a.health - b.health)[0];
    ok(!!m, `a living monster to fight: ${m?.name} (${m?.health} Health) at ${m?.pos}`);
    // The hand of the house puts the mover on the monster's hex; staying put there opens the encounter.
    await gmDo('GM_TELEPORT', { playerId: mover, hex: m.pos });
    await waitFor(ph, (k) => Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.pos === k, `${c.name} teleported to ${m.pos}`, m.pos);
    await stayPut(ph, c.name);
    await waitFor(ph, (id) => { const f = window.__gwf.session.state.fight; return !!f && !f.done && f.monsterId === id; }, `the fight with ${m.name} is open`, m.id);
    await shot(ph, '30-fight-open');
    // Coin Blade (the 50/50 Wheel): SPIN, then Accept the held result; ITEM_RESOLVE goes out when it settles.
    await clickWhen(ph, ph.locator('button.item-row:not([disabled])', { hasText: 'Coin Blade' }), `${c.name} readies Coin Blade`);
    await waitFor(ph, () => { const f = window.__gwf.session.state.fight; return !!(f?.game && !f.game.result); }, 'the round is open (ITEM_USE)');
    await clickWhen(ph, '.mg-buttons button:has-text("SPIN")', 'SPIN');
    await sleep(300); await shot(ph, '31-fight-round');
    await clickWhen(ph, '.mg-buttons button:has-text("Accept")', 'Accept', 20000);
    await waitFor(ph, () => { const f = window.__gwf.session.state.fight; return !!f && f.log.length >= 1; }, 'the hit resolved (ITEM_RESOLVE in the fight log)', undefined, 25000);
    await waitFor(tv, (id) => { const s = window.__gwf.session.state; const f = s.fight; return (!!f && (f.exchanges || 0) >= 1) || (!!f && f.done) || !!s.monsters[id]?.dead || !f; }, 'the TV played the monster\'s turn (MONSTER_ACT) or the fight ended', m.id, 25000);
    const after = await stateOf(tv);
    const f = after.fight || after.lastFight;
    const log = after.fight?.log || [];
    ok(log.length >= 1 && log.some(l => l.by === c.id), `fight log has ${log.length} line(s), one by ${c.name}: ${log.map(l => `${l.by === c.id ? c.name : m.name} ${l.label} ${l.damage ? '-' + l.damage : l.loss ? 'lost ' + l.loss : ''}`).join(' | ')}`);
    ok(after.monsters[m.id].health < m.health || log.some(l => l.by === c.id && !l.damage), `${m.name} at ${after.monsters[m.id].health}/${m.maxHealth}`);
    await shot(ph, '32-fight-log'); await shot(tv, '33-tv-fight');
    // Leave the fight (Back away) and end the turn from the phone.
    await playTurn(ph, { label: 'fight turn' });
    await waitFor(tv, (n) => window.__gwf.session.state.turnIdx > n, 'the fight turn ended', cur.turnIdx, 20000);
  });

  // ════════════════════════════════════════ 4. the Challenge Wheel ═════════════════════════════════
  await step('4. Duel, Wager and Robbery on the Challenge Wheel', async () => {
    for (let i = 0; i < 3; i++) await gmDo('GM_GOLD', { playerId: seat[i], amount: 60 });   // Wagers and Robberies need Gold on both sides
    const played = {};
    for (const [call, entryId] of [['duel', 'highestcard'], ['wager', 'rps5'], ['robbery', 'highestcard']]) {
      let cur = await compact(tv);
      if (cur.turnPhase !== 'move' || !cur.mover) cur = await nextTurn(`before the ${call}`);
      let st = await stateOf(tv);
      const atk = cur.mover, ac = charOf(st, atk);
      // A defender the attacker has not played this entry with: the wheel never repeats an entry for a pair.
      const fresh = (id) => !(st.challengeHistory?.[[atk, id].sort().join('|')] || []).includes(entryId);
      const cands = st.seats.filter(id => id !== atk && !charOf(st, id)?.dead && !(st.held[id] && !st.held[id].owedWait));
      const def = cands.find(fresh) || cands[0];
      ok(!!def, `${call}: ${nameOfSeat[atk]} challenges ${nameOfSeat[def]}`);
      const aph = phoneOf(atk), dph = phoneOf(def);
      // Both on the start hex's neighbourhood, a hex apart, the attacker off any monster.
      await gmDo('GM_TELEPORT', { playerId: atk, hex: st.map.start });
      await gmDo('GM_TELEPORT', { playerId: def, hex: neighbourHex(st, st.map.start) || st.map.start });
      await gmDo('GM_RIG', { stream: 'challenge', value: entryId });
      await stayPut(aph, ac.name);
      // The attack panel: target, call, (weapon), the red button.
      await clickWhen(aph, aph.locator('.chips button.chip', { hasText: nameOfSeat[def] }), `target ${nameOfSeat[def]}`);
      await clickWhen(aph, aph.locator('.chips button.chip:not([disabled])', { hasText: new RegExp(`^${call}$`, 'i') }), `call: ${call}`);
      await clickWhen(aph, 'button.danger.big:has-text("⚔")', `${ac.name} makes the call`);
      await waitFor(aph, (k) => window.__gwf.session.state.challenge?.call === k, `CHALLENGE_CALL accepted (${call})`, call);
      if (call === 'duel') await shot(aph, '40-duel-call');
      // The defender answers: a Wager is accepted, a Duel or Robbery picks a weapon (or bare hands).
      if (call === 'wager') await clickWhen(dph, '.prompt button.primary.big:has-text("Accept")', `${nameOfSeat[def]} accepts the wager`);
      else { const w = dph.locator('.ph-sect button.item-row'); if (await w.count()) await clickWhen(dph, w, `${nameOfSeat[def]} picks a weapon`); else await clickWhen(dph, 'button:has-text("Bare hands")', `${nameOfSeat[def]} goes bare-handed`); }
      await waitFor(dph, () => { const ch = window.__gwf.session.state.challenge; return !!ch && (ch.defenderAnswered || ch.accepted); }, 'the defender answered');
      await clickWhen(aph, '.prompt button.primary.big:has-text("Spin")', `${ac.name} spins the Challenge Wheel`);
      await waitFor(tv, (e) => { const ch = window.__gwf.session.state.challenge; return !!ch?.spun && ch.entryId === e; }, `the wheel lands on ${entryId} (rigged)`, entryId);
      await shot(tv, call === 'duel' ? '44-tv-challenge' : `44-tv-${call}`);
      // Play it: Highest Card on both phones, or the "Who won?" report for an external entry; both agree.
      const until = Date.now() + 40000;
      while (Date.now() < until) {
        st = await stateOf(tv);
        if (!st.challenge || st.challenge.done) break;
        const ch = st.challenge;
        if (Date.now() < ch.gmWindowUntil) { await sleep(300); continue; }
        if (ch.entry.hosted && ch.entry.game === 'highestcard') {
          for (const [pid, ph] of [[atk, aph], [def, dph]]) { if (!ch.hostedGame?.drawn?.[pid]) { const b = ph.locator('button:has-text("Draw")'); if (await b.count()) { await b.first().click(); console.log(`  · ${nameOfSeat[pid]} draws`); } } }
          if (call === 'duel' && !played.shotDuel) { played.shotDuel = true; await sleep(300); await shot(aph, '41-duel-play'); }
        } else if (!ch.entry.hosted) {
          for (const [pid, ph] of [[atk, aph], [def, dph]]) { if (ch.reports?.[pid] === undefined) { const b = ph.getByRole('button', { name: nameOfSeat[atk], exact: true }); if (await b.count()) { await b.first().click(); console.log(`  · ${nameOfSeat[pid]} reports ${nameOfSeat[atk]} won`); } } }
          if (!played.shotWager) { played.shotWager = true; await sleep(300); await shot(dph, '42-wager-report'); }
        } else { await gmDo('CHALLENGE_GM_DECIDE', { winnerId: atk }); console.log('  · the GM decides (unexpected entry)'); }
        await sleep(400);
      }
      await waitFor(tv, (k) => { const s = window.__gwf.session.state; return (!s.challenge || s.challenge.done) && s.lastChallenge?.call === k && s.lastChallenge.done; }, `the ${call} settled`, call, 15000);
      st = await stateOf(tv);
      const lc = st.lastChallenge, key = [atk, def].sort().join('|');
      ok(lc.entryId === entryId && (st.challengeHistory?.[key] || []).includes(entryId), `challengeHistory[${nameOfSeat[atk]}|${nameOfSeat[def]}] has ${entryId}; winner ${lc.winnerId ? nameOfSeat[lc.winnerId] : 'draw'} (${lc.how})${lc.hit ? `, hit ${lc.hit.dmg}` : ''}`);
      ok(!st.held[atk] || st.held[atk].owedWait, 'the seats are released');
      if (call === 'robbery') await shot(aph, '43-robbery');
      played[call] = lc;
    }
    ok(['duel', 'wager', 'robbery'].every(k => played[k]?.done), 'all three calls played: duel, wager, robbery');
  });

  // ════════════════════════════════════════ 5. a letter ════════════════════════════════════════════
  await step('5. a letter by crow', async () => {
    const from = seat[0], to = seat[1], sender = phones[0], recipient = phones[1];
    await clickWhen(sender, 'nav.tabs button:has-text("Letters")', 'opens the Letters tab');
    await clickWhen(sender, '.subtabs button:has-text("Write")');
    await clickWhen(sender, sender.locator('.recipients button', { hasText: nameOfSeat[to] }), `to ${nameOfSeat[to]}`);
    await sender.fill('textarea[aria-label="letter text"]', 'Meet at the Inn. Bring Gold.');
    await shot(sender, '50-letter-write');
    await clickWhen(sender, 'button:has-text("Send by crow")', 'Send by crow');
    await waitFor(sender, ([f, t]) => window.__gwf.session.state.letters.some(l => l.fromId === f && l.toId === t), 'the letter is in state.letters', [from, to]);
    await clickWhen(sender, 'nav.tabs button:has-text("Play")');
    const letter = () => tv.evaluate(([f, t]) => window.__gwf.session.state.letters.find(l => l.fromId === f && l.toId === t), [from, to]);
    let l = await letter();
    ok(l && !l.deliveredAt && l.deliverAfterTurns >= 1, `in transit: lands after ${l.deliverAfterTurns} of ${nameOfSeat[to]}'s turns`);
    for (let t = 0; t < 10 && !(await letter()).deliveredAt; t++) await nextTurn(`letter turn ${t + 1}`);
    l = await letter();
    ok(!!l.deliveredAt && !l.destroyed, `delivered at turn ${(await compact(tv)).turnIdx}`);
    await clickWhen(recipient, 'nav.tabs button:has-text("Letters")', `${nameOfSeat[to]} opens the Letters tab`);
    await recipient.locator('article.letter.in', { hasText: `From ${nameOfSeat[from]}` }).first().waitFor();
    await clickWhen(recipient, recipient.locator('article.letter.in .letter-head', { hasText: `From ${nameOfSeat[from]}` }), 'opens the letter');
    ok(/Meet at the Inn/.test(await recipient.locator('article.letter.in.open .letter-text').first().innerText()), 'the recipient reads the text');
    await shot(recipient, '51-letter-inbox');
    await clickWhen(recipient, 'nav.tabs button:has-text("Play")');
  });

  // ════════════════════════════════════════ 6. a death ═════════════════════════════════════════════
  await step('6. a death and the Graveyard', async () => {
    let cur = await compact(tv);
    if (!cur.mover) cur = await nextTurn('before the death');
    const st = await stateOf(tv);
    const order = st.seats; const i = order.indexOf(cur.mover);
    const victim = order[(i + 1) % order.length], vc = charOf(st, victim), vph = phoneOf(victim);
    ok(vc && !vc.dead, `${vc.name} (${nameOfSeat[victim]}) is next in the order with ${vc.health} Health`);
    await gmDo('GM_HEALTH', { playerId: victim, amount: -(vc.health + 5) });
    await waitFor(vph, () => Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.dead === true, `${vc.name} is dead`);
    const st2 = await stateOf(tv), dc = charOf(st2, victim);
    const hex = st2.map.hexes[dc.pos];
    ok(dc.pos === dc.graveyardPos && (hex.type === 'graveyard' || dc.pos === st2.map.start), `${dc.name} lies at ${dc.pos} (${hex.type}), misses ${dc.missTurns} turn(s), Health ${dc.health}`);
    ok(st2.stats[victim].deaths >= 1 && dc.deaths >= 1, 'the death is counted');
    await waitFor(vph, () => /You are dead/.test(document.body.innerText), 'the phone says so');
    await shot(vph, '60-dead-phone'); await shot(tv, '61-tv-dead');
    // The turn order skips the dead seat: end the mover's turn and the seat after the victim is up.
    const next = await nextTurn('the turn before the dead seat');
    ok(next.mover !== victim, `${nameOfSeat[next.mover]} is up: the dead ${dc.name} was skipped`);
    const st3 = await stateOf(tv);
    ok(st3.log.some(l => /lies in the Graveyard/.test(l.text)), 'the log says the character lies in the Graveyard');
    ok(charOf(st3, victim).missTurns === 0 && charOf(st3, victim).dead, 'the missed turn is spent; they wake on their next slot');
  });

  // ════════════════════════════════════════ 7. recap and vault ═════════════════════════════════════
  await step('7. the GM ends the run: recap and vault', async () => {
    await gm.click('button:has-text("End run")');
    await waitFor(tv, () => window.__gwf.session.state.phase === 'ended', 'phase is ended (GM_END_RUN)');
    await tv.locator('.recap .recap-head').waitFor();
    ok(/THE RUN IS OVER/.test(await tv.locator('.recap-head').innerText()), 'the TV shows the ended screen');
    ok((await tv.locator('.recap-card').count()) === 3, 'three recap cards');
    await shot(tv, '70-tv-ended');
    for (const ph of live()) await ph.locator('.recap').waitFor();
    ok(true, 'every phone shows the recap');
    const st = await stateOf(tv);
    const survivor = st.seats.find(id => { const c = charOf(st, id); return c && !c.dead && !(c.deaths > 0); }) || st.seats[0];
    const ph = phoneOf(survivor), sc = charOf(st, survivor);
    await shot(ph, '71-phone-recap');
    const vault = ph.locator('section.ph-sect', { hasText: 'The vault' });
    const first = vault.locator('button.item-row').first();
    const itemName = (await first.locator('.nm').innerText()).trim();
    await first.click(); console.log(`  · ${sc.name} picks ${itemName}`);
    await clickWhen(ph, vault.locator('button.primary.big', { hasText: /^Vault 1 item$/ }), 'Vault 1 item');
    await waitFor(ph, () => (Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.vaulted?.length || 0) === 1, 'VAULT_BANK accepted: one item in the vault');
    const st2 = await stateOf(tv), vc = charOf(st2, survivor);
    ok(vc.vaulted[0].name === itemName && !vc.items[vc.vaulted[0].id], `${itemName} left the character for the vault`);
    ok(!(st2.lastError && st2.lastError.type === 'VAULT_BANK'), 'no VAULT_BANK refusal');
    ok(st2.phase === 'ended', 'state.phase === ended');
    await shot(ph, '72-vault');
  });
  console.log(`\nBROWSER GATE PASSED in ${Math.round((Date.now() - T0) / 1000)}s`);
} catch (e) {
  failed = true; console.error(e);
  for (const [name, p] of Object.entries(pages)) await p.screenshot({ path: shotDir + `fail-${name}.png` }).catch(() => {});
} finally {
  await browser.close(); server.close(); dev.close();
}
process.exit(failed ? 1 : 0);
