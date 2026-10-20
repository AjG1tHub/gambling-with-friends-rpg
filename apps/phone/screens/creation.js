// Character creation on the phone (SPEC.md › Character creation: gambling for your stats; Before the run; Roster).
// A stepper: Look → Class → Stats (the chip gamble, played right here with the items adapter in chips mode) →
// Blood option → Lock in (safe allocation) → vault pull, pet team, the setup hatch, Ready. The roster pick sits
// above the stepper while nothing is locked. After the lock the character card shows and we wait for the GM.
import { h, toast, fmtTime, store } from '../../../packages/ui/dom.js';
import { characterOf } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { creationDeadline, nameTaken, ownedPets, teamCap, safeAllocation } from '../../../packages/shared/handlers/creation.js';
import { CLASSES, LOOK_RANGES, STAT_IDS } from '../../../packages/shared/characters/character.js';
import { startRound, gameMeta } from '../../../packages/games/adapter.js';
import { liveRound, dropRound, peekRound, roundView, seedFor } from '../../../packages/ui/minigame.js';
import { wheelStrip } from '../../../packages/ui/dice.js';
import { sect, why, amountPicker, itemRow, statLabel, countdown, hatchingScreen, redraw } from './prompts.js';

const CRESTS = ['🂡', '🂱', '🃁', '🃑', '🃏', '🎴', '🀄', '🎲', '🎰', '🪙', '🔔', '💎', '👑', '🕯', '🐦', '🩸', '⚔', '🪦', '🦊', '🐺', '🦇', '🐍', '🦂', '🕷'];
const COATS = ['#5a1218', '#1c1614', '#2a3a5a', '#3f8a73', '#6b3fa0', '#9c7a2e', '#7a1a22', '#c9bfae'];
// The Buy-in Wheel as a chip gamble: eight segments from creation.buyinMultipliers (two blanks by default).
const buyinMults = (state) => { try { const v = group(state, 'creation').buyinMultipliers; if (Array.isArray(v) && v.length) return v; } catch { /* fall through */ } return [0, 0.5, 1, 1.5, 2, 2.5, 3, 0]; };
// Draft look kept across re-renders; seeded from the last character this phone made.
const draft = Object.assign({ name: '', crest: CRESTS[0], look: { body: 0, skin: 0, face: 0, hair: 0, coat: COATS[0] }, step: null, stat: null, game: null, chips: 1, alloc: {}, nameNote: '', nameOk: null, vaultPick: new Set(), petPick: null }, store.get('gwfrpg:phone:draft') || {});
draft.vaultPick = new Set(); draft.petPick = null;
let spriteMod = null, spriteTried = false;
function loadSprite() { if (spriteTried) return; spriteTried = true; import('../../../packages/ui/sprite.js').then(m => { spriteMod = m; }).catch(() => { spriteMod = null; }); }

export function creationScreen(api) {
  const { state, session, me, player, c, h, dispatch, screen } = api;
  loadSprite();
  const creation = state.phase === 'creation';
  const deadline = creationDeadline(state);
  const head = h('div', { class: 'cr-head' }, h('div', { class: 'tag' }, creation ? 'Character creation' : 'The lobby'), deadline && creation ? countdown(deadline, 'on the clock') : h('span', { class: 'muted ital' }, 'waiting for the GM to open creation'));
  screen.append(head);
  if (player.spectator) { screen.append(h('p', { class: 'muted center' }, 'You are watching and wagering; no character to make.')); return; }
  if (c?.hatching) { screen.append(hatchingScreen(api)); return; }
  if (c?.locked) { lockedView(api); return; }
  if (!creation) { lobbyView(api); return; }
  const step = draft.step || (!c ? 'look' : !c.classId ? 'class' : 'stats');
  screen.append(stepper(step, c, (s) => { draft.step = s; redraw(api); }));
  if (!c || step === 'roster') rosterPick(api);
  if (step === 'look') lookStep(api);
  else if (step === 'class') classStep(api);
  else if (step === 'stats') statsStep(api);
  else if (step === 'lock') lockStep(api);
}

