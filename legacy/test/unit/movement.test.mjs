import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, mkGame, fixedRng, events } from './_helpers.mjs';

const method = (config, verb) => config.Wheel_Method.find(m => m.verb === verb);
const noVoid = (c) => { c.Config.VoidEnabled = false; };

test('spinMethodWheel records the spin for the player view and the ledger', () => {
  const { config, state, rng, p } = mkGame();
  const o = E.spinMethodWheel(config, state, rng);
  assert.ok(config.Wheel_Method.includes(o));
  assert.equal(state.lastSpin.outcomes[state.lastSpin.index], o.label);
  assert.equal(state.lastSpin.playerId, p.id);
  assert.equal(events(state, 'WHEEL_SPIN').at(-1).outcome, o.label);
});

test('dice-style methods roll within range', () => {
  const ranges = { MOVE_DICE: [1, 6], MOVE_D4: [1, 4], MOVE_2D6: [2, 12], MOVE_ONE: [1, 1] };
  for (const [verb, [lo, hi]] of Object.entries(ranges)) {
    const { config, state, rng } = mkGame(['A', 'B'], 9);
    for (let i = 0; i < 300; i++) { const mv = E.beginMove(config, state, rng, method(config, verb)); assert.ok(mv.stepsLeft >= lo && mv.stepsLeft <= hi, `${verb} rolled ${mv.stepsLeft}`); assert.equal(mv.rolled, mv.stepsLeft); }
  }
});

test('walking: steps count down and the move finishes on the last step', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1, noVoid);
  p.pos = 9;
  E.beginMove(config, state, fixedRng([0.5]), method(config, 'MOVE_DICE'));   // 1 + floor(.5*6) = 4
  assert.equal(state.move.stepsLeft, 4);
  assert.deepEqual(E.stepMove(config, state, fixedRng([0.99]), 'E'), { ok: true });
  E.stepMove(config, state, fixedRng([0.99]), 'E'); E.stepMove(config, state, fixedRng([0.99]), 'S');
  const r = E.stepMove(config, state, fixedRng([0.99]), 'S');
  assert.equal(r.arrived, true); assert.equal(p.pos, 27); assert.equal(state.move.done, true);
  assert.deepEqual(state.move.path, [9, 10, 11, 19, 27]);
});

test('no immediate backtrack, unless the GM overrides', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1, noVoid);
  p.pos = 9; E.beginMove(config, state, fixedRng([0.99]), method(config, 'MOVE_DICE'));
  E.stepMove(config, state, fixedRng([0.99]), 'E');
  const blocked = E.stepMove(config, state, fixedRng([0.99]), 'W');
  assert.equal(blocked.ok, false); assert.equal(p.pos, 10);
  assert.equal(E.stepMove(config, state, fixedRng([0.99]), 'W', { override: true }).ok, true);
  assert.equal(p.pos, 9);
});

test('stepMove refuses when no move is active or after it is done', () => {
  const { config, state, rng } = mkGame();
  assert.equal(E.stepMove(config, state, rng, 'E').ok, false);
  E.beginMove(config, state, rng, method(config, 'MOVE_STAY'));
  assert.equal(E.stepMove(config, state, rng, 'E').ok, false);
});

test('edge crossing triggers the Void at VoidChance and blocks movement until spun', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1);
  p.pos = 7; E.beginMove(config, state, fixedRng([0.99]), method(config, 'MOVE_DICE'));
  const r = E.stepMove(config, state, fixedRng([0.19]), 'E');           // 0.19 < 0.20 → Void
  assert.equal(r.voidTriggered, true); assert.equal(state.move.pendingVoid, true);
  assert.equal(events(state, 'VOID_TRIGGER').length, 1);
  assert.equal(E.stepMove(config, state, fixedRng([0.99]), 'E').ok, false);
  E.spinVoidWheel(config, state, fixedRng([0.999]));                     // last row = Nothing
  assert.equal(state.move.pendingVoid, false);
});

test('edge crossing without the Void roll just wraps', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1);
  p.pos = 7; E.beginMove(config, state, fixedRng([0.99]), method(config, 'MOVE_DICE'));
  const r = E.stepMove(config, state, fixedRng([0.2]), 'E');             // 0.2 is not < 0.20
  assert.equal(r.voidTriggered, undefined); assert.equal(p.pos, 0);
});

