// Six table games with real rules: video poker, three card poker, let it ride, casino hold'em, craps, pai gow.
// See xkit.js for the plug-in contract and poker.js for the hand rankings.
import { shuffle } from './rng.js';
import { rv, eval5, eval3, eval2, best5, freshDeck, describe } from './poker.js';
import { end, idle, big, draw, txt, x2, diceHtml, diceLanded, DICE_MS, b, revealed } from './xkit.js';

const flip = (cards, at) => cards.forEach((c, i) => { if (c.down) { delete c.down; c.flipAt = at + i * 150; } });

// ── Video Poker (Jacks or Better) ────────────────────────────────────────────────────────────────
export const VP_ROWS = [['royal', 'Royal flush'], ['sf', 'Straight flush'], ['quads', 'Four of a kind'], ['fh', 'Full house'], ['flush', 'Flush'], ['straight', 'Straight'], ['trips', 'Three of a kind'], ['twopair', 'Two pair'], ['jacks', 'Jacks or better']];
export function vpKey(cards) {
  const e = eval5(cards);
  if (e.royal) return 'royal';
  return ['', e.high >= 11 ? 'jacks' : '', 'twopair', 'trips', 'straight', 'flush', 'fh', 'quads', 'sf'][e.cat] || null;
}
// A simple, sensible hold strategy (not perfect play): returns the indexes to keep.
export function vpAdvice(cards) {
  const all = [0, 1, 2, 3, 4], e = eval5(cards), vals = cards.map(rv);
  if (e.cat >= 4) return all;                                                         // straight or better: keep everything
  const bySuit = {}; cards.forEach((c, i) => { (bySuit[c.s] = bySuit[c.s] || []).push(i); });
  const flush4 = Object.values(bySuit).find(ix => ix.length === 4);
  const royal4 = Object.values(bySuit).map(ix => ix.filter(i => vals[i] >= 10)).find(ix => ix.length === 4);
  if (royal4) return royal4;
  const groups = {}; vals.forEach((v, i) => { (groups[v] = groups[v] || []).push(i); });
  const sets = Object.values(groups).filter(ix => ix.length >= 2).sort((a, c) => c.length - a.length);
  if (e.cat === 3 || e.cat === 2) return sets.flat();                                  // trips or two pair
  if (e.cat === 1 && vals[sets[0][0]] >= 11) return sets[0];                           // high pair
  if (flush4) return flush4;
  if (e.cat === 1) return sets[0];                                                     // low pair
  for (const skip of all) {                                                            // four to an open-ended straight
    const keep = all.filter(i => i !== skip), v = keep.map(i => vals[i]).sort((a, c) => a - c);
    if (new Set(v).size === 4 && v[3] - v[0] === 3 && v[0] > 2 && v[3] < 14) return keep;
  }
  const high = all.filter(i => vals[i] >= 11); return high.length > 2 ? high.sort((a, c) => vals[a] - vals[c]).slice(0, 2) : high;
}
const videopoker = {
  id: 'videopoker', name: 'Video Poker', icon: '🎮', odds: { royal: 250, sf: 50, quads: 25, fh: 9, flush: 6, straight: 4, trips: 3, twopair: 2, jacks: 1 },
  how: (o) => `Five cards are dealt. Say which to hold, then the rest are swapped once. You need a pair of jacks or better to get your bet back. Total returned: ${VP_ROWS.map(([k, n]) => `${n} ${x2(o[k])}`).join(', ')}.`,
  start(g, x) { g.secret.deck = freshDeck(shuffle, x.rng, 1); Object.assign(g.view, { cards: [0, 1, 2, 3, 4].map(i => draw(g, x.now + 250 + i * 180)), held: [false, false, false, false, false], drawn: false, revealAt: null }); g.phase = 'hold'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'hold') return idle(a);
    if (a === 'hold' && Number.isInteger(p.i) && p.i >= 0 && p.i < 5) { v.held[p.i] = !v.held[p.i]; return { text: `${v.held[p.i] ? 'Holding' : 'Releasing'} ${v.cards[p.i].r}${v.cards[p.i].s}.` }; }
    if (a === 'auto') { const keep = vpAdvice(v.cards); v.held = v.held.map((_, i) => keep.includes(i)); return { text: `Suggested hold: ${keep.length ? keep.map(i => v.cards[i].r + v.cards[i].s).join(' ') : 'nothing'}.` }; }
    if (a !== 'draw') return idle(a);
    let n = 0; v.cards = v.cards.map((c, i) => (v.held[i] ? c : draw(g, x.now + 250 + n++ * 180))); v.drawn = true;
    const key = vpKey(v.cards), e = eval5(v.cards); v.win = key;
    return end(g, key ? Number(x.odds[key]) : 0, key ? `${VP_ROWS.find(r => r[0] === key)[1]} — ${x2(x.odds[key])}` : e.cat === 1 ? `${describe(e)} — not enough` : `${describe(e)} — nothing`, x.now + 250 + n * 180 + 400);
  },
  controls: (g) => ({ info: 'Tap a card to hold it:', buttons: [...g.view.cards.map((c, i) => b(`${g.view.held[i] ? '🔒 ' : ''}${c.r}${c.s}`, 'hold', { i }, { primary: g.view.held[i] })), b('🤖 Suggest', 'auto', {}, { br: true }), b('🔁 DRAW', 'draw', {}, { primary: true })] }),
  stage(g, now, x) {
    const v = g.view, done = revealed(g, now);
    const holds = `<div class="xholds">${v.held.map(h => `<span class="${h ? 'on' : ''}">${h ? 'HELD' : ''}</span>`).join('')}</div>`;
    const table = `<div class="xpay">${VP_ROWS.map(([k, n]) => `<span class="${done && v.win === k ? 'on' : ''}">${n} <b>${x2(x.odds[k])}</b></span>`).join('')}</div>`;
    return `${x.cardsHtml(v.cards, now)}${v.drawn ? '' : holds}${table}${done ? big(g, now, x.esc) : v.drawn ? '' : '<div class="stage-sub">Say which cards to <b>HOLD</b>, then <b>DRAW</b></div>'}`;
  },
  bot(g, pick, smart) { const v = g.view;
    if (smart) { const keep = vpAdvice(v.cards), want = v.held.map((_, i) => keep.includes(i)), i = want.findIndex((w, k) => w !== v.held[k]); return i >= 0 ? ['hold', { i }] : ['draw']; }
    return pick.chance(0.35) ? ['hold', { i: pick.int(0, 4) }] : pick.chance(0.3) ? ['auto'] : ['draw']; },
};