function stepper(step, c, go) {
  const steps = [['look', 'Look'], ['class', 'Class'], ['stats', 'Stats'], ['lock', 'Lock in']];
  const reach = { look: true, class: !!c, stats: !!c?.classId, lock: !!c?.classId };
  return h('div', { class: 'stepper' }, steps.map(([id, label], i) => h('button', { class: `step ${step === id ? 'on' : ''} ${reach[id] ? '' : 'off'}`, disabled: !reach[id], onClick: () => go(id) }, h('b', {}, String(i + 1)), label)));
}

// ── roster ────────────────────────────────────────────────────────────────────────────────────────
function rosterPick(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const entries = Object.values(state.roster || {}).filter(e => e.ownerId && e.ownerId === api.player.rosterOwnerId);
  if (!entries.length) return;
  const box = sect('Your roster', h('p', { class: 'muted ital' }, 'A survivor returns as it left. A dead one lends its look and class under a new name, and gambles its stats again.'));
  for (const e of entries) {
    const row = h('div', { class: 'roster-row' }, h('div', { class: 'body' }, h('b', {}, `${e.crest || '🂠'} ${e.name}`), h('span', { class: 'meta' }, `${e.classId || '?'} · level ${e.level} · ${e.alive ? 'survivor' : 'on the Wall'}${e.alive ? ` · L${e.stats?.luck} N${e.stats?.nerve} G${e.stats?.greed} T${e.stats?.grit}` : ''}`)));
    if (e.alive) row.append(h('button', { class: 'primary', onClick: () => dispatch('CHAR_PICK_ROSTER', { rosterEntryId: e.id }) }, 'Return'));
    else {
      const input = h('input', { placeholder: 'New name', maxlength: 18, 'aria-label': 'New name' });
      row.append(h('div', { class: 'col grow' }, input, h('button', { onClick: () => { const n = input.value.trim(); if (!n) return toast('A new name is required', 'bad'); dispatch('CHAR_PICK_ROSTER', { rosterEntryId: e.id, name: n }); } }, 'Start over as…')));
    }
    box.append(row);
  }
  screen.append(box);
}

