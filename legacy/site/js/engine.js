// Game engine (Phases 2–3): board generation, two-stage movement, wrap + Void,
// verb executor, jail (full per-tier), shop exchange (placeholder tier), battle
// and buy-in helpers. Pure-ish: mutates `state`, uses injected rng, no DOM.
import { weightedIndex, weightedPick, shuffle } from './rng.js';
import { log, credit, bal, richest, poorest, currentPlayer, goldValue } from './state.js';
import { rankMap } from './stats.js';
import { tickLoans } from './loans.js';
import { gainPower, hatchEgg, petsOf, petRules, activePet } from './pets.js';

export const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

// ── Board generation (Phase 2) ───────────────────────────────────
export function generateBoard(config, rng) {
  const { cols, rows, tileCounts, colorWeights } = config.Board;
  const n = cols * rows;
  const types = [];
  for (const [type, count] of Object.entries(tileCounts))
    for (let i = 0; i < count; i++) types.push(type);
  if (types.length !== n) throw new Error(`Tile counts sum to ${types.length}, board needs ${n}`);

  const colors = [];
  const colorEntries = Object.entries(colorWeights);
  const colorTotal = colorEntries.reduce((s, [, w]) => s + w, 0);
  // Fill colors proportionally then shuffle
  for (const [color, w] of colorEntries)
    for (let i = 0; i < Math.round((w / colorTotal) * n); i++) colors.push(color);
  while (colors.length < n) colors.push(colorEntries[0][0]);
  colors.length = n;

  const shuffledTypes = shuffle(rng, types);
  // Apply pinned tiles (Board.pins = {index: type}) — swap the wanted type in.
  const pins = config.Board.pins || {};
  const pinnedIdxs = Object.keys(pins).map(Number);
  for (const [idxStr, type] of Object.entries(pins)) {
    const idx = Number(idxStr);
    if (shuffledTypes[idx] === type) continue;
    const from = shuffledTypes.findIndex((t, i) => t === type && !pinnedIdxs.includes(i));
    if (from >= 0) [shuffledTypes[idx], shuffledTypes[from]] = [shuffledTypes[from], shuffledTypes[idx]];
  }
  const shuffledColors = shuffle(rng, colors);
  const board = shuffledTypes.map((type, idx) => ({
    idx,
    number: idx + 1,          // permanent number
    type,                     // volatile under chaos (except JAIL/SHOP keep type)
    color: shuffledColors[idx],
    gameId: null,
  }));
  assignGames(config, rng, board);
  return board;
}

// Every GAME tile carries one of the built minigames (volatile under chaos)
export function builtGames(config) {
  const g = config.Games.filter(x => x.built && !x.hidden);
  return g.length ? g : config.Games.filter(x => x.built);
}
export function assignGames(config, rng, board) {
  const games = builtGames(config);
  for (const t of board) t.gameId = t.type === 'GAME' ? rng.pick(games).id : null;
}

export function startPositions(state) {
  return state.board.filter(t => t.type === 'START').map(t => t.idx);
}

// ── Grid math ────────────────────────────────────────────────────
export function xy(config, idx) { const c = config.Board.cols; return { x: idx % c, y: Math.floor(idx / c) }; }
export function toIdx(config, x, y) {
  const { cols, rows } = config.Board;
  return ((y + rows) % rows) * cols + ((x + cols) % cols);
}
// One step; reports whether an edge was crossed (wrap)
export function stepIdx(config, idx, dir) {
  const { cols, rows } = config.Board;
  const { x, y } = xy(config, idx);
  const [dx, dy] = DIRS[dir];
  const nx = x + dx, ny = y + dy;
  const wrapped = nx < 0 || nx >= cols || ny < 0 || ny >= rows;
  return { idx: toIdx(config, nx, ny), wrapped };
}
// Torus distance (for Magnetism / Exile)
export function torusDist(config, a, b) {
  const { cols, rows } = config.Board;
  const A = xy(config, a), B = xy(config, b);
  const dx = Math.min(Math.abs(A.x - B.x), cols - Math.abs(A.x - B.x));
  const dy = Math.min(Math.abs(A.y - B.y), rows - Math.abs(A.y - B.y));
  return dx + dy;
}

// ── Movement sessions (Phase 2) ──────────────────────────────────
// state.move = { playerId, method, stepsLeft, lastDir, startPos, path[],
//                pendingVoid, reversed, candy:{color,double,dir,matchesLeft}, done }
export function spinMethodWheel(config, state, rng) {
  const p = currentPlayer(state);
  const outcomes = config.Wheel_Method;
  const i = weightedIndex(rng, outcomes);
  const o = outcomes[i];
  state.lastSpin = { wheel: 'Method Wheel', outcomes: outcomes.map(x => x.label), index: i, playerId: p.id, ts: Date.now(), effect: o.desc };
  log(state, 'WHEEL_SPIN', p.id, { wheel: 'Method', outcome: o.label });
  return o;
}

