// Table-business gate (19 Nov 2026): the three things that had an engine but no way for a person to reach them.
//   · a Chaos vote opened from the GM console: every phone gets the ballot, casts, the TV closes it at the deadline
//   · a trade (an item for Gold): the recipient's phone shows both sides, Accept, it settles at the end of the turn
//   · a house auction opened from the GM console: phones seal bids, the TV closes it and reveals every bid
// `npm run build` first. Shots: test/shots/tb-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, click, stateOf, stayPut, openTable, closeTable, newRoom } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the table-business run ran past 5 minutes'); process.exit(1); }, 5 * 60 * 1000).unref();
await openTable();
let failed = false;
try {
  const R = await newRoom('table-biz');
  // Shorter windows so the gate does not sit through two 30 s timers.
  await R.gmDo('GM_CONFIG', { balance: { social: { voteSeconds: 10 }, auction: { windowSeconds: 10 } } });
  for (const id of R.ids) await R.gmDo('GM_GOLD', { playerId: id, amount: 90 });
  // Everyone keeps a starting pet so the Pet Wheel is out of the way.
  for (const ph of R.phones) { for (let k = 0; k < 6 && await ph.locator('.pet-wheel').count(); k++) { await ph.locator('.pet-wheel').first().click({ force: true }).catch(() => {}); await sleep(400); } }

  console.log('\n▶ 1. a Chaos vote from the GM console');
  await R.gm.locator('.gm-nav button', { hasText: /^Run$/i }).first().click();
  await click(R.gm, 'button:has-text("Chaos vote")', 'GM opens a Chaos vote');
  await waitFor(R.tv, () => !!window.__gwf.session.state.votes, 'the vote is open');
  ok((await R.tv.locator('.vote-panel').count()) > 0, 'the TV shows the secret vote panel');
  const target = R.names[0];
  for (let i = 0; i < 3; i++) {
    await waitFor(R.phones[i], () => !!document.querySelector('.table-biz.vote'), `${R.names[i]}'s phone shows the ballot`);
    if (i < 2) { await click(R.phones[i], R.phones[i].locator('.table-biz.vote .chip', { hasText: target }), `${R.names[i]} votes`); await waitFor(R.phones[i], () => /your ballot is in/i.test(document.querySelector('.table-biz.vote')?.innerText || ''), 'ballot acknowledged'); }
  }
  await R.phones[0].screenshot({ path: `${shotDir}tb-vote-phone.png` }).catch(() => {});
  await waitFor(R.tv, () => !window.__gwf.session.state.votes && !!window.__gwf.session.state.lastVote, 'the TV closed the vote at its deadline (one phone never voted)', undefined, 25000);
  let st = await stateOf(R.tv);
  ok(st.lastVote.result === R.ids[0] && st.lastVote.tally[R.ids[0]] === 2, `the tally names ${target} (2 ballots)`);
  ok(st.log.some(l => /Chaos chooses/.test(l.text)), 'the log announces the result');

  console.log('\n▶ 2. a trade: an item for Gold');
  const sellerI = 0, buyerI = 1, seller = R.ids[sellerI], buyer = R.ids[buyerI];
  await R.gmDo('GM_ITEM', { playerId: seller, baseId: 'helmet', rarity: 'rare' });
  st = await stateOf(R.tv);
  const sc = Object.values(st.characters).find(c => c.playerId === seller);
  const packed = Object.values(sc.items).find(it => !Object.values(sc.worn || {}).some(w => w && w.id === it.id));
  ok(!!packed, `the seller holds a packed item to trade (${packed?.name})`);
  await R.phones[sellerI].evaluate(([to, id]) => window.__gwf.session.dispatch('TRADE_OFFER', { toId: to, give: { itemIds: [id] }, want: { gold: 25 } }, window.__gwf.ctx.me), [buyer, packed.id]);
  await waitFor(R.phones[buyerI], () => !!document.querySelector('.table-biz.trade button.primary'), `${R.names[buyerI]}'s phone shows the offer with Accept / Decline`);
  const txt = await R.phones[buyerI].evaluate(() => document.querySelector('.table-biz.trade').innerText);
  ok(txt.includes(packed.name) && /25 Gold/.test(txt), `both sides are spelled out ("${txt.replace(/\n/g, ' ').slice(0, 90)}…")`);
  await R.phones[buyerI].screenshot({ path: `${shotDir}tb-trade-phone.png` }).catch(() => {});
  await click(R.phones[buyerI], '.table-biz.trade button.primary', `${R.names[buyerI]} accepts`);
  await waitFor(R.tv, () => window.__gwf.session.state.trades.at(-1).status === 'accepted', 'the trade is accepted');
  ok((await R.gm.evaluate(() => document.body.innerText)).includes(packed.name), 'the GM console lists the trade');
  // It settles at the next end of turn: the mover ends theirs.
  st = await stateOf(R.tv); const mi = R.ids.indexOf(st.moverId);
  await stayPut(R.phones[mi], R.names[mi]);
  await waitFor(R.phones[mi], () => window.__gwf.session.state.turnPhase === 'action', 'action phase', undefined, 20000);
  await click(R.phones[mi], 'button:has-text("End turn")', `${R.names[mi]} ends the turn`);
  await waitFor(R.tv, () => window.__gwf.session.state.trades.at(-1).status === 'settled', 'the trade settled at the end of the turn');
  st = await stateOf(R.tv);
  const bc = Object.values(st.characters).find(c => c.playerId === buyer);
  ok(!!bc.items[packed.id] || (bc.pendingLoot || []).some(l => (l.item?.id || l.id) === packed.id), 'the item is with the buyer (in the grid or waiting to be placed)');

  console.log('\n▶ 3. a house auction');
  await click(R.gm, 'button:has-text("House auction: a rare item")', 'GM opens a house auction');
  await waitFor(R.tv, () => !!window.__gwf.session.state.auction && !window.__gwf.session.state.auction.done, 'the auction is open');
  ok((await R.tv.locator('.auction-panel').count()) > 0, 'the TV shows the sealed auction panel');
  for (const [i, extra] of [[0, 0], [1, 2]]) {
    const ph = R.phones[i];
    await waitFor(ph, () => !!document.querySelector('.table-biz.auction button.primary'), `${R.names[i]}'s phone shows the bid box`);
    const plus = ph.locator('.table-biz.auction button[aria-label="more"]').first(); for (let k = 0; k < extra; k++) await plus.click();
    await click(ph, '.table-biz.auction button.primary', `${R.names[i]} seals a bid`);
    await waitFor(ph, () => /change bid/i.test(document.querySelector('.table-biz.auction')?.innerText || ''), 'bid sealed');
  }
  ok(!/\d+ Gold.*\d+ Gold/.test(await R.tv.evaluate(() => document.querySelector('.auction-panel')?.innerText || '')) , 'bids stay sealed on the TV while it is open');
  await waitFor(R.tv, () => window.__gwf.session.state.auction?.done === true, 'the TV closed the auction at its deadline', undefined, 25000);
  await sleep(1200);
  const reveal = await R.tv.evaluate(() => document.querySelector('.auction-panel')?.innerText || '');
  ok(/SOLD to/.test(reveal) && /Bids:/.test(reveal), `the TV reveals the result and every bid ("${reveal.replace(/\n/g, ' ').slice(0, 110)}")`);
  await R.tv.screenshot({ path: `${shotDir}tb-auction-tv.png` }).catch(() => {});
  st = await stateOf(R.tv);
  ok(st.auction.result.winnerId === R.ids[1], `${R.names[1]} (the higher bid) won`);
  ok(st.lastError == null, `no refusal along the way (${JSON.stringify(st.lastError)})`);
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nTABLE-BUSINESS RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await closeTable();
process.exit(failed ? 1 : 0);