// ── Look ──────────────────────────────────────────────────────────────────────────────────────────
function previewSprite(c, look, classId) {
  const fake = { name: draft.name || 'you', look, classId: classId || c?.classId || null, worn: c?.worn || {}, health: 100, maxHealth: 100, pets: [], dead: false, effects: [] };
  if (spriteMod?.spriteElement) { try { return spriteMod.spriteElement(fake, { scale: 2, pets: false }); } catch { /* fall through */ } }
  // Layered-colour placeholder: body, coat, face, hair as stacked blocks.
  const skins = ['#e8c9a8', '#c9956a', '#8a5a3a', '#4a2e22'], hairs = ['#1a1412', '#3a2a1a', '#8a5a2a', '#c9a45c', '#e9e1cf', '#7a1a22', '#2a3a5a', '#3f8a73', '#6b3fa0', '#9a917f', '#f0b66a', '#d13c9f'];
  return h('div', { class: 'sprite-ph', 'aria-label': 'character preview' },
    h('div', { class: 'hair', style: { background: hairs[look.hair % hairs.length], height: `${12 + (look.hair % 4) * 4}px` } }),
    h('div', { class: 'head', style: { background: skins[look.skin % skins.length], width: `${34 + look.body * 4}px` } }, h('span', {}, ['·_·', '-_-', '^_^', 'o_o', '>_<', '¬_¬', '•‿•', 'x_x'][look.face % 8])),
    h('div', { class: 'coat', style: { background: look.coat, width: `${38 + look.body * 8}px` } }));
}
function lookStep(api) {
  const { state, session, me, c, h, dispatch, screen } = api;
  if (c) { draft.name = c.name; draft.crest = c.crest || draft.crest; draft.look = { ...draft.look, ...(c.look || {}) }; }
  const box = sect('Look');
  const preview = h('div', { class: 'cr-preview' });
  const drawPreview = () => preview.replaceChildren(previewSprite(c, draft.look, c?.classId));
  drawPreview();
  const note = h('p', { class: `why ${draft.nameOk === false ? 'bad' : draft.nameOk ? 'ok' : 'muted'} ital` }, draft.nameNote || 'Names are one of a kind, for all time.');
  let timer = null;
  const check = async (name) => {
    draft.nameOk = null; draft.nameNote = ''; note.textContent = 'checking…'; note.className = 'why muted ital';
    const local = nameTaken(state, name, c?.id);
    if (local) { draft.nameOk = false; draft.nameNote = `${name} is already on ${local}`; note.textContent = draft.nameNote; note.className = 'why bad ital'; return; }
    let onWall = false; try { onWall = !!(await session?.backend?.wall?.taken?.(name)); } catch { onWall = false; }
    if (onWall) { draft.nameOk = false; draft.nameNote = `${name} is on the Wall of Names`; note.className = 'why bad ital'; }
    else { draft.nameOk = true; draft.nameNote = `${name} is free`; note.className = 'why ok ital'; }
    note.textContent = draft.nameNote;
  };
  const input = h('input', { placeholder: 'Character name', maxlength: 18, value: draft.name, autocomplete: 'off', 'aria-label': 'Character name', onInput: (e) => { draft.name = e.target.value; clearTimeout(timer); if (draft.name.trim()) timer = setTimeout(() => check(draft.name.trim()), 350); } });
  box.append(input, note);
  // crest
  const crestRow = h('div', { class: 'crests' });
  const drawCrests = () => crestRow.replaceChildren(...CRESTS.map(x => h('button', { class: `crest-btn ${draft.crest === x ? 'on' : ''}`, 'aria-label': `crest ${x}`, onClick: () => { draft.crest = x; drawCrests(); } }, x)));
  drawCrests();
  box.append(h('div', { class: 'tag' }, 'Crest'), crestRow);
  // body steppers
  const steppers = h('div', { class: 'look-steppers' });
  for (const [k, n] of Object.entries(LOOK_RANGES)) {
    const val = h('b', {}, String((draft.look[k] ?? 0) + 1));
    const set = (d) => { draft.look[k] = (((draft.look[k] ?? 0) + d) % n + n) % n; val.textContent = String(draft.look[k] + 1); drawPreview(); };
    steppers.append(h('div', { class: 'look-step' }, h('span', { class: 'tag' }, k), h('button', { class: 'ghost', 'aria-label': `previous ${k}`, onClick: () => set(-1) }, '‹'), val, h('span', { class: 'muted' }, `/${n}`), h('button', { class: 'ghost', 'aria-label': `next ${k}`, onClick: () => set(1) }, '›')));
  }
  const coats = h('div', { class: 'coats' });
  const drawCoats = () => coats.replaceChildren(...COATS.map(col => h('button', { class: `coat-btn ${draft.look.coat === col ? 'on' : ''}`, style: { background: col }, 'aria-label': `coat ${col}`, onClick: () => { draft.look.coat = col; drawCoats(); drawPreview(); } })), h('input', { type: 'color', value: draft.look.coat || COATS[0], 'aria-label': 'any coat colour', onInput: (e) => { draft.look.coat = e.target.value; drawCoats(); drawPreview(); } }));
  drawCoats();
  box.append(h('div', { class: 'row cr-lookrow' }, preview, steppers), h('div', { class: 'tag' }, 'Coat'), coats);
  box.append(h('button', { class: 'primary big', onClick: async () => {
    const name = draft.name.trim(); if (!name) return toast('Pick a name', 'bad');
    if (draft.nameOk === false) return toast(draft.nameNote, 'bad');
    store.set('gwfrpg:phone:draft', { name, crest: draft.crest, look: draft.look });
    const ok = await dispatch('CHAR_LOOK', { name, crest: draft.crest, look: { ...draft.look } });
    if (ok) draft.step = 'class';
  } }, c ? 'Save the look' : 'That is me →'));
  screen.append(box);
}

// ── Class ─────────────────────────────────────────────────────────────────────────────────────────
function classStep(api) {
  const { c, h, dispatch, screen } = api;
  const box = sect('Class', h('p', { class: 'muted ital' }, 'Fixes your starting weapon and gives +1 to its stat.'));
  for (const k of CLASSES) {
    box.append(h('button', { class: `class-card ${c?.classId === k.id ? 'on' : ''}`, onClick: async () => { const ok = await dispatch('CHAR_CLASS', { classId: k.id }); if (ok) draft.step = 'stats'; } },
      h('div', { class: 'row between' }, h('b', { class: 'nm' }, k.name), h('span', { class: 'pill gold' }, `+1 ${statLabel(k.stat)}`)),
      h('span', { class: 'meta ital' }, k.playsLike), h('span', { class: 'meta' }, h('i', {}, 'Passive: '), k.passive.text), h('span', { class: 'meta' }, h('i', {}, `${k.active.name}: `), k.active.text),
      h('span', { class: 'meta faint' }, `Starts with ${k.startWeapon}`)));
  }
  screen.append(box);
}