export function beginMove(config, state, rng, method, opts = {}) {
  const p = currentPlayer(state);
  const mv = { playerId: p.id, method: method.verb, label: method.label, startPos: p.pos, path: [p.pos], lastDir: null, pendingVoid: false, reversed: false, done: false, stepsLeft: 0, candy: null, needsTarget: null };
  switch (method.verb) {
    case 'MOVE_DICE':   mv.stepsLeft = rng.int(1, 6); break;
    case 'MOVE_ONE':    mv.stepsLeft = 1; break;
    case 'MOVE_D4':     mv.stepsLeft = rng.int(1, 4); break;
    case 'MOVE_2D6':    mv.stepsLeft = rng.int(1, 6) + rng.int(1, 6); break;
    case 'MOVE_LONGWALK': mv.stepsLeft = config.Config.LongWalkMaxSteps; mv.longWalk = true; break;
    case 'MOVE_STAY':   mv.done = true; break;
    case 'MOVE_TELEPORT': {
      p.pos = rng.int(0, state.board.length - 1);
      mv.path.push(p.pos); mv.done = true; break;
    }
    case 'MOVE_MAGNET': {
      const targets = state.board.filter(t => t.type === 'GOOD' || t.type === 'BAD');
      let best = null, bestD = 1e9;
      for (const t of targets) {
        const d = torusDist(config, p.pos, t.idx);
        if (d < bestD || (d === bestD && t.type === 'BAD' && best && best.type !== 'BAD')) { best = t; bestD = d; }
      }
      if (best) { p.pos = best.idx; mv.path.push(p.pos); }
      mv.done = true; break;
    }
    case 'MOVE_CANDY': {
      const c = weightedPick(rng, config.Wheel_Color);
      mv.candy = { color: c.color, double: !!c.double, matchesLeft: c.double ? 2 : 1, dir: null };
      state.lastSpin = { wheel: 'Color Wheel', outcomes: config.Wheel_Color.map(x => x.label), index: config.Wheel_Color.indexOf(c), playerId: p.id, ts: Date.now(), effect: `Walk to the ${c.double ? 'SECOND' : 'first'} ${c.color} tile in your direction` };
      log(state, 'WHEEL_SPIN', p.id, { wheel: 'Color', outcome: c.label });
      break;
    }
    case 'MOVE_SWAP':   mv.needsTarget = 'swap'; break;
    case 'MOVE_BENEV':  mv.needsTarget = 'benevolence'; mv.stepsLeft = config.Config.BenevolenceSteps; break;
    default: mv.done = true;
  }
  mv.rolled = mv.stepsLeft;
  state.move = mv;
  log(state, 'MOVE', p.id, { method: method.label, steps: mv.stepsLeft, ...(opts.forced ? { forced: true } : {}) });
  return mv;
}

// GM presses a direction. Returns {ok, msg?, arrived?, voidTriggered?, battle?}
export function stepMove(config, state, rng, dir, { override = false } = {}) {
  const mv = state.move;
  if (!mv || mv.done) return { ok: false, msg: 'No active move' };
  if (mv.pendingVoid) return { ok: false, msg: 'Resolve the Void Wheel first' };
  const mover = state.players.find(pl => pl.id === (mv.benevTarget || mv.playerId));
  if (!override && mv.lastDir && dir === OPPOSITE[mv.lastDir])
    return { ok: false, msg: 'No immediate backtrack (GM override available)' };
  if (mv.reversed) dir = OPPOSITE[dir]; // The Long Way: GM keeps pressing intended dir

  const { idx, wrapped } = stepIdx(config, mover.pos, dir);
  mover.pos = idx;
  mv.lastDir = dir;
  mv.path.push(idx);

  if (wrapped && config.Config.VoidEnabled && rng.chance(config.Config.VoidChance)) {
    mv.pendingVoid = true;
    log(state, 'VOID_TRIGGER', mover.id, { at: idx });
    return { ok: true, voidTriggered: true };
  }

  // Candy Land: stop at Nth tile of the color in the chosen direction
  if (mv.candy) {
    const tile = state.board[mover.pos];
    if (tile.color === mv.candy.color) {
      mv.candy.matchesLeft -= 1;
      if (mv.candy.matchesLeft <= 0) { mv.stepsLeft = 0; return finishStep(config, state, mv, mover); }
    }
    // Safety net: a colour that is not on the board (a Sheet typo, or Chaos repainted it away) must not
    // trap the table in an endless walk. After two laps' worth of steps the move simply ends here.
    mv.candy.steps = (mv.candy.steps || 0) + 1;
    if (mv.candy.steps >= state.board.length * 2) { mv.stepsLeft = 0; mv.candy.gaveUp = true; const r = finishStep(config, state, mv, mover); r.msg = `No ${mv.candy.color} tile in reach — the walk ends here.`; return r; }
    return { ok: true }; // keep walking
  }

  // Long Walk: stop on occupied tile → battle (START is a safe zone)
  if (mv.longWalk) {
    const occupant = state.board[mover.pos].type === 'START' ? null
      : state.players.find(pl => pl.id !== mover.id && pl.pos === mover.pos && pl.jailTier === 0);
    if (occupant) { mv.stepsLeft = 0; const r = finishStep(config, state, mv, mover); r.battle = occupant.id; return r; }
  }

  mv.stepsLeft -= 1;
  if (mv.stepsLeft <= 0) return finishStep(config, state, mv, mover);
  return { ok: true };
}

