// Lab screen: one item against the Training Dummy. The practice character's stat sliders (Luck / Nerve / Greed /
// Grit 1–10) feel the levers, the rarity picker shows the stakes, mode Health or chips; the controls come from
// round.controls() and the stage is the TV's renderer. Auto-settle, A (bot), S (settle), 1/2 quick stakes.
import { ITEMS, makeItem, CLASSES } from '../../../packages/games/items.js';
import { startRound } from '../../../packages/games/adapter.js';
import { newLabRound, settleLab, itemRows, statsLine } from '../../../packages/games/lab-core.js';
import { LEVERS } from '../../../packages/games/levers.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { B, RARITIES, stakeFor, bonusFor } from '../../../packages/shared/balance.js';
import { mountRound, returnsText, closedFormReturns, fmtPct } from '../../../packages/ui/labkit.js';
import { store } from '../../../packages/ui/dom.js';
import { roundView } from '../../../packages/ui/minigame.js';

const STATS = ['luck', 'nerve', 'greed', 'grit'];
const RIG_GAMES = ['fifty', 'roulette', 'underover7', 'dragontiger', 'hilo', 'war'];

export function screenItems(ctx) {
  const { lab, h, main, phone, id } = ctx;
  const def = ITEMS[id]; if (!def) { main.append(h('p', { class: 'log error' }, `Unknown item ${id}`)); return; }
  const T = lab.state.tester, D = lab.state.dummy;
  // ── opponent strip ──
  const bars = h('div', { class: 'panel opponent' });
  const drawBars = () => bars.replaceChildren(
    h('div', { class: 'who' }, h('b', {}, `${T.name} · ${CLASSES[lab.classId]?.name || lab.classId}`), h('div', { class: 'bar ok' }, h('i', { style: { width: `${Math.round(100 * T.health / T.maxHealth)}%` } })), h('div', { class: 'muted' }, lab.mode === 'chips' ? `${T.chips} chips` : `${T.health}/${T.maxHealth} Health${T.shield ? ` · shield ${T.shield}` : ''}`)),
    h('div', { class: 'vs' }, 'VS'),
    h('div', { class: 'who' }, h('b', {}, D.name), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(100 * D.health / D.maxHealth)}%` } })), h('div', { class: 'muted' }, `${D.health}/${D.maxHealth} Health`)));
  drawBars();
  // ── levers ──
  const stakeIn = h('input', { type: 'number', min: 1, step: 1, value: lab.stake ?? (lab.mode === 'chips' ? 1 : stakeFor(null, lab.rarity)) });
  const levers = h('div', { class: 'panel levers' },
    ...STATS.map(s => { const out = h('span', { class: 'mono' }, String(T.stats[s])); const r = h('input', { type: 'range', min: B.stats.min, max: B.stats.max, value: T.stats[s], onInput: (e) => { T.stats[s] = Number(e.target.value); out.textContent = e.target.value; } }); return h('label', {}, h('span', {}, `${s[0].toUpperCase()}${s.slice(1)} `, out, s === def.stat ? h('span', { class: 'faint' }, ' ← this item\'s stat') : null), r); }),
    h('label', {}, 'Rarity (stake)', h('select', { onChange: (e) => { lab.rarity = e.target.value; store.set('gwfrpg:lab:rarity', lab.rarity); lab.stake = null; stakeIn.value = lab.mode === 'chips' ? 1 : stakeFor(null, lab.rarity); } }, RARITIES.map(r => h('option', { value: r, selected: r === lab.rarity }, `${r} · ${stakeFor(null, r)}`)))),
    h('label', {}, 'Mode', h('select', { onChange: (e) => { lab.mode = e.target.value; store.set('gwfrpg:lab:mode', lab.mode); lab.stake = null; stakeIn.value = lab.mode === 'chips' ? 1 : stakeFor(null, lab.rarity); drawBars(); } }, h('option', { value: 'health', selected: lab.mode === 'health' }, 'Health'), h('option', { value: 'chips', selected: lab.mode === 'chips' }, 'Chips (creation)'))),
    h('label', {}, 'Stake', stakeIn),
    h('label', {}, 'Attacker', h('select', { onChange: (e) => { lab.attackerSide = e.target.value; start(); } }, h('option', { value: 'tester', selected: lab.attackerSide !== 'dummy' }, `${T.name} → ${D.name}`), h('option', { value: 'dummy', selected: lab.attackerSide === 'dummy' }, `${D.name} → ${T.name} (as a monster)`))),
    h('label', {}, 'Class', h('select', { onChange: (e) => { lab.classId = e.target.value; T.classId = lab.classId; store.set('gwfrpg:lab:class', lab.classId); drawBars(); } }, Object.values(CLASSES).map(c => h('option', { value: c.id, selected: c.id === lab.classId }, `${c.name} (${c.stat})`)))),
    lab.classId === 'croupier' ? h('label', {}, 'Rig the Deck', h('select', { onChange: (e) => { lab.rig = e.target.value; } }, ['none', 'win', 'lose'].map(v => h('option', { value: v, selected: lab.rig === v }, v)))) : null,
    lab.classId === 'whale' ? h('label', {}, 'Double Down', h('select', { onChange: (e) => { lab.doubleDown = e.target.value === 'on'; } }, ['off', 'on'].map(v => h('option', { value: v, selected: (lab.doubleDown ? 'on' : 'off') === v }, v)))) : null);
  stakeIn.addEventListener('change', () => { lab.stake = Number(stakeIn.value) || null; });
  // ── the round ──
  const stageEl = h('div', { class: 'gwf-stage' }), controlsEl = h('div', { class: 'gwf-controls' });
  const result = h('div', { class: 'lab-result' }, lab.lastResult || '');
  const log = h('div', { class: 'log log-box' });
  const msg = (t, cls = '') => { log.prepend(h('div', { class: cls }, t)); while (log.children.length > 8) log.lastChild.remove(); };
  let round = null;
  const start = () => {
    lab.mount?.stop?.();
    const stake = Number(stakeIn.value) || undefined;
    if (lab.mode === 'health' && T.health < (stake || 1)) { T.health = T.maxHealth; msg('Tester topped back up to full Health.'); }
    if (lab.mode === 'chips' && T.chips < (stake || 1)) { T.chips = 100; msg('Tester topped back up to 100 chips.'); }
    const rig = lab.classId === 'croupier' && lab.rig !== 'none' && RIG_GAMES.includes(def.gameId) ? { outcome: lab.rig, forId: T.id } : null;
    const asMonster = lab.attackerSide === 'dummy' && lab.mode === 'health';
    if (asMonster) {   // the dummy (a monster's stats) swings this item at the tester, staked like a monster would
      const item = makeItem(null, { baseId: id, rarity: lab.rarity, seed: hash32(`${lab.seed}:${id}:${lab.state.rounds}`) });
      const mStake = Math.max(1, Math.min(D.health, Math.round(item.stake * B.items.monsterStakeFraction)));
      lab.state.rounds += 1;
      round = startRound(null, { item, mode: 'health', stake: stake || mStake, attacker: D, target: T, rng: makeRng(hash32(`${lab.seed}:m:${lab.state.rounds}`)), now: Date.now(), holdPending: lab.powerUps });
    } else round = newLabRound(lab.state, id, lab.mode, { rarity: lab.rarity, stake, now: Date.now(), holdPending: lab.powerUps, rig });
    result.textContent = ''; result.className = 'lab-result';
    drawPlayer();
    const handle = mountRound({ round, stageEl, controlsEl, phone, powerUps: lab.powerUps, autoSettle: lab.autoSettle, onChange: () => { if (round.text) msg(round.text); drawPlayer(); }, onSettle: (o) => {
      let line;
      if (asMonster) {   // the monster's payoff: a win hurts the tester, a loss costs the monster its stake share
        line = { damage: 0, loss: 0, healed: 0, shielded: 0, chips: 0 };
        if (o.mult > 1) { line.damage = Math.round(round.stake * (o.mult - 1) * (1 + bonusFor(null, round.item.rarity))); T.health = Math.max(0, T.health - line.damage); if (T.health === 0) T.health = T.maxHealth; }
        else if (o.mult < 1) { line.loss = Math.round(round.stake * (1 - o.mult)); D.health = Math.max(0, D.health - line.loss); if (D.health === 0) D.health = D.maxHealth; }
      } else line = settleLab(lab.state, round);
      const dd = !asMonster && lab.classId === 'whale' && lab.doubleDown && lab.mode === 'health';
      if (dd && line) { if (line.damage) { D.health = Math.max(0, D.health - line.damage); line.damage *= 2; } if (line.loss) { T.health = Math.max(1, T.health - line.loss); line.loss *= 2; } }
      lab.record(id, round.stake, o.mult, o.crit);
      const net = lab.mode === 'chips' ? `${line.chips >= 0 ? '+' : ''}${line.chips} chips` : asMonster ? (line.damage ? `${D.name} hits the tester for ${line.damage}` : line.loss ? `${D.name} loses ${line.loss} Health` : 'push') : line.damage ? `${line.damage} damage to the dummy${dd ? ' (Double Down)' : ''}` : line.healed ? `heals ${line.healed}` : line.shielded ? `shield +${line.shielded}` : line.loss ? `loses ${line.loss} Health${dd ? ' (Double Down)' : ''}` : 'push';
      result.textContent = `${o.mult > 1 ? 'WIN' : o.mult < 1 ? 'LOSS' : 'PUSH'} — ${o.label} · ${o.mult}× · ${net}${o.crit ? ' · CRIT' : ''}`;
      result.className = `lab-result ${o.mult > 1 ? 'win' : o.mult < 1 ? 'lose' : ''}`;
      lab.lastResult = result.textContent; drawBars(); stats.textContent = statsLine(lab.marks, id); measured.textContent = measuredText();
      if (lab.autoSettle && lab.autoNext) setTimeout(() => ctx.open(ctx.lab.order[(ctx.lab.order.indexOf(id) + 1) % ctx.lab.order.length]), 600);
    } });
    handle.auto = () => { if (round.settled) return; round.play(makeRng(hash32(`${lab.seed}:bot:${lab.state.rounds}`)), true); handle.redraw(); handle.tick(); msg(`Bot played: ${round.text || '…'}`); };
    lab.mount = handle;
  };
  // ── Player view: the phone's own round renderer (packages/ui/minigame.js roundView, the one apps/phone uses in a
  // fight) in a phone-sized frame, acting on the same round, so the GM sees exactly what the player's screen shows.
  const playerBody = h('div', { class: 'player-view-body' });
  const playerPane = h('div', { class: 'panel player-view', style: { display: store.get('gwfrpg:lab:playerview', false) ? '' : 'none' } }, h('h3', {}, '📱 Player view'), h('p', { class: 'muted small' }, 'What the player sees on their phone for this round; taps here act on the same round.'), h('div', { class: 'phone-frame' }, playerBody));
  const drawPlayer = () => {
    if (playerPane.style.display === 'none' || !round) return;
    const el = roundView({ round, stage: true, onAct: (a, p) => { const r = round.act(a, p, Date.now()); if (r?.error) ctx.toast(r.text); lab.mount?.redraw?.(); lab.mount?.tick?.(); drawPlayer(); }, onFork: (i) => { round.pickFork(i); lab.mount?.redraw?.(); drawPlayer(); } });
    playerBody.replaceChildren(el);
  };
  const playerBtn = h('button', { class: 'ghost', title: 'Show the round as the player\'s phone renders it', onClick: () => { const on = playerPane.style.display === 'none'; playerPane.style.display = on ? '' : 'none'; store.set('gwfrpg:lab:playerview', on); playerBtn.textContent = on ? '📱 Hide player view' : '📱 Player view'; drawPlayer(); } }, store.get('gwfrpg:lab:playerview', false) ? '📱 Hide player view' : '📱 Player view');
  lab.quickStake = (n) => { if (lab.mode === 'chips') stakeIn.value = n === 1 ? 1 : B.creation.maxStake; else { lab.rarity = n === 1 ? 'common' : 'legendary'; stakeIn.value = stakeFor(null, lab.rarity); } lab.stake = Number(stakeIn.value); start(); };
  const again = h('button', { class: 'primary', title: 'New round', onClick: start }, '▶ Play again');
  const auto = h('button', { title: 'Auto-play with the bot (A)', onClick: () => lab.mount?.auto?.() }, '🤖 Auto-play');
  const settle = h('button', { title: 'Settle now (S)', onClick: () => { if (!lab.mount?.settle()) ctx.toast('Nothing to settle yet.'); } }, 'Settle');
  const cancel = h('button', { class: 'ghost', onClick: () => { lab.mount?.stop?.(); controlsEl.replaceChildren(); result.textContent = 'Round cancelled — nothing won or lost.'; result.className = 'lab-result'; } }, 'Cancel');
  // ── facts ──
  const rows = itemRows(id), lv = LEVERS[def.gameId];
  const cf = closedFormReturns(def.gameId);
  const measuredText = () => { const e = lab.marks[id]; return e?.plays ? `measured this session: ${fmtPct(e.returned / e.staked)} over ${e.plays} round${e.plays === 1 ? '' : 's'}` : 'measured this session: not played yet'; };
  const measured = h('div', { class: 'muted' }, measuredText());
  const stats = h('div', { class: 'muted' }, statsLine(lab.marks, id));
  const facts = h('div', { class: 'panel' }, h('h3', {}, 'Payout and facts'),
    def.howTo ? h('p', { class: 'howto' }, h('b', {}, (def.goal || '') + ' '), def.howTo) : null,
    h('p', {}, h('b', {}, 'Returns: '), returnsText(def.gameId), cf.length > 1 ? h('span', { class: 'muted' }, ` (${cf.map(r => `${r.label} ${fmtPct(r.rtp)}`).join(' · ')})`) : null), measured,
    h('div', { class: 'kv', style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: '.9rem' } }, rows.flatMap(r => [h('span', { class: 'muted' }, r.label), h('span', {}, r.value)])),
    lv ? h('p', { class: 'muted ital' }, `Lever: ${lv.text}`) : null, stats);
  const roundPanel = h('div', { class: 'panel col' }, stageEl, controlsEl, result, h('div', { class: 'row' }, again, auto, settle, cancel, phone ? null : playerBtn), log);
  main.append(bars, phone ? roundPanel : h('div', { class: 'round-row' }, roundPanel, playerPane), phone ? null : levers, facts, phone ? levers : null);
  start();
}
