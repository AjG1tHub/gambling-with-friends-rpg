// Cross-session stats (Phase 7). When the GM ends a session its summary is archived in
// this browser (localStorage — the game has no server), so the Hall of Fame survives
// "Reset Everything". Export / import moves the archive between computers.
import { sessionStats } from './stats.js';
import { loadProfiles, mergeProfiles } from './profiles.js';

export const HISTORY_KEY = 'gwf_history';
export const HISTORY_MAX = 200;
export const HISTORY_VERSION = 1;

// People are matched across sessions by saved profile when they have one, else by name.
export const playerKey = (p) => p.profileId ? 'profile:' + p.profileId : 'name:' + String(p.name || '').trim().toLowerCase();

// Pure: boil a finished session down to what the Hall of Fame needs.
export function summarizeSession(config, state, endedAt = Date.now()) {
  const st = sessionStats(config, state);
  return {
    v: HISTORY_VERSION,
    id: `${state.createdAt || 0}-${state.seed || 0}-${state.sessionNo || 1}`,
    startedAt: state.sessionStartedAt || state.createdAt || endedAt, endedAt, rounds: st.round,
    players: st.standings.map(s => {
      const p = state.players.find(x => x.id === s.id), ps = st.players[s.id];
      return { key: playerKey(p), name: p.name, profileId: p.profileId || null, rank: s.rank, value: s.value, net: s.net, debt: s.debt || 0,
        games: ps.games, wins: ps.wins, losses: ps.losses, gameNet: ps.gameNet, jailed: ps.jailed, battlesWon: ps.battlesWon,
        biggestWin: ps.biggestWin, biggestLoss: ps.biggestLoss, defaults: ps.defaults || 0, voids: ps.voids };
    }),
    awards: st.awards.map(a => ({ key: a.key, title: a.title, emoji: a.emoji, playerKey: playerKey(state.players.find(x => x.id === a.playerId)), name: a.name, detail: a.detail })),
    games: st.games.map(g => ({ id: g.id, plays: g.plays, wins: g.wins, net: g.net })),
    totals: st.totals,
  };
}

const safeParse = (raw) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const valid = (s) => s && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.players) && Number.isFinite(Number(s.endedAt));

export function loadHistory(storage = globalThis.localStorage) { return safeParse(storage.getItem(HISTORY_KEY)).filter(valid); }
export function saveHistory(list, storage = globalThis.localStorage) {
  const trimmed = [...list].sort((a, b) => a.endedAt - b.endedAt).slice(-HISTORY_MAX);
  storage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  return trimmed;
}
export function clearHistory(storage = globalThis.localStorage) { storage.removeItem(HISTORY_KEY); }

// Archive (or re-archive — ending the same session twice replaces, never duplicates).
export function archiveSession(config, state, storage = globalThis.localStorage, endedAt = Date.now()) {
  const summary = summarizeSession(config, state, endedAt);
  if (!summary.players.length) return { error: true, text: 'Nothing to archive — no players.' };
  const list = loadHistory(storage).filter(s => s.id !== summary.id);
  list.push(summary);
  saveHistory(list, storage);
  return { summary, count: Math.min(list.length, HISTORY_MAX), text: `Session archived (${Math.min(list.length, HISTORY_MAX)} in the Hall of Fame).` };
}

export function exportHistory(storage = globalThis.localStorage) {
  return JSON.stringify({ app: 'gambling-with-friends', kind: 'history', v: HISTORY_VERSION, exportedAt: Date.now(), sessions: loadHistory(storage), profiles: loadProfiles(storage) }, null, 2);
}
// Merge an exported file into this browser's archive. Same session id = the imported copy wins.
export function importHistory(json, storage = globalThis.localStorage) {
  let data; try { data = JSON.parse(json); } catch { return { error: true, text: 'That file is not valid JSON.' }; }
  const sessions = Array.isArray(data) ? data : data?.sessions;
  if (!Array.isArray(sessions)) return { error: true, text: 'No sessions found in that file.' };
  const good = sessions.filter(valid);
  const profilesAdded = Array.isArray(data?.profiles) ? mergeProfiles(data.profiles, storage) : 0;
  if (!good.length && !profilesAdded) return { error: true, text: 'No usable sessions in that file.' };
  const byId = new Map(loadHistory(storage).map(s => [s.id, s]));
  let added = 0; for (const s of good) { if (!byId.has(s.id)) added++; byId.set(s.id, s); }
  const saved = saveHistory([...byId.values()], storage);
  return { added, updated: good.length - added, skipped: sessions.length - good.length, count: saved.length, profilesAdded, text: `Imported ${good.length} session${good.length === 1 ? '' : 's'} (${added} new)${profilesAdded ? ` and ${profilesAdded} saved player${profilesAdded === 1 ? '' : 's'}` : ''}.` };
}