function finishStep(config, state, mv, mover) {
  mv.done = true;
  return { ok: true, arrived: true, pos: mover.pos };
}

// Resolve Void Wheel (call when GM hits the button)
export function spinVoidWheel(config, state, rng) {
  const mv = state.move;
  const p = state.players.find(pl => pl.id === (mv?.benevTarget || mv?.playerId)) || currentPlayer(state);
  const outcomes = config.Wheel_Void;
  const i = weightedIndex(rng, outcomes);
  const o = outcomes[i];
  state.lastSpin = { wheel: 'VOID WHEEL', outcomes: outcomes.map(x => x.label), index: i, playerId: p.id, ts: Date.now() };
  log(state, 'WHEEL_SPIN', p.id, { wheel: 'Void', outcome: o.label });
  if (mv) mv.pendingVoid = false;
  const res = executeVerb(config, state, rng, o, p);
  // Show WHAT HAPPENED loud and clear under the wheel on the player view
  state.lastSpin.effect = res.text || o.desc;
  return { outcome: o, result: res };
}

// ── Tile resolution (what happens on arrival) ────────────────────
export function resolveTile(config, state, player) {
  const tile = state.board[player.pos];
  // START is a safe zone — no collision battles there (everyone begins stacked
  // on it, and returning home shouldn't start a brawl).
  const occupant = tile.type === 'START' ? null
    : state.players.find(pl => pl.id !== player.id && pl.pos === player.pos && pl.jailTier === 0);
  const result = { tile, battleWith: occupant ? occupant.id : null, action: null };
  switch (tile.type) {
    case 'GAME': result.action = 'minigame'; break;
    case 'GOOD': result.action = 'good_wheel'; break;
    case 'BAD':  result.action = 'bad_wheel'; break;
    case 'JAIL':
      sendToJail(config, state, player, 'Landed on JAIL tile');
      result.action = 'jailed'; break;
    case 'SHOP': result.action = 'shop'; break;
    case 'START': result.action = 'start_wheel'; break;
  }
  log(state, 'TILE', player.id, { tile: tile.number, tileType: tile.type, action: result.action });
  return result;
}

