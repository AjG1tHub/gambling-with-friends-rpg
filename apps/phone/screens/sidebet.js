// Side bets (SPEC.md › Social): a spectator or a bystander stakes Health (spectators: bragging rights only) on who
// wins the fight or challenge on the table, at even money. Off by default (GM › Config › Side bets); the engine
// (handlers/social.js SIDE_BET) settles when the fight or challenge does. This is the phone's side of it.
import { group } from '../../../packages/shared/balance.js';
import { characterOf } from '../../../packages/shared/state.js';
import { amountPicker, nameOf, redraw } from './prompts.js';

const sideName = (state, id) => state.monsters?.[id]?.name || nameOf(state, id);

// Pure: what the panel should offer this phone right now, or null when there is nothing to bet on.
export function sideBetView(state, me, now = Date.now()) {
  const S = group(state, 'social'); if (!S.sideBetsOn) return null;
  if (state.phase !== 'playing') return null;
  const f = state.fight && !state.fight.done ? state.fight : null, ch = state.challenge && !state.challenge.done ? state.challenge : null;
  let kind, refId, sides, title;
  if (ch) { kind = 'challenge'; refId = ch.id; sides = [ch.attackerId, ch.defenderId]; title = `${ch.call || 'challenge'}: ${sideName(state, ch.attackerId)} ⚔ ${sideName(state, ch.defenderId)}`; }
  else if (f) { kind = 'fight'; refId = f.id; sides = [...(f.playerIds || []), f.monsterId].filter(Boolean); title = `${sides.map(s => sideName(state, s)).join(' ⚔ ')}`; }
  else return null;
  if (sides.includes(me)) return null;   // you are in it
  const mine = (state.sideBets || []).filter(b => b.playerId === me && b.refId === refId);
  const open = (state.sideBets || []).filter(b => !b.settled && b.playerId === me).reduce((s, b) => s + b.amount, 0);
  const c = characterOf(state, me);
  const max = Math.max(0, Math.min(S.sideBetMax, c ? (c.health || 0) - 1 - open : S.sideBetMax));
  const riding = {}; for (const b of (state.sideBets || []).filter(b => !b.settled && b.refId === refId)) riding[b.onId] = (riding[b.onId] || 0) + b.amount;
  return { kind, refId, sides, title, mine, max, spectator: !c, riding, placed: mine.length > 0 };
}

// This phone's record across the run: bets won / lost / voided.
export function sideBetRecord(state, me) {
  const bets = (state.sideBets || []).filter(b => b.playerId === me && b.settled);
  return { won: bets.filter(b => b.won === true).length, lost: bets.filter(b => b.won === false).length, voided: bets.filter(b => b.won == null).length, net: bets.reduce((s, b) => s + (b.won === true ? b.amount : b.won === false ? -b.amount : 0), 0) };
}

const picks = new Map();   // per phone: refId → { onId, amount }

export function sideBetPanel(api) {
  const { state, me, h, dispatch } = api;
  const v = sideBetView(state, me);
  if (!v) {   // nothing on the table: a spectator still gets their running record
    const rec = sideBetRecord(state, me); if (!state.players[me]?.spectator || !(rec.won + rec.lost + rec.voided)) return null;
    return h('section', { class: 'ph-sect sidebet' }, h('h3', {}, 'Side bets'), h('p', { class: 'muted' }, 'Nothing on the table. The next fight or challenge is yours to call.'), h('p', { class: 'muted small' }, `Your record: ${rec.won} won · ${rec.lost} lost${rec.voided ? ` · ${rec.voided} void` : ''}`));
  }
  const box = h('section', { class: 'ph-sect sidebet' }, h('h3', {}, 'Side bet'), h('p', { class: 'muted' }, v.title));
  if (v.placed) {
    for (const b of v.mine) box.append(h('p', {}, `You have ${b.amount}${v.spectator ? '' : ' Health'} on ${sideName(state, b.onId)}.`));
  } else if (v.max <= 0 && !v.spectator) {
    box.append(h('p', { class: 'muted ital' }, 'Not enough Health to stake.'));
  } else {
    const pick = picks.get(v.refId) || { onId: null, amount: Math.min(5, v.max) }; picks.set(v.refId, pick);
    const chips = h('div', { class: 'chips' }, v.sides.map(id => h('button', { class: `chip${pick.onId === id ? ' on' : ''}`, onClick: () => { pick.onId = id; redraw(api); } }, `${sideName(state, id)}${v.riding[id] ? ` · ${v.riding[id]} riding` : ''}`)));
    const label = () => pick.onId ? `Bet ${pick.amount} on ${sideName(state, pick.onId)}` : 'Pick a side';
    const btn = h('button', { class: 'primary big', disabled: !pick.onId, onClick: async () => { const okd = await dispatch('SIDE_BET', { [v.kind === 'fight' ? 'fightId' : 'challengeId']: v.refId, onId: pick.onId, amount: pick.amount }); if (okd) picks.delete(v.refId); } }, label());
    const amt = amountPicker({ value: pick.amount, min: 1, max: Math.max(1, v.max), label: v.spectator ? 'Stake (bragging rights)' : `Health to stake (max ${v.max})`, onChange: (n) => { pick.amount = n; btn.textContent = label(); } });
    box.append(h('div', { class: 'tag' }, 'Who wins?'), chips, amt, btn);
    if (!v.spectator) box.append(h('p', { class: 'muted small' }, 'Even money, paid in Health when it settles. A draw voids the bet.'));
  }
  const rec = sideBetRecord(state, me);
  if (rec.won + rec.lost + rec.voided) box.append(h('p', { class: 'muted small' }, `Your record: ${rec.won} won · ${rec.lost} lost${rec.voided ? ` · ${rec.voided} void` : ''}${v.spectator ? '' : ` · net ${rec.net > 0 ? '+' : ''}${rec.net} Health`}`));
  return box;
}

// The last settled bet of this phone, for a toast on the play screen.
export function lastSettled(state, me) { return (state.sideBets || []).filter(b => b.playerId === me && b.settled).at(-1) || null; }
