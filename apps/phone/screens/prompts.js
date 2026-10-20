// Phone prompts that land between moves (SPEC.md › What each tile does, Pets, Attacks and spells › Area): the tile
// wheel spin, the portal pick, the Arena call, taking a dead player's worn item, the Triple Pet Wheel, a Call Out
// notice and the Area stake window. Also the small shared widgets every Play screen uses (sections, muted reasons,
// the +/- amount picker, item rows), exported so creation.js, fight.js, challenge.js and play.js share one look.
import { h, lenient, fmtTime, buzz } from '../../../packages/ui/dom.js';
import { portalOptions } from '../../../packages/shared/handlers/movement.js';
import { tileLabel, tileGlyph, hexDistance } from '../../../packages/shared/map/query.js';
import { characterOf, currentPlayerId } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { speciesDef } from '../../../packages/shared/handlers/pets.js';
import { gameMeta } from '../../../packages/games/adapter.js';
import { wheelStrip } from '../../../packages/ui/dice.js';

// ── shared widgets ──────────────────────────────────────────────────────────────────────────────
// play.js registers its tab renderer here so sub-screens can redraw the Play tab from local UI state without
// waiting for an event (and without an import cycle).
export const playHooks = { tabPlay: null };
// A room event may have re-rendered the whole phone since `api` was built (its screen is then detached), so the
// redraw targets the live screen and reads the live state; the state object itself is mutated in place by the room.
export function redraw(api) {
  try {
    const screen = (api.screen?.isConnected ? api.screen : document.getElementById('phScreen')) || api.screen;
    const state = api.session?.state || api.state;
    const fresh = { ...api, screen, state, c: characterOf(state, api.me) || api.c, myTurn: state.phase === 'playing' && currentPlayerId(state) === api.me };
    screen.replaceChildren(); if (playHooks.tabPlay) playHooks.tabPlay(fresh);
  } catch (e) { console.error(e); }
}
export const sect = (title, ...kids) => lenient(h('section', { class: 'ph-sect' }, title ? h('h3', {}, title) : null, ...kids));
export const why = (text) => (text ? h('p', { class: 'why muted ital' }, text) : null);
export const line = (...kids) => h('div', { class: 'row between ph-line' }, ...kids);
export const statLabel = (s) => ({ luck: 'Luck', nerve: 'Nerve', greed: 'Greed', grit: 'Grit' }[s] || s);
export const rarityPill = (r) => h('span', { class: `pill rar-${r || 'common'}` }, (r || 'common').toUpperCase());
export const nameOf = (state, pid) => state.players[pid]?.name || characterOf(state, pid)?.name || '—';
export const gridItems = (c) => (c?.grid?.cells || []).map(cell => c.items?.[cell.itemId]).filter(Boolean);
export const wornList = (c) => Object.entries(c?.worn || {}).filter(([, it]) => it).map(([slot, it]) => ({ slot, ...it }));
// Weapons and spells may be used worn or straight from the grid (ITEM_USE's `holds`); worn first.
const carried = (c) => { const worn = wornList(c); const ids = new Set(worn.map(it => it.id)); return [...worn, ...gridItems(c).filter(it => it.gameId && !ids.has(it.id)).map(it => ({ ...it, inGrid: true }))]; };
export const weapons = (c) => carried(c).filter(it => it.gameId && it.kind !== 'spell');
export const spells = (c) => carried(c).filter(it => it.gameId && it.kind === 'spell');
export const consumables = (c) => gridItems(c).filter(it => it.slot === 'consumable' && (it.qty ?? 1) > 0);