// ── Verb executor (Phase 3) ──────────────────────────────────────
export function executeVerb(config, state, rng, outcome, player) {
  const P = outcome.params || {};
  const v = outcome.verb;
  const say = (text) => ({ text });
  switch (v) {
    case 'NOTHING': return say('Nothing happens.');
    case 'GOLD_DELTA':
      credit(state, player, 'Gold', P.amount, outcome.label);
      return say(`${player.name}: ${P.amount > 0 ? '+' : ''}${P.amount} Gold`);
    case 'PCT_GOLD': {
      const amt = Math.round(bal(player, 'Gold') * (P.pct / 100));
      credit(state, player, 'Gold', amt, outcome.label);
      return say(`${player.name}: ${amt >= 0 ? '+' : ''}${amt} Gold (${P.pct}%)`);
    }
    case 'GO_TO_JAIL': {
      if (player.pardons > 0) {
        player.pardons -= 1;
        log(state, 'PARDON_USED', player.id, {});
        return say(`${player.name} burns a PARDON. No jail.`);
      }
      sendToJail(config, state, player, outcome.label);
      return say(`${player.name} goes to Jail 1.`);
    }
    case 'JAIL_ESCALATE': {
      if (player.jailTier >= 4) return say('Already at Jail 4. The wheel is merciful by accident.');
      player.jailTier += 1;
      log(state, 'JAIL_ESCALATE', player.id, { tier: player.jailTier });
      return say(`${player.name} goes deeper: Jail ${player.jailTier}.`);
    }
    case 'JAIL_RELEASE': return releaseFromJail(config, state, player, outcome.label);
    case 'JAIL_TIER_DOWN': {
      player.jailTier -= 1;
      if (player.jailTier <= 0) return releaseFromJail(config, state, player, 'Reduced to freedom');
      log(state, 'JAIL_TIER_DOWN', player.id, { tier: player.jailTier });
      return say(`${player.name} drops to Jail ${player.jailTier}.`);
    }
    case 'JAIL_SKIP_SPIN': player.jailSkipNextSpin = true; return say(`${player.name} sits quietly next turn (no spin).`);
    case 'JAIL_SPIN_TWICE': player.jailSpinsNextTurn = 2; return say(`SOLITARY. ${player.name} spins twice next turn.`);
    case 'COMMISSARY': {
      const amt = player.jailTier <= 2 ? P.t12 : P.t34;
      credit(state, player, 'Gold', amt, 'Commissary');
      return say(`Commissary: +${amt} Gold.`);
    }
    case 'SHAKEDOWN': {
      if (player.jailTier >= 4) {
        const sec = highestSecondary(config, player);
        if (sec) { const amt = player.balances[sec]; player.balances[sec] = 0; log(state, 'DEBIT', player.id, { cur: sec, amount: -amt, why: 'Shakedown T4' }); return say(`Shakedown: loses ALL ${sec} (${amt}).`); }
        return say('Shakedown: no secondaries to take. Lucky.');
      }
      const amt = player.jailTier <= 2 ? P.t12 : P.t3;
      credit(state, player, 'Gold', amt, 'Shakedown');
      return say(`Shakedown: ${amt} Gold.`);
    }
    case 'SKIP_TURN': player.skipTurns += 1; return say(`${player.name} loses their next turn.`);
    case 'BUFF_NEXT_WIN': player.winMult = { mult: P.mult }; return say(`${player.name}'s next game win pays ${P.mult}×.`);
    case 'PARDON_GRANT': player.pardons += 1; return say(`${player.name} holds a PARDON.`);
    case 'SPIN_METHOD_AGAIN': return { text: `${player.name} moves again!`, spinMethodAgain: true };
    case 'SECONDARY_RANDOM_GAIN': {
      const secs = config.Currencies.filter(c => c.active && c.name !== 'Gold');
      const c = rng.pick(secs);
      credit(state, player, c.name, P.units, outcome.label);
      return say(`${player.name}: +${P.units} ${c.name}`);
    }
    case 'SECONDARY_LOSE_RANDOM': {
      const held = Object.entries(player.balances).filter(([k, v2]) => k !== 'Gold' && v2 > 0);
      if (!held.length) return say(`${player.name} holds no secondaries. Nothing to drop.`);
      const [cur] = rng.pick(held);
      const lost = Math.min(P.units, player.balances[cur]);
      credit(state, player, cur, -lost, outcome.label);
      return say(`${player.name} drops ${lost} ${cur}.`);
    }
    case 'STEAL_FROM_RICHEST': {
      const r = richest(config, state, player.id);
      if (!r) return say('No one to rob.');
      credit(state, r, 'Gold', -P.amount, 'Eat The Rich');
      credit(state, player, 'Gold', P.amount, 'Eat The Rich');
      return say(`${player.name} takes ${P.amount} Gold from ${r.name}.`);
    }
    case 'PAY_TO_POOREST': {
      const q = poorest(config, state, player.id);
      if (!q) return say('No one to pay.');
      credit(state, player, 'Gold', -P.amount, 'Charity Case');
      credit(state, q, 'Gold', P.amount, 'Charity Case');
      return say(`${player.name} pays ${P.amount} Gold to ${q.name}.`);
    }
    case 'COLLECTOR': player.collector = { perTurn: P.perTurn, turnsLeft: P.turns }; return say(`The Collector: −${P.perTurn}/turn for ${P.turns} turns.`);
    // ── Pet side-game verbs (Phase 7) ──
    case 'POWER_DELTA': { const got = gainPower(state, player, P.amount, outcome.label); return say(`${player.name}: ${got >= 0 ? '+' : ''}${got} ⚡ Power`); }
    case 'EGG_GRANT': {
      const r = hatchEgg(config, state, rng, player, { free: true });
      if (r.error) { const alt = Number(P.consolation ?? 50); gainPower(state, player, alt, outcome.label); return say(`${player.name}'s team is full — the egg cracks into +${alt} ⚡ Power instead.`); }
      return say(r.text);
    }
    case 'PET_HEAL': { const pets = petsOf(player); for (const pet of pets) { pet.fainted = false; pet.hp = pet.hpMax; } return say(pets.length ? `${player.name}'s pets are fully healed.` : `${player.name} has no pets to heal.`); }
    case 'WILD_ENCOUNTER': {
      if (!petRules(config).enabled || !activePet(player)) { const alt = Number(P.consolation ?? 20); gainPower(state, player, alt, outcome.label); return say(`Something rustles in the grass… but ${player.name} has no pet. +${alt} ⚡ Power for the fright.`); }
      return { text: `A wild creature leaps out at ${player.name}!`, wildEncounter: true };
    }
    case 'TELEPORT_RANDOM': {
      player.pos = rng.int(0, state.board.length - 1);
      if (state.move) state.move.done = true;
      return { text: `${player.name} falls onto tile ${player.pos + 1}.`, resolveTile: true };
    }
    case 'TELEPORT_CHOICE': return { text: `${player.name} may teleport anywhere — GM: click a tile.`, gmPickTile: true };
    case 'FORCED_MARCH': return { text: `GM marches ${player.name} ${P.steps} tiles.`, forcedMarch: P.steps };
    case 'VOID_LONG_WAY': { if (state.move) state.move.reversed = !state.move.reversed; return say('Direction reversed for the rest of this move.'); }
    case 'VOID_EXILE': {
      let best = player.pos, bestD = -1;
      for (const t of state.board) { const d = torusDist(config, player.pos, t.idx); if (d > bestD) { bestD = d; best = t.idx; } }
      player.pos = best;
      if (state.move) state.move.done = true;
      return { text: `EXILED to tile ${best + 1}.`, resolveTile: true };
    }
    case 'VOID_REWIND': {
      if (state.move) { player.pos = state.move.startPos; state.move.done = true; }
      return say('You were never here. Back to where the move started. No tile resolution.');
    }
    default:
      log(state, 'NOTE', player.id, { note: `Unhandled verb ${v}` });
      return { text: `GM adjudicates: ${outcome.label} — ${outcome.desc || ''}`, adjudicate: true };
  }
}

