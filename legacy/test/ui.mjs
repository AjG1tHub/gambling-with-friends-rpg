// End-to-end check: GM window + player window, play Blackjack, Baccarat, Plinko (and one legacy game).
import { createRequire } from 'module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve('site');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f)); }).listen(8765);
const out = 'test/shots'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const errors = []; let hotkeyLine = '', rosterLine = '';
const gm = await ctx.newPage(), pv = await ctx.newPage();
for (const [n, pg] of [['gm', gm], ['player', pv]]) { pg.on('pageerror', e => errors.push(`${n}: ${e.message}`)); pg.on('console', m => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); }); }
gm.on('dialog', d => d.accept());
await pv.addInitScript(() => { window.__osc = 0; const C = window.AudioContext; if (C) { const orig = C.prototype.createOscillator; C.prototype.createOscillator = function () { window.__osc++; return orig.call(this); }; } });
await gm.goto('http://localhost:8765/gm/'); await pv.goto('http://localhost:8765/');
for (const name of ['Aj', 'Nick']) { await gm.fill('#npName', name); await gm.click('#btnAddPlayer'); await gm.waitForTimeout(150); }
// ── Saved players: add + save, unseat, re-seat from the roster chip ──
{ await gm.fill('#npName', 'Sam'); await gm.click('#btnAddPlayer'); await gm.waitForTimeout(150);
  await gm.locator('#setupPlayers [data-rm]').nth(2).click(); await gm.waitForTimeout(100);
  const chips = await gm.locator('#rosterChips [data-seat]').allInnerTexts();
  await gm.locator('#rosterChips [data-seat]').first().click(); await gm.waitForTimeout(100);
  const seated = await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).players.map(p => [p.name, !!p.profileId]));
  await gm.locator('#setupPlayers [data-rm]').nth(2).click(); await gm.waitForTimeout(100);
  await gm.click('#btnRoster'); const rosterRows = await gm.locator('[data-pr-save]').count(); await gm.keyboard.press('Escape');
  rosterLine = `roster: chips after unseating [${chips.join(', ')}], re-seated ${JSON.stringify(seated)}, manage panel lists ${rosterRows}`; }