// ── Stats: the gamble ─────────────────────────────────────────────────────────────────────────────
function statsStep(api) {
  const { state, c, h, dispatch, screen } = api;
  const C = group(state, 'creation'), S = group(state, 'stats');
  const games = (C.gambleGames || ['fifty', 'dice', 'hilo']);
  const box = sect('Stats — the gamble');
  box.append(h('div', { class: 'row between' }, h('div', { class: 'chips-left' }, h('b', {}, String(c.chips ?? 0)), ' chips'), h('span', { class: 'muted' }, `cap ${S.creationCap} · max Health ${c.maxHealth}`)));
  const statRow = h('div', { class: 'stat-chips' }, STAT_IDS.map(s => h('button', { class: `stat-chip ${draft.stat === s ? 'on' : ''} ${c.stats[s] >= S.creationCap ? 'capped' : ''}`, disabled: c.stats[s] >= S.creationCap, title: c.stats[s] >= S.creationCap ? 'at the creation cap' : '', onClick: () => { draft.stat = s; redraw(api); } }, h('span', { class: 'tag' }, statLabel(s)), h('b', {}, String(c.stats[s])))));
  box.append(statRow);
  const liveKey = `creation:${c.id}:${c.creation?.gambles?.length || 0}`;
  const live = [...(['fifty', 'dice', 'hilo', 'buyin', ...games])].map(g => `${liveKey}:${g}`).map(k => ({ k, r: peekRound(k) })).find(x => x.r);
  if (live) { screen.append(box); gambleRound(api, live.k, live.r); return; }
  if (c.chips <= 0) box.append(why('No chips left to stake. Lock in to finish.'));
  else if (!draft.stat) box.append(why('Pick a stat to gamble on, or lock in to turn your chips into points one for one.'));
  else {
    box.append(h('div', { class: 'tag' }, `Game for ${statLabel(draft.stat)}`),
      h('div', { class: 'chips' }, games.map(g => { const m = g === 'buyin' ? { icon: '🎡', name: 'Buy-in Wheel' } : gameMeta(g); return h('button', { class: `chip ${draft.game === g ? 'on' : ''}`, onClick: () => { draft.game = g; redraw(api); } }, `${m.icon} ${m.name}`); })));
    if (draft.game) {
      const amt = amountPicker({ value: Math.min(draft.chips || 1, c.chips, C.maxStake), min: C.minStake, max: Math.min(C.maxStake, c.chips), label: 'Stake (chips)', onChange: (v) => { draft.chips = v; } });
      box.append(amt, h('button', { class: 'primary big', onClick: () => {
        const chips = amt.value(); const key = `${liveKey}:${draft.game}`;
        if (draft.game === 'buyin') { liveRound(key, () => makeBuyinSpin(chips, buyinMults(state).length)); }
        else liveRound(key, () => startRound({ state, B: (g) => group(state, g) }, { gameId: draft.game, mode: 'chips', stake: chips, attacker: c, rng: makeRng(hash32(seedFor('creation', c.id, draft.game, Date.now()))), now: Date.now(), holdPending: false }));
        redraw(api);
      } }, `Play for ${statLabel(draft.stat)}`), why(`A win pays chips × the game's multiplier into ${statLabel(draft.stat)}; a loss burns them.${c.stats.greed > S.neutral ? ` Greed ${c.stats.greed} adds ${Math.round(C.greedPayoutPerPoint * (c.stats.greed - S.neutral) * 100)}%.` : ''}`));
    }
  }
  if (c.creation?.gambles?.length) box.append(h('div', { class: 'gamble-log' }, c.creation.gambles.slice(-5).map(g => h('div', { class: g.points ? 'ok' : 'bad' }, `${gameMeta(g.gameId).icon} ${statLabel(g.stat)}: ${g.chips} chips → ${g.points ? `+${g.points}` : g.back ? `${g.back} back` : 'lost'}`))));
  // Blood option
  const bloodMax = Math.floor(C.bloodMax / C.bloodHealthPerChip);
  if (!c.creation?.blooded) {
    const bl = amountPicker({ value: 1, min: 1, max: bloodMax, label: `Blood option: ${C.bloodHealthPerChip} max Health per chip, once` });
    box.append(h('div', { class: 'hr' }), bl, h('button', { class: 'danger big', onClick: () => dispatch('CHAR_BLOOD', { chips: bl.value() }) }, '🩸 Bleed for chips'));
  } else box.append(why(`Blood spent: −${c.creation.bloodStaked} max Health.`));
  box.append(h('div', { class: 'hr' }), h('button', { class: 'big', onClick: () => { draft.step = 'lock'; redraw(api); } }, c.chips > 0 ? `Lock in with ${c.chips} safe chip${c.chips === 1 ? '' : 's'} →` : 'Lock in →'));
  screen.append(box);
}

