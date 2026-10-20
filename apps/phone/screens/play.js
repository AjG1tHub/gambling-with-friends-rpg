// Phone tab: Play — the current prompt with big buttons (SPEC.md › Phone UI; A turn; What each tile does). This file
// is the dispatcher plus the movement screen, the action phase and the end-of-run recap; creation, prompts, fights
// and the Challenge Wheel live beside it in ./creation.js, ./prompts.js, ./fight.js and ./challenge.js.
import { toast, buzz } from '../../../packages/ui/dom.js';
import { currentPlayerId, characterOf } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { legalSteps, cardView, bootsOf, bootMode, bootDie, bootAffixes, BOOTS } from '../../../packages/shared/handlers/movement.js';
import { tileLabel, tileGlyph, livingMonsterAt, charactersAt, hexDistance, reachableFrom } from '../../../packages/shared/map/query.js';
import { priceOf, sellPriceOf, openPacts, pactInterest } from '../../../packages/shared/handlers/economy.js';
import { reachOf } from '../../../packages/shared/handlers/items.js';
import { gameMeta } from '../../../packages/games/adapter.js';
import { rosette } from '../../../packages/ui/rosette.js';
import { diceElement, wheelStrip, rollOnce } from '../../../packages/ui/dice.js';
import { cardRow } from '../../../packages/ui/cards.js';
import { hexMini } from '../../../packages/ui/hexmini.js';
import { creationScreen } from './creation.js';
import { fightScreen, attackMenu, classActiveRow } from './fight.js';
import { challengeScreen, challengeBanner } from './challenge.js';
import { renderPrompt, hatchingScreen, areaWindow, waitingScreen, sect, why, amountPicker, itemRow, nameOf, gridItems, weapons, consumables, playHooks, redraw } from './prompts.js';

const B = (state) => ({ B: (g) => group(state, g), now: Date.now(), payload: {}, actor: 'phone', isGm: false });
const EMOTES = ['😈', '😱', '🤝', '🖕', '😂', '💀', '🍻', '👀'];
const ui = { call: 'duel', target: null, amount: 10, weapon: null, mapOpen: false, pactAmount: 30 };