// Pure: lifetime table, best first (titles, then podiums, then total net).
export function hallOfFame(history, keyMap = {}) {
  const rows = new Map();
  const K = (key) => keyMap[key] || key;        // fold pre-profile sessions (keyed by name) into the profile
  for (const s of [...history].sort((a, b) => a.endedAt - b.endedAt)) {
    for (const p of s.players) {
      const key = K(p.key);
      const r = rows.get(key) || { key, name: p.name, sessions: 0, titles: 0, podiums: 0, spoons: 0, totalNet: 0, bestNet: null, worstNet: null,
        games: 0, gameWins: 0, jailed: 0, battlesWon: 0, defaults: 0, biggestWin: 0, awards: 0, lastPlayed: 0, streak: 0, bestStreak: 0 };
      r.name = p.name;                                            // newest spelling wins
      r.sessions++; r.totalNet += p.net; r.lastPlayed = Math.max(r.lastPlayed, s.endedAt);
      if (p.rank === 1) { r.titles++; r.streak++; r.bestStreak = Math.max(r.bestStreak, r.streak); } else r.streak = 0;
      if (p.rank <= 3) r.podiums++;
      if (s.players.length > 1 && p.rank === Math.max(...s.players.map(x => x.rank))) r.spoons++;
      r.bestNet = r.bestNet === null ? p.net : Math.max(r.bestNet, p.net);
      r.worstNet = r.worstNet === null ? p.net : Math.min(r.worstNet, p.net);
      r.games += p.games || 0; r.gameWins += p.wins || 0; r.jailed += p.jailed || 0; r.battlesWon += p.battlesWon || 0;
      r.defaults += p.defaults || 0; r.biggestWin = Math.max(r.biggestWin, p.biggestWin || 0);
      rows.set(key, r);
    }
    for (const a of s.awards || []) { const r = rows.get(K(a.playerKey)); if (r && a.key !== 'champion' && a.key !== 'spoon') r.awards++; }
  }
  return [...rows.values()]
    .map(r => ({ ...r, totalNet: Math.round(r.totalNet), avgNet: Math.round(r.totalNet / r.sessions), winRate: r.games ? r.gameWins / r.games : null }))
    .sort((a, b) => b.titles - a.titles || b.podiums - a.podiums || b.totalNet - a.totalNet || a.name.localeCompare(b.name));
}

// Pure: all-time single-session records.
export function records(history) {
  const best = (score, min = -Infinity) => {
    let top = null;
    for (const s of history) for (const p of s.players) { const v = score(p, s); if (v != null && v > min && (!top || v > top.value)) top = { value: v, name: p.name, endedAt: s.endedAt }; }
    return top;
  };
  return [
    { key: 'bestNight', emoji: '🚀', title: 'Best night', ...(best(p => p.net, 0) || {}) },
    { key: 'worstNight', emoji: '🕳️', title: 'Worst night', ...(best(p => -p.net, 0) || {}) },
    { key: 'biggestWin', emoji: '💰', title: 'Biggest single win', ...(best(p => p.biggestWin, 0) || {}) },
    { key: 'mostJailed', emoji: '🔒', title: 'Most jailings in one session', ...(best(p => p.jailed, 0) || {}) },
    { key: 'mostGames', emoji: '🎰', title: 'Most games in one session', ...(best(p => p.games, 0) || {}) },
  ].filter(r => r.value != null).map(r => r.key === 'worstNight' ? { ...r, value: -r.value } : r);
}

export function sessionLine(s) {
  const champ = s.players.find(p => p.rank === 1);
  return `${new Date(s.endedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — ${s.players.length} players, ${s.rounds} round${s.rounds === 1 ? '' : 's'} — 👑 ${champ ? champ.name : '?'} (${champ && champ.net >= 0 ? '+' : ''}${champ ? Math.round(champ.net) : 0})`;
}
