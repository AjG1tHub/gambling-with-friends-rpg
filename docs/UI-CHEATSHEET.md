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
