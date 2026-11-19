// Hostile-phone fuzz: bot games with garbage events thrown in from every seat between the real ones. A refusal is
// the right answer to garbage; what this hunts is a handler that *crashes* on it (the reducer catches the crash and
// logs "⚠ TYPE: message", so the room survives, but it is still a bug) or that lets a number go NaN.
//
//   node tools/fuzz.mjs                  6 games, 400 hostile events a game
//   node tools/fuzz.mjs --games 30 --per 2000 --seed 7
import '../packages/shared/index.js';
import { applyEvent, EVENTS } from '../packages/shared/index.js';
import { makeEvent } from '../packages/shared/events.js';
import { makeRng } from '../packages/shared/rng.js';
import { currentPlayerId, characterOf } from '../packages/shared/state.js';
import { nextAction, tableDuties } from '../packages/shared/bot.js';
import { hasHandler } from '../packages/shared/reducer.js';
import { pack, unpack } from '../packages/shared/snapshot.js';

const GM_ONLY = /^(GM_|ROOM_|RUN_START|RUN_END|CREATION_OPEN|META_|BALANCE_|CHAOS_|MONSTER_ACT|TURN_TIMEOUT|PRESENCE|PLAYER_JOIN|PLAYER_LEAVE)/;
export function fuzzGame({ seed = 1, mode = 'ffa', bots = 4, per = 400, maxEvents = 6000, ramp = false } = {}) {
  let now = 1_700_000_000_000, seq = 0; const rng = makeRng(seed * 104729 + 3); const crashes = new Map(); let hostile = 0, accepted = 0;
  const R = (n) => Math.floor(rng.next() * n), pick = (a) => a[R(a.length)];
  let state = applyEvent({}, { ...makeEvent('ROOM_CREATED', { roomId: 'fz', code: 'FUZZ', seed, mode, tier: 1, size: 'regular', gmPinHash: 'x', ramp }, { actor: 'gm', ts: now }), seq: ++seq }, { clone: false, strict: true });
  let shadow = null;
  const apply = (type, payload, actor, tag = '') => {
    const n = state.log?.length || 0;
    const ev = { ...makeEvent(type, payload, { actor, ts: now }), id: 'e' + (seq + 1), seq: ++seq };
    // The shadow is a phone that reloads every 25 events: it takes each event as JSON and restarts from a snapshot.
    // Every client, the sender included, applies the event as the backend stored it: JSON.
    let evJson = null; try { evJson = JSON.parse(JSON.stringify(ev)); } catch { evJson = null; }
    state = applyEvent(state, evJson ? structuredClone(evJson) : ev, { clone: false, strict: false }); now += 3000;
    if (shadow && evJson) { shadow = applyEvent(shadow, evJson, { clone: false, strict: false }); if (seq % 25 === 0) shadow = unpack(JSON.parse(JSON.stringify(pack(shadow)))); }
    const err = state.lastError && state.lastError.type === type && state.lastError.ts === now - 3000 ? state.lastError : null;
    if (err && err.code === 'error') { const k = `${type}: ${err.message}`; if (!crashes.has(k)) crashes.set(k, { payload: JSON.stringify(payload)?.slice(0, 200), actor, tag, phase: state.phase, turnPhase: state.turnPhase }); }
    return err;
  };
  shadow = JSON.parse(JSON.stringify(state));
  const ids = []; for (let i = 0; i < bots; i++) { ids.push('bot' + i); apply('PLAYER_JOIN', { playerId: 'bot' + i, name: 'Bot ' + i, deviceId: 'dev' + i }, 'system'); }
  apply('PLAYER_JOIN', { playerId: 'spec', name: 'Watcher', deviceId: 'w', spectator: true }, 'system');
  if (mode === 'teams') { const teams = {}; ids.forEach((id, i) => { const t = 't' + (i % 2); (teams[t] ||= { name: 'Team ' + (i % 2 + 1), members: [] }).members.push(id); }); apply('GM_SET_TEAMS', { teams }, 'gm'); }
  apply('CREATION_OPEN', {}, 'gm');
  const types = Object.keys(EVENTS).filter(t => hasHandler(t) && !GM_ONLY.test(t));
  const junk = [null, undefined, '', 'x', -1, 0, 1, 2, 3, 99999, 1.5, NaN, Infinity, {}, [], true, 'gm', '__proto__', 'constructor', 'toString'];
  const KEYS = ['itemId', 'targetId', 'toId', 'fromId', 'playerId', 'charId', 'petId', 'monsterId', 'tradeId', 'challengeId', 'letterId', 'auctionId', 'voteId', 'id', 'index', 'attackIndex', 'slot', 'to', 'dir', 'hex', 'key', 'amount', 'gold', 'stake', 'mult', 'label', 'kind', 'how', 'mode', 'choice', 'option', 'accept', 'side', 'onId', 'song', 'text', 'name', 'give', 'want', 'trade', 'itemIds', 'petIds', 'x', 'y', 'w', 'h', 'rot', 'cell', 'action', 'stat', 'outcome', 'targetKind', 'classId', 'answer', 'pick', 'value', 'destroy', 'speciesId', 'baseId', 'activeId', 'consumableId', 'yes', 'bid'];
  const pool = () => {
    const cs = Object.values(state.characters || {}), out = [...ids, 'spec', ...junk];
    for (const c of cs) { out.push(c.id, c.pos); for (const k of Object.keys(c.items || {})) out.push(k); for (const p of c.pets || []) out.push(p.id); }
    for (const m of Object.values(state.monsters || {}).slice(0, 12)) out.push(m.id, m.pos);
    for (const t of state.trades || []) out.push(t.id); for (const l of state.letters || []) out.push(l.id); for (const a of state.auctions || []) out.push(a.id);
    if (state.challenge) out.push(state.challenge.id); if (state.vote) out.push(state.vote.id);
    out.push(...Object.keys(state.map?.hexes || {}).slice(0, 30), 'heal', 'shop', 'feather', 'win', 'lose', 'monster', 'character', 'self', 'luck', 'nerve', 'greed', 'grit', 'dice', 'wheel', 'card', 'chaos', 'inn', 'pet', 'trade', 'whale', 'croupier');
    return out;
  };
  const payload = () => { const P = pool(), o = {}; const n = R(6); for (let i = 0; i < n; i++) { const k = pick(KEYS); const r = R(10); o[k] = r === 0 ? [pick(P), pick(P)] : r === 1 ? { gold: pick(P), itemIds: [pick(P)], petIds: [pick(P)], give: {}, want: {} } : pick(P); } return o; };
  const hostileBurst = (n) => { for (let i = 0; i < n; i++) { hostile++; const e = apply(pick(types), payload(), pick([...ids, ...ids, 'spec', 'nobody']), 'hostile'); if (!e) accepted++; } };
  // Mutants of a real action are the sharper half: the right event with one field wrong, from the wrong seat, or twice.
  const mutants = (a) => { if (budget <= 0 || R(4)) return; const P = pool(); const keys = Object.keys(a.payload || {});
    const tries = [[a.type, a.payload, pick([...ids, 'spec'])], [a.type, a.payload, a.actor], [a.type, {}, a.actor]];
    for (const k of keys) tries.push([a.type, { ...a.payload, [k]: pick(P) }, a.actor]);
    if (keys.length) { const o = { ...a.payload }; delete o[pick(keys)]; tries.push([a.type, o, a.actor]); }
    for (const [t, p, who] of tries) { hostile++; budget--; if (!apply(t, p, who, 'mutant')) accepted++; } };
  let lastProgress = 0, budget = per;
  for (let guard = 0; guard < maxEvents && state.phase !== 'ended'; guard++) {
    let acted = false;
    if (budget > 0 && R(3) === 0) { const n = 1 + R(4); hostileBurst(n); budget -= n; }
    if (state.phase === 'creation' || state.phase === 'lobby') {
      for (const id of ids) { const a = nextAction(state, id, rng, now, {}); if (a && !apply(a.type, a.payload, a.actor)) acted = true; if (a) mutants(a); }
      if (!acted) { apply('RUN_START', {}, 'gm'); acted = true; }
    } else {
      for (const a of tableDuties(state, rng, now)) if (!apply(a.type, a.payload, a.actor)) acted = true;
      const order = [currentPlayerId(state), ...ids.filter(id => id !== currentPlayerId(state))].filter(Boolean);
      for (const id of order) { const a = nextAction(state, id, rng, now, {}); if (!a) continue; if (!apply(a.type, a.payload, a.actor)) acted = true; if (a.actor !== 'gm' && a.actor !== 'system') mutants(a); if (a.type === 'TURN_END' || a.type === 'TURN_TIMEOUT') break; }
    }
    if (acted) lastProgress = guard; else if (guard - lastProgress > 40) { apply('TURN_END', {}, 'gm'); lastProgress = guard; }
  }
  // Numbers that must stay numbers, and a state that still serialises.
  const bad = [];
  for (const c of Object.values(state.characters || {})) for (const k of ['gold', 'health', 'maxHealth', 'level', 'xp', 'banked']) if (c[k] != null && !Number.isFinite(c[k])) bad.push(`${c.name}.${k}=${c[k]}`);
  for (const c of Object.values(state.characters || {})) if (c.gold < 0) bad.push(`${c.name}.gold=${c.gold}`);
  for (const l of state.log || []) if (l.kind === 'error' && ![...crashes.keys()].some(k => l.text.includes(k.split(': ')[0]))) bad.push('logged crash: ' + l.text);
  const SCRATCH = ['lastError', 'reequipped', 'rested', 'bought', 'duelled', 'fled', 'looted', 'pact', 'potion', 'potionsBought'];   // the bot's own notes on the state
  const flat = (x) => JSON.stringify(x, (k, v) => SCRATCH.includes(k) || k.startsWith('__') ? undefined : v);
  const firstDiff = (a, b, path = '') => { if (typeof a !== typeof b || (a === null) !== (b === null)) return path; if (typeof a !== 'object' || a === null) return a === b ? null : path; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], path + '.' + k); if (d) return d; } return null; };
  if (flat(state) !== flat(shadow)) bad.push('a reloading phone ends somewhere else: ' + firstDiff(JSON.parse(flat(state)), JSON.parse(flat(shadow))));
  try { JSON.parse(JSON.stringify(state)); } catch (e) { bad.push('state does not serialise: ' + e.message); }
  return { seed, mode, events: seq, hostile, accepted, turns: state.turnIdx, crashes: [...crashes].map(([k, v]) => ({ k, ...v })), bad };
}

if (process.argv[1] && process.argv[1].endsWith('fuzz.mjs')) {
  const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const games = Number(flag('games', 6)), per = Number(flag('per', 400)), seed0 = Number(flag('seed', 1)); const modes = ['ffa', 'pve', 'pvp', 'royale', 'teams'];
  const all = new Map(); let bad = [];
  for (let i = 0; i < games; i++) { const r = fuzzGame({ seed: seed0 + i, mode: modes[i % modes.length], per, ramp: i % 3 === 0 }); for (const c of r.crashes) if (!all.has(c.k)) all.set(c.k, { ...c, seed: r.seed, mode: r.mode }); bad.push(...r.bad.map(b => `seed ${r.seed}: ${b}`)); console.log(`seed ${r.seed} ${r.mode}: ${r.events} events, ${r.hostile} hostile (${r.accepted} accepted), ${r.turns} turns, ${r.crashes.length} crash kinds`); }
  for (const [k, v] of all) console.log(`CRASH ${k}\n    seed ${v.seed} ${v.mode} actor ${v.actor} ${v.tag} phase ${v.phase}/${v.turnPhase} payload ${v.payload}`);
  for (const b of bad) console.log('BAD', b);
  process.exit(all.size || bad.length ? 1 : 0);
}