// main.js hands `me` as the player object; the screens want the id, so `api.me` is the id and `api.player` the seat.
export function tabPlay(raw) {
  playHooks.tabPlay = tabPlay;
  const api = raw.player ? raw : { ...raw, me: raw.me?.id || raw.ctx?.me, player: raw.me };
  const { h, screen } = api;
  try { route(api); } catch (e) { console.error(e); screen.append(h('p', { class: 'log error' }, `The Play tab hit a snag: ${e.message}`), h('button', { class: 'ghost', onClick: () => redraw(api) }, 'Try again')); }
}
function route(api) {
  const { state, me, player, c, myTurn, h, dispatch, screen } = api;
  if (state.phase === 'lobby' || state.phase === 'creation') return creationScreen(api);
  if (state.phase === 'ended') return endedScreen(api);
  const pid = currentPlayerId(state);
  const banner = state.challenge && !state.challenge.done ? null : challengeBanner(api); if (banner) screen.append(banner);
  if (player.spectator) { screen.append(waitingScreen(api, pid), h('p', { class: 'muted center ital' }, 'You are watching and wagering.')); return; }
  if (!c) { screen.append(h('div', { class: 'hero' }, h('h2', {}, 'No character'), h('p', { class: 'muted' }, 'The run started without you; the GM can seat you from the console.'))); return; }
  if (state.gm?.paused) screen.append(h('div', { class: 'ch-banner draw' }, h('b', {}, 'Paused'), h('span', { class: 'meta' }, 'The GM froze every clock.')));
  if (c.hatching) return screen.append(hatchingScreen(api));
  if (challengeScreen(api)) return;
  if (state.held[me]) { screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Held'), h('p', { class: 'muted' }, 'Your seat is held while a challenge settles; you rejoin the order right after.'))); return; }
  if (state.area && !state.area.done && state.area.hexKey === c.pos && !c.dead) { screen.append(areaWindow(api)); if (state.area.attackerPlayerId !== me) return; }
  const pr = state.pendingPrompt;
  if (pr && (pr.playerId === me || (pr.kind === 'callout' && pr.targetId === me)) && renderPrompt(api, pr)) return;
  const f = state.fight && !state.fight.done ? state.fight : null;
  if (f && (f.playerId === me || (f.playerIds || []).includes(me)) && fightScreen(api)) return;
  if (!myTurn) return screen.append(waitingScreen(api, pid));
  if (c.dead) { screen.append(h('div', { class: 'hero' }, h('h2', {}, 'You are dead'), h('p', { class: 'muted' }, `${c.missTurns || 0} more turn${c.missTurns === 1 ? '' : 's'} before you wake at the Graveyard at half Health.`)), h('button', { class: 'primary big', onClick: () => dispatch('TURN_END', {}) }, 'Pass')); return; }
  if (state.turnPhase === 'move') return movementScreen(api);
  if (state.turnPhase === 'resolve') { screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Resolving'), h('p', { class: 'muted ital' }, `${tileLabel(state.map?.hexes?.[c.pos]?.type || '')} is working…`), h('button', { class: 'ghost', onClick: () => dispatch('TURN_END', {}) }, 'End turn anyway'))); return; }
  return actionScreen(api);
}

// ── movement ─────────────────────────────────────────────────────────────────────────────────────
function bootsLine(state, c) {
  const item = bootsOf(c); if (!item) return { text: 'Barefoot · plod ' + group(state, 'movement').barefoot, mode: 'barefoot', item: null };
  let mode = 'dice'; try { mode = bootMode(item, {}); } catch { mode = 'choose'; }
  const die = mode === 'dice' ? bootDie(item, bootAffixes(item)) : null;
  const base = BOOTS.bases.find(b => b.id === item.baseId);
  return { text: `${item.name} · ${mode === 'choose' ? 'choose your mode' : mode.toUpperCase()}${die ? ` · d${die}` : ''}${item.unique ? ` · ${BOOTS.uniques[item.unique]?.name || item.unique}` : ''}`, mode, item, die, base };
}
function movementScreen(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const s = state.moveSession && state.moveSession.playerId === me && !state.moveSession.done ? state.moveSession : null;
  const boots = bootsLine(state, c);
  const MV = group(state, 'movement');
  screen.append(h('div', { class: 'row between boots-line' }, h('span', { class: 'tag' }, boots.text), s && s.mode !== 'card' ? h('span', { class: 'moves' }, h('b', {}, String(s.movesLeft)), ' MOVES LEFT') : null));
  if (!s) {
    if (c.usedThisTurn?.moved) { screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Moved'), h('p', { class: 'muted' }, 'Your move is spent this turn.'), boots.item?.unique === 'movetwice' && (c.usedThisTurn.moves || 0) < 2 ? h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', {}) }, 'Move again') : null, h('button', { class: 'big', onClick: () => dispatch('TURN_END', {}) }, 'End turn'))); return; }
    const box = h('div', { class: 'prompt' });
    if (boots.mode === 'barefoot') box.append(h('h3', {}, 'Barefoot'), h('p', { class: 'muted' }, `No boots on your feet: you plod ${MV.barefoot} hexes. Find boots in a chest or a shop.`), h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', {}) }, '🦶 Plod'));
    else if (boots.mode === 'choose') box.append(h('h3', {}, boots.item.name), h('p', { class: 'muted' }, 'Pick how you move this turn.'), h('div', { class: 'btn-grid three' }, ['dice', 'wheel', 'card'].map(m => h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', { mode: m }) }, m.toUpperCase()))));
    else if (boots.mode === 'dice') box.append(h('h3', {}, `Roll the d${boots.die}`), h('p', { class: 'muted' }, boots.base?.text || 'Roll, then step up to the roll.'), diceElement({ dice: [boots.die], rolls: [] }), h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', {}) }, '🎲 Roll'));
    else if (boots.mode === 'wheel') box.append(h('h3', {}, 'Spin the movement wheel'), h('p', { class: 'muted' }, boots.base?.text || '1 to 6, Sprint, Stumble, Teleport, Swap.'), h('img', { class: 'wheel-face', src: '/wheels/movement.svg', alt: '', onError: (e) => { e.target.remove(); } }), h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', {}) }, '🎡 Spin'));
    else box.append(h('h3', {}, 'Draw a colour'), h('p', { class: 'muted' }, `The nearest hex of that colour within ${MV.cardRange} is where you go. The colours below are yours alone.`), h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', {}) }, '🂠 Draw'));
    screen.append(box);
    const others = Object.values(c.items || {}).filter(it => it.slot === 'boots' && it.id !== boots.item?.id);
    if (others.length) { const sw = sect('Swap boots (costs the move)'); for (const it of others) sw.append(itemRow({ item: it, meta: BOOTS.bases.find(b => b.id === it.baseId)?.text || it.bootMode || '', action: 'LACE UP', onTap: () => dispatch('MOVE_SWAP_BOOTS', { itemId: it.id }) })); screen.append(sw); }
    const cv = cardView(state, me);
    screen.append(miniMap(api, { colours: cv ? Object.fromEntries(cv.hexes.map(x => [x.key, x.colour])) : null, height: 200 }));
    screen.append(h('button', { class: 'ghost', onClick: () => dispatch('TURN_END', {}) }, 'Skip the move and end the turn'));
    return;
  }
  // a session is open
  const rollKey = `${me}:${state.turnIdx}:${s.roll}:${s.mode}:${(s.dice || []).join('')}`;
  const rolling = rollOnce(rollKey);
  if (s.mode === 'dice' || s.mode === 'barefoot') {
    if (s.dice?.length) screen.append(diceElement({ dice: s.dice, rolls: s.rolls || [], rolling, ms: 850, onDone: () => redraw(api) }));
    if (rolling && s.dice?.length) { screen.append(h('p', { class: 'center tag' }, 'Rolling…')); return; }
    screen.append(h('p', { class: 'center muted' }, s.mode === 'barefoot' ? `You plod ${s.roll}.` : `Rolled ${s.rolls?.join(' + ') || s.roll}${s.rolls?.length > 1 ? ` = ${s.roll}` : ''}. ${s.mustWalk ? 'These boots walk the full roll.' : s.canStopAfter > s.stepsTaken ? `Walk at least ${s.canStopAfter} before you stop.` : 'Stop whenever you like.'}`));
  } else if (s.mode === 'wheel') {
    const spin = state.lastSpin?.wheel === 'movement' && state.lastSpin.playerId === me ? state.lastSpin : null;
    if (spin) { const strip = wheelStrip({ outcomes: spin.outcomes, index: spin.index, title: 'the movement wheel' }); screen.append(strip); if (rolling) { animateStrip(strip, spin.index, () => redraw(api)); screen.append(h('p', { class: 'center tag' }, 'Spinning…')); return; } }
    screen.append(h('p', { class: 'center muted' }, `${s.wheel}: ${s.roll} step${s.roll === 1 ? '' : 's'}.`));
  } else if (s.mode === 'card') {
    const cv = cardView(state, me);
    const cards = cv?.cards || (cv?.card ? [cv.card] : []);
    screen.append(cardRow(cards, { peek: cv?.peek || null }));
    if (s.atomic && s.destinations?.length) {
      screen.append(h('p', { class: 'center muted' }, `Nearest ${s.cards ? 'matching' : (s.card?.colour || '')} hex${s.destinations.length > 1 ? 'es' : ''} within ${cv?.range}: tap one on the map.`));
      screen.append(miniMap(api, { colours: Object.fromEntries((cv?.hexes || []).map(x => [x.key, x.colour])), lit: new Set(s.destinations), height: 280, onTap: (key) => { if (s.destinations.includes(key)) dispatch('MOVE_STEP', { to: key }); else toast('Not one of the lit hexes', 'bad'); } }));
      screen.append(h('div', { class: 'btn-grid' }, s.destinations.slice(0, 4).map(k => { const hx = state.map.hexes[k]; return h('button', { class: 'primary', onClick: () => dispatch('MOVE_STEP', { to: k }) }, `${tileGlyph(hx?.type)} ${tileLabel(hx?.type)}`); })));
      return;
    }
    screen.append(h('p', { class: 'center muted' }, `No ${s.card?.colour || 'matching'} hex within ${cv?.range || MV.cardRange}: step ${s.roll} instead.`));
  }
  // the rosette
  const steps = legalSteps(state, me);
  const blocked = steps.every(x => !x.legal);
  const stopWhy = s.awaiting ? `answer the ${s.awaiting} prompt first` : !blocked && s.stepsTaken < s.canStopAfter ? (s.mustWalk ? `walk the full ${s.roll}` : `walk at least ${s.canStopAfter} of ${s.roll} first`) : '';
  screen.append(rosette({ steps, onStep: (dir) => dispatch('MOVE_STEP', { dir }), onStop: () => dispatch('MOVE_STOP', {}), stop: { label: blocked ? 'STOP (BLOCKED)' : s.stepsTaken ? 'STOP HERE' : 'STAY PUT', disabled: !!stopWhy, reason: stopWhy } }));
  if (stopWhy) screen.append(why(stopWhy));
  const cv = cardView(state, me);
  screen.append(miniMap(api, { colours: cv ? Object.fromEntries(cv.hexes.map(x => [x.key, x.colour])) : null, lit: new Set(steps.filter(x => x.legal).map(x => x.key)), height: 220, path: s.path, onTap: (key) => { if (key === c.pos) return; dispatch('MOVE_PATH', { to: key }); } }));
  screen.append(why('Tap a hex on the map to path there one step at a time; a wrong tap costs one move, not the turn.'));
}
function animateStrip(strip, index, onDone) {
  const segs = [...strip.querySelectorAll('.seg')]; if (!segs.length) { onDone(); return; } let i = 0, n = 0; const total = segs.length * 2 + index;
  const tick = () => { if (!strip.isConnected) return; segs.forEach(x => x.classList.remove('hit')); segs[i % segs.length].classList.add('hit'); if (n++ >= total) { onDone(); return; } i++; setTimeout(tick, 45 + n * 7); };
  tick();
}
function miniMap(api, opts = {}) {
  const { state, me, c } = api;
  return hexMini({ state, me, c, height: opts.height || 220, colours: opts.colours || null, lit: opts.lit || null, path: opts.path || null, onTap: opts.onTap || null });
}

// ── action phase ─────────────────────────────────────────────────────────────────────────────────
function actionScreen(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const here = state.map?.hexes?.[c.pos]; const type = here?.type;
  const spin = state.lastSpin && state.lastSpin.playerId === me && Date.now() - state.lastSpin.ts < 20000 && ['fortune', 'fate', 'chaos', 'loot', 'boss'].includes(state.lastSpin.wheel) ? state.lastSpin : null;
  if (spin) screen.append(wheelStrip({ outcomes: spin.outcomes, index: spin.index, title: `${spin.wheel} wheel: ${spin.outcomes?.[spin.index]}` }));
  screen.append(h('div', { class: 'row between tile-line' }, h('span', { class: 'tag' }, `${tileGlyph(type)} ${tileLabel(type)} · ${state.map?.regions?.[here?.regionId]?.name || ''}`), h('span', { class: 'muted' }, `${c.gold || 0} Gold`)));
  tilePanel(api, here);
  lootPanel(api);
  auctionPanel(api);
  attackPanel(api, here);
  consumablesPanel(api);
  classActiveRow(api, null, null);
  emoteRow(api);
  const boots = bootsOf(c);
  if (boots?.unique === 'movetwice' && (c.usedThisTurn?.moves || 0) === 1) screen.append(h('button', { class: 'primary big', onClick: () => dispatch('MOVE_ROLL', {}) }, 'Move again'));
  screen.append(h('button', { class: 'primary big end-turn', onClick: () => dispatch('TURN_END', {}) }, 'End turn'));
}
function tilePanel(api, here) {
  const { state, me, c, h, dispatch, screen } = api; if (!here) return;
  const ctx = B(state);
  if (here.type === 'shop' || here.type === 'inn') {
    const shop = state.shops?.[here.key];
    const stock = here.type === 'inn' ? [{ sku: 'potion', name: 'Potion', priceKey: 'potion', qty: shop?.stock?.[0]?.qty ?? group(state, 'shop').stock }] : (shop?.stock || []);
    const box = sect(here.type === 'inn' ? 'The Inn' : 'The Shop');
    if (here.type === 'inn') {
      const v = c.innVisit; const X = group(state, 'xp'); const max = c.classId === 'pitboss' && (c.level || 1) >= X.upgradeLevels[0] ? 2 : 1; const can = v && v.hexKey === here.key && v.turn === (c.turnsTaken || 0) && v.rests < max;
      box.append(h('button', { class: `big ${can ? 'primary' : ''}`, disabled: !can, onClick: () => dispatch('INN_REST', {}) }, `🛏 Rest (+${group(state, 'health').innHeal} Health)`), can ? null : why(v?.rests ? 'Already rested this visit.' : 'Rest when you arrive at the Inn.'));
    }
    for (const e of stock) { let price = 0; try { price = priceOf(state, ctx, c, e); } catch { price = 0; } const no = e.qty <= 0 ? 'sold out' : (c.gold || 0) < price ? `${price} Gold: you have ${c.gold || 0}` : ''; box.append(itemRow({ item: { id: e.sku, baseId: e.spec?.baseId || e.sku, name: e.name }, meta: `${price} Gold · ${e.qty} left${e.spec?.rarity ? ` · ${e.spec.rarity}` : ''}`, action: 'BUY', disabled: !!no, reason: no, onTap: () => dispatch('SHOP_BUY', { sku: e.sku }) })); }
    if (here.type === 'shop') {
      const sellable = gridItems(c);
      if (sellable.length) { box.append(h('div', { class: 'tag' }, 'Sell from the grid (half price)')); for (const it of sellable) { let p = 0; try { p = sellPriceOf(state, ctx, it); } catch { p = 0; } box.append(itemRow({ item: it, meta: `${it.rarity || 'common'} · ${p} Gold`, action: 'SELL', onTap: () => dispatch('SHOP_SELL', { itemId: it.id }) })); } }
    }
    screen.append(box);
  }
  if (here.type === 'bloodbank') {
    const BP = group(state, 'bloodPact'); const pacts = openPacts(state, c);
    const box = sect('The Blood Bank');
    for (const p of pacts) { const rp = amountPicker({ value: Math.min(p.owed, Math.max(1, c.health - 1)), min: 1, max: Math.max(1, Math.min(p.owed, c.health - 1)), label: `${p.id}: ${p.owed} owed · ${p.turnsLeft} turn${p.turnsLeft === 1 ? '' : 's'} left` }); box.append(rp, h('button', { class: 'primary big', onClick: () => dispatch('PACT_REPAY', { pactId: p.id, amount: rp.value() }) }, `Repay ${p.id}`)); }
    if (pacts.length < BP.maxPacts) { let interest = BP.interest; try { interest = pactInterest(state, ctx, c, here.regionId); } catch { /* default */ } const tk = amountPicker({ value: Math.min(ui.pactAmount, BP.max), min: 5, max: BP.max, step: 5, label: `Borrow Health · ${Math.round(interest * 100)}% interest · due in ${BP.dueTurns} turns`, onChange: (v) => { ui.pactAmount = v; } }); box.append(tk, h('button', { class: 'danger big', onClick: () => dispatch('PACT_TAKE', { amount: tk.value() }) }, '🩸 Sign a Blood Pact')); }
    else box.append(why(`${BP.maxPacts} pacts open: repay before you borrow again.`));
    const dep = amountPicker({ value: Math.min(50, c.gold || 0), min: 0, max: Math.max(0, c.gold || 0), step: 10, label: `Gold vault · ${c.bank || 0} banked, ${c.gold || 0} on you` });
    box.append(dep, h('div', { class: 'btn-grid' }, h('button', { disabled: !(c.gold > 0), onClick: () => dispatch('BANK_DEPOSIT', { amount: dep.value() }) }, 'Deposit'), h('button', { disabled: !(c.bank > 0), onClick: () => dispatch('BANK_WITHDRAW', { amount: Math.min(dep.value() || c.bank, c.bank) }) }, 'Withdraw')));
    screen.append(box);
  }
  if (here.type === 'bounty') {
    const G = group(state, 'gold'); const box = sect('The Bounty Board');
    const quests = (state.quests?.public || []).filter(q => q.status === 'open');
    if (quests.length) { box.append(h('div', { class: 'tag' }, 'Public quests')); for (const q of quests) box.append(h('button', { class: 'item-row', disabled: !!q.takenBy && q.takenBy !== me, onClick: () => dispatch('QUEST_TAKE', { questId: q.id }) }, h('span', { class: 'body' }, h('span', { class: 'nm' }, q.title), h('span', { class: 'meta' }, q.text || ''), q.takenBy ? h('span', { class: 'meta' }, `taken by ${nameOf(state, q.takenBy)}`) : null), h('span', { class: 'act' }, q.takenBy === me ? 'YOURS' : q.takenBy ? '' : 'TAKE'))); }
    else box.append(why('No public quests posted.'));
    const others = Object.values(state.players).filter(p => p.id !== me && !p.spectator && !p.kicked && characterOf(state, p.id));
    if (others.length && (c.gold || 0) >= G.bountyMin) {
      let target = ui.target && others.some(p => p.id === ui.target) ? ui.target : others[0].id;
      const chips = h('div', { class: 'chips' }); const draw = () => chips.replaceChildren(...others.map(p => h('button', { class: `chip ${p.id === target ? 'on' : ''}`, onClick: () => { target = p.id; ui.target = p.id; draw(); } }, p.name))); draw();
      const amt = amountPicker({ value: Math.min(G.bountyMin, c.gold), min: G.bountyMin, max: c.gold, step: 10, label: 'Place a bounty (Gold)' });
      box.append(h('div', { class: 'tag' }, 'Bounty on'), chips, amt, h('button', { class: 'danger big', onClick: () => dispatch('BOUNTY_PLACE', { targetId: target, gold: amt.value() }) }, '📜 Post the bounty'));
    } else if (others.length) box.append(why(`A bounty is at least ${G.bountyMin} Gold.`));
    if (state.bounties?.length) box.append(h('div', { class: 'log small' }, state.bounties.slice(-4).map(b => h('div', {}, `${b.gold} Gold on ${nameOf(state, b.targetId)}`))));
    screen.append(box);
  }
  if (here.type === 'graveyard') screen.append(why('A safe tile. The dead wake here; their drops lie where they fell.'));
  if (here.type === 'arena' && !state.pendingPrompt) screen.append(why('The Arena call is made as you arrive. Challenge from the attack panel below.'));
}
function lootPanel(api) {
  const { state, c, h, dispatch, screen } = api; const list = state.tileLoot?.[c.pos] || []; if (!list.length) return;
  const box = sect('On the ground');
  for (const e of list) box.append(itemRow({ item: e.item || e, meta: `${(e.item || e).rarity || ''} ${(e.item || e).slot || ''}`.trim(), action: 'TAKE', onTap: () => dispatch('TILE_TAKE_LOOT', { itemId: e.id || e.item?.id }) }));
  screen.append(box);
}
function auctionPanel(api) {
  const { state, me, c, h, dispatch, screen } = api; const a = state.auction; if (!a || a.done || a.sellerId === me) return;
  const lot = a.lot?.item; const box = sect('Sealed auction');
  const amt = amountPicker({ value: Math.max(a.minBid, Math.min(c.gold || 0, a.bids?.[me]?.amount || a.minBid)), min: a.minBid, max: Math.max(a.minBid, c.gold || 0), step: 5, label: `${lot?.name || `a ${a.lot?.spec?.rarity || ''} item`} · bids from ${a.minBid}` });
  box.append(amt, h('button', { class: 'primary big', disabled: (c.gold || 0) < a.minBid, onClick: () => dispatch('AUCTION_BID', { amount: amt.value() }) }, a.bids?.[me] ? `Raise (you bid ${a.bids[me].amount})` : 'Seal a bid'), (c.gold || 0) < a.minBid ? why('Not enough Gold for the minimum bid.') : null);
  screen.append(box);
}
function attackPanel(api, here) {
  const { state, me, c, h, dispatch, screen } = api;
  const ctx = B(state);
  const m = livingMonsterAt(state, c.pos);
  const openFight = state.fight && !state.fight.done ? state.fight : null;
  if (m) { attackMenu(api, openFight, m, { inFight: false }); return; }
  let reach = 1; try { reach = reachOf(state, ctx, c); } catch { reach = 1; }
  const others = Object.values(state.players).filter(p => p.id !== me && !p.spectator && !p.kicked).map(p => ({ p, pc: characterOf(state, p.id) })).filter(x => x.pc && !x.pc.dead && x.pc.pos && hexDistance(x.pc.pos, c.pos) <= reach && !state.held[x.p.id]);
  const box = sect('Attack');
  const I = group(state, 'items'); const usedAttack = (c.usedThisTurn?.attack || 0) >= I.attacksPerTurn;
  if (state.mode === 'pve') box.append(why('PvE: players cannot hurt each other tonight; Wagers are still allowed.'));
  if (!others.length) box.append(why(`Nobody within ${reach} hex${reach === 1 ? '' : 'es'} to challenge. Spells on yourself are below.`));
  else if (usedAttack) box.append(why('You already attacked this turn.'));
  else {
    const ws = weapons(c).filter(it => (it.charges ?? 1) > 0);
    if (!ui.target || !others.some(x => x.p.id === ui.target)) ui.target = others[0].p.id;
    if (!ui.weapon || !ws.some(w => w.id === ui.weapon)) ui.weapon = ws[0]?.id || null;
    const tc = characterOf(state, ui.target); const G = group(state, 'gold');
    const robCap = Math.floor((tc?.gold || 0) * G.robberyMaxFraction), poorer = Math.min(c.gold || 0, tc?.gold || 0);
    box.append(h('div', { class: 'tag' }, 'Target'), h('div', { class: 'chips' }, others.map(x => h('button', { class: `chip ${x.p.id === ui.target ? 'on' : ''}`, onClick: () => { ui.target = x.p.id; redraw(api); } }, `${x.pc.crest || ''} ${x.p.name}`, h('span', { class: `lantern ${tellOf(x.pc)}` })))));
    const calls = [['duel', 'Duel', state.gm.duelsEnabled === false ? 'Duels are off tonight' : state.mode === 'pve' ? 'not in PvE' : !ws.length ? 'needs a weapon' : ''], ['wager', 'Wager', poorer <= 0 ? 'neither of you has Gold' : ''], ['robbery', 'Robbery', state.mode === 'pve' ? 'not in PvE' : robCap <= 0 ? 'nothing worth robbing' : '']];
    if (!calls.find(x => x[0] === ui.call && !x[2])) ui.call = (calls.find(x => !x[2]) || calls[0])[0];
    box.append(h('div', { class: 'tag' }, 'Call'), h('div', { class: 'chips' }, calls.map(([k, label, no]) => h('button', { class: `chip ${k === ui.call ? 'on' : ''}`, disabled: !!no, title: no, onClick: () => { ui.call = k; redraw(api); } }, label))));
    const no = calls.find(x => x[0] === ui.call)?.[2];
    if (ui.call === 'duel') box.append(h('div', { class: 'tag' }, 'Weapon'), h('div', { class: 'chips' }, ws.map(it => h('button', { class: `chip ${it.id === ui.weapon ? 'on' : ''}`, onClick: () => { ui.weapon = it.id; redraw(api); } }, `${gameMeta(it.gameId).icon} ${it.name} (${it.stake})`))));
    let amt = null;
    if (ui.call !== 'duel') { const max = ui.call === 'wager' ? poorer : robCap; amt = amountPicker({ value: Math.min(ui.amount, max), min: 1, max: Math.max(1, max), label: ui.call === 'wager' ? `Wager (Gold, up to ${max})` : `Robbery (up to ${robCap} Gold)`, onChange: (v) => { ui.amount = v; } }); box.append(amt); }
    box.append(h('button', { class: 'danger big', disabled: !!no, onClick: () => { buzz(40); dispatch('CHALLENGE_CALL', { defenderId: ui.target, call: ui.call, itemId: ui.weapon || undefined, amount: amt ? amt.value() : 0 }); } }, `⚔ ${ui.call === 'duel' ? 'Duel' : ui.call === 'wager' ? 'Wager against' : 'Rob'} ${nameOf(state, ui.target)}`), no ? why(no) : null);
    const pets = (c.pets || []).filter(p => !p.fainted && p.power > 0);
    if (pets.length && (tc?.pets || []).some(p => !p.fainted && p.power > 0)) box.append(h('button', { class: 'big', onClick: () => dispatch('PET_BATTLE_START', { opponentId: ui.target, wager: 0 }) }, `🐾 Pet battle with ${nameOf(state, ui.target)}`));
  }
  screen.append(box);
  // spells and area items when there is no monster: same list, filtered
  attackMenu(api, openFight, null, { inFight: false });
}
const tellOf = (c) => (c.dead ? 'dead' : c.health / c.maxHealth > 0.66 ? '' : c.health / c.maxHealth >= 0.33 ? 'mid' : 'low');
function consumablesPanel(api) {
  const { state, c, h, dispatch, screen } = api; const list = consumables(c).filter(it => ['potion', 'phoenixfeather', 'petrevive', 'egg'].includes(it.baseId)); if (!list.length) return;
  const box = sect('Use now');
  const ICON = { potion: '🧪', phoenixfeather: '🪶', petrevive: '💗', egg: '🥚' };
  box.append(h('div', { class: 'cons-row' }, list.map(it => { const no = it.baseId === 'potion' && c.health >= c.maxHealth ? 'already at full Health' : it.baseId === 'phoenixfeather' && (c.effects || []).some(e => e.id === 'phoenix') ? 'already burning' : it.baseId === 'petrevive' && !(c.pets || []).some(p => p.fainted) ? 'no fainted pet' : ''; return h('button', { class: `cons ${no ? '' : 'primary'}`, disabled: !!no, title: no, onClick: () => it.baseId === 'egg' ? dispatch('PET_HATCH', { source: 'egg', itemId: it.id }) : dispatch('CONSUMABLE_USE', { itemId: it.id }) }, h('b', {}, `${ICON[it.baseId] || '▪'} ${it.name}`), h('span', { class: 'meta' }, `×${it.qty ?? 1}${no ? ` · ${no}` : ''}`)); })));
  screen.append(box);
}
function emoteRow(api) {
  const { h, dispatch, screen } = api;
  screen.append(h('div', { class: 'emotes' }, EMOTES.map(e => h('button', { class: 'emote', 'aria-label': `emote ${e}`, onClick: () => dispatch('EMOTE', { emoji: e }) }, e))));
}

// ── the end of the run ───────────────────────────────────────────────────────────────────────────
const vaultPick = new Set();
function endedScreen(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const st = state.stats?.[me] || {}; const won = state.winner === me || (Array.isArray(state.winner) && state.winner.includes(me));
  screen.append(h('div', { class: 'hero' }, h('div', { class: 'crest' }, c?.crest || api.player.crest || '🂠'), h('h2', {}, won ? 'You win the night' : 'The run is over'), h('p', { class: 'muted' }, state.endReason || '')));
  if (!c) return;
  const G = group(state, 'grid');
  const alive = !c.dead && !(c.deaths > 0);
  screen.append(h('div', { class: 'recap' }, [['Level', c.level], ['Health', alive ? `${c.health}/${c.maxHealth}` : 'dead'], ['Gold', (c.gold || 0) + (c.bank || 0)], ['Kills', st.kills || 0], ['Bosses', st.bosses || 0], ['Hits', st.hits || 0], ['Crits', st.crits || 0], ['Dealt', st.damageDealt || 0], ['Taken', st.damageTaken || 0], ['Deaths', st.deaths || 0], ['Pets', st.petsCaught || 0], ['Duels won', st.challengesWon || 0]].map(([k, v]) => h('div', { class: 'stat' }, h('span', { class: 'tag' }, k), h('b', {}, String(v))))));
  if (c.titles?.length) screen.append(why(`Titles: ${c.titles.join(', ')}`));
  const cap = (alive ? G.vaultSurvivor : G.vaultDead) + (c.flags?.extraVault || 0) + (c.vaultBonus || 0); const banked = c.vaulted?.length || 0, room = cap - banked;
  const items = [...Object.values(c.worn || {}).filter(Boolean), ...gridItems(c)].filter((it, i, arr) => arr.findIndex(x => x.id === it.id) === i && !(c.vaulted || []).some(v => v.id === it.id));
  const box = sect(`The vault — ${alive ? 'survivors bank' : 'the dead bank'} ${cap}`);
  if (banked) box.append(why(`Vaulted: ${c.vaulted.map(v => v.name).join(', ')}`));
  if (room > 0 && items.length) {
    for (const it of items) box.append(itemRow({ item: it, meta: `${it.slot} · ${it.rarity || 'common'}${it.gameId ? ` · ${gameMeta(it.gameId).name}` : ''}`, action: vaultPick.has(it.id) ? '✓' : 'PICK', hot: vaultPick.has(it.id), onTap: () => { if (vaultPick.has(it.id)) vaultPick.delete(it.id); else if (vaultPick.size < room) vaultPick.add(it.id); else toast(`Only ${room} fit`, 'bad'); redraw(api); } }));
    box.append(h('button', { class: 'primary big', disabled: !vaultPick.size, onClick: async () => { const ids = [...vaultPick]; const ok = await dispatch('VAULT_BANK', { playerId: me, itemIds: ids }); if (ok) vaultPick.clear(); } }, vaultPick.size ? `Vault ${vaultPick.size} item${vaultPick.size === 1 ? '' : 's'}` : 'Pick items to vault'));
  } else if (room <= 0) box.append(why('The vault is full for this run.'));
  else box.append(why('Nothing left to vault.'));
  screen.append(box);
  if (alive) screen.append(c.veteran ? why(`${c.name} is saved as a veteran at level ${c.level}.`) : h('button', { class: 'big', onClick: () => dispatch('VETERAN_SAVE', { playerId: me }) }, `🏅 Save ${c.name} as a veteran`));
  else screen.append(why(`${c.name} did not survive: the name goes on the Wall. Its look and class can start over under a new name.`));
}
