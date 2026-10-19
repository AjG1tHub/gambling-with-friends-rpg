// The config doctor: looks at the room's effective tunables and says what is wrong, odd or missing.
// Returns [{ level: 'error'|'warn'|'info', text }]. Pure.
import { group } from './balance.js';

export function configCheck(state) {
  const out = [];
  const g = (name) => group(state, name);
  const H = g('health'), I = g('items'), C = g('clock'), T = g('table'), M = g('map'), D = g('death'), P = g('bloodPact'), X = g('xp'), G = g('grid'), Cr = g('creation'), Ch = g('challenge');
  const err = (t) => out.push({ level: 'error', text: t }), warn = (t) => out.push({ level: 'warn', text: t }), info = (t) => out.push({ level: 'info', text: t });
  if (I.stakeLegendary > H.maxAtLevel1) err(`A Legendary stake (${I.stakeLegendary}) is above level-1 max Health (${H.maxAtLevel1}); a fresh character could never use one.`);
  if (!(I.stakeCommon < I.stakeRare && I.stakeRare < I.stakeEpic && I.stakeEpic < I.stakeLegendary)) err('Rarity stakes should rise Common < Rare < Epic < Legendary.');
  if (H.innHeal * 4 > H.maxAtLevel1) warn(`Inn heal ${H.innHeal} is generous next to ${H.maxAtLevel1} max Health; Health should trend down across a run.`);
  if (H.potionHeal >= H.maxAtLevel1 / 2) warn(`A Potion heals ${H.potionHeal}, half of a fresh character; healing is meant to be scarce.`);
  if (H.buyinMin > H.flatStart || H.buyinMax < H.flatStart) warn('The flat start Health is outside the Buy-in Wheel range.');
  if (C.perTurnSeconds > C.bankCapSeconds) err('A turn adds more time than the bank can hold.');
  if (C.perTurnSeconds < 45) warn(`${C.perTurnSeconds}s a turn is tight for a phone fight; 90 is the tested default.`);
  if (T.maxPlayers > 8) warn('More than 8 players: maps and clocks were tuned for 4 to 6.');
  if (T.tunedMin > T.tunedMax) err('table.tunedMin is above table.tunedMax.');
  if (M.citadelLevel > X.levelCap) err('The Citadel gate level is above the level cap: nobody can ever enter without a key.');
  if (D.wakeFraction <= 0 || D.wakeFraction > 1) err('death.wakeFraction must be between 0 and 1.');
  if (P.interest > 1) warn('Blood Pact interest above 100%.');
  if (P.max > H.maxAtLevel1) warn('A single Blood Pact can exceed a fresh character\'s max Health.');
  if (G.cols * G.rows < 20) warn('A grid smaller than 20 cells cannot hold the starter kit comfortably.');
  if (Cr.maxStake > Cr.chips) err('Creation max stake is above the chip count.');
  if (Ch.timeoutDamage > I.stakeCommon * 2) warn('A challenge timeout hurts more than two Common hits.');
  if (state.balance && Object.keys(state.balance).length) info(`${Object.values(state.balance).reduce((n, o) => n + Object.keys(o).length, 0)} tunables differ from the shipped defaults.`);
  if (state.phase === 'playing' && state.gm.duelsEnabled === false) info('Duels are off: this is a Gold-only night.');
  return out;
}
