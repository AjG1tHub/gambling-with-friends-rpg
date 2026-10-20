// Bot runs: whole runs played in-process by the shared bot policy, with the runner acting as the TV (monster
// turns, deadlines). Reports length in turns and simulated minutes, deaths, Health curves, item counts and stalls.
//
//   node tools/bots.mjs                       one 4-bot Free-for-all, verbose
//   node tools/bots.mjs --mode pve --bots 6   one run
//   node tools/bots.mjs --suite               the CI matrix: 4 and 8 bots in every mode; fails on a stall or a run over two simulated hours at 4–6 bots
//   node tools/bots.mjs --json out.json       write the report
import '../packages/shared/index.js';
import { applyEvent, EVENTS } from '../packages/shared/index.js';
import { makeEvent } from '../packages/shared/events.js';
import { makeRng } from '../packages/shared/rng.js';
import { currentPlayerId, characterOf } from '../packages/shared/state.js';
import { nextAction, tableDuties } from '../packages/shared/bot.js';
import { writeFileSync } from 'node:fs';

// Simulated time: every event advances the clock a little, a move or a fight step more, so chess clocks and
// deadlines behave as they would at a real table (about 20 s of thinking per phone action).
const COST_MS = { default: 4000, MOVE_STEP: 2500, ITEM_RESOLVE: 15000, CHAR_STAT_GAMBLE: 20000, MONSTER_ACT: 12000, TURN_END: 3000, PLAYER_READY: 1000, CHALLENGE_STEP: 6000, CHALLENGE_REPORT: 45000 };

