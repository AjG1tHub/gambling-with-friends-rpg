// Lab screen: the Challenge Wheel's purpose-built hosted duels (packages/shared/challenge/hosted.js) played as
// player A against a bot B, rendered from phoneView the way a phone would; plus the external entries' rules card
// and the Off-Screen card preview. The four Versus items (Clash, Dice Duel, Shell Game, Hold'em Duel) are items
// in the catalog and play through the adapter.
import * as hosted from '../../../packages/shared/challenge/hosted.js';
import { activeList } from '../../../packages/shared/handlers/challenge.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { B } from '../../../packages/shared/balance.js';
import { ticker } from '../../../packages/ui/dom.js';

const ME = 'tester', BOT = 'sparring';
const EMOJI = ['🂠', '🎲', '🎰', '🪙', '🔔', '🍒', '💎', '👑', '🃏', '🧿', '🕯', '🐦', '🩸', '⚔', '🪦', '🏪'];
let stopTick = null;

export function screenChallenge(ctx) {
  const { lab, h, main, phone, id } = ctx;
  const gameId = id.slice('duel:'.length);
  stopTick?.(); stopTick = null;
  const list = activeList(lab.sb().state);
  const entry = list.find(e => e.game === gameId) || { id: gameId, name: gameId, hosted: true, game: gameId, rules: '', capSeconds: B.challenge.hostedCapSeconds };
  const cap = entry.capSeconds ?? B.challenge.hostedCapSeconds;
  let game = null, startedAt = 0, smartBot = true;
  const stage = h('div', { class: 'gwf-stage' }), controls = h('div', { class: 'gwf-controls' }), result = h('div', { class: 'lab-result' }), log = h('div', { class: 'log log-box' });
  const timer = h('span', { class: 'pill' }, `${cap}s`);
  const msg = (t, cls = '') => { log.prepend(h('div', { class: cls }, t)); while (log.children.length > 10) log.lastChild.remove(); };
  const finish = () => {
    const r = hosted.result(game); if (!r) return;
    result.textContent = r.winnerId === ME ? `YOU WIN${r.flawless ? ' — flawless (crit)' : ''}` : r.winnerId === BOT ? 'THE BOT WINS' : 'DRAW — nobody hits';
    result.className = `lab-result ${r.winnerId === ME ? 'win' : r.winnerId === BOT ? 'lose' : ''}`;
    msg(result.textContent, 'turn'); lab.record(id, 1, r.winnerId === ME ? 2 : r.winnerId === BOT ? 0 : 1, r.flawless && r.winnerId === ME);
    stopTick?.(); stopTick = null;
  };
  const botMove = () => { if (!game || game.done) return; const a = hosted.botAction(game, BOT, Date.now(), { smart: smartBot }); if (a) { const next = hosted.act(game, BOT, a.action, a.payload, Date.now()); if (next !== game) { game = next; msg(`Bot: ${a.action}`); } } };
  const act = (action, payload = {}) => { if (!game || game.done) return; const next = hosted.act(game, ME, action, payload, Date.now()); if (next === game) { msg(`${action}: not allowed now`, 'error'); return; } game = next; draw(); if (game.done) finish(); else { setTimeout(() => { botMove(); draw(); if (game.done) finish(); }, 350); } };
  const start = () => {
    stopTick?.();
    game = hosted.create(hash32(`${lab.seed}:${gameId}:${Date.now()}`), { ...entry, capSeconds: cap }, { aId: ME, bId: BOT }, Date.now(), B.challenge, lab.sb().state.gm.triviaBank);
    startedAt = Date.now(); result.textContent = ''; result.className = 'lab-result'; msg(`New ${entry.name}. Cap ${cap}s.`);
    draw();
    stopTick = ticker((t) => {
      const left = Math.max(0, cap - Math.round((t - startedAt) / 1000)); timer.textContent = `${left}s`;
      if (game && !game.done) { if (gameId === 'quickdraw' && t >= game.flashAt) draw(true); if (gameId === 'memorymatch' && game.turn === BOT) { botMove(); draw(); if (game.done) finish(); }
        if (left <= 0) { game = hosted.capped(game, t); draw(); finish(); } }
    });
  };
  const auto = () => { if (!game || game.done) return; for (let i = 0; i < 40 && !game.done; i++) { const a = hosted.botAction(game, ME, Date.now() + (gameId === 'quickdraw' ? 10000 : 0), { smart: true }); if (a) game = hosted.act(game, ME, a.action, a.payload, Date.now()); botMove(); } draw(); if (game.done) finish(); };
  function draw(lightweight = false) {
    if (!game) return;
    const now = Date.now(), v = hosted.phoneView(game, ME, now), tv = hosted.tvView(game, now);
    const you = `You ${v.winnerId === ME ? '🏆' : ''}`, opp = `Bot ${v.winnerId === BOT ? '🏆' : ''}`;
    if (!lightweight || gameId === 'quickdraw') stage.innerHTML = stageHtml(gameId, v, tv, now, you, opp);
    if (lightweight) return;
    controls.replaceChildren(); controls.className = `gwf-controls${phone ? ' phone' : ''}`;
    const btns = h('div', { class: 'btns' }); controls.append(btns);
    const b = (label, action, payload, cls = 'primary') => btns.append(h('button', { class: cls, disabled: game.done, onClick: () => act(action, payload) }, label));
    switch (gameId) {
      case 'quickdraw': if (!v.tapped) b(now >= game.flashAt ? '⚡ TAP!' : 'TAP (wait for the flash)', 'tap', {}, now >= game.flashAt ? 'primary' : 'danger'); break;
      case 'speedmath': if (v.question) { const inp = h('input', { type: 'number', placeholder: v.question, style: { maxWidth: '160px' }, autofocus: true }); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') act('answer', { answer: Number(inp.value) }); }); btns.append(inp, h('button', { class: 'primary', disabled: game.done, onClick: () => act('answer', { answer: Number(inp.value) }) }, 'Answer')); } break;
      case 'trivia': if (v.question) v.question.options.forEach((o, i) => b(o, 'answer', { choice: i }, '')); break;
      case 'memorymatch': { const g = h('div', { class: 'duel-grid' }); v.cards.forEach((c, i) => g.append(h('button', { disabled: game.done || !v.yourTurn || c != null, onClick: () => act('flip', { index: i }) }, c ?? '🂠'))); controls.append(g); break; }
      case 'highestcard': if (!v.drawn) b('🃏 Draw', 'draw', {}); break;
      case 'typingrace': { const inp = h('input', { placeholder: 'Type the sentence exactly', autofocus: true }); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') act('submit', { text: inp.value }); }); btns.append(inp, h('button', { class: 'primary', disabled: game.done, onClick: () => act('submit', { text: inp.value }) }, 'Submit')); break; }
      case 'emojimemory': { if (!v.out && v.show) { const seq = []; const shown = h('div', { class: 'emoji-seq' }, ''); const pad = h('div', { class: 'duel-grid' }); EMOJI.forEach(e => pad.append(h('button', { onClick: () => { seq.push(e); shown.textContent = seq.join(' '); } }, e))); controls.append(h('p', { class: 'muted' }, 'Memorise the sequence on the stage, then tap it back in order.'), shown, pad, h('div', { class: 'row' }, h('button', { class: 'primary', onClick: () => act('recall', { sequence: seq.slice() }) }, 'Recall'), h('button', { class: 'ghost', onClick: () => { seq.length = 0; shown.textContent = ''; } }, 'Clear'))); } break; }
      default: break;
    }
    if (game.done) btns.append(h('button', { class: 'primary', onClick: start }, '▶ Play again'));
  }
  lab.mount = { stop() { stopTick?.(); stopTick = null; }, auto, settle: () => false };
  const bot = h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: smartBot, onChange: (e) => { smartBot = e.target.checked; } }), ' smart bot');
  main.append(h('div', { class: 'panel col' }, h('p', { class: 'muted' }, entry.rules || 'A purpose-built duel hosted on the two phones.'), h('div', { class: 'row' }, h('span', { class: 'muted' }, 'cap '), timer, bot, h('button', { onClick: start }, 'Restart'), h('button', { onClick: auto }, '🤖 Auto-play both sides')), stage, controls, result, log),
    externalCard({ h, list }));
  start();
}