// A round in flight: render the controls, send CHAR_STAT_GAMBLE once it settles.
function gambleRound(api, key, entry) {
  const { state, c, h, dispatch, screen } = api;
  const gameId = key.split(':').pop();
  const finish = async (mult, label) => {
    if (entry.resolved) return; entry.resolved = true;
    const ok = await dispatch('CHAR_STAT_GAMBLE', { stat: draft.stat || entry.stat, chips: entry.chips ?? entry.round.stake, mult, gameId });
    dropRound(key); draft.game = null; if (!ok) redraw(api);
  };
  entry.stat ||= draft.stat;
  const box = sect(`${gameMeta(gameId === 'buyin' ? 'bigwheel' : gameId).icon} ${gameId === 'buyin' ? 'Buy-in Wheel' : gameMeta(gameId).name} for ${statLabel(entry.stat)}`);
  if (gameId === 'buyin') {
    const spin = entry.round;
    const BUYIN_MULTS = buyinMults(api.state);
    const strip = wheelStrip({ outcomes: BUYIN_MULTS.map(m => `${m}×`), index: spin.index, title: `${spin.chips} chips on the wheel` });
    if (!spin.spun) { strip.querySelector('.seg.hit')?.classList.remove('hit'); box.append(strip, h('button', { class: 'primary big', onClick: () => { spin.spun = true; animateStrip(strip, spin.index, () => finish(BUYIN_MULTS[spin.index], `${BUYIN_MULTS[spin.index]}×`)); } }, '🎡 Spin the Buy-in Wheel')); }
    else box.append(strip, why('Spinning…'));
    screen.append(box); return;
  }
  const round = entry.round;
  const view = roundView({ round, now: Date.now(), stage: true, onAct: (a, p) => { round.act(a, p, Date.now()); afterAct(); }, onFork: (i) => { round.pickFork(i); afterAct(); } });
  const afterAct = () => { if (round.done) { const o = round.outcome(); const wait = Math.max(0, (round.revealAt?.() || 0) - Date.now()) + 900; setTimeout(() => finish(o.mult, o.label), wait); } redraw(api); };
  box.append(view);
  if (round.done && !entry.resolved) box.append(why('Settling…'));
  screen.append(box);
  if (round.done && !entry.resolved && !entry.timer) { entry.timer = true; const o = round.outcome(); setTimeout(() => finish(o.mult, o.label), Math.max(0, (round.revealAt?.() || 0) - Date.now()) + 900); }
}
function makeBuyinSpin(chips, n = 8) { return { chips, index: Math.floor(Math.random() * n), spun: false, stake: chips, done: false }; }
function animateStrip(strip, index, onDone) {
  const segs = [...strip.querySelectorAll('.seg')]; let i = 0, n = 0; const total = segs.length * 3 + index;
  const tick = () => { segs.forEach(s => s.classList.remove('hit')); segs[i % segs.length].classList.add('hit'); if (n++ >= total) { onDone(); return; } i++; setTimeout(tick, 40 + n * 6); };
  tick();
}

