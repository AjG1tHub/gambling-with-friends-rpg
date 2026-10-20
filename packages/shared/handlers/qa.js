// QA at the table: bug reports from any phone, the GM's triage, and the Bug Reward Wheel.
//   BUG_REPORT      { playerId?, text, screen?, context? }   anyone: a phone, the TV, the console
//   GM_BUG_STATUS   { bugId, status: 'open'|'fixed'|'wontfix'|'dupe'|'rewarded', notes? }
//   GM_BUG_REWARD   { playerId, bugId? }                       spins the Bug Reward Wheel for that player — in secret
//   BUG_REWARD_SEEN { playerId }                               the phone has shown the wheel
// Reports live in state.bugReports (last 200) so they ride along in the room export and the recap. The reward spin
// is written to state.secretSpins[playerId], which only that phone and the GM console render: no TV wheel, no log
// line, so the table never learns who got what.
import { register, refuse, requireGm, requireActor } from '../reducer.js';
import { characterOf, note } from '../state.js';
import { spinWheelSecret } from './wheels.js';

export const BUG_STATUSES = ['open', 'fixed', 'wontfix', 'dupe', 'rewarded'];
const reports = (state) => (state.bugReports ||= []);
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const MAX_TEXT = 1000, MAX_SCREEN = 80, MAX_REPORTS = 200;   // literal — field sizes, not play tunables

register({
  BUG_REPORT(state, ev, ctx) {
    const pid = ctx.payload.playerId || (ctx.isGm || ctx.actor === 'tv' || ctx.actor === 'system' ? null : ctx.actor);
    if (pid) requireActor(state, ctx, pid);
    const text = clip(ctx.payload.text, MAX_TEXT)?.trim(); if (!text) refuse('say what went wrong', 'text');
    const list = reports(state);
    const id = `bug-${ctx.now.toString(36)}-${list.length}`;
    const c = pid ? characterOf(state, pid) : null;
    list.push({ id, ts: ctx.now, playerId: pid, name: c?.name || state.players[pid]?.name || (ctx.isGm ? 'GM' : ctx.actor), text, screen: clip(ctx.payload.screen, MAX_SCREEN), context: ctx.payload.context && typeof ctx.payload.context === 'object' ? ctx.payload.context : null,
      phase: state.phase, round: state.round, turnIdx: state.turnIdx, eventSeq: ev.seq ?? state.lastSeq ?? null, status: 'open', notes: null, reward: null });
    if (list.length > MAX_REPORTS) list.splice(0, list.length - MAX_REPORTS);
    note(state, `${c?.name || state.players[pid]?.name || 'Someone'} reports a bug${ctx.payload.screen ? ` on ${ctx.payload.screen}` : ''}`, 'qa', ctx.now);
  },
  GM_BUG_STATUS(state, ev, ctx) {
    requireGm(ctx);
    const b = reports(state).find(x => x.id === ctx.payload.bugId); if (!b) refuse('no such report', 'bug');
    const { status, notes } = ctx.payload;
    if (status != null) { if (!BUG_STATUSES.includes(status)) refuse(`status must be one of ${BUG_STATUSES.join('/')}`, 'status'); b.status = status; }
    if (notes != null) b.notes = clip(notes, 500);
  },
  GM_BUG_REWARD(state, ev, ctx) {
    requireGm(ctx);
    const pid = ctx.payload.playerId; if (!state.players[pid]) refuse('no such seat', 'player');
    if (!characterOf(state, pid)) refuse('that player has no character yet', 'character');
    const r = spinWheelSecret(state, ctx, 'bugreward', pid);
    const b = ctx.payload.bugId ? reports(state).find(x => x.id === ctx.payload.bugId) : null;
    const reward = { id: `reward-${ctx.now.toString(36)}`, ts: ctx.now, wheel: 'bugreward', outcomes: r.outcomes, index: r.index, label: r.seg.label, text: r.result?.text || null, bugId: b?.id || null, seen: false,
      message: 'You get a secret reward for helping squash a bug. Don\u2019t tell anyone \ud83e\udd2b' };
    (state.secretSpins ||= {})[pid] = reward;
    if (b) { b.status = 'rewarded'; b.reward = { ts: ctx.now, label: r.seg.label, text: r.result?.text || null }; }
    (state.bugRewards ||= []).push({ ...reward, playerId: pid });
  },
  BUG_REWARD_SEEN(state, ev, ctx) {
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const r = state.secretSpins?.[pid]; if (!r) return;
    r.seen = true; const row = (state.bugRewards || []).find(x => x.id === r.id); if (row) row.seen = true;
  },
});