// A big +/- picker: 60 px buttons, the value in Cinzel between them. onChange(value) fires on every tap.
export function amountPicker({ value, min = 1, max = 99, step = 1, label = '', suffix = '', onChange }) {
  let v = Math.max(min, Math.min(max, value ?? min));
  const num = h('div', { class: 'amt-num' }, `${v}${suffix}`);
  const set = (n) => { v = Math.max(min, Math.min(max, n)); num.textContent = `${v}${suffix}`; onChange?.(v); };
  const el = h('div', { class: 'amt' }, label ? h('div', { class: 'tag' }, label) : null,
    h('div', { class: 'amt-row' }, h('button', { class: 'ghost', 'aria-label': 'less', onClick: () => set(v - step) }, '−'), num, h('button', { class: 'ghost', 'aria-label': 'more', onClick: () => set(v + step) }, '+')),
    max > min ? h('input', { type: 'range', min, max, step, value: v, 'aria-label': label || 'amount', onInput: (e) => set(Number(e.target.value)) }) : null);
  el.value = () => v;
  return el;
}
export const iconUrl = (item) => item?.sprite ? `/${String(item.sprite).replace(/^assets\//, '')}.png` : item?.slot === 'consumable' || item?.slot === 'egg' ? `/consumables/${item.baseId || item.id}.png` : `/items/${item?.baseId || item?.id}.png`;
// A tappable item row: icon, name, meta, an action label; disabled with a reason underneath.
export function itemRow({ item, meta = '', action = '', onTap, disabled = false, reason = '', hot = false }) {
  return h('button', { class: `item-row ${hot ? 'hot' : ''} ${disabled ? 'off' : ''}`, disabled, title: reason, onClick: () => !disabled && onTap?.() },
    h('img', { class: 'icon', src: iconUrl(item), alt: '', onError: (e) => { e.target.style.visibility = 'hidden'; } }),
    h('span', { class: 'body' }, h('span', { class: 'nm' }, item.name || item.baseId), meta ? h('span', { class: 'meta' }, meta) : null, disabled && reason ? h('span', { class: 'meta bad' }, reason) : null),
    action ? h('span', { class: 'act' }, action) : null);
}
export const countdown = (deadline, label = 'left') => { const el = h('span', { class: 'cd' }, `${fmtTime(Math.max(0, (deadline || 0) - Date.now()))} ${label}`); const tick = () => { if (!el.isConnected) return; el.textContent = `${fmtTime(Math.max(0, (deadline || 0) - Date.now()))} ${label}`; setTimeout(tick, 500); }; setTimeout(tick, 500); return el; };
const buzzOnce = (() => { const seen = new Set(); return (key, pattern) => { if (seen.has(key)) return; seen.add(key); buzz(pattern); }; })();

