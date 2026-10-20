// The fight and minigame frames on the TV (SPEC.md › Attacks and spells, PvP: the Challenge Wheel, GM controls ›
// Spotlight, Shared screen). Everything here renders from state only: the game snapshot in `fight.game.legacy`
// (secret-free), `fight.lastGame`, `c.creation.gambles`, `state.challenge`, `state.area`. Monster Health is public;
// character Health is never printed, only the lantern tell.
//
//   fightPanel(state, { now })            → the rail panel for an open encounter (or the last round of one)
//   stageOverlay(stage, state, { now })   → the big stage over the map while a round plays or has just landed
//   spotlightGrid(stage, state, { now })  → the GM's 2×2 of up to four phones' games
//   offScreenCardEl(state, { now })       → the corner card for an external challenge entry
//   challengePanel(state, { now })        → the rail panel for a PvP challenge (hosted duels show hosted.tvView)
//   areaPanel(state, { now })             → who has staked in an open Area window
import { h, ticker, fmtTime } from './dom.js';
import { wheelElement, spinTo, landedFor } from './wheel.js';
import { WHEEL_SPIN_MS } from './sound.js';
import { stageHtml, esc, cardsHtml } from '../games/stage.js';
import { EXTRA } from '../games/legacy/games-extra.js';
import { baseOdds, gameMeta } from '../games/adapter.js';
import { healthThird } from '../shared/health.js';
import { group } from '../shared/balance.js';
import { characterOf, playerOfCharacter } from '../shared/state.js';
import { offScreenCard } from '../shared/handlers/challenge.js';
import * as hosted from '../shared/challenge/hosted.js';
import regionsRaw from '../../data/regions.json' with { type: 'json' };

const REGION_NAME = Object.fromEntries(regionsRaw.regions.map(r => [r.id, r.name]));
const nameOf = (state, pid) => characterOf(state, pid)?.name || state.players[pid]?.name || pid || '—';
const charName = (state, id) => state.characters[id]?.name || state.monsters[id]?.name || id;
const TELL = { high: 'burns bright', mid: 'is guttering', low: 'is almost out', dead: 'is out' };
export const tellLine = (state, c) => (c ? `${c.name}'s lantern ${TELL[healthThird(c, group(state, 'health'))]}.` : '');

// The stage HTML for a snapshot, through the same renderers the phone and the Lab use.
export function snapshotHtml(snap, now) {
  if (!snap || !snap.id) return '';
  const x = { esc, cardsHtml, odds: baseOdds(snap.id), now, rng: null, state: null };
  // stageHtml routes the 12 classics to their bodies and everything else to EXTRA[id].stage(snapshot, now, x).
  try { return stageHtml(snap, now, x); } catch (e) { return `<div class="stage-sub">${esc(EXTRA[snap.id]?.name || snap.id)}: ${esc(e.message)}</div>`; }
}
// A node that re-renders the snapshot every frame while something in it is still landing (revealAt, timed cards).
export function liveStage(snap, { now = Date.now(), until = null, className = 'tv-stage' } = {}) {
  const node = h('div', { class: className, html: snapshotHtml(snap, now) });
  const end = until ?? Math.max((snap?.view?.revealAt || 0), (snap?.startedTs || 0), now) + 3200;
  let last = '';
  const stop = ticker((t) => {
    if (!node.isConnected && t - now > 500) { stop(); return; }
    if (t > end) { stop(); const html = snapshotHtml(snap, t); if (html !== last) { node.innerHTML = html; last = html; } return; }
    const html = snapshotHtml(snap, t); if (html !== last) { node.innerHTML = html; last = html; }
  });
  return node;
}
const resultLine = (r) => {
  if (!r) return null;
  const dmg = r.damage || 0;
  if (r.healed > 0) return { cls: 'hit', text: `MEND · ${r.healed} HEALED` };
  if (r.shielded > 0) return { cls: 'hit', text: `WARD · ${r.shielded} SHIELD` };
  if (r.crit && dmg > 0) return { cls: 'crit', text: `CRIT · ${dmg} DAMAGE` };
  if (dmg > 0) return { cls: 'hit', text: `HIT · ${dmg} DAMAGE` };
  if (r.mult > 0 && r.mult < 1 && !r.loss) return { cls: 'push', text: 'PUSH' };
  if (r.loss > 0 || r.mult === 0) return { cls: 'miss', text: `MISS${r.loss ? ` · ${r.loss} LOST` : ''}` };
  return { cls: 'push', text: 'PUSH' };
};
const itemName = (state, id, attackerId) => { const c = state.characters[attackerId]; const it = c?.items?.[id] || Object.values(c?.worn || {}).find(w => w && w.id === id) || (state.monsters[attackerId]?.items || []).find(w => w.id === id); return it?.name || null; };
const gameName = (gameId) => gameMeta(gameId).name;

