// Character creation (SPEC.md › Character creation: gambling for your stats; Before the run) and the roster
// pick, the mirror, the vault pull and the pet team.
//
// Events (all take an optional playerId so the GM can act for a seat):
//   CHAR_LOOK {name, crest, look}            make or dress the character; names are unique for all time
//   CHAR_CLASS {classId}                     before lock; moves the +1 class stat
//   CHAR_STAT_GAMBLE {stat, chips, mult, gameId}
//        actor-authoritative like ITEM_RESOLVE: the phone has already played the round with the items adapter in
//        chips mode (gameId one of creation.gambleGames: the starter kit's games or 'buyin') and sends the legacy
//        total-return multiplier; this handler does the chip maths (profit = chips × (mult − 1), × the Greed bonus).
//   CHAR_BLOOD {chips}                       once: stake max Health for chips
//   CHAR_LOCK {alloc: {stat: n}}             unstaked chips → points; starter kit; the card shows on the TV
//        After the creation clock (creationDeadline(state)) the TV may append CHAR_LOCK {playerId} as 'system'.
//   CHAR_PICK_ROSTER {rosterEntryId, name?}  a survivor returns as it left; a dead one lends its look and class
//   CHAR_MIRROR {look, crest}                look edits any time except during your own turn
//   VAULT_PULL {itemIds}                     up to grid.vaultPull items from the owner's vault into the grid
//   PET_TEAM {petIds}                        choose the pets to bring (from the owner's roster pets)
// On RUN_START (a runHooks.runStart hook; import this module before the other handler modules) every unlocked
// character gets the safe allocation, and a seat with no character at all gets a default one.
import { register, refuse, requirePhase, requireActor, requirePlayer } from '../reducer.js';
import { characterOf, currentPlayerId, note, activeSeats } from '../state.js';
import { hooks as runHooks } from './run.js';
import { cleanName } from './lobby.js';
import { chips as moveChips, maxHealth as moveMaxHealth, health } from '../health.js';
import { bal } from '../balance.js';
import { newCharacter, setClass, cleanLook, classDef, STAT_IDS, CLASS_IDS, unlockUpgrades, recomputePassives, recomputeSets, WORN_SLOTS, spendStatPoint } from '../characters/character.js';
import { makeWeapon, makeConsumable, weaponDefById, GAMES } from '../characters/generator.js';
import { insert } from '../characters/grid.js';
import { stripSecret } from '../../games/adapter.js';
import { equip, afterWornChange } from './inventory.js';
import classesData from '../../../data/classes.json' with { type: 'json' };

const norm = (s) => String(s || '').trim().toLowerCase();
export function nameTaken(state, name, exceptCharId = null) {
  const n = norm(name); if (!n) return true;
  if ((state.wall || []).some(w => norm(w) === n)) return 'the Wall of Names';
  for (const c of Object.values(state.characters)) if (c.id !== exceptCharId && norm(c.name) === n) return `${c.name} at this table`;
  const self = exceptCharId ? state.characters[exceptCharId] : null;
  for (const e of Object.values(state.roster || {})) if (e.id !== self?.rosterId && norm(e.name) === n) return 'the roster';
  return false;
}
function seat(state, ctx, { phases = ['lobby', 'creation'], needChar = true } = {}) {
  if (phases) requirePhase(state, ...phases);
  const pid = ctx.payload.playerId || ctx.actor; const p = requirePlayer(state, pid); requireActor(state, ctx, pid);
  const c = characterOf(state, pid); if (needChar && !c) refuse('make a character first', 'character');
  return { pid, p, c };
}
const unlocked = (c) => { if (c.locked) refuse('the character is locked in; use the Mirror for looks', 'locked'); };

