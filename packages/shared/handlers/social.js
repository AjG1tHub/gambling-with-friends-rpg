// PvP and social (SPEC.md › PvP and social): letters that travel like post, alliances by letter, secret votes,
// emotes over the avatar, and side bets for the people not in the fight.
//
//   LETTER_SEND       { toId, text, kind?: 'letter'|'alliance' }   as many as you like on your turn, social.lettersOffTurn otherwise
//   LETTER_INTERCEPT  { letterId, action: 'pass'|'destroy'|'forge', forgedText? }
//   ALLIANCE_PROPOSE  { toId, text? }                               = LETTER_SEND with kind 'alliance'
//   ALLIANCE_ANSWER   { letterId, accept } | { allianceId, accept: false }
//   VOTE_OPEN         { kind: 'chaos'|'table', options?, deadline?, question? }
//   VOTE_CAST         { choice }                                     secret: the TV shows only how many have voted
//   VOTE_CLOSE        {}                                             the TV at the deadline or when everyone voted; the GM any time
//   EMOTE             { emoji?, text? }
//   SIDE_BET          { challengeId? | fightId, onId, amount }       spectators and bystanders only, Health stake, even money
//
// Delivery: a letter arrives at the start of the recipient's social.letterDelayTurns-th turn after it was sent
// (counted in state.turnCounts, this module's own per-player turn counter). While in transit it can be read by
// a player standing on the courier hex (state.map.courier), and by a Spyglass holder or a Cutpurse (readsLetters)
// when it "crosses their tile": the sender or the recipient stands on or next to them (hex distance ≤ 1). A sender
// wearing the Impostor's Visor seals their letters: nobody can intercept them.
import { register, refuse, requireGm, requirePhase, requireActor, requirePlayer, onAfter } from '../reducer.js';
import { activeSeats, currentPlayerId, characterOf, note } from '../state.js';
import { hooks as runHooks } from './run.js';
import { streamRng } from '../rng.js';
import * as hex from '../hex.js';
import { health } from '../health.js';
import { letterHooks, runMods } from '../hooks.js';
import { challengeHooks } from './challenge.js';

// The economy module pushes its Chaos-victim effect here: (state, ctx, vote) with vote.result the chosen option.
export const voteHooks = { onClose: [] };
export const sideBetHooks = { onSettle: [] };   // (state, ctx, { bet, won })

const charOf = (state, pid) => characterOf(state, pid);
const nameOf = (state, pid) => state.players[pid]?.name || pid;
const hasUpgrade = (c, id) => Array.isArray(c?.upgrades) ? c.upgrades.includes(id) : !!c?.upgrades?.[id];
const wearsVisor = (c) => c?.worn?.helmet?.legendaryId === 'impostorsvisor';
const hasSpyglass = (c) => Object.values(c?.items || {}).some(it => it && (it.baseId === 'spyglass' || it.id === 'spyglass' || (it.slot === 'tool' && /spyglass/i.test(it.name || ''))));
const readsLetters = (c) => c?.classId === 'cutpurse' || hasUpgrade(c, 'readsLetters');
const canForge = (c, X) => c?.classId === 'cutpurse' && (hasUpgrade(c, 'forge') || (c.level || 0) >= X.upgradeLevels[0]);   // Forge is the level-5 Cutpurse upgrade
const inTransit = (l) => !l.deliveredAt && !l.destroyed;
const dist = (a, b) => (a?.pos && b?.pos ? hex.distance(hex.parse(a.pos), hex.parse(b.pos)) : Infinity);
const stat = (state, pid, k, n = 1) => { const s = state.stats[pid]; if (s) s[k] = (s[k] || 0) + n; };

// ---------------------------------------------------------------- letters
export function letterOf(state, id) { return state.letters.find(l => l.id === id) || null; }
// Letters a player may read on the way: all in-transit letters from the courier hex; those crossing their tile
// with a Spyglass or the Cutpurse passive. Never their own, never sealed ones, never one already intercepted.
export function interceptable(state, playerId) {
  const c = charOf(state, playerId); if (!c || c.dead) return [];
  const onCourier = !!state.map?.courier && c.pos === state.map.courier;
  const spy = hasSpyglass(c) || readsLetters(c);
  if (!onCourier && !spy) return [];
  return state.letters.filter(l => inTransit(l) && !l.sealed && !l.intercepted && l.fromId !== playerId && l.toId !== playerId && (onCourier || (spy && (dist(c, charOf(state, l.fromId)) <= 1 || dist(c, charOf(state, l.toId)) <= 1))));
}
export function inbox(state, playerId) { return state.letters.filter(l => l.toId === playerId && l.deliveredAt && !l.destroyed); }
export function outbox(state, playerId) { return state.letters.filter(l => l.fromId === playerId).map(l => ({ ...l, intercepted: null, destroyed: undefined })); }

