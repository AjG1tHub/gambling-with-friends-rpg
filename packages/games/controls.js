// Controls-as-data for the 12 classic games, mirroring what gm-games.js offered the GM, so the phone can render
// them without DOM code. The 24 plug-ins already ship `controls(g, x)`; the adapter merges both through
// `controlsFor`. Shape: { info, buttons: [{ label, a, p, primary?, danger?, disabled?, hidden? }], grid?, inputs? }
//   grid = { cols, cells: [{ label, a, p, state, disabled?, hidden? }] }  — a tappable grid (mines, keno, roulette numbers)
//   hidden: true marks a HIDDEN PICK (mines squares, scratch panels, the shell, bus calls): the TV never renders it.
import { effectiveOdds, bjActiveHand, bjCanDouble, bjCanSplit, bjTotal, cardText, hiloStepMult, kenoRules, diceChance, diceMult, diceBetError, crashMult, plinkoMults, rouletteColor } from './legacy/games.js';
import { EXTRA } from './legacy/games-extra.js';

export const b = (label, a, p = {}, o = {}) => ({ label, a, p, ...o });
// Actions whose payload is a hidden pick, per game (the TV must not show these buttons or their payloads).
export const HIDDEN_PICKS = { mines: ['reveal'], scratch: ['scratch', 'all'], thimbles: ['pick'], bus: ['call'] };
export const isHiddenPick = (gameId, action) => !!HIDDEN_PICKS[gameId]?.includes(action);
export const ROULETTE_TYPES = ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'];
const x2 = (m) => `${Number(Number(m).toFixed(2))}×`;
const done = (g) => ({ info: g.result ? g.result.label : g.pending ? g.pending.label : 'Round over', buttons: [] });
const pendingBox = (g) => ({ info: `Result: ${g.pending.label} → ${g.pending.mult}× stake`, buttons: [b('✅ Accept', 'accept', {}, { primary: true })] });