// ── the prompts ─────────────────────────────────────────────────────────────────────────────────
export function renderPrompt(api, pr) {
  const { state, me, c, h, dispatch, screen } = api;
  const mine = pr.playerId === me;
  if (!mine) { if (pr.kind === 'callout' && pr.targetId === me) { screen.append(calloutNotice(api, pr)); return true; } return false; }
  if (pr.kind === 'spin') {
    const recent = state.lastSpin && state.lastSpin.playerId === me && state.lastSpin.wheel === pr.wheel && Date.now() - state.lastSpin.ts < 30000 ? state.lastSpin : null;
    screen.append(h('div', { class: 'prompt' }, h('h3', {}, `${String(pr.wheel || 'the').toUpperCase()} WHEEL`), h('p', { class: 'muted' }, `You landed on ${tileLabel(state.map?.hexes?.[pr.hexKey]?.type || '')}. Spin it.`),
      h('img', { class: 'wheel-face', src: `/wheels/${pr.wheel}.svg`, alt: '', onError: (e) => { e.target.remove(); } }),
      h('button', { class: 'primary big', onClick: () => dispatch('WHEEL_SPIN', { wheel: pr.wheel }) }, '🎡 Spin'),
      recent ? wheelStrip({ outcomes: recent.outcomes, index: recent.index, title: 'last result' }) : null));
    return true;
  }
  if (pr.kind === 'portal') {
    const options = pr.options || (c ? portalOptions(state, c) : []);
    screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Portal'), h('p', { class: 'muted' }, pr.source === 'wheel' ? 'The wheel says Teleport: pick a region.' : 'Step through to another region, or stay.'),
      h('div', { class: 'col' }, options.map(rid => { const r = state.map?.regions?.[rid]; return h('button', { class: 'big primary', style: { borderColor: r?.accent || undefined }, onClick: () => dispatch('PORTAL_PICK', { regionId: rid }) }, r?.name || rid, r?.revealed || state.map?.revealed?.[rid] ? '' : h('span', { class: 'muted'}, ' · unseen')); })),
      options.length ? null : why('No portal is open to you (the Citadel needs level 10 or a key).'),
      pr.source === 'wheel' ? null : h('button', { class: 'ghost big', onClick: () => dispatch('TILE_LEAVE', {}) }, 'Stay here')));
    return true;
  }
  if (pr.kind === 'arena') { screen.append(arenaPrompt(api, pr)); return true; }
  if (pr.kind === 'takeWorn') {
    const v = state.characters[pr.victimId]; const opts = (pr.options || []).map(id => Object.values(v?.worn || {}).find(it => it && it.id === id)).filter(Boolean);
    screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'The spoils'), h('p', { class: 'muted' }, `${v?.name || 'The fallen'} is down. Take one worn item.`),
      h('div', { class: 'col' }, opts.map(it => itemRow({ item: it, meta: `${it.slot || ''} · ${it.rarity || 'common'}`, action: 'TAKE', onTap: () => dispatch('TILE_TAKE_LOOT', { itemId: it.id }) }))),
      h('button', { class: 'ghost big', onClick: () => dispatch('TILE_TAKE_LOOT', { itemId: null }) }, 'Take nothing')));
    return true;
  }
  if (pr.kind === 'callout') { screen.append(calloutNotice(api, pr)); return true; }
  return false;
}
function calloutNotice(api, pr) {
  const { state, me, h, dispatch } = api; buzzOnce(`callout:${pr.byId}:${pr.targetId}`, [120, 60, 120]);
  const byMe = pr.byId === me;
  return h('div', { class: 'prompt blood' }, h('h3', {}, 'Call Out'), h('p', {}, byMe ? `You called out ${nameOf(state, pr.targetId)}. They cannot Smoke Bomb away; press the fight from your attack panel.` : `${nameOf(state, pr.byId)} calls you out. You cannot Smoke Bomb out of the next fight.`),
    byMe && state.pendingPrompt === pr ? h('button', { class: 'ghost', onClick: () => dispatch('TILE_LEAVE', {}) }, 'Noted') : null);
}
export function arenaPrompt(api, pr) {
  const { state, me, c, h, dispatch } = api;
  const others = Object.values(state.players).filter(p => p.id !== me && !p.spectator && !p.kicked && characterOf(state, p.id) && !characterOf(state, p.id).dead && !state.held[p.id]);
  const ws = weapons(c).filter(it => (it.charges ?? 1) > 0 && (it.stake || 0) <= c.health);
  let target = others[0]?.id || null, call = 'duel', itemId = ws[0]?.id || null, wager = 0;
  const box = h('div', { class: 'prompt' });
  const draw = () => {
    box.replaceChildren(h('h3', {}, 'The Arena'), h('p', { class: 'muted' }, 'Call a Challenge Wheel fight with a Gold wager on the side, a pet battle, or walk on.'));
    if (!others.length) { box.append(why('Nobody else is standing to challenge.'), h('button', { class: 'ghost big', onClick: () => dispatch('TILE_LEAVE', {}) }, 'Leave the Arena')); return; }
    box.append(h('div', { class: 'tag' }, 'Opponent'), h('div', { class: 'chips' }, others.map(p => h('button', { class: `chip ${p.id === target ? 'on' : ''}`, onClick: () => { target = p.id; draw(); } }, p.crest || '🂠', ' ', p.name))));
    box.append(h('div', { class: 'tag' }, 'Call'), h('div', { class: 'chips' }, ['duel', 'wager', 'robbery'].map(k => h('button', { class: `chip ${k === call ? 'on' : ''}`, onClick: () => { call = k; draw(); } }, k.toUpperCase()))));
    if (call === 'duel') box.append(h('div', { class: 'tag' }, 'Weapon'), ws.length ? h('div', { class: 'chips' }, ws.map(it => h('button', { class: `chip ${it.id === itemId ? 'on' : ''}`, onClick: () => { itemId = it.id; draw(); } }, it.name))) : why('No weapon you can stake right now.'));
    const tc = characterOf(state, target), poorer = Math.min(c.gold || 0, tc?.gold || 0);
    const G = group(state, 'gold'), robCap = Math.floor((tc?.gold || 0) * G.robberyMaxFraction);
    const amtMax = call === 'wager' ? poorer : call === 'robbery' ? robCap : poorer;
    const amt = amountPicker({ value: Math.min(wager || 10, amtMax), min: call === 'duel' ? 0 : 1, max: Math.max(call === 'duel' ? 0 : 1, amtMax), label: call === 'duel' ? 'Arena wager (Gold, both sides)' : call === 'wager' ? 'Wager (Gold)' : `Robbery (up to ${robCap} Gold)`, onChange: (v) => { wager = v; } });
    box.append(amt);
    const canGo = target && (call !== 'duel' || itemId) && (call === 'duel' || amtMax > 0);
    box.append(h('button', { class: 'primary big', disabled: !canGo, onClick: () => dispatch('CHALLENGE_CALL', { defenderId: target, call, itemId: call === 'duel' ? itemId : (itemId || undefined), amount: call === 'duel' ? 0 : amt.value(), arenaWager: call === 'duel' ? amt.value() : 0 }) }, `⚔ Call ${nameOf(state, target)} to a ${call}`),
      canGo ? null : why(call === 'duel' ? 'A Duel needs a weapon.' : 'Neither of you holds Gold for that.'),
      (c.pets || []).some(p => !p.fainted && p.power > 0) ? h('button', { class: 'big', onClick: () => dispatch('PET_BATTLE_START', { opponentId: target, wager: amt.value() }) }, '🐾 Pet battle instead') : null,
      h('button', { class: 'ghost big', onClick: () => dispatch('TILE_LEAVE', {}) }, 'Walk on'));
  };
  draw();
  return box;
}

