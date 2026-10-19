// Quests (SPEC.md › RPG layer). A deck in data/quests.json: quests.perRun public ones dealt at RUN_START (on the TV),
// quests.personalPerPlayer secret ones per player (on the phone). Conditions are checked against counters this and
// the sibling modules keep on the character (c.questCounters) and state.stats, at every turnEnd for the mover and
// every roundEnd for everyone. Rewards: quests.goldReward × rewardMult and xp.quest through levelHooks.onXp.
//
// Events: QUEST_TAKE { questId, playerId? }   at a Bounty Board: reserve a public quest (only you can finish it)
//           (QUEST_TAKE needs adding to EVENTS in events.js; the handler is registered here)
//         GM_QUEST  { title, text, playerId?, rewardMult? }  add a hand-written quest (public, or personal for playerId)
//         GM_QUEST  { complete: questInstanceId, playerId }  mark a quest done for a player (manual quests)
// State: state.quests = { public: [Quest], personal: { playerId: [Quest] } }
//   Quest { id, questId, title, text, cond, pool, rewardMult, status: 'open'|'done', takenBy, doneBy, doneAt, ownerId }
// Counters read (c.questCounters.*): hits, hitsByRegion{regionId}, beaten{playerId}, killed{playerId}, bosses,
//   monsterKills, openChests, pactRepaid, innRests, auctionsWon, spins, bountiesCollected; c.visitedRegions{regionId};
//   state.stats[pid].petsCaught / lettersSent (pets and social modules increment those).
import questsData from '../../../data/quests.json' with { type: 'json' };
import { register, refuse, requireGm, requirePhase, requireActor } from '../reducer.js';
import { characterOf, activeSeats, note } from '../state.js';
import { gold } from '../health.js';
import { streamRng } from '../rng.js';
import { damageHooks, levelHooks } from '../hooks.js';
import { hooks as runHooks } from './run.js';
import { counter, regionOf, nameOf } from './wheels.js';

export const QUEST_DECK = questsData.quests;
const ROUND_END_ONLY = new Set(['holdGold', 'bankGold', 'surviveChaos', 'fullHealthRound']);
const seqId = (state) => `q${state.questSeq = (state.questSeq || 0) + 1}`;

function regionName(state, id) { return state.map?.regions?.[id]?.name || id; }
function instantiate(state, ctx, def, { ownerId = null, targetId = null } = {}) {
  const Q = ctx.B('quests');
  const cond = { ...def.cond };
  if (cond.key) cond.n = Q[cond.key];
  if (targetId) cond.targetId = targetId;
  const fill = (s) => String(s).replace('{n}', cond.n ?? '').replace('{target}', targetId ? nameOf(state, targetId) : 'someone').replace('{region}', cond.regionId ? regionName(state, cond.regionId) : '');
  return { id: seqId(state), questId: def.id, title: fill(def.title), text: fill(def.text), cond, pool: def.pool, rewardMult: def.rewardMult ?? 1, status: 'open', takenBy: null, doneBy: null, doneAt: null, ownerId };
}
export function dealQuests(state, ctx) {
  const Q = ctx.B('quests'), rng = streamRng(state, 'misc');
  const seats = activeSeats(state);
  state.quests = { public: [], personal: {} };
  const deck = rng.shuffle(QUEST_DECK);
  const used = new Set();
  for (const def of deck) {
    if (state.quests.public.length >= Q.perRun) break;
    if (def.pool === 'personal' || def.cond.type === 'manual') continue;
    if (def.cond.type === 'beatPlayer' || def.cond.type === 'killPlayer') continue;
    state.quests.public.push(instantiate(state, ctx, def)); used.add(def.id);
  }
  for (const pid of seats) {
    const mine = []; const others = seats.filter(p => p !== pid);
    for (const def of rng.shuffle(deck)) {
      if (mine.length >= Q.personalPerPlayer) break;
      if (def.pool === 'public' || used.has(def.id) || def.cond.type === 'manual') continue;
      const needsTarget = def.cond.type === 'beatPlayer' || def.cond.type === 'killPlayer';
      if (needsTarget && (!others.length || state.mode === 'pve')) continue;
      mine.push(instantiate(state, ctx, def, { ownerId: pid, targetId: needsTarget ? rng.pick(others) : null }));
    }
    state.quests.personal[pid] = mine;
  }
  note(state, `Quests posted: ${state.quests.public.map(q => q.title).join(' · ')}`, 'quest', ctx.now);
}
runHooks.runStart.push(dealQuests);

