# UI cheat sheet — how the apps talk to the engine

Read with ARCHITECTURE.md and STATE.md. Everything below exists and is unit-tested.

## Session and dispatch
- `apps/phone/main.js` gives each tab `({ state, session, me, c, myTurn, ctx, h, dispatch, screen })`; `dispatch(type, payload)` appends with `actor = ctx.me` and toasts a refusal. `apps/gm/main.js` gives panels `({ state, session, ctx, h, gm, main })`; `gm(type, payload)` appends as `'gm'`. `apps/tv/main.js` has `session.dispatch(type, payload, 'system')` for table duties.
- Refusals: `state.lastError = { type, actor, message, code, ts }` after a refused event; the UI shows `message`.
- Re-render: `view(state)` runs on every event. Build DOM with `h()` from `packages/ui/dom.js`; containers made with `lenient()` ignore null children.

## Turn loop (phone, when `currentPlayerId(state) === me`)
- `state.turnPhase`: `'move'` → `MOVE_ROLL {}` then `MOVE_STEP {dir 0-5 | to:'q,r'}` / `MOVE_STOP {}` / `MOVE_PATH {to}` / `MOVE_SWAP_BOOTS {itemId}` / `PORTAL_PICK {regionId}`; `'resolve'` → the tile hook is working (a prompt or a fight); `'action'` → shop/bag/attack/end: `TURN_END {}`.
- `legalSteps(state, pid)` (from `packages/shared/handlers/movement.js`) → six `{dir, name, key, type, label, legal, reason, bridge, stops}` for the rosette. `cardView(state, pid)` → Card boots view `{range, hexes:[{key, colour, dist, type}], card, cards, destinations, peek}`; `moveSummary(state)` is what the TV may show. `state.moveSession = { playerId, mode:'dice'|'wheel'|'card'|'barefoot', roll, dice, movesLeft, stepsTaken, path, mustWalk, canStopAfter, atomic, destinations, done }`.
- Prompts: `state.pendingPrompt = { playerId, kind }` with kinds `spin {wheel, hexKey}` → `WHEEL_SPIN {wheel}`; `portal {options|from,to}` → `PORTAL_PICK {regionId}` or `TILE_LEAVE {}`; `arena {hexKey}` → `CHALLENGE_CALL {defenderId, call, itemId, arenaWager}` or `TILE_LEAVE {}`; `takeWorn {victimId, options:[itemId]}` → `TILE_TAKE_LOOT {itemId}`; `callout {targetId, byId}` (informational).
- Tile actions in `'action'`: `SHOP_BUY {sku}` (`state.shops[hexKey].stock = [{sku, name, priceKey, qty}]`, prices in `balance shop.*` via `group(state,'shop')[priceKey]`), `SHOP_SELL {itemId}`, `INN_REST {}`, `PACT_TAKE {amount}` / `PACT_REPAY {pactId, amount}`, `BANK_DEPOSIT/WITHDRAW {amount}`, `TILE_TAKE_LOOT {itemId}` for `state.tileLoot[hexKey]`, `BOUNTY_PLACE {targetId, gold}`, `QUEST_TAKE {questId}`, `AUCTION_OPEN/BID/CLOSE`, `TRADE_OFFER {toId, give:{gold,itemIds,petIds}, want:{…}}` / `TRADE_ANSWER {tradeId, accept}` (`state.trades`).
- Clock: `remainingMs(state, pid, Date.now())` from `packages/shared/clock.js`.

