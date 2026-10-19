# Gambling With Friends — source

A GM-run browser party game: a board, a pile of wheels, casino minigames, jail, loans, and a pet-battling
side game. One computer, two windows — the **GM monitor** (`/gm`) drives everything, the **player view**
(`/`) is the shared screen. No server, no accounts, no real money.

- Live site: https://gambling-with-friends.netlify.app (Netlify project `gambling-with-friends`, site id `607c16be-bc31-4846-b529-946a0a9e2eba`)
- Design spec: Google Drive → `gambling-with-friends-roadmap-v0_4.md`
- Live tunables: Google Sheet `GWF Config` (overrides the built-in config tab by tab)

> **Deploy status (2026-10-10):** the live site is still the **3 Sep 2026** build. Everything in the changelog
> below is in this folder but **not deployed**. To deploy: Netlify → the project → Deploys → drag the `site/` folder in.

## Layout

| Path | What it is |
|---|---|
| `site/` | The deployable folder — nothing else is published. |
| `site/index.html` · `site/gm/index.html` | Player view · GM monitor |
| `site/rules/` | Player rulebook, generated from the live config |
| `site/lab/` | **Game Lab** — every minigame on one menu, in a sandbox, for play-testing |
| `site/gm/guide.html` · `site/gm/hotkeys.html` | GM quickstart · printable hotkey card |
| `site/js/` | ES modules (see the map below) · `site/css/` theme tokens + app styles |
| `sheet/Code.gs` | Apps Script for the Sheet endpoint (generated — edit `Code.template.gs`) |
| `tools/` | `serve.mjs` (local server) · `build-apps-script.mjs` (regenerates `sheet/Code.gs`) · `contrast.mjs` (theme contrast report) |
| `Play Game Lab.bat` | Double-click to play on this PC without deploying |
| `test/` | Unit tests, browser run, balance report, soak bot |
| `backups/` | Source snapshots (zip) — the PC copy only |

### Module map (`site/js`)

- **Core:** `state.js` (state, save/load, ledger, credit) · `engine.js` (board, movement, wheels, verbs, jail, shop, chaos, turns) · `rng.js` · `config.js` + `config-default.js`
- **Minigames:** `games.js` (the 12 classics + settlement) · `gm-games.js` (GM controls) · `game-ui.js` (shared-screen stage, recap)
- **Plug-in minigames (24):** `games-extra.js` (registry) · `games-quick.js` · `games-show.js` · `games-table.js` · `xkit.js` (shared helpers) · `poker.js` (hand ranking) · `lab.js` + `lab-core.js` (Game Lab)
- **Pages:** `gm.js` (GM window) · `view.js` (player view) · `render.js` (board + leaderboard) · `wheel-ui.js`
- **Table systems:** `loans.js` · `auction.js` · `buyin.js` · `contests.js` · `stakes.js` · `turns.js` · `hotkeys.js` · `sound.js`
- **Side game:** `pets.js` · `petbattle.js` · `raid.js` · `sprites.js`
- **Records:** `stats.js` · `history.js` · `profiles.js` · `ledger-tools.js`
- **Safety:** `snapshots.js` (undo, session files) · `recovery.js` (versioning, audit/repair, restore points) · `config-check.js` (config doctor) · `rules.js` (rulebook)

## How it works

- The GM window is the **only writer**. Every click ends in `sync()` → `saveState()` (localStorage `gwf_state`
  + BroadcastChannel `gwf`). The player view only renders what it is sent.
- Dice are a **seeded RNG** whose position is saved with the state, so undo and restore rewind the dice too.
- **Money moves only through `credit()`**, which writes a ledger row for what actually moved. Balances can
  always be rebuilt from the ledger (the soak bot checks this after every action).
- Minigame contract: `startGame()` builds `state.game`; `gameAction()` advances it; money moves only in
  `settle(mult)` where `mult` is the total return on the stake (0 lose · 1 push · 2 = 1:1 win). Chance games set
  `g.pending` (supports Nudge / Reroll / Fork); skill games set `g.result`. Anything that plays out over time
  sets `g.view.revealAt` — the player view ticks until then and the GM's Settle button waits for it.
- Config: `config-default.js` holds every tunable. With a Sheet endpoint set (⚙ Settings), each Sheet tab
  **replaces** the built-in tab of the same name; tabs the Sheet lacks use the built-ins. The 🩺 config check
  says what is wrong or missing.

## Playing locally (no deploy needed)

Double-click **`Play Game Lab.bat`** in this folder. It starts a small local server (Node.js, or Python if Node is missing) and opens the Game Lab at `http://localhost:8080/lab/`. The GM monitor is at `/gm/` and the player view at `/` on the same address. Opening the HTML files directly from disk does not work — browsers refuse to load the game's modules from `file://`.

## Tests

```sh
sh test/run.sh                 # ~800 unit tests (node:test), about a minute
sh test/run.sh all             # unit + browser run + balance report + soak
node test/ui.mjs               # two-window Playwright run of the whole game → test/shots/*.png
node test/lab.mjs 3            # opens the Game Lab and plays every game 3 times → test/shots/lab/*.png
node test/balance.mjs          # expected return (RTP) of every minigame
node test/soak.mjs 60 500      # bot plays 60 sessions × 500 turns, invariants checked after every action
node test/themes-shots.mjs     # screenshots of all four themes
node tools/contrast.mjs        # contrast ratios per theme
node tools/build-apps-script.mjs   # after changing config-default.js: regenerate sheet/Code.gs
```

