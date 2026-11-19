// Late-features gate (19 Nov 2026): three things built on the night of 18–19 Nov, each through the real screens.
//   · a Shop revive: a living player on a Shop hex buys a dead one back from the phone
//   · a Legendary with a use: the Ocarina's song picker in the Cage item sheet
//   · the GM console's inventory panel: remove an item, grow the grid
// `npm run build` first. Shots: test/shots/feat-*.png.
import { shotDir, ok, sleep, waitFor, pageErrors, click, stateOf, stayPut, openTable, closeTable, newRoom } from './table-fixture.mjs';
setTimeout(() => { console.error('WATCHDOG: the features run ran past 5 minutes'); process.exit(1); }, 5 * 60 * 1000).unref();
await openTable();
let failed = false;
try {
  const R = await newRoom('features');
  R.gm.on('dialog', d => d.accept().catch(() => {}));
  let st = await stateOf(R.tv);
  const mover = st.moverId, mi = R.ids.indexOf(mover), ph = R.phones[mi], deadId = R.ids[(mi + 1) % 3], deadName = R.names[(mi + 1) % 3];
  const charOf = (s, pid) => Object.values(s.characters).find(c => c.playerId === pid);

  console.log('\n▶ 1. a Shop revive');
  const shop = Object.values(st.map.hexes).find(h => h.type === 'shop'); ok(!!shop, `a Shop hex exists (${shop?.key})`);
  await R.gmDo('GM_GOLD', { playerId: mover, amount: 300 });
  await R.gmDo('GM_HEALTH', { playerId: deadId, amount: -9999 });
  st = await stateOf(R.tv); ok(charOf(st, deadId).dead === true, `${deadName} is dead`);
  await R.gmDo('GM_TELEPORT', { playerId: mover, hex: shop.key });
  await stayPut(ph, R.names[mi]);
  await waitFor(ph, () => window.__gwf.session.state.turnPhase === 'action', 'action phase on the Shop', undefined, 20000);
  await waitFor(ph, () => !!document.querySelector('.table-biz.revive button'), 'the phone offers the revive');
  const label = await ph.evaluate(() => document.querySelector('.table-biz.revive button').textContent);
  ok(new RegExp(deadName, 'i').test(label) && /\d+ Gold/i.test(label), `the button names who and the price ("${label}")`);
  await ph.locator('.table-biz.revive').scrollIntoViewIfNeeded(); await ph.screenshot({ path: `${shotDir}feat-revive.png` }).catch(() => {});
  const gold0 = charOf(await stateOf(R.tv), mover).gold;
  await click(ph, '.table-biz.revive button', `${R.names[mi]} buys ${deadName} back`);
  await waitFor(R.tv, (id) => !Object.values(window.__gwf.session.state.characters).find(c => c.playerId === id).dead, `${deadName} is alive again`, deadId);
  st = await stateOf(R.tv); ok(charOf(st, mover).gold < gold0, `the Gold was paid (${gold0} → ${charOf(st, mover).gold})`);
  ok(st.log.some(l => /back from the Graveyard/.test(l.text)), 'the log says so');

  console.log('\n▶ 2. a Legendary with a use (the Ocarina)');
  await R.gmDo('GM_ITEM', { playerId: mover, baseId: 'ocarina' });
  await ph.evaluate(() => window.__gwf.session.dispatch('GRID_SORT', {}, window.__gwf.ctx.me)); await sleep(600);
  st = await stateOf(R.tv); const oc = Object.values(charOf(st, mover).items).find(i => i.legendaryId === 'ocarina');
  ok(!!oc, 'GM Give item with a Legendary id hands over the Legendary');
  await ph.locator('.tabs button', { hasText: 'Cage' }).first().click(); await sleep(400);
  await click(ph, `[data-item-id="${oc.id}"]`, 'opens the Ocarina\'s sheet');
  await waitFor(ph, () => document.querySelectorAll('.sheet-use button').length === 3, 'the sheet offers three songs');
  await ph.screenshot({ path: `${shotDir}feat-ocarina.png` }).catch(() => {});
  await click(ph, ph.locator('.sheet-use button', { hasText: /chaos/i }), 'plays the Chaos song');
  await waitFor(R.tv, (id) => Object.values(window.__gwf.session.state.characters).find(c => c.playerId === id).effects.some(e => e.id === 'skipchaos'), 'the song took effect', mover);
  await click(ph, `[data-item-id="${oc.id}"]`, 'opens it again'); await sleep(300);
  ok((await ph.locator('.sheet-use button').count()) === 2, 'a sung song is gone from the picker');

  console.log('\n▶ 3. the GM opens a player\'s inventory');
  await R.gm.locator('.gm-nav button', { hasText: /Rig/ }).first().click();
  await click(R.gm, R.gm.locator('.inv-panel button', { hasText: R.names[mi] }), 'GM opens the inventory');
  st = await stateOf(R.tv); const before = charOf(st, mover), n0 = Object.keys(before.items).length, cols0 = before.grid.cols;
  await waitFor(R.gm, (n) => document.querySelectorAll('.inv-panel .item').length === n, `${n0} items listed`, n0);
  await click(R.gm, R.gm.locator('.inv-panel button', { hasText: '+ column' }), 'grows the grid'); await sleep(500);
  await click(R.gm, R.gm.locator('.inv-panel .item', { hasText: 'Ocarina' }).locator('button.danger'), 'removes the Ocarina');
  await waitFor(R.tv, ([id, n]) => Object.keys(Object.values(window.__gwf.session.state.characters).find(c => c.playerId === id).items).length === n - 1, 'the item left the run', [mover, n0]);
  st = await stateOf(R.tv); ok(charOf(st, mover).grid.cols === cols0 + 1, `the grid grew (${cols0} → ${charOf(st, mover).grid.cols} columns)`);
  ok(!Object.values(st.tileLoot || {}).flat().some(e => (e.item || e).legendaryId === 'ocarina'), 'a GM removal does not drop the item on the tile');
  ok(st.lastError == null, `no refusal along the way (${JSON.stringify(st.lastError)})`);
  ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
  console.log('\nFEATURES RUN PASSED');
} catch (e) { failed = true; console.error('\n' + (e.stack || e.message)); }
await closeTable();
process.exit(failed ? 1 : 0);
