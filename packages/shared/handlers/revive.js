// Reviving another player early (SPEC.md › Death, Health economy, Stats). Two ways in, one event:
//   REVIVE { targetId, how: 'shop' }     standing on a Shop: pay shop.revive Gold (cheaper per point of your Grit
//                                         above neutral, health.gritReviveDiscountPerPoint, never under half) and
//                                         any dead character wakes at their Graveyard now.
//   REVIVE { targetId, how: 'feather' }  PvE-only and Teams: standing on the dead character's Graveyard hex with a
//                                         Phoenix Feather in your grid; the feather burns, they wake. Teams: a teammate.
// Until 19 Nov the price sat in the balance sheet and reviveAtGraveyard() in death.js with no event to call either,
// while the phone told every player that Grit made revives cheaper.
import { register, refuse, requirePhase, requireActor, requirePlayer } from '../reducer.js';
import { characterOf, currentPlayerId, sameTeam, note } from '../state.js';
import { gold, canPay } from '../health.js';
import { group } from '../balance.js';
import { effectiveStats } from '../characters/character.js';
import { reviveAtGraveyard, removeItem } from './death.js';

const hexType = (state, key) => state.map?.hexes?.[key]?.type || null;
// The Shop price for this buyer, in Gold.
export function revivePrice(state, buyer) {
  const base = group(state, 'shop').revive, H = group(state, 'health'), S = group(state, 'stats');
  let grit = 0; try { grit = effectiveStats(state, buyer).grit || 0; } catch { grit = buyer?.stats?.grit || 0; }
  const cut = Math.min(0.5, Math.max(0, grit - S.neutral) * (H.gritReviveDiscountPerPoint || 0));   // literal
  return Math.max(1, Math.round(base * (1 - cut)));
}
const feathers = (c) => Object.values(c?.items || {}).filter(it => it.baseId === 'phoenixfeather');
// Pure: what this player can do for the dead right now. [{ targetId, name, how, price?, why? }] (why = disabled reason)
export function reviveOptions(state, pid) {
  const c = characterOf(state, pid); if (!c || c.dead || state.phase !== 'playing' || currentPlayerId(state) !== pid) return [];
  const dead = Object.values(state.characters).filter(o => o.dead && !o.eliminated && o.id !== c.id && state.players[o.playerId] && !state.players[o.playerId].kicked);
  const out = [], here = hexType(state, c.pos);
  for (const o of dead) {
    if (here === 'shop') { const price = revivePrice(state, c); out.push({ targetId: o.playerId, name: o.name, how: 'shop', price, why: canPay(c, price) ? '' : `${price} Gold: you have ${c.gold || 0}` }); }
    const featherMode = state.mode === 'pve' || state.mode === 'teams';
    if (featherMode && c.pos === (o.graveyardPos || o.pos) && feathers(c).length && (state.mode !== 'teams' || sameTeam(state, pid, o.playerId))) out.push({ targetId: o.playerId, name: o.name, how: 'feather', why: '' });
  }
  return out;
}
register({
  REVIVE(state, ev, ctx) {
    requirePhase(state, 'playing');
    const pid = ctx.payload.playerId || ctx.actor; requireActor(state, ctx, pid);
    const c = characterOf(state, pid); if (!c || c.dead) refuse('the dead revive nobody', 'dead');
    if (!ctx.isGm && currentPlayerId(state) !== pid) refuse('on your own turn', 'turn');
    requirePlayer(state, ctx.payload.targetId); const t = characterOf(state, ctx.payload.targetId);
    if (!t || !t.dead) refuse('they are not dead', 'target'); if (t.eliminated) refuse('they are out of the run', 'target'); if (t.id === c.id) refuse('not yourself', 'target');
    const how = ctx.payload.how === 'feather' ? 'feather' : 'shop';
    if (how === 'shop') {
      if (hexType(state, c.pos) !== 'shop') refuse('revives are sold at a Shop', 'tile');
      const price = revivePrice(state, c); if (!canPay(c, price)) refuse(`a revive costs ${price} Gold`, 'gold');
      gold(state, c, -price, `revive for ${t.name}`, ctx);
    } else {
      if (state.mode !== 'pve' && state.mode !== 'teams') refuse('a feather revive is for PvE-only and Teams runs', 'mode');
      if (state.mode === 'teams' && !sameTeam(state, pid, t.playerId)) refuse('only a teammate', 'team');
      if (c.pos !== (t.graveyardPos || t.pos)) refuse(`stand at ${t.name}'s Graveyard`, 'tile');
      const f = feathers(c)[0]; if (!f) refuse('you hold no Phoenix Feather', 'item');
      if (f.stackable && (f.qty || 1) > 1) { f.qty -= 1; const cell = c.grid?.cells?.find(x => x.itemId === f.id); if (cell) cell.qty = f.qty; } else removeItem(c, f.id);
    }
    reviveAtGraveyard(state, ctx, t.id, { byId: c.id });
    note(state, how === 'shop' ? `${c.name} buys ${t.name} back from the Graveyard` : `${c.name} burns a Phoenix Feather for ${t.name}`, 'death', ctx.now);
  },
});
