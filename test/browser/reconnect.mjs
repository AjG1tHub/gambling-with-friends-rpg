// Reconnect gate (QA pass, 3 Nov 2026): a phone, the TV or the GM console reloads (a lock screen, a dropped tab, a TV
// that went to sleep) in the middle of a fight and in the middle of a Challenge Wheel. After the reload everyone is
// still in their own seat on the right screen, the shared state is untouched, and play carries on to the end of the
// round. Three 360×640 Whales, a ws dev backend, tutorial opening off. `npm run build` first. Shots: test/shots/rc-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, click, stateOf, toPlod, openTable, closeTable, newRoom, reload } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the reconnect run ran past 5 minutes'); process.exit(1); }, 5 * 60 * 1000).unref();
await openTable();
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
  await R.close();

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
await closeTable();
process.exit(failed ? 1 : 0);
