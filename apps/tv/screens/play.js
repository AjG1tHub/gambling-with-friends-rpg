// TV during a run: the inked map in the stage; the rail with To Move (the mover's big clock, the others' banked
// time), the fight / challenge / Area panels as the situation demands; wheel spins, the minigame stage and the
// GM's Spotlight over the map; the Off-Screen card in a corner; the Chaos banner; the GM pause curtain.
// Letters (crows) and emotes are drawn by the map itself. Nothing hidden leaks: the map draws no hex colours and
// the rail prints no character Health.
import { h, fmtTime } from '../../../packages/ui/dom.js';
import { currentPlayerId, characterOf, activeSeats } from '../../../packages/shared/state.js';
import { remainingMs } from '../../../packages/shared/clock.js';
import { group } from '../../../packages/shared/balance.js';
import { renderHexMap } from '../../../packages/ui/hexmap.js';
import { spinOverlay, spinningTs, landedFor } from '../../../packages/ui/wheel.js';
import { fightPanel, stageOverlay, spotlightGrid, offScreenCardEl, challengePanel, areaPanel, tellLine } from '../../../packages/ui/stage.js';
import { manifestNow } from '../../../packages/ui/sprite.js';
import { className } from '../../../packages/ui/recap.js';
const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V'][n] || n;