await gm.click('#btnStart'); await gm.waitForTimeout(300);
rosterLine += `, played-count after start ${JSON.stringify(await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_profiles')).map(p => [p.name, p.timesPlayed])))}`;
const gold = () => gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).players.map(p => p.balances.Gold));
const game = () => gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).game);
// ── Sound: needs one click on the shared screen, then cues play ──
const chipBefore = await pv.locator('#soundChip').innerText();
await pv.click('#banner'); await pv.waitForTimeout(200);
const chipAfter = await pv.locator('#soundChip').innerText();
await gm.click('#btnSoundTest'); await pv.waitForTimeout(300);
const oscAfterTest = await pv.evaluate(() => window.__osc);
await gm.uncheck('#soundOn'); await pv.waitForTimeout(150); const chipMuted = await pv.locator('#soundChip').innerText();
await gm.click('#btnSoundTest'); await pv.waitForTimeout(300); const oscMuted = await pv.evaluate(() => window.__osc);
await gm.check('#soundOn'); await pv.waitForTimeout(150);
const soundLine = `sound: chip "${chipBefore}" → "${chipAfter}", test fanfare started ${oscAfterTest} oscillators, muted chip "${chipMuted}" added ${oscMuted - oscAfterTest}`;
const options = await gm.evaluate(() => { document.getElementById('btnGameAny').click(); return [...document.getElementById('gameSel').options].map(o => o.value); });
console.log('games offered:', options.join(', '));
const tiles = await gm.evaluate(() => { const b = JSON.parse(localStorage.getItem('gwf_state')).board; const c = {}; b.forEach(t => { if (t.gameId) c[t.gameId] = (c[t.gameId] || 0) + 1; }); return c; });
console.log('board tile games:', JSON.stringify(tiles));
// ── Hotkeys, help overlay, printable card, readability ──
{ const st = () => gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')));
  await gm.keyboard.press('Control+Alt+KeyH'); const help = await gm.locator('.hk-help .hk-group').count();
  await gm.keyboard.press('Escape'); const closed = !(await gm.locator('#modalBack.show').count());
  await gm.keyboard.press('Control+Alt+Space'); const afterBegin = await gm.locator('#turnActions').innerText();
  await gm.selectOption('#forceMethodSel', 'Dice Roll'); await gm.click('#btnForceMethod');
  const before = (await st()); const pos0 = before.players[0].pos, steps0 = before.move.stepsLeft;
  await gm.locator('body').click({ position: { x: 5, y: 5 } }); await gm.keyboard.press('ArrowDown');
  const mid = await st(); const moved = mid.players[0].pos !== pos0;
  await gm.keyboard.press('Control+Alt+Shift+Digit2'); const chaos = (await st()).ledger.filter(r => r.type === 'CHAOS').at(-1);
  await gm.keyboard.press('Control+Alt+KeyZ'); const undone = (await st()).ledger.some(r => r.type === 'CHAOS_UNDO');
  const turn0 = (await st()).turnIdx; await gm.keyboard.press('Control+Alt+KeyN'); const turn1 = (await st()).turnIdx;
  await gm.keyboard.press('Control+Alt+KeyN');                                   // back to player 1 for the rest of the run
  await gm.keyboard.press('Control+Alt+KeyM'); const muted = (await st()).sound.on === false; await gm.keyboard.press('Control+Alt+KeyM');
  await gm.fill('#bannerText', ''); await gm.focus('#bannerText'); await gm.keyboard.press('ArrowLeft');      // typing: arrows must not move anyone
  await gm.selectOption('#textScaleSel', '1.4'); await gm.check('#contrastOn'); await pv.waitForTimeout(200);
  const scale = await pv.evaluate(() => [document.body.style.getPropertyValue('--text-scale'), document.body.classList.contains('hc')]);
  await pv.screenshot({ path: `${out}/readability-xl-contrast.png` });
  await gm.selectOption('#textScaleSel', '1'); await gm.uncheck('#contrastOn');
  const card = await ctx.newPage(); card.on('pageerror', e => errors.push('card: ' + e.message)); await card.goto('http://localhost:8765/gm/hotkeys.html');
  const groups = await card.locator('.hk-group').count(); const win = await card.locator('.hk-combo').first().innerText();
  await card.click('#btnOS'); const mac = await card.locator('.hk-combo').first().innerText(); await card.screenshot({ path: `${out}/hotkey-card.png`, fullPage: true }); await card.close();
  hotkeyLine = `hotkeys: help groups ${help}, Esc closed ${closed}, Space began turn (${/Spin Method/.test(afterBegin)}), arrow moved a ${steps0}-step move ${moved}, silent chaos T${chaos?.tier} loud=${chaos?.loud}, undo ${undone}, End Turn ${turn0}→${turn1}, mute ${muted}; readability scale/contrast ${JSON.stringify(scale)}; card ${groups} groups, "${win}" / "${mac}"`; }
