# Gambling With Friends: RPG Edition

A grimdark-casino roguelite party game for a table of friends. One PC drives the shared TV screen; every player
runs a character from their own phone. The 36 casino minigames are weapons and spells, Health is the stake,
monsters fight to the death and players fight one Challenge Wheel round per turn.

- Live: https://gwf-rpg.netlify.app — `/` TV · `/phone` controller · `/gm` console · `/lab` Game Lab · `/classic` the previous build
- Docs: [`docs/SPEC.md`](docs/SPEC.md) (frozen design) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/STATE.md`](docs/STATE.md) ·
  [`docs/BALANCE.md`](docs/BALANCE.md) (every tunable) · [`docs/RULEBOOK.md`](docs/RULEBOOK.md) · [`docs/GM-GUIDE.md`](docs/GM-GUIDE.md) ·
  [`docs/DECISIONS.md`](docs/DECISIONS.md) · [`docs/PROGRESS.md`](docs/PROGRESS.md)

## Run it

```sh
npm ci
cp .env.example .env.local        # Supabase URL + publishable key (or add ?backend=local to any URL to play offline on one PC)
npm run dev                        # http://localhost:5173/tv/  /phone/  /gm/  /lab/
npm test                           # unit suites
npm run test:browser               # Playwright: TV + GM + four phones
npm run bots                       # bot runs, every mode
npm run gen                        # regenerate placeholders, manifest, BALANCE.md, rulebook
```

`legacy/` is the previous one-computer build, untouched (its own tests: `npm run legacy:test`).