test('VoidEnabled = false never triggers the Void', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1, noVoid);
  p.pos = 7; E.beginMove(config, state, fixedRng([0.99]), method(config, 'MOVE_DICE'));
  assert.equal(E.stepMove(config, state, fixedRng([0]), 'E').voidTriggered, undefined);
});

test('Teleport lands on a random tile and is done immediately', () => {
  const { config, state, p } = mkGame();
  const mv = E.beginMove(config, state, fixedRng([0.5]), method(config, 'MOVE_TELEPORT'));
  assert.equal(p.pos, 20); assert.equal(mv.done, true);
});

test('Stay Put ends the move where the player stands', () => {
  const { config, state, rng, p } = mkGame(); const at = p.pos;
  const mv = E.beginMove(config, state, rng, method(config, 'MOVE_STAY'));
  assert.equal(mv.done, true); assert.equal(p.pos, at);
});

test('Magnetism pulls to the nearest GOOD/BAD tile, ties toward BAD', () => {
  const { config, state, rng, p } = mkGame();
  state.board.forEach(t => { if (t.type === 'GOOD' || t.type === 'BAD') { t.type = 'GAME'; } });
  state.board[10].type = 'GOOD'; state.board[12].type = 'BAD'; p.pos = 11;       // both 1 away
  E.beginMove(config, state, rng, method(config, 'MOVE_MAGNET'));
  assert.equal(p.pos, 12);
  state.board[12].type = 'GAME'; state.board[30].type = 'BAD'; p.pos = 11;        // GOOD is nearer
  E.beginMove(config, state, rng, method(config, 'MOVE_MAGNET'));
  assert.equal(p.pos, 10);
});

test('Candy Land walks to the first tile of the spun color', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1, noVoid);
  state.board.forEach(t => { t.color = 'Blue'; }); state.board[12].color = 'Red'; p.pos = 9;
  const red = config.Wheel_Color.findIndex(c => c.color === 'Red' && !c.double);
  const total = config.Wheel_Color.reduce((s, c) => s + c.weight, 0);
  const before = config.Wheel_Color.slice(0, red).reduce((s, c) => s + c.weight, 0);
  const mv = E.beginMove(config, state, fixedRng([(before + 0.5) / total]), method(config, 'MOVE_CANDY'));
  assert.deepEqual({ color: mv.candy.color, double: mv.candy.double }, { color: 'Red', double: false });
  assert.deepEqual(E.stepMove(config, state, fixedRng([0.99]), 'E'), { ok: true });
  E.stepMove(config, state, fixedRng([0.99]), 'E');
  const r = E.stepMove(config, state, fixedRng([0.99]), 'E');
  assert.equal(r.arrived, true); assert.equal(p.pos, 12);
});

test('Candy Land DOUBLE stops at the second tile of the color', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1, noVoid);
  state.board.forEach(t => { t.color = 'Blue'; }); state.board[10].color = 'Red'; state.board[13].color = 'Red'; p.pos = 9;
  const i = config.Wheel_Color.findIndex(c => c.color === 'Red' && c.double);
  const total = config.Wheel_Color.reduce((s, c) => s + c.weight, 0);
  const before = config.Wheel_Color.slice(0, i).reduce((s, c) => s + c.weight, 0);
  E.beginMove(config, state, fixedRng([(before + 0.5) / total]), method(config, 'MOVE_CANDY'));
  assert.equal(E.stepMove(config, state, fixedRng([0.99]), 'E').arrived, undefined);   // first Red: keep going
  E.stepMove(config, state, fixedRng([0.99]), 'E'); E.stepMove(config, state, fixedRng([0.99]), 'E');
  assert.equal(E.stepMove(config, state, fixedRng([0.99]), 'E').arrived, true);
  assert.equal(p.pos, 13);
});

test('The Long Walk stops on an occupied tile and reports a battle', () => {
  const { config, state, rng, p, q } = mkGame(['A', 'B'], 1, noVoid);
  state.board.forEach(t => { if (t.type === 'START' && t.idx !== 7) t.type = 'GAME'; });
  p.pos = 9; q.pos = 11; state.board[11].type = 'GAME';
  const mv = E.beginMove(config, state, rng, method(config, 'MOVE_LONGWALK'));
  assert.equal(mv.stepsLeft, config.Config.LongWalkMaxSteps);
  E.stepMove(config, state, rng, 'E');
  const r = E.stepMove(config, state, rng, 'E');
  assert.equal(r.arrived, true); assert.equal(r.battle, q.id);
});