// The Triple Pet Wheel: three columns, each stopped on a species; keep one.
export function hatchingScreen(api) {
  const { state, c, h, dispatch } = api; const hch = c.hatching;
  buzzOnce(`hatch:${hch.ts}`, [60, 40, 60]);
  const names = { common: 'Common pool', region: `${state.map?.regions?.[hch.regionId]?.name || 'Region'} pool`, rare: 'Rare pool' };
  return h('div', { class: 'prompt' }, h('h3', {}, 'Triple Pet Wheel'), h('p', { class: 'muted' }, 'Three wheels stopped. Keep one.'),
    h('div', { class: 'pet-wheels' }, (hch.wheels || []).map((w, i) => {
      const id = w.outcomes?.[w.index]; const sp = id ? speciesDef(id) : null;
      return h('button', { class: `pet-wheel ${sp ? '' : 'dud'}`, onClick: () => dispatch('PET_HATCH_PICK', { index: i }) },
        h('div', { class: 'tag' }, names[w.pool] || w.pool),
        h('div', { class: 'reel' }, [-1, 0, 1].map(d => { const n = (w.outcomes || []).length; if (!n) return null; const j = ((w.index + d) % n + n) % n; const o = w.outcomes[j]; return h('div', { class: `seg ${d === 0 ? 'hit' : ''}` }, o ? (speciesDef(o)?.name || o) : 'dud'); })),
        sp ? h('img', { class: 'pet-img', src: `/pets/${sp.id}_1.png`, alt: '', onError: (e) => { e.target.remove(); } }) : h('div', { class: 'pet-img dud' }, '🥚'),
        h('b', {}, sp ? sp.name : 'A dud egg'), sp ? h('span', { class: 'meta' }, `${sp.element} · ${sp.attacks.map(a => a.name).join(', ')}`) : h('span', { class: 'meta' }, 'nothing hatches'),
        h('span', { class: 'act' }, 'KEEP'));
    })));
}
// The Area stake window: everyone on the hex stakes before the deadline.
export function areaWindow(api) {
  const { state, c, me, h, dispatch } = api; const a = state.area; const I = group(state, 'items');
  const mine = a.stakes?.[c.id]; const attacker = state.characters[a.attackerId];
  const item = attacker?.items?.[a.itemId]; const meta = gameMeta(a.gameId);
  if (!mine) buzzOnce(`area:${a.id}`, [50, 30, 50, 30, 50]);
  const amt = amountPicker({ value: Math.min(I.stakeCommon, Math.max(1, c.health - 1)), min: 1, max: Math.max(1, c.health), label: 'Your stake (Health)' });
  return h('div', { class: 'prompt blood' }, h('h3', {}, `${meta.icon} ${item?.name || meta.name}`), h('p', {}, `${attacker?.name || 'Someone'} opens an Area round on this hex. Everyone stakes at once; winners strike, losers bleed.`),
    h('div', { class: 'row between' }, h('span', { class: 'tag' }, `${Object.keys(a.stakes || {}).length} staked`), countdown(a.deadline)),
    mine ? h('p', { class: 'ok' }, `You staked ${mine.stake}. Waiting for the window to close…`) : h('div', { class: 'col' }, amt, h('button', { class: 'primary big', onClick: () => dispatch('AREA_STAKE', { stake: amt.value() }) }, 'Stake it')),
    a.attackerPlayerId === me ? h('p', { class: 'muted ital' }, 'The table resolves the round at the deadline.') : null);
}
// Who is up, what they are doing, where I stand.
export function waitingScreen(api, pid) {
  const { state, c, h } = api; const p = state.players[pid]; const pc = characterOf(state, pid);
  const f = state.fight && !state.fight.done ? state.fight : null, ch = state.challenge && !state.challenge.done ? state.challenge : null;
  const doing = ch ? `in a ${ch.call} with ${nameOf(state, ch.attackerId === pid ? ch.defenderId : ch.attackerId)}` : f && f.playerId === pid ? `fighting ${state.monsters[f.monsterId]?.name || 'something'}` : state.turnPhase === 'move' ? 'moving' : state.turnPhase === 'resolve' ? 'resolving a tile' : 'acting';
  const here = c?.pos ? state.map?.hexes?.[c.pos] : null;
  return h('div', { class: 'hero wait' }, h('div', { class: 'crest' }, p?.crest || '🂠'), h('h2', {}, `${p?.name || '…'} to move`), h('p', { class: 'muted' }, `${pc?.name || ''} is ${doing}.`),
    c?.dead ? h('p', { class: 'bad' }, `You are dead. ${c.missTurns || 0} turn${c.missTurns === 1 ? '' : 's'} to wake at the Graveyard.`) : null,
    here ? h('p', { class: 'muted' }, `You stand on ${tileGlyph(here.type)} ${tileLabel(here.type)} in ${state.map.regions?.[here.regionId]?.name || ''}.`) : null,
    h('p', { class: 'muted ital' }, 'Your phone buzzes on your turn.'),
    h('div', { class: 'log small' }, state.log.slice(-4).map(l => h('div', { class: l.kind }, l.text))));
}
export { hexDistance };