function highestSecondary(config, player) {
  const rates = Object.fromEntries(config.Currencies.map(c => [c.name, c.goldRate]));
  let best = null, bestV = 0;
  for (const [cur, amt] of Object.entries(player.balances)) {
    if (cur === 'Gold' || amt <= 0) continue;
    const v = amt * (rates[cur] ?? 0);
    if (v > bestV) { bestV = v; best = cur; }
  }
  return best;
}

// ── GOOD / BAD wheels ────────────────────────────────────────────
export function spinGoodBad(config, state, rng, which, player) {
  const outcomes = which === 'good' ? config.Wheel_Good : config.Wheel_Bad;
  const i = weightedIndex(rng, outcomes);
  const o = outcomes[i];
  state.lastSpin = { wheel: which === 'good' ? 'GOOD Wheel' : 'BAD Wheel', outcomes: outcomes.map(x => x.label), index: i, playerId: player.id, ts: Date.now() };
  log(state, 'WHEEL_SPIN', player.id, { wheel: which.toUpperCase(), outcome: o.label });
  const res = executeVerb(config, state, rng, o, player);
  state.lastSpin.effect = res.text || o.desc;
  return { outcome: o, result: res };
}

// ── START WHEEL (backlog item — spins on returning to START) ─────
export function spinStartWheel(config, state, rng, player) {
  const outcomes = config.Wheel_Start || [];
  if (!outcomes.length) return null;
  const i = weightedIndex(rng, outcomes);
  const o = outcomes[i];
  state.lastSpin = { wheel: 'START WHEEL', outcomes: outcomes.map(x => x.label), index: i, playerId: player.id, ts: Date.now() };
  log(state, 'WHEEL_SPIN', player.id, { wheel: 'Start', outcome: o.label });
  const res = executeVerb(config, state, rng, o, player);
  state.lastSpin.effect = res.text || o.desc;
  return { outcome: o, result: res };
}

// ── CHAOS (Phase 5) ──────────────────────────────────────────────
// Tiers are config rows (Chaos tab). One level of undo. Jail is a player
// state: jailed players are never freed by a shuffle — they follow to the
// nearest JAIL tile if the cells move.
export function chaosShuffle(config, state, rng, tier, { loud = true } = {}) {
  const def = (config.Chaos || []).find(c => Number(c.tier) === Number(tier));
  if (!def) return { text: `No Chaos tier ${tier} in config.` };
  state.chaosUndo = {
    board: structuredClone(state.board),
    positions: Object.fromEntries(state.players.map(p => [p.id, p.pos])),
    shopRates: structuredClone(state.shopRates),
  };
  const pins = config.Board.pins || {};
  const pinnedIdx = new Set(Object.keys(pins).map(Number));
  const notes = [];

  if (def.specials && config.Config.SpecialTilesShuffle !== false) {
    // shuffle TYPES among unpinned tiles; START never moves (pinned)
    const free = state.board.filter(t => !pinnedIdx.has(t.idx) && t.type !== 'START');
    const types = shuffle(rng, free.map(t => t.type));
    free.forEach((t, i) => { t.type = types[i]; });
    notes.push('special tiles repositioned');
  }
  if (def.colors) {
    const cols = shuffle(rng, state.board.map(t => t.color));
    state.board.forEach((t, i) => { t.color = cols[i]; });
    notes.push('colors repainted');
  }
  if (def.wildcard) {
    const gb = state.board.filter(t => (t.type === 'GOOD' || t.type === 'BAD') && !pinnedIdx.has(t.idx));
    if (gb.length) { const t = rng.pick(gb); t.type = t.type === 'GOOD' ? 'BAD' : 'GOOD'; notes.push(`tile ${t.number} flipped to ${t.type}`); }
  }
  if (def.games || def.specials || def.wildcard) {
    // reassign minigames (also fills tiles that just became GAME)
    assignGames(config, rng, state.board);
    if (def.games) notes.push('minigames reshuffled');
  }
  if (def.shopRates) { state.shopRates = {}; notes.push('shop rates re-rolled'); }
  if (def.positions) {
    for (const p of state.players) if (p.jailTier === 0) p.pos = rng.int(0, state.board.length - 1);
    notes.push('everyone scattered');
  }
  // jailed players follow the cells
  const jails = state.board.filter(t => t.type === 'JAIL');
  for (const p of state.players) {
    if (p.jailTier > 0 && jails.length && state.board[p.pos].type !== 'JAIL') {
      let best = jails[0].idx, bestD = Infinity;
      for (const t of jails) { const d = torusDist(config, p.pos, t.idx); if (d < bestD) { bestD = d; best = t.idx; } }
      p.pos = best;
    }
  }
  if (state.move && !state.move.done) state.move.done = true; // a mid-walk move ends where it stands
  state.chaosFlash = loud ? { tier, label: def.label, ts: Date.now(), desc: notes.join(' · ') } : null;
  log(state, 'CHAOS', null, { tier, label: def.label, loud, notes });
  return { text: `CHAOS T${tier} — ${def.label}: ${notes.join(', ')}`, notes };
}