async function start(id) { await gm.click('#btnGameAny'); await gm.selectOption('#gameSel', id); await gm.click('#btnGameStart'); await gm.waitForTimeout(100); }
const log = [rosterLine, soundLine, hotkeyLine];
// ── Blackjack ×6 (hit below 17) ──
for (let i = 0; i < 6; i++) {
  const before = (await gold())[0];
  await start('blackjack');
  if (i === 0) { await pv.waitForTimeout(1500); await pv.screenshot({ path: `${out}/blackjack-player-turn.png` }); await gm.screenshot({ path: `${out}/blackjack-gm.png` }); }
  for (;;) { const g = await game();
    if (g.phase === 'insurance') { await gm.click(i % 2 ? '#bjInsure' : '#bjDecline'); await gm.waitForTimeout(60); continue; }
    if (g.phase !== 'player') break;
    const total = await gm.evaluate(async () => { const G = await import('../js/games.js'); const v = JSON.parse(localStorage.getItem('gwf_state')).game.view; return G.bjTotal(v.hands[v.active].cards).total; });
    if (await gm.locator('#bjSplit').count()) { await gm.click('#bjSplit'); await gm.waitForTimeout(60); continue; }
    if (i === 1 && g.view.hands[g.view.active].cards.length === 2) { await gm.click('#bjDouble'); await gm.waitForTimeout(60); continue; }
    await gm.click(total < 17 ? '#bjHit' : '#bjStand'); await gm.waitForTimeout(60); }
  const g = await game();
  const early = await gm.locator('#gSettle').count();           // Settle must be held back while the dealer plays out
  await gm.waitForSelector('#gSettle', { timeout: 15000 });
  if (i === 0) await pv.screenshot({ path: `${out}/blackjack-result.png` });
  await gm.click('#gSettle'); await gm.waitForTimeout(80);
  const after = (await gold())[0];
  const expect = Math.round(100 * (g.result.mult - 1));
  log.push(`blackjack: ${g.result.label} | mult ${g.result.mult} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}${early ? ' | settle shown early' : ''}`);
}
// ── Baccarat ×3 (one per side) ──
for (const side of ['player', 'banker', 'tie']) {
  const before = (await gold())[0];
  await start('baccarat'); await gm.selectOption('#bacSide', side);
  if (side === 'player') await pv.screenshot({ path: `${out}/baccarat-bet.png` });
  await gm.click('#bacDeal'); await pv.waitForTimeout(1900);
  if (side === 'player') await pv.screenshot({ path: `${out}/baccarat-dealing.png` });
  const g = await game();
  await gm.waitForSelector('#gSettle', { timeout: 15000 });
  if (side === 'player') { await pv.screenshot({ path: `${out}/baccarat-result.png` }); await gm.screenshot({ path: `${out}/baccarat-gm.png` }); }
  await gm.click('#gSettle'); await gm.waitForTimeout(80);
  const after = (await gold())[0]; const expect = Math.round(100 * (g.result.mult - 1));
  log.push(`baccarat/${side}: ${g.result.label} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}`);
}
// ── Plinko ×3 ──
for (let i = 0; i < 3; i++) {
  const before = (await gold())[0];
  await start('plinko');
  if (i === 0) await pv.screenshot({ path: `${out}/plinko-ready.png` });
  await gm.click('#gSpin'); await pv.waitForTimeout(1300);
  if (i === 0) await pv.screenshot({ path: `${out}/plinko-dropping.png` });
  const g = await game();
  await gm.waitForSelector('#gAccept', { timeout: 15000 });
  if (i === 0) { await pv.waitForTimeout(150); await pv.screenshot({ path: `${out}/plinko-result.png` }); await gm.screenshot({ path: `${out}/plinko-gm.png` }); }
  await gm.click('#gAccept'); await gm.waitForTimeout(80);
  const after = (await gold())[0]; const expect = Math.round(100 * (g.pending.mult - 1));
  log.push(`plinko: slot ${g.view.drop.slot + 1} → ${g.pending.label} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}`);
}
// ── Hi-Lo ×3 and Dice ×3 ──
for (let i = 0; i < 3; i++) {
  const before = (await gold())[0]; await start('hilo'); await pv.waitForTimeout(350);
  for (let k = 0; k < 2; k++) { const g = await game(); if (g.phase !== 'running') break; const hi = await gm.locator('#hlHigher').isEnabled(); const top = g.view.cards.at(-1).r;
    await gm.click(['A', '2', '3', '4', '5', '6', '7'].includes(top) && hi ? '#hlHigher' : '#hlLower'); await gm.waitForTimeout(80); }
  if (i === 0) { await pv.waitForTimeout(300); await pv.screenshot({ path: `${out}/hilo.png` }); }
  if ((await game()).phase === 'running') await gm.click('#hlCash');
  const g = await game(); await gm.waitForSelector('#gSettle', { timeout: 15000 }); await gm.click('#gSettle'); await gm.waitForTimeout(80);
  const after = (await gold())[0]; const expect = Math.round(100 * (g.result.mult - 1));
  log.push(`hilo: ${g.result.label} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}`);
}
for (const [dir, target] of [['under', 50], ['over', 80], ['under', 96]]) {
  const before = (await gold())[0]; await start('dice');
  await gm.selectOption('#dcDir', dir); await gm.fill('#dcTarget', String(target)); const preview = await gm.locator('#dcPreview').innerText();
  await gm.click('#dcBet'); await gm.click('#gSpin'); await pv.waitForTimeout(500);
  if (dir === 'under' && target === 50) await pv.screenshot({ path: `${out}/dice-rolling.png` });
  const g = await game(); await gm.waitForSelector('#gAccept', { timeout: 15000 });
  if (dir === 'under' && target === 50) { await pv.waitForTimeout(150); await pv.screenshot({ path: `${out}/dice-result.png` }); }
  await gm.click('#gAccept'); await gm.waitForTimeout(80);
  const after = (await gold())[0]; const expect = Math.round(100 * (g.pending.mult - 1));
  log.push(`dice ${dir} ${target} (${preview}): ${g.pending.label} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}`);
}
// ── Slots ×2 and Keno ×2 ──
for (let i = 0; i < 2; i++) {
  const before = (await gold())[0]; await start('slots'); await gm.click('#gSpin'); await pv.waitForTimeout(700);
  if (i === 0) await pv.screenshot({ path: `${out}/slots-spinning.png` });
  const g = await game(); await gm.waitForSelector('#gAccept', { timeout: 15000 });
  if (i === 0) { await pv.waitForTimeout(150); await pv.screenshot({ path: `${out}/slots-result.png` }); }
  await gm.click('#gAccept'); await gm.waitForTimeout(80);
  const after = (await gold())[0]; const expect = Math.round(100 * (g.pending.mult - 1));
  log.push(`slots: ${g.pending.label} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}`);
}
for (let i = 0; i < 2; i++) {
  const before = (await gold())[0]; await start('keno');
  if (i === 0) { for (const n of [3, 7, 12, 21, 33]) await gm.click(`[data-keno="${n}"]`); } else await gm.click('#knQuick');
  const picked = (await game()).view.picks.length;
  await gm.click('#gSpin'); await pv.waitForTimeout(1500);
  if (i === 0) await pv.screenshot({ path: `${out}/keno-drawing.png` });
  const g = await game(); await gm.waitForSelector('#gAccept', { timeout: 15000 });
  if (i === 0) { await pv.waitForTimeout(150); await pv.screenshot({ path: `${out}/keno-result.png` }); }
  await gm.click('#gAccept'); await gm.waitForTimeout(80);
  const after = (await gold())[0]; const expect = Math.round(100 * (g.pending.mult - 1));
  log.push(`keno: ${picked} picks, ${g.pending.label} | gold ${before}→${after} ${after - before === expect ? 'OK' : 'MISMATCH expected ' + expect}`);
}
// ── Plug-in games through the real GM window: one quick, one show, one table game ──
{ const res = [];
  for (const [id, clicks] of [['underover7', [/OVER 7/]], ['tower', [/Door 1/, /CASH OUT/]], ['threecard', [/PLAY/]]]) {
    const g0 = (await gold())[0]; await start(id); await pv.waitForTimeout(300);
    for (const re of clicks) { const btn = gm.locator('#gameControls button:not([disabled])').filter({ hasText: re }).first(); if (await btn.count()) { await btn.click(); await pv.waitForTimeout(250); } }
    await pv.screenshot({ path: `${out}/x-${id}.png` });
    await gm.waitForSelector('#gSettle', { timeout: 8000 }); const stage = (await pv.locator('#gameStage').innerText()).replace(/\s+/g, ' ').slice(0, 60);
    await gm.click('#gSettle'); await pv.waitForTimeout(150); const g1 = (await gold())[0];
    res.push(`${id} ${g1 - g0 >= 0 ? '+' : ''}${g1 - g0} (stage "${stage}…", cleared ${!(await game())})`); }
  log.push('plug-in games on the real table: ' + res.join(' | ')); }