function sendLetter(state, ctx, fromId, { toId, text, kind = 'letter' }) {
  requirePhase(state, 'playing'); requireActor(state, ctx, fromId);
  const from = requirePlayer(state, fromId), to = requirePlayer(state, toId);
  if (from.spectator) refuse('spectators have no crow'); if (to.spectator) refuse('that player is only watching');
  if (fromId === toId) refuse('a letter to yourself');
  const S = ctx.B('social'), body = String(text || '').trim().slice(0, S.letterMaxChars);
  if (!body && kind !== 'alliance') refuse('an empty letter');
  state.offTurnLetters ||= {}; state.turnCounts ||= {};
  if (currentPlayerId(state) !== fromId) { if ((state.offTurnLetters[fromId] || 0) >= S.lettersOffTurn) refuse(`only ${S.lettersOffTurn} letter(s) off your turn`, 'limit'); state.offTurnLetters[fromId] = (state.offTurnLetters[fromId] || 0) + 1; }
  const letter = { id: ctx.event?.id || `l${state.letters.length + 1}`, fromId, toId, text: body || 'Shall we work together?', kind, sentAt: ctx.now, sentTurnIdx: state.turnIdx, deliverAfterTurns: S.letterDelayTurns, recipientTurnsAtSend: state.turnCounts[toId] || 0, deliveredAt: null, intercepted: null, read: false, sealed: wearsVisor(charOf(state, fromId)), destroyed: false, answered: false };
  state.letters.push(letter); stat(state, fromId, 'lettersSent');
  note(state, `A crow takes flight from ${nameOf(state, fromId)}`, 'letter', ctx.now);
  return letter;
}
function deliverDue(state, ctx, pid) {
  const n = state.turnCounts[pid] || 0;
  for (const l of state.letters) {
    if (l.toId !== pid || !inTransit(l) || n - l.recipientTurnsAtSend < l.deliverAfterTurns) continue;
    l.deliveredAt = ctx.now;
    runMods(letterHooks.onDeliver, state, ctx, { letter: l });
  }
}

// ---------------------------------------------------------------- votes
export function voteView(state, playerId = null) {
  const v = state.votes; if (!v) return null;
  return { id: v.id, kind: v.kind, question: v.question, options: v.options, deadline: v.deadline, cast: Object.keys(v.ballots).length, eligible: v.eligible.length, myChoice: playerId ? v.ballots[playerId] ?? null : undefined, canVote: !!playerId && v.eligible.includes(playerId) && !v.closed };
}
function closeVote(state, ctx, why) {
  const v = state.votes; if (!v) return;
  const tally = {}; for (const o of v.options) tally[o] = 0; for (const ch of Object.values(v.ballots)) tally[ch] = (tally[ch] || 0) + 1;
  const top = Math.max(0, ...Object.values(tally)); const tied = v.options.filter(o => tally[o] === top && top > 0);
  v.result = tied.length === 0 ? null : tied.length === 1 ? tied[0] : streamRng(state, 'misc').pick(tied);
  v.tally = tally; v.closed = true; v.closedAt = ctx.now; v.closedBy = why;
  if (v.kind === 'table') {
    const c = v.result ? charOf(state, v.result) : null;
    if (c && !c.dead) { const D = ctx.B('death'); c.dead = true; c.missTurns = D.monsterMissTurns; c.diedTo = null; c.deaths = (c.deaths || 0) + 1; stat(state, v.result, 'deaths'); note(state, `The table votes ${nameOf(state, v.result)} into the Graveyard (${top} of ${Object.keys(v.ballots).length})`, 'vote', ctx.now); }
    else note(state, 'The table vote sends nobody to the Graveyard', 'vote', ctx.now);
  } else {
    note(state, v.result ? `Chaos chooses ${state.players[v.result]?.name || v.result} by vote` : 'The Chaos vote names nobody', 'vote', ctx.now);
    for (const h of voteHooks.onClose) h(state, ctx, v);
  }
  state.lastVote = v; state.votes = null;
}

// ---------------------------------------------------------------- side bets
export function settleSideBets(state, ctx, kind, refId, winnerId) {
  for (const b of state.sideBets) {
    if (b.settled || b.kind !== kind || b.refId !== refId) continue;
    b.settled = true; b.settledAt = ctx.now;
    if (!winnerId) { b.won = null; continue; }
    b.won = b.onId === winnerId;
    const c = charOf(state, b.playerId);
    if (c && !c.dead) { if (b.won) health(state, c, b.amount, 'side bet won', ctx); else health(state, c, -Math.min(b.amount, Math.max(0, c.health - 1)), 'side bet lost', ctx); }
    else b.recordOnly = true;
    note(state, `${nameOf(state, b.playerId)} ${b.won ? 'wins' : 'loses'} a ${b.amount} side bet on ${nameOf(state, b.onId)}`, 'bet', ctx.now);
    for (const h of sideBetHooks.onSettle) h(state, ctx, { bet: b, won: b.won });
  }
}
challengeHooks.onSettle.push((state, ctx, { challenge, winnerId }) => settleSideBets(state, ctx, 'challenge', challenge.id, winnerId));
onAfter((state, ev, ctx) => {
  const open = state.sideBets.filter(b => !b.settled && b.kind === 'fight'); if (!open.length) return;
  const f = state.fight;
  for (const b of open) {
    if (f && f.id === b.refId && !f.done) continue;
    const winner = f && f.id === b.refId && f.done ? (f.result?.winnerId ?? f.winnerId ?? null) : null;
    settleSideBets(state, ctx, 'fight', b.refId, winner);
  }
});

