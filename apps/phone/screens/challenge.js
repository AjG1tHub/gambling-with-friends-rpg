// The Challenge Wheel on the phone (SPEC.md › PvP: the Challenge Wheel). Built from challengeView(): the defender's
// answer (accept a Wager, pick a weapon or go bare-handed), the attacker's Spin, the GM's secret window, then the
// game: purpose-built duels rendered per kind from hosted.phoneView and advanced with CHALLENGE_STEP; the four
// Versus items played with the adapter on the attacker's phone and reported with CHALLENGE_REPORT; external entries
// as a rules card with the link, the countdown and "Who won?". A result banner shows from state.lastChallenge.
import { h, toast, buzz } from '../../../packages/ui/dom.js';
import { characterOf } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { challengeView, VERSUS_GAMES } from '../../../packages/shared/handlers/challenge.js';
import { startRound, gameMeta, ITEMS } from '../../../packages/games/adapter.js';
import { liveRound, dropRound, roundView, seedFor } from '../../../packages/ui/minigame.js';
import { sect, why, itemRow, nameOf, weapons, countdown, redraw } from './prompts.js';

const EMOJI = ['🂠', '🎲', '🎰', '🪙', '🔔', '🍒', '💎', '👑', '🃏', '🧿', '🕯', '🐦', '🩸', '⚔', '🪦', '🏪'];
const buzzed = new Set();
const local = { emoji: null, math: '' };   // per-phone scratch for the keypad and the emoji sequence

export function challengeScreen(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const v = challengeView(state, me, Date.now()); const ch = state.challenge;
  if (!v || !ch || ch.done || v.role === 'spectator') return false;
  if (v.role === 'defender' && !buzzed.has(ch.id)) { buzzed.add(ch.id); buzz([120, 60, 120, 60, 200]); }
  const other = v.role === 'attacker' ? v.defenderId : v.attackerId;
  const stake = v.call === 'duel' ? 'one hit, winner\'s weapon' : v.call === 'wager' ? `${v.amount} Gold each` : `robbery of ${v.amount} Gold`;
  screen.append(h('div', { class: 'ch-head' }, h('div', { class: 'tag' }, `Challenge Wheel · ${v.call}`), h('h2', {}, `${nameOf(state, v.attackerId)} ⚔ ${nameOf(state, v.defenderId)}`), h('p', { class: 'muted' }, `${stake}${v.arena ? ' · Arena' : ''}${v.pot ? ` · pot ${v.pot}` : ''}${v.calledOut ? ' · Called Out' : ''}`)));
  if (v.phase === 'answer') {
    if (v.canAnswer) screen.append(h('div', { class: 'prompt blood' }, h('h3', {}, 'A wager'), h('p', {}, `${nameOf(state, other)} wagers ${v.amount} Gold against yours. A declined Wager costs nothing.`), h('div', { class: 'btn-grid' }, h('button', { class: 'primary big', onClick: () => dispatch('CHALLENGE_ANSWER', { accept: true }) }, 'Accept'), h('button', { class: 'ghost big', onClick: () => dispatch('CHALLENGE_ANSWER', { accept: false }) }, 'Decline'))));
    else screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Waiting'), h('p', { class: 'muted ital' }, `${nameOf(state, other)} is deciding whether to take the wager.`)));
    return true;
  }
  if (v.phase === 'ready') {
    if (v.role === 'defender') {
      if (v.needsWeapon || (!ch.defenderAnswered && v.call !== 'wager')) {
        const ws = weapons(c).filter(it => (it.charges ?? 1) > 0);
        const box = sect('Pick your weapon', h('p', { class: 'muted ital' }, `If you win the round it hits once for this weapon's stake.${ch.defenderItemId ? ` Your main hand is in by default.` : ''} Bare hands win nothing but lose nothing extra.`));
        for (const it of ws) box.append(itemRow({ item: it, meta: `${gameMeta(it.gameId).icon} ${gameMeta(it.gameId).name} · stake ${it.stake} · ${it.rarity}`, action: 'PICK', hot: true, onTap: () => dispatch('CHALLENGE_ANSWER', { itemId: it.id }) }));
        box.append(h('button', { class: 'ghost big', onClick: () => dispatch('CHALLENGE_ANSWER', { itemId: null }) }, '✊ Bare hands'));
        screen.append(box);
      } else screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Ready'), h('p', { class: 'muted ital' }, `${nameOf(state, other)} spins the wheel.`)));
    } else {
      const waiting = v.call !== 'wager' && !ch.defenderAnswered;
      screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'Spin the Challenge Wheel'), h('img', { class: 'wheel-face', src: '/wheels/challenge.svg', alt: '', onError: (e) => { e.target.remove(); } }),
        waiting ? why(`${nameOf(state, other)} is still picking a weapon; you may spin now or give them a moment.`) : null,
        h('button', { class: 'primary big', onClick: () => dispatch('CHALLENGE_SPIN', {}) }, '🎡 Spin')));
    }
    return true;
  }
  if (v.phase === 'spinning') {
    screen.append(h('div', { class: 'prompt' }, h('h3', {}, 'The wheel turns'), h('p', { class: 'muted ital' }, 'The GM is looking at the wheel… the TV lands it in a moment.'), countdown(ch.gmWindowUntil, 'until it lands')));
    setTimeout(() => redraw(api), Math.max(200, (ch.gmWindowUntil || 0) - Date.now() + 100));
    return true;
  }
  if (v.phase === 'playing') {
    const e = v.entry;
    screen.append(h('div', { class: 'row between ch-entry' }, h('div', {}, h('div', { class: 'tag' }, 'It lands on'), h('b', { class: 'nm' }, e?.name || '?')), v.deadline ? countdown(v.deadline) : null));
    if (v.series) screen.append(why(`Best of three · round ${v.series.round} · ${v.series.wins[v.attackerId] || 0}–${v.series.wins[v.defenderId] || 0}`));
    if (e?.hosted && v.hosted) hostedDuel(api, v, ch);
    else if (e?.hosted && VERSUS_GAMES.includes(e.game)) versusDuel(api, v, ch);
    else externalEntry(api, v, ch);
    return true;
  }
  return false;
}