// ── Plinko with Reroll + Fork power-ups held ──
await gm.evaluate(() => { const s = JSON.parse(localStorage.getItem('gwf_state')); s.players[0].heldPowerUps.push({ id: 'reroll', name: 'Edge: Reroll', type: 'Wheel Mod' }, { id: 'fork', name: 'Edge: Fork', type: 'Wheel Mod' }, { id: 'nudge', name: 'Nudge', type: 'Wheel Mod' }); s.savedAt = Date.now() + 5000; localStorage.setItem('gwf_state', JSON.stringify(s)); });
await gm.reload(); await gm.waitForTimeout(400);
{ await start('plinko'); const nudge = await gm.locator('#nudgeSel').count(); if (nudge) await gm.selectOption('#nudgeSel', { index: 1 });
  await gm.click('#gSpin'); await gm.waitForSelector('#gReroll', { timeout: 15000 }); await gm.click('#gReroll');
  await gm.waitForSelector('#gFork', { timeout: 15000 }); await gm.click('#gFork'); await gm.waitForSelector('[data-pick]', { timeout: 15000 });
  const picks = await gm.locator('[data-pick]').allTextContents(); await gm.locator('[data-pick]').first().click(); await gm.waitForTimeout(80);
  log.push(`plinko mods: nudge select ${nudge ? 'shown' : 'MISSING'}, reroll ok, fork options [${picks.join(' | ')}], game cleared: ${(await game()) === null}`); }