test('The Long Walk ignores jailed players and ends after the max steps', () => {
  const { config, state, rng, p, q } = mkGame(['A', 'B'], 1, noVoid);
  p.pos = 16; q.pos = 17; q.jailTier = 1;
  E.beginMove(config, state, rng, method(config, 'MOVE_LONGWALK'));
  let r; for (let i = 0; i < 10; i++) r = E.stepMove(config, state, rng, i % 2 ? 'S' : 'E', { override: true });
  assert.equal(r.arrived, true); assert.equal(r.battle, undefined);
});

test('Swap and Benevolence wait for a target; Benevolence moves the OTHER player', () => {
  const { config, state, rng, p, q } = mkGame(['A', 'B'], 1, noVoid);
  assert.equal(E.beginMove(config, state, rng, method(config, 'MOVE_SWAP')).needsTarget, 'swap');
  const mv = E.beginMove(config, state, rng, method(config, 'MOVE_BENEV'));
  assert.equal(mv.needsTarget, 'benevolence'); assert.equal(mv.stepsLeft, config.Config.BenevolenceSteps);
  p.pos = 9; q.pos = 20; mv.benevTarget = q.id; mv.needsTarget = null;
  E.stepMove(config, state, rng, 'E'); const r = E.stepMove(config, state, rng, 'E');
  assert.equal(r.arrived, true); assert.equal(q.pos, 22); assert.equal(p.pos, 9);
});

test('The Long Way reverses the directions the GM presses', () => {
  const { config, state, p } = mkGame(['A', 'B'], 1, noVoid);
  p.pos = 9; E.beginMove(config, state, fixedRng([0.99]), method(config, 'MOVE_DICE'));
  state.move.reversed = true;
  E.stepMove(config, state, fixedRng([0.99]), 'E');
  assert.equal(p.pos, 8);
});

test('resolveTile maps each tile type to its action; START is a no-battle safe zone', () => {
  const { config, state, p, q } = mkGame();
  const at = (type) => state.board.find(t => t.type === type).idx;
  const expect = { GAME: 'minigame', GOOD: 'good_wheel', BAD: 'bad_wheel', SHOP: 'shop', START: 'start_wheel' };
  for (const [type, action] of Object.entries(expect)) { p.pos = at(type); q.pos = (p.pos + 5) % 40; assert.equal(E.resolveTile(config, state, p).action, action); }
  p.pos = q.pos = at('GAME'); assert.equal(E.resolveTile(config, state, p).battleWith, q.id);
  p.pos = q.pos = at('START'); assert.equal(E.resolveTile(config, state, p).battleWith, null);
  q.jailTier = 2; p.pos = q.pos = at('GAME'); assert.equal(E.resolveTile(config, state, p).battleWith, null);
});

test('landing on a JAIL tile jails the player at tier 1', () => {
  const { config, state, p } = mkGame();
  p.pos = 32;
  assert.equal(E.resolveTile(config, state, p).action, 'jailed');
  assert.equal(p.jailTier, 1); assert.equal(p.pos, 32);
});

test('turn engine: endTurn advances the player and bumps the round on wrap', () => {
  const { state } = mkGame(['A', 'B', 'C']);
  E.endTurn(state); assert.equal(state.round, 1); assert.equal(state.turnIdx, 1);
  E.endTurn(state); E.endTurn(state);
  assert.equal(state.round, 2); assert.equal(state.move, null);
});

test('beginTurn: Collector drains Gold, then skip / jail / move kinds', () => {
  const { config, state, p } = mkGame();
  p.collector = { perTurn: 50, turnsLeft: 2 };
  assert.equal(E.beginTurn(config, state).kind, 'move'); assert.equal(p.balances.Gold, 450);
  E.beginTurn(config, state); assert.equal(p.balances.Gold, 400); assert.equal(p.collector, null);
  p.skipTurns = 1; assert.equal(E.beginTurn(config, state).kind, 'skip'); assert.equal(p.skipTurns, 0);
  p.jailTier = 2; p.jailSpinsNextTurn = 2;
  assert.deepEqual({ ...E.beginTurn(config, state), notes: undefined }, { kind: 'jail', spins: 2, notes: undefined });
  assert.equal(p.jailSpinsNextTurn, 1);
  p.jailSkipNextSpin = true; assert.equal(E.beginTurn(config, state).kind, 'skip'); assert.equal(p.jailSkipNextSpin, false);
});
