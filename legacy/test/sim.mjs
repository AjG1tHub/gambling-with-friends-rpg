// Superseded: the payout simulation now lives in balance.mjs (exact + simulated RTP for every game)
// and the rule checks in test/unit/. Kept so `node test/sim.mjs` still works.
await import('./balance.mjs');
