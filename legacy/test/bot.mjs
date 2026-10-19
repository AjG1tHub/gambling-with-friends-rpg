// Soak bot (loop 29). Plays whole sessions at engine level the way a GM would click through them —
// random but legal choices, plus a sprinkle of side systems — and checks a list of invariants after
// every single action. Used by test/unit/soak.test.mjs (short runs) and test/soak.mjs (long runs).
import assert from 'node:assert/strict';

const store = new Map();
if (!globalThis.localStorage) {                // standalone run (the unit-test helpers install their own stand-ins first)
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); }, clear: () => store.clear() };
  // Node ships a real BroadcastChannel, and an open one keeps the process alive — replace it.
  globalThis.BroadcastChannel = class { postMessage() {} addEventListener() {} };
}

const S = await import('../site/js/state.js');
const E = await import('../site/js/engine.js');
const G = await import('../site/js/games.js');
const R = await import('../site/js/rng.js');
const PT = await import('../site/js/pets.js');
const PB = await import('../site/js/petbattle.js');
const RD = await import('../site/js/raid.js');
const LN = await import('../site/js/loans.js');
const AU = await import('../site/js/auction.js');
const BI = await import('../site/js/buyin.js');
const CT = await import('../site/js/contests.js');
const TN = await import('../site/js/turns.js');
const ST = await import('../site/js/stats.js');
const RC = await import('../site/js/recovery.js');
const { DEFAULT_CONFIG } = await import('../site/js/config-default.js');

const DIRS = ['N', 'S', 'E', 'W'];

// ── Invariants ───────────────────────────────────────────────────────────────────────────────────
function scanNumbers(v, path, bad) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(path); return; }
  if (v === undefined) { bad.push(path + ' (undefined)'); return; }
  if (typeof v === 'function') { bad.push(path + ' (function)'); return; }
  if (v && typeof v === 'object') { if (Array.isArray(v)) v.forEach((x, i) => scanNumbers(x, `${path}[${i}]`, bad)); else for (const k of Object.keys(v)) { if (v[k] === undefined) continue; scanNumbers(v[k], `${path}.${k}`, bad); } }
}
export function checkInvariants(config, state, book, where) {
  const fail = (msg) => { throw new Error(`[${where}] ${msg}`); };
  const bad = []; scanNumbers(state, 'state', bad);
  if (bad.length) fail(`non-finite or non-serialisable values at ${bad.slice(0, 4).join(', ')}`);
  const n = state.board.length;
  for (const p of state.players) {
    if (!(Number.isInteger(p.pos) && p.pos >= 0 && p.pos < n)) fail(`${p.name} is off the board (${p.pos})`);
    if (!(Number.isInteger(p.jailTier) && p.jailTier >= 0 && p.jailTier <= 4)) fail(`${p.name} jail tier ${p.jailTier}`);
    if (!(p.power >= 0 && p.power <= PT.POWER_MAX)) fail(`${p.name} power ${p.power}`);
    if (p.skipTurns < 0) fail(`${p.name} skipTurns ${p.skipTurns}`);
    if (p.pardons < 0) fail(`${p.name} pardons ${p.pardons}`);
    if ((p.pets || []).length > PT.petRules(config).maxPets) fail(`${p.name} has ${(p.pets || []).length} pets`);
    for (const pet of p.pets || []) {
      if (!(pet.hp >= 0 && pet.hp <= pet.hpMax)) fail(`${pet.name} hp ${pet.hp}/${pet.hpMax}`);
      if (!(pet.level >= 1 && pet.level <= PT.petRules(config).maxLevel)) fail(`${pet.name} level ${pet.level}`);
      if (!(pet.xp >= 0)) fail(`${pet.name} xp ${pet.xp}`);
    }
    if (p.activePetId != null && !(p.pets || []).some(x => x.id === p.activePetId)) fail(`${p.name} active pet missing`);
    for (const l of p.loans || []) if (!(l.owed >= 0)) fail(`${p.name} loan owed ${l.owed}`);
    for (const [cur, amt] of Object.entries(p.balances)) {
      if (cur !== 'Gold' && amt < -1e-9) fail(`${p.name} holds ${amt} ${cur} (secondaries cannot go negative)`);
      if (config.Config.GoldCanGoNegative === false && cur === 'Gold' && amt < 0) fail(`${p.name} Gold ${amt} with negatives disabled`);
    }
    for (const pu of p.heldPowerUps) if (!pu || !pu.id) fail(`${p.name} holds a broken power-up`);
  }
  // every balance must equal its opening amount plus everything the ledger says happened to it
  for (const row of state.ledger) {
    if (row.n <= book.seenN) continue;
    if (row.n !== book.seenN + 1 && book.seenN !== 0 && !book.trimmed) fail(`ledger numbering jumped ${book.seenN} → ${row.n}`);
    book.seenN = row.n;
    if ((row.type === 'CREDIT' || row.type === 'DEBIT') && row.playerId) {
      const k = row.playerId + '|' + row.cur; book.sum.set(k, (book.sum.get(k) || 0) + Number(row.amount));
      if (row.type === 'CREDIT' && row.amount < 0) fail('a CREDIT row with a negative amount');
      if (row.type === 'DEBIT' && row.amount > 0) fail('a DEBIT row with a positive amount');
    }
  }
  for (const p of state.players) for (const [cur, amt] of Object.entries(p.balances)) {
    const expect = (book.open.get(p.id + '|' + cur) || 0) + (book.sum.get(p.id + '|' + cur) || 0);
    if (Math.abs(expect - amt) > 1e-6) fail(`${p.name}'s ${cur} is ${amt} but the ledger adds up to ${expect}`);
  }
  if (state.turnOrder.some(id => !state.players.some(p => p.id === id))) fail('turn order names a missing player');
  if (new Set(state.turnOrder).size !== state.turnOrder.length) fail('duplicate in turn order');
  if (state.game && !state.players.some(p => p.id === state.game.playerId)) fail('orphan minigame');
  const audit = RC.auditState(state, config).filter(h => h.level === 'error');
  if (audit.length) fail(`audit: ${audit[0].msg}`);
}

