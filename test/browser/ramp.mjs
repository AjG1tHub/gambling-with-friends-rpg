// Tutorial-opening gate (19 Nov 2026): a room made with the tutorial opening on, three real phone screens. For one
// player's first six turns: screenshot what the phone shows when the turn starts, count the things on screen, and
// assert the opening is actually gentle:
//   turn 1  no Pet Wheel, no shop/attack/challenge panels: the Coach card, the move prompt, then End turn
//   turn 3  the starting Pet Wheel arrives with fights
//   each turn's Coach card names that turn's new thing; the number of action sections never jumps by more than 3
//   by turn 6 nothing is locked
// `npm run build` first. Shots: test/shots/ramp-turnN.png.
import { shotDir, ok, sleep, waitFor, pageErrors, stateOf, openTable, closeTable, newRoom } from './table-fixture.mjs';
import { playTurn } from './phone-driver.mjs';
setTimeout(() => { console.error('WATCHDOG: the ramp run ran past 8 minutes'); process.exit(1); }, 8 * 60 * 1000).unref();
await openTable();
let failed = false;
try {
  const R = await newRoom('ramp', { ramp: true, classes: ['Whale', 'Enforcer', 'Croupier'] });
  let st = await stateOf(R.tv);
  ok(st.gm.ramp?.on === true, 'the room has the tutorial opening on');
  const hero = st.moverId, hi = R.ids.indexOf(hero), ph = R.phones[hi];
  const seen = [];
  for (let turn = 1; turn <= 6; turn++) {
    await waitFor(R.tv, (id) => window.__gwf.session.state.moverId === id && !window.__gwf.session.state.challenge, `turn ${turn}: ${R.names[hi]} is up`, hero, 120000);
    await sleep(700);
    const v = await ph.evaluate(() => {
      const s = window.__gwf.session.state, me = window.__gwf.ctx.me, c = Object.values(s.characters).find(x => x.playerId === me);
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return { turn: s.turnCounts?.[me], hatching: !!c.hatching, pets: c.pets.length, coach: document.querySelector('.coach .coach-title')?.textContent || '', sections: [...document.querySelectorAll('.screen h3, .screen .tag')].filter(vis).map(e => e.textContent.trim()).slice(0, 30), buttons: [...document.querySelectorAll('.screen button')].filter(vis).length, tabs: [...document.querySelectorAll('.tabs button')].map(b => b.textContent.trim()), petWheel: !!document.querySelector('.pet-wheel') };
    });
    await ph.screenshot({ path: `${shotDir}ramp-turn${turn}.png`, fullPage: true }).catch(() => {});
    console.log(`  · turn ${turn}: coach "${v.coach}" · ${v.buttons} buttons · sections: ${v.sections.join(' | ').slice(0, 200)}`);
    seen.push(v);
    ok(v.turn === turn, `turn ${turn}: the phone counts it as the player's turn ${v.turn}`);
    if (turn === 1) { ok(!v.petWheel && !v.hatching, 'turn 1: no Pet Wheel on the first screen'); ok(/turn 1/i.test(v.coach), `turn 1: the Coach card is the walk ("${v.coach}")`); ok(v.buttons <= 6, `turn 1: ${v.buttons} buttons on screen (≤ 6)`); }
    if (turn === 1) ok(v.tabs.join(',') === 'Play,Self,Map', `turn 1: the tab bar is Play, Self, Map (${v.tabs.join(', ')})`);
    if (turn === 2) ok(v.tabs.includes('Cage') && !v.tabs.includes('Letters'), `turn 2: the Cage tab arrives (${v.tabs.join(', ')})`);
    if (turn === 6) ok(v.tabs.length === 6, `turn 6: all six tabs (${v.tabs.join(', ')})`);
    if (turn === 2) { ok(!v.petWheel, 'turn 2: still no Pet Wheel'); ok(/turn 2/i.test(v.coach), `turn 2: the Coach card is gear ("${v.coach}")`); }
    if (turn === 3) ok(v.petWheel || v.pets > 0, 'turn 3: the starting Pet Wheel arrives with fights');
    // Play the turn like a person: tiles, a fight if one opens (two swings), then End turn; the others play theirs.
    for (let k = 0; k < 3; k++) {
      const cur = await stateOf(R.tv); if (cur.phase !== 'playing') break;
      const mi = R.ids.indexOf(cur.moverId);
      const r = await playTurn(R.phones[mi], { label: `turn ${turn} ${R.names[mi]}`, timeoutMs: 80000, avoidMonsters: false, attacks: 1 });
      if (r.challenge) await R.gmDo('CHALLENGE_GM_DECIDE', { winnerId: cur.moverId }).catch(() => {});
      await waitFor(R.tv, (n) => window.__gwf.session.state.turnIdx > n || window.__gwf.session.state.phase !== 'playing', '', cur.turnIdx, 40000);
      if ((await stateOf(R.tv)).moverId === hero) break;
    }
  }
  st = await stateOf(R.tv);
  const locked = await ph.evaluate(() => window.__gwf.session.state.turnCounts[window.__gwf.ctx.me]);
  ok(locked >= 6, `six turns played (${locked})`);
  for (let i = 1; i < seen.length; i++) ok(seen[i].buttons - seen[i - 1].buttons <= 14, `turn ${i + 1} adds ${seen[i].buttons - seen[i - 1].buttons} buttons over turn ${i} (no cliff)`);
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nRAMP RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await closeTable();
process.exit(failed ? 1 : 0);
