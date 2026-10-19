// Session statistics (Phase 6 recap v2 + Phase 7 cross-session history). Pure: reads
// config + state (mostly the ledger), returns plain data. No DOM, no storage.
import { goldValue, netWorth, debtOwed } from './state.js';

const rateOf = (config) => Object.fromEntries(config.Currencies.map(c => [c.name, Number(c.goldRate) || 0]));
const blank = () => ({
  games: 0, wins: 0, losses: 0, pushes: 0, gameNet: 0, biggestWin: 0, biggestLoss: 0, biggestWager: 0,
  jailed: 0, jailSpins: 0, buyouts: 0, buyoutGold: 0, battles: 0, battlesWon: 0, voids: 0,
  powerUpsBought: 0, powerUpsUsed: 0, wheelSpins: 0, shopTrades: 0, loans: 0, borrowed: 0, defaults: 0, petBattlesWon: 0, bossesBeaten: 0, lowestGold: null, highestGold: null,
});

// Standings: net worth now (holdings at GoldRate minus unpaid loans), and net vs the starting bank.
export function standings(config, state) {
  const start = Number(config.Config.StartingBank) || 0;
  const r2 = (n) => Math.round(n * 100) / 100;
  const list = [...state.players]
    .map(p => ({ id: p.id, name: p.name, value: r2(netWorth(config, p)), net: r2(netWorth(config, p) - start), debt: r2(debtOwed(p)) }))
    .sort((a, b) => b.value - a.value);
  // Equal value = equal rank ("1, 1, 3" — standard competition ranking)
  list.forEach((s, i) => { s.rank = i > 0 && list[i - 1].value === s.value ? list[i - 1].rank : i + 1; });
  return list;
}

// {playerId: rank} for the leaderboard's ▲▼ arrows.
export function rankMap(config, state) { return Object.fromEntries(standings(config, state).map(s => [s.id, s.rank])); }
// Positive = climbed that many places since the snapshot.
export function rankMovement(snapshot, current) {
  const out = {};
  for (const [id, rank] of Object.entries(current)) out[id] = snapshot && snapshot[id] != null ? snapshot[id] - rank : 0;
  return out;
}

export function sessionStats(config, state) {
  const rates = rateOf(config);
  const per = Object.fromEntries(state.players.map(p => [p.id, blank()]));
  const games = {};
  const totals = { wheelSpins: 0, voids: 0, chaos: 0, games: 0, battles: 0, jailings: 0, turns: 0, goldWon: 0, goldLost: 0, loans: 0, defaults: 0, petBattles: 0 };
  const P = (id) => per[id];

  for (const r of state.ledger) {
    const s = r.playerId ? P(r.playerId) : null;
    switch (r.type) {
      case 'GAME': {
        if (!('won' in r) || !s) break;                       // tile-resolution rows share the type
        const stakeGold = (r.wagers || []).reduce((sum, w) => sum + Number(w.amount) * (rates[w.cur] ?? 0), 0);
        const net = stakeGold * (Number(r.mult) - 1);
        s.games++; totals.games++;
        if (r.won) s.wins++; else if (r.mult < 1) s.losses++; else s.pushes++;
        s.gameNet += net; s.biggestWager = Math.max(s.biggestWager, stakeGold);
        const g = games[r.gameId] || (games[r.gameId] = { id: r.gameId, plays: 0, wins: 0, losses: 0, pushes: 0, net: 0, biggestMult: 0 });
        g.plays++; if (r.won) g.wins++; else if (r.mult < 1) g.losses++; else g.pushes++;
        g.net += net; g.biggestMult = Math.max(g.biggestMult, Number(r.mult) || 0);
        break;
      }
      case 'CREDIT': if (s && r.cur === 'Gold') { s.biggestWin = Math.max(s.biggestWin, r.amount); totals.goldWon += r.amount; } break;
      case 'DEBIT':  if (s && r.cur === 'Gold') { s.biggestLoss = Math.min(s.biggestLoss, r.amount); totals.goldLost += -r.amount; } break;
      case 'JAIL_IN': if (s) s.jailed++; totals.jailings++; break;
      case 'JAIL_SPIN': if (s) { s.jailSpins++; s.wheelSpins++; } totals.wheelSpins++; break;
      case 'JAIL_BUYOUT': if (s) { s.buyouts++; s.buyoutGold += Number(r.fee) || 0; } break;
      case 'WHEEL_SPIN': if (s) s.wheelSpins++; totals.wheelSpins++; break;
      case 'VOID_TRIGGER': if (s) s.voids++; totals.voids++; break;
      case 'CHAOS': totals.chaos++; break;
      case 'TURN_END': totals.turns++; break;
      case 'BATTLE':
        if (r.won) { totals.battles++; if (s) s.battlesWon++; for (const w of r.pot || []) { const q = P(w.playerId); if (q) q.battles++; } }
        break;
      case 'SHOP_BUY_POWERUP': if (s) s.powerUpsBought++; break;
      case 'POWERUP_USED': if (s) s.powerUpsUsed++; break;
      case 'SHOP_EXCHANGE': if (s) s.shopTrades++; break;
      case 'PET_BATTLE': totals.petBattles++; if (s && r.won) s.petBattlesWon++; if (s && r.won && r.boss) s.bossesBeaten++; break;
      case 'LOAN': if (s) { s.loans++; s.borrowed += Number(r.principal) || 0; } totals.loans++; break;
      case 'LOAN_DEFAULT': if (s) s.defaults++; totals.defaults++; break;
    }
  }

  // Gold high/low water marks: walk each player's Gold backwards from today's balance.
  for (const p of state.players) {
    let g = p.balances.Gold || 0; const s = P(p.id); s.lowestGold = g; s.highestGold = g;
    for (let i = state.ledger.length - 1; i >= 0; i--) {
      const r = state.ledger[i];
      if (r.playerId !== p.id || r.cur !== 'Gold' || (r.type !== 'CREDIT' && r.type !== 'DEBIT')) continue;
      g -= r.amount; s.lowestGold = Math.min(s.lowestGold, g); s.highestGold = Math.max(s.highestGold, g);
    }
  }
  for (const s of Object.values(per)) { s.gameNet = Math.round(s.gameNet); s.winRate = s.games ? s.wins / s.games : null; }
  for (const g of Object.values(games)) g.net = Math.round(g.net);

  const table = standings(config, state);
  return { round: state.round, standings: table, players: per, games: Object.values(games).sort((a, b) => b.plays - a.plays), totals, awards: awards(state, per, table) };
}