export function chaosUndo(state) {
  const u = state.chaosUndo;
  if (!u) return { text: 'Nothing to undo.' };
  state.board = u.board;
  for (const p of state.players) if (u.positions[p.id] != null) p.pos = u.positions[p.id];
  state.shopRates = u.shopRates;
  state.chaosUndo = null;
  state.chaosFlash = { tier: 0, label: 'RETCON', ts: Date.now(), desc: 'The last shuffle never happened.' };
  log(state, 'CHAOS_UNDO', null, {});
  return { text: 'Last shuffle undone.' };
}

// Retcon a single tile by GM fiat (type and/or color)
export function retconTile(config, state, rng, idx, { type, color } = {}) {
  const t = state.board[idx];
  if (!t) return { text: 'No such tile.' };
  if (type) { t.type = type; t.gameId = type === 'GAME' ? rng.pick(builtGames(config)).id : null; }
  if (color) t.color = color;
  log(state, 'RETCON', null, { tile: t.number, type: t.type, color: t.color });
  return { text: `Tile ${t.number} is now ${t.type} / ${t.color}.` };
}

// ── JAIL (Phase 3, §5) ───────────────────────────────────────────
export function sendToJail(config, state, player, why) {
  if (player.jailTier === 0) {
    // Physically haul them to the nearest JAIL tile — that's the cell they're
    // held at (and where they resume from after release).
    const jails = state.board.filter(t => t.type === 'JAIL');
    if (jails.length) {
      let best = jails[0].idx, bestD = Infinity;
      for (const t of jails) {
        const d = torusDist(config, player.pos, t.idx);
        if (d < bestD) { bestD = d; best = t.idx; }
      }
      player.pos = best;
    }
    player.jailTier = 1;
    player.jailSpinsNextTurn = 1;
    if (state.move) state.move.done = true;
    log(state, 'JAIL_IN', player.id, { why, heldAt: player.pos + 1 });
  }
}

export function releaseFromJail(config, state, player, why) {
  player.jailTier = 0;
  player.jailSkipNextSpin = false;
  player.jailSpinsNextTurn = 1;
  log(state, 'JAIL_OUT', player.id, { why });
  return { text: `${player.name} is FREE (${why}). Resumes next turn.` };
}

export function jailBuyoutFee(config, player) {
  const key = 'JailBuyoutT' + player.jailTier;
  let fee = config.Config[key] ?? 200 * Math.pow(2, player.jailTier - 1);
  const bribe = player.heldPowerUps.find(pu => pu.id === 'bribe');
  if (bribe) fee = Math.round(fee * 0.5);
  return fee;
}

export function jailBuyout(config, state, player) {
  const fee = jailBuyoutFee(config, player);
  const bribeIdx = player.heldPowerUps.findIndex(pu => pu.id === 'bribe');
  if (bribeIdx >= 0) { player.heldPowerUps.splice(bribeIdx, 1); log(state, 'POWERUP_USED', player.id, { id: 'bribe' }); }
  credit(state, player, 'Gold', -fee, `Jail buyout T${player.jailTier}`);
  log(state, 'JAIL_BUYOUT', player.id, { tier: player.jailTier, fee });
  return releaseFromJail(config, state, player, `Buyout ${fee} Gold`);
}

export function jailSkillCheck(config, state, rng, player, won) {
  const stake = config.Config.JailSkillCheckStake;
  if (won) return releaseFromJail(config, state, player, 'Skill Check won');
  credit(state, player, 'Gold', -stake, 'Skill Check failed');
  return { text: `${player.name} fails the Skill Check. −${stake} Gold, still in Jail ${player.jailTier}.` };
}

export function jailRiskCheck(config, state, rng, player, wager) {
  const min = config.Config.JailRiskMinWager;
  if (wager < min) return { text: `Minimum wager is ${min} Gold.`, error: true };
  const win = rng.chance(0.5);
  state.lastSpin = { wheel: 'DOUBLE OR DETAIN', outcomes: ['FREE + DOUBLE', 'DEEPER'], index: win ? 0 : 1, playerId: player.id, ts: Date.now() };
  if (win) {
    credit(state, player, 'Gold', wager, 'Risk Check won (double back)');
    state.lastSpin.effect = `${player.name} is FREE — wager doubled (+${wager} Gold)`;
    return releaseFromJail(config, state, player, `Risk Check won (+${wager})`);
  }
  credit(state, player, 'Gold', -wager, 'Risk Check lost');
  if (player.jailTier < 4) player.jailTier += 1; // consensual escalation, bypasses cap
  log(state, 'JAIL_ESCALATE', player.id, { tier: player.jailTier, via: 'risk_check' });
  state.lastSpin.effect = `${player.name} loses ${wager} Gold AND sinks to Jail ${player.jailTier}`;
  return { text: `${player.name} loses ${wager} Gold AND sinks to Jail ${player.jailTier}.` };
}

export function jailSocialBarter(config, state, payer, prisoner, debuffChoice) {
  const fee = jailBuyoutFee(config, prisoner);
  credit(state, payer, 'Gold', -fee, `Social Barter for ${prisoner.name}`);
  const debuff = debuffChoice === 'skip'
    ? { tag: `Skip next turn (owed to ${payer.name})` }
    : { tag: `${payer.name} takes 25% of next 3 game wins`, winsLeft: 3, payeeId: payer.id, cut: 0.25 };
  if (debuffChoice === 'skip') prisoner.skipTurns += 1;
  else prisoner.debuffs.push(debuff);
  log(state, 'JAIL_BUYOUT', prisoner.id, { tier: prisoner.jailTier, fee, via: 'social_barter', payer: payer.id });
  return releaseFromJail(config, state, prisoner, `Social Barter (${payer.name} paid ${fee})`);
}