// The safe allocation: chips become points round-robin, class stat first, never past the creation cap.
export function safeAllocation(ctx, c) {
  const S = ctx.B('stats'), C = ctx.B('creation'); const alloc = {}; let chips = c.chips || 0;
  const order = [...new Set([classDef(c.classId)?.stat, ...STAT_IDS].filter(Boolean))];
  const room = Object.fromEntries(order.map(s => [s, Math.max(0, S.creationCap - c.stats[s])]));
  let guard = 0;
  while (chips > 0 && guard++ < 200) { let placed = false; for (const s of order) { if (chips <= 0) break; if (room[s] >= C.safePointPerChip) { alloc[s] = (alloc[s] || 0) + 1; room[s] -= C.safePointPerChip; chips -= 1; placed = true; } } if (!placed) break; }
  return alloc;
}
function applyAlloc(state, ctx, c, alloc) {
  const S = ctx.B('stats'), C = ctx.B('creation'); let spent = 0;
  for (const [stat, nRaw] of Object.entries(alloc || {})) {
    const n = Math.max(0, Math.round(Number(nRaw) || 0)); if (!STAT_IDS.includes(stat)) refuse(`no such stat ${stat}`); if (!n) continue;
    if (n > c.chips - spent) refuse('not enough chips for that allocation', 'chips');
    const gain = Math.min(n * C.safePointPerChip, S.creationCap - c.stats[stat]); if (gain < n * C.safePointPerChip) refuse(`${stat} would pass the creation cap`, 'cap');
    c.stats[stat] += gain; spent += n;
  }
  if (spent) moveChips(state, c, -spent, 'safe allocation', ctx);
}
// Everyone's Common kit: Coin Blade, Loaded Dice, Mend, two Potions, and the class's starting weapon.
export function giveStarterKit(state, ctx, c) {
  if (c.flags.kitGiven) return; c.flags.kitGiven = true;
  const I = ctx.B('items'), Gb = ctx.B('grid');
  const kit = classesData.starterKit.map(id => makeWeapon(state, weaponDefById(id), { plain: true }));
  const start = classDef(c.classId)?.startWeapon; const classWeapon = start ? makeWeapon(state, weaponDefById(start), { plain: true }) : null;
  if (classWeapon) kit.push(classWeapon);
  kit.push(makeConsumable(state, 'potion', { qty: I.starterPotions }));
  for (const it of kit) { c.items[it.id] = it; if (!insert(c, it, { stackMax: Gb.stack })) { delete c.items[it.id]; } }
  const toWear = classWeapon || kit[0];
  if (toWear && c.items[toWear.id]) { const slot = toWear.slot === 'spell' ? (c.worn.spell1 ? null : 'spell1') : (c.worn.mainhand ? null : 'mainhand'); if (slot) equip(state, ctx, c, toWear, slot); }
  if (!c.worn.mainhand && c.items[kit[0].id]) equip(state, ctx, c, kit[0], 'mainhand');
}
export function lockCharacter(state, ctx, c, alloc = null, { auto = false } = {}) {
  if (c.locked) return c;
  if (!c.classId) refuse('pick a class before locking in', 'class');
  applyAlloc(state, ctx, c, alloc || {});
  if (c.chips > 0) applyAlloc(state, ctx, c, safeAllocation(ctx, c));
  if (c.chips > 0) moveChips(state, c, -c.chips, 'chips left on the table', ctx);
  c.locked = true; c.creation.lockedAt = ctx.now; c.creation.auto = auto;
  giveStarterKit(state, ctx, c); recomputeSets(state, ctx, c); recomputePassives(state, ctx, c);
  note(state, `${c.name} the ${classDef(c.classId).name} locks in${auto ? ' (safe allocation)' : ''}: L${c.stats.luck} N${c.stats.nerve} G${c.stats.greed} T${c.stats.grit}`, 'creation', ctx.now);
  return c;
}

export const creationDeadline = (state) => state.creationOpenedAt ? state.creationOpenedAt + bal(state, 'creation.clockSeconds') * 1000 : null;
export function creationStatus(state, now = state.lastEventTs) {
  const deadline = creationDeadline(state);
  return {
    phase: state.phase, deadline, remainingMs: deadline ? Math.max(0, deadline - now) : null,
    players: activeSeats(state).map(pid => { const p = state.players[pid], c = characterOf(state, pid); return { playerId: pid, name: p.name, ready: p.ready, hasCharacter: !!c, charName: c?.name || null, classId: c?.classId || null, locked: !!c?.locked, chips: c?.chips ?? null, stats: c ? { ...c.stats } : null, level: c?.level ?? null, crest: c?.crest || p.crest, look: c?.look || null, pets: c?.pets?.length || 0, hatching: !!c?.hatching, veteran: !!c?.rosterId }; }),
  };
}

