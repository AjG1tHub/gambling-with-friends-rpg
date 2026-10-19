// Raids (Phase 7) — co-op boss fights. Two to six players send their active pets against one
// boss that scales with the party. Same d20 rules, moves and statuses as 1-v-1 pet battles
// (execMove); the boss gets one action for every two party members and picks its targets.
// state.raid = { id, boss, party[], order[], turnIdx, round, phase, winner, log[], rewards[] }
import { log, credit } from './state.js';
import { mod, activePet, petsOf, addXp } from './pets.js';
import { execMove, bossChoice, battleRules, bossList, fighterFromPet, fighterFromBoss, d, say, STATUS, DEFAULT_BOSSES } from './petbattle.js';

export const RAID_DEFAULTS = { minParty: 2, maxParty: 6, hpPerMember: 0.75, goldShare: 0.6, maxRounds: 40 };
export const raidRules = (config) => ({ ...RAID_DEFAULTS, ...(config?.Raid || {}) });
// Raid-only bosses sit on top of the normal boss list.
export const RAID_BOSSES = [
  { id: 'jackpothydra', name: 'The Jackpot Hydra', emoji: '🐍', element: 'Water', level: 8,  stats: { str: 18, dex: 12, con: 18, int: 14, wis: 13, cha: 12 }, rewardGold: 1200, raidOnly: true },
  { id: 'thehouse',     name: 'THE HOUSE',        emoji: '🏛️', element: 'Shadow', level: 15, stats: { str: 20, dex: 14, con: 20, int: 20, wis: 18, cha: 20 }, rewardGold: 3000, raidOnly: true },
];
export function raidBossList(config) { const extra = Array.isArray(config?.RaidBosses) && config.RaidBosses.length ? config.RaidBosses : RAID_BOSSES; return [...bossList(config), ...extra]; }

const alive = (r) => r.party.filter(f => f.hp > 0);
export const raidActor = (r) => r.order[r.turnIdx] === 'boss' ? r.boss : r.party.find(f => f.side === r.order[r.turnIdx]);