// ── Three Card Poker ─────────────────────────────────────────────────────────────────────────────
const threecard = {
  id: 'threecard', name: 'Three Card Poker', icon: '3️⃣', odds: { bonusStraight: 1, bonusTrips: 4, bonusSF: 5 },
  how: (o) => `You and the dealer get three cards. Look at yours, then Fold (lose the bet) or Play (put up the same again). The dealer needs queen-high or better to qualify: if not, you win even money on the bet and the Play stake comes back. If the dealer qualifies, the better hand wins even money on both. In this game a straight beats a flush. A straight (${o.bonusStraight}:1), three of a kind (${o.bonusTrips}:1) or straight flush (${o.bonusSF}:1) pays a bonus even if you lose.`,
  start(g, x) { g.secret.deck = freshDeck(shuffle, x.rng, 1); const t = x.now;
    Object.assign(g.view, { player: [0, 1, 2].map(i => draw(g, t + 250 + i * 300)), dealer: [0, 1, 2].map(i => draw(g, t + 400 + i * 300, { down: true })), revealAt: null }); g.view.hand = describe(eval3(g.view.player)); g.phase = 'decide'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'decide') return idle(a);
    if (a === 'fold') { flip(v.dealer, x.now + 200); return end(g, 0, 'Folded', x.now + 900); }
    if (a !== 'play') return idle(a);
    flip(v.dealer, x.now + 300);
    const P = eval3(v.player), D = eval3(v.dealer), bonus = Number(P.cat === 5 ? x.odds.bonusSF : P.cat === 4 ? x.odds.bonusTrips : P.cat === 3 ? x.odds.bonusStraight : 0);
    const qualifies = D.cat >= 1 || D.high >= 12; v.dealerHand = describe(D); v.qualifies = qualifies;
    let profit, label;
    if (!qualifies) { profit = 1; label = `Dealer's ${describe(D)} does not qualify — the bet wins`; }
    else if (P.score > D.score) { profit = 2; label = `${describe(P)} beats ${describe(D)}`; }
    else if (P.score === D.score) { profit = 0; label = 'Tie — push'; }
    else { profit = -2; label = `${describe(D)} beats ${describe(P)}`; }
    if (bonus) label += ` (+${bonus}:1 bonus)`;
    return end(g, 1 + profit + bonus, label, x.now + 1300);
  },
  controls: (g) => ({ info: `Player: <b>${txt(g.view.player)}</b> <span class="subtle">${g.view.hand}</span>`, buttons: [b('▶ PLAY (bet again)', 'play', {}, { primary: true }), b('🏳 FOLD', 'fold', {}, { danger: true })] }),
  stage(g, now, x) {
    const v = g.view;
    return `<div class="card-table"><div class="hand"><div class="hand-label">Dealer ${revealed(g, now) && v.dealerHand ? `<b>${x.esc(v.dealerHand)}</b>` : ''}</div>${x.cardsHtml(v.dealer, now)}</div><div class="hand"><div class="hand-label">You <b>${x.esc(v.hand)}</b></div>${x.cardsHtml(v.player, now)}</div></div>
      ${g.phase === 'decide' ? '<div class="stage-sub"><b>PLAY</b> (bet the same again) or <b>FOLD</b>? Dealer needs queen-high to qualify.</div>' : big(g, now, x.esc)}`;
  },
  bot(g, pick, smart) { if (!smart) return [pick.chance(0.75) ? 'play' : 'fold'];
    const P = eval3(g.view.player), k = P.kickers; return [P.cat >= 1 || k[0] > 12 || (k[0] === 12 && (k[1] > 6 || (k[1] === 6 && k[2] >= 4))) ? 'play' : 'fold']; },           // the standard "Q-6-4 or better" rule
};