## Fights and items (phone)
- Attack: `ITEM_USE {itemId, targetId, targetKind:'monster'|'character'|'self'}` creates `state.fight.game` (an ItemGame: `{itemId, gameId, mode, stake, attackerId, attackerPlayerId, targetId, targetKind, phase, view, result, legacy}`). The acting phone then plays the round locally:
  ```js
  import { startRound } from '@games/adapter.js';
  const round = startRound({ state, B: (g) => group(state, g) }, { item, mode: 'health', stake: fight.game.stake, attacker: c, target, rng: makeRng(seed), now: Date.now() });
  round.controls()  // { info, buttons:[{label, a, p, primary, danger, disabled, hidden}], grid? }  (hidden buttons never go to the TV)
  round.act(a, p)   // → { done?, mult?, text, pending? }; then dispatch('ITEM_STEP', { game: round.snapshot(), text })
  round.stage(now, { esc, cardsHtml })  // HTML for the stage (same renderer the TV uses)
  // when done: dispatch('ITEM_RESOLVE', { mult, label, crit })  from round.outcome()
  ```
  Nudge/Reroll/Fork: `CONSUMABLE_USE {itemId}` sets `fight.game.pendingChoice = {kind, by}`; the phone then calls `round.nudge(label)` / `round.reroll()` / `round.fork()` + `round.pickFork(i)` and continues. Spells target `'self'` or an ally. Area: `AREA_OPEN {itemId}` → `state.area = {gameId, hexKey, deadline, stakes:{[charId]:{stake}}}`; others `AREA_STAKE {stake, pick?}`; the TV appends `AREA_RESOLVE {results}` at the deadline (see `tableDuties` in `packages/shared/bot.js`).
