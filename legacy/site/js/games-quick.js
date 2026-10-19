// Ten quick games — one decision, one result. See xkit.js for the plug-in contract.
import { shuffle, weightedIndex } from './rng.js';
import { rv, freshDeck } from './poker.js';
import { floor2, end, idle, big, draw, txt, x2, pct, diceHtml, diceLanded, DICE_MS, b, sum, cls, revealed } from './xkit.js';

const aceLow = (c) => (rv(c) === 14 ? 1 : rv(c));
const d6 = (rng) => rng.int(1, 6);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Coin Streak ──────────────────────────────────────────────────────────────────────────────────
const coinstreak = {
  id: 'coinstreak', name: 'Coin Streak', icon: '🪙', odds: { houseEdge: 0.03, maxMult: 500 },
  how: (o) => `Call heads or tails. Every correct call multiplies your winnings by ${x2(2 * (1 - o.houseEdge))}. Cash out whenever you like — one wrong call loses the bet. Capped at ${x2(o.maxMult)}.`,
  returns: (o) => [{ label: 'Coin Streak (per call)', rtp: 1 - o.houseEdge }],
  start(g) { Object.assign(g.view, { flips: [], mult: 1, prev: 1, steps: 0, flipAt: null, revealAt: null }); g.phase = 'running'; },
  act(g, a, p, x) {
    const v = g.view; if (g.phase !== 'running') return idle(a);
    if (a === 'cashout') return end(g, v.mult, v.steps ? `Cashed out at ${x2(v.mult)} after ${v.steps} flip${v.steps === 1 ? '' : 's'}` : 'Walked away (push)', x.now);
    if (a !== 'heads' && a !== 'tails') return idle(a);
    const side = x.rng.chance(0.5) ? 'heads' : 'tails';
    v.flips.push({ side, call: a }); if (v.flips.length > 12) v.flips.shift(); v.flipAt = x.now; v.prev = v.mult;
    if (side !== a) return end(g, 0, `${cap(side)} — you called ${a}`, x.now + 900);
    v.steps += 1; v.mult = Math.min(Number(x.odds.maxMult), floor2(v.mult * 2 * (1 - x.odds.houseEdge)));
    if (v.mult >= Number(x.odds.maxMult)) return end(g, v.mult, `Hit the ${x2(v.mult)} table limit`, x.now + 900);
    return { text: `${cap(side)} — correct. ${x2(v.mult)}` };
  },
  controls: (g) => ({ info: `<span class="big-turn">${x2(g.view.mult)}</span> <span class="subtle">${g.view.steps} in a row</span>`,
    buttons: [b('🙂 HEADS', 'heads', {}, { primary: true }), b('🦅 TAILS', 'tails', {}, { primary: true }), b('💰 CASH OUT', 'cashout', {}, { danger: true })] }),
  stage(g, now, x) {
    const v = g.view, flipping = v.flipAt != null && now < v.flipAt + 900, last = v.flips.at(-1);
    const coin = !last ? '🪙' : flipping ? '🪙' : last.side === 'heads' ? '🙂' : '🦅';
    const trail = v.flips.slice(0, flipping ? -1 : undefined).map(f => `<span class="xpill ${f.side === f.call ? 'ok' : 'no'}">${f.side === 'heads' ? 'H' : 'T'}</span>`).join('');
    return `<div class="xcoin ${flipping ? 'flipping' : ''}">${coin}</div><div class="xtrail">${trail}</div>
      ${revealed(g, now) ? big(g, now, x.esc) : `<div class="stage-big crash-live">${x2(flipping ? v.prev : v.mult)}</div><div class="stage-sub">Call <b>HEADS</b> or <b>TAILS</b> — each right call pays ×${(2 * (1 - x.odds.houseEdge)).toFixed(2)} — or <b>CASH OUT</b></div>`}`;
  },
  bot: (g, pick, smart) => (g.view.steps >= (smart ? 2 : pick.int(0, 4)) ? ['cashout'] : [pick.chance(0.5) ? 'heads' : 'tails']),
};