register({
  CHAR_LOOK(state, ev, ctx) {
    const { pid, p, c: existing } = seat(state, ctx, { needChar: false });
    const { name, crest, look } = ctx.payload;
    if (existing) unlocked(existing);
    const clean = cleanName(name); if (!clean) refuse('a name is required', 'name');
    const taken = nameTaken(state, clean, existing?.id); if (taken) refuse(`the name ${clean} is already on ${taken}`, 'name');
    let c = existing;
    if (!c) { c = newCharacter(state, ctx, { playerId: pid, name: clean, look, crest: crest || p.crest }); state.characters[c.id] = c; p.characterId = c.id; }
    c.name = clean; if (crest) { c.crest = String(crest).slice(0, 8); p.crest = c.crest; } if (look) c.look = cleanLook({ ...c.look, ...look });
    note(state, `${p.name} is making ${c.name}`, 'creation', ctx.now);
  },
  CHAR_CLASS(state, ev, ctx) {
    const { c } = seat(state, ctx); unlocked(c);
    if (!CLASS_IDS.includes(ctx.payload.classId)) refuse('no such class', 'class');
    setClass(state, ctx, c, ctx.payload.classId);
  },
  // A creation gamble round mirrored for the TV's Spotlight: the phone publishes the game snapshot (minus its
  // secret) as it plays; CHAR_STAT_GAMBLE clears it.
  CHAR_GAMBLE_STEP(state, ev, ctx) {
    const { c } = seat(state, ctx); unlocked(c);
    const { stat = null, gameId = null, chips = null, game = null, text = null } = ctx.payload;
    c.creation ||= {};
    c.creation.liveGame = { stat, gameId, chips, legacy: game ? stripSecret(game) : null, text: text ? String(text).slice(0, 200) : null, ts: ctx.now };
  },
  // Spend a level-up stat point (any phase with a character; the Self tab shows the pending points).
  CHAR_STAT_POINT(state, ev, ctx) {
    const { c } = seat(state, ctx, { phases: null });
    const { stat } = ctx.payload;
    try { spendStatPoint(state, ctx, c, stat); } catch (e) { refuse(e.message, 'stat'); }
    recomputePassives(state, ctx, c);
    note(state, `${c.name} puts a point into ${stat}`, 'level', ctx.now);
  },
  CHAR_STAT_GAMBLE(state, ev, ctx) {
    const { c } = seat(state, ctx); unlocked(c); if (c.creation) c.creation.liveGame = null;
    const C = ctx.B('creation'), S = ctx.B('stats');
    const { stat, gameId } = ctx.payload; const chipsIn = Math.round(Number(ctx.payload.chips)); const mult = Number(ctx.payload.mult);
    if (!STAT_IDS.includes(stat)) refuse('no such stat', 'stat');
    if (!C.gambleGames.includes(gameId)) refuse(`${gameId} is not a creation game`, 'game');
    if (!Number.isFinite(chipsIn) || chipsIn < C.minStake || chipsIn > C.maxStake) refuse(`stake ${C.minStake} to ${C.maxStake} chips`, 'chips');
    if (chipsIn > c.chips) refuse('not enough chips', 'chips');
    if (!Number.isFinite(mult) || mult < 0) refuse('bad multiplier', 'mult');
    if (c.stats[stat] >= S.creationCap) refuse(`${stat} is already at the creation cap`, 'cap');
    moveChips(state, c, -chipsIn, `gambled on ${gameId}`, ctx);
    let points = 0, back = 0;
    if (mult > 1) {
      // A win: the chips are spent and the stat gains chips × the total-return multiplier (× the Greed bonus).
      const greedBonus = 1 + C.greedPayoutPerPoint * (c.stats.greed - S.neutral);
      points = Math.max(0, Math.round(chipsIn * mult * greedBonus));
      const gain = Math.min(points, S.creationCap - c.stats[stat]); c.stats[stat] += gain; points = gain;
    } else if (mult === 1) { back = chipsIn; moveChips(state, c, back, 'push: stake returned', ctx); }
    else if (mult > 0) { back = Math.round(chipsIn * mult); if (back) moveChips(state, c, back, 'partial return', ctx); }
    c.stats[stat] = Math.max(S.min, c.stats[stat]);
    c.creation.gambles.push({ stat, gameId, chips: chipsIn, mult, points, back, ts: ctx.now });
    c.creation.lastRound = { stat, gameId, chips: chipsIn, mult, points, legacy: ctx.payload.game ? stripSecret(ctx.payload.game) : null, ts: ctx.now };   // for the TV Spotlight
    note(state, points ? `${c.name} wins ${points} ${stat} on ${gameId}` : `${c.name} loses ${chipsIn - back} chip(s) on ${gameId}`, 'creation', ctx.now);
  },
  CHAR_BLOOD(state, ev, ctx) {
    const { c } = seat(state, ctx); unlocked(c);
    const C = ctx.B('creation'); const n = Math.round(Number(ctx.payload.chips));
    if (c.creation.blooded) refuse('the Blood option is once per creation', 'once');
    const maxChips = Math.floor(C.bloodMax / C.bloodHealthPerChip);
    if (!Number.isFinite(n) || n < 1 || n > maxChips) refuse(`stake 1 to ${maxChips} chips of blood`, 'chips');
    moveMaxHealth(state, c, -n * C.bloodHealthPerChip, 'blood for chips', ctx);
    moveChips(state, c, n, 'blood for chips', ctx);
    c.creation.blooded = true; c.creation.bloodStaked = n * C.bloodHealthPerChip;
    note(state, `${c.name} bleeds ${n * C.bloodHealthPerChip} max Health for ${n} chip(s)`, 'creation', ctx.now);
  },
  CHAR_LOCK(state, ev, ctx) {
    const { c } = seat(state, ctx); if (c.locked) refuse('already locked', 'locked');
    const late = creationDeadline(state) != null && ctx.now >= creationDeadline(state);
    lockCharacter(state, ctx, c, ctx.payload.alloc || null, { auto: ctx.isGm && late && !ctx.payload.alloc });
  },
  CHAR_PICK_ROSTER(state, ev, ctx) {
    const { pid, p, c: existing } = seat(state, ctx, { needChar: false });
    if (existing?.locked) refuse('already locked in', 'locked');
    const e = state.roster[ctx.payload.rosterEntryId]; if (!e) refuse('no such roster entry', 'roster');
    if (!ctx.isGm && e.ownerId !== p.rosterOwnerId) refuse('that character is not on your roster', 'forbidden');
    const H = ctx.B('health'), X = ctx.B('xp'), Gb = ctx.B('grid'), R = ctx.B('runs');
    const band = Math.floor((Math.max(1, e.level) - 1) / R.tierLevelBand) + 1;
    if (e.alive && state.tier < band) refuse(`${e.name} is level ${e.level}: tier ${band} or deeper only`, 'tier');
    if (e.alive && Object.values(state.characters).some(o => o.rosterId === e.id && o.id !== existing?.id)) refuse(`${e.name} is already at the table`, 'roster');
    const newName = e.alive ? null : cleanName(ctx.payload.name);
    if (!e.alive) { if (!newName) refuse(`${e.name} is on the Wall: give the new character a name`, 'name'); const taken = nameTaken(state, newName, existing?.id); if (taken) refuse(`the name ${newName} is already on ${taken}`, 'name'); }
    if (existing) delete state.characters[existing.id];
    let c;
    if (e.alive) {
      c = newCharacter(state, ctx, { playerId: pid, name: e.name, look: e.look, classId: null, crest: e.crest || p.crest });
      c.rosterId = e.id; c.classId = e.classId; c.level = Math.max(1, Math.min(X.levelCap, e.level || 1)); c.stats = { ...c.stats, ...e.stats };
      c.maxHealth = H.maxAtLevel1 + (c.level - 1) * H.maxPerLevel; c.health = c.maxHealth;
      c.grid.rows = Gb.rows + Gb.rowLevels.filter(l => l <= c.level).length;
      for (const s of WORN_SLOTS) { const it = e.worn?.[s]; if (it) { c.worn[s] = structuredClone(it); c.items[it.id] = c.worn[s]; } }
      unlockUpgrades(c, X); c.chips = 0; c.locked = true; c.creation.lockedAt = ctx.now; c.veteran = true;
      c.titles = [...(e.titles || [])];
      afterWornChange(state, ctx, c);
    } else {
      c = newCharacter(state, ctx, { playerId: pid, name: newName, look: e.look, classId: e.classId, crest: e.crest || p.crest });
      c.flags.rebornFrom = e.id;
    }
    state.characters[c.id] = c; p.characterId = c.id; p.rosterId = e.alive ? e.id : null;
    const ownerPets = ownedPets(state, p); c.pets = ownerPets.slice(0, teamCap(ctx, c)).map(x => structuredClone(x)); c.activePetId = c.pets[0]?.id || null;
    if (e.alive) giveStarterKit(state, ctx, c);
    note(state, e.alive ? `${c.name} returns at level ${c.level}` : `${p.name} starts over from ${e.name}'s look as ${c.name}`, 'creation', ctx.now);
  },
  CHAR_MIRROR(state, ev, ctx) {
    const { pid, c } = seat(state, ctx, { phases: ['lobby', 'creation', 'playing'] });
    if (state.phase === 'playing' && currentPlayerId(state) === pid) refuse('the mirror is closed during your turn', 'turn');
    if (ctx.payload.look) c.look = cleanLook({ ...c.look, ...ctx.payload.look });
    if (ctx.payload.crest) { c.crest = String(ctx.payload.crest).slice(0, 8); state.players[pid].crest = c.crest; }
  },
  VAULT_PULL(state, ev, ctx) {
    const { p, c } = seat(state, ctx);
    const Gb = ctx.B('grid'); const ids = [...new Set(ctx.payload.itemIds || [])];
    if (!ids.length) refuse('pick items', 'items');
    if ((c.flags.vaultPulled || 0) + ids.length > Gb.vaultPull) refuse(`you may pull ${Gb.vaultPull} items from the vault`, 'vault');
    const entries = Object.values(state.roster).filter(e => e.ownerId === p.rosterOwnerId || ctx.isGm);
    for (const id of ids) {
      const e = entries.find(x => (x.vault || []).some(it => it.id === id)); if (!e) refuse(`${id} is not in your vault`, 'vault');
      const item = structuredClone(e.vault.find(it => it.id === id));
      if (!insert(c, item, { stackMax: Gb.stack })) refuse(`no room in the grid for ${item.name}`, 'room');
      e.vault = e.vault.filter(it => it.id !== id); c.flags.vaultPulled = (c.flags.vaultPulled || 0) + 1;
      note(state, `${c.name} pulls ${item.name} from the vault`, 'creation', ctx.now);
    }
  },
  PET_TEAM(state, ev, ctx) {
    const { p, c } = seat(state, ctx);
    const ids = [...new Set(ctx.payload.petIds || [])]; const pool = ownedPets(state, p);
    if (ids.length > teamCap(ctx, c)) refuse(`you may bring ${teamCap(ctx, c)} pets`, 'pets');
    const team = ids.map(id => pool.find(x => x.id === id) || refuse(`${id} is not on your roster`, 'pets'));
    c.pets = team.map(x => structuredClone(x)); c.activePetId = c.pets[0]?.id || null;
  },
});
export function ownedPets(state, p) { const out = []; for (const e of Object.values(state.roster)) if (e.ownerId === p.rosterOwnerId) for (const pet of e.pets || []) if (!out.some(x => x.id === pet.id)) out.push(pet); return out; }
export function teamCap(ctx, c) { const P = ctx.B('pets'); return c.classId === 'beastmaster' && (c.upgrades || []).includes('carry7') ? P.beastmasterTeamMax : P.teamMax; }

// RUN_START: nobody enters the dungeon half-made.
runHooks.runStart.push((state, ctx) => {
  const seats = activeSeats(state);
  seats.forEach((pid, i) => {
    const p = state.players[pid]; let c = characterOf(state, pid);
    if (!c) {
      let name = cleanName(p.name) || `Player ${i + 1}`; let n = 2; while (nameTaken(state, name)) name = `${cleanName(p.name)} ${n++}`;
      c = newCharacter(state, ctx, { playerId: pid, name, look: { body: i % 3, skin: i % 4, face: i % 8, hair: i % 12 }, classId: CLASS_IDS[i % CLASS_IDS.length], crest: p.crest });
      state.characters[c.id] = c; p.characterId = c.id;
    }
    if (!c.classId) setClass(state, ctx, c, CLASS_IDS[i % CLASS_IDS.length]);
    if (!c.locked) lockCharacter(state, ctx, c, null, { auto: true });
  });
});
export { GAMES };