export const CLASSIC_CONTROLS = {
  // Red Dog (Hound Snap): the plug-in's two primary buttons read as the same thing. Spell out the choice.
  reddog(g) {
    if (g.phase !== 'decide') return null;
    const RANK = { A: 14, K: 13, Q: 12, J: 11 }; const rv = (c) => RANK[c.r] || Number(c.r);
    const v = g.view, [a, c2] = [...v.cards].sort((x, y) => rv(x) - rv(y)), lo = cardText(a), hi = cardText(c2);
    return { info: `<b>${lo}</b> and <b>${hi}</b> — will the next card fall <b>between</b> them? Gap of ${v.spread} → pays <b>${v.pay}:1</b>.`,
      buttons: [b('🐕 DEAL THE CARD (stake as it is)', 'call', {}, { primary: true }), b('✖2 DOUBLE THE STAKE, then deal', 'raise', {}, { danger: true })] };
  },
  fifty: (g) => g.pending ? pendingBox(g) : { info: 'Call it.', buttons: [b('🎡 SPIN', 'spin', {}, { primary: true })] },
  bigwheel: (g, x) => g.pending ? pendingBox(g) : { info: `Segments: ${(x.odds.segments || []).map(s => s.label).join(' · ')}`, buttons: [b('🎡 SPIN THE WHEEL', 'spin', {}, { primary: true })] },
  roulette(g, x) {
    if (g.pending) return pendingBox(g);
    const bet = g.view.bet, n = Number(x.odds.pockets || 37);
    if (!bet) return { info: `Pick a bet. Even money ${x.odds.even}:1 · dozens and columns ${x.odds.dozen}:1 · a number ${x.odds.straight}:1`,
      buttons: ROULETTE_TYPES.map(t => b(t.toUpperCase(), 'bet', { type: t }, { primary: t === 'red' || t === 'black' })),
      grid: { cols: 6, cells: Array.from({ length: n }, (_, k) => ({ label: String(k), a: 'bet', p: { type: 'straight', number: k }, state: rouletteColor(k) })) } };
    return { info: `Bet: ${bet.type}${bet.type === 'straight' ? ' ' + bet.number : ''}`, buttons: [b('🎡 SPIN', 'spin', {}, { primary: true }), b('↩ Change bet', 'unbet')] };
  },
  crash(g, x) {
    if (g.phase === 'done') return done(g);
    if (!g.startedTs) return { info: 'Light the fuse, cash out before it blows.', buttons: [b('🚀 LAUNCH', 'launch', {}, { primary: true }), ...[1.5, 2, 3, 5].map(t => b(`Auto ${t}×`, 'launch', { target: t }))] };
    return { info: `${crashMult(g, x.now).toFixed(2)}×`, buttons: [b('💰 CASH OUT', 'cashout', {}, { danger: true, primary: true })] };
  },
  mines(g) {
    const v = g.view, n = v.grid || 25, cols = Math.round(Math.sqrt(n));
    const cells = Array.from({ length: n }, (_, i) => ({ label: v.hit === i ? '💥' : v.revealed.includes(i) ? '💎' : String(i + 1), a: 'reveal', p: { idx: i }, hidden: true, disabled: g.phase === 'done' || v.revealed.includes(i), state: v.hit === i ? 'hit' : v.revealed.includes(i) ? 'safe' : 'hidden' }));
    if (g.phase === 'done') return { ...done(g), grid: { cols, cells } };
    return { info: `${x2(v.mult)} · ${v.revealed.length} safe found · ${v.minesCount} mines`, grid: { cols, cells }, buttons: [b(v.revealed.length ? `🛑 STOP at ${x2(v.mult)}` : '🛑 Walk away', 'stop', {}, { danger: true, disabled: false })] };
  },
  blackjack(g, x) {
    const v = g.view, odds = x.odds;
    const hands = v.hands.map((h, i) => `${v.hands.length > 1 ? `Hand ${i + 1}: ` : ''}${h.cards.map(cardText).join(' ')} (${bjTotal(h.cards).total})`).join(' · ');
    const info = `Dealer ${cardText(v.dealer[0])} 🂠 · ${hands}`;
    if (g.phase === 'done') return done(g);
    if (g.phase === 'insurance') return { info: `${info} — dealer shows an Ace`, buttons: [b('🛡 INSURE (½ stake)', 'insure'), b('No thanks', 'decline', {}, { primary: true })] };
    const buttons = [b('➕ HIT', 'hit', {}, { primary: true }), b('✋ STAND', 'stand', {}, { danger: true })];
    if (bjCanDouble(v)) buttons.push(b('✖2 DOUBLE', 'double'));
    if (bjCanSplit(odds, v)) buttons.push(b('✂ SPLIT', 'split'));
    return { info, buttons };
  },
  baccarat(g, x) {
    if (g.phase === 'done') return done(g);
    const v = g.view, o = x.odds;
    if (!v.bet) return { info: 'Player, Banker or Tie?', buttons: [b(`PLAYER ${o.player}:1`, 'bet', { side: 'player' }, { primary: true }), b(`BANKER ${o.banker}:1`, 'bet', { side: 'banker' }, { primary: true }), b(`TIE ${o.tie}:1`, 'bet', { side: 'tie' })] };
    return { info: `Bet on ${String(v.bet).toUpperCase()}`, buttons: [b('🎴 DEAL', 'deal', {}, { primary: true }), ...['player', 'banker', 'tie'].filter(s => s !== v.bet).map(s => b(s.toUpperCase(), 'bet', { side: s }))] };
  },
  plinko: (g, x) => g.pending ? pendingBox(g) : { info: `Slots: ${plinkoMults(x.odds).join(' · ')}`, buttons: [b('🔻 DROP', 'spin', {}, { primary: true })] },
  hilo(g, x) {
    if (g.phase !== 'running') return done(g);
    const v = g.view, top = v.cards.at(-1), hi = hiloStepMult(x.odds, top.r, 'higher'), lo = hiloStepMult(x.odds, top.r, 'lower');
    return { info: `${v.cards.map(cardText).join(' → ')} · ${x2(v.mult)}`, buttons: [
      b(`⬆ HIGHER${hi ? ` ×${hi.toFixed(2)}` : ''}`, 'higher', {}, { primary: true, disabled: !hi }), b(`⬇ LOWER${lo ? ` ×${lo.toFixed(2)}` : ''}`, 'lower', {}, { primary: true, disabled: !lo }), b('💰 CASH OUT', 'cashout', {}, { danger: true })] };
  },
  dice(g, x) {
    if (g.pending) return pendingBox(g);
    const v = g.view, o = x.odds;
    if (!v.bet) {
      const presets = [['under', 25], ['under', 50], ['under', 75], ['under', 95], ['over', 5], ['over', 25], ['over', 50], ['over', 75]].filter(([d, t]) => !diceBetError(o, d, t));
      return { info: 'Roll 1–100. Under or over a target?', inputs: [{ id: 'diceTarget', type: 'number', value: 50, min: 1, max: 100, step: 1 }],
        buttons: [b('⬇ UNDER', 'bet', { dir: 'under' }, { primary: true, from: { target: 'diceTarget' } }), b('⬆ OVER', 'bet', { dir: 'over' }, { primary: true, from: { target: 'diceTarget' } }),
          ...presets.map(([d, t]) => b(`${d} ${t} · ${diceChance(d, t)}% · ${diceMult(o, d, t)}×`, 'bet', { dir: d, target: t }))] };
    }
    return { info: `${v.bet.dir.toUpperCase()} ${v.bet.target} — ${v.bet.chance}% to win, pays ${v.bet.mult}×`, buttons: [b('🎲 ROLL', 'spin', {}, { primary: true }), b('↩ Change bet', 'unbet')] };
  },
  slots: (g) => g.pending ? pendingBox(g) : { info: 'Three reels.', buttons: [b('🎰 PULL', 'spin', {}, { primary: true })] },
  keno(g, x) {
    if (g.pending) return pendingBox(g);
    const v = g.view, R = kenoRules(x.odds), k = v.picks.length;
    const table = k ? Object.entries(R.pays[k] || {}).map(([h, m]) => `${h}→${m}×`).join(' ') : `pick up to ${v.maxPicks}`;
    return { info: `${k}/${v.maxPicks} picked · ${table}`,
      grid: { cols: v.numbers > 40 ? 10 : 8, cells: Array.from({ length: v.numbers }, (_, i) => ({ label: String(i + 1), a: 'pick', p: { n: i + 1 }, state: v.picks.includes(i + 1) ? 'picked' : '' })) },
      buttons: [b('🎲 Quick 5', 'quick', { count: 5 }), b('Clear', 'clear', {}, { disabled: !k }), b(`🔢 DRAW ${v.drawn}`, 'spin', {}, { primary: true, disabled: !k })] };
  },
};

