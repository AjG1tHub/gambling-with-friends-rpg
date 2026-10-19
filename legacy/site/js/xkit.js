// Shared bits for the plug-in minigames (games-quick.js, games-show.js, games-table.js).
// A plug-in game is one object:
//   { id, name, icon, odds, how(o), returns?(o), start(g, x), act(g, action, payload, x), controls(g, x), stage(g, now, x), bot(g, pick, smart) }
//   x = { rng, odds, now, state, player, esc, cardsHtml? }   (cardsHtml only on the shared screen)
// Rules live in start/act and never touch the DOM; controls() describes the GM's buttons as data;
// stage() returns the shared-screen HTML. Every game ends by calling end(), which sets g.result —
// money still only moves when the GM presses Settle.
export const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
export const end = (g, mult, label, at) => { g.phase = 'done'; g.result = { mult, label }; g.view.revealAt = at; return { done: true, mult, text: label }; };
export const idle = (a) => ({ text: `Nothing to do for ${a}.`, error: true });
export const DIE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export const DICE_MS = 900;
export const cls = (mult) => (mult > 1 ? 'crash-good' : mult < 1 ? 'crash-bad' : '');
export const revealed = (g, now) => g.phase === 'done' && now >= (g.view.revealAt || 0);
export const big = (g, now, esc) => (revealed(g, now) ? `<div class="stage-big ${cls(g.result.mult)}">${esc(g.result.label)}</div>` : '');
export const draw = (g, t, extra = {}) => ({ ...g.secret.deck.shift(), t, ...extra });
export const txt = (cards) => cards.map(c => c.r + c.s).join(' ');
export const x2 = (m) => `${Number(Number(m).toFixed(2))}×`;
export const pct = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
// Dice on the shared screen: tumble for DICE_MS after rollAt, then show the real faces.
export function diceHtml(values, rollAt, now, extraClass = '') {
  const rolling = rollAt != null && now < rollAt + DICE_MS;
  const faces = values.map((v, i) => (rolling ? DIE[(Math.floor(now / 70) * (i * 2 + 3) + i) % 6] : DIE[v - 1]));
  return `<div class="xdice ${rolling ? 'rolling' : ''} ${extraClass}">${faces.map(f => `<span>${f}</span>`).join('')}</div>`;
}
export const diceLanded = (rollAt, now) => rollAt != null && now >= rollAt + DICE_MS;
export const b = (label, a, p = {}, o = {}) => ({ label, a, p, ...o });
export const sum = (arr) => arr.reduce((s, v) => s + v, 0);
