// Turn-clock gate (5 Nov 2026): the chess clock set to 8 s a turn. An idle phone's clock turns red with the warning
// window left, the TV ends the turn at zero (TURN_TIMEOUT) and the phone is told; a timeout in the middle of an open
// fight round ends the fight (the monster gets its free swing) and passes the turn, with no refusal and no page error.
// `npm run build` first. Shots: test/shots/clock-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, stateOf, click, stayPut, openTable, closeTable, newRoom } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the clock run ran past 4 minutes'); process.exit(1); }, 4 * 60 * 1000).unref();
await openTable();
let failed = false;
try {
const R = await newRoom('clock');
await R.gmDo('GM_CONFIG', { balance: { clock: { perTurnSeconds: 8, bankCapSeconds: 8 } } });
let st = await stateOf(R.tv); console.log('clock cfg', JSON.stringify(st.balance.clock), 'clocks', JSON.stringify(st.clocks).slice(0, 200));
const mi = R.ids.indexOf(st.moverId); await stayPut(R.phones[mi], R.names[mi]);
await waitFor(R.phones[mi], () => window.__gwf.session.state.turnPhase === 'action', 'action', undefined, 20000);
await click(R.phones[mi], 'button:has-text("End turn")', 'ends the turn');
await waitFor(R.tv, (n) => window.__gwf.session.state.turnIdx > n, 'next turn', st.turnIdx);
st = await stateOf(R.tv); const ni = R.ids.indexOf(st.moverId); console.log('next mover', R.names[ni], 'bankMs', st.clocks[st.moverId]?.bankMs);
const t0 = Date.now();
await waitFor(R.phones[ni], () => document.querySelector('#phClock')?.classList.contains('low'), 'the idle phone\'s clock turned red', undefined, 12000);
await R.phones[ni].screenshot({ path: `${shotDir}clock-low-phone.png` });
await waitFor(R.tv, (n) => window.__gwf.session.state.turnIdx > n, 'idle phone timed out: turn advanced', st.turnIdx, 40000);
await waitFor(R.phones[ni], () => /clock ran out/.test(document.body.innerText), 'the timed-out phone got the notice', undefined, 8000);
console.log('timeout after', Math.round((Date.now() - t0) / 1000), 's');
await sleep(600); await R.phones[ni].screenshot({ path: `${shotDir}clock-timedout-phone.png` }); await R.tv.screenshot({ path: `${shotDir}clock-timedout-tv.png` });
st = await stateOf(R.tv); console.log('log:', st.log.slice(-4).map(l => l.text).join(' | '), '| lastError', JSON.stringify(st.lastError));
// Timeout mid-fight: next mover walks onto a monster and opens a round, then goes idle.
const fi = R.ids.indexOf(st.moverId), fph = R.phones[fi];
const m = Object.values(st.monsters).filter(x => !x.dead && x.pos && !x.boss && !x.raid && !x.final && st.map.hexes[x.pos]?.type === 'encounter' && !x.gmControlled).sort((a, b) => a.health - b.health)[0];
await R.gmDo('GM_TELEPORT', { playerId: st.moverId, hex: m.pos });
await stayPut(fph, R.names[fi]);
await waitFor(fph, (id) => { const f = window.__gwf.session.state.fight; return !!f && !f.done && f.monsterId === id; }, 'fight open', m.id, 25000);
await click(fph, fph.locator('button.item-row:not([disabled])').first(), 'readies a weapon');
await waitFor(fph, () => { const f = window.__gwf.session.state.fight; return !!(f?.game && !f.game.result); }, 'round open');
const t1 = Date.now(); const turnAt = (await stateOf(R.tv)).turnIdx;
await waitFor(R.tv, (n) => window.__gwf.session.state.turnIdx > n, 'mid-round timeout: turn advanced', turnAt, 40000);
console.log('fight timeout after', Math.round((Date.now() - t1) / 1000), 's');
await sleep(800); await fph.screenshot({ path: `${shotDir}clock-fight-timeout-phone.png` }); await R.tv.screenshot({ path: `${shotDir}clock-fight-timeout-tv.png` });
st = await stateOf(R.tv); console.log('fight after:', JSON.stringify({ fight: st.fight && { done: st.fight.done, game: !!st.fight.game, turn: st.fight.turn }, mover: st.moverId === R.ids[fi] ? 'same' : 'next' }), '| log:', st.log.slice(-5).map(l => l.text).join(' | '), '| lastError', JSON.stringify(st.lastError));
ok(st.fight?.done === true && st.moverId !== R.ids[fi], 'the mid-round timeout closed the fight and passed the turn');
ok(st.lastError == null, `no refusal (${JSON.stringify(st.lastError)})`);
ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
console.log('\nCLOCK RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await closeTable(); process.exit(failed ? 1 : 0);
