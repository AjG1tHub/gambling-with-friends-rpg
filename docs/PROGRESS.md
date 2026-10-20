# Progress

Appended at every phase gate: what was built, what the tests say, what changed in `balance.json` and why, what
is placeholder, and what to look at first on test night.

## Phase 0 — scaffold, backend, lobby

- Repo `AjG1tHub/gambling-with-friends-rpg`; Vite multi-page build (`apps/tv|phone|gm|lab`), Netlify config,
  GitHub Actions CI (unit, browser, bots).
- `legacy/` is the 10 Oct 2026 build, verbatim; its own 796 unit tests still pass in place.
- `packages/shared`: RNG streams with GM rig, hex math, state shape, `applyEvent` reducer with refusal
  semantics, replay, restore points, currencies through `health.js`, chess clocks from timestamps, turn order by
  derivation, lobby and run handlers.
- Backend interface + Supabase and local implementations; `room.js` session (snapshot + tail, ordered apply,
  gap back-fill). Supabase project `gwf-rpg` created; schema in `supabase/migrations/0001_init.sql`.
- Tests: `test/unit/core.test.mjs`, `test/unit/room.test.mjs` (four phones join, drop, rejoin, kick; snapshot resume).
- Gate: `test/browser/run.mjs` — a TV, a GM console and four phones in Chromium against the ws dev backend: join by
  code, drop and rejoin by seat, kick, start, pause. Passes. Deployed to Netlify from the deploy workflow.

## Phases 1–6 — the engine (map, items, encounters, characters, challenges, social and modes)

Built as data-driven handler modules behind one reducer (`packages/shared/handlers/*`, 20 modules) and wired through
`packages/shared/index.js`. Every tunable comes from `data/balance.json`; every Legendary, set, pet, monster and
minigame is data.

- Map: five regions grown as hex clusters with bridges, portals, a gated Sky Citadel and the throne; fog of war;
  three movement modes (dice with stop rules, wheel, card) from the boots on your feet; chess clocks from timestamps.
- Items: the 36 legacy games wrapped by `packages/games/adapter.js` as attacks, spells, versus and area items with
  Health stakes; rarity stakes and bonuses; affixes; charges; one payoff path (`resolveHit`) that every hook feeds.
- Encounters: region monsters, bosses on Boss Gates with a boss mood wheel, two raid bosses, the Dealer; fights to
  the death with alternating rounds (the TV plays the monster); loot, Gold, XP, Chaos tiers, Blood Pacts, Inn, Shop,
  Blood Bank, Graveyard deaths with drops and missed turns.
- Characters: phone creation with the stat gamble, six classes with passives and actives, XP and levels, the
  inventory grid with rotation, paperdoll slots, sets, Legendaries, pets and eggs, roster with claim codes, vault.
- Challenge Wheel: Duel, Wager, Robbery with hosted and external entries, held seats, owed turns, GM list editor.
- Social and modes: letters with interception, alliances, bounties, chaos votes, emotes, spectators; ffa, pvp, pve,
  teams and royale with placings, tiers, seasons and the Hall of Fame.
- Tests: 361 node tests (`npm run test:unit`) plus `tools/payout.mjs` (36 items × 20 000 rounds, 7 known outliers).

### Bot runs and balance (this gate)

`tools/bots.mjs` plays whole runs with the shared bot policy (`packages/shared/bot.js`, also behind the TV's
autopilot and the Lab) on a pessimistic simulated clock. `npm run test:bots` is the CI matrix: 4 and 8 bots in
every mode, failing on a stall or on a 4–6 player run over two hours. Current results (seed 1):

| Mode | 4 bots | 8 bots |
| --- | --- | --- |
| Free-for-all | throne reached, 82 min | Last Call, 111 min |
| PvP only | last one standing, 63 min | Last Call, 112 min |
| PvE only | the Dealer is dead, 70 min | Last Call, 112 min |
| Teams | the Dealer is dead, 82 min | Last Call, 112 min |
| Royale (4 / 6) | Last Call, 111 min | Last Call, 112 min |

What the runs changed (all recorded in `data/balance-notes.md`, which `BALANCE.md` appends):
monster Health down (40 / 100 / 180 / 180), monster stakes at 60% and a 60%-of-max-Health cap on any single monster
hit, charges 15, two monsters per region, maps that do not grow with the table, a Loaded Boots pair and a Common
weapon on every Shop shelf, the Citadel Key from every region boss (a quest item that survives death), the chess
clock paused while the monster acts, and **Last Call** at 100 minutes after RUN_START: the run ends on placings.

What that means for test night: a four-player table reaches a real ending on its own in 60–85 minutes; six players
usually do; seven or eight will hear Last Call. Bots play plainly (no alliances, letters at random, duels when
adjacent), so humans who cooperate on raids will get there faster, and humans who dawdle will not.

Placeholder: art is the generated placeholder set in `assets/`; sounds are the legacy engine's.
