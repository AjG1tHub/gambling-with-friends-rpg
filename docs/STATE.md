# State and data shapes

The room state is one JSON object (`packages/shared/state.js → initialState`). Every client applies the same
events to it through `applyEvent` (`reducer.js`). This file is the field reference; the spec is `SPEC.md`.

## Rules every module follows

1. **Only handlers mutate state**, inside `register({ EVENT_TYPE(state, ev, ctx) { … } })`. Handlers mutate in place;
   the reducer clones (or not) around them. A handler that `refuse()`s leaves the room untouched.
2. **`ctx.now` is the clock.** Never `Date.now()` inside a handler. Timestamps come from the event.
3. **Randomness comes from streams**: `streamRng(state, 'loot')`, `rigAwareInt(state, 'dice', 1, 6)`,
   `rigAwareWeightedIndex(state, 'wheels', segments)`. Streams: map, loot, wheels, dice, colours, challenge, games,
   pets, monsters, creation, misc. A GM rig (`GM_RIG {stream, value}`) is consumed by the next rig-aware draw.
4. **Currencies move through `health.js`** only: `health()`, `shield()`, `maxHealth()`, `gold()`, `bankGold()`,
   `power()`, `chips()`. Each writes a ledger row.
5. **Numbers come from `balance.json`** via `ctx.B('group').key` or `bal(state, 'group.key')`. No literals for
   anything a GM might tune. A unit test scans for stray numeric literals (`test/unit/balance-doc.test.mjs`).
6. **Turn order is derived**: `currentPlayerId(state)` reads `turnIdx` and skips `state.held` seats. Never edit
   `seats` to skip someone, never reset `turnIdx`.
7. **Hooks over imports**: modules plug into the run through `runHooks` (`handlers/run.js`): `runStart`,
   `turnStart` (return `'skip'` to burn the turn), `turnEnd`, `roundEnd`, `endCheck` (return `{winner, reason}`).
8. **Hidden information is hidden by the UI.** State holds secret hex colours, exact Health, letters in transit.
   The phone shows a player only their own; the TV shows the thirds tell. Minigame `secret` objects never leave
   the acting phone (see Items below).

## Top level

| Field | Type | Notes |
| --- | --- | --- |
| `v, roomId, code, seed` | | `code` is the 4-letter join code |
| `rng` | `{stream: uint32}` | current position of each stream |
| `rig` | `{stream: [value]}` | GM-forced next results |
| `balance` | `{group: {key: value}}` | overrides over `data/balance.json` |
| `mode` | `'ffa' \| 'pvp' \| 'pve' \| 'teams' \| 'royale'` | |
| `tier, size` | `1..3`, `'short' \| 'regular' \| 'long'` | |
| `phase` | `'lobby' \| 'creation' \| 'playing' \| 'ended'` | |
| `gm` | `{pinHash, deviceId, paused, pausedAt, spotlight[], proxies{}, challengePreset, challengeLists{}, duelsEnabled, fogOfWar, teams{}}` | |
| `players` | `{id: Player}` | seats and spectators |
| `seats` | `[playerId]` | turn order after `RUN_START` shuffles it |
| `turnIdx, round, turnStartedAt, turnPhase, moveSession` | | `turnPhase`: `'move' \| 'resolve' \| 'action' \| 'done'` |
| `characters` | `{id: Character}` | |
| `roster` | `{id: RosterEntry}` | mirror of what the backend knows for the seated owners |
| `wall` | `[name]` | names retired in this room (the backend holds the global Wall) |
| `map` | `Map` | null until `RUN_START` |
| `monsters` | `{id: Monster}` | |
| `fight` | `Fight \| null` | the active encounter |
| `challenge` | `Challenge \| null` | the active PvP challenge |
| `held` | `{playerId: {since, challengeId, missedTurn}}` | seats away in a challenge |
| `clocks` | `{playerId: {bankMs, runningSince, pendingStart}}` | |
| `lastSpin` | `{wheel, outcomes[], index, playerId, ts, colors?, effect?}` | what the TV animates |
| `area` | `AreaWindow \| null` | open Area bet window |
| `pendingPrompt` | `{playerId, kind, …} \| null` | the prompt a phone must answer before the turn moves on |
| `pacts, bounties, shops, tileLoot, auction, ledger, ledgerSeq` | | economy |
| `letters, alliances, votes, emotes, sideBets, quests` | | social |
| `chaos` | `{tier, roundsAtTier, effects[]}` | |
| `stats` | `{playerId: Stats}` | recap counters |
| `log` | `[{ts, text, kind}]` | last 300 human lines for the TV |
| `banner, toasts, hallOfFame, metaLedger, restorePoints` | | |
| `legendariesDropped, eventCount, lastEventTs, lastSeq, lastError, winner, endReason` | | |