export function startRaid(config, state, rng, { playerIds, bossId }) {
  if ((state.raid && state.raid.phase === 'active') || (state.petBattle && state.petBattle.phase === 'active')) return { error: true, text: 'A pet battle is already running.' };
  const R = raidRules(config);
  const boss = raidBossList(config).find(b => b.id === bossId); if (!boss) return { error: true, text: 'No such raid boss.' };
  const ids = [...new Set(playerIds || [])]; const party = [], skipped = [];
  for (const id of ids) {
    const pl = state.players.find(p => p.id === id); if (!pl) continue;
    const pet = activePet(pl);
    if (!pet || pet.fainted || pet.hp <= 0) { skipped.push(pl.name); continue; }
    const f = fighterFromPet(pl, pet); f.side = 'm' + party.length; f.init = d(rng, 20) + mod(f.stats.dex); party.push(f);
  }
  if (party.length < R.minParty) return { error: true, text: `A raid needs at least ${R.minParty} healthy pets${skipped.length ? ` (${skipped.join(', ')} can't fight)` : ''}.` };
  if (party.length > R.maxParty) return { error: true, text: `At most ${R.maxParty} pets can raid together.` };
  const bf = fighterFromBoss(config, boss); bf.side = 'boss';
  bf.hpMax = Math.round(bf.hpMax * (1 + R.hpPerMember * (party.length - 1))); bf.hp = bf.hpMax; bf.mends = 1 + Math.floor(party.length / 3);
  // Initiative order; the boss takes a slot after every second party member (at least one).
  const sorted = [...party].sort((a, b) => b.init - a.init || b.stats.dex - a.stats.dex);
  const order = []; sorted.forEach((f, i) => { order.push(f.side); if (i % 2 === 1) order.push('boss'); });
  if (order.at(-1) !== 'boss') order.push('boss');
  state.petBattleSeq = (state.petBattleSeq || 0) + 1;
  const raid = { id: 'raid' + state.petBattleSeq, kind: 'raid', boss: bf, party, order, turnIdx: 0, round: 1, phase: 'active', winner: null, log: [], startedTs: Date.now(), rewardGold: Number(boss.rewardGold) || 0 };
  say(raid, `RAID! ${party.map(f => `${f.emoji} ${f.name}`).join(', ')} take on ${bf.emoji} ${bf.name} (${bf.hpMax} HP).`, { kind: 'start' });
  if (skipped.length) say(raid, `${skipped.join(', ')} sit this one out (no healthy pet).`, { kind: 'info' });
  state.raid = raid;
  log(state, 'RAID_START', null, { raidId: raid.id, boss: boss.id, players: party.map(f => f.playerId) });
  settleUpcoming(config, state, rng);
  return { raid, text: raid.log[0].text };
}

// Who does the boss hit? Usually whoever is hurting most; sometimes just anyone.
export function bossTarget(raid, rng) {
  const live = alive(raid); if (!live.length) return null;
  if (rng.chance(0.4)) return live[rng.int(0, live.length - 1)];
  return [...live].sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax)[0];
}

// Advance to the next actor that can act, resolving start-of-turn burn / shock, boss turns and the end of the fight.
function nextTurn(config, state, rng) {
  const r = state.raid, R = raidRules(config);
  for (let guard = 0; guard < 60 && r.phase === 'active'; guard++) {
    r.turnIdx += 1;
    if (r.turnIdx >= r.order.length) { r.turnIdx = 0; r.round += 1; if (r.round > R.maxRounds) return finishRaid(config, state, rng, false, 'The raid runs out of time.'); }
    const actor = raidActor(r);
    if (!actor || actor.hp <= 0) continue;
    if (actor.status?.id === 'burn') {
      const burn = d(rng, 4); actor.hp = Math.max(0, actor.hp - burn); say(r, `🔥 ${actor.name} takes ${burn} burn damage.`, { kind: 'hit' });
      if (checkEnd(config, state, rng)) return; if (actor.hp <= 0) continue;
    }
    if (actor.status?.id === 'shock') { say(r, `⚡ ${actor.name} is shocked and loses its turn!`, { kind: 'miss' }); actor.status = null; continue; }
    if (actor.isBoss) { bossAct(config, state, rng); if (r.phase !== 'active') return; continue; }
    return;                                                     // a player's pet is up — wait for the GM
  }
}
// Called once at the start so a boss that wins initiative acts before anyone is asked for a move.
function settleUpcoming(config, state, rng) { const r = state.raid; r.turnIdx = -1; nextTurn(config, state, rng); }

function wearDown(r, f) { if (f.status && f.status.id !== 'shock') { f.status.turns -= 1; if (f.status.turns <= 0) { say(r, `${f.name} is no longer ${STATUS[f.status.id].name.toLowerCase()}.`, { kind: 'info' }); f.status = null; } } }
function bossAct(config, state, rng) {
  const r = state.raid, R = battleRules(config), boss = r.boss;
  const target = bossTarget(r, rng); if (!target) return;
  let moveId = bossChoice({ a: boss, b: target, turn: 'a' }, rng);
  let ex = execMove(r, R, rng, boss, target, moveId); if (ex.error) ex = execMove(r, R, rng, boss, target, 'strike');
  if (target.hp <= 0) say(r, `💫 ${target.name} faints!`, { kind: 'info' });
  wearDown(r, boss); checkEnd(config, state, rng);
}
function checkEnd(config, state, rng) {
  const r = state.raid;
  if (r.boss.hp <= 0) { finishRaid(config, state, rng, true, `${r.boss.name} is defeated!`); return true; }
  if (!alive(r).length) { finishRaid(config, state, rng, false, 'The whole party has fainted.'); return true; }
  return false;
}

// The pet whose turn it is uses a move (attacks hit the boss; Guard and Mend are on itself).
export function raidAction(config, state, rng, moveId) {
  const r = state.raid; if (!r || r.phase !== 'active') return { error: true, text: 'No raid is running.' };
  const me = raidActor(r); if (!me || me.isBoss) return { error: true, text: 'It is the boss\'s turn.' };
  const ex = execMove(r, battleRules(config), rng, me, r.boss, moveId); if (ex.error) return ex;
  wearDown(r, me);
  if (!checkEnd(config, state, rng)) nextTurn(config, state, rng);
  return { text: ex.text, finished: r.phase === 'done' };
}

function finishRaid(config, state, rng, partyWon, why) {
  const r = state.raid, B = battleRules(config), R = raidRules(config);
  r.phase = 'done'; r.winner = partyWon ? 'party' : 'boss'; r.endedTs = Date.now();
  say(r, `🏆 ${why} ${partyWon ? 'The raid party wins!' : `${r.boss.name} wins.`}`, { kind: 'end' });
  const notes = []; const share = partyWon ? Math.round(r.rewardGold * R.goldShare) : 0;
  for (const f of r.party) {
    const owner = state.players.find(p => p.id === f.playerId); const pet = owner && petsOf(owner).find(p => p.id === f.petId); if (!pet) continue;
    pet.hp = Math.max(0, Math.min(pet.hpMax, f.hp)); pet.fainted = pet.hp <= 0;
    if (partyWon) pet.wins = (pet.wins || 0) + 1; else pet.losses = (pet.losses || 0) + 1;
    const xp = partyWon ? B.winXpBase + B.winXpPerLevel * r.boss.level : B.loseXp;
    const ups = addXp(config, state, rng, owner, pet, xp);
    if (partyWon) { credit(state, owner, 'Gold', share, `Raid: ${r.boss.name}`); log(state, 'PET_BATTLE', owner.id, { battleId: r.id, kind: 'raid', boss: true, raid: true, won: true, winner: 'party', loser: r.boss.name, rounds: r.round }); }
    notes.push(`${owner.name}: ${partyWon ? `+${share} Gold, ` : ''}${pet.name} +${xp} XP${ups.length ? ` → L${pet.level}` : ''}`);
  }
  if (!partyWon) log(state, 'PET_BATTLE', null, { battleId: r.id, kind: 'raid', boss: true, raid: true, won: false, winner: r.boss.name, rounds: r.round });
  r.rewards = notes;
  log(state, 'RAID_END', null, { raidId: r.id, won: partyWon, rounds: r.round });
}

export function clearRaid(state) { const had = !!state.raid; state.raid = null; return had; }