- Monster turn: `state.fight.turn === 'monster'` → the TV plays it (`playMonsterTurn`) and appends `MONSTER_ACT`. `FIGHT_FLEE {}`, `FIGHT_END {}`, `GM_TAKEOVER {monsterId, on}`.
- `CLASS_ACTIVE {activeId, targetId?, mode?, outcome?}` (`doubledown`, `houserules {mode}`, `sleight {mode, targetId, itemId?}`, `callout {targetId}`, `rally`, `rigthedeck {outcome:'win'|'lose', forId}`); cooldown in `c.cooldowns.active`; `c.upgrades` list.
- Pets: `PET_HATCH {source, itemId?}` → `c.hatching = {wheels:[3 × {segments, index}], picked}` and `state.lastSpin {wheel:'pets', wheels}`; `PET_HATCH_PICK {index}`; `PET_SWITCH {petId}`; `PET_ATTACK {petId, attackIndex, mult, label}` (play the attack's game with the adapter first); `PET_BATTLE_START {opponentId, petId, wager}` / `PET_BATTLE_LOCK {attackIndex}`.

## Challenge Wheel (phone + TV)
- `CHALLENGE_CALL {defenderId, call:'duel'|'wager'|'robbery', itemId, amount?}`; defender: `CHALLENGE_ANSWER {accept?, itemId|null}`; attacker: `CHALLENGE_SPIN {}`; GM: `CHALLENGE_GM_SET {entryId|reroll:true}` inside `challenge.gmWindowUntil`; purpose-built duels: `CHALLENGE_STEP {action, payload}` (reducer runs `hosted.act`); versus items / external: `CHALLENGE_REPORT {winnerId|'draw', flawless?}`; GM: `CHALLENGE_GM_DECIDE {winnerId|'draw'}` (= Drop Back In); TV: `CHALLENGE_TIMEOUT {}` at `challenge.deadline`.
- `challengeView(state, pid, now)` (handlers/challenge.js) → `{ role, phase:'answer'|'ready'|'spinning'|'playing'|'done', entry:{name, hosted, game, link, rules}, deadline, secondsLeft, canAnswer, needsWeapon, hosted: phoneView, reportButtons:[{winnerId,name}], myReport, gmPending, winnerId }`. `offScreenCard(state)` → the TV's card for external entries. `packages/shared/challenge/hosted.js`: `phoneView(game, pid, now)`, `tvView(game)`, `botAction`.
- `CHALLENGE_LIST {preset, name?, entries?, activate?, remove?} | {presets} | {trivia}`; `exportLists(state)`; `activeList(state)`; presets in `data/challenges.json`.

## Social
- `LETTER_SEND {toId, text, kind?}`, `ALLIANCE_PROPOSE {toId, text}`, `ALLIANCE_ANSWER {letterId, accept}`, `LETTER_INTERCEPT {letterId, action:'pass'|'destroy'|'forge', forgedText}` (when `interceptable(state, pid)` lists letters), `inbox(state, pid)`, `outbox(state, pid)`; `VOTE_OPEN/CAST/CLOSE`, `voteView(state, pid)`; `EMOTE {emoji|text}` → `state.emotes`; `SIDE_BET {challengeId|fightId, onId, amount}`.

## Creation (phone) and roster
- `CREATION_OPEN` (GM). Phone: `CHAR_LOOK {name, crest, look:{body,skin,face,hair,coat}}` → `CHAR_CLASS {classId}` → gamble: play a chips-mode round with the adapter (`mode:'chips'`, `gameId` ∈ `group(state,'creation').gambleGames` = fifty/dice/hilo/buyin, stake 1–5 chips) then `CHAR_STAT_GAMBLE {stat, chips, mult, gameId}`; `CHAR_BLOOD {chips}` once; `CHAR_LOCK {alloc:{stat:n}}`; `CHAR_PICK_ROSTER {rosterEntryId, name?}`; `CHAR_MIRROR {look, crest}` between turns; `VAULT_PULL {itemIds}`; `PET_TEAM {petIds}`; `creationStatus(state, now)` + `creationDeadline(state)` from handlers/creation.js. `c.creation = {gambles:[…], blooded, alloc}`; `c.chips`.
- Roster: on join the phone loads `backend.roster.forDevice(deviceId)` (or `create`), then `ROSTER_SYNC {ownerId, entries}` and `ROSTER_CLAIM {playerId, ownerId}`; claim code = `owner.claimCode` (show on Self); `backend.roster.claim(code, deviceId)` recovers on a new phone. At run end `rosterExport(state, pid)` → write into `owner.data` and `backend.roster.save(owner)`; `VAULT_BANK {itemIds}`, `VETERAN_SAVE {}`.
- Wall: `backend.wall.taken(name)` before `CHAR_LOOK`; `backend.wall.add(rows)` at run end for dead characters.

## Inventory (phone Cage)
- `GRID_MOVE {itemId, x, y, rot}`, `GRID_EQUIP {itemId, slot?}`, `GRID_UNEQUIP {slot}`, `GRID_DROP {itemId}`, `GRID_SORT {}`. Pure helpers in `packages/shared/characters/grid.js`: `fits(grid, item, x, y, rot)`, `cellsOf`, `firstFit`, `autoSort`. `c.grid = {cols, rows, cells:[{itemId, x, y, rot, qty}]}`, `c.items[itemId]`, `c.worn[slot]`. Footprints in `item.footprint {w,h}`; rarity frames `frames/<rarity>_<WxH>`.
- Sprites: `layersFor(c)` in `packages/shared/characters/sprites.js` → ordered `{slot, key, z}`; frames 64×96; `assets/manifest.json` gives `path` + sprite meta per key; `healthThird(c, group(state,'health'))` → `'high'|'mid'|'low'|'dead'` for the lantern.

## Map (TV + phone mini-map)
- `state.map.hexes['q,r'] = {q, r, key, regionId, type, colour, void, bridge, gate, monsterId, portalTo}`; `state.map.regions[id] = {id, name, tier, family, accent, hexKeys, revealed, look, signature, bossGateKey, portalKey}`; `state.map.start/throne/courier`; `state.map.revealed[regionId]`. Pixel math: `hex.toPixel({q,r}, size)`, `hex.polygonPoints(cx, cy, size)`. Tile glyphs/labels: `tileLabel`, `tileGlyph` in `packages/shared/map/query.js`; data/tiles.json; region accents in data/regions.json. Monsters: `state.monsters[id] = {name, pos, health, maxHealth, dead, boss, raid, final, sprite}`.
- Never draw hex colours or exact Health on the TV; the TV shows the thirds tell (`healthThird`) and `moveSummary`.

## Wheels (TV animation)
- Every spin sets `state.lastSpin = { wheel, outcomes:[labels], index, playerId, ts, colors?, effect?, revealAt?, wheels? }`. The TV animates to `index` (the result is already decided). Wheel ids: buyin, chaos, fortune, fate, loot, boss, movement, challenge, pets (three wheels). Faces: `assets/wheels/<id>.svg`.

## GM
- Everything in `packages/shared/events.js` under GM_*; `GM_PROXY {playerId, on}` (a proxied seat is played from the console: open `/phone/?code=X&as=<playerId>` which dispatches as `'gm'` with `payload.playerId`); `GM_AUTOPILOT {playerId, on}` (the TV runs `nextAction` from `packages/shared/bot.js` for that seat); `GM_SPOTLIGHT {playerIds}` (≤4) → the TV renders those phones' `fight.game.legacy` / creation rounds in a 2×2 grid; `GM_RIG {stream, value}`; `GM_CONFIG {balance}`; `CHALLENGE_GM_DECIDE`.
- Table duties (`tableDuties(state, rng, now)` in bot.js) are appended by the TV: TURN_TIMEOUT, MONSTER_ACT, AREA_RESOLVE, CHALLENGE_TIMEOUT, VOTE_CLOSE, and GM decisions when nobody is at the console (`gmPending`) — leave those to the GM when a console is connected (`session.presence.gm` recent).

## Added after the app builders' reports

- `CHAR_GAMBLE_STEP {stat, gameId, chips, game, text}` (phone, during creation) mirrors a creation gamble round into
  `c.creation.liveGame = {stat, gameId, chips, legacy, text, ts}` for the TV Spotlight; `CHAR_STAT_GAMBLE` clears it.
- `CHAR_STAT_POINT {stat}` spends one level-up stat point (any phase); refuses with the reason when none are pending.
- `LETTER_READ {letterId}` marks a delivered letter read (`l.read`, `l.readAt`); the Letters tab dot uses it.
- `PET_RENAME {petId, name}` sets `pet.nickname` (≤ 18 chars).
- `GM_MONSTER_MOVE {monsterId, hex}` (GM) moves a monster that is not in a fight.
- `LETTER_SEND` / `ALLIANCE_PROPOSE` take `playerId` as the sender when the GM proxies a phone.
- `attach()` returns `{ session, close, setPresence(meta) }`; the phone re-registers presence under its player id
  once it has a seat, so the TV never proxies a fresh seat for silence.
- The bot's `tableDuties` leaves a `gmControlled` monster to the GM console.
- Creation gamble `'buyin'`: the phone spins an 8-segment wheel with multipliers `creation.buyinMultipliers`
  (actor-authoritative, like any round) and reports the result through `CHAR_STAT_GAMBLE`.

## QA: bug reports and the Bug Reward Wheel (handlers/qa.js, wheels.json `bugreward`)

- `BUG_REPORT {text, screen?, context?}` from any phone (actor = the player; the GM/TV pass `playerId` or none) →
  `state.bugReports[] = {id, ts, playerId, name, text, screen, context, phase, round, turnIdx, eventSeq, status, notes, reward}`.
  Log line: "X reports a bug on <screen>" (kind `qa`).
- `GM_BUG_STATUS {bugId, status: open|fixed|wontfix|dupe|rewarded, notes?}`.
- `GM_BUG_REWARD {playerId, bugId?}` spins the Bug Reward Wheel **in secret**: no `lastSpin`, no log line (loot pickup
  lines are trimmed). Result → `state.secretSpins[playerId] = {id, ts, wheel:'bugreward', outcomes[], index, label, text, bugId, seen, message}`
  and a copy with `playerId` in `state.bugRewards[]`. Only that player's phone and the GM console may render it — the
  TV must never read `secretSpins`/`bugRewards`. `message` is the line to show at the top of the phone's wheel:
  "You get a secret reward for helping squash a bug. Don’t tell anyone 🤫". Effects (wheels.js `APPLY.bugreward`):
  rare/epic/legendary gear into the grid at once, `wheels.bugGold`, `wheels.bugPotions`, full heal + `wheels.bugMaxHealth`,
  +1 stat point, a pet egg. Segments and texts: `data/wheels.json` → `bugreward`.
- `BUG_REWARD_SEEN {}` from the phone once it has shown the wheel (`seen: true`, mirrored into `bugRewards`).
- `spinWheelSecret(state, ctx, wheel, playerId)` in wheels.js is the generic secret spin; `segmentsFor(state, 'bugreward')` lists the segments.

## Stat levers on screen (packages/games/lever-view.js, packages/ui/lever.js)

- `data/lever-curves.json` (built by `npm run levers`, ~30 s, commit it when a lever or odds table changes): per game,
  the bot-played expected return and win rate at every stat value 1–10.
- `leverView(gameId, statValue)` → `{ stat, value, neutral, curve, base, yours, deltaPts, text, note }`;
  `leverSummary(gameId, statValue)` → "Luck 7 · return 118% (base 102%, +16)"; `gamesForStat(stat, value)`.
- `leverBar({ gameId, statValue, compact })` draws the 10-bar curve with the player's bar lit and the neutral bar marked.
  It sits under the round head on every phone round, in the attack menu rows (return and delta), the Cage item sheet
  (lever line), Self › Stats (each stat lists the games it bends with your edge), and the Lab's facts panel.

## Tutorial (phone): the Coach, the Help sheet, the practice run

- `apps/phone/coach.js`: `coachStep(state, me, ctx) → { id, title, text, auto } | null` (pure; `me` = player id, ctx = `{ tab, dismissed: Set, tutorial, now }`), `situation()` gives the id alone, `turnOrderLine(state, me)` → "Held in a challenge: Jam and Milkiee — Ajax plays their slot. Order: Ajax → Vin (you). You are next." / "You are owed a turn from slot 3; it comes right after this one." (uses tableSeats, held, owedTurns, turnIdx, currentPlayerId). `coachCard(api)` is called from main.js's `view()` and sits in its own grid row between the header and the screen on every tab; `coachPanel()` (Self) resets or hides tips. Dismissed ids: localStorage `gwfrpg:coach:v1`; hide flag `gwfrpg:coach:off`. A step with `auto` is dismissed when the situation changes on the Play tab (the player did the thing).
- 📖 broadcasts: a `GM_BROADCAST` whose text starts with `📖 ` (`📖 Title: text`) renders as a dismissible rule card in the coach slot while under 60 s old (dismissed ids in `gwfrpg:coach:rules:v1`); main.js skips the toast for those. Other broadcasts stay toasts. The GM console's Table › Teach row sends them; the TV rail shows the same card for 30 s.
- `apps/phone/help.js`: the `?` button opens `helpSheet` — "This screen" (the coach step + `SCREEN_HELP[situationId]` button list), "A turn in 30 seconds", "The rules in 10 cards" (`ruleCards` from `packages/ui/tutorial.js`), the glossary (numbers from `group()`), `rulesDrawer()`, tip controls, "Quit practice".
- `apps/phone/practice.js`: `/phone/?practice=1` = "Learn to play" from the join screen. Local backend (`boot({ kind: 'local', namespace: 'practice' })`), room ffa/short/tier 1/no fog/`challengePreset 'inperson'`/`balance.table.lastCallMinutes 20`, the human + `seatBots(2)`, `startAutopilot` on the phone with `autostart: false` and `isGmOnline: () => false` (bots and table duties). practice.js is the GM: CREATION_OPEN when every seat is ready, un-readies the human once in creation, RUN_START when every seat is locked and ready, `GM_RIG {stream:'challenge', value:'highestcard'}` on the human's CHALLENGE_CALL, `GM_TELEPORT` a bot onto the human's hex when the duel goal is current in their action phase. Goals (`practiceGoal(state, me, progress)`): gamble → lock → ready → move → end → fightOrShop (skippable) → duel → result → done; progress (from the human's events) in `gwfrpg:practice:v1`, so a reload resumes. "You know enough" / "Quit practice" → GM_END_RUN, `_reset()` of the practice namespace, back to `/phone/`.
- Table side (`packages/ui/tutorial.js`): `ruleCards(state)` (the TV cycles them in the lobby/creation; the GM Teach row sends them) and `orderLine(state)` (the TV prints it under To Move).
- Tests: `test/unit/coach.test.mjs`, `test/unit/tutorial.test.mjs`; `node test/browser/tutorial.mjs` (built site, no dev server: a real local lobby with Got it and a 📖 card, then the whole practice run to the join screen).

## Tutorial opening (the ramp): handlers/ramp.js

- Room option `state.gm.ramp = { on, steps: null | [...], skipped: { [pid]: true } }`. `ROOM_CREATED { ramp?: bool, rampSteps?: [] }` (default on when `tier === 1`), `GM_CONFIG { ramp, rampSteps? }`, `GM_RAMP_SKIP { playerId? }` (no id = the whole table: `on = false`). Steps default to `balance ramp.steps` = `['move', 'gear', 'fight', 'challenge', 'all']`; entries are feature keys `move, gear, fight, challenge, social, class, pets, chaos` or `all`. Counted on the player's own turns: `state.turnCounts[pid]` (bumped in `beginTurn` before the turnStart hooks).
- Pure: `rampStage(state, pid) → { on, turn, step, index, unlocked: Set, next: { feature, onTurn } | null, locked: [{ feature, onTurn }], done }`, `unlocked(state, pid, feature)`, `rampLine(state, pid)` ("Next turn: shops and your Cage unlock"; `''` when over), `lockMessage(state, pid, feature)` ("Fights unlock on your turn 3"), `FEATURE_LABEL`, `STEP_TEASER`, `LOCKS` (event → feature). `rampBanner(state)` in `packages/ui/tutorial.js` → `{ playerId, turn, step, text }` for the TV rail on a turn that unlocks a step.
- Enforcement: a reducer `onBefore` hook refuses every `LOCKS` event with code `locked` for the acting seat (`payload.playerId | fromId | attackerId`, else the actor) while `state.phase === 'playing'` and the ramp is on and not skipped for them; a `takeWorn` prompt answer is exempt. `movement.js`: `legalKeys` / `legalSteps` (reason "the monsters are asleep for you") / `stepTo` / Card destinations / `jumpTo` keep a fight-locked player off monster hexes (refusal "the monsters are asleep until your turn 3", code `locked`). `tiles.js`: the Arena prompt is skipped (log line) while `challenge` is locked. `wheels.js segmentsFor(state, 'chaos', { playerId })`: tier 1 segments while `chaos` is locked (`spinWheel` passes the spinner). `bot.js`: `nextAction` and `chooseGoal` consult `unlocked()`.
- Phone: locked panels are hidden, never disabled (play.js `actionScreen` / `tilePanel` / `attackPanel`, fight.js rows, cage.js read-only with `dispatch: null`, letters.js without Write) and the action phase ends with the `rampLine()` teaser (`.ramp-line`). Coach: `RAMP_STEPS` (coach.js) keyed by step; `coachStep` returns `{ id: 'ramp.<step>', ramp }` on the player's turn for the plain turn situations (`move.roll`, `move.spent`, `action`, `resolve`), dismissible per step; `rampLocks(state, me)` feeds the help sheet's "Still to come" list. Practice (`practice.js`): the room is created with `ramp: true`; goals `move → end → gear (skippable) → fight (skippable) → duel → result → done`; the bot is teleported for the duel only once `unlocked(state, me, 'challenge')`.
- TV: rail panel `.ramp-banner` from `rampBanner(state)`; the seat ticker appends ` · turn 2 · gear` while a seat's ramp is on and not done. GM: Create-a-room checkbox (`defaults.ramp`, default on for tier 1, follows the tier select), Config checkbox (`GM_CONFIG { ramp }`), Table › "Skip ramp for everyone" and a per-seat "Skip ramp" with the seat's stage.
- Tests: `test/unit/ramp.test.mjs`; the unit `room()` / `table()` fixtures and `tools/bots.mjs` default to `ramp: false` (`--ramp`, and the suite's `ffa ×4 +ramp` room); the browser gate unticks the checkbox; `test/browser/tutorial.mjs` covers the ramp through the practice run.