export function questMet(state, ctx, q, c) {
  const k = c.questCounters || {}, st = state.stats[c.playerId] || {}, cond = q.cond, n = cond.n ?? 1;
  switch (cond.type) {
    case 'hitsInRegion': return (k.hitsByRegion?.[cond.regionId] || 0) >= n;
    case 'holdGold': return (c.gold || 0) >= n;
    case 'bankGold': return (c.bank || 0) >= n;
    case 'beatPlayer': return !!(k.beaten?.[cond.targetId] || k.killed?.[cond.targetId]);
    case 'killPlayer': return !!k.killed?.[cond.targetId];
    case 'visitAllRegions': { const ids = Object.keys(state.map?.regions || {}); return ids.length > 0 && ids.every(id => c.visitedRegions?.[id]); }
    case 'visitRegion': return !!c.visitedRegions?.[cond.regionId];
    case 'bosses': return (k.bosses || 0) >= n;
    case 'monsterKills': return (k.monsterKills || 0) >= n;
    case 'petsCaught': return (st.petsCaught || 0) >= n;
    case 'lettersSent': return (st.lettersSent || 0) >= n;
    case 'surviveChaos': return !c.dead && (state.chaos?.tier || 1) >= n;
    case 'reachLevel': return (c.level || 1) >= n;
    case 'openChests': return (k.openChests || 0) >= n;
    case 'pactRepaid': return (k.pactRepaid || 0) >= n;
    case 'innRests': return (k.innRests || 0) >= n;
    case 'auctionsWon': return (k.auctionsWon || 0) >= n;
    case 'fullHealthRound': return !c.dead && (c.health || 0) >= (c.maxHealth || 0);
    case 'spins': return (k.spins || 0) >= n;
    case 'bountiesCollected': return (k.bountiesCollected || 0) >= n;
    default: return false;
  }
}
export function completeQuest(state, ctx, q, c) {
  const Q = ctx.B('quests'), X = ctx.B('xp');
  q.status = 'done'; q.doneBy = c.playerId; q.doneAt = ctx.now;
  const reward = Math.round(Q.goldReward * (q.rewardMult || 1));
  gold(state, c, reward, `quest: ${q.title}`, ctx); if (state.stats[c.playerId]) state.stats[c.playerId].goldEarned += reward;
  for (const h of levelHooks.onXp) h(state, ctx, { charId: c.id, amount: X.quest, why: `quest ${q.questId}` });
  counter(c, 'questsDone'); (c.quests ||= []).push(q.id);
  note(state, q.ownerId ? `${c.name} completes a personal quest (+${reward} Gold)` : `${c.name} completes "${q.title}" (+${reward} Gold)`, 'quest', ctx.now);
}
function checkFor(state, ctx, c, { roundEnd = false } = {}) {
  if (!c || !state.quests) return;
  const eligible = (q) => q.status === 'open' && (roundEnd || !ROUND_END_ONLY.has(q.cond.type)) && q.cond.type !== 'manual';
  for (const q of state.quests.public) if (eligible(q) && (!q.takenBy || q.takenBy === c.playerId) && questMet(state, ctx, q, c)) completeQuest(state, ctx, q, c);
  for (const q of state.quests.personal?.[c.playerId] || []) if (eligible(q) && questMet(state, ctx, q, c)) completeQuest(state, ctx, q, c);
}
runHooks.turnEnd.push((state, ctx, pid) => checkFor(state, ctx, characterOf(state, pid)));
runHooks.roundEnd.push((state, ctx) => { for (const pid of activeSeats(state)) checkFor(state, ctx, characterOf(state, pid), { roundEnd: true }); });

// Hits land through the fight module's damageHooks.afterHit: count them per region, and a hit on a character
// counts as beating them (a Challenge win is exactly one landed hit).
damageHooks.afterHit.push((state, ctx, info) => {
  const a = state.characters?.[info.attackerId]; if (!a) return;
  counter(a, 'hits'); const rid = regionOf(state, a);
  if (rid) { a.questCounters.hitsByRegion ||= {}; a.questCounters.hitsByRegion[rid] = (a.questCounters.hitsByRegion[rid] || 0) + 1; }
  if (info.targetKind === 'character') { const t = state.characters[info.targetId]; if (t && t.playerId) (a.questCounters.beaten ||= {})[t.playerId] = true; }
});

register({
  QUEST_TAKE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const c = characterOf(state, pid); if (!c) refuse('no character');
    const h = state.map?.hexes?.[c.pos]; if (!ctx.isGm && h?.type !== 'bounty') refuse('take quests at a Bounty Board', 'tile');
    const q = state.quests.public.find(x => x.id === ctx.payload.questId); if (!q || q.status !== 'open') refuse('no such open quest', 'quest');
    if (q.takenBy && q.takenBy !== pid) refuse(`${nameOf(state, q.takenBy)} already took it`, 'quest');
    q.takenBy = pid; note(state, `${c.name} takes the quest "${q.title}"`, 'quest', ctx.now);
  },
  GM_QUEST(state, ev, ctx) {
    requireGm(ctx);
    if (ctx.payload.complete) {
      const pid = ctx.payload.playerId; const c = characterOf(state, pid); if (!c) refuse('playerId required');
      const q = state.quests.public.find(x => x.id === ctx.payload.complete) || (state.quests.personal[pid] || []).find(x => x.id === ctx.payload.complete);
      if (!q || q.status !== 'open') refuse('no such open quest', 'quest');
      completeQuest(state, ctx, q, c); return;
    }
    const title = String(ctx.payload.title || '').slice(0, 60); if (!title) refuse('title required');
    const q = { id: seqId(state), questId: 'manual', title, text: String(ctx.payload.text || '').slice(0, 200), cond: { type: 'manual' }, pool: ctx.payload.playerId ? 'personal' : 'public', rewardMult: Number(ctx.payload.rewardMult) || 1, status: 'open', takenBy: null, doneBy: null, doneAt: null, ownerId: ctx.payload.playerId || null };
    if (q.ownerId) (state.quests.personal[q.ownerId] ||= []).push(q); else state.quests.public.push(q);
    note(state, q.ownerId ? `GM whispers a quest to ${nameOf(state, q.ownerId)}` : `GM posts a quest: "${title}"`, 'quest', ctx.now);
  },
});