// ── the rail's fight panel ──────────────────────────────────────────
export function fightPanel(state, { now = Date.now() } = {}) {
  const f = state.fight; if (!f || f.kind === 'solo' && !f.game && !f.lastGame) return null;
  const m = state.monsters[f.monsterId] || null;
  const pc = characterOf(state, f.playerId);
  const region = m?.regionId ? REGION_NAME[m.regionId] : (pc?.region ? REGION_NAME[pc.region] : '');
  const panel = h('div', { class: `panel blood fight-panel${f.done ? ' done' : ''}` });
  panel.append(h('div', { class: 'tag' }, `${f.kind === 'solo' ? 'DUEL' : f.kind === 'boss' ? 'BOSS FIGHT' : f.kind === 'raid' ? 'RAID' : 'FIGHT'}${region ? ' · ' + region.toUpperCase() : ''}`));
  if (m) {
    const st = m.stats || {};
    panel.append(h('div', { class: 'row between' }, h('div', { class: 'display fight-name' }, m.name), h('div', { class: 'muted small' }, `Lv ${m.level || Math.max(1, Math.round((m.maxHealth || 30) / 20))} · Grit ${st.grit ?? '–'} · Luck ${st.luck ?? '–'}`)));
    const pct = m.maxHealth ? Math.max(0, Math.min(100, 100 * m.health / m.maxHealth)) : 0;
    panel.append(h('div', { class: 'hbar' }, h('div', { class: 'hbar-fill', style: { width: pct + '%' } })));
    panel.append(h('div', { class: 'row between small muted' }, h('span', {}, `${m.health} / ${m.maxHealth} Health`), h('span', {}, `moves: ${(m.items || []).map(it => it.name).join(' · ') || '—'}`)));
    if (m.gmControlled) panel.append(h('div', { class: 'small gm' }, 'The GM holds the monster.'));
  }
  panel.append(h('div', { class: 'hr' }));
  const g = f.game && !f.game.result ? f.game : f.lastGame;
  if (g) {
    const who = g.attackerKind === 'monster' || state.monsters[g.attackerId] ? (state.monsters[g.attackerId]?.name || 'The monster') : charName(state, g.attackerId);
    const iname = itemName(state, g.itemId, g.attackerId) || gameName(g.gameId);
    panel.append(h('div', { class: 'row between small' }, h('span', { class: 'muted' }, `${who} plays`), h('span', {}, `${iname} · stake ${g.stake}`)));
    const callText = g.lastText || g.legacy?.view?.lastText || '';
    if (callText) panel.append(h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Call'), h('span', { class: 'ellip' }, callText)));
    const r = g.result ? resultLine(g.result) : null;
    if (r) panel.append(h('div', { class: `result ${r.cls}` }, r.text));
    else if (f.turn === 'monster' && !f.game) panel.append(h('div', { class: 'result pending' }, 'THE MONSTER MOVES…'));
    else panel.append(h('div', { class: 'result pending' }, g.pendingChoice ? `${g.pendingChoice.kind.toUpperCase()}?` : 'PLAYING…'));
  } else if (f.turn === 'monster') panel.append(h('div', { class: 'result pending' }, 'THE MONSTER MOVES…'));
  else panel.append(h('div', { class: 'small muted ital' }, `${pc?.name || 'The mover'} picks a weapon…`));
  if (pc) panel.append(h('div', { class: 'small ital muted tell' }, tellLine(state, pc)));
  if (f.done) panel.append(h('div', { class: 'small gold' }, f.result === 'won' ? `${m?.name || 'The monster'} is destroyed.` : f.result === 'fled' ? `${pc?.name || 'The mover'} backs away.` : f.result === 'lost' ? `${pc?.name || 'The mover'} falls.` : 'The fight is over.'));
  return panel;
}

// ── the big stage over the map ──────────────────────────────────────
// Shown while a round is in play and for a few seconds after it lands; one entry per round (itemId + startedTs).
const shown = new Map();   // roundKey → { firstSeen, doneSeen }
export function stageOverlay(stage, state, { now = Date.now(), onDismiss = null } = {}) {
  const f = state.fight; if (!f) return null;
  const live = f.game && !f.game.result ? f.game : null;
  const g = live || f.lastGame; if (!g) return null;
  const key = `${g.itemId}:${g.startedTs}:${g.attackerId}`;
  let rec = shown.get(key); if (!rec) { rec = { firstSeen: now, doneSeen: null }; shown.set(key, rec); if (shown.size > 50) shown.delete(shown.keys().next().value); }
  if (g.result && !rec.doneSeen) rec.doneSeen = now;
  const snap = g.legacy;
  const revealAt = snap?.view?.revealAt || 0;
  // Wheel games (50/50, Big Wheel, Roulette, Wheel of Colours) carry the spin in the snapshot: the TV turns a wheel.
  const spin = snap?.spin && Array.isArray(snap.spin.outcomes) && snap.spin.index != null ? snap.spin : null;
  if (spin && !rec.wheelEl) { rec.wheelEl = wheelElement({ outcomes: spin.outcomes, colors: spin.colors || null, title: spin.wheel || null }); rec.wheelEl.classList.add('round-wheel'); rec.spinStart = now; spinTo(rec.wheelEl, spin.index, { ms: WHEEL_SPIN_MS }).then(() => { rec.landed = true; onDismiss?.(); }); }
  const spinEnd = spin ? rec.spinStart + WHEEL_SPIN_MS : 0;
  const dismissAt = rec.doneSeen ? Math.max(rec.doneSeen, revealAt, spinEnd) + 3000 : Infinity;
  if (now >= dismissAt) return null;
  if (!live && !snap) return null;      // a landed round without a snapshot (a bot's headless play): the rail line is enough
  const attackerIsMonster = !!state.monsters[g.attackerId];
  const who = attackerIsMonster ? state.monsters[g.attackerId].name : charName(state, g.attackerId);
  const target = g.targetKind === 'self' ? 'themselves' : charName(state, g.targetId);
  const iname = itemName(state, g.itemId, g.attackerId) || gameName(g.gameId);
  if (live && !snap) {
    // The phone has not sent a step yet (or plays headlessly): a strip over the map, not an empty stage.
    const strip = h('div', { class: 'round-strip panel gold' }, h('div', { class: 'tag' }, `${gameName(g.gameId).toUpperCase()} · STAKE ${g.stake}`), h('div', { class: 'display' }, `${who} · ${iname}`), h('div', { class: 'ital muted small' }, g.targetKind === 'self' ? `on ${target} · on the phone…` : `against ${target} · on the phone…`));
    stage.append(strip); return strip;
  }
  const wrap = h('div', { class: 'stage-wrap round-overlay' });
  const panel = h('div', { class: 'panel gold round-panel' },
    h('div', { class: 'round-head' }, h('div', { class: 'tag' }, `${gameName(g.gameId).toUpperCase()} · ${g.mode === 'chips' ? 'CHIPS' : 'STAKE ' + g.stake}`), h('h2', {}, `${who} · ${iname}`), h('div', { class: 'ital muted' }, g.targetKind === 'self' ? `${who} turns the game on ${target}` : `against ${target}`)));
  if (spin) panel.append(h('div', { class: 'tv-stage wheel-stage' }, rec.wheelEl, rec.landed ? h('div', { class: 'stage-sub' }, spin.effect || spin.outcomes[spin.index]) : null));
  else if (snap) panel.append(liveStage(snap, { now, until: rec.doneSeen ? dismissAt : null }));
  else panel.append(h('div', { class: 'tv-stage' }, h('div', { class: 'stage-sub' }, g.lastText || 'The phone is playing…')));
  const r = g.result ? resultLine(g.result) : null;
  const foot = h('div', { class: 'round-foot' }, r && (!spin || rec.landed) ? h('div', { class: `result big ${r.cls}` }, r.text) : h('div', { class: 'result big pending' }, g.pendingChoice ? `${g.pendingChoice.kind.toUpperCase()}…` : (spin ? 'THE WHEEL TURNS…' : (g.lastText || '…'))));
  panel.append(foot);
  wrap.append(panel);
  stage.append(wrap);
  if (Number.isFinite(dismissAt)) setTimeout(() => { if (wrap.isConnected) { wrap.remove(); onDismiss?.(); } }, Math.max(0, dismissAt - now) + 20);
  return wrap;
}

// ── Spotlight: up to four phones' games in a 2×2 ────────────────────
export function spotlightGrid(stage, state, { now = Date.now() } = {}) {
  const ids = (state.gm?.spotlight || []).filter(id => state.players[id]).slice(0, 4);
  if (!ids.length) return null;
  const wrap = h('div', { class: 'stage-wrap spotlight' });
  const grid = h('div', { class: `spot-grid n${ids.length}` });
  for (const pid of ids) {
    const c = characterOf(state, pid), p = state.players[pid];
    const cell = h('div', { class: 'spot-cell panel' }, h('div', { class: 'row between' }, h('div', { class: 'display' }, c?.name || p.name), h('div', { class: 'tag' }, c ? `${c.classId || ''}${c.level ? ' · Lv ' + c.level : ''}` : (state.phase === 'creation' ? 'creating' : ''))));
    let snap = null, caption = '';
    if (state.phase === 'creation' || state.phase === 'lobby') {
      snap = c?.creation?.lastRound || null;
      const last = c?.creation?.gambles?.at(-1);
      caption = c ? (c.locked ? `locked in · ${Object.entries(c.stats || {}).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v}`).join(' · ')}` : last ? `gambled ${last.chips} chips on ${gameName(last.gameId)} for ${last.stat}: ${last.mult > 1 ? `×${last.mult} → +${last.points}` : 'lost'}${c.chips != null ? ` · ${c.chips} chips left` : ''}` : `${c.chips ?? ''} chips in hand`) : 'dressing the sprite…';
    } else {
      const f = state.fight, g = f && (f.game?.attackerPlayerId === pid ? f.game : f.lastGame?.attackerPlayerId === pid ? f.lastGame : null);
      snap = g?.legacy || null;
      caption = g ? `${itemName(state, g.itemId, g.attackerId) || gameName(g.gameId)} · stake ${g.stake}${g.result ? ' · ' + (resultLine(g.result)?.text || '') : ''}` : (state.challenge && (state.challenge.attackerId === pid || state.challenge.defenderId === pid) ? `in a challenge: ${state.challenge.entry?.name || '…'}` : 'waiting for a fight');
    }
    if (snap) cell.append(liveStage(snap, { now, className: 'tv-stage spot-stage' }));
    else if (c?.creation && (state.phase === 'creation' || state.phase === 'lobby')) {
      const gambles = c.creation.gambles || [];
      cell.append(h('div', { class: 'tv-stage spot-stage creation' },
        h('div', { class: 'stage-big small' }, c.locked ? 'LOCKED IN' : `${c.chips ?? 0} CHIPS`),
        h('div', { class: 'statline big' }, ['luck', 'nerve', 'greed', 'grit'].map(k => h('span', { class: 'stat' }, h('b', {}, String(c.stats?.[k] ?? 3)), ' ', k[0].toUpperCase() + k.slice(1)))),
        h('div', { class: 'xtrail' }, gambles.length ? gambles.slice(-6).map(gm => h('span', { class: `xpill ${gm.mult > 1 ? 'ok' : 'no'}` }, `${gm.chips} on ${gameName(gm.gameId)} → ${gm.stat}${gm.mult > 1 ? ` +${gm.points}` : ' burned'}`)) : h('span', { class: 'stage-sub' }, 'no gamble yet')),
        c.creation.blooded ? h('div', { class: 'stage-sub' }, `staked ${c.creation.bloodStaked} max Health on a last pull`) : null));
    } else cell.append(h('div', { class: 'tv-stage spot-stage idle' }, h('div', { class: 'stage-sub' }, 'nothing on the phone yet')));
    cell.append(h('div', { class: 'small muted spot-cap' }, caption));
    grid.append(cell);
  }
  wrap.append(h('div', { class: 'spot-head tag' }, 'SPOTLIGHT'), grid);
  stage.append(wrap);
  return wrap;
}

// The Challenge Wheel's result is secret until the GM window closes and the TV's wheel has stopped.
const challengeLanded = (state, now) => { const ch = state.challenge; if (!ch) return true; if (ch.gmWindowUntil && now < ch.gmWindowUntil) return false; const sp = state.lastSpin; return !(sp && sp.wheel === 'challenge' && sp.challengeId === ch.id) || landedFor(sp.ts); };

// ── the Off-Screen card ─────────────────────────────────────────────
export function offScreenCardEl(state, { now = Date.now() } = {}) {
  const card = offScreenCard(state); if (!card) return null;
  if (!challengeLanded(state, now)) return null;   // the wheel has not landed on the TV yet
  const a = characterOf(state, card.aId), b = characterOf(state, card.bId);
  const timer = h('div', { class: 'offscreen-timer display' }, card.deadline ? fmtTime(card.deadline - now) : '—');
  const el = h('div', { class: 'offscreen-card panel gold' },
    h('div', { class: 'offscreen-logo' }, '◎'),
    h('div', { class: 'offscreen-body' },
      h('div', { class: 'tag' }, 'CHALLENGE WHEEL · OFF-SCREEN'),
      h('div', { class: 'offscreen-names' }, h('span', { class: 'crest' }, a?.crest || '🂠'), h('b', {}, nameOf(state, card.aId)), h('span', { class: 'muted' }, ' v '), h('span', { class: 'crest' }, b?.crest || '🂠'), h('b', {}, nameOf(state, card.bId))),
      h('div', { class: 'offscreen-game' }, card.entryName),
      h('div', { class: 'small muted' }, 'played away from the table · the map carries on')),
    timer);
  if (card.deadline) { const stop = ticker((t) => { if (!el.isConnected && t - now > 500) return stop(); timer.textContent = fmtTime(card.deadline - t); timer.classList.toggle('warn', card.deadline - t < 30000); }); }
  return el;
}

// ── PvP challenge in the rail ───────────────────────────────────────
function hostedBody(state, game, now) {
  const v = hosted.tvView(game, now); if (!v) return null;
  const A = nameOf(state, v.aId), B = nameOf(state, v.bId);
  const rows = [];
  const score = (obj, fmt = (x) => x) => h('div', { class: 'row between' }, h('span', {}, `${A} ${fmt(obj?.[v.aId] ?? 0)}`), h('span', {}, `${B} ${fmt(obj?.[v.bId] ?? 0)}`));
  switch (v.game) {
    case 'quickdraw': rows.push(h('div', { class: `quickdraw ${v.flash ? 'flash' : ''}` }, v.flash ? 'DRAW!' : 'wait for it…'), score(v.taps, (t) => (t == null ? '…' : 'tapped'))); break;
    case 'speedmath': rows.push(h('div', { class: 'small muted' }, `${v.total} sums`), score(v.scores)); break;
    case 'memorymatch': { const g = h('div', { class: 'mm-grid' }); for (const c of v.cards || []) g.append(h('div', { class: `mm-card ${c ? 'up' : ''}` }, c || '')); rows.push(g, score(v.score), h('div', { class: 'small muted' }, `${nameOf(state, v.turn)} to flip`)); break; }
    case 'trivia': rows.push(h('div', { class: 'small muted' }, `${v.total} questions`), score(v.answered, (n) => `${n}/${v.total}`), v.scores ? score(v.scores, (n) => `${n} right`) : null); break;
    case 'highestcard': rows.push(v.cards ? score(v.cards) : score(v.drawn, (d) => (d ? 'drawn' : '…'))); break;
    case 'typingrace': rows.push(h('div', { class: 'ital small' }, `“${v.sentence}”`), score(v.attempts, (n) => `${n} tries`)); break;
    case 'emojimemory': rows.push(h('div', { class: 'small muted' }, `sequence of ${v.length}`), score(v.round, (n) => `round ${n}`), score(v.out, (o) => (o ? 'out' : 'in'))); break;
    default: rows.push(h('div', { class: 'small muted' }, v.game));
  }
  if (v.done) rows.push(h('div', { class: 'result hit' }, v.draw ? 'DRAW' : `${nameOf(state, v.winnerId)} WINS${v.flawless ? ' · FLAWLESS' : ''}`));
  return h('div', { class: 'hosted-view' }, rows);
}
export function challengePanel(state, { now = Date.now() } = {}) {
  const ch = state.challenge; if (!ch) return null;
  if (ch.done && now - (ch.settledAt || ch.doneAt || state.lastEventTs || 0) > 8000) return null;
  const A = nameOf(state, ch.attackerId), B = nameOf(state, ch.defenderId);
  const panel = h('div', { class: 'panel blood challenge-panel' }, h('div', { class: 'tag' }, `CHALLENGE · ${String(ch.call || 'duel').toUpperCase()}${ch.arena ? ' · ARENA' : ''}`));
  panel.append(h('div', { class: 'display fight-name' }, `${A} v ${B}`));
  if (ch.call === 'wager' || ch.call === 'robbery') panel.append(h('div', { class: 'small muted' }, `${ch.amount || ch.pot || 0} Gold on the line`));
  if (!ch.spun) panel.append(h('div', { class: 'small ital muted' }, ch.call === 'wager' && !ch.accepted ? `${B} decides whether to accept…` : !ch.defenderItemId && !ch.defenderAnswered ? `${B} picks a weapon…` : `${A} spins the Challenge Wheel…`));
  else {
    const landed = challengeLanded(state, now) || ch.done;
    if (!landed) panel.append(h('div', { class: 'small ital muted' }, 'The Challenge Wheel is turning…'));
    else {
      panel.append(h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'The wheel says'), h('b', {}, ch.entry?.name || '—')));
      if (ch.entry && !ch.entry.hosted) panel.append(h('div', { class: 'small muted' }, 'played off-screen · see the card on the map'));
      if (ch.hostedGame) panel.append(hostedBody(state, ch.hostedGame, now));
      else if (ch.entry?.hosted) panel.append(h('div', { class: 'small ital muted' }, `${gameName(ch.entry.game)} on the two phones…`));
    }
    if (ch.deadline && !ch.done) { const t = h('div', { class: 'clock-big small' }, fmtTime(ch.deadline - now)); panel.append(t); const stop = ticker((x) => { if (!t.isConnected && x - now > 500) return stop(); t.textContent = fmtTime(ch.deadline - x); }); }
    if (ch.gmPending) panel.append(h('div', { class: 'small gm' }, 'The two phones disagree. The GM decides.'));
    if (ch.done) panel.append(h('div', { class: 'result hit' }, ch.winnerId ? `${nameOf(state, ch.winnerId)} WINS${ch.flawless ? ' · FLAWLESS' : ''}` : 'DRAW · BOTH TAKE 10'));
  }
  if (ch.series) panel.append(h('div', { class: 'small muted' }, `best of ${ch.series.target * 2 - 1} · round ${ch.series.round}`));
  return panel;
}

// ── Area windows ────────────────────────────────────────────────────
export function areaPanel(state, { now = Date.now() } = {}) {
  const a = state.area; if (!a || (a.done && now - (a.resolvedAt || state.lastEventTs || 0) > 6000)) return null;
  const attacker = state.characters[a.attackerId];
  const panel = h('div', { class: 'panel gold area-panel' }, h('div', { class: 'tag' }, `AREA · ${gameName(a.gameId).toUpperCase()}`));
  panel.append(h('div', { class: 'display fight-name' }, `${attacker?.name || '—'} opens ${itemName(state, a.itemId, a.attackerId) || gameName(a.gameId)}`));
  const stakes = Object.entries(a.stakes || {});
  panel.append(h('div', { class: 'small' }, 'Staked: ', stakes.length ? stakes.map(([cid, s]) => `${state.characters[cid]?.name || cid} (${s.stake ?? s})`).join(' · ') : 'nobody yet'));
  if (!a.done && a.deadline) { const t = h('div', { class: 'clock-big small' }, fmtTime(a.deadline - now)); panel.append(t, h('div', { class: 'small muted ital' }, 'everyone on the hex may stake')); const stop = ticker((x) => { if (!t.isConnected && x - now > 500) return stop(); t.textContent = fmtTime(a.deadline - x); }); }
  if (a.done && a.results) panel.append(h('div', { class: 'small' }, Object.entries(a.results).map(([cid, r]) => `${state.characters[cid]?.name || cid}: ${r.mult > 1 ? `×${r.mult}` : r.mult === 1 ? 'push' : 'lost'}`).join(' · ')));
  return panel;
}
export { resultLine, playerOfCharacter };