// ── Let It Ride ──────────────────────────────────────────────────────────────────────────────────
export const LIR_ROWS = [['royal', 'Royal flush'], ['sf', 'Straight flush'], ['quads', 'Four of a kind'], ['fh', 'Full house'], ['flush', 'Flush'], ['straight', 'Straight'], ['trips', 'Three of a kind'], ['twopair', 'Two pair'], ['tens', 'Pair of tens or better']];
export function lirKey(cards) { const e = eval5(cards); if (e.royal) return 'royal'; return ['', e.high >= 10 ? 'tens' : '', 'twopair', 'trips', 'straight', 'flush', 'fh', 'quads', 'sf'][e.cat] || null; }
const letitride = {
  id: 'letitride', name: 'Let It Ride', icon: '🎢', odds: { royal: 1000, sf: 200, quads: 50, fh: 11, flush: 8, straight: 5, trips: 3, twopair: 2, tens: 1 },
  how: (o) => `You start with THREE bets of your stake on the table. You see three cards; two more are face down. Before each of those is turned you may pull one bet back or let it ride. A pair of tens or better pays every bet still riding: ${LIR_ROWS.map(([k, n]) => `${n} ${o[k]}:1`).join(', ')}. Anything less loses the bets that are riding.`,
  start(g, x) { g.secret.deck = freshDeck(shuffle, x.rng, 1); const t = x.now;
    Object.assign(g.view, { player: [0, 1, 2].map(i => draw(g, t + 250 + i * 250)), board: [0, 1].map(i => draw(g, t + 1000 + i * 250, { down: true })), bets: 3, step: 0, revealAt: null }); g.phase = 'decide'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'decide' || (a !== 'pull' && a !== 'ride')) return idle(a);
    if (a === 'pull') v.bets -= 1;
    const c = v.board[v.step]; delete c.down; c.flipAt = x.now + 250; v.step += 1;
    if (v.step < 2) return { text: `${a === 'pull' ? 'Pulled one bet back' : 'Let it ride'} — ${v.bets} riding.` };
    const key = lirKey([...v.player, ...v.board]), e = eval5([...v.player, ...v.board]), pay = key ? Number(x.odds[key]) : 0; v.win = key;
    return end(g, 1 + (key ? v.bets * pay : -v.bets), key ? `${LIR_ROWS.find(r => r[0] === key)[1]} — ${pay}:1 on ${v.bets} bet${v.bets === 1 ? '' : 's'}` : `${describe(e)} — ${v.bets} bet${v.bets === 1 ? '' : 's'} lost`, x.now + 900);
  },
  controls: (g) => ({ info: `<b>${txt(g.view.player)}</b> ${g.view.step ? '+ ' + txt(g.view.board.slice(0, g.view.step)) : ''} — <b>${g.view.bets}</b> bets riding <span class="subtle">(each = the stake)</span>`, buttons: [b('🎢 LET IT RIDE', 'ride', {}, { primary: true }), b('↩ Pull one bet back', 'pull')] }),
  stage(g, now, x) {
    const v = g.view, chips = [0, 1, 2].map(i => `<span class="xpill ${i < v.bets ? 'ok' : 'gone'}">BET</span>`).join('');
    return `<div class="card-table"><div class="hand"><div class="hand-label">Community</div>${x.cardsHtml(v.board, now)}</div><div class="hand"><div class="hand-label">Your cards</div>${x.cardsHtml(v.player, now)}</div></div><div class="xtrail">${chips}</div>
      ${g.phase === 'decide' ? '<div class="stage-sub"><b>LET IT RIDE</b> or <b>PULL</b> one bet back? You need a pair of tens or better.</div>' : big(g, now, x.esc)}`;
  },
  bot(g, pick, smart) { if (!smart) return [pick.chance(0.5) ? 'ride' : 'pull'];
    const v = g.view, cards = [...v.player, ...v.board.slice(0, v.step)], vals = cards.map(rv), pairHigh = vals.some((a, i) => a >= 10 && vals.indexOf(a) !== i), trips = vals.some(a => vals.filter(c => c === a).length >= 3);
    const flushDraw = cards.every(c => c.s === cards[0].s) && (v.step === 1 || vals.filter(a => a >= 10).length >= 2);
    return [pairHigh || trips || flushDraw ? 'ride' : 'pull']; },
};