// ── Regression: legacy games still run ──
{ const before = (await gold())[0]; await start('fifty'); await gm.click('#gSpin'); await gm.waitForSelector('#gAccept'); const g = await game(); await gm.click('#gAccept'); await gm.waitForTimeout(80);
  log.push(`fifty: ${g.pending.label} | gold ${before}→${(await gold())[0]}`);
  await start('mines'); await gm.click('[data-mine="0"]'); await gm.waitForTimeout(60); const g2 = await game(); if (g2.phase !== 'done') await gm.click('#mStop'); await gm.waitForSelector('#gSettle'); await gm.click('#gSettle');
  await start('crash'); await gm.click('#cLaunch'); await pv.waitForTimeout(600); const cm = await pv.locator('.stage-big').textContent(); await gm.waitForTimeout(100);
  if (await gm.locator('#cCash').count()) await gm.click('#cCash'); await gm.waitForSelector('#gSettle'); await gm.click('#gSettle');
  log.push(`mines + crash: ok (crash showed ${cm.trim()} live on player view)`); }
// ── Pets + Power Level: grant, hatch, train, see the chip on the shared screen ──
{ await gm.keyboard.press('Control+Alt+KeyY'); await gm.fill('#ptPower', '400'); await gm.click('#ptGrant');
  await gm.click('#ptHatch'); const hatched = await gm.locator('.modal .msg').first().innerText();
  await gm.locator('[data-pt-amt]').first().fill('120'); await gm.locator('[data-pt-train]').first().click();
  const trained = await gm.locator('.modal .msg').first().innerText(); await gm.screenshot({ path: `${out}/pets-gm.png` });
  const pl = await gm.evaluate(() => { const p = JSON.parse(localStorage.getItem('gwf_state')).players[0]; return [p.power, p.pets.length, p.pets[0].level]; });
  await gm.keyboard.press('Escape'); await pv.waitForTimeout(200); const chip = (await pv.locator('.lb-pet').first().innerText()).replace(/\s+/g, ' ');
  log.push(`pets: "${hatched}" → "${trained}" | power/pets/level ${JSON.stringify(pl)} | leaderboard chip "${chip}"`); }