// Controls for any of the 36. `x` = { odds, now, state, player, rng } as the plug-ins expect.
export function controlsFor(g, x) {
  let c;
  if (g.phase === 'done' && g.result) c = done(g);
  else if (CLASSIC_CONTROLS[g.id] && (c = CLASSIC_CONTROLS[g.id](g, x))) { /* an override may return null to defer to the plug-in */ }
  else if (EXTRA[g.id]) c = EXTRA[g.id].controls(g, x) || { buttons: [] };
  else c = { info: `Unknown game ${g.id}`, buttons: [] };
  const out = { info: c.info || '', buttons: (c.buttons || []).map(bt => ({ ...bt, p: bt.p || {}, hidden: bt.hidden || isHiddenPick(g.id, bt.a) || undefined })) };
  if (c.inputs) out.inputs = c.inputs;
  if (c.grid) out.grid = { ...c.grid, cells: c.grid.cells.map(cell => ({ ...cell, hidden: cell.hidden || isHiddenPick(g.id, cell.a) || undefined })) };
  return out;
}
// The same controls with every hidden pick removed: what the TV and the other phones may render.
export function publicControls(controls) {
  const out = { ...controls, buttons: controls.buttons.filter(bt => !bt.hidden) };
  if (controls.grid) out.grid = { ...controls.grid, cells: controls.grid.cells.filter(c => !c.hidden) };
  return out;
}
export { effectiveOdds };
