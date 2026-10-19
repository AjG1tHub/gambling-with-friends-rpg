# Architecture

Gambling With Friends: RPG Edition. Vanilla ES modules bundled by Vite, one Supabase project as a synchronized
event store, one Netlify site. See `SPEC.md` for the game, `STATE.md` for data shapes, `BALANCE.md` for tunables,
`DECISIONS.md` for calls the spec left open.

```
apps/tv        shared screen       apps/phone  controller (portrait PWA)     apps/gm  console     apps/lab  Game Lab
packages/shared  state model, applyEvent reducer + handlers/, hex, rng streams, balance, clock, backend/, room.js
packages/games   legacy/ (the 36 games, copied verbatim) + adapter.js (game → item) + items.js (the 36 item definitions)
packages/ui      shared DOM components: wheels, cards, grid inventory, sprite renderer, rosette, dice, toasts
data/            balance.json, classes, items, affixes, legendaries, sets, pets, monsters, regions, tiles, quests, challenges
assets/          placeholder art + sound at final paths; manifest.json (generated)
supabase/        migrations
tools/           generators (placeholders, manifest, balance doc, rulebook, gm guide), bots, payout report, sheet import
test/unit        node --test        test/browser  Playwright        test/bots  bot-run assertions
legacy/          the previous build, read-only; served at /classic
```

## The event loop

1. A client builds an event (`makeEvent`) and calls `backend.append(roomId, event)`. The backend assigns `seq`.
2. Every client (including the sender) receives the event from the subscription and applies it with
   `applyEvent(state, event)`. Arrivals ahead of `lastSeq + 1` wait in a buffer; a gap older than 1.5 s triggers
   a back-fill (`backend.loadEvents(roomId, lastSeq)`).
3. The TV writes a snapshot every 25 events; a late joiner loads the snapshot and only the tail.
4. Timers (chess clocks, Area windows, challenge caps) are *computed* from event timestamps. The TV is the
   client that appends `TURN_TIMEOUT`, `AREA_RESOLVE`, `CHALLENGE_TIMEOUT` when it sees a deadline pass.

The backend is not a referee. Hidden information is hidden by the UI. Moving a rule server-side later means
running the same reducer in an edge function; the event log is already the record.

## Minigames as items

The 36 legacy game objects run **on the acting phone**, through `packages/games/adapter.js`, exactly as they ran
in the GM window before (same code, same odds, same `start/act/controls/stage/bot` contract). Each step the
phone publishes `ITEM_STEP { game: <legacy game object minus secret> }`; the reducer stores that snapshot so the
TV can render the stage and other phones can watch. When the game reports `done`, the phone publishes
`ITEM_RESOLVE { mult, label }` and the reducer turns `stake × mult` into damage, healing, a shield or a steal
through `health.js`. Hidden picks (Mines squares, Scratch panels, the shell, Ride the Bus calls) live in the
game's `secret`, which never leaves the phone.

Determinism: item rounds are *authoritative from the actor* (the trust model), so they are allowed to use the
phone's wall clock (Crash) and the phone's `games` stream. Everything else — map, loot, wheels, dice, colours,
challenge spins — is derived from the room's seeded streams inside the reducer, so every client computes the
same result and the GM's rig lands where decided.

## Apps

- **TV** (`/`): opens a room as `role: 'tv'`, renders map, banner, clocks, stage, wheels, ticker, QR. Owns the
  deadline events. Spotlight renders up to four phones' `ITEM_STEP` snapshots in a 2×2 grid.
- **Phone** (`/phone?code=XXXX`): joins, keeps a device id and a roster owner, tabs Play / Cage / Self / Pets /
  Map / Letters. Everything is 60 px targets, portrait, dark.
- **GM** (`/gm`): PIN gate, creates rooms, config screen over `balance.json`, player management, rig, Spotlight,
  challenge list editor, Drop Back In, undo and restore points, recap, Hall of Fame, ledger.
- **Lab** (`/lab`): every item, wheel and the creation gamble runnable against a dummy opponent, with a phone
  mode (`/lab?phone=1`) that renders the real phone controls. Uses the local backend only.

## Generated files

`tools/build-manifest.mjs` → `assets/manifest.json`; `tools/build-balance-doc.mjs` → `docs/BALANCE.md`;
`tools/build-rulebook.mjs` → `docs/RULEBOOK.md` + `apps/*/rules.json`; `tools/placeholders.mjs` → `assets/**`.
`test/unit/generated.test.mjs` fails when any of them is stale.
