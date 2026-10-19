// Game Lab logic (pure — the page glue is lab.js). The lab is a sandbox: one tester, one bankroll,
// every minigame on a menu, and a tick-list so a play-test can be worked through quickly.
import { initialState, newPlayer } from './state.js';
import { EXTRA_GROUPS } from './games-extra.js';
import { CORE_GAMES, gameReturns } from './config-check.js';
import { SKILL_RETURNS } from './rules.js';

export const LAB_KEY = 'gwf_lab';
export const LAB_BANK = 10000;
export const WHEEL_MS = 4600;                       // how long the big wheel overlay takes to land

export function labCatalog(config) {
  const by = Object.fromEntries((config.Games || []).filter(g => g && g.built && !g.hidden).map(g => [g.id, g]));
  const pick = (ids) => ids.filter(id => by[id]).map(id => ({ id, name: by[id].name, icon: by[id].icon || '🎲' }));
  const groups = [{ label: 'Classics', games: pick(CORE_GAMES) }, ...EXTRA_GROUPS.map(g => ({ label: g.label, games: pick(g.ids) }))];
  const listed = new Set(groups.flatMap(g => g.games.map(x => x.id)));
  const other = Object.keys(by).filter(id => !listed.has(id));
  if (other.length) groups.push({ label: 'Other', games: pick(other) });
  return groups.filter(g => g.games.length);
}
export const labOrder = (catalog) => catalog.flatMap(g => g.games.map(x => x.id));
export function stepId(order, cur, delta) { if (!order.length) return null; const i = order.indexOf(cur); return order[((i < 0 ? (delta > 0 ? -1 : 0) : i) + delta + order.length) % order.length]; }

export function newLabState(config, seed = 1, bank = LAB_BANK) {
  const state = initialState(config, seed);
  state.players.push(newPlayer('tester', 'Tester', '', 0, bank));
  state.turnOrder = ['tester']; state.phase = 'playing'; state.lab = true;
  return state;
}

export const outcomeOf = (g) => (g ? g.result || g.pending || null : null);
// A round can be settled once it has a result and everything on screen has finished moving.
export function readyToSettle(state, roundStartTs, now) {
  const g = state.game, o = outcomeOf(g); if (!g || !o) return false;
  if (g.forkOptions) return false;                                            // the tester has to choose
  if (g.result && g.phase !== 'done') return false;
  if (now < (g.view.revealAt || 0)) return false;
  const spin = state.lastSpin;
  if (spin && spin.ts >= roundStartTs && now < spin.ts + WHEEL_MS) return false;
  return true;
}

// ── Ticks, notes and play counts ─────────────────────────────────────────────────────────────────
export function loadMarks(storage) { try { const m = JSON.parse(storage.getItem(LAB_KEY) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; } }
export function saveMarks(storage, marks) { try { storage.setItem(LAB_KEY, JSON.stringify(marks)); return true; } catch { return false; } }
const entry = (marks, id) => marks[id] || (marks[id] = { status: '', note: '', plays: 0, staked: 0, returned: 0 });
export function setStatus(marks, id, status) { entry(marks, id).status = ['ok', 'bad'].includes(status) ? status : ''; return marks; }
export function setNote(marks, id, note) { entry(marks, id).note = String(note || '').slice(0, 2000); return marks; }
export function recordPlay(marks, id, stake, mult) { const e = entry(marks, id); e.plays += 1; e.staked += stake; e.returned += stake * mult; return marks; }
export function statsLine(marks, id) {
  const e = marks[id]; if (!e || !e.plays) return 'Not played yet.';
  const net = Math.round(e.returned - e.staked);
  return `${e.plays} round${e.plays === 1 ? '' : 's'} · staked ${Math.round(e.staked).toLocaleString('en-US')} · net ${net >= 0 ? '+' : ''}${net.toLocaleString('en-US')} · returned ${(e.returned / e.staked * 100).toFixed(0)}%`;
}
export function progress(catalog, marks) {
  const ids = labOrder(catalog), ok = ids.filter(id => marks[id]?.status === 'ok').length, bad = ids.filter(id => marks[id]?.status === 'bad').length, played = ids.filter(id => marks[id]?.plays).length;
  return { total: ids.length, ok, bad, played, left: ids.length - ok - bad, text: `${ok + bad} of ${ids.length} checked${bad ? ` · ${bad} with problems` : ''} · ${played} played` };
}
export function reportText(catalog, marks, now = new Date()) {
  const p = progress(catalog, marks), lines = [`Gambling With Friends — game lab report (${now.toISOString().slice(0, 10)})`, p.text, ''];
  for (const grp of catalog) {
    lines.push(`## ${grp.label}`);
    for (const g of grp.games) { const e = marks[g.id] || {}; lines.push(`- [${e.status === 'ok' ? 'OK' : e.status === 'bad' ? 'PROBLEM' : e.plays ? 'played, not marked' : 'not tested'}] ${g.name}${e.plays ? ` (${e.plays} rounds)` : ''}${e.note ? ` — ${e.note.replace(/\s+/g, ' ').trim()}` : ''}`); }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// Payout rows for the side panel: closed-form returns where known, otherwise the measured figure.
export function payoutRows(config, id) {
  const rows = gameReturns(config).filter(r => r.id === id).map(r => ({ label: r.label, value: (r.rtp * 100).toFixed(1) + '%' }));
  if (!rows.length) rows.push({ label: 'Returns', value: id === 'blackjack' ? 'about 99% with sensible play' : SKILL_RETURNS[id] || 'depends on play' });
  else if (SKILL_RETURNS[id]) rows.push({ label: 'Played sensibly', value: SKILL_RETURNS[id] });
  return rows;
}
