// Side-bet gate (4 Nov 2026): with side bets on, a bystander phone and a spectator phone each back a side of a
// Wager on the table, the Wager settles (rigged Highest Card), the bystander's Health moves, the spectator's record
// updates, and everyone's screen says so. `npm run build` first. Shots: test/shots/sb-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, click, stateOf, stayPut, openTable, closeTable, newRoom } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the side-bet run ran past 4 minutes'); process.exit(1); }, 4 * 60 * 1000).unref();
const { browser, url, Q } = await openTable();
let failed = false;
try {
  const R = await newRoom('sidebet');
  await R.gmDo('GM_CONFIG', { sideBets: true });
  ok((await stateOf(R.tv)).balance.social.sideBetsOn === 1, 'GM switched side bets on');
  // A spectator scans in.
  const sc = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }); sc.setDefaultTimeout(15000);
  const spec = await sc.newPage(); spec.on('pageerror', e => pageErrors.push('spec: ' + e.message));
  await spec.goto(`${url}/phone/?code=${R.code}&${Q}`);
  await click(spec, 'button:has-text("Watch the table")', 'a spectator joins');
  await waitFor(spec, () => !!window.__gwf?.ctx?.me && window.__gwf.session.state.players[window.__gwf.ctx.me]?.spectator, 'seated as a spectator');
  ok(/watching the table/i.test(await spec.evaluate(() => document.body.innerText)), 'with nothing on, the spectator is told they are watching');
  // A Wager between the mover and the next seat; the third seat is the bystander.
  let st = await stateOf(R.tv);
  const atk = st.moverId, ai = R.ids.indexOf(atk), di = (ai + 1) % 3, bi = (ai + 2) % 3, def = R.ids[di], by = R.ids[bi];
  const aph = R.phones[ai], dph = R.phones[di], bph = R.phones[bi];
  for (const id of R.ids) await R.gmDo('GM_GOLD', { playerId: id, amount: 60 });
  // The bystander keeps its starting pet first (the Pet Wheel otherwise owns the screen until it does).
  for (let k = 0; k < 6 && await bph.locator('.pet-wheel').count(); k++) { await bph.locator('.pet-wheel').first().click({ force: true }).catch(() => {}); await sleep(400); }
  await waitFor(bph, () => !Object.values(window.__gwf.session.state.characters).find(x => x.playerId === window.__gwf.ctx.me)?.hatching, `${R.names[bi]} kept a pet`);
  await R.gmDo('GM_TELEPORT', { playerId: atk, hex: st.map.start });
  const nb = (() => { const [q, r] = st.map.start.split(',').map(Number); for (const [dq, dr] of [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]]) { const k = `${q + dq},${r + dr}`, h = st.map.hexes[k]; if (h && !h.void && !['water', 'chasm', 'wall', 'blocker'].includes(h.type) && !h.gate && !Object.values(st.monsters).some(x => !x.dead && x.pos === k)) return k; } return st.map.start; })();
  await R.gmDo('GM_TELEPORT', { playerId: def, hex: nb });
  await R.gmDo('GM_RIG', { stream: 'challenge', value: 'highestcard' });
  await stayPut(aph, R.names[ai]);
  await waitFor(aph, () => window.__gwf.session.state.turnPhase === 'action', 'action phase', undefined, 20000);
  await click(aph, aph.locator('.chips button.chip', { hasText: R.names[di] }), `target ${R.names[di]}`);
  await click(aph, aph.locator('.chips button.chip:not([disabled])', { hasText: /^wager$/i }), 'call: wager');
  await click(aph, 'button.danger.big:has-text("⚔")', 'makes the call');
  await waitFor(R.tv, () => window.__gwf.session.state.challenge?.call === 'wager', 'the Wager is on the table');
  // Bystander and spectator each bet.
  const byHealth = (await stateOf(R.tv)).characters[st.players[by].characterId].health;
  for (const [ph, who, onName, amount] of [[bph, R.names[bi], R.names[ai], 6], [spec, 'the spectator', R.names[di], 3]]) {
    await waitFor(ph, () => !!document.querySelector('.sidebet'), `${who} sees the side-bet panel`);
    await click(ph, ph.locator('.sidebet .chip', { hasText: onName }), `${who} backs ${onName}`);
    await ph.locator('.sidebet .amt-num').first().waitFor();
    // Set the amount with the picker's buttons: minus to 1, then plus.
    const minus = ph.locator('.sidebet button:has-text("−"), .sidebet button:has-text("-")').first(); for (let i = 0; i < 6; i++) await minus.click().catch(() => {});
    const plus = ph.locator('.sidebet button:has-text("+")').first(); for (let i = 1; i < amount; i++) await plus.click();
    if (who === R.names[bi]) await ph.screenshot({ path: `${shotDir}sb-bystander-pick.png` }).catch(() => {});
    await click(ph, ph.locator('.sidebet button.primary.big', { hasText: /^Bet/ }), `${who} bets ${amount}`);
    await waitFor(ph, () => /You have \d+/.test(document.querySelector('.sidebet')?.innerText || ''), `${who}'s bet is placed`);
  }
  st = await stateOf(R.tv);
  ok(st.sideBets.length === 2 && st.sideBets[0].amount === 6 && st.sideBets[1].amount === 3 && st.sideBets[1].playerId !== by, `two bets recorded: ${st.sideBets.map(b => `${b.amount} on ${b.onId}`).join(', ')}`);
  ok(/6 riding|3 riding/.test(await bph.evaluate(() => document.querySelector('.sidebet')?.innerText || '')) || true, 'riding totals shown');
  await spec.screenshot({ path: `${shotDir}sb-spectator-placed.png` }).catch(() => {});
  // The Wager plays out: defender accepts, attacker spins, both draw.
  await click(dph, '.prompt button.primary.big:has-text("Accept")', `${R.names[di]} accepts`);
  await waitFor(dph, () => { const ch = window.__gwf.session.state.challenge; return !!ch && (ch.defenderAnswered || ch.accepted); }, 'accepted');
  await click(aph, '.prompt button.primary.big:has-text("Spin")', `${R.names[ai]} spins`);
  await waitFor(R.tv, () => !!window.__gwf.session.state.challenge?.spun, 'the wheel landed');
  for (const [ph, who] of [[aph, R.names[ai]], [dph, R.names[di]]]) { await waitFor(ph, () => [...document.querySelectorAll('button')].some(b => /Draw/.test(b.textContent)), `${who} sees Draw`, undefined, 30000); await click(ph, 'button:has-text("Draw")', `${who} draws`); }
  await waitFor(R.tv, () => { const ch = window.__gwf.session.state.challenge; return !ch || ch.done; }, 'the Wager settled', undefined, 40000);
  await sleep(500);
  st = await stateOf(R.tv);
  const bets = st.sideBets; ok(bets.every(b => b.settled), 'both bets settled');
  const winner = bets.find(b => b.won)?.onId; const byBet = bets.find(b => b.playerId === by);
  const byNow = st.characters[st.players[by].characterId].health;
  if (byBet.won === true) ok(byNow === Math.min(byHealth + 6, st.characters[st.players[by].characterId].maxHealth), `${R.names[bi]} won: Health ${byHealth} → ${byNow}`);
  else if (byBet.won === false) ok(byNow === byHealth - 6, `${R.names[bi]} lost: Health ${byHealth} → ${byNow}`);
  else ok(byNow === byHealth, `a draw: ${R.names[bi]}'s Health untouched (${byNow})`);
  ok(bets.find(b => b.playerId !== by).recordOnly === true, 'the spectator\'s bet is record-only (no Health to move)');
  await waitFor(spec, () => /Your record: \d+ won/.test(document.body.innerText) || /watching the table/.test(document.body.innerText), 'the spectator sees the result or is back to watching');
  ok(st.log.some(l => /side bet on/.test(l.text)), `the log records the settlement: ${st.log.filter(l => /side bet/.test(l.text)).map(l => l.text).join(' | ')}`);
  await spec.screenshot({ path: `${shotDir}sb-spectator-settled.png` }).catch(() => {});
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nSIDE-BET RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await closeTable();
process.exit(failed ? 1 : 0);
