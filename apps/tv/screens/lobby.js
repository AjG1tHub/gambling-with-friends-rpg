// TV lobby and creation: who is at the table, each seat's creation progress with the creation clock, the GM's
// Spotlight of creation gambles, and the Buy-in Wheel spins (SPEC.md › Character creation, Before the run).
import { h, fmtTime } from '../../../packages/ui/dom.js';
import { characterOf } from '../../../packages/shared/state.js';
import { creationStatus } from '../../../packages/shared/handlers/creation.js';
import { spinOverlay } from '../../../packages/ui/wheel.js';
import { spotlightGrid } from '../../../packages/ui/stage.js';
import { className } from '../../../packages/ui/recap.js';
import { gameMeta } from '../../../packages/games/adapter.js';

const STATS = ['luck', 'nerve', 'greed', 'grit'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderLobby({ state, session, stage, rail, clockEls, rerender = null, now = Date.now() }) {
  const creating = state.phase === 'creation';
  const status = creationStatus(state, now);
  const seats = status.players.filter(r => state.players[r.playerId] && !state.players[r.playerId].kicked);
  const list = h('div', { class: 'lobby-list' });
  for (const r of seats) {
    const p = state.players[r.playerId], c = characterOf(state, r.playerId);
    const last = c?.creation?.gambles?.at(-1);
    const stage_ = !p.connected && !p.autopilot ? 'phone asleep' : !r.hasCharacter ? (creating ? 'dressing the sprite…' : p.ready ? 'ready' : 'at the table') : !r.classId ? 'choosing a class…' : !r.locked ? `gambling · ${r.chips ?? 0} chip${r.chips === 1 ? '' : 's'} in hand` : r.hatching ? 'hatching a pet…' : r.veteran ? 'a veteran returns' : (p.ready ? 'locked in · ready' : 'locked in');
    const card = h('div', { class: `seat${!p.connected && !p.autopilot ? ' off' : ''}${p.ready && (!creating || r.locked) ? ' ready' : ''}${r.locked ? ' locked' : ''}` },
      h('div', { class: 'crest' }, r.crest || '🂠'),
      h('div', { class: 'seat-body' },
        h('div', { class: 'name' }, r.charName || r.name, r.charName && r.charName !== r.name ? h('span', { class: 'muted small' }, ` · ${r.name}`) : null),
        h('div', { class: 'small muted' }, r.classId ? `the ${className(r.classId)}${r.level > 1 ? ` · Lv ${r.level}` : ''} · ` : '', stage_, p.autopilot ? ' · autopilot' : ''),
        r.stats && (r.locked || creating) ? h('div', { class: 'statline' }, STATS.map(k => h('span', { class: `stat${last && last.stat === k && !r.locked ? ' hot' : ''}` }, h('b', {}, String(r.stats[k])), ' ', cap(k)))) : null,
        last && !r.locked ? h('div', { class: 'small ital muted' }, `${last.chips} chips on ${gameMeta(last.gameId).name} for ${cap(last.stat)}: ${last.mult > 1 ? `×${last.mult}, +${last.points}` : 'burned'}`) : null,
        r.pets ? h('div', { class: 'small muted' }, `${r.pets} pet${r.pets === 1 ? '' : 's'}`) : null));
    list.append(card);
  }
  if (!seats.length) list.append(h('p', { class: 'muted ital', style: { padding: '2vw' } }, 'Nobody has sat down yet. Scan the code to join.'));
  stage.append(h('div', { class: 'lobby-wrap' },
    h('div', { class: 'row between lobby-head' }, h('h2', {}, creating ? 'Character creation' : 'The lobby'), h('div', { class: 'ital muted' }, creating ? 'Dress the sprite, pick a class, gamble for your stats.' : 'Pick a character from your roster or make a new one when creation opens.')),
    list));
  // Rail: the creation clock, the table count, what happens next.
  const watching = Object.values(state.players).filter(p => p.spectator && !p.kicked).length;
  const locked = seats.filter(r => r.locked).length;
  if (creating && status.deadline) {
    const t = h('div', { class: 'clock-big' }, fmtTime(status.remainingMs));
    t.update = (x) => { const ms = Math.max(0, status.deadline - x); t.textContent = fmtTime(ms); t.classList.toggle('warn', ms < 60000); };
    clockEls.main = t;
    rail.append(h('div', { class: 'panel gold' }, h('div', { class: 'tag' }, 'CREATION CLOCK'), t, h('div', { class: 'small muted' }, `${locked} of ${seats.length} locked in · anyone not locked at zero takes the safe allocation`)));
  } else {
    delete clockEls.main;
    rail.append(h('div', { class: 'panel' }, h('div', { class: 'tag' }, 'AT THE TABLE'), h('div', { class: 'display big-num' }, String(seats.length)), h('p', { class: 'small muted' }, `${seats.filter(r => state.players[r.playerId].ready).length} ready${watching ? ` · ${watching} watching` : ''}`), h('p', { class: 'small muted' }, creating ? 'The GM starts the run when the table is locked in.' : 'Waiting for the GM to open creation.')));
  }
  const spun = seats.filter(r => characterOf(state, r.playerId)?.buyinSpun).length;
  if (creating) rail.append(h('div', { class: 'panel' }, h('div', { class: 'tag' }, 'BUY-IN WHEEL'), h('p', { class: 'small muted' }, spun ? `${spun} of ${seats.length} starting Health set.` : 'The GM spins each player\'s starting Health before the run.')));
  // Overlays: Buy-in Wheel / Pet Wheel spins, the Spotlight of creation gambles.
  spinOverlay(stage, state.lastSpin, { now, onDismiss: rerender, spinnerName: state.lastSpin ? (characterOf(state, state.lastSpin.playerId)?.name || state.players[state.lastSpin.playerId]?.name || null) : null });
  spotlightGrid(stage, state, { now });
}