// ── purpose-built duels ─────────────────────────────────────────────────────────────────────────
function hostedDuel(api, v, ch) {
  const { state, me, h, dispatch, screen } = api; const g = v.hosted; const other = v.role === 'attacker' ? v.defenderId : v.attackerId;
  const step = (action, payload = {}) => dispatch('CHALLENGE_STEP', { action, payload });
  const box = sect(gameTitle(g.game));
  if (g.done) { box.append(resultLine(state, me, g)); screen.append(box); return; }
  switch (g.game) {
    case 'quickdraw':
      if (g.tapped) box.append(h('p', { class: g.falseStart ? 'bad' : 'ok' }, g.falseStart ? 'False start! You tapped before the flash.' : 'Tapped. Waiting for the result…'));
      else box.append(h('p', { class: 'muted ital' }, 'Watch the TV. Tap the moment it flashes; a tap before the flash loses.'), h('button', { class: 'tap-big danger', onClick: () => step('tap') }, 'TAP'));
      break;
    case 'speedmath': {
      if (!g.question) { box.append(h('p', { class: 'ok' }, `All ${g.total} answered, ${g.correct} right. Waiting for ${nameOf(state, other)} (${g.opponentAnswered}/${g.total})…`)); break; }
      const shown = h('div', { class: 'math-q' }, h('span', { class: 'tag' }, `${g.index + 1} / ${g.total} · you ${g.correct} · them ${g.opponentCorrect}`), h('b', {}, `${g.question} = `), h('span', { class: 'ans' }, local.math || '_'));
      const pad = h('div', { class: 'keypad' });
      const setAns = (s) => { local.math = s; shown.querySelector('.ans').textContent = s || '_'; };
      for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', '−', '0', '⌫']) pad.append(h('button', { class: 'key', onClick: () => { if (k === '⌫') setAns(local.math.slice(0, -1)); else if (k === '−') setAns(local.math.startsWith('-') ? local.math.slice(1) : '-' + local.math); else if (local.math.length < 6) setAns(local.math + k); } }, k));
      pad.append(h('button', { class: 'key go primary', onClick: () => { if (local.math === '' || local.math === '-') return; const a = Number(local.math); local.math = ''; step('answer', { answer: a }); } }, 'ENTER'));
      box.append(shown, pad);
      break;
    }
    case 'memorymatch': {
      box.append(h('div', { class: 'row between' }, h('span', { class: g.yourTurn ? 'ok' : 'muted' }, g.yourTurn ? 'Your turn: flip two' : `${nameOf(state, other)} is flipping`), h('span', { class: 'tag' }, `you ${g.score?.[me] || 0} · them ${g.score?.[other] || 0}`)));
      const cols = g.cards.length % 4 === 0 ? 4 : 3;
      box.append(h('div', { class: 'mem-grid', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } }, g.cards.map((s, i) => h('button', { class: `mem ${s ? 'up' : ''} ${g.lastFlip?.includes(i) ? 'last' : ''}`, disabled: !g.yourTurn || !!s, onClick: () => step('flip', { index: i }) }, s || '✦'))));
      break;
    }
    case 'trivia': {
      if (!g.question) { box.append(h('p', { class: 'ok' }, `Done: ${g.correct} of ${g.total}. Waiting for ${nameOf(state, other)} (${g.opponentAnswered}/${g.total})…`)); break; }
      box.append(h('div', { class: 'tag' }, `${g.index + 1} / ${g.total} · ${g.correct} right`), h('p', { class: 'triv-q' }, g.question.q), h('div', { class: 'col' }, g.question.options.map((o, i) => h('button', { class: 'big', onClick: () => step('answer', { choice: i }) }, o))));
      break;
    }
    case 'highestcard':
      box.append(h('div', { class: 'hc-row' }, h('div', { class: `hc ${g.card ? 'up' : ''}` }, g.card || '🂠'), h('span', { class: 'tag' }, 'vs'), h('div', { class: `hc ${g.opponentCard ? 'up' : ''}` }, g.opponentCard || '🂠')));
      if (!g.drawn) box.append(h('button', { class: 'primary big', onClick: () => step('draw') }, '🂠 Draw'));
      else box.append(why(g.opponentCard ? 'Both drawn.' : `Waiting for ${nameOf(state, other)} to draw…`));
      if (g.redraws) box.append(why(`${g.redraws} tie${g.redraws === 1 ? '' : 's'} redrawn by the deck.`));
      break;
    case 'typingrace': {
      const ta = h('textarea', { rows: 3, placeholder: 'Type it exactly…', autocapitalize: 'sentences', 'aria-label': 'your typing' });
      box.append(h('p', { class: 'type-target' }, g.sentence), ta, h('button', { class: 'primary big', onClick: () => { const t = ta.value; if (!t.trim()) return; step('submit', { text: t }); } }, 'Submit'),
        g.lastErrors != null ? why(`Last try: ${g.lastErrors} error${g.lastErrors === 1 ? '' : 's'}. Try again.`) : null, why(`Attempts: you ${g.attempts} · them ${g.opponentAttempts}`));
      break;
    }
    case 'emojimemory': {
      if (g.out) { box.append(h('p', { class: 'muted' }, `You are out at ${g.best}. ${nameOf(state, other)}: ${g.opponentBest}${g.opponentOut ? ' (out)' : ' and counting'}.`)); break; }
      const key = `${ch.id}:${g.round}`;
      if (!local.emoji || local.emoji.key !== key) local.emoji = { key, hidden: false, seq: [] };
      const L = local.emoji;
      box.append(h('div', { class: 'tag' }, `Round ${g.round} · best ${g.best} · them ${g.opponentBest}`));
      if (!L.hidden) box.append(h('div', { class: 'emo-show' }, (g.show || []).map(e => h('span', {}, e))), h('button', { class: 'primary big', onClick: () => { L.hidden = true; redraw(api); } }, 'I have it — hide it'));
      else {
        box.append(h('div', { class: 'emo-show typed' }, L.seq.length ? L.seq.map(e => h('span', {}, e)) : h('span', { class: 'muted' }, 'tap the sequence')),
          h('div', { class: 'emo-grid' }, EMOJI.map(e => h('button', { class: 'emo', onClick: () => { if (L.seq.length < g.round) { L.seq.push(e); redraw(api); } } }, e))),
          h('div', { class: 'btn-grid' }, h('button', { class: 'ghost', onClick: () => { L.seq.pop(); redraw(api); } }, '⌫ Undo'), h('button', { class: 'primary', disabled: L.seq.length !== g.round, onClick: () => { const seq = L.seq.slice(); local.emoji = null; step('recall', { sequence: seq }); } }, 'Recall')));
      }
      break;
    }
    default: box.append(why(`No phone renderer for ${g.game}.`), h('div', { class: 'btn-grid' }, v.reportButtons.map(b => h('button', { onClick: () => dispatch('CHALLENGE_REPORT', { winnerId: b.winnerId }) }, b.name))));
  }
  screen.append(box);
}
const gameTitle = (id) => ({ quickdraw: 'Quick-Draw', speedmath: 'Speed Math', memorymatch: 'Memory Match', trivia: 'Trivia', highestcard: 'Highest Card', typingrace: 'Typing Race', emojimemory: 'Emoji Memory' }[id] || id);
const resultLine = (state, me, g) => h('p', { class: g.winnerId === me ? 'ok' : g.draw ? 'muted' : 'bad' }, g.draw ? 'A draw.' : g.winnerId === me ? `You win${g.flawless ? ' — flawless!' : ''}.` : `${nameOf(state, g.winnerId)} wins.`);

