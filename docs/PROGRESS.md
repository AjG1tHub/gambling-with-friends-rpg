# Progress

Appended at every phase gate: what was built, what the tests say, what changed in `balance.json` and why, what
is placeholder, and what to look at first on test night.

## Phase 0 — scaffold, backend, lobby (in progress)

- Repo `AjG1tHub/gambling-with-friends-rpg`; Vite multi-page build (`apps/tv|phone|gm|lab`), Netlify config,
  GitHub Actions CI (unit, browser, bots).
- `legacy/` is the 10 Oct 2026 build, verbatim; its own 796 unit tests still pass in place.
- `packages/shared`: RNG streams with GM rig, hex math, state shape, `applyEvent` reducer with refusal
  semantics, replay, restore points, currencies through `health.js`, chess clocks from timestamps, turn order by
  derivation, lobby and run handlers.
- Backend interface + Supabase and local implementations; `room.js` session (snapshot + tail, ordered apply,
  gap back-fill). Supabase project `gwf-rpg` created; schema in `supabase/migrations/0001_init.sql`.
- Tests: `test/unit/core.test.mjs`, `test/unit/room.test.mjs` (four phones join, drop, rejoin, kick; snapshot resume).
