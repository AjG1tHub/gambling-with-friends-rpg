// The three currencies move through one function each, as credit() did in the legacy build. Every move
// writes a ledger row, so a character's totals can always be rebuilt from the ledger. Nothing else may
// touch c.health, c.gold or a pet's power.
import { refuse } from './reducer.js';

function row(state, kind, charId, amount, moved, why, ctx, extra = {}) {
  state.ledgerSeq = (state.ledgerSeq || 0) + 1;
  const r = { n: state.ledgerSeq, ts: ctx?.now ?? state.lastEventTs ?? 0, kind, charId, amount, moved, why, ...extra };
  state.ledger.push(r);
  if (state.ledger.length > 20000) state.ledger.splice(0, state.ledger.length - 20000);
  return r;
}

// Health: floors at 0 (death is decided by the caller: see death.js), caps at maxHealth unless `overheal`.
// Shield points absorb damage first. Returns what actually moved on health (negative for damage).
export function health(state, c, amount, why, ctx, { ignoreShield = false, overheal = false } = {}) {
  if (!c) refuse('no character');
  amount = Math.round(amount);
  let absorbed = 0;
  if (amount < 0 && !ignoreShield && c.shield > 0) { absorbed = Math.min(c.shield, -amount); c.shield -= absorbed; amount += absorbed; }
  const before = c.health;
  const cap = overheal ? Infinity : c.maxHealth;
  c.health = Math.max(0, Math.min(cap, before + amount));
  const moved = c.health - before;
  row(state, 'health', c.id, amount, moved, why, ctx, absorbed ? { absorbed } : {});
  return moved;
}
export function shield(state, c, amount, why, ctx) {
  amount = Math.round(amount); const before = c.shield || 0;
  c.shield = Math.max(0, before + amount);
  row(state, 'shield', c.id, amount, c.shield - before, why, ctx);
  return c.shield - before;
}
export function maxHealth(state, c, amount, why, ctx) {
  amount = Math.round(amount); const before = c.maxHealth;
  c.maxHealth = Math.max(1, before + amount);
  if (c.health > c.maxHealth) c.health = c.maxHealth;
  row(state, 'maxHealth', c.id, amount, c.maxHealth - before, why, ctx);
  return c.maxHealth - before;
}
// Gold never goes negative: a debit larger than the balance is refused by the caller (use canPay).
export function gold(state, c, amount, why, ctx) {
  amount = Math.round(amount); const before = c.gold || 0;
  if (before + amount < 0) refuse(`not enough Gold (${before} < ${-amount})`, 'gold');
  c.gold = before + amount;
  row(state, 'gold', c.id, amount, amount, why, ctx);
  return amount;
}
export const canPay = (c, amount) => (c.gold || 0) >= amount;
// Banked gold is a separate pool, safe from steals and Chaos; only a Bank tile moves it.
export function bankGold(state, c, amount, why, ctx) {
  amount = Math.round(amount); const before = c.bank || 0;
  if (before + amount < 0) refuse('not enough banked Gold', 'gold');
  c.bank = before + amount;
  row(state, 'bank', c.id, amount, amount, why, ctx);
  return amount;
}
// Pet Power is the pet's own stake pool; floors at 0.
export function power(state, pet, amount, why, ctx) {
  amount = Math.round(amount); const before = pet.power || 0;
  pet.power = Math.max(0, before + amount);
  row(state, 'power', pet.id, amount, pet.power - before, why, ctx);
  return pet.power - before;
}
// Creation chips (chip mode): a character's chip pool during creation.
export function chips(state, c, amount, why, ctx) {
  amount = Math.round(amount); const before = c.chips || 0;
  c.chips = Math.max(0, before + amount);
  row(state, 'chips', c.id, amount, c.chips - before, why, ctx);
  return c.chips - before;
}
export function healthThird(c, B) {
  const f = c.maxHealth ? c.health / c.maxHealth : 0;
  return c.dead || c.health <= 0 ? 'dead' : f > B.tellHigh ? 'high' : f >= B.tellLow ? 'mid' : 'low';
}