// ── War ──────────────────────────────────────────────────────────────────────────────────────────
const war = {
  id: 'war', name: 'War', icon: '⚔️', odds: { decks: 6 },
  how: () => 'One card each, high card wins even money (aces are high). On a tie you choose: surrender half your bet, or go to war — the bet doubles, three cards are burned, and one more card each decides it. Win the war and you are paid even money on the original bet; lose and both bets are gone.',
  start(g, x) {
    g.secret.deck = freshDeck(shuffle, x.rng, Number(x.odds.decks) || 6);
    const p = draw(g, x.now + 300), d = draw(g, x.now + 800);
    Object.assign(g.view, { player: [p], dealer: [d], war: false, revealAt: null });
    if (rv(p) > rv(d)) end(g, 2, `${p.r} beats ${d.r}`, x.now + 1200);
    else if (rv(p) < rv(d)) end(g, 0, `${d.r} beats ${p.r}`, x.now + 1200);
    else { g.phase = 'tie'; g.view.tieAt = x.now + 1200; }
  },
  act(g, a, p, x) {
    if (g.phase !== 'tie') return idle(a);
    if (a === 'surrender') return end(g, 0.5, 'Surrendered — half the bet back', x.now);
    if (a !== 'war') return idle(a);
    g.secret.deck.splice(0, 3); g.view.war = true;
    const pc = draw(g, x.now + 400), dc = draw(g, x.now + 900); g.view.player.push(pc); g.view.dealer.push(dc);
    return rv(pc) >= rv(dc) ? end(g, 2, `Won the war — ${pc.r} vs ${dc.r}`, x.now + 1300) : end(g, -1, `Lost the war — ${pc.r} vs ${dc.r} (both bets gone)`, x.now + 1300);
  },
  controls: (g) => ({ info: `Tie: <b>${txt(g.view.player)}</b> vs <b>${txt(g.view.dealer)}</b>`, buttons: [b('⚔️ GO TO WAR (bet doubles)', 'war', {}, { primary: true }), b('🏳 Surrender half', 'surrender')] }),
  stage(g, now, x) {
    const v = g.view;
    return `<div class="card-table side-by-side"><div class="hand"><div class="hand-label">You</div>${x.cardsHtml(v.player, now)}</div><div class="hand"><div class="hand-label">Dealer</div>${x.cardsHtml(v.dealer, now)}</div></div>
      ${g.phase === 'tie' && now >= v.tieAt ? '<div class="stage-big">TIE!</div><div class="stage-sub">Go to <b>WAR</b> (bet doubles) or <b>SURRENDER</b> half?</div>' : big(g, now, x.esc)}`;
  },
  bot: (g, pick, smart) => [smart || pick.chance(0.7) ? 'war' : 'surrender'],
};