// One winner per award; an award nobody earned is left out. Ties go to the higher-ranked player.
function awards(state, per, table) {
  const order = table.map(s => s.id);
  const name = (id) => state.players.find(p => p.id === id)?.name || '?';
  const best = (score, min = 1) => {
    let top = null;
    for (const id of order) { const v = score(per[id]); if (v != null && v >= min && (top === null || v > top.v)) top = { id, v }; }
    return top;
  };
  const list = [];
  const give = (key, emoji, title, pick, detail) => { if (pick) list.push({ key, emoji, title, playerId: pick.id, name: name(pick.id), detail: detail(pick.v, per[pick.id]) }); };
  if (table.length) list.push({ key: 'champion', emoji: '👑', title: 'Champion', playerId: table[0].id, name: table[0].name, detail: `${fmt(table[0].value)}g (${table[0].net >= 0 ? '+' : ''}${fmt(table[0].net)})` });
  give('bigwin', '💰', 'Biggest Single Win', best(s => s.biggestWin), v => `+${fmt(v)} Gold`);
  give('ouch', '💸', 'Ouch', best(s => -s.biggestLoss), v => `−${fmt(v)} Gold in one hit`);
  give('highroller', '🎩', 'High Roller', best(s => s.biggestWager), v => `wagered ${fmt(v)}g on one game`);
  give('hothand', '🔥', 'Hot Hand', best(s => (s.games >= 3 ? s.winRate : null), 0.5), (v, s) => `won ${s.wins} of ${s.games} games (${Math.round(v * 100)}%)`);
  give('jailbird', '🔒', 'Jailbird', best(s => s.jailed), v => `jailed ${v}×`);
  give('gladiator', '⚔️', 'Gladiator', best(s => s.battlesWon), v => `${v} battle${v === 1 ? '' : 's'} won`);
  give('voidtourist', '🌀', 'Void Tourist', best(s => s.voids), v => `${v} trip${v === 1 ? '' : 's'} through the Void`);
  give('shopaholic', '🛒', 'Shopaholic', best(s => s.powerUpsBought + s.shopTrades), v => `${v} shop purchase${v === 1 ? '' : 's'}`);
  give('beastmaster', '🐾', 'Beastmaster', best(s => s.petBattlesWon), (v, s) => `${v} pet battle${v === 1 ? '' : 's'} won${s.bossesBeaten ? `, ${s.bossesBeaten} boss${s.bossesBeaten === 1 ? '' : 'es'}` : ''}`);
  give('deadbeat', '🦈', 'Deadbeat', best(s => s.defaults), v => `defaulted on ${v} loan${v === 1 ? '' : 's'}`);
  give('rockbottom', '🕳️', 'Rock Bottom', best(s => (s.lowestGold < 0 ? -s.lowestGold : null)), v => `sank to −${fmt(v)} Gold`);
  if (table.length > 1) { const last = table.at(-1); list.push({ key: 'spoon', emoji: '🥄', title: 'Wooden Spoon', playerId: last.id, name: last.name, detail: `${fmt(last.value)}g` }); }
  return list;
}
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US');