// ---------------------------------------------------------------- handlers
register({
  LETTER_SEND(state, ev, ctx) { sendLetter(state, ctx, ctx.payload.fromId || ctx.payload.playerId || ctx.actor, { toId: ctx.payload.toId, text: ctx.payload.text, kind: ctx.payload.kind === 'alliance' ? 'alliance' : 'letter' }); },
  ALLIANCE_PROPOSE(state, ev, ctx) { sendLetter(state, ctx, ctx.payload.fromId || ctx.payload.playerId || ctx.actor, { toId: ctx.payload.toId, text: ctx.payload.text, kind: 'alliance' }); },

  LETTER_INTERCEPT(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const l = letterOf(state, ctx.payload.letterId); if (!l) refuse('no such letter');
    if (!interceptable(state, pid).some(x => x.id === l.id)) refuse('that letter is not passing your way', 'reach');
    const action = ctx.payload.action; if (!['pass', 'destroy', 'forge'].includes(action)) refuse('action must be pass, destroy or forge');
    const c = charOf(state, pid); let txt = null;
    if (action === 'forge') {
      if (!canForge(c, ctx.B('xp'))) refuse(`only a Cutpurse of level ${ctx.B('xp').upgradeLevels[0]} can forge`, 'class');
      const S = ctx.B('social'); txt = String(ctx.payload.forgedText || '').trim().slice(0, S.letterMaxChars); if (!txt) refuse('forgedText required');
    }
    l.intercepted = { byId: pid, action, at: ctx.now, forgedText: txt };
    if (action === 'destroy') l.destroyed = true;
    if (action === 'forge') { l.originalText = l.text; l.text = txt; }
    runMods(letterHooks.onIntercept, state, ctx, { letter: l, byId: pid, action });
  },

  LETTER_READ(state, ev, ctx) {
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const l = letterOf(state, ctx.payload.letterId); if (!l) refuse('no such letter', 'letter');
    if (l.toId !== pid) refuse('not your letter', 'forbidden'); if (!l.deliveredAt || l.destroyed) refuse('it has not arrived', 'letter');
    l.read = true; l.readAt = ctx.now;
  },
  ALLIANCE_ANSWER(state, ev, ctx) {
    requirePhase(state, 'playing');
    const p = ctx.payload, pid = p.playerId || ctx.actor; requireActor(state, ctx, pid);
    if (p.allianceId) {
      const al = state.alliances.find(a => a.id === p.allianceId); if (!al || !al.active) refuse('no such alliance');
      if (!al.members.includes(pid)) refuse('not your alliance');
      if (p.accept !== false) refuse('an existing alliance can only be broken');
      al.active = false; al.endedAt = ctx.now; al.brokenBy = pid; note(state, `${nameOf(state, pid)} breaks an alliance`, 'letter', ctx.now); return;
    }
    const l = letterOf(state, p.letterId); if (!l || l.kind !== 'alliance') refuse('no such proposal');
    if (l.toId !== pid) refuse('that proposal is not addressed to you'); if (!l.deliveredAt || l.destroyed) refuse('the proposal has not arrived'); if (l.answered) refuse('already answered');
    l.answered = true; l.read = true;
    if (p.accept === false) { l.accepted = false; return; }
    if (state.alliances.some(a => a.active && a.members.includes(l.fromId) && a.members.includes(l.toId))) refuse('already allied');
    l.accepted = true;
    state.alliances.push({ id: ev.id, members: [l.fromId, l.toId], active: true, since: ctx.now, letterId: l.id });
  },

  VOTE_OPEN(state, ev, ctx) {
    requirePhase(state, 'playing');
    const p = ctx.payload, kind = p.kind === 'table' ? 'table' : p.kind === 'chaos' ? 'chaos' : null; if (!kind) refuse('kind must be chaos or table');
    if (state.votes && !state.votes.closed) refuse('a vote is already open', 'busy');
    const S = ctx.B('social'), eligible = activeSeats(state);
    let options = Array.isArray(p.options) ? p.options.map(String) : null;
    if (kind === 'chaos') requireGm(ctx);
    else {
      if (!ctx.isGm) { requirePlayer(state, ctx.actor); if (state.players[ctx.actor].spectator) refuse('spectators cannot call a table vote'); }
      if ((state.tableVotesUsed || 0) >= S.tableVotesPerNight) refuse(`the table already voted ${S.tableVotesPerNight} time(s) tonight`, 'limit');
      options ||= eligible.filter(id => { const c = charOf(state, id); return c && !c.dead; });
      if (!options.every(id => state.players[id])) refuse('table vote options must be players');
    }
    if (!options || options.length < 2) refuse('a vote needs at least two options');
    if (kind === 'table') state.tableVotesUsed = (state.tableVotesUsed || 0) + 1;
    state.votes = { id: ev.id, kind, question: String(p.question || (kind === 'table' ? 'Who goes to the Graveyard?' : 'Who does Chaos visit?')).slice(0, 120), options, openedBy: ctx.actor, openedAt: ctx.now, deadline: Number(p.deadline) || ctx.now + S.voteSeconds * 1000, ballots: {}, eligible, closed: false, result: null };
    note(state, `${kind === 'table' ? 'Table' : 'Chaos'} vote: ${state.votes.question}`, 'vote', ctx.now);
  },
  VOTE_CAST(state, ev, ctx) {
    const v = state.votes; if (!v || v.closed) refuse('no vote open');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    if (!v.eligible.includes(pid)) refuse('not eligible to vote');
    const choice = String(ctx.payload.choice); if (!v.options.includes(choice)) refuse('not an option');
    v.ballots[pid] = choice;
  },
  VOTE_CLOSE(state, ev, ctx) {
    const v = state.votes; if (!v || v.closed) refuse('no vote open');
    const all = v.eligible.every(id => v.ballots[id] !== undefined);
    if (!ctx.isGm && !all && ctx.now < v.deadline) refuse('the vote is still open', 'early');
    closeVote(state, ctx, ctx.isGm ? 'gm' : all ? 'all voted' : 'deadline');
  },

  EMOTE(state, ev, ctx) {
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid); requirePlayer(state, pid);
    const S = ctx.B('social'), emoji = String(ctx.payload.emoji || '').slice(0, 8), text = String(ctx.payload.text || '').slice(0, 40);
    if (!emoji && !text) refuse('nothing to say');
    state.emotes.push({ id: ev.id, playerId: pid, emoji, text, ts: ctx.now });
    if (state.emotes.length > S.emoteKeep) state.emotes.splice(0, state.emotes.length - S.emoteKeep);
  },

  SIDE_BET(state, ev, ctx) {
    requirePhase(state, 'playing');
    const S = ctx.B('social'); if (!S.sideBetsOn) refuse('side bets are off tonight', 'mode');
    const p = ctx.payload, pid = p.playerId || ctx.actor; requireActor(state, ctx, pid); requirePlayer(state, pid);
    const amount = Math.round(Number(p.amount) || 0); if (amount <= 0 || amount > S.sideBetMax) refuse(`a side bet is 1 to ${S.sideBetMax} Health`);
    let kind, refId, parties;
    if (p.fightId || (!p.challengeId && state.fight && !state.challenge)) { const f = state.fight; if (!f || f.done || (p.fightId && f.id !== p.fightId)) refuse('no such fight'); kind = 'fight'; refId = f.id; parties = [...(f.playerIds || []), f.monsterId].filter(Boolean); }
    else { const ch = state.challenge; if (!ch || ch.done || (p.challengeId && ch.id !== p.challengeId)) refuse('no such challenge'); kind = 'challenge'; refId = ch.id; parties = [ch.attackerId, ch.defenderId]; }
    if (parties.includes(pid)) refuse('you are in this fight');
    if (!parties.includes(p.onId)) refuse('onId must be a side in the fight');
    const c = charOf(state, pid);
    if (c) { const open = state.sideBets.filter(b => !b.settled && b.playerId === pid).reduce((s, b) => s + b.amount, 0); if (open + amount >= (c.health || 0)) refuse('you cannot stake your last Health', 'health'); }
    state.sideBets.push({ id: ev.id, playerId: pid, kind, refId, onId: p.onId, amount, placedAt: ctx.now, settled: false, won: null });
    note(state, `${nameOf(state, pid)} bets ${amount} on ${nameOf(state, p.onId)}`, 'bet', ctx.now);
  },
});

// Per-player turn counter, the off-turn letter allowance and delivery of due letters.
runHooks.turnStart.push((state, ctx, pid) => {
  state.turnCounts ||= {}; state.offTurnLetters ||= {};
  state.turnCounts[pid] = (state.turnCounts[pid] || 0) + 1;
  state.offTurnLetters[pid] = 0;
  deliverDue(state, ctx, pid);
});
