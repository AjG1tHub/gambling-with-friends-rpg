// The metagame ledger and the Hall of Fame row for a run (SPEC.md › Runs, End of the run). When the run ends
// (any path: endCheck, RUN_END, GM_END_RUN) the reducer's after-hook sees phase 'ended' once and fills one
// state.metaLedger row per seated player — mode, placing, character, what was vaulted (c.vaulted, left to the
// modes module), the real buy-in the GM typed with META_LEDGER — and pushes one Hall of Fame row. It is a
// record, not a wallet: nothing here moves money.
//
// Placings: the winner first; then survivors by Free-for-all score (gold + gold.scorePerKill × kills + health);
// then the dead, the one who lasted longest first. state.metaLedgerFinal guards against running twice.
import { onAfter } from '../reducer.js';
import { activeSeats, characterOf, note } from '../state.js';
import { scoreOf } from './economy.js';

export function placings(state, ctx) {
  const seats = activeSeats(state);
  const rows = seats.map(pid => { const c = characterOf(state, pid); return { pid, c, score: c ? scoreOf(state, ctx, c) : 0, dead: !c || !!c.dead, diedAt: c?.diedAt || 0 }; });
  const winners = new Set(Array.isArray(state.winner) ? state.winner : state.winner ? [state.winner] : []);
  const teamWinner = state.winner && state.gm.teams?.[state.winner] ? state.winner : null;
  const isWinner = (r) => winners.has(r.pid) || (teamWinner && state.players[r.pid]?.teamId === teamWinner);
  rows.sort((a, b) => {
    const wa = isWinner(a) ? 1 : 0, wb = isWinner(b) ? 1 : 0; if (wa !== wb) return wb - wa;
    if (a.dead !== b.dead) return a.dead ? 1 : -1;
    if (!a.dead) return b.score - a.score;
    return b.diedAt - a.diedAt;
  });
  return rows.map((r, i) => ({ ...r, placing: i + 1, winner: isWinner(r) }));
}

export function finalizeLedger(state, ctx) {
  if (state.metaLedgerFinal) return;
  const rows = placings(state, ctx);
  for (const r of rows) {
    const p = state.players[r.pid], c = r.c, st = state.stats[r.pid] || {};
    let row = state.metaLedger.find(x => x.playerId === r.pid);
    if (!row) { row = { playerId: r.pid, buyIn: '', notes: '' }; state.metaLedger.push(row); }
    Object.assign(row, {
      name: p?.name || r.pid, mode: state.mode, tier: state.tier, size: state.size, roomCode: state.code, placing: r.placing, winner: r.winner,
      characterId: c?.id || null, characterName: c?.name || null, classId: c?.classId || null, level: c?.level || null,
      survived: !r.dead, kills: c?.kills || 0, deaths: c?.deaths || 0, gold: c?.gold || 0, bank: c?.bank || 0, health: c?.dead ? 0 : c?.health || 0, score: r.score,
      bosses: st.bosses || 0, petsCaught: st.petsCaught || 0, vaulted: c?.vaulted ? [...c.vaulted] : [], endedAt: state.endedAt, ts: ctx.now,
    });
  }
  const longest = rows.filter(r => r.c).sort((a, b) => (b.c.turnsTaken || 0) - (a.c.turnsTaken || 0))[0];
  state.hallOfFame.push({
    roomId: state.roomId, code: state.code, mode: state.mode, tier: state.tier, size: state.size, startedAt: state.startedAt, endedAt: state.endedAt, rounds: state.round,
    winner: state.winner, endReason: state.endReason || '', players: rows.map(r => ({ playerId: r.pid, name: state.players[r.pid]?.name, characterName: r.c?.name || null, placing: r.placing, survived: !r.dead, kills: r.c?.kills || 0, level: r.c?.level || null })),
    kills: rows.reduce((s, r) => s + (r.c?.kills || 0), 0), bossesBeaten: Object.values(state.monsters).filter(m => m.dead && (m.boss || m.raid || m.final)).length,
    finalBossDead: !!state.finalBossDeadBy, petsCaught: Object.values(state.stats).reduce((s, x) => s + (x.petsCaught || 0), 0), legendariesDropped: state.legendariesDropped || 0,
    longestLived: longest ? { characterName: longest.c.name, turns: longest.c.turnsTaken || 0 } : null, chaosTier: state.chaos?.tier || 1,
  });
  state.metaLedgerFinal = true;
  note(state, `Ledger closed: ${rows.map(r => `${r.placing}. ${state.players[r.pid]?.name}`).join(' · ')}`, 'end', ctx.now);
}

onAfter((state, ev, ctx) => { if (state.phase === 'ended' && !state.metaLedgerFinal) finalizeLedger(state, ctx); });