// ── versus items: the attacker's phone plays the item round, both may report ────────────────────
function versusDuel(api, v, ch) {
  const { state, me, c, h, dispatch, screen } = api; const def = ITEMS[v.entry.game]; const other = v.role === 'attacker' ? v.defenderId : v.attackerId;
  const box = sect(`${gameMeta(def?.gameId).icon} ${def?.name || v.entry.name}`);
  if (v.role !== 'attacker' || !def) {
    box.append(h('p', { class: 'muted ital' }, `${nameOf(state, v.attackerId)} plays ${def?.name || v.entry.name} for the table; the result settles the round.`));
    reportRow(api, v, box); screen.append(box); return;
  }
  const key = seedFor('versus', ch.id, v.entry.id, ch.spunAt);
  const target = characterOf(state, other);
  const entry = liveRound(key, () => startRound({ state, B: (g) => group(state, g) }, { item: { id: `versus-${def.id}`, baseId: def.id, gameId: def.gameId, name: def.name, kind: 'versus', family: def.family, stat: def.stat, rarity: 'common', stake: group(state, 'items').stakeCommon, charges: 1 }, mode: 'health', stake: group(state, 'items').stakeCommon, attacker: c, target, rng: makeRng(hash32(seedFor(key, Date.now()))), now: Date.now(), holdPending: false }));
  const round = entry.round;
  const finish = () => { if (entry.resolved) return; entry.resolved = true; const o = round.outcome(); const winnerId = o.mult > 1 ? me : o.mult < 1 ? other : 'draw'; dispatch('CHALLENGE_REPORT', { winnerId, flawless: !!o.crit }).then(() => dropRound(key)); };
  const arm = () => { if (round.done && !entry.timer) entry.timer = setTimeout(finish, Math.max(0, (round.revealAt?.() || 0) - Date.now()) + 1000); };
  const after = () => { arm(); redraw(api); };
  arm();
  box.append(h('p', { class: 'muted ital' }, `You play the ${def.name} round against ${target?.name || nameOf(state, other)}: a win takes the round, a loss hands it over, a push is a draw.`));
  box.append(roundView({ round, stage: true, onAct: (a, p) => { const r = round.act(a, p, Date.now()); if (r?.error) toast(r.text, 'bad'); after(); }, onFork: (i) => { round.pickFork(i); after(); } }));
  if (round.done) box.append(why('Reporting the result…'));
  screen.append(box);
}

