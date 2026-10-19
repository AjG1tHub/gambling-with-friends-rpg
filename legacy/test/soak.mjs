// Long soak run.  node test/soak.mjs [sessions=40] [turnsPerSession=400]
import { playSession } from './bot.mjs';
const sessions = Number(process.argv[2] || 40), turns = Number(process.argv[3] || 400);
const t0 = Date.now(); let actions = 0, rows = 0; const totals = {};
for (let seed = 1; seed <= sessions; seed++) {
  const r = playSession({ seed: seed * 7919, players: 2 + (seed % 5), turns, sideChance: 0.2 + (seed % 4) * 0.15 });
  actions += r.actions; rows += r.ledgerRows; for (const [k, v] of Object.entries(r.counts)) totals[k] = (totals[k] || 0) + v;
}
console.log(`soak ok: ${sessions} sessions × ${turns} turns → ${actions.toLocaleString()} checked actions, ${rows.toLocaleString()} ledger rows (${(rows / (sessions * turns)).toFixed(1)} per turn), ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