function stageHtml(gameId, v, tv, now, you, opp) {
  const big = (t, cls = '') => `<div class="stage-big ${cls}">${t}</div>`, sub = (t) => `<div class="stage-sub">${t}</div>`;
  const head = `<div class="stage-head">${gameId}</div>`;
  const done = v.done ? big(v.winnerId === 'tester' ? 'YOU WIN' : v.winnerId ? 'BOT WINS' : 'DRAW', v.winnerId === 'tester' ? 'crash-good' : v.winnerId ? 'crash-bad' : '') : '';
  switch (gameId) {
    case 'quickdraw': return head + (tv.flash ? big('⚡ FLASH ⚡', 'crash-live') : big('…', '')) + sub(v.tapped ? (v.falseStart ? 'False start!' : `tapped${v.reactionMs != null ? ` in ${v.reactionMs} ms` : ''}`) : 'Wait for the flash, then tap') + done;
    case 'speedmath': return head + big(v.question || '—') + sub(`${you}: ${v.correct}/${v.total} (q ${Math.min(v.index + 1, v.total)}) · ${opp}: ${v.opponentCorrect}/${v.total}`) + done;
    case 'trivia': return head + (v.question ? `<div class="stage-big small">${esc(v.question.q)}</div>` : '') + sub(`${you}: ${v.correct} right, ${v.index}/${v.total} answered · ${opp}: ${v.opponentAnswered}/${v.total} answered`) + done;
    case 'memorymatch': return head + sub(v.yourTurn ? 'Your turn — flip two cards' : "Bot's turn") + sub(`pairs: ${you} ${v.score.tester} · ${opp} ${v.score.sparring}`) + done;
    case 'highestcard': return head + big(v.card ? `${v.card}${v.opponentCard ? ` vs ${v.opponentCard}` : ''}` : '🂠') + sub(v.redraws ? `${v.redraws} tie redraw(s) at the deal` : 'One card each, highest wins') + done;
    case 'typingrace': return head + `<div class="stage-big small">${esc(v.sentence)}</div>` + sub(`${you}: ${v.attempts} attempt(s)${v.lastErrors != null ? `, last had ${v.lastErrors} error(s)` : ''} · ${opp}: ${v.opponentAttempts} attempt(s)`) + done;
    case 'emojimemory': return head + (v.show ? `<div class="emoji-seq">${v.show.join(' ')}</div>` : '') + sub(`round ${v.round} · ${you} best ${v.best}${v.out ? ' (out)' : ''} · ${opp} best ${v.opponentBest}${v.opponentOut ? ' (out)' : ''}`) + done;
    default: return head + sub(JSON.stringify(v));
  }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function externalCard({ h, list }) {
  const ext = list.filter(e => !e.hosted);
  return h('div', { class: 'panel' }, h('h3', {}, 'External entries on the active list'), h('p', { class: 'muted' }, `Run at the table or on Discord: both phones see the rules card and a ${B.challenge.externalCapSeconds}s timer, the TV shows the Off-Screen card, and the two phones report who won (the GM decides when they disagree; time out and both take ${B.challenge.timeoutDamage}).`),
    h('table', { class: 'lab' }, h('thead', {}, h('tr', {}, h('th', {}, 'Entry'), h('th', {}, 'Rules'), h('th', {}, 'Players'), h('th', {}, 'Weight'))), h('tbody', {}, ext.map(e => h('tr', {}, h('td', {}, h('b', {}, e.name), e.link ? h('div', {}, h('a', { href: e.link, target: '_blank' }, e.link)) : null), h('td', { class: 'muted' }, e.rules), h('td', {}, e.players || '1v1'), h('td', {}, e.weight))))),
    h('div', { class: 'gwf-stage', style: { minHeight: '120px', marginTop: '10px' } }, h('div', { class: 'stage-head' }, '🎡 Challenge Wheel · Off-Screen'), h('div', { class: 'stage-sub' }, 'Tester 🂡 vs Sparring Partner 🂱 · Rock-paper-scissors best of 5 · 4:59')));
}
