import { chromium } from 'playwright';
import { startDevServer } from '../../tools/dev-server.mjs';
const dev = await startDevServer({ port: 0 });
const URL0 = 'http://127.0.0.1:4190', Q = `backend=ws&ws=${encodeURIComponent(dev.url)}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pc = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const wire = (p, tag) => { p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|Wasm module|boots-/.test(m.text())) errors.push(`${tag}: ${m.text()}`); }); p.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const gm = await pc.newPage(); wire(gm, 'gm');
await gm.goto(`${URL0}/gm/?${Q}`);
await gm.fill('input[type=password]', '4242'); await gm.click('button:has-text("Create room")');
await gm.waitForFunction(() => !!window.__gwf?.session);
const code = await gm.evaluate(() => window.__gwf.session.code); console.log('code', code);
// four phones in the same context (local backend = localStorage shared)
const phones = [];
for (let i = 0; i < 3; i++) { const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const ph = await pctx.newPage(); wire(ph, 'phone' + i); await ph.goto(`${URL0}/phone/?code=${code}&${Q}`); await ph.fill('input[placeholder="Your name at the table"]', ['Aj', 'Nick', 'Sam'][i]); await ph.click('button:has-text("Sit down")'); await ph.waitForFunction(() => !!window.__gwf?.ctx?.me); phones.push(ph); }
await gm.waitForFunction(() => Object.keys(window.__gwf.session.state.players).length === 3);
// creation + start via GM dispatch (bots create characters)
await gm.evaluate(async () => { const s = window.__gwf.session; await s.dispatch('CREATION_OPEN', {}, 'gm'); });
await sleep(300);
for (const [i, ph] of phones.entries()) await ph.evaluate(async (i) => { const s = window.__gwf.session, me = window.__gwf.ctx.me; await s.dispatch('CHAR_LOOK', { name: ['Vesper', 'Ox', 'Marrow'][i], crest: '🂡', look: { body: 0, skin: 0, face: 0, hair: 0, coat: '#5a1218' } }, me); await s.dispatch('CHAR_CLASS', { classId: ['enforcer', 'whale', 'croupier'][i] }, me); await s.dispatch('CHAR_LOCK', { alloc: {} }, me); await s.dispatch('PLAYER_READY', { playerId: me, ready: true }, me); }, i);
await gm.evaluate(async () => { await window.__gwf.session.dispatch('RUN_START', {}, 'gm'); });
await gm.waitForFunction(() => window.__gwf.session.state.phase === 'playing');
console.log('phase', await gm.evaluate(() => window.__gwf.session.state.phase));
// panels
for (const name of ['Challenge lists', 'Monsters', 'Proxy & Autopilot']) { await gm.click(`.gm-nav button:has-text("${name}")`); await sleep(400); await gm.screenshot({ path: `test/shots/gm-${name.split(' ')[0].toLowerCase()}.png`, fullPage: true }); }
// start a fight: teleport mover onto a monster hex via Monsters panel "Bring player here" then FIGHT_START
const st = await gm.evaluate(() => { const s = window.__gwf.session.state; const m = Object.values(s.monsters).find(m => !m.dead && !m.boss && m.pos); return { mid: m.id, pos: m.pos, mover: s.seats[s.turnIdx % s.seats.length] }; });
console.log(st);
await gm.evaluate(async ({ mid, pos, mover }) => { const s = window.__gwf.session; await s.dispatch('GM_TELEPORT', { playerId: mover, hex: pos }, 'gm'); await s.dispatch('GM_TAKEOVER', { monsterId: mid, on: true }, 'gm'); await s.dispatch('FIGHT_START', { playerId: mover, monsterId: mid }, 'gm'); }, st);
console.log('fight', await gm.evaluate(() => { const f = window.__gwf.session.state.fight; return f && { kind: f.kind, turn: f.turn, err: window.__gwf.session.state.lastError }; }));
// player attacks via ITEM_USE+ITEM_RESOLVE to hand the turn to the monster
await gm.evaluate(async ({ mover }) => { const s = window.__gwf.session; const c = Object.values(s.state.characters).find(c => c.playerId === mover) || s.state.characters[s.state.players[mover].characterId]; const w = Object.values(c.worn).find(it => it && it.kind === 'attack'); await s.dispatch('ITEM_USE', { playerId: mover, itemId: w.id, targetId: s.state.fight.monsterId, targetKind: 'monster' }, 'gm'); await s.dispatch('ITEM_RESOLVE', { playerId: mover, mult: 2, label: 'test hit', crit: false }, 'gm'); }, st);
console.log('fight2', await gm.evaluate(() => { const f = window.__gwf.session.state.fight; return f && { turn: f.turn, done: f.done, err: window.__gwf.session.state.lastError }; }));
await gm.click('.gm-nav button:has-text("Monsters")'); await sleep(400);
await gm.screenshot({ path: 'test/shots/gm-monsters-turn.png', fullPage: true });
const itemBtns = await gm.locator('.gm-main .panel.gold .row button.primary').count(); console.log('item buttons', itemBtns);
if (itemBtns) { await gm.locator('.gm-main .panel.gold .row button.primary').first().click(); await sleep(500); await gm.screenshot({ path: 'test/shots/gm-monsters-round.png', fullPage: true }); 
  // auto-play the round via the module-level? use controls: click the first primary control button repeatedly
  for (let i = 0; i < 8; i++) { const b = gm.locator('.gm-main .gwf-controls .btns button:not([disabled])'); if (await b.count() === 0) break; await b.first().click(); await sleep(400); }
  await sleep(2500); console.log('after round', await gm.evaluate(() => { const f = window.__gwf.session.state.fight; return f && { turn: f.turn, log: f.log.slice(-1) }; })); }
await gm.screenshot({ path: 'test/shots/gm-monsters-after.png', fullPage: true });
// a challenge: mover (fight is over? end it) — teleport two players together and call a duel
await gm.evaluate(async () => { const s = window.__gwf.session; if (s.state.fight) await s.dispatch('FIGHT_END', {}, 'gm'); });
const ch = await gm.evaluate(async () => { const s = window.__gwf.session, st = s.state; const seats = st.seats; const mover = (await import('/assets/' + '')).catch?.() , cur = st.seats[st.turnIdx % st.seats.length]; return null; }).catch(() => null);
const pair = await gm.evaluate(() => { const st = window.__gwf.session.state; const cur = document && st.seats.find(id => !st.held[id]); const other = st.seats.find(id => id !== cur); const c = st.characters[st.players[cur].characterId]; return { cur, other, pos: c.pos }; });
await gm.evaluate(async ({ cur, other, pos }) => { const s = window.__gwf.session; await s.dispatch('GM_TELEPORT', { playerId: other, hex: pos }, 'gm'); if (s.state.turnPhase === 'move') { await s.dispatch('MOVE_ROLL', { playerId: cur }, 'gm'); await s.dispatch('MOVE_STOP', { playerId: cur }, 'gm'); } const c = s.state.characters[s.state.players[cur].characterId]; const w = Object.values(c.worn).find(it => it && (it.kind === 'attack' || it.kind === 'versus')); await s.dispatch('CHALLENGE_CALL', { playerId: cur, attackerId: cur, defenderId: other, call: 'duel', itemId: w.id }, 'gm'); console.log('call err', JSON.stringify(s.state.lastError)); await s.dispatch('CHALLENGE_ANSWER', { playerId: other, itemId: null }, 'gm'); await s.dispatch('CHALLENGE_SPIN', {}, 'gm'); }, pair);
console.log('challenge', await gm.evaluate(() => { const c = window.__gwf.session.state.challenge; return c ? { spun: c.spun, entry: c.entry?.name, hosted: c.entry?.hosted } : window.__gwf.session.state.lastError; }));
await gm.click('.gm-nav button:has-text("Challenge")'); await sleep(500);
await gm.screenshot({ path: 'test/shots/gm-challenge-live.png', fullPage: false });
const hasReroll = await gm.locator('button:has-text("Reroll")').count(); console.log('reroll button', hasReroll);
if (hasReroll) { await gm.click('button:has-text("Reroll")'); await sleep(300); console.log('after reroll', await gm.evaluate(() => window.__gwf.session.state.challenge?.entry?.name)); }
await sleep(400); console.log('main text', await gm.evaluate(() => document.querySelector('.gm-main')?.innerText.slice(0, 600)));
await gm.locator('button:has-text("Drop Back In")').click(); await sleep(500);
console.log('after drop', await gm.evaluate(() => ({ ch: window.__gwf.session.state.challenge, last: window.__gwf.session.state.lastChallenge?.how, err: window.__gwf.session.state.lastError })));
await gm.screenshot({ path: 'test/shots/gm-challenge-after.png', fullPage: false });
// proxy: open dock for the mover
await gm.click('.gm-nav button:has-text("Proxy")'); await sleep(300);
await gm.locator('button:has-text("Act for this phone")').first().click(); await sleep(2500);
await gm.screenshot({ path: 'test/shots/gm-proxy-dock.png' });
const frame = gm.frames().find(f => f.url().includes('as='));
console.log('frame', frame?.url(), await frame?.evaluate(() => ({ me: window.__gwf?.ctx?.me, proxy: window.__gwf?.ctx?.proxyFor, banner: document.querySelector('.banner')?.textContent })).catch(e => e.message));
// phone of that seat should now be refused when acting
console.log(errors);
await browser.close(); process.exit(0);