// ── Lock in ───────────────────────────────────────────────────────────────────────────────────────
function lockStep(api) {
  const { state, c, h, dispatch, screen } = api;
  const S = group(state, 'stats'), C = group(state, 'creation');
  const box = sect('Lock in', h('p', { class: 'muted ital' }, `Each unstaked chip is +${C.safePointPerChip} to a stat of your choice (never past ${S.creationCap}). Anything you leave unplaced is spread for you.`));
  const alloc = draft.alloc; for (const s of STAT_IDS) alloc[s] = Math.min(alloc[s] || 0, Math.max(0, S.creationCap - c.stats[s]));
  const spent = () => STAT_IDS.reduce((a, s) => a + (alloc[s] || 0), 0);
  const left = h('b', {}, String(c.chips - spent()));
  const rows = h('div', { class: 'alloc' });
  const drawRows = () => {
    left.textContent = String(c.chips - spent());
    rows.replaceChildren(...STAT_IDS.map(s => {
      const room = S.creationCap - c.stats[s] - (alloc[s] || 0);
      return h('div', { class: 'alloc-row' }, h('span', { class: 'tag' }, statLabel(s)), h('b', {}, String(c.stats[s])), h('span', { class: 'plus' }, alloc[s] ? `+${alloc[s]}` : ''),
        h('button', { class: 'ghost', disabled: !alloc[s], 'aria-label': `less ${s}`, onClick: () => { alloc[s]--; drawRows(); } }, '−'),
        h('button', { class: 'ghost', disabled: room <= 0 || spent() >= c.chips, 'aria-label': `more ${s}`, onClick: () => { alloc[s] = (alloc[s] || 0) + 1; drawRows(); } }, '+'));
    }));
  };
  drawRows();
  box.append(h('div', { class: 'row between' }, h('span', {}, 'Chips to place: ', left), h('button', { class: 'ghost', onClick: () => { for (const s of STAT_IDS) alloc[s] = 0; const auto = safeAllocation({ B: (g) => group(state, g) }, c); Object.assign(alloc, auto); drawRows(); } }, 'Spread for me')), rows);
  box.append(h('button', { class: 'primary big', onClick: async () => { const a = {}; for (const s of STAT_IDS) if (alloc[s]) a[s] = alloc[s]; const ok = await dispatch('CHAR_LOCK', { alloc: a }); if (ok) { draft.step = null; draft.alloc = {}; } } }, '🔒 Lock in'), why('Locked characters cannot change class or stats; the Mirror still edits the look.'));
  screen.append(box);
}