// ── Pet battle: boss fight through to the end, then PvP ──
{ await gm.keyboard.press('Control+Alt+KeyF'); await gm.click('[data-pb-boss="sewerking"]'); await pv.waitForTimeout(250);
  await pv.screenshot({ path: `${out}/petbattle-start.png` }); let turns = 0;
  while (await gm.locator('[data-pb-move="element"]').count() && turns++ < 80) { await gm.click('[data-pb-move="element"]'); await gm.waitForTimeout(40); }
  await pv.waitForTimeout(250); await pv.screenshot({ path: `${out}/petbattle-end.png` });
  const b = await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).petBattle);
  await gm.click('#pbDone'); await pv.waitForTimeout(150); const cleared = !(await pv.locator('.pb-arena').count());
  // give Nick a pet and fight PvP for 50 Gold
  await gm.keyboard.press('Control+Alt+KeyY'); await gm.selectOption('#ptPlayer', { index: 1 }); await gm.click('#ptGift'); await gm.keyboard.press('Escape');
  await gm.evaluate(() => { const s = JSON.parse(localStorage.getItem('gwf_state')); for (const p of s.players) for (const pet of p.pets) { pet.hp = pet.hpMax; pet.fainted = false; } s.savedAt = Date.now() + 9000; localStorage.setItem('gwf_state', JSON.stringify(s)); });
  await gm.reload(); await gm.waitForTimeout(400);
  const g0 = await gold(); await gm.keyboard.press('Control+Alt+KeyF'); await gm.fill('#pbWager', '50'); await gm.click('#pbPvp'); let t2 = 0;
  while (await gm.locator('[data-pb-move="strike"]').count() && t2++ < 120) { await gm.click('[data-pb-move="strike"]'); await gm.waitForTimeout(30); }
  const b2 = await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).petBattle); await gm.click('#pbDone'); const g1 = await gold();
  log.push(`pet battle: boss fight ${b.phase} after ${b.round} rounds, winner ${b[b.winner].name}, rewards [${(b.rewards || []).join('; ')}], stage cleared ${cleared} | PvP ${b2.phase}, winner ${b2[b2.winner].owner}, gold ${JSON.stringify(g0)}→${JSON.stringify(g1)}`); }
// ── Raid: both players' pets vs a scaled boss ──
{ await gm.evaluate(() => { const s = JSON.parse(localStorage.getItem('gwf_state')); for (const p of s.players) for (const pet of p.pets) { pet.hp = pet.hpMax; pet.fainted = false; } s.savedAt = Date.now() + 19000; localStorage.setItem('gwf_state', JSON.stringify(s)); });
  await gm.reload(); await gm.waitForTimeout(400);
  await gm.keyboard.press('Control+Alt+KeyF'); await gm.click('#rdGo'); await pv.waitForTimeout(250); await pv.screenshot({ path: `${out}/raid.png` }); let n = 0;
  while (await gm.locator('[data-rd-move="element"]').count() && n++ < 200) { await gm.click('[data-rd-move="element"]'); await gm.waitForTimeout(25); }
  const r = await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).raid); await gm.click('#rdDone'); await pv.waitForTimeout(120);
  log.push(`raid: ${r.party.length} pets vs ${r.boss.name} (${r.boss.hpMax} HP) → ${r.phase}, winner ${r.winner} in ${r.round} rounds, stage cleared ${!(await pv.locator('.raid-party').count())}`); }
// ── Live auction, buy-in panel, automated battle contest ──
{ await gm.selectOption('#toolCurrency', 'Gems'); await gm.fill('#toolAmount', '20'); await gm.click('#btnAdjust');
  await gm.click('#btnAuction'); await gm.click('#aStart'); await pv.waitForTimeout(150);
  await gm.locator('[data-bid]').first().click(); await pv.waitForTimeout(150); await pv.screenshot({ path: `${out}/auction.png` });
  for (let i = 0; i < 3; i++) await gm.click('#aCall');
  const au = await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).auction); await gm.click('#aEnd');
  await gm.click('#btnBuyIn'); const preview = await gm.locator('#biPreview').innerText(); const mech = await gm.locator('#biRow option:checked').innerText(); await gm.keyboard.press('Escape');
  await gm.click('#btnBattle'); let ran = 'no digital contest came up';
  for (let i = 0; i < 12; i++) { await gm.click('#bSpin'); await gm.waitForTimeout(60); if (await gm.locator('#bAuto').count()) { await gm.click('#bAuto'); await pv.waitForTimeout(150); ran = await gm.locator('#bMsg').innerText(); await pv.screenshot({ path: `${out}/contest.png` }); break; } }
  await gm.keyboard.press('Escape'); await pv.waitForTimeout(150);
  log.push(`auction: ${au.summary} | buy-in "${mech}" preview "${preview}" | contest: ${ran.slice(0, 90)} | stage cleared ${!(await pv.locator('.contest-show').count())}`); }