Needs Node 20+. The browser runs need Playwright (`npm i playwright` and adjust the `createRequire` path at
the top of `test/ui.mjs` if it lives somewhere else).

## Updating the Google Sheet

The Sheet predates most of the changelog, so it lacks the newer games, wheel rows and tabs (the config check
lists them). Two ways to bring it up to date:

1. Paste `sheet/Code.gs` into the Sheet's Apps Script (Extensions → Apps Script), redeploy as a **new version of
   the existing deployment** (keeps the `/exec` URL), reload the Sheet, then run **GWF → Add missing tabs & rows**.
   It only adds; it never changes or deletes what you typed.
2. Or add rows by hand using `site/js/config-default.js` as the reference.

## Changelog

| Loop | What landed |
|---|---|
| 1 | Unit-test harness, IRL stakes tracker, battle wager floor |
| 2 | Sound packs (4 theme voices, 23 cues), ledger sequence numbers |
| 3 | Stats module, recap v2 with awards, leaderboard movement arrows |
| 4 | Hotkey registry (fixes Mac + Shift-digit), help overlay, printable card, text scale + high contrast |
| 5 | Loans + Collector timers, net-worth standings |
| 6 | Cross-session history, Hall of Fame, records, export/import |
| 7 | Saved player profiles (one-click seating) |
| 8 | Hi-Lo and Dice minigames |
| 9 | Slots and Keno minigames |
| 10 | Blackjack splits (up to 4 hands, double after split) and insurance |
| 11 | Pets + Power Level (species, D&D stats, hatching, training) |
| 12 | Pet battles (d20 engine, elements, 5 bosses, PvP wagers) |
| 13 | Pets on the board (wheel verbs, wild encounters, pet shop, Pet Battle on the Battle wheel) |
| 14 | Pet status effects (burn, soak, root, shock, blind, Light drain) |
| 15 | Pet evolution and trainer ranks |
| 16 | Co-op raids (2–6 pets vs a scaled boss) |
| 17 | Pet art pipeline (image URLs per stage, generated crests as fallback) |
| 18 | Held items for pets (shop gear, boss drops) |
| 19 | Automated digital battle contests (coin flip, high card, dice duel) |
| 20 | Live auction (lots, bids, going once / twice / sold) |
| 21 | Automated buy-in mechanics |
| 22 | Undo (30 clicks, dice rewind too) and session save/load files |
| 23 | Turn tools (reorder, sit out / return, shot clock) |
| 24 | Ledger viewer (filter, search, CSV) + Gold-over-time chart |
| 25 | Config doctor (validation, RTP warnings, Sheet diff), Apps Script source with add-missing menu, built-in odds for every game |
| 26 | Save versioning + migration, health audit/repair, rolling restore points, quota-safe saves, crash banner |
| 27 | Rulebook generated from the live config, GM quickstart |
| 28 | Theme polish: text-safe colour tokens (WCAG AA on all four themes), readable light theme, stale-wheel fix |
| 29 | Soak bot (196k checked actions) + the four bugs it found |
| 30 | Repo self-checks, toasts instead of alert boxes, full regression, docs |

### After loop 30

- **2026-10-10 — 24 more minigames and the Game Lab.** Quick: Coin Streak, War, Dragon Tiger, Red Dog, Chuck-a-Luck, Sic Bo, Under/Over 7, Wheel of Colours, Scratch Card, Limbo. Show: The Races, Tower, Chicken Cross, Pachinko, Deal or No Deal, Dice Hi-Lo, Ride the Bus, Thimbles. Table: Video Poker, Three Card Poker, Let It Ride, Casino Hold'em, Craps, Pai Gow Poker. They are plug-ins: one object per game (rules, GM buttons, shared-screen stage, bot) — see the header of `site/js/xkit.js`. `/lab` lists all 36 games for testing; it uses the built-in config, never touches a real session and never posts to the Sheet's ledger. Also: the shared screen now keeps ticking for 2.5 s after every game action, so dealt cards always appear.

Earlier: **2026-10-09 — Phase 4b** (Blackjack, Baccarat, Plinko; source recovered from the live 3 Sep deploy,
since no repo existed) · **2026-09-03** — last deploy (Phases 0–5 + Start Wheel, shop mirror, clearer Mines).

## Known gaps

- Not deployed (see the note at the top).
- One computer only: both windows must be the same browser on the same machine. Phones / remote players would need a backend.
- History, saved players and restore points live in that browser's storage; use the export buttons to move them.
- `Config.GoldCanGoNegative = FALSE` is not enforced (the config check warns).
- Sound was verified by counting oscillators, never by ear.
- The 24 plug-in games do not use Nudge / Reroll / Fork, and have no sound cues of their own beyond the generic win/lose ones.
- The Races takes one bettor (the player whose turn it is); everyone-bets-at-once would need a new betting step.
- `sheet/Code.gs` was written from the Sheet's layout, not from the script that is currently deployed there (its source was not available) — test it on a copy of the Sheet first.