export function runGame({ bots = 4, mode = 'ffa', tier = 1, size = 'regular', seed = 1, maxEvents = 30000, maxSimMs = 2 * 3600 * 1000 * 2, verbose = false, aggression = 0.5 } = {}) {
  let now = 1_700_000_000_000, seq = 0;
  const rng = makeRng(seed * 7919 + 17);
  const recent = [];
  const apply = (type, payload, actor) => {

    const ev = { ...makeEvent(type, payload, { actor, ts: now }), seq: ++seq };
    recent.push(`${type}@${actor}${type === 'ITEM_USE' || type === 'MONSTER_ACT' || type === 'ITEM_RESOLVE' ? JSON.stringify(payload).slice(0, 60) : ''}`); if (recent.length > 14) recent.shift();
    const before = state;
    state = applyEvent(state, ev, { clone: false, strict: false });
    const err = state.lastError && state.lastError.ts === now && state.lastError.type === type ? state.lastError : null;
    now += COST_MS[type] || COST_MS.default;
    return { err, state, before };
  };
  let state = applyEvent({}, { ...makeEvent('ROOM_CREATED', { roomId: 'bots', code: 'BOTS', seed, mode, tier, size, gmPinHash: 'x' }, { actor: 'gm', ts: now }), seq: ++seq }, { clone: false, strict: true });
  const ids = [];
  for (let i = 0; i < bots; i++) { const id = 'bot' + i; ids.push(id); apply('PLAYER_JOIN', { playerId: id, name: 'Bot ' + i, deviceId: 'dev' + i }, 'system'); }
  if (mode === 'teams') { const teams = {}; ids.forEach((id, i) => { const t = 't' + (i % 2); (teams[t] ||= { name: 'Team ' + (i % 2 + 1), members: [] }).members.push(id); }); apply('GM_SET_TEAMS', { teams }, 'gm'); }
  apply('CREATION_OPEN', {}, 'gm');
  const refusals = {}, counts = {}, curve = [];
  let stalls = 0, lastProgress = 0, stallWitness = null;
  const t0 = now;
  for (let guard = 0; guard < maxEvents && state.phase !== 'ended' && now - t0 < maxSimMs; guard++) {
    let acted = false;
    // creation: everyone acts; playing: the mover first, then everyone else (prompts, challenges, area windows)
    if (state.phase === 'creation' || state.phase === 'lobby') {
      for (const id of ids) { const a = nextAction(state, id, rng, now, { aggression }); if (a) { const r = apply(a.type, a.payload, a.actor); counts[a.type] = (counts[a.type] || 0) + 1; if (r.err) (refusals[a.type + ': ' + r.err.message] ||= 0), refusals[a.type + ': ' + r.err.message]++; acted = true; } }
      if (!acted && (state.phase === 'creation' || state.phase === 'lobby')) { const r = apply('RUN_START', {}, 'gm'); if (r.err) { stallWitness = 'RUN_START refused: ' + r.err.message; break; } acted = true; }
    } else {
      for (const a of tableDuties(state, rng, now)) { const r = apply(a.type, a.payload, a.actor); counts[a.type] = (counts[a.type] || 0) + 1; if (r.err) (refusals[a.type + ': ' + r.err.message] ||= 0), refusals[a.type + ': ' + r.err.message]++; else acted = true; }
      const order = [currentPlayerId(state), ...ids.filter(id => id !== currentPlayerId(state))].filter(Boolean);
      for (const id of order) {
        const a = nextAction(state, id, rng, now, { aggression }); if (!a) continue;
        const r = apply(a.type, a.payload, a.actor); counts[a.type] = (counts[a.type] || 0) + 1;
        if (r.err) { const k = a.type + ': ' + r.err.message; refusals[k] = (refusals[k] || 0) + 1; } else acted = true;
        if (a.type === 'TURN_END' || a.type === 'TURN_TIMEOUT') break;
      }
    }
    if (acted) lastProgress = guard;
    else if (guard - lastProgress > 40) { stalls++; stallWitness = describeStall(state) + ' recent=[' + recent.join(' > ') + ']'; if (verbose) console.error('STALL', stallWitness); apply('TURN_END', {}, 'gm'); lastProgress = guard; if (stalls > 25) break; }
    if (state.phase === 'playing' && state.turnIdx % Math.max(1, ids.length) === 0 && curve.length < state.round) curve.push({ round: state.round, simMin: Math.round((now - t0) / 60000), health: ids.map(id => characterOf(state, id)?.health ?? null), gold: ids.map(id => characterOf(state, id)?.gold ?? null) });
  }
  if (state.phase !== 'ended') apply('GM_END_RUN', { reason: 'runner cap' }, 'gm');
  const chars = ids.map(id => characterOf(state, id)).filter(Boolean);
  return {
    mode, bots, seed, turns: state.turnIdx, rounds: state.round, simMinutes: Math.round((now - t0) / 60000), events: seq, ended: state.endReason, winner: state.winner && (characterOf(state, state.winner)?.name || state.winner),
    deaths: chars.reduce((n, c) => n + (c.deaths || 0), 0), kills: chars.reduce((n, c) => n + (c.kills || 0), 0),
    monstersDead: Object.values(state.monsters).filter(m => m.dead).length, monstersTotal: Object.keys(state.monsters).length,
    items: chars.map(c => Object.keys(c.items || {}).length), levels: chars.map(c => c.level), stalls, stallWitness, counts, refusals, curve: curve.slice(0, 60),
    legendaries: state.legendariesDropped || 0, challenges: state.challengeHistory?.length || 0, letters: state.letters.length,
  };
}
function describeStall(state) {
  const pid = currentPlayerId(state), c = characterOf(state, pid);
  const f = state.fight, m = f && state.monsters[f.monsterId];
  const extra = c ? ` hp=${c.health}/${c.maxHealth} used=${JSON.stringify(c.usedThisTurn)} worn=${Object.entries(c.worn || {}).filter(([, v]) => v).map(([k, v]) => `${k}:${v.gameId || v.baseId}/${v.charges}/${v.stake}`).join(',')} fightPlayer=${f?.playerId} game=${f?.game ? `${f.game.gameId}/res=${!!f.game.result}/by=${f.game.attackerPlayerId}` : 'none'} monster=${m ? `${m.name} hp=${m.health} dead=${m.dead} pos=${m.pos} items=${m.items?.length}` : 'none'}` : '';
  const tail = state.log.slice(-6).map(l => l.text).join(' | ');
  return `phase=${state.phase} turnPhase=${state.turnPhase} mover=${pid} dead=${c?.dead} pos=${c?.pos}${extra} log=[${tail}] fight=${state.fight ? `${state.fight.kind}/${state.fight.turn}/done=${state.fight.done}` : 'none'} prompt=${state.pendingPrompt ? state.pendingPrompt.kind + '@' + state.pendingPrompt.playerId : 'none'} challenge=${state.challenge ? (state.challenge.done ? 'done' : (state.challenge.spun ? 'spun' : 'unspun')) : 'none'} held=${Object.keys(state.held).join(',')} area=${state.area ? !state.area.done : 'none'} lastError=${state.lastError?.message || ''}`;
}

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (process.argv[1] && process.argv[1].endsWith('bots.mjs')) {
  const suite = args.includes('--suite');
  const matrix = suite ? [['ffa', 4], ['ffa', 8], ['pvp', 4], ['pvp', 8], ['pve', 4], ['pve', 8], ['teams', 4], ['teams', 8], ['royale', 4], ['royale', 6]] : [[flag('mode', 'ffa'), Number(flag('bots', 4))]];
  const reports = []; let failed = false;
  for (const [mode, bots] of matrix) {
    const t = Date.now();
    const r = runGame({ mode, bots, seed: Number(flag('seed', 1)), size: flag('size', 'regular'), tier: Number(flag('tier', 1)), verbose: !suite });
    r.wallMs = Date.now() - t; reports.push(r);
    const tooLong = bots <= 6 && r.simMinutes > 120 && !r.ended?.includes('cap') ? false : (bots <= 6 && r.simMinutes > 120);
    const bad = r.stalls > 0 || tooLong || (r.ended || '').includes('runner cap');
    if (bad) failed = true;
    console.log(`${bad ? '✗' : '✓'} ${mode} ×${bots}: ${r.turns} turns / ${r.rounds} rounds / ${r.simMinutes} sim-min / ${r.events} events in ${r.wallMs} ms · ended: ${r.ended} · winner ${r.winner || '—'} · deaths ${r.deaths} kills ${r.kills} · monsters ${r.monstersDead}/${r.monstersTotal} · items ${r.items.join('/')} · levels ${r.levels.join('/')} · challenges ${r.challenges} · stalls ${r.stalls}${r.stallWitness ? ' — ' + r.stallWitness : ''}`);
    const top = Object.entries(r.refusals).sort((a, b) => b[1] - a[1]).slice(0, 6); if (top.length) console.log('   refusals:', top.map(([k, v]) => `${v}× ${k}`).join(' | '));
  }
  if (flag('json')) writeFileSync(flag('json'), JSON.stringify(reports, null, 2));
  if (suite && failed) { console.error('bot suite: a run stalled or ran too long'); process.exit(1); }
}