// ── Casino Hold'em ───────────────────────────────────────────────────────────────────────────────
const holdem = {
  id: 'holdem', name: "Casino Hold'em", icon: '♠️', odds: { royal: 100, sf: 20, quads: 10, fh: 3, flush: 2, other: 1 },
  how: (o) => `Texas Hold'em against the dealer. You get two cards and see the three-card flop, then Fold (lose the bet) or Call (put up twice the bet). Two more cards come and the best five-card hand wins. The dealer needs a pair of fours or better to qualify. If you win, your bet pays by hand — royal flush ${o.royal}:1, straight flush ${o.sf}:1, four of a kind ${o.quads}:1, full house ${o.fh}:1, flush ${o.flush}:1, anything else ${o.other}:1 — and the Call pays even money when the dealer qualifies.`,
  start(g, x) { g.secret.deck = freshDeck(shuffle, x.rng, 1); const t = x.now;
    Object.assign(g.view, { player: [0, 1].map(i => draw(g, t + 250 + i * 250)), dealer: [0, 1].map(i => draw(g, t + 400 + i * 250, { down: true })), board: [0, 1, 2].map(i => draw(g, t + 1000 + i * 220)), revealAt: null });
    g.view.hand = describe(best5([...g.view.player, ...g.view.board])); g.phase = 'decide'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'decide') return idle(a);
    if (a === 'fold') { flip(v.dealer, x.now + 200); return end(g, 0, 'Folded', x.now + 800); }
    if (a !== 'call') return idle(a);
    v.board.push(draw(g, x.now + 300), draw(g, x.now + 650)); flip(v.dealer, x.now + 1100);
    const P = best5([...v.player, ...v.board]), D = best5([...v.dealer, ...v.board]); v.hand = describe(P); v.dealerHand = describe(D);
    const qualifies = D.cat > 1 || (D.cat === 1 && D.high >= 4), antePay = Number(P.royal ? x.odds.royal : P.cat === 8 ? x.odds.sf : P.cat === 7 ? x.odds.quads : P.cat === 6 ? x.odds.fh : P.cat === 5 ? x.odds.flush : x.odds.other);
    let profit, label;
    if (!qualifies) { profit = antePay; label = `Dealer's ${describe(D)} does not qualify — the bet pays ${antePay}:1`; }
    else if (P.score > D.score) { profit = antePay + 2; label = `${describe(P)} beats ${describe(D)}`; }
    else if (P.score === D.score) { profit = 0; label = `Both have ${describe(P)} — push`; }
    else { profit = -3; label = `${describe(D)} beats ${describe(P)}`; }
    return end(g, 1 + profit, label, x.now + 2000);
  },
  controls: (g) => ({ info: `Hole <b>${txt(g.view.player)}</b> · flop <b>${txt(g.view.board)}</b> <span class="subtle">${g.view.hand}</span>`, buttons: [b('▶ CALL (2× the bet)', 'call', {}, { primary: true }), b('🏳 FOLD', 'fold', {}, { danger: true })] }),
  stage(g, now, x) {
    const v = g.view, done = revealed(g, now);
    return `<div class="card-table"><div class="hand"><div class="hand-label">Dealer ${done && v.dealerHand ? `<b>${x.esc(v.dealerHand)}</b>` : ''}</div>${x.cardsHtml(v.dealer, now)}</div><div class="hand"><div class="hand-label">Board</div>${x.cardsHtml(v.board, now)}</div><div class="hand"><div class="hand-label">You ${g.phase === 'decide' || done ? `<b>${x.esc(v.hand)}</b>` : ''}</div>${x.cardsHtml(v.player, now)}</div></div>
      ${g.phase === 'decide' ? '<div class="stage-sub"><b>CALL</b> (twice the bet) or <b>FOLD</b>?</div>' : big(g, now, x.esc)}`;
  },
  bot(g, pick, smart) { if (!smart) return [pick.chance(0.8) ? 'call' : 'fold'];
    const v = g.view, P = best5([...v.player, ...v.board]), hole = v.player.map(rv), boardHigh = Math.max(...v.board.map(rv));
    const four = (cs) => { const s = {}; cs.forEach(c => { s[c.s] = (s[c.s] || 0) + 1; }); return Math.max(...Object.values(s)) >= 4; };
    return [P.cat >= 1 || Math.max(...hole) >= 12 || four([...v.player, ...v.board]) || Math.min(...hole) > boardHigh - 6 ? 'call' : 'fold']; },
};