// ── Loan Shark: lend via hotkey, see the tag on the shared screen, repay ──
{ const g0 = (await gold())[0];
  await gm.keyboard.press('Control+Alt+KeyL'); await gm.fill('#lnAmount', '400'); await gm.click('#lnGo'); await pv.waitForTimeout(200);
  const g1 = (await gold())[0]; const tag = (await pv.locator('.lb-tags').allInnerTexts()).join(' ');
  await gm.click('[data-repay]'); await pv.waitForTimeout(200); const g2 = (await gold())[0];
  const none = await gm.locator('[data-repay]').count(); await gm.keyboard.press('Escape');
  log.push(`loans: +${g1 - g0} lent, tag "${(tag.match(/🦈[^\n]*/) || [''])[0].trim()}", repaid ${g1 - g2}, open loans left ${none}`); }
// ── Undo: one hotkey press takes back one GM click ──
{ const g0 = (await gold())[0]; await gm.waitForTimeout(400);
  await gm.selectOption('#toolCurrency', 'Gold'); await gm.fill('#toolAmount', '77'); await gm.click('#btnAdjust'); const g1 = (await gold())[0];
  await gm.waitForTimeout(400); await gm.keyboard.press('Control+Alt+Backspace'); await pv.waitForTimeout(150); const g2 = (await gold())[0];
  const note = await gm.locator('#wheelMsgs .msg').first().innerText(); const pvGold = await pv.locator('.lb-total').allInnerTexts();
  log.push(`undo: gold ${g0} → ${g1} → ${g2} (${g2 === g0 ? 'restored' : 'NOT RESTORED'}), GM note "${note.replace(/\s+/g, ' ')}", shared screen totals ${JSON.stringify(pvGold)}`); }
// ── Ledger viewer, config check, restore points, crash banner, corrupt-save recovery ──
{ await gm.click('#btnLedger'); const ledRows = await gm.locator('.ledger-table tr').count(); await gm.keyboard.press('Escape');
  const chip = await gm.locator('#cfgHealth').innerText(); await gm.click('#cfgHealth');
  const cfgTxt = await gm.locator('.modal').innerText(); await gm.screenshot({ path: `${out}/config-check.png` }); await gm.keyboard.press('Escape');
  await gm.click('#btnSettings'); await gm.click('#sBackups'); const points = await gm.locator('[data-bk]').count();
  const healthy = /consistent/.test(await gm.locator('.modal').innerText()); await gm.screenshot({ path: `${out}/restore-points.png` });
  const before = (await gold())[0]; await gm.locator('[data-bk]').last().click(); await gm.waitForTimeout(300); const restored = (await gold())[0];
  await gm.waitForTimeout(400); await gm.keyboard.press('Control+Alt+Backspace'); await gm.waitForTimeout(200); const undone = (await gold())[0];
  errors.length; const nErr = errors.length;
  await gm.evaluate(() => { setTimeout(() => { throw new Error('boom-test'); }, 0); }); await gm.waitForTimeout(200);
  const banner = await gm.locator('#trouble').innerText(); await gm.click('#trClose'); errors.splice(nErr);     // that error was on purpose
  log.push(`ledger viewer rows ${ledRows} | config chip "${chip}", check lists Big Wheel warning: ${/Big Wheel returns/.test(cfgTxt)} | restore points ${points}, healthy ${healthy}, restore ${before}→${restored}, undo back to ${undone} | crash banner "${banner.split('\n')[0].slice(0, 60)}…"`);
  // a tab that died mid-write: the save is garbage, the newest restore point takes over on reload
  const round = await gm.evaluate(() => JSON.parse(localStorage.getItem('gwf_state')).round);
  await gm.evaluate(() => localStorage.setItem('gwf_state', '{"players":[{"id"'));
  await gm.reload(); await gm.waitForTimeout(600);
  const after = await gm.evaluate(() => { const s = JSON.parse(localStorage.getItem('gwf_state')); return [s.players.length, s.round, s.phase]; });
  const note = await gm.locator('#trouble').innerText().catch(() => ''); await gm.click('#trClose').catch(() => {});
  log.push(`corrupt save: reloaded into ${after[0]} players, round ${after[1]} (was ${round}), phase ${after[2]} | banner "${note.split('\n')[0].slice(0, 70)}…"`); }