// ── Dragon Tiger ─────────────────────────────────────────────────────────────────────────────────
const dragontiger = {
  id: 'dragontiger', name: 'Dragon Tiger', icon: '🐉', odds: { decks: 8, tie: 11, tieRefund: 0.5 },
  how: (o) => `Bet Dragon, Tiger or Tie. One card each, high card wins (aces are low). Dragon and Tiger pay even money; if it is a tie they lose ${pct(1 - o.tieRefund)} of the bet. A Tie bet pays ${o.tie}:1.`,
  returns: (o) => { const n = 52 * o.decks, pTie = (4 * o.decks - 1) / (n - 1), pWin = (1 - pTie) / 2; return [{ label: 'Dragon Tiger (Dragon / Tiger)', rtp: pWin * 2 + pTie * o.tieRefund }, { label: 'Dragon Tiger (Tie)', rtp: pTie * (1 + Number(o.tie)) }]; },
  start(g) { Object.assign(g.view, { bet: null, dragon: [], tiger: [], revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    if (g.phase !== 'bet' || a !== 'bet' || !['dragon', 'tiger', 'tie'].includes(p.side)) return idle(a);
    g.secret.deck = freshDeck(shuffle, x.rng, Number(x.odds.decks) || 8);
    const d = draw(g, x.now + 300), t = draw(g, x.now + 800), v = g.view; v.bet = p.side; v.dragon = [d]; v.tiger = [t];
    const w = aceLow(d) > aceLow(t) ? 'dragon' : aceLow(t) > aceLow(d) ? 'tiger' : 'tie'; v.winner = w;
    const mult = p.side === 'tie' ? (w === 'tie' ? 1 + Number(x.odds.tie) : 0) : w === 'tie' ? Number(x.odds.tieRefund) : w === p.side ? 2 : 0;
    return end(g, mult, w === 'tie' ? `Tie — ${d.r} and ${t.r}` : `${cap(w)} wins — ${d.r} vs ${t.r}`, x.now + 1300);
  },
  controls: (g, x) => ({ info: 'Bet on:', buttons: [b('🐉 DRAGON 1:1', 'bet', { side: 'dragon' }, { primary: true }), b('🐅 TIGER 1:1', 'bet', { side: 'tiger' }, { primary: true }), b(`🤝 TIE ${x.odds.tie}:1`, 'bet', { side: 'tie' })] }),
  stage(g, now, x) {
    const v = g.view; if (!v.bet) return '<div class="stage-sub">Choosing <b>Dragon</b>, <b>Tiger</b> or <b>Tie</b>…</div>';
    const win = (s) => (revealed(g, now) && v.winner === s ? ' winner' : '');
    return `<div class="stage-sub">Bet on <b>${v.bet.toUpperCase()}</b></div><div class="card-table side-by-side"><div class="hand${win('dragon')}"><div class="hand-label">🐉 Dragon</div>${x.cardsHtml(v.dragon, now)}</div><div class="hand${win('tiger')}"><div class="hand-label">🐅 Tiger</div>${x.cardsHtml(v.tiger, now)}</div></div>${big(g, now, x.esc)}`;
  },
  bot: (g, pick, smart) => ['bet', { side: smart ? 'dragon' : ['dragon', 'tiger', 'tie'][pick.int(0, 2)] }],
};

// ── Red Dog ──────────────────────────────────────────────────────────────────────────────────────
const reddog = {
  id: 'reddog', name: 'Red Dog', icon: '🐕', odds: { decks: 6, pay1: 5, pay2: 4, pay3: 2, pay4: 1, trips: 11 },
  how: (o) => `Two cards are dealt. You win if the third card lands strictly between them. The tighter the gap, the more it pays: a gap of one card pays ${o.pay1}:1, two ${o.pay2}:1, three ${o.pay3}:1, four or more ${o.pay4}:1. Before the third card you may raise (double your bet). Consecutive cards push. A pair pushes — unless the third card makes three of a kind, which pays ${o.trips}:1.`,
  start(g, x) {
    g.secret.deck = freshDeck(shuffle, x.rng, Number(x.odds.decks) || 6);
    const a = draw(g, x.now + 300), c = draw(g, x.now + 700), v = g.view; v.cards = [a, c]; v.third = null; v.raised = false; v.revealAt = null;
    const spread = Math.abs(rv(a) - rv(c)) - 1; v.spread = spread;
    if (spread === -1) { const t = draw(g, x.now + 1300); v.third = t; rv(t) === rv(a) ? end(g, 1 + Number(x.odds.trips), `Three ${a.r}s!`, x.now + 1800) : end(g, 1, 'Pair — push', x.now + 1800); }
    else if (spread === 0) end(g, 1, 'Consecutive cards — push', x.now + 1100);
    else { v.pay = Number(x.odds['pay' + Math.min(4, spread)]); g.phase = 'decide'; v.askAt = x.now + 1100; }
  },
  act(g, a, p, x) {
    if (g.phase !== 'decide' || (a !== 'raise' && a !== 'call')) return idle(a);
    const v = g.view, t = draw(g, x.now + 400); v.third = t; v.raised = a === 'raise';
    const lo = Math.min(rv(v.cards[0]), rv(v.cards[1])), hi = Math.max(rv(v.cards[0]), rv(v.cards[1])), inside = rv(t) > lo && rv(t) < hi, k = v.raised ? 2 : 1;
    return inside ? end(g, 1 + v.pay * k, `${t.r} is inside — pays ${v.pay}:1${v.raised ? ' on a doubled bet' : ''}`, x.now + 1000) : end(g, v.raised ? -1 : 0, `${t.r} misses${v.raised ? ' (doubled bet lost)' : ''}`, x.now + 1000);
  },
  controls: (g) => ({ info: `<b>${txt(g.view.cards)}</b> — gap of ${g.view.spread}, pays ${g.view.pay}:1`, buttons: [b('✖2 RAISE (double the bet)', 'raise', {}, { primary: true }), b('▶ CALL (deal the card)', 'call', {}, { primary: true })] }),
  stage(g, now, x) {
    const v = g.view;
    const mid = v.third ? '' : '<div class="pcard ghost"></div>';
    return `<div class="xbetween">${x.cardsHtml([v.cards[0]], now)}${v.third ? x.cardsHtml([v.third], now) : `<div class="pcard-row">${mid}</div>`}${x.cardsHtml([v.cards[1]], now)}</div>
      ${g.phase === 'decide' && now >= v.askAt ? `<div class="stage-sub">Gap of <b>${v.spread}</b> — a card in between pays <b>${v.pay}:1</b>. <b>RAISE</b> to double, or <b>CALL</b>.</div>` : big(g, now, x.esc)}`;
  },
  bot: (g, pick, smart) => [smart ? (g.view.spread >= 7 ? 'raise' : 'call') : pick.chance(0.4) ? 'raise' : 'call'],
};

// ── Chuck-a-Luck ─────────────────────────────────────────────────────────────────────────────────
const chuckaluck = {
  id: 'chuckaluck', name: 'Chuck-a-Luck', icon: '🎪', odds: { pay1: 1, pay2: 2, pay3: 10 },
  how: (o) => `Pick a number from 1 to 6. Three dice are rolled. One match pays ${o.pay1}:1, two pay ${o.pay2}:1, all three pay ${o.pay3}:1.`,
  returns: (o) => [{ label: 'Chuck-a-Luck', rtp: (75 * (1 + Number(o.pay1)) + 15 * (1 + Number(o.pay2)) + 1 * (1 + Number(o.pay3))) / 216 }],
  start(g) { Object.assign(g.view, { pick: null, dice: null, rollAt: null, revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    const n = Math.round(Number(p.n)); if (g.phase !== 'bet' || a !== 'pick' || !(n >= 1 && n <= 6)) return idle(a);
    const v = g.view; v.pick = n; v.dice = [d6(x.rng), d6(x.rng), d6(x.rng)]; v.rollAt = x.now;
    const m = v.dice.filter(d => d === n).length; v.matches = m;
    return end(g, m ? 1 + Number(x.odds['pay' + m]) : 0, m ? `${m} × ${n} — pays ${x.odds['pay' + m]}:1` : `No ${n}s`, x.now + DICE_MS + 200);
  },
  controls: () => ({ info: 'Player picks a number:', buttons: [1, 2, 3, 4, 5, 6].map(n => b(String(n), 'pick', { n }, { primary: true })) }),
  stage(g, now, x) {
    const v = g.view; if (!v.pick) return '<div class="stage-sub">Pick a number, <b>1</b> to <b>6</b>…</div>';
    return `<div class="stage-sub">Betting on <b class="xnum">${v.pick}</b></div>${diceHtml(v.dice, v.rollAt, now)}${big(g, now, x.esc)}`;
  },
  bot: (g, pick) => ['pick', { n: pick.int(1, 6) }],
};

// ── Sic Bo (lite) ────────────────────────────────────────────────────────────────────────────────
const SIC_COUNT = { 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3 };
const sicbo = {
  id: 'sicbo', name: 'Sic Bo', icon: '🥢', odds: { evenPay: 1, triplePay: 33, t4: 68, t5: 33, t6: 20, t7: 13, t8: 9, t9: 7.3, t10: 6.7 },
  how: (o) => `Three dice. Bet Small (total 4–10) or Big (11–17), Odd or Even — each pays ${o.evenPay}:1 and loses to any triple. Or bet Any Triple (${o.triplePay}:1), or an exact total: 4 or 17 pays ${o.t4}:1, 5 or 16 ${o.t5}:1, 6 or 15 ${o.t6}:1, 7 or 14 ${o.t7}:1, 8 or 13 ${o.t8}:1, 9 or 12 ${o.t9}:1, 10 or 11 ${o.t10}:1.`,
  totalPay: (o, n) => Number(o['t' + (n <= 10 ? n : 21 - n)]),
  returns(o) { const r = [{ label: 'Sic Bo (small / big / odd / even)', rtp: 105 / 216 * (1 + Number(o.evenPay)) }, { label: 'Sic Bo (any triple)', rtp: 6 / 216 * (1 + Number(o.triplePay)) }]; for (const n of [4, 7, 10]) r.push({ label: `Sic Bo (total ${n})`, rtp: SIC_COUNT[n] / 216 * (1 + sicbo.totalPay(o, n)) }); return r; },
  start(g) { Object.assign(g.view, { bet: null, dice: null, rollAt: null, revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    const types = ['small', 'big', 'odd', 'even', 'triple', 'total'], n = Math.round(Number(p.n));
    if (g.phase !== 'bet' || a !== 'bet' || !types.includes(p.type) || (p.type === 'total' && !(n >= 4 && n <= 17))) return idle(a);
    const v = g.view, d = [d6(x.rng), d6(x.rng), d6(x.rng)], t = sum(d), trip = d[0] === d[1] && d[1] === d[2];
    v.bet = p.type === 'total' ? { type: 'total', n } : { type: p.type }; v.dice = d; v.rollAt = x.now; v.total = t;
    let mult = 0;
    if (p.type === 'triple') mult = trip ? 1 + Number(x.odds.triplePay) : 0;
    else if (p.type === 'total') mult = t === n ? 1 + sicbo.totalPay(x.odds, n) : 0;
    else if (!trip) { const hit = p.type === 'small' ? t <= 10 : p.type === 'big' ? t >= 11 : p.type === 'odd' ? t % 2 === 1 : t % 2 === 0; mult = hit ? 1 + Number(x.odds.evenPay) : 0; }
    return end(g, mult, `${d.join(' + ')} = ${t}${trip ? ' — TRIPLE' : ''} — ${mult ? 'WIN' : 'miss'}`, x.now + DICE_MS + 200);
  },
  controls: (g, x) => ({ info: 'Bet:', buttons: [b('SMALL 4–10', 'bet', { type: 'small' }, { primary: true }), b('BIG 11–17', 'bet', { type: 'big' }, { primary: true }), b('ODD', 'bet', { type: 'odd' }), b('EVEN', 'bet', { type: 'even' }), b(`ANY TRIPLE ${x.odds.triplePay}:1`, 'bet', { type: 'triple' }),
    ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((n, i) => b(`${n} · ${sicbo.totalPay(x.odds, n)}:1`, 'bet', { type: 'total', n }, { br: i === 0 }))] }),
  stage(g, now, x) {
    const v = g.view; if (!v.bet) return '<div class="stage-sub">Choosing: <b>Small</b>, <b>Big</b>, <b>Odd</b>, <b>Even</b>, <b>Any Triple</b> or an exact total…</div>';
    return `<div class="stage-sub">Bet: <b>${v.bet.type === 'total' ? 'TOTAL ' + v.bet.n : v.bet.type.toUpperCase()}</b></div>${diceHtml(v.dice, v.rollAt, now)}${diceLanded(v.rollAt, now) ? `<div class="stage-sub">Total <b class="xnum">${v.total}</b></div>` : ''}${big(g, now, x.esc)}`;
  },
  bot: (g, pick, smart) => (smart ? ['bet', { type: 'big' }] : pick.chance(0.6) ? ['bet', { type: ['small', 'big', 'odd', 'even', 'triple'][pick.int(0, 4)] }] : ['bet', { type: 'total', n: pick.int(4, 17) }]),
};

// ── Under / Over 7 ───────────────────────────────────────────────────────────────────────────────
const underover7 = {
  id: 'underover7', name: 'Under / Over 7', icon: '7️⃣', odds: { sidePay: 1.3, sevenPay: 4.75 },
  how: (o) => `Two dice. Bet the total comes in Under 7 or Over 7 (pays ${o.sidePay}:1), or exactly 7 (pays ${o.sevenPay}:1).`,
  returns: (o) => [{ label: 'Under / Over 7 (under or over)', rtp: 15 / 36 * (1 + Number(o.sidePay)) }, { label: 'Under / Over 7 (exactly 7)', rtp: 6 / 36 * (1 + Number(o.sevenPay)) }],
  start(g) { Object.assign(g.view, { bet: null, dice: null, rollAt: null, revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    if (g.phase !== 'bet' || a !== 'bet' || !['under', 'over', 'seven'].includes(p.side)) return idle(a);
    const v = g.view, d = [d6(x.rng), d6(x.rng)], t = d[0] + d[1]; v.bet = p.side; v.dice = d; v.rollAt = x.now; v.total = t;
    const hit = p.side === 'under' ? t < 7 : p.side === 'over' ? t > 7 : t === 7;
    return end(g, hit ? 1 + Number(p.side === 'seven' ? x.odds.sevenPay : x.odds.sidePay) : 0, `${d[0]} + ${d[1]} = ${t} — ${hit ? 'WIN' : 'miss'}`, x.now + DICE_MS + 200);
  },
  controls: (g, x) => ({ info: 'Bet:', buttons: [b(`⬇ UNDER 7 · ${x.odds.sidePay}:1`, 'bet', { side: 'under' }, { primary: true }), b(`7️⃣ EXACTLY 7 · ${x.odds.sevenPay}:1`, 'bet', { side: 'seven' }), b(`⬆ OVER 7 · ${x.odds.sidePay}:1`, 'bet', { side: 'over' }, { primary: true })] }),
  stage(g, now, x) {
    const v = g.view; if (!v.bet) return '<div class="stage-sub"><b>Under 7</b>, <b>Over 7</b> or <b>exactly 7</b>?</div>';
    return `<div class="stage-sub">Bet: <b>${v.bet === 'seven' ? 'EXACTLY 7' : v.bet.toUpperCase() + ' 7'}</b></div>${diceHtml(v.dice, v.rollAt, now)}${big(g, now, x.esc)}`;
  },
  bot: (g, pick) => ['bet', { side: ['under', 'over', 'seven'][pick.int(0, 2)] }],
};

// ── Wheel of Colours ─────────────────────────────────────────────────────────────────────────────
const COLOR_DEFAULT = [
  { label: 'Red', color: '#c0392b', count: 23, pay: 1.1 }, { label: 'Blue', color: '#2f6db3', count: 13, pay: 2.7 }, { label: 'Green', color: '#3f9d5c', count: 8, pay: 5 },
  { label: 'Yellow', color: '#d4ac0d', count: 4, pay: 11 }, { label: 'Purple', color: '#8e44ad', count: 2, pay: 23 },
];
export function colorSegments(o) { const s = Array.isArray(o?.segments) ? o.segments.filter(r => r && r.label && Number(r.count) > 0) : []; return s.length >= 2 ? s : COLOR_DEFAULT; }
// Spread each colour evenly round the wheel so the rare ones are not bunched together.
export function colorLayout(segs) {
  const slots = [];
  segs.forEach((s, si) => { for (let k = 0; k < s.count; k++) slots.push({ si, pos: (k + 0.5) / s.count + si * 1e-4 }); });
  return slots.sort((a, c) => a.pos - c.pos).map(s => s.si);
}
const colorwheel = {
  id: 'colorwheel', name: 'Wheel of Colours', icon: '🌈', odds: { segments: COLOR_DEFAULT },
  how: (o) => `Bet on a colour and spin. The rarer the colour, the more it pays: ${colorSegments(o).map(s => `${s.label} ${s.pay}:1`).join(', ')}.`,
  returns(o) { const segs = colorSegments(o), n = sum(segs.map(s => Number(s.count))); return segs.map(s => ({ label: `Wheel of Colours (${s.label})`, rtp: s.count / n * (1 + Number(s.pay)) })); },
  start(g) { Object.assign(g.view, { bet: null, revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    const segs = colorSegments(x.odds), si = segs.findIndex(s => s.label === p.color);
    if (g.phase !== 'bet' || a !== 'bet' || si < 0) return idle(a);
    const layout = colorLayout(segs), i = x.rng.int(0, layout.length - 1), hit = segs[layout[i]], v = g.view; v.bet = p.color; v.landed = hit.label;
    const win = layout[i] === si;
    x.state.lastSpin = { wheel: 'WHEEL OF COLOURS', outcomes: layout.map(k => segs[k].label), colors: layout.map(k => segs[k].color), index: i, playerId: g.playerId, ts: x.now,
      effect: win ? `${hit.label} — pays ${hit.pay}:1` : `${hit.label} — the bet was on ${p.color}` };
    return end(g, win ? 1 + Number(hit.pay) : 0, win ? `${hit.label}! Pays ${hit.pay}:1` : `${hit.label} — bet was ${p.color}`, x.now + 4400);
  },
  controls: (g, x) => ({ info: 'Bet on a colour:', buttons: colorSegments(x.odds).map(s => b(`${s.label} · ${s.pay}:1`, 'bet', { color: s.label }, { primary: true })) }),
  stage(g, now, x) {
    const v = g.view, segs = colorSegments(x.odds);
    if (!v.bet) return `<div class="stage-sub">Pick a colour</div><div class="xtrail">${segs.map(s => `<span class="xpill" style="background:${x.esc(s.color)};color:#fff">${x.esc(s.label)} ${x.esc(s.pay)}:1</span>`).join('')}</div>`;
    return `<div class="stage-sub">Bet on <b>${x.esc(v.bet)}</b></div>${revealed(g, now) ? big(g, now, x.esc) : '<div class="stage-sub">Spinning…</div>'}`;
  },
  bot: (g, pick, smart, x) => { const segs = colorSegments(x.odds); return ['bet', { color: segs[smart ? 0 : pick.int(0, segs.length - 1)].label }]; },
};

// ── Scratch Card ─────────────────────────────────────────────────────────────────────────────────
const SCRATCH_DEFAULT = [
  { icon: '🍒', mult: 1, weight: 14 }, { icon: '🍋', mult: 2, weight: 10 }, { icon: '🔔', mult: 5, weight: 5 },
  { icon: '⭐', mult: 10, weight: 2 }, { icon: '💎', mult: 50, weight: 0.25 }, { icon: '👑', mult: 250, weight: 0.02 },
];
export function scratchTiers(o) { const t = Array.isArray(o?.tiers) ? o.tiers.filter(r => r && r.icon && Number(r.weight) > 0) : []; return t.length >= 5 ? t : SCRATCH_DEFAULT; }
const scratch = {
  id: 'scratch', name: 'Scratch Card', icon: '🎫', odds: { tiers: SCRATCH_DEFAULT, loseWeight: 68.73 },
  how: (o) => `Nine panels. Scratch them off — three matching symbols win that prize: ${scratchTiers(o).map(t => `${t.icon} ${x2(t.mult)}`).join(', ')}.`,
  returns(o) { const t = scratchTiers(o), tot = sum(t.map(r => Number(r.weight))) + Number(o.loseWeight); return [{ label: 'Scratch Card', rtp: sum(t.map(r => r.weight * r.mult)) / tot }]; },
  start(g, x) {
    const tiers = scratchTiers(x.odds), rows = [...tiers.map(t => ({ weight: Number(t.weight) })), { weight: Number(x.odds.loseWeight) }];
    const w = weightedIndex(x.rng, rows), win = w < tiers.length ? tiers[w] : null;
    // Winning card: the prize symbol exactly three times. Every other symbol appears at most twice.
    const pool = []; for (const t of tiers) if (!win || t.icon !== win.icon) pool.push(t.icon, t.icon);
    const cells = shuffle(x.rng, [...(win ? [win.icon, win.icon, win.icon] : []), ...shuffle(x.rng, pool).slice(0, win ? 6 : 9)]);
    g.secret.cells = cells; g.secret.mult = win ? Number(win.mult) : 0; g.secret.icon = win ? win.icon : null;
    g.view.cells = Array(9).fill(null); g.view.revealAt = null; g.phase = 'scratch';
  },
  act(g, a, p, x) {
    if (g.phase !== 'scratch') return idle(a);
    const v = g.view, open = (i) => { v.cells[i] = g.secret.cells[i]; };
    if (a === 'all') for (let i = 0; i < 9; i++) open(i);
    else if (a === 'scratch' && Number.isInteger(p.i) && p.i >= 0 && p.i < 9 && v.cells[p.i] === null) open(p.i);
    else return idle(a);
    if (v.cells.every(c => c !== null)) { v.win = g.secret.icon; return end(g, g.secret.mult, g.secret.mult ? `${g.secret.icon}${g.secret.icon}${g.secret.icon} — ${x2(g.secret.mult)}` : 'No three alike', x.now + 350); }
    return { text: `Scratched panel ${p.i + 1}.` };
  },
  controls: (g) => ({ info: 'Scratch a panel:', buttons: [...g.view.cells.map((c, i) => b(c === null ? `▒ ${i + 1}` : c, 'scratch', { i }, { disabled: c !== null, br: i % 3 === 0 })), b('Scratch all', 'all', {}, { primary: true, br: true })] }),
  stage(g, now, x) {
    const v = g.view, done = revealed(g, now);
    return `<div class="xgrid three">${v.cells.map(c => `<div class="xcell ${c === null ? 'hidden' : ''} ${done && c === v.win ? 'hit' : ''}">${c === null ? '▒' : c}</div>`).join('')}</div>${done ? big(g, now, x.esc) : '<div class="stage-sub">Match <b>three</b> symbols to win</div>'}`;
  },
  bot: (g, pick) => (pick.chance(0.5) ? ['all'] : ['scratch', { i: g.view.cells.findIndex(c => c === null) }]),
};

// ── Limbo ────────────────────────────────────────────────────────────────────────────────────────
export const limboChance = (o, target) => Math.min(1, (1 - Number(o.houseEdge)) / Number(target));
const limbo = {
  id: 'limbo', name: 'Limbo', icon: '📈', odds: { houseEdge: 0.03, minTarget: 1.1, maxTarget: 1000 },
  how: (o) => `Name a target multiplier from ${x2(o.minTarget)} to ${x2(o.maxTarget)}. A number is drawn; if it is at least your target, you are paid your target. Low targets win often, high targets rarely (a ${x2(2)} target wins ${pct(limboChance(o, 2))} of the time).`,
  returns: (o) => [{ label: 'Limbo', rtp: 1 - o.houseEdge }],
  start(g) { Object.assign(g.view, { target: null, result: null, rollAt: null, revealAt: null }); g.phase = 'bet'; },
  act(g, a, p, x) {
    const t = floor2(Number(p.target));
    if (g.phase !== 'bet' || a !== 'bet') return idle(a);
    if (!(t >= Number(x.odds.minTarget) && t <= Number(x.odds.maxTarget))) return { text: `Target must be between ${x2(x.odds.minTarget)} and ${x2(x.odds.maxTarget)}.`, error: true };
    const u = x.rng.next(), r = Math.min(9999, Math.max(1, floor2((1 - Number(x.odds.houseEdge)) / (1 - u)))), v = g.view;
    v.target = t; v.result = r; v.rollAt = x.now;
    return end(g, r >= t ? t : 0, r >= t ? `${x2(r)} clears ${x2(t)}` : `${x2(r)} — needed ${x2(t)}`, x.now + 1500);
  },
  controls: (g, x) => ({ info: 'Target multiplier:', inputs: [{ id: 'xLimbo', type: 'number', value: 2, min: x.odds.minTarget, max: x.odds.maxTarget, step: 0.1 }],
    buttons: [b('🚀 GO', 'bet', {}, { primary: true, from: { target: 'xLimbo' } }), ...[1.5, 2, 5, 10, 50].map(t => b(`${t}× (${pct(limboChance(x.odds, t))})`, 'bet', { target: t }))] }),
  stage(g, now, x) {
    const v = g.view; if (v.target == null) return '<div class="stage-sub">Naming a target multiplier…</div>';
    const climbing = now < v.rollAt + 1300, shown = climbing ? Math.min(v.result, floor2(1 + (v.result - 1) * ((now - v.rollAt) / 1300) ** 2)) : v.result;
    return `<div class="stage-sub">Target <b>${x2(v.target)}</b> — ${pct(limboChance(x.odds, v.target))} to hit</div><div class="stage-big ${climbing ? 'crash-live' : cls(g.result.mult)}">${shown.toFixed(2)}×</div>${big(g, now, x.esc)}`;
  },
  bot: (g, pick, smart) => ['bet', { target: smart ? 2 : [1.2, 1.5, 2, 3, 10, 100][pick.int(0, 5)] }],
};

export const QUICK = [coinstreak, war, dragontiger, reddog, chuckaluck, sicbo, underover7, colorwheel, scratch, limbo];