// ── Craps (pass line + odds) ─────────────────────────────────────────────────────────────────────
const TRUE_ODDS = { 4: 2, 5: 1.5, 6: 1.2, 8: 1.2, 9: 1.5, 10: 2 };
const craps = {
  id: 'craps', name: 'Craps', icon: '🤞', odds: { maxOdds: 2 },
  how: (o) => `The pass line. First roll: 7 or 11 wins even money, 2, 3 or 12 loses. Any other number becomes the point — keep rolling until the point comes up again (win) or a 7 does (lose). Once there is a point you can back it with up to ${o.maxOdds}× your bet at true odds, with no house edge: 4 or 10 pays 2:1, 5 or 9 pays 3:2, 6 or 8 pays 6:5.`,
  returns: () => [{ label: 'Craps (pass line)', rtp: 1 - 0.01414 }],
  start(g) { Object.assign(g.view, { point: null, odds: 0, dice: null, rollAt: null, rolls: [], revealAt: null }); g.phase = 'comeout'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'comeout' && g.phase !== 'point') return idle(a);
    if (a === 'odds' && g.phase === 'point') { const n = Math.round(Number(p.n)); if (!(n >= 0 && n <= Number(x.odds.maxOdds))) return idle(a); v.odds = n; return { text: n ? `Odds: ${n}× the bet behind the ${v.point}.` : 'Odds taken down.' }; }
    if (a !== 'roll') return idle(a);
    const d = [x.rng.int(1, 6), x.rng.int(1, 6)], t = d[0] + d[1]; v.dice = d; v.rollAt = x.now; v.rolls.push(t); if (v.rolls.length > 14) v.rolls.shift();
    const at = x.now + DICE_MS + 200;
    if (g.phase === 'comeout') {
      if (t === 7 || t === 11) return end(g, 2, `${t} — natural, pass line wins`, at);
      if (t === 2 || t === 3 || t === 12) return end(g, 0, `${t} — craps`, at);
      v.point = t; g.phase = 'point'; return { text: `The point is ${t}.` };
    }
    if (t === v.point) return end(g, 2 + v.odds * TRUE_ODDS[v.point], `${t} — made the point${v.odds ? ` (odds pay ${TRUE_ODDS[v.point]}:1 on ${v.odds}×)` : ''}`, at);
    if (t === 7) return end(g, v.odds ? -v.odds : 0, `Seven out${v.odds ? ` — bet and ${v.odds}× odds lost` : ''}`, at);
    return { text: `${t} — roll again.` };
  },
  controls(g, x) { const v = g.view;
    if (g.phase === 'comeout') return { info: 'Come-out roll', buttons: [b('🎲 ROLL', 'roll', {}, { primary: true })] };
    return { info: `Point is <b class="big-turn">${v.point}</b> <span class="subtle">odds ${v.odds}× (pays ${TRUE_ODDS[v.point]}:1)</span>`, buttons: [b('🎲 ROLL', 'roll', {}, { primary: true }), ...Array.from({ length: Number(x.odds.maxOdds) + 1 }, (_, n) => b(n ? `Odds ${n}×` : 'No odds', 'odds', { n }, { disabled: v.odds === n }))] }; },
  stage(g, now, x) {
    const v = g.view, landed = diceLanded(v.rollAt, now);
    const puck = v.point ? `<div class="xpuck on">POINT <b>${v.point}</b>${v.odds ? `<small>+${v.odds}× odds</small>` : ''}</div>` : '<div class="xpuck">COME-OUT</div>';
    return `${puck}${v.dice ? diceHtml(v.dice, v.rollAt, now) : '<div class="xdice"><span>🎲</span><span>🎲</span></div>'}${v.dice && landed ? `<div class="stage-sub">Rolled <b class="xnum">${v.dice[0] + v.dice[1]}</b></div>` : ''}
      <div class="xtrail">${v.rolls.slice(0, landed ? undefined : -1).map(t => `<span class="xpill">${t}</span>`).join('')}</div>
      ${revealed(g, now) ? big(g, now, x.esc) : g.phase === 'done' ? '' : `<div class="stage-sub">${v.point ? `Roll a <b>${v.point}</b> before a <b>7</b>` : '<b>7</b> or <b>11</b> wins · <b>2</b>, <b>3</b>, <b>12</b> loses'}</div>`}`;
  },
  bot(g, pick, smart, x) { const v = g.view, max = Number(x.odds.maxOdds);
    if (g.phase === 'point' && !v.botSet) { v.botSet = true; const n = smart ? max : pick.int(0, max); if (n !== v.odds) return ['odds', { n }]; }
    return ['roll']; },
};