export function spinJailWheel(config, state, rng, player) {
  const tier = player.jailTier;
  const rows = config.Wheel_Jail
    .map(r => ({ ...r, weight: (r.weights?.[tier] ?? r.weights?.[String(tier)] ?? 0) }))
    .filter(r => r.weight > 0 || true); // keep all for the wheel visual; zero-weight can't hit
  // Lockpick: +15 to Escape
  const lock = player.heldPowerUps.findIndex(pu => pu.id === 'lockpick');
  if (lock >= 0) {
    const esc = rows.find(r => r.verb === 'JAIL_RELEASE');
    if (esc) esc.weight += 15;
    player.heldPowerUps.splice(lock, 1);
    log(state, 'POWERUP_USED', player.id, { id: 'lockpick' });
  }
  const i = weightedIndex(rng, rows);
  const o = rows[i];
  state.lastSpin = { wheel: `JAIL WHEEL — Tier ${tier}`, outcomes: rows.map(x => x.label), index: i, playerId: player.id, ts: Date.now() };
  log(state, 'JAIL_SPIN', player.id, { tier, outcome: o.label });
  const res = executeVerb(config, state, rng, o, player);
  state.lastSpin.effect = res.text || o.desc;
  return { outcome: o, result: res };
}

// ── BATTLE (Phase 3, §7) ─────────────────────────────────────────
export function spinBattleWheel(config, state, rng, aId, bId) {
  const outcomes = config.Wheel_Battle;
  const i = weightedIndex(rng, outcomes);
  const o = outcomes[i];
  state.lastSpin = { wheel: 'BATTLE WHEEL', outcomes: outcomes.map(x => x.label), index: i, playerId: aId, ts: Date.now() };
  log(state, 'BATTLE', aId, { vs: bId, contest: o.label });
  let category = null;
  if (o.spinCategory) {
    const ci = weightedIndex(rng, config.Wheel_Category);
    category = config.Wheel_Category[ci].label;
    log(state, 'WHEEL_SPIN', aId, { wheel: 'Category', outcome: category });
  }
  state.lastSpin.effect = category
    ? `Name 10 — Category: ${category}`
    : `${o.pool} contest — winner takes the pot`;
  return { contest: o, category };
}

// wagers: [{playerId, cur, amount}] — unequal + multi-currency allowed.
// winnerId takes every stake; refusal = forfeiter's stakes go to the other side.
// Gold-equivalent value of a battle wager (secondaries valued at GoldRate).
export function wagerGoldValue(config, w) {
  const rate = config.Currencies.find(c => c.name === w.cur)?.goldRate ?? 0;
  return Number(w.amount) * rate;
}

export function settleBattle(config, state, wagers, winnerId, { forfeitId = null } = {}) {
  const min = Number(config.Config.BattleMinWager) || 0;
  // §7: battle wager floor = table minimum, in Gold-equivalent. No 1-Gold cowardice.
  for (const w of wagers) {
    const p = state.players.find(pl => pl.id === w.playerId);
    if (!(Number(w.amount) > 0) || wagerGoldValue(config, w) < min)
      return { text: `${p ? p.name : 'A player'}'s wager is under the ${min} Gold floor.`, error: true };
    if (p && w.cur !== 'Gold' && bal(p, w.cur) < w.amount)
      return { text: `${p.name} only holds ${bal(p, w.cur)} ${w.cur}.`, error: true };
  }
  for (const w of wagers) {
    const p = state.players.find(pl => pl.id === w.playerId);
    if (!p) continue;
    credit(state, p, w.cur, -w.amount, 'Battle wager');
  }
  const winner = state.players.find(pl => pl.id === winnerId);
  for (const w of wagers) credit(state, winner, w.cur, w.amount, 'Battle pot');
  log(state, 'BATTLE', winnerId, { won: true, forfeitBy: forfeitId, pot: wagers });
  return { text: `${winner.name} takes the pot.` };
}

// ── BUY-IN / AUCTION (Phase 3, §8) ───────────────────────────────
export function spinBuyInWheel(config, state, rng, player) {
  const outcomes = config.Wheel_BuyIn;
  const i = weightedIndex(rng, outcomes);
  const o = outcomes[i];
  state.lastSpin = { wheel: 'BUY-IN WHEEL', outcomes: outcomes.map(x => x.label), index: i, playerId: player.id, ts: Date.now(), effect: o.desc };
  log(state, 'WHEEL_SPIN', player.id, { wheel: 'BuyIn', outcome: o.label });
  return o;
}