## Player (a seat)

`{ id, name, deviceId, spectator, isGm, joinedAt, connected, lastSeenTs, ready, teamId, rosterId, rosterOwnerId, characterId, proxied, autopilot, kicked, crest }`

## Character

```
{ id, playerId, rosterId, name, crest, look: { body: 0..2, skin: 0..3, face: 0..7, hair: 0..11, coat: '#hex' },
  classId: 'whale'|'pitboss'|'cutpurse'|'enforcer'|'beastmaster'|'croupier',
  level, xp, statPoints, stats: { luck, nerve, greed, grit },
  health, maxHealth, shield, gold, bank, chips,            // chips only during creation
  pos: 'q,r' | null, lastSafePos, region,
  worn: { mainhand, offhand, spell1, spell2, helmet, torso, pants, gloves, boots, ring1, ring2, ring3, ring4, necklace, cape },   // Item | null
  grid: { cols, rows, cells: [ { itemId, x, y, rot, qty } ] },   // one cell record per placed item (its top-left)
  items: { itemId: Item },                                  // every item the character holds (worn or in the grid)
  pets: [Pet], activePetId,
  dead, missTurns, deaths, graveyardPos, diedTo: 'monster'|'player'|'boss'|null,
  cooldowns: { active: 0 },  activeUses, effects: [ { id, kind, turnsLeft, data } ],
  pactIds: [], wanted: 0, kills, titles: [], quests: [],
  usedThisTurn: { attack, spell, moved }, turnsTaken, streak,
  freeRestakeUsed, freeSmokeBombs, buyinSpun, locked, creation: { … } }
```

## Item

```
{ id, baseId, name, slot,                 // slot: weapon|offhand|spell|helmet|torso|pants|gloves|boots|ring|necklace|cape|consumable|tool|egg|satchel
  gameId,                                 // for weapons and spells: one of the 36 legacy ids
  kind: 'attack'|'spell'|'area'|'versus', // for weapons and spells
  family: 'dice'|'cards'|'wheels'|'nerve'|'picks',
  stat: 'luck'|'nerve'|'greed'|'grit',    // governing stat
  rarity: 'common'|'rare'|'epic'|'legendary',
  stake, charges, twoHand,
  bootMode: 'dice'|'wheel'|'card' | null, die: 4..20 | null,   // boots
  footprint: { w, h }, stackable, qty,
  affixes: [ { id, kind, target: { family } | { game } | null, value, text } ],
  legendaryId, setId, unique,            // hand-written items
  seed, region, tier, sprite }           // sprite = manifest key for the icon and the worn layer
```

## Map, hex, region

```
Map { hexes: { 'q,r': Hex }, regions: { id: Region }, start: 'q,r', throne: 'q,r', courier: 'q,r', revealed: { regionId: true }, size, seed }
Hex { q, r, key, regionId, type, colour, void: false, bridge: false, gate: { level, keyItem } | null, monsterId, lootSeen, portalTo }
  type: encounter|wheel|shop|inn|bloodbank|graveyard|arena|chaos|chest|event|bossgate|portal|bounty|start|throne|plain|courier|blocker|water|chasm|wall
Region { id, name, tier, family, accent, modifier, hexKeys: [], monsterTable: [monsterId], bossId, revealed }
```

## Monster

`{ id, speciesId, name, regionId, pos, health, maxHealth, stats, items: [Item], boss, raid, final, gmControlled, dead, linkedTo, loot: { gold, items, egg } }`

## Pet

`{ id, speciesId, name, element, stage, power, maxPower, attacks: [ { gameId, name, stake } ], heldItem, fainted, bodies (swarm), caughtAt }`

## Fight (encounter)

```
{ id, kind: 'encounter'|'boss'|'raid'|'petbattle'|'arena', monsterId, playerIds: [], playerId (whose turn), turn: 'player'|'monster',
  game: ItemGame | null, log: [], done, result, startedAt }
ItemGame { itemId, gameId, mode: 'health'|'chips', stake, attackerId, targetId, targetKind: 'monster'|'character'|'self',
           phase, view, result, pending, startedTs, legacy: { …snapshot of the legacy game object minus `secret`… } }
```

## Challenge

```
{ id, call: 'duel'|'wager'|'robbery', attackerId, defenderId, attackerItemId, defenderItemId, amount,
  entryId, entry: { name, hosted, link, rules, capSeconds, team }, spunAt, deadline,
  reports: { playerId: winnerId }, winnerId, done, hostedGame, gmPending, startedAt }
```

## Letter

`{ id, fromId, toId, text, sentAt, sentTurnIdx, deliverAfterTurns, deliveredAt, intercepted: { byId, action: 'pass'|'destroy'|'forge', forgedText } | null, read }`