// ── after the lock ────────────────────────────────────────────────────────────────────────────────
function characterCard(api) {
  const { state, c, h } = api; const k = CLASSES.find(x => x.id === c.classId);
  const card = h('div', { class: 'char-card' }, h('div', { class: 'cr-preview' }, previewSprite(c, c.look || {}, c.classId)),
    h('div', { class: 'body' }, h('h2', {}, `${c.crest || ''} ${c.name}`), h('span', { class: 'meta' }, `${k?.name || c.classId} · level ${c.level} · ${c.maxHealth} max Health`),
      h('div', { class: 'stat-line' }, STAT_IDS.map(s => h('span', {}, h('span', { class: 'tag' }, statLabel(s).slice(0, 1)), h('b', {}, String(c.stats[s]))))),
      h('span', { class: 'meta' }, Object.values(c.worn || {}).filter(Boolean).map(it => it.name).join(' · ') || 'no gear yet')));
  return card;
}
function lockedView(api) {
  const { state, me, c, h, dispatch, screen } = api;
  const Gb = group(state, 'grid');
  screen.append(characterCard(api));
  // vault pull
  const entries = Object.values(state.roster || {}).filter(e => e.ownerId && e.ownerId === api.player.rosterOwnerId);
  const vault = entries.flatMap(e => (e.vault || []));
  const pulled = c.flags?.vaultPulled || 0, room = Gb.vaultPull - pulled;
  if (vault.length && room > 0) {
    const box = sect(`Vault — pull up to ${room}`);
    const btn = h('button', { class: 'primary big', disabled: true, onClick: () => dispatch('VAULT_PULL', { itemIds: [...draft.vaultPick] }) }, 'Pull into the grid');
    const update = () => { btn.disabled = !draft.vaultPick.size; btn.textContent = draft.vaultPick.size ? `Pull ${draft.vaultPick.size} into the grid` : 'Pull into the grid'; };
    for (const it of vault) box.append(itemRow({ item: it, meta: `${it.slot} · ${it.rarity || 'common'}${it.gameId ? ` · ${gameMeta(it.gameId).name}` : ''}`, action: draft.vaultPick.has(it.id) ? '✓' : 'PICK', onTap: () => { if (draft.vaultPick.has(it.id)) draft.vaultPick.delete(it.id); else if (draft.vaultPick.size < room) draft.vaultPick.add(it.id); else toast(`Only ${room} more`, 'bad'); redraw(api); } }));
    box.append(btn); update(); screen.append(box);
  } else if (pulled) screen.append(why(`${pulled} item${pulled === 1 ? '' : 's'} pulled from the vault.`));
  // pet team
  const pool = ownedPets(state, api.player); const cap = teamCap({ B: (g) => group(state, g) }, c);
  if (pool.length) {
    const picked = draft.petPick || new Set((c.pets || []).map(p => p.id)); draft.petPick = picked;
    const box = sect(`Pet team — up to ${cap}`);
    for (const p of pool) box.append(h('button', { class: `item-row ${picked.has(p.id) ? 'hot' : ''}`, onClick: () => { if (picked.has(p.id)) picked.delete(p.id); else if (picked.size < cap) picked.add(p.id); else toast(`Team is ${cap}`, 'bad'); redraw(api); } }, h('span', { class: 'body' }, h('span', { class: 'nm' }, p.name), h('span', { class: 'meta' }, `${p.element} · Power ${p.power}/${p.maxPower}`)), h('span', { class: 'act' }, picked.has(p.id) ? '✓' : 'BRING')));
    box.append(h('button', { class: 'primary', onClick: () => dispatch('PET_TEAM', { petIds: [...picked] }) }, 'Set the team'));
    screen.append(box);
  }
  if (!(c.pets || []).length && !c.flags?.setupHatched) screen.append(h('button', { class: 'big', onClick: () => dispatch('PET_HATCH', { source: 'setup' }) }, '🥚 Hatch a pet on the Triple Pet Wheel'));
  else if (c.pets?.length) screen.append(why(`Pets: ${c.pets.map(p => p.name).join(', ')}`));
  screen.append(h('button', { class: `big ${api.player.ready ? 'primary' : ''}`, onClick: () => dispatch('PLAYER_READY', { playerId: me, ready: !api.player.ready }) }, api.player.ready ? '✓ Ready — tap to unready' : 'Tap when ready'));
  screen.append(h('p', { class: 'muted ital center' }, c.buyinSpun ? `Buy-in: ${c.maxHealth} Health. Waiting for the GM to start the run.` : 'Waiting for the GM: the Buy-in Wheel sets your starting Health.'));
  seatsList(api);
}
function lobbyView(api) {
  const { state, me, c, h, dispatch, screen } = api;
  screen.append(h('div', { class: 'hero' }, h('div', { class: 'crest' }, c?.crest || api.player.crest || '🂠'), h('h2', {}, c?.name || api.player.name), h('p', { class: 'muted' }, 'The GM opens character creation from the console.')),
    h('button', { class: `big ${api.player.ready ? 'primary' : ''}`, onClick: () => dispatch('PLAYER_READY', { playerId: me, ready: !api.player.ready }) }, api.player.ready ? '✓ Ready — tap to unready' : 'Tap when ready'));
  rosterPick(api); seatsList(api);
}
function seatsList(api) {
  const { state, me, h, screen } = api;
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked);
  screen.append(h('div', { class: 'hr' }), h('div', { class: 'list' }, seats.map(p => { const pc = characterOf(state, p.id); return h('div', { class: `item ${p.connected ? '' : 'off'}` }, h('span', {}, pc?.crest || p.crest || '🂠'), h('span', { class: 'grow' }, pc?.name || p.name, p.id === me ? h('span', { class: 'muted' }, ' (you)') : null, pc?.classId ? h('span', { class: 'muted ital' }, ` · ${pc.classId}`) : null), h('span', { class: `pill ${p.ready ? 'ok' : ''}` }, p.ready ? 'ready' : pc?.locked ? 'locked' : pc ? 'making' : p.connected ? 'here' : 'away')); })));
}
