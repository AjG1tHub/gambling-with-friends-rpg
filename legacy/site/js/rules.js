// Rulebook (loop 27). Built from the live config, so the page players read always matches the numbers the
// game is actually using (Sheet edits included). Pure: rulesSections(config) → [{ id, title, html }].
import * as G from './games.js';
import { gameReturns } from './config-check.js';
import { loanRules } from './loans.js';
import { petRules, speciesList, RANKS, PET_ITEMS, POWER_MAX, RARITY_WEIGHT } from './pets.js';
import { battleRules, STRONG, STATUS, bossList, CAPTURE_DC } from './petbattle.js';
import { raidRules } from './raid.js';
import { buyInMech } from './buyin.js';
import { contestKind } from './contests.js';

export const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 0) => (Number.isFinite(x) ? (x * 100).toFixed(d).replace(/\.0+$/, '') + '%' : '—');
const num = (x) => (Number.isFinite(Number(x)) ? Number(x).toLocaleString('en-US') : '—');
const mult = (x) => `${Number(Number(x).toFixed(2))}×`;

// A wheel as a table: label, chance, what it does.
function wheelTable(rows, e, { weightOf = (r) => Number(r.weight) || 0, extra = null } = {}) {
  const live = (rows || []).filter(r => r && weightOf(r) > 0);
  const total = live.reduce((s, r) => s + weightOf(r), 0);
  if (!total) return '<p class="muted">This wheel is empty.</p>';
  return `<table><thead><tr><th>Outcome</th><th class="n">Chance</th><th>What happens</th></tr></thead><tbody>${
    live.map(r => `<tr><td><b>${e(r.label)}</b></td><td class="n">${pct(weightOf(r) / total, 1)}</td><td>${e(r.desc || '')}${extra ? extra(r) : ''}</td></tr>`).join('')}</tbody></table>`;
}

// Games whose return depends on how you play: figures from test/balance.mjs with a sensible strategy.
export const SKILL_RETURNS = { war: 'about 97%', reddog: 'about 97%', videopoker: 'about 97% with sensible holds', threecard: 'about 97% with sensible play', letitride: 'about 96% with sensible play', holdem: 'about 97% with sensible play', paigow: 'about 97%' };
const HOW = {
  fifty: (o) => `One spin. Win and you get your bet back plus ${mult(o.payout)} of it; lose and the bet is gone. Win chance: ${pct(Number(o.winChance))}.`,
  bigwheel: () => 'One spin of a big prize wheel. The slice it lands on is what your bet is multiplied by.',
  roulette: (o) => `A ${o.pockets}-pocket wheel (one green zero). Bet a single number (pays ${o.straight}:1), a dozen or column (pays ${o.dozen}:1), or red/black, odd/even, low/high (pays ${o.even}:1). Zero beats everything except a bet on zero.`,
  crash: (o) => `A rocket climbs and your multiplier climbs with it — up to ${mult(o.maxMult)}. Shout “cash out!” before it explodes and you keep bet × multiplier. Wait too long and you lose the bet.`,
  mines: (o) => `A grid of ${o.grid} tiles hides ${o.mines} mines. Every safe tile you flip raises your multiplier. Cash out whenever you like — hit a mine and the bet is gone.`,
  blackjack: (o) => `Get closer to 21 than the dealer without going over. Blackjack pays ${o.blackjackPays}:1. Dealer ${Number(o.dealerHitsSoft17) ? 'hits' : 'stands on'} soft 17. You may double on your first two cards and split pairs (up to ${o.maxHands} hands${Number(o.splitAcesOneCard) ? '; split aces get one card each' : ''}).${Number(o.insurance) ? ' When the dealer shows an ace you can buy insurance for half your bet; it pays 2:1 if the dealer has blackjack.' : ''} ${o.decks} decks.`,
  baccarat: (o) => `Bet on Player, Banker or Tie; two hands are dealt and the one closest to 9 wins. Player pays ${o.player}:1, Banker pays ${o.banker}:1, Tie pays ${o.tie}:1. If it is a tie, Player and Banker bets are returned.`,
  plinko: () => 'A ball drops through the pegs, bouncing left or right at each row, and lands in a slot. Your bet is multiplied by that slot. The edges pay big and are rare; the middle is common and pays less than you bet.',
  hilo: (o) => `A card is shown. Call whether the next one is higher or lower. Every correct call multiplies your winnings (the less likely the call, the bigger the jump). Aces are low; an equal card is a free redraw. Cash out any time — one wrong call loses the bet. Capped at ${mult(o.maxMult)}.`,
  dice: (o) => `A number from 1 to 100 is rolled. You choose a target and bet the roll lands under it or over it. The riskier the bet, the more it pays (win chance must be ${o.minChance}%–${o.maxChance}%).`,
  slots: () => 'Three reels. Three matching symbols pay the big prize; some pairs pay a little.',
  keno: (o) => `Pick up to ${o.maxPicks} numbers out of ${o.numbers}. ${o.drawn} balls are drawn. The more of yours that come up, the more you win.`,
};