// ── IRL stakes: log, show on the player view, settle ──
{ await gm.fill('#stakeText', 'loser buys pizza'); await gm.selectOption('#stakeA', { index: 1 }); await gm.selectOption('#stakeB', { index: 2 }); await gm.click('#btnStake'); await pv.waitForTimeout(200);
  const shown = await pv.locator('#stakesList').innerText(); const g0 = await gold();
  await gm.selectOption('[data-stake-win]', { index: 1 }); await gm.click('[data-stake-settle]'); await pv.waitForTimeout(200);
  const hidden = await pv.locator('#stakesPanel').isHidden(); const g1 = await gold();
  log.push(`stakes: player view showed "${shown.trim()}", hidden after settle: ${hidden}, balances untouched: ${JSON.stringify(g0) === JSON.stringify(g1)}`); }
// Live Odds panel lists the new numeric tunables
const oddsTxt = await gm.evaluate(() => document.getElementById('oddsBody')?.innerText || '');
log.push('live odds has blackjack/baccarat rows: ' + (/Blackjack/.test(oddsTxt) && /Baccarat/.test(oddsTxt)));
// ── End session → recap v2 on the player view ──
{ await gm.click('#btnEndSession'); await pv.waitForTimeout(400);
  const awards = await pv.locator('.award-title').allTextContents(); const rowsN = await pv.locator('table.recap').first().locator('tr').count();
  await pv.screenshot({ path: `${out}/recap.png` });
  await gm.click('#btnHistory'); const hofRows = await gm.locator('.modal table.shop tr').count() - 1; const sessLines = await gm.locator('.modal .log div').count(); await gm.keyboard.press('Escape');
  const lifetime = await pv.locator('.recap-wrap').innerText();
  log.push(`history: Hall of Fame rows ${hofRows}, sessions listed ${sessLines}, all-time table on recap: ${/All-time/i.test(lifetime)}`);
  log.push(`recap: ${rowsN} standings rows, awards [${awards.join(', ')}], per-game rows ${await pv.locator('table.recap.small tr').count()}`); }
// ── Rules page (built from the live config) + GM quickstart ──
{ const rp = await ctx.newPage(); rp.on('pageerror', e => errors.push(`rules: ${e.message}`));
  await rp.goto('http://localhost:8765/rules/'); await rp.waitForSelector('#rules section');
  const secs = await rp.locator('#rules section').count(); const gamesN = await rp.locator('#games .game').count(); const txt = await rp.locator('#rules').innerText();
  await rp.screenshot({ path: `${out}/rules.png`, fullPage: true });
  await rp.setViewportSize({ width: 390, height: 800 }); const overflow = await rp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await rp.goto('http://localhost:8765/gm/guide.html'); const guideSecs = await rp.locator('section').count();
  const links = await gm.evaluate(() => [...document.querySelectorAll('a.btn-like')].map(a => a.getAttribute('href')));
  log.push(`rules page: ${secs} sections, ${gamesN} games explained, junk text: ${/undefined|NaN|\[object/.test(txt)}, phone-width overflow ${overflow}px | guide: ${guideSecs} sections | GM links ${JSON.stringify(links)} | player view link ${await pv.locator('a.rules-link').count()}`);
  await rp.close(); }
log.push(`sound: ${await pv.evaluate(() => window.__osc)} oscillators started over the whole run`);
console.log(log.join('\n')); console.log('errors:', errors.length ? errors : 'none');
await browser.close(); srv.close();