// ── The bot ──────────────────────────────────────────────────────────────────────────────────────
export function playSession({ seed = 1, players = 4, turns = 200, tweak = null, sideChance = 0.25, checkEvery = 1, onAction = null } = {}) {
  const config = structuredClone(DEFAULT_CONFIG); if (tweak) tweak(config);
  const rng = R.makeRng(seed), pick = R.makeRng(seed ^ 0x9e3779b9);        // game dice vs bot decisions: separate streams
  const choose = (arr) => arr[pick.int(0, arr.length - 1)];
  const state = S.initialState(config, seed);
  for (let i = 0; i < players; i++) state.players.push(S.newPlayer('p' + i, 'P' + i, '', 0, config.Config.StartingBank));
  state.board = E.generateBoard(config, rng);
  const start = E.startPositions(state)[0]; state.players.forEach(p => { p.pos = start; });
  state.turnOrder = state.players.map(p => p.id); state.phase = 'playing'; S.log(state, 'SESSION_START', null, { players });
  const book = { open: new Map(state.players.map(p => [p.id + '|Gold', p.balances.Gold])), sum: new Map(), seenN: 0, trimmed: false };
  const counts = {}; const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  let actions = 0, lastWhere = 'start';
  const tick = (where) => {
    lastWhere = where; actions++; bump(where.split(':')[0]);
    PT.accruePower(config, state); state.rngState = rng.getState();
    if (onAction) onAction(state, where);
    if (actions % checkEvery === 0) checkInvariants(config, state, book, `seed ${seed} action ${actions} ${where}`);
  };
  const byId = (id) => state.players.find(p => p.id === id);
  const others = (p) => state.players.filter(o => o.id !== p.id);

  function playGame(p, gameId) {
    const def = G.gameDef(config, gameId); const id = def && def.built ? gameId : 'placeholder';
    const gold = Math.max(0, Math.floor(S.bal(p, 'Gold')));
    const wagers = [{ amount: choose([100, 100, 250, 500, Math.max(100, gold)]), cur: 'Gold' }];
    const sec = Object.entries(p.balances).find(([c, a]) => c !== 'Gold' && a >= 1);
    if (sec && pick.chance(0.3)) wagers.push({ amount: Math.max(1, Math.floor(sec[1] / 2)), cur: sec[0] });
    const started = G.startGame(config, state, rng, id, p, wagers);
    if (started && started.error) { tick('game:refused'); return; }
    const g = state.game; if (!g) { tick('game:refused'); return; }
    const act = (a, payload) => G.gameAction(config, state, rng, a, payload);
    let guard = 0;
    switch (g.id) {
      case 'fifty': case 'bigwheel': case 'plinko': case 'slots': act('spin', pick.chance(0.1) ? { nudgeLabel: 'x' } : {}); break;
      case 'roulette': { const t = choose(['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3', 'straight']); act('bet', { type: t, number: pick.int(0, 36) }); act('spin'); break; }
      case 'crash': act('launch'); act('cashout'); break;
      case 'mines': { const k = pick.int(0, 6); for (let i = 0; i < k && state.game && !state.game.result; i++) act('reveal', { idx: pick.int(0, 24) }); if (state.game && !state.game.result) act('stop'); break; }
      case 'blackjack': {
        if (g.phase === 'insurance') act(pick.chance(0.4) ? 'insure' : 'decline');
        while (state.game && state.game.phase === 'player' && guard++ < 60) {
          const h = G.bjActiveHand(g.view), t = G.bjTotal(h.cards).total;
          const opts = ['stand']; if (t < 19) opts.push('hit', 'hit'); if (G.bjCanDouble(g.view)) opts.push('double'); if (G.bjCanSplit(G.effectiveOdds(config, state, 'blackjack'), g.view)) opts.push('split', 'split');
          act(choose(opts));
        }
        break; }
      case 'baccarat': act('bet', { side: choose(['player', 'banker', 'tie']) }); act('deal'); break;
      case 'hilo': { const k = pick.int(0, 5); for (let i = 0; i < k && state.game && state.game.phase === 'running' && guard++ < 40; i++) act(choose(['higher', 'lower'])); if (state.game && state.game.phase === 'running') act('cashout'); break; }
      case 'dice': { const dir = choose(['under', 'over']); act('bet', { dir, target: pick.int(1, 100) }); if (!g.view.bet) act('bet', { dir: 'under', target: 50 }); act('spin'); break; }
      case 'keno': { if (pick.chance(0.5)) act('quick', { count: pick.int(1, 10) }); else for (let i = 0; i < pick.int(1, 12); i++) act('pick', { n: pick.int(0, 41) }); if (!g.view.picks.length) act('pick', { n: 7 }); act('spin'); break; }
      default: {
        const X = G.extraDef(g.id);
        if (!X) { act(pick.chance(0.5) ? 'won' : 'lost'); break; }
        while (state.game && state.game.phase !== 'done' && guard++ < 300) { const [a, pl] = X.bot(g, pick, false, G.extraCtx(config, state, rng, g)); act(a, pl); }
      }
    }
    const gg = state.game;
    if (!gg) { tick(`game:${id}:gone`); return; }
    if (pick.chance(0.04)) { state.game = null; tick(`game:${id}:cancelled`); return; }          // GM cancels before settling
    const mult = gg.pending ? gg.pending.mult : gg.result ? gg.result.mult : null;
    assert.ok(mult !== null && Number.isFinite(mult), `seed ${seed}: ${id} finished with no result (phase ${gg.phase})`);
    G.settle(config, state, p, mult, { gameId: gg.id, label: gg.pending?.label || gg.result?.label });
    assert.equal(state.game, null);
    tick(`game:${id}`);
  }

  function petFight(kind, p) {
    let guard = 0;
    const run = () => { while (state.petBattle && state.petBattle.phase === 'active' && guard++ < 400) { PB.runBossTurns(config, state, rng); if (!state.petBattle || state.petBattle.phase !== 'active') break; const r = PB.petBattleAction(config, state, rng, choose(['strike', 'element', 'element', 'guard', 'mend'])); if (r.error) PB.petBattleAction(config, state, rng, 'strike'); } };
    if (kind === 'wild') { const r = PB.startWildEncounter(config, state, rng, p.id); if (r.error) { tick('pet:wild-refused'); return; } run(); }
    else if (kind === 'boss') { const r = PB.startPetBattle(config, state, rng, { challengerId: p.id, bossId: choose(PB.bossList(config)).id }); if (r.error) { tick('pet:boss-refused'); return; } run(); }
    else { const o = choose(others(p)); const r = PB.startPetBattle(config, state, rng, { challengerId: p.id, opponentId: o.id, wager: choose([0, 50, 200]) }); if (r.error) { tick('pet:pvp-refused'); return; } run(); }
    assert.ok(!state.petBattle || state.petBattle.phase !== 'active', `seed ${seed}: pet battle never ended`);
    state.petBattle = null; tick(`pet:${kind}`);
  }

  function battle(aId, bId) {
    const a = byId(aId), b = byId(bId); if (!a || !b || a.id === b.id) return;
    const spin = E.spinBattleWheel(config, state, rng, a.id, b.id);
    if (spin.contest.petBattle && PT.activePet(a) && PT.activePet(b) && pick.chance(0.7)) { petFight('pvp', a); return; }
    const wager = (p) => { const sec = Object.entries(p.balances).find(([c, amt]) => c !== 'Gold' && amt >= 1); return sec && pick.chance(0.3) ? { playerId: p.id, cur: sec[0], amount: Math.floor(sec[1]) } : { playerId: p.id, cur: 'Gold', amount: choose([100, 150, 300]) }; };
    const kind = CT.contestKind(spin.contest); let winner = choose([a.id, b.id]);
    if (kind) { const r = CT.runContest(config, state, rng, kind, a.id, b.id); if (!r.error && r.winnerId) winner = r.winnerId; CT.clearContest(state); }
    E.settleBattle(config, state, [wager(a), wager(b)], winner, pick.chance(0.1) ? { forfeitId: winner === a.id ? b.id : a.id } : {});
    tick('battle');
  }

  function followups(res, p, depth) {
    if (!res || depth > 4) return;
    if (res.wildEncounter) petFight('wild', p);
    if (res.gmPickTile) { p.pos = pick.int(0, state.board.length - 1); tick('verb:teleport-choice'); resolve(p, depth + 1); }
    else if (res.resolveTile) resolve(p, depth + 1);
    if (res.forcedMarch) { state.move = { playerId: p.id, method: 'FORCED', label: 'Forced March', startPos: p.pos, path: [p.pos], lastDir: null, pendingVoid: false, reversed: false, done: false, stepsLeft: res.forcedMarch, candy: null, needsTarget: null }; walk(p, depth + 1); resolve(p, depth + 1); }
    if (res.spinMethodAgain) { state.move = null; move(p, depth + 1); }
  }

  function resolve(p, depth = 0) {
    if (depth > 4) return;
    const r = E.resolveTile(config, state, p); tick(`tile:${r.tile.type}`);
    if (r.battleWith && pick.chance(0.8)) battle(p.id, r.battleWith);
    switch (r.action) {
      case 'minigame': if (pick.chance(0.95)) playGame(p, r.tile.gameId); break;
      case 'good_wheel': { const o = E.spinGoodBad(config, state, rng, 'GOOD', p); tick('wheel:good'); followups(o.result, p, depth); break; }
      case 'bad_wheel': { const o = E.spinGoodBad(config, state, rng, 'BAD', p); tick('wheel:bad'); followups(o.result, p, depth); break; }
      case 'start_wheel': { const o = E.spinStartWheel(config, state, rng, p); tick('wheel:start'); followups(o.result, p, depth); break; }
      case 'shop': shop(p); break;
      default: break;
    }
  }

  function shop(p) {
    const { offers } = E.shopOffers(config, state, rng);
    for (let i = 0; i < pick.int(0, 3); i++) {
      const o = choose(offers), dir = pick.chance(0.6) ? 'buy' : 'sell';
      const units = dir === 'buy' ? pick.int(1, 20) : Math.max(1, Math.floor(S.bal(p, o.name) * pick.next()) || 1);
      if (dir === 'buy' && S.bal(p, 'Gold') < units * o.sessionRate) continue;       // the GM would not sell on credit
      E.shopExchange(config, state, p, o.name, units, dir); tick('shop:exchange');
    }
    if (pick.chance(0.5)) { G.buyPowerUp(config, state, p, choose(config.PowerUps).id); tick('shop:powerup'); }
    if (pick.chance(0.4)) { PT.buyPetGood(config, state, rng, p, choose(PT.petShop(config)).id); tick('shop:pet'); }
  }

  function walk(p, depth) {
    let guard = 0;
    while (state.move && !state.move.done && guard++ < 400) {
      const mv = state.move;
      if (mv.pendingVoid) { const v = E.spinVoidWheel(config, state, rng); tick('wheel:void'); const mover = byId(mv.benevTarget || mv.playerId);
        if (v.result && (v.result.resolveTile || v.result.gmPickTile)) { if (state.move) state.move.done = true; if (v.result.gmPickTile) mover.pos = pick.int(0, state.board.length - 1); break; }
        if (v.result && v.result.spinMethodAgain) { /* a Void wheel row could grant this; the GM would re-spin after the move */ }
        continue; }
      if (mv.needsTarget) {
        const o = others(byId(mv.playerId)); if (!o.length) { mv.needsTarget = null; mv.done = true; break; }
        const t = choose(o);
        if (mv.needsTarget === 'swap') { const me = byId(mv.playerId); [me.pos, t.pos] = [t.pos, me.pos]; mv.needsTarget = null; mv.done = true; tick('move:swap'); break; }
        mv.benevTarget = t.id; mv.needsTarget = null; tick('move:benev-target'); continue;
      }
      const dirs = DIRS.filter(d => !mv.lastDir || d !== E.OPPOSITE[mv.lastDir]);
      const dir = mv.candy && pick.chance(0.7) ? (mv.candy.dir || (mv.candy.dir = choose(DIRS))) : choose(dirs);   // candy: mostly one heading, sometimes a turn
      const r = E.stepMove(config, state, rng, dir, { override: !!mv.candy });
      if (mv.candy && mv.candy.dir && E.OPPOSITE[mv.candy.dir] === mv.lastDir) mv.candy.dir = mv.lastDir;
      if (!r.ok) { E.stepMove(config, state, rng, choose(DIRS), { override: true }); }
      if (r.battle) { tick('move:longwalk-battle'); battle((mv.benevTarget || mv.playerId), r.battle); break; }
      if (guard % 7 === 0) tick('move:step');
    }
    assert.ok(!state.move || state.move.done || guard < 400, `seed ${seed}: a move never finished (${state.move?.method})`);
    if (state.move && !state.move.done) state.move.done = true;
    tick('move:done');
  }

  function move(p, depth = 0) {
    if (depth > 4) return;
    const method = E.spinMethodWheel(config, state, rng); tick('wheel:method');
    E.beginMove(config, state, rng, method); walk(p, depth);
    const mover = state.move && state.move.benevTarget ? byId(state.move.benevTarget) : p;
    resolve(mover, depth);
  }

  function jailTurn(p, spins) {
    const opt = choose(['wheel', 'wheel', 'wheel', 'buyout', 'risk', 'skill', 'sit']);
    if (opt === 'buyout' && S.bal(p, 'Gold') >= E.jailBuyoutFee(config, p)) { E.jailBuyout(config, state, p); tick('jail:buyout'); return; }
    if (opt === 'risk') { E.jailRiskCheck(config, state, rng, p, choose([50, 100, 300])); tick('jail:risk'); return; }
    if (opt === 'skill') { E.jailSkillCheck(config, state, rng, p, pick.chance(0.5)); tick('jail:skill'); return; }
    if (opt === 'sit') { tick('jail:sit'); return; }
    for (let i = 0; i < spins && p.jailTier > 0; i++) { const o = E.spinJailWheel(config, state, rng, p); tick('jail:wheel'); followups(o.result, p, 3); }
  }

  function sideAction(p) {
    switch (choose(['loan', 'repay', 'hatch', 'train', 'boss', 'raid', 'auction', 'buyin', 'chaos', 'transfer', 'jailsend', 'bench', 'heal', 'equip', 'barter', 'adjust', 'roundtrip'])) {
      case 'loan': LN.takeLoan(config, state, p, choose([100, 300, 800, 5000])); tick('side:loan'); break;
      case 'repay': { const l = LN.openLoans(p)[0]; if (l) { LN.repayLoan(config, state, p, l.id, pick.chance(0.5) ? null : pick.int(1, 200)); tick('side:repay'); } break; }
      case 'hatch': PT.hatchEgg(config, state, rng, p, pick.chance(0.2) ? { free: true } : {}); tick('side:hatch'); break;
      case 'train': { const pet = PT.activePet(p); if (pet) { PT.trainPet(config, state, rng, p, pet.id, pick.int(1, 120)); tick('side:train'); } break; }
      case 'heal': { const pet = PT.petsOf(p).find(x => x.fainted); if (pet) { PT.revivePet(config, state, p, pet.id, { free: pick.chance(0.3) }); tick('side:revive'); } else if (pick.chance(0.2)) { PT.restAllPets(state); tick('side:rest'); } break; }
      case 'equip': { const bag = Object.entries(PT.bagOf(p)).find(([, n]) => n > 0); const pet = PT.activePet(p); if (bag && pet) { PT.equipItem(state, p, pet.id, bag[0]); tick('side:equip'); } break; }
      case 'boss': if (PT.activePet(p)) petFight('boss', p); break;
      case 'raid': { const party = state.players.filter(x => { const pet = PT.activePet(x); return pet && !pet.fainted && pet.hp > 0; }).map(x => x.id);
        if (party.length >= 2 && !state.petBattle) { const r = RD.startRaid(config, state, rng, { playerIds: party, bossId: choose(RD.raidBossList(config)).id }); let guard = 0;
          if (!r.error) { while (state.raid && state.raid.phase === 'active' && guard++ < 600) { const rr = RD.raidAction(config, state, rng, choose(['strike', 'element', 'element', 'guard', 'mend'])); if (rr.error) RD.raidAction(config, state, rng, 'strike'); }
            assert.ok(!state.raid || state.raid.phase !== 'active', `seed ${seed}: raid never ended`); RD.clearRaid(state); } tick('side:raid'); } break; }
      case 'auction': { const r = AU.startAuction(config, state, p.id); if (!r.error) { let guard = 0;
          while (state.auction && state.auction.phase === 'open' && guard++ < 80) { const lot = AU.currentLot(state.auction); if (pick.chance(0.5)) AU.placeBid(config, state, choose(others(p)).id, (lot ? AU.minBid(config, lot) : 10) + pick.int(0, 30)); else if (pick.chance(0.15)) AU.passLot(config, state); else AU.callLot(config, state); }
          AU.endAuction(state); } tick('side:auction'); break; }
      case 'buyin': { const row = E.spinBuyInWheel(config, state, rng, p); const r = BI.applyBuyIn(config, state, p, row, { fee: choose([0, 100, 250]), grant: choose([0, 300]) }); tick('side:buyin'); if (r && r.openLoans) { LN.takeLoan(config, state, p, 300); tick('side:buyin-loan'); } break; }
      case 'chaos': { E.chaosShuffle(config, state, rng, pick.int(1, 5), { loud: pick.chance(0.5) }); tick('side:chaos'); if (pick.chance(0.3)) { E.chaosUndo(state); tick('side:chaos-undo'); } break; }
      case 'transfer': { const sec = Object.keys(p.balances); E.transfer(config, state, p, choose(others(p)), choose(sec), pick.int(1, 150)); tick('side:transfer'); break; }
      case 'jailsend': if (pick.chance(0.3)) { E.sendToJail(config, state, choose(state.players), 'GM'); tick('side:jail'); } break;
      case 'bench': if (state.turnOrder.length > 2 && pick.chance(0.3)) { const who = choose(others(p)); const r = TN.benchPlayer(state, who.id); tick('side:bench'); if (!r.error && pick.chance(0.8)) { TN.returnPlayer(state, who.id); tick('side:return'); } } else if (pick.chance(0.3)) { TN.moveInOrder(state, p.id, choose([-1, 1])); tick('side:reorder'); } break;
      case 'barter': { const prisoner = state.players.find(x => x.jailTier > 0 && x.id !== p.id); if (prisoner) { E.jailSocialBarter(config, state, p, prisoner, choose(['cut', 'skip'])); tick('side:barter'); } break; }
      case 'adjust': S.credit(state, p, choose(['Gold', 'Gems', 'Scrap']), choose([50, -50, 5]), 'GM adjustment'); if (Object.entries(p.balances).some(([c, a]) => c !== 'Gold' && a < 0)) { for (const c of Object.keys(p.balances)) if (c !== 'Gold' && p.balances[c] < 0) S.credit(state, p, c, -p.balances[c], 'GM correction'); } tick('side:adjust'); break;
      case 'roundtrip': {                                   // what a refresh / restore / session file does to the table
        const json = JSON.stringify(state); const back = RC.migrateState(JSON.parse(json)).state;
        assert.equal(JSON.stringify(back), json, `seed ${seed}: save → load changed the state`);
        assert.deepEqual(RC.repairState(back, config), [], `seed ${seed}: a healthy table needed repairs`);
        tick('side:roundtrip'); break; }
    }
  }

  for (let t = 0; t < turns; t++) {
    if (!state.turnOrder.length) break;
    const before = state.ledger.length;
    const p = S.currentPlayer(state);
    const bt = E.beginTurn(config, state); tick(`turn:${bt.kind}`);
    if (bt.kind === 'move') move(p);
    else if (bt.kind === 'jail') jailTurn(p, bt.spins);
    while (pick.chance(sideChance)) sideAction(choose(state.players));
    assert.ok(!state.game, `seed ${seed}: a minigame was left open at end of turn`);
    E.endTurn(state, config); tick('turn:end');
    assert.equal(state.move, null);
    if (state.ledger.length < before) book.trimmed = true;
    if (state.ledger.length >= S.LEDGER_MAX) book.trimmed = true;
  }
  S.log(state, 'SESSION_END', null, { round: state.round }); state.phase = 'ended';
  checkInvariants(config, state, book, `seed ${seed} end`);
  const stats = ST.sessionStats(config, state);
  return { state, config, actions, counts, stats, ledgerRows: state.ledgerSeq, lastWhere };
}
