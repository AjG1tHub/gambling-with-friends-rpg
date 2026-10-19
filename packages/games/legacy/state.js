// Shim for the legacy games' `./state.js` import (DECISIONS.md item 4). games.js only needs `log` and `credit`;
// the real legacy state.js also saves to localStorage and broadcasts, which must never happen here.
// `credit` still moves `player.balances[cur]` so settle() arithmetic holds; `log` appends to `state.ledger`
// when the mini state carries one. Nothing here touches the room state or the DOM.
export function log(state, eventType, playerId, data = {}) {
  if (!state || !Array.isArray(state.ledger)) return null;
  state.ledgerSeq = (state.ledgerSeq || 0) + 1;
  const row = { ts: state.now ?? 0, ...data, type: eventType, playerId: playerId ?? null, n: state.ledgerSeq };
  state.ledger.push(row);
  if (state.ledger.length > 500) state.ledger.splice(0, state.ledger.length - 500);
  return row;
}
export function bal(player, cur) { return (player && player.balances && player.balances[cur]) || 0; }
export function credit(state, player, cur, amount, why) {
  if (!player.balances) player.balances = {};
  const before = player.balances[cur] || 0;
  player.balances[cur] = before + amount;
  if (cur !== 'Gold' && player.balances[cur] < 0) player.balances[cur] = 0;
  const moved = player.balances[cur] - before;
  log(state, amount >= 0 ? 'CREDIT' : 'DEBIT', player.id, moved === amount ? { cur, amount, why } : { cur, amount: moved, asked: amount, why });
}
