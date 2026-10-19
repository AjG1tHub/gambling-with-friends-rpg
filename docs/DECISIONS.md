# Decisions

Calls made during the build where the spec and the build prompt left room. Newest at the bottom.

1. **Supabase account.** The project `gwf-rpg` lives on the owner's GitHub-login Supabase account (org
   *anthonyjletizia*, ref `zzibezkvciucynangcyk`), created through the dashboard because that account is not the one
   the Claude connector holds. Neither the build workspace nor the owner's PC shell can reach Supabase hosts
   directly, so migrations are applied through the dashboard SQL editor; `supabase/migrations/` stays the source.
2. **Local backend for tests and the Lab.** `packages/shared/backend/local.js` implements the same interface over
   localStorage + BroadcastChannel (memory in Node). Unit, bot and browser suites run against it; the deployed
   site uses Supabase. The Lab always uses the local backend so it can never touch a real room.
3. **Minigame rounds are actor-authoritative.** The legacy game objects run on the acting phone and publish
   step snapshots (`ITEM_STEP`) and the final multiplier (`ITEM_RESOLVE`). This keeps the 36 games unmodified,
   keeps hidden picks on the phone, and tolerates the classics' use of the wall clock (Crash). Every other random
   draw is derived from room streams inside the reducer. See ARCHITECTURE.md.
4. **Legacy games are imported untouched, with a shim.** `legacy/site/js/games.js` imports `./state.js` for
   `log` and `credit`; `packages/games/legacy/` is a verbatim copy of the eight game files plus a 20-line
   `state.js` shim exporting in-memory `log`/`credit`, so the games never touch localStorage. A unit test diffs the
   copied files against `legacy/site/js/` to prove they are identical.
5. **Presence is not an event.** Heartbeats would flood the log. Phones ping the backend's presence channel;
   the TV appends `GM_PROXY` for the mover after 30 s of silence (`table.proxyAfterSeconds`).
6. **Event timestamps are the clock.** Handlers use `ctx.now` (the event's `ts`), never `Date.now()`, so a replay
   reproduces every clock-dependent decision. The TV is the client that notices deadlines and appends the
   timeout events.
7. **`turnIdx` and held turns.** A player in a challenge is in `state.held`; `currentPlayerId` skips held seats
   by derivation. When they return, the skipped turn is owed: `held[pid].missedTurn` makes them next after the
   current turn ends.
8. **Rooms expire by status, not deletion.** Ended rooms stay in Postgres (the recap and ledger need them). A
   room code can be reused once the previous room with that code has ended.
9. **GM identity.** The GM console authenticates with the PIN hash stored on the room; the console's device id is
   recorded on `ROOM_CREATED` so a second PC can take over by PIN. GM events use `actor: 'gm'`.
10. **Balance overrides live in room state.** `GM_CONFIG` writes `state.balance`; the GM's saved defaults live in
    the console's localStorage and are sent on `ROOM_CREATED`. `BALANCE.md` documents the shipped defaults.
11. **Royale** is a fifth mode (`mode: 'royale'`), not a modifier: Free-for-all rules plus a shrinking map
    (`royale.*` tunables) and the Chicken Dinner Platter.
12. **Classic mode** is `legacy/site` copied to `dist/classic` at build time and linked from the GM console's
    start screen ("Backend down? Run classic"). It is never edited.