// Generic auction settlement: seller sells `amount` of `cur` to buyer for `price` Gold.
export function settleAuctionLot(config, state, sellerId, buyerId, cur, amount, price) {
  const seller = state.players.find(p => p.id === sellerId);
  const buyer = state.players.find(p => p.id === buyerId);
  credit(state, seller, cur, -amount, 'Auction lot sold');
  credit(state, buyer, cur, amount, 'Auction lot won');
  credit(state, buyer, 'Gold', -price, 'Auction payment');
  credit(state, seller, 'Gold', price, 'Auction proceeds');
  log(state, 'AUCTION', sellerId, { buyer: buyerId, cur, amount, price });
  return { text: `${buyer.name} wins ${amount} ${cur} for ${price} Gold.` };
}

// ── SHOP (placeholder tier: exchange only — Phase 2/3) ───────────
export function shopOffers(config, state, rng) {
  const sc = config.ShopConfig;
  const secs = config.Currencies.filter(c => c.active && c.name !== 'Gold');
  const pool = shuffle(rng, secs).slice(0, sc.currenciesPerVisit);
  const offers = [];
  for (const c of pool) {
    if (!(c.name in state.shopRates)) {
      const mult = sc.rateMin + rng.next() * (sc.rateMax - sc.rateMin);
      state.shopRates[c.name] = Math.round(c.goldRate * mult * 100) / 100;
    }
    offers.push({ name: c.name, emoji: c.emoji, goldRate: c.goldRate, sessionRate: state.shopRates[c.name] });
  }
  return { offers, bounds: { min: sc.rateMin, max: sc.rateMax } };
}

// dir: 'buy' (gold→secondary) or 'sell'. Bidirectional at shown rate, no house cut.
export function shopExchange(config, state, player, curName, units, dir) {
  const rate = state.shopRates[curName];
  if (rate == null) return { text: 'That currency is not on offer.', error: true };
  const goldAmt = Math.round(units * rate);
  if (dir === 'buy') {
    credit(state, player, 'Gold', -goldAmt, `Shop buy ${units} ${curName}`);
    credit(state, player, curName, units, 'Shop buy');
  } else {
    if (bal(player, curName) < units) return { text: `Not enough ${curName}.`, error: true };
    credit(state, player, curName, -units, 'Shop sell');
    credit(state, player, 'Gold', goldAmt, `Shop sell ${units} ${curName}`);
  }
  log(state, 'SHOP_EXCHANGE', player.id, { cur: curName, units, dir, rate, goldAmt });
  return { text: `${player.name} ${dir === 'buy' ? 'buys' : 'sells'} ${units} ${curName} @ ${rate} → ${goldAmt} Gold` };
}

// GM tool: move any currency from one player to another (side bets, IOUs,
// "I'll pay your buyout", table adjudications). Gold may go negative like
// everywhere else; secondaries must actually be held.
export function transfer(config, state, from, to, curName, amount, why = 'GM transfer') {
  amount = Math.round(Number(amount));
  if (!from || !to || from.id === to.id) return { text: 'Pick two different players.', error: true };
  if (!(amount > 0)) return { text: 'Amount must be positive.', error: true };
  if (curName !== 'Gold' && bal(from, curName) < amount) return { text: `${from.name} only has ${bal(from, curName)} ${curName}.`, error: true };
  credit(state, from, curName, -amount, `${why} → ${to.name}`);
  credit(state, to, curName, amount, `${why} ← ${from.name}`);
  log(state, 'TRANSFER', from.id, { toId: to.id, cur: curName, amount, why });
  return { text: `${from.name} → ${to.name}: ${amount} ${curName}` };
}

// ── Turn engine ──────────────────────────────────────────────────
// Returns instructions for the GM UI about what this turn is.
export function beginTurn(config, state) {
  const p = currentPlayer(state);
  const notes = [];
  if (p.collector && p.collector.turnsLeft > 0) {
    credit(state, p, 'Gold', -p.collector.perTurn, 'The Collector');
    p.collector.turnsLeft -= 1;
    notes.push(`The Collector takes ${p.collector.perTurn} Gold (${p.collector.turnsLeft} left).`);
    if (p.collector.turnsLeft <= 0) p.collector = null;
  }
  notes.push(...tickLoans(config, state, p));      // debt doesn't sleep: ticks even on skipped / jailed turns
  if (p.skipTurns > 0) {
    p.skipTurns -= 1;
    notes.push(`${p.name} sits this turn out.`);
    return { kind: 'skip', notes };
  }
  if (p.jailTier > 0) {
    if (p.jailSkipNextSpin) { p.jailSkipNextSpin = false; notes.push(`${p.name} sits quietly in Jail ${p.jailTier} (no spin).`); return { kind: 'skip', notes }; }
    const spins = p.jailSpinsNextTurn || 1;
    p.jailSpinsNextTurn = 1;
    return { kind: 'jail', spins, notes };
  }
  return { kind: 'move', notes };
}

// Pass config so the leaderboard can show who climbed / fell since the round began.
export function endTurn(state, config = null) {
  state.move = null;
  state.turnIdx += 1;
  if (state.turnIdx % state.turnOrder.length === 0) {
    state.round += 1;
    if (config) state.rankSnapshot = rankMap(config, state);
  }
  state.turnStartedTs = Date.now();                 // the shot clock (turns.js) starts for the next player
  log(state, 'TURN_END', null, { next: state.turnIdx });
}