// ── external entries ────────────────────────────────────────────────────────────────────────────
function externalEntry(api, v, ch) {
  const { state, h, screen } = api; const e = v.entry || {};
  const box = sect('Away from the table');
  box.append(h('div', { class: 'rules-card' }, h('b', {}, e.name || 'The game'), h('p', {}, e.rules || 'Play it as the table agrees, then report who won.'),
    e.link ? h('a', { class: 'btn primary big', href: e.link, target: '_blank', rel: 'noopener' }, '↗ Open the link') : null,
    v.deadline ? h('p', { class: 'muted' }, 'Time cap: ', countdown(v.deadline), ' — nobody reported by then and you both take 10.') : null));
  reportRow(api, v, box);
  screen.append(box);
}
function reportRow(api, v, box) {
  const { state, me, h, dispatch } = api;
  if (!v.reportButtons?.length) return;
  if (v.gmPending) { box.append(h('p', { class: 'bad' }, 'You and your opponent disagree. The GM decides from the console.')); return; }
  if (v.myReport != null) { box.append(h('p', { class: 'ok' }, `You reported: ${v.myReport === 'draw' ? 'a draw' : nameOf(state, v.myReport) + ' won'}. Waiting for the other phone to agree…`), h('button', { class: 'ghost', onClick: () => dispatch('CHALLENGE_REPORT', { winnerId: v.myReport }) }, 'Send again')); return; }
  box.append(h('div', { class: 'tag' }, 'Who won?'), h('div', { class: 'btn-grid' }, v.reportButtons.map(b => h('button', { class: b.winnerId === me ? 'primary big' : 'big', onClick: () => dispatch('CHALLENGE_REPORT', { winnerId: b.winnerId }) }, b.name))));
}

// The banner after a challenge settles (state.lastChallenge), for both parties, for a short while.
export function challengeBanner(api) {
  const { state, me, h } = api; const ch = state.lastChallenge;
  if (!ch || !(ch.attackerId === me || ch.defenderId === me) || !ch.endedAt || Date.now() - ch.endedAt > 25000) return null;
  const won = ch.winnerId === me, draw = !ch.winnerId;
  return h('div', { class: `ch-banner ${won ? 'win' : draw ? 'draw' : 'lose'}` }, h('b', {}, draw ? 'No winner' : won ? `You won the ${ch.call}` : `${nameOf(state, ch.winnerId)} won the ${ch.call}`), h('span', { class: 'meta' }, `${ch.entry?.name || ''}${ch.flawless ? ' · flawless' : ''}${ch.hit ? ` · ${ch.hit.dmg} damage${ch.hit.killed ? ', a kill' : ''}` : ''}${ch.how === 'timeout' ? ' · timed out' : ''}`));
}
