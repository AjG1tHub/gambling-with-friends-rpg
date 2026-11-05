// Per-mode gate (4 Nov 2026): the modes the main gate never plays, on real phone screens rather than the bot policy:
// PvE, PvP, Royale and Teams, three 360×640 phones each, through creation and six turns of tapping (plod, step,
// tiles, fights, End turn). Asserts the run starts in that mode (Teams: after the GM's "no teams" confirm, then
// with teams set), turns advance from every phone, no refusal lands on a phone and no page errors.
// `npm run build` first. Shots: test/shots/mode-<mode>-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, stateOf, openTable, closeTable, newRoom } from './table-fixture.mjs';
import { playTurn } from './phone-driver.mjs';
setTimeout(() => { console.error('WATCHDOG: the modes run ran past 9 minutes'); process.exit(1); }, 9 * 60 * 1000).unref();
await openTable();
const MODES = (process.env.MODES || 'pve,pvp,royale,teams').split(',');
let failed = false;
try {
  for (const mode of MODES) {
    console.log(`\n▶ ${mode}`);
    const dialogs = [];
    const R = await newRoom(mode, { mode, classes: ['Whale', 'Enforcer', 'Pit Boss'], onDialog: (m) => dialogs.push(m) });
    let st = await stateOf(R.tv);
    ok(st.mode === mode && st.phase === 'playing', `a ${mode} run started`);
    if (mode === 'teams') {
      ok(dialogs.some(m => /on no team/.test(m)), `the GM was asked before starting Teams with nobody on a team (${dialogs.length} dialog)`);
    }
    const refusals = [];
    const seen = new Set();
    for (let t = 0; t < 6; t++) {
      const cur = await stateOf(R.tv); if (cur.phase !== 'playing') break;
      const mi = R.ids.indexOf(cur.moverId); if (mi < 0) { await sleep(500); continue; }
      const ph = R.phones[mi];
      await waitFor(ph, (pid) => window.__gwf.session.state.moverId === pid, '', cur.moverId, 5000).catch(() => {});
      const v = await playTurn(ph, { label: `${mode} turn ${t + 1} (${R.names[mi]})`, timeoutMs: 70000 });
      if (v.lastError) refusals.push(`${R.names[mi]}: ${v.lastError}`);
      seen.add(mi);
      await waitFor(R.tv, (n) => window.__gwf.session.state.turnIdx > n || window.__gwf.session.state.phase !== 'playing' || !!window.__gwf.session.state.challenge, `${mode}: turn ${cur.turnIdx + 1} ended by ${R.names[mi]}`, cur.turnIdx, 30000);
      if (t === 2) { await R.tv.screenshot({ path: `${shotDir}mode-${mode}-tv.png` }).catch(() => {}); await ph.screenshot({ path: `${shotDir}mode-${mode}-phone.png` }).catch(() => {}); }
    }
    st = await stateOf(R.tv);
    ok(st.turnIdx >= 5 || st.phase !== 'playing', `${mode}: ${st.turnIdx} turns played (phase ${st.phase})`);
    ok(seen.size >= 2, `${mode}: ${seen.size} of 3 phones took a turn`);
    ok(refusals.length === 0, `${mode}: no refusal landed on a phone (${refusals.join(' | ') || 'none'})`);
    const m = await R.tv.evaluate(() => { const d = document.documentElement; return { sw: d.scrollWidth, cw: d.clientWidth }; });
    ok(m.sw <= m.cw, `${mode}: the TV page fits its screen (${m.sw}/${m.cw})`);
    await R.close();
  }
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nMODES RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); if (pageErrors.length) console.error('page errors:', pageErrors.slice(0, 4)); }
await closeTable();
process.exit(failed ? 1 : 0);