function gameExtras(id, o, e) {
  if (id === 'bigwheel' && Array.isArray(o.segments)) return wheelTable(o.segments.map(s => ({ label: s.label, weight: s.weight, desc: Number(s.mult) ? `Bet × ${Number(s.mult)}` : 'Lose the bet' })), e);
  if (id === 'plinko') { const m = G.plinkoMults(o), n = m.length - 1; return `<table><thead><tr><th>Slot</th>${m.map((_, i) => `<th class="n">${i + 1}</th>`).join('')}</tr></thead><tbody><tr><td>Pays</td>${m.map(x => `<td class="n">${mult(x)}</td>`).join('')}</tr><tr><td>Chance</td>${m.map((_, k) => `<td class="n">${pct(G.binom(n, k) / 2 ** n, 1)}</td>`).join('')}</tr></tbody></table>`; }
  if (id === 'slots') { const sy = G.slotsSymbols(o); return `<table><thead><tr><th>Symbol</th><th class="n">Three of a kind</th><th class="n">A pair</th></tr></thead><tbody>${sy.map(s => `<tr><td>${e(s.icon)}</td><td class="n">${mult(s.three)}</td><td class="n">${Number(s.two) ? mult(s.two) : '—'}</td></tr>`).join('')}</tbody></table>`; }
  if (id === 'keno') { const R = G.kenoRules(o); const picks = []; for (let k = 1; k <= R.maxPicks; k++) picks.push(k);
    return `<table><thead><tr><th>You picked</th><th>Hits → your bet is multiplied by</th></tr></thead><tbody>${picks.map(k => `<tr><td class="n">${k}</td><td>${Object.entries(R.pays[k] || {}).filter(([, v]) => Number(v) > 0).map(([h, v]) => `<span class="pill">${e(h)} hit${h === '1' ? '' : 's'} → ${mult(v)}</span>`).join(' ') || '—'}</td></tr>`).join('')}</tbody></table>`; }
  return '';
}