// The SVG lives across renders so the map is built once and patched (hexmap.js keeps the element map on it).
let mapSvg = null;
export const mapElement = () => mapSvg || (mapSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'));

export function renderPlay({ state, session, stage, rail, clockEls, rerender = null, now = Date.now() }) {
  const pid = currentPlayerId(state), p = state.players[pid], c = characterOf(state, pid);
  // ── the map ──
  const svg = mapElement();
  stage.append(svg);
  renderHexMap(svg, state, { size: 26, now, manifest: manifestNow(), highlight: c?.pos || null });
  // ── the rail: To Move ──
  const big = h('div', { class: 'clock-big' }, fmtTime(remainingMs(state, pid, now)));
  const warn = group(state, 'clock').warningSeconds * 1000;
  big.update = (t) => { const ms = remainingMs(state, pid, t); big.textContent = fmtTime(ms); big.classList.toggle('warn', ms > 0 && ms < warn); };
  clockEls.main = big;
  const others = activeSeats(state).filter(id => id !== pid);
  const banked = h('span', {}, others.map(id => `${state.players[id].name} ${fmtTime(remainingMs(state, id, now))}`).join(' · '));
  banked.update = (t) => { banked.textContent = others.map(id => `${state.players[id].name} ${fmtTime(remainingMs(state, id, t))}`).join(' · '); };
  clockEls.banked = banked;
  const held = state.held?.[pid] ? ' · held' : '';
  const status = p?.autopilot ? 'autopilot' : p?.proxied ? 'GM proxy' : c?.dead ? `dead · ${c.missTurns || 0} turn${c.missTurns === 1 ? '' : 's'} to wait` : phaseText(state, c);
  rail.append(h('div', { class: 'panel gold tomove' },
    h('div', { class: 'tag' }, `TO MOVE · ROUND ${state.round}${held}`),
    h('div', { class: 'tomove-name' }, h('span', { class: 'display' }, c?.name || p?.name || '—'), ' ', h('span', { class: 'ital gold' }, c ? `the ${className(c.classId)}` : '')),
    h('div', { class: 'row between tomove-row' }, big, h('div', { class: 'clock-small right' }, h('div', {}, 'banked'), banked)),
    h('div', { class: 'small muted tomove-status' }, status, c?.titles?.length ? ` · ${c.titles.slice(-2).join(', ')}` : ''),
    c ? h('div', { class: 'small ital muted' }, tellLine(state, c)) : null));
  // ── situation panels ──
  rail.append(fightPanel(state, { now }));
  rail.append(challengePanel(state, { now }));
  rail.append(areaPanel(state, { now }));
  if (state.votes && !state.votes.closed) rail.append(votePanel(state, now));
  rail.append(h('div', { class: 'panel rail-log' }, h('div', { class: 'tag' }, 'THE NIGHT SO FAR'), h('div', { class: 'log' }, visibleLog(state, now).slice(-12).reverse().map(l => h('div', { class: l.kind || '' }, l.text)))));
  if (state.pendingPrompt && state.pendingPrompt.playerId === pid && !state.fight) rail.append(h('div', { class: 'panel prompt-panel' }, h('div', { class: 'tag' }, 'ON THE PHONE'), h('div', { class: 'small' }, promptText(state, state.pendingPrompt, c))));
  // ── overlays over the map ──
  const chaosTier = state.chaos?.tier || 1;
  if (chaosTier > 1 || state.chaos?.effects?.length) stage.append(h('div', { class: `chaos-banner tier-${Math.min(5, chaosTier)}` }, h('div', { class: 'chaos-title' }, `CHAOS · TIER ${roman(chaosTier)}`), state.chaos.effects?.length ? h('div', { class: 'chaos-fx' }, state.chaos.effects.slice(-3).map(e => e.text || e.label || e.effect || e.kind).filter(Boolean).join(' · ')) : null));
  const loot = Object.entries(state.tileLoot || {}).filter(([, v]) => v && v.length);
  if (loot.length) stage.append(h('div', { class: 'loot-note' }, `✦ loot on the ground: ${loot.map(([k, v]) => `${v.length} at ${state.map.hexes[k] ? (state.map.regions[state.map.hexes[k].regionId]?.name || k) : k}`).join(' · ')}`));
  const off = offScreenCardEl(state, { now }); if (off) stage.append(off);
  stageOverlay(stage, state, { now, onDismiss: rerender });
  spinOverlay(stage, state.lastSpin, { now, onDismiss: rerender, spinnerName: state.lastSpin ? (characterOf(state, state.lastSpin.playerId)?.name || state.players[state.lastSpin.playerId]?.name || null) : null });
  spotlightGrid(stage, state, { now });
  if (state.gm?.paused) stage.append(h('div', { class: 'stage-wrap pause-curtain' }, h('div', { class: 'pause-box' }, h('h2', {}, 'Paused'), h('p', { class: 'ital muted' }, 'Every clock and every phone is frozen. The GM will resume.'))));
}

// Log rows that would spoil a Challenge Wheel result before the TV's spin lands (the GM window) are held back.
// The same for any wheel still turning on the TV: the handlers log the result at spin time.
export function visibleLog(state, now = Date.now()) {
  let log = state.log;
  const ch = state.challenge;
  if (ch && !ch.done && ((ch.gmWindowUntil && now < ch.gmWindowUntil) || (state.lastSpin?.wheel === 'challenge' && !landedFor(state.lastSpin.ts)))) { const since = state.lastSpin?.wheel === 'challenge' ? state.lastSpin.ts : ch.gmWindowUntil - 60000; log = log.filter(l => !(l.kind === 'challenge' && l.ts >= since)); }
  const ts = spinningTs(); if (ts != null) log = log.filter(l => l.ts < ts);
  return log;
}
function phaseText(state, c) {
  if (!c) return 'no character';
  const ms = state.moveSession;
  if (state.turnPhase === 'move') return ms && !ms.done ? `${ms.mode === 'card' ? 'drawing a card' : ms.mode === 'wheel' ? 'the movement wheel' : 'walking'} · ${ms.movesLeft ?? ''}${ms.movesLeft != null ? ' left' : ''}` : 'rolling the boots';
  if (state.turnPhase === 'resolve') return state.fight && !state.fight.done ? 'in a fight' : 'the tile resolves';
  const here = state.map?.hexes?.[c.pos];
  return `action phase${here ? ` · ${here.type === 'plain' ? 'open ground' : here.type}` : ''}`;
}
function promptText(state, pr, c) {
  const n = c?.name || 'The mover';
  return { spin: `${n} taps the ${pr.wheel || ''} wheel…`, portal: `${n} chooses a portal destination…`, arena: `${n} may call someone out in the Arena…`, takeWorn: `${n} picks a worn item to take…`, callout: `${n} is called out!` }[pr.kind] || `${n} answers a prompt…`;
}
function votePanel(state, now) {
  const v = state.votes, cast = Object.keys(v.ballots || {}).length, of = (v.eligible || []).length;
  const t = h('div', { class: 'clock-big small' }, v.deadline ? fmtTime(v.deadline - now) : '');
  t.update = (x) => { if (v.deadline) t.textContent = fmtTime(v.deadline - x); };
  return h('div', { class: 'panel blood vote-panel' }, h('div', { class: 'tag' }, 'SECRET VOTE'), h('div', { class: 'display fight-name' }, v.question), h('div', { class: 'small muted' }, `${cast} of ${of} have voted`), t);
}
