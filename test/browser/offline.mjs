// Airplane-mode gate (QA pass, 4 Nov 2026): a phone loses its network mid-game without reloading (airplane mode, a
// lock screen, another app) and comes back. Asserts that while it is away the TV hands its seat to the GM for
// silence and the table keeps moving, and that when it is back it catches up on every event it missed, takes its
// own seat back without a reload or a GM action, and plays its turn. Then the TV itself drops and comes back.
// Three 360×640 Whales, ws dev backend, tutorial opening off. `npm run build` first. Shots: test/shots/off-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, click, stateOf, toPlod, stayPut, openTable, closeTable, newRoom } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the offline run ran past 6 minutes'); process.exit(1); }, 6 * 60 * 1000).unref();
await openTable();
const PROXY_AFTER_S = 30;   // B.table.proxyAfterSeconds
let failed = false;
try {
  console.log('\n▶ 1. the next seat goes into airplane mode for 45 s');
  const R = await newRoom('offline');
  // The GM that created the room pings presence like everyone else: the TV knows a GM is online (it must not
  // decide challenges or hand seats to autopilot as if there were none) and the GM nav's pill knows the TV is up.
  await waitFor(R.tv, () => (window.__gwf.session.presence.gm || 0) > Date.now() - 15000, 'the TV sees the GM console online');
  await waitFor(R.gm, () => document.querySelector('.tv-pill')?.textContent === 'TV live', 'the GM nav pill says "TV live"', undefined, 12000);
  ok((await R.gm.locator('.tv-warn').count()) === 0, 'no "no TV connected" warning on the GM console while the TV is up');
  let st = await stateOf(R.tv);
  const order = st.seats, mi = R.ids.indexOf(st.moverId), bi = (mi + 1) % 3;
  const mover = R.phones[mi], away = R.phones[bi], awayId = R.ids[bi], awayName = R.names[bi];
  ok(order.includes(awayId), `${awayName} is next after ${R.names[mi]}`);
  // Everyone has pinged at least once so the TV has a "seen" time for the seat that is about to go quiet.
  await waitFor(R.tv, (id) => (window.__gwf.session.presence[id] || 0) > 0, `the TV has seen ${awayName}'s phone`, awayId);
  await away.context().setOffline(true); const offAt = Date.now(); console.log(`  · ${awayName}'s phone is offline`);
  await waitFor(away, () => /Connection lost/.test(document.body.innerText), `${awayName}'s phone shows the connection-lost banner`, undefined, 8000);
  // The mover plays its turn and ends it: the away seat is now to move and silent.
  await stayPut(mover, R.names[mi]);
  await waitFor(mover, () => window.__gwf.session.state.turnPhase === 'action', 'action phase', undefined, 20000);
  await click(mover, 'button:has-text("End turn")', `${R.names[mi]} ends the turn`);
  await waitFor(R.tv, (id) => window.__gwf.session.state.moverId === id, `${awayName} is to move (and away)`, awayId);
  const turnAtAway = (await stateOf(R.tv)).turnIdx;
  await waitFor(R.tv, (id) => !!window.__gwf.session.state.players[id].proxied, `the TV handed ${awayName}'s seat to the GM for silence (after ~${PROXY_AFTER_S} s)`, awayId, (PROXY_AFTER_S + 15) * 1000);
  st = await stateOf(R.tv); ok(st.gm.proxyReasons?.[awayId] === 'silent', 'the proxy is recorded as the TV\'s doing (reason: silent)');
  ok((await R.gm.locator('text=proxied since').count()) >= 0, 'GM console still up');
  await R.gm.locator('.gm-nav button', { hasText: /Proxy|Phones|Seats/i }).first().click().catch(() => {});
  await R.gm.screenshot({ path: `${shotDir}off-gm-proxied.png` }).catch(() => {});
  // The GM plays the away seat from the console: the table keeps moving. (Simplest GM act: end the turn for them.)
  await R.gmDo('GM_TELEPORT', { playerId: awayId, hex: st.map.start });   // any GM act on the seat proves the proxy is usable
  const tvTurn = await R.tv.evaluate(() => window.__gwf.session.state.turnIdx);
  ok(tvTurn === turnAtAway, `the table is still on ${awayName}'s turn (${tvTurn}); the GM can act for the seat`);
  // Back online after 45 s in all.
  await sleep(Math.max(0, 45000 - (Date.now() - offAt)));
  await away.context().setOffline(false); console.log(`  · ${awayName}'s phone is back online after ${Math.round((Date.now() - offAt) / 1000)} s`);
  await waitFor(away, (n) => window.__gwf.session.lastSeq >= n, `${awayName}'s phone caught up on the events it missed`, (await stateOf(R.tv)) && (await R.tv.evaluate(() => window.__gwf.session.lastSeq)), 20000);
  await waitFor(R.tv, (id) => !window.__gwf.session.state.players[id].proxied, `${awayName} took the seat back on its own (PLAYER_RECONNECT, no reload, no GM action)`, awayId, 15000);
  await waitFor(away, () => window.__gwf.session.state.moverId === window.__gwf.ctx.me && /YOUR TURN/i.test(document.body.innerText), `${awayName}'s phone says it is their turn`, undefined, 15000);
  await away.screenshot({ path: `${shotDir}off-phone-back.png` }).catch(() => {});
  ok(!/Connection lost/.test(await away.evaluate(() => document.body.innerText)), 'the connection-lost banner is gone');
  // And the turn is playable from the phone.
  await stayPut(away, awayName);
  await waitFor(away, () => window.__gwf.session.state.turnPhase === 'action', `${awayName} reached the action phase after the outage`, undefined, 20000);
  await click(away, 'button:has-text("End turn")', `${awayName} ends the turn`);
  await waitFor(R.tv, (n) => window.__gwf.session.state.turnIdx > n, 'the turn advanced', turnAtAway);
  ok(!(await stateOf(R.tv)).players[awayId].proxied, `${awayName} is not re-proxied once back`);

  console.log('\n▶ 2. the TV drops for 25 s mid-run and comes back');
  const tvSeq = await R.tv.evaluate(() => window.__gwf.session.lastSeq);
  await R.tv.context().setOffline(true); console.log('  · the TV is offline');
  await waitFor(R.tv, () => /Connection lost/.test(document.body.innerText), 'the TV shows its connection-lost banner', undefined, 8000);
  const cur = (await stateOf(R.gm)).moverId, ci = R.ids.indexOf(cur), cph = R.phones[ci];
  // The phones keep playing (they are on their own contexts).
  await stayPut(cph, R.names[ci]);
  await waitFor(cph, () => window.__gwf.session.state.turnPhase === 'action', 'action phase', undefined, 20000);
  await click(cph, 'button:has-text("End turn")', `${R.names[ci]} ends the turn while the TV is dark`);
  await waitFor(R.gm, (n) => window.__gwf.session.lastSeq > n + 2, 'the GM console saw the turn go by', tvSeq);
  await sleep(25000 - 5000);
  await R.tv.context().setOffline(false); console.log('  · the TV is back');
  const gmSeq = await R.gm.evaluate(() => window.__gwf.session.lastSeq);
  await waitFor(R.tv, (n) => window.__gwf.session.lastSeq >= n, 'the TV caught up to the GM console (every missed event back-filled)', gmSeq, 20000);
  const [a, b] = [await stateOf(R.tv), await stateOf(R.gm)];
  await waitFor(R.tv, () => !/Connection lost/.test(document.body.innerText), 'the TV banner cleared', undefined, 8000);
  await waitFor(R.gm, () => document.querySelector('.tv-pill')?.textContent === 'TV live', 'the GM console\'s TV pill says "TV live" once the TV pings again', undefined, 12000);
  ok(a.turnIdx === b.turnIdx && a.moverId === b.moverId && a.round === b.round, `TV and GM agree: round ${a.round}, turn ${a.turnIdx}, ${a.moverId} to move`);
  await R.tv.screenshot({ path: `${shotDir}off-tv-back.png` }).catch(() => {});
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nOFFLINE RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); if (pageErrors.length) console.error('page errors:', pageErrors.slice(0, 4)); }
await closeTable();
process.exit(failed ? 1 : 0);