export function rulesSections(config, e = escHtml) {
  const C = config.Config || {}, out = [];
  const add = (id, title, html) => out.push({ id, title, html });
  const curs = (config.Currencies || []).filter(c => c && c.active !== false);
  const st = { oddsOverrides: {} };

  add('goal', 'The goal', `<p>Everyone starts with <b>${num(C.StartingBank)} Gold</b>. Move around the board, gamble on whatever you land on, and finish the night with the most. The leaderboard ranks <b>net worth</b>: your Gold, plus your other currencies at their Gold value, minus anything you owe the Loan Shark.</p>
    <p>The <b>GM</b> runs the game from their own screen; everyone else watches the shared screen. Nothing here is real money.</p>`);

  add('turn', 'Your turn', `<ol><li><b>Spin the Method Wheel</b> — it decides <i>how</i> you move this turn.</li><li><b>Move</b> — you choose the direction at each step. Walking off an edge wraps to the other side${C.VoidEnabled === false ? '' : `, but each crossing has a <b>${pct(Number(C.VoidChance))}</b> chance of waking the Void (see below)`}.</li><li><b>Resolve the tile</b> you land on.</li><li>Land on another player and it is a <b>Battle</b>.</li></ol>
    <h3>Method Wheel</h3>${wheelTable(config.Wheel_Method, e)}`);

  const tc = config.Board?.tileCounts || {};
  add('tiles', 'The board', `<p>The board is ${e(config.Board?.cols)} × ${e(config.Board?.rows)}. Tiles:</p>
    <table><tbody>
    <tr><td><b>🎲 GAME</b> × ${e(tc.GAME ?? 0)}</td><td>Play the minigame printed on the tile. Minimum bet ${num(C.MinBet)} Gold.</td></tr>
    <tr><td><b>🍀 GOOD</b> × ${e(tc.GOOD ?? 0)}</td><td>Spin the Good Wheel.</td></tr>
    <tr><td><b>💀 BAD</b> × ${e(tc.BAD ?? 0)}</td><td>Spin the Bad Wheel.</td></tr>
    <tr><td><b>🔐 JAIL</b> × ${e(tc.JAIL ?? 0)}</td><td>You are locked up (see Jail).</td></tr>
    <tr><td><b>🛒 SHOP</b> × ${e(tc.SHOP ?? 0)}</td><td>Trade currencies, buy power-ups and pet supplies.</td></tr>
    <tr><td><b>🏠 START</b> × ${e(tc.START ?? 0)}</td><td>Everyone begins here. Land on it later and you spin the Start Wheel.</td></tr>
    </tbody></table>
    <p>The GM can trigger <b>Chaos</b> at any time, from a gentle reshuffle of the minigames up to an apocalypse that repaints the board and scatters everyone.</p>`);

  const built = (config.Games || []).filter(g => g && g.built && !g.hidden);
  const returns = gameReturns(config);
  add('games', 'Minigames', `<p>You bet before the game starts. “Returns” is what the game pays back on average for every 100 Gold bet — under 100% means the house wins in the long run.</p>${
    built.map(g => {
      const o = G.effectiveOdds(config, st, g.id), how = HOW[g.id] || G.extraDef(g.id)?.how;
      const rt = returns.filter(r => r.id === g.id), lo = Math.min(...rt.map(r => r.rtp)), hi = Math.max(...rt.map(r => r.rtp));
      const rtText = !rt.length ? (g.id === 'blackjack' ? 'about 99% with sensible play' : SKILL_RETURNS[g.id] || '') : lo === hi ? pct(lo, 1) : `${pct(lo, 1)}–${pct(hi, 1)} depending on the bet`;
      let body = ''; try { body = (how ? `<p>${e(how(o))}</p>` : '<p>The GM will explain this one.</p>') + gameExtras(g.id, o, e); } catch { body = '<p>The GM will explain this one.</p>'; }
      return `<div class="game"><h3>${e(g.icon || '🎲')} ${e(g.name)}${rtText ? ` <span class="rt">returns ${e(rtText)}</span>` : ''}</h3>${body}</div>`;
    }).join('') || '<p class="muted">No minigames are switched on.</p>'}`);

  add('good', 'Good Wheel', wheelTable(config.Wheel_Good, e));
  add('bad', 'Bad Wheel', wheelTable(config.Wheel_Bad, e));
  add('start', 'Start Wheel', `<p>Spun when you land on START after the game has begun.</p>${wheelTable(config.Wheel_Start, e)}`);
  if (C.VoidEnabled !== false) add('void', 'The Void', `<p>Each time you cross the edge of the board there is a <b>${pct(Number(C.VoidChance))}</b> chance the Void notices.</p>${wheelTable(config.Wheel_Void, e)}`);

  const jail = Array.isArray(config.Wheel_Jail) ? config.Wheel_Jail : [];
  const tierTotals = [1, 2, 3, 4].map(t => jail.reduce((s, r) => s + (Number(r?.weights?.[t]) || 0), 0));
  add('jail', 'Jail', `<p>Jail has four tiers. The deeper you are, the harder it is to leave. On your turn in jail you pick one way out:</p>
    <table><thead><tr><th>Option</th><th>How it works</th></tr></thead><tbody>
    <tr><td><b>💰 Buy out</b></td><td>Pay ${[1, 2, 3, 4].map(t => `${num(C['JailBuyoutT' + t])} (tier ${t})`).join(' · ')} Gold.</td></tr>
    <tr><td><b>🎯 Skill check</b></td><td>Play a minigame the GM picks. Win and you are free; lose and it costs ${num(C.JailSkillCheckStake)} Gold.</td></tr>
    <tr><td><b>🎲 Double or Detain</b></td><td>Wager at least ${num(C.JailRiskMinWager)} Gold on a coin flip. Win: you are free and the wager is doubled. Lose: you lose it and go one tier deeper.</td></tr>
    <tr><td><b>🎡 Jail Wheel</b></td><td>Free to spin. Odds depend on your tier:</td></tr></tbody></table>
    <table><thead><tr><th>Jail Wheel</th><th class="n">Tier 1</th><th class="n">Tier 2</th><th class="n">Tier 3</th><th class="n">Tier 4</th><th>What happens</th></tr></thead><tbody>${
      jail.filter(r => r && r.label).map(r => `<tr><td><b>${e(r.label)}</b></td>${[1, 2, 3, 4].map((t, i) => `<td class="n">${tierTotals[i] ? pct((Number(r.weights?.[t]) || 0) / tierTotals[i]) : '—'}</td>`).join('')}<td>${e(r.desc || '')}</td></tr>`).join('')}</tbody></table>
    <p>A <b>Pardon</b> (from the Good Wheel) is burned automatically the next time you would be jailed.</p>`);

  const battle = Array.isArray(config.Wheel_Battle) ? config.Wheel_Battle : [];
  add('battle', 'Battles', `<p>Land on another player and you battle. Both sides put up a wager (at least ${num(C.BattleMinWager)} Gold in value), then the Battle Wheel picks the contest. Winner takes both wagers.</p>
    ${wheelTable(battle, e, { extra: (r) => r.petBattle ? ' <span class="pill">pets fight it out</span>' : contestKind(r) ? ' <span class="pill">played on screen</span>' : r.spinCategory ? ' <span class="pill">then a category is spun</span>' : ' <span class="pill">played at the table</span>' })}
    ${Array.isArray(config.Wheel_Category) && config.Wheel_Category.length ? `<p><b>Name 10 categories:</b> ${config.Wheel_Category.map(c => e(c.label)).join(', ')}.</p>` : ''}`);

  add('money', 'Currencies & the shop', `<p>Gold is the main currency. The others are worth a set amount of Gold each on the leaderboard, but at a Shop the exchange rate is rolled between ${mult(config.ShopConfig?.rateMin ?? C.ShopRateMin)} and ${mult(config.ShopConfig?.rateMax ?? C.ShopRateMax)} of that value — so shop around.</p>
    <p>${curs.map(c => `<span class="pill">${e(c.emoji || '')} ${e(c.name)}${c.name === 'Gold' ? '' : ` = ${num(c.goldRate)} Gold`}</span>`).join(' ')}</p>
    <h3>Power-ups</h3><table><thead><tr><th>Power-up</th><th class="n">Price</th><th>Effect</th><th class="n">Max held</th></tr></thead><tbody>${
      (config.PowerUps || []).filter(p => p && p.active !== false).map(p => `<tr><td><b>${e(p.name)}</b></td><td class="n">${num(p.price)}</td><td>${e(p.effect)}</td><td class="n">${e(p.maxHeld ?? 1)}</td></tr>`).join('')}</tbody></table>`);

  const L = loanRules(config);
  const buyRows = Array.isArray(config.Wheel_BuyIn) ? config.Wheel_BuyIn : [];
  add('broke', 'Going broke', `<p>Your Gold can go negative — you keep playing in the red. When you need money to get back in, the GM spins the <b>Buy-in Wheel</b> to decide how you pay for it:</p>
    ${wheelTable(buyRows, e, { extra: (r) => buyInMech(r) ? '' : ' <span class="pill">GM decides</span>' })}
    ${L.enabled === false ? '' : `<h3>🦈 The Loan Shark</h3><p>Borrow ${num(L.minPrincipal)}–${num(L.maxPrincipal)} Gold (up to ${e(L.maxOpenLoans)} loans at once). You owe it back plus <b>${e(L.interestPct)}%</b> within <b>${e(L.termTurns)} of your turns</b>. Miss the deadline and ${e(L.penaltyPct)}% is added, then the Collector takes ${num(L.garnishPerTurn)} Gold at the start of every turn until you are clear. Debt counts against you on the leaderboard.</p>`}
    <h3>🔨 Auctions</h3><p>Currencies can be put up for auction. Bidding opens at ${pct(Number(config.Auction?.openingPct ?? 0.25))} of the lot's value, each raise is at least ${num(config.Auction?.minIncrement ?? 10)} Gold, and the GM calls “going once, going twice, sold”.</p>`);

  const P = petRules(config);
  if (P.enabled !== false) {
    const B = battleRules(config), RR = raidRules(config), species = speciesList(config);
    const rarTotal = species.reduce((s, x) => s + (RARITY_WEIGHT[x.rarity] || 0), 0);
    add('pets', 'Pets & Power Level', `<p>Alongside the gambling there is a side game. Playing the main game earns you <b>Power ⚡</b> (max ${num(POWER_MAX)}), which you spend on pets.</p>
      <table><thead><tr><th>You earn Power for</th><th class="n">⚡</th></tr></thead><tbody>${
        [['Starting the session', P.gain.sessionStart], ['Each turn you take', P.gain.turn], ['Winning a minigame', P.gain.gameWin], [`A big win (${P.bigWinMult}× or more)`, P.gain.gameBigWin], ['Winning a battle', P.gain.battleWin], ['Going to jail', P.gain.jailIn], ['Getting out of jail', P.gain.jailOut], ['Winning a pet battle', P.gain.petBattleWin], ['Beating a boss', P.gain.bossWin]]
          .filter(([, v]) => Number(v) > 0).map(([k, v]) => `<tr><td>${e(k)}</td><td class="n">+${num(v)}</td></tr>`).join('')}</tbody></table>
      <p><b>Spend it:</b> hatch an egg for ${num(P.eggCost)} ⚡ (up to ${e(P.maxPets)} pets), train a pet (1 ⚡ = ${e(P.xpPerPower)} XP), or revive a fainted pet for ${num(P.reviveCost)} ⚡. Pets level up to ${e(P.maxLevel)} and evolve along the way.</p>
      <p><b>Trainer ranks</b> come from the total Power you have ever earned: ${RANKS.map(r => `<span class="pill">${e(r.icon)} ${e(r.name)} ${num(r.earned)}+</span>`).join(' ')}. Higher ranks get cheaper eggs and bonus XP.</p>
      <h3>The pets</h3><table><thead><tr><th>Pet</th><th>Element</th><th>Rarity</th><th class="n">Egg chance</th><th>Evolves into</th></tr></thead><tbody>${
        species.map(s => `<tr><td>${e(s.emoji || '')} <b>${e(s.name)}</b></td><td>${e(s.element)}</td><td>${e(s.rarity)}</td><td class="n">${rarTotal ? pct((RARITY_WEIGHT[s.rarity] || 0) / rarTotal, 1) : '—'}</td><td>${(Array.isArray(s.evolves) ? s.evolves : []).map(v => `${e(v.emoji || '')} ${e(v.name)} (L${e(v.level)})`).join(' → ') || '—'}</td></tr>`).join('')}</tbody></table>
      <h3>Pet battles</h3><p>Pets have six stats (STR, DEX, CON, INT, WIS, CHA) like a tabletop RPG. An attack rolls a d20 plus bonuses against the defender's Armor Class; a natural 20 is a critical hit. Each turn a pet can Strike, use its Element move, Guard, or Mend.</p>
      <p><b>Elements:</b> ${Object.entries(STRONG).map(([a, bs]) => `${e(a)} beats ${e(bs.join(' & '))}`).join(' · ')}. A strong hit does ${mult(B.strongMult)} damage, a resisted one ${mult(B.resistMult)}.</p>
      <p><b>Status effects</b> (from element moves): ${Object.values(STATUS).map(s => `<span class="pill">${e(s.icon)} ${e(s.name)} — ${e(s.desc)}</span>`).join(' ')} <span class="pill">✨ Light — heals the attacker instead</span></p>
      <p><b>Wild encounters</b> can be befriended once beaten — the rarer the pet, the harder the roll (${Object.entries(CAPTURE_DC).map(([k, v]) => `${e(k)} ${e(v)}+`).join(', ')} on a d20).</p>
      <h3>Bosses & raids</h3><p>Bosses pay Gold and XP and drop a held item ${pct(Number(B.dropChance))} of the time: ${bossList(config).map(b => `<span class="pill">${e(b.emoji || '👹')} ${e(b.name)} L${e(b.level)}${b.rewardGold ? ` · ${num(b.rewardGold)} Gold` : ''}</span>`).join(' ')}</p>
      <p>A <b>raid</b> is ${e(RR.minParty)}–${e(RR.maxParty)} players' pets against one boss with extra health. Every winner gets ${pct(Number(RR.goldShare))} of the boss's Gold.</p>
      <p><b>Held items</b> (one per pet): ${Object.values(PET_ITEMS).map(i => `<span class="pill">${e(i.icon)} ${e(i.name)} — ${e(i.desc)}</span>`).join(' ')}</p>`);
  }

  add('extras', 'House extras', `<p><b>🤝 Side bets:</b> real-life stakes (“loser buys pizza”) can be logged with the GM. They show on the shared screen until settled and never touch your Gold.</p>
    <p><b>🏆 Hall of Fame:</b> results are kept between game nights — wins, biggest hits and records carry over, and so do your pets.</p>
    <p><b>The GM's word is final.</b> The GM can adjust balances, undo a mistake, or overrule the wheel.</p>`);
  return out;
}

export function rulesHtml(config, e = escHtml) {
  const secs = rulesSections(config, e);
  return `<nav class="toc">${secs.map(s => `<a href="#${s.id}">${e(s.title)}</a>`).join('')}</nav>${secs.map(s => `<section id="${s.id}"><h2>${e(s.title)}</h2>${s.html}</section>`).join('')}`;
}