// ── Pai Gow Poker (no joker) ─────────────────────────────────────────────────────────────────────
const sLow = (cards) => { const e = eval2(cards), a = Math.max(rv(cards[0]), rv(cards[1])), c = Math.min(rv(cards[0]), rv(cards[1]));
  return e.cat === 1 ? 0.8 + 0.2 * (a - 2) / 12 : 0.75 * (Math.max(0, a - 3) / 11) ** 2 + 0.05 * (c - 2) / 12; };
const sHigh = (e) => [0.02 + 0.1 * Math.max(0, e.high - 7) / 7, 0.15 + 0.45 * (e.high - 2) / 12, 0.62 + 0.2 * (e.high - 3) / 11, 0.84 + 0.05 * (e.high - 2) / 12, 0.9, 0.94, 0.97, 0.995, 0.999][e.cat];
// The five-card hand must outrank the two-card hand.
export function pgValid(high5, low2) {
  const H = eval5(high5), L = eval2(low2);
  if (L.cat === 1) return H.cat > 1 || (H.cat === 1 && H.high >= rv(low2[0]));
  if (H.cat >= 1) return true;
  const h = high5.map(rv).sort((a, c) => c - a), l = low2.map(rv).sort((a, c) => c - a);
  return h[0] > l[0] || (h[0] === l[0] && h[1] >= l[1]);
}
// How the house sets seven cards: try all 21 splits, keep the legal one with the best combined strength.
export function pgHouseWay(cards) {
  let best = null;
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 7; j++) {
    const low = [cards[i], cards[j]], high = cards.filter((_, k) => k !== i && k !== j);
    if (!pgValid(high, low)) continue;
    const s = sHigh(eval5(high)) + sLow(low);
    if (!best || s > best.s) best = { s, low: [i, j] };
  }
  return best.low;
}
const pgSplit = (cards, low) => ({ low: low.map(i => cards[i]), high: cards.filter((_, k) => !low.includes(k)) });
const paigow = {
  id: 'paigow', name: 'Pai Gow Poker', icon: '🀄', odds: { commission: 0.05 },
  how: (o) => `Seven cards each. Split yours into a five-card hand and a two-card hand (the five must be the stronger). The dealer does the same. Win both hands and you are paid even money less ${(o.commission * 100).toFixed(0)}% commission; win one and lose one and it is a push; lose both and the bet is gone. An exact tie on a hand goes to the dealer.`,
  start(g, x) { g.secret.deck = freshDeck(shuffle, x.rng, 1); const t = x.now;
    const player = Array.from({ length: 7 }, (_, i) => draw(g, t + 200 + i * 130)), dealer = Array.from({ length: 7 }, (_, i) => draw(g, t + 260 + i * 130, { down: true }));
    Object.assign(g.view, { player, dealer, low: pgHouseWay(player), revealAt: null }); g.phase = 'set'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'set') return idle(a);
    if (a === 'auto') { v.low = pgHouseWay(v.player); return { text: 'Set the house way.' }; }
    if (a === 'toggle' && Number.isInteger(p.i) && p.i >= 0 && p.i < 7) { v.low = v.low.includes(p.i) ? v.low.filter(k => k !== p.i) : [...v.low, p.i].slice(-2); return { text: `Two-card hand: ${v.low.map(i => v.player[i].r + v.player[i].s).join(' ') || '—'}` }; }
    if (a !== 'confirm') return idle(a);
    if (v.low.length !== 2) return { text: 'Pick exactly two cards for the small hand.', error: true };
    const P = pgSplit(v.player, v.low); if (!pgValid(P.high, P.low)) return { text: 'The five-card hand has to be the stronger one.', error: true };
    const D = pgSplit(v.dealer, pgHouseWay(v.dealer)); flip(v.dealer, x.now + 300); v.dealerLow = pgHouseWay(v.dealer);
    const hi = eval5(P.high).score > eval5(D.high).score, lo = eval2(P.low).score > eval2(D.low).score;
    v.wins = { high: hi, low: lo }; v.names = { ph: describe(eval5(P.high)), dh: describe(eval5(D.high)), pl: describe(eval2(P.low)), dl: describe(eval2(D.low)) };
    const mult = hi && lo ? 2 - Number(x.odds.commission) : hi || lo ? 1 : 0;
    return end(g, mult, hi && lo ? 'Won both hands' : hi || lo ? `Won the ${hi ? 'five' : 'two'}-card hand only — push` : 'Dealer takes both hands', x.now + 2000);
  },
  controls: (g) => ({ info: 'Pick the two cards for the small hand:', buttons: [...g.view.player.map((c, i) => b(`${g.view.low.includes(i) ? '⬇ ' : ''}${c.r}${c.s}`, 'toggle', { i }, { primary: g.view.low.includes(i) })), b('🤖 House way', 'auto', {}, { br: true }), b('✅ SET HANDS', 'confirm', {}, { primary: true, disabled: g.view.low.length !== 2 })] }),
  stage(g, now, x) {
    const v = g.view, done = revealed(g, now), P = pgSplit(v.player, v.low.length === 2 ? v.low : []), D = v.dealerLow ? pgSplit(v.dealer, v.dealerLow) : null;
    const mark = (k) => (done ? (v.wins[k] ? ' winner' : '') : '');
    const mine = v.low.length === 2 ? `<div class="hand${mark('high')}"><div class="hand-label">Your five ${done ? `<b>${x.esc(v.names.ph)}</b>` : ''}</div>${x.cardsHtml(P.high, now)}</div><div class="hand${mark('low')}"><div class="hand-label">Your two ${done ? `<b>${x.esc(v.names.pl)}</b>` : ''}</div>${x.cardsHtml(P.low, now)}</div>`
      : `<div class="hand"><div class="hand-label">Your cards</div>${x.cardsHtml(v.player, now)}</div>`;
    const theirs = D ? `<div class="hand"><div class="hand-label">Dealer five ${done ? `<b>${x.esc(v.names.dh)}</b>` : ''}</div>${x.cardsHtml(D.high, now)}</div><div class="hand"><div class="hand-label">Dealer two ${done ? `<b>${x.esc(v.names.dl)}</b>` : ''}</div>${x.cardsHtml(D.low, now)}</div>`
      : `<div class="hand"><div class="hand-label">Dealer</div>${x.cardsHtml(v.dealer, now)}</div>`;
    return `<div class="xpg"><div class="card-table side-by-side">${theirs}</div><div class="card-table side-by-side">${mine}</div></div>${g.phase === 'set' ? '<div class="stage-sub">Choose <b>two cards</b> for the small hand — the five-card hand must be stronger</div>' : big(g, now, x.esc)}`;
  },
  bot(g, pick, smart) { const v = g.view;
    if (!smart && pick.chance(0.4)) return ['toggle', { i: pick.int(0, 6) }];
    const P = v.low.length === 2 ? pgSplit(v.player, v.low) : null;
    return P && pgValid(P.high, P.low) ? ['confirm'] : ['auto']; },
};

export const TABLE = [videopoker, threecard, letitride, holdem, craps, paigow];
