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
13. **Sticky mover.** `state.moverId` is set by `beginTurn` and cleared by `finishTurn`; while set, `currentPlayerId`
    returns it even if a hold is released mid-turn, so a challenge ending never hands the turn to someone else.
14. **Standing and elimination.** A dead character who will wake at the Graveyard is still *standing*; only
    `c.eliminated` (set by a player kill in pvp/teams/royale) or a kicked seat takes a character out of the run,
    and eliminated seats leave the turn order (`tableSeats`) while keeping their place in the ledger. In
    Free-for-all three deaths in a row therefore do not end the night.
15. **Last Call.** `table.lastCallMinutes` (100) ends any run still going on placings. It is the normal ending
    for seven or eight players and the safety net for everyone else; bot runs showed 8-player tables get 10–12
    turns each in 100 minutes, not enough for a throne run however the monsters are tuned.
16. **The Citadel Key.** Every region boss drops one for its killer; it is a quest item (never dropped on death,
    never vaulted) and opens the Sky Citadel's inner gates like level 10 does. Without it the Dealer is a season-two
    fight.
17. **Monster hits are capped.** `monsters.hitCapFraction` caps a single monster hit at 60% of max Health and
    monsters stake 60% of their item (`items.monsterStakeFraction`). Health stays hidden and hard to heal; a boss
    still kills in two swings, but never from full in one.
18. **The Shop never lets you plod.** Every shelf carries one Common weapon and one pair of Loaded Boots (d6) at the
    Common price, on top of the staples and the rolled gear.
19. **The clock stops while the monster acts.** A fight exchange is the player's round (their time) and the
    monster's (the TV's). `holdForMonster` banks the mover's clock when `fight.turn` is `monster` and releases
    it on `MONSTER_ACT`, so a long boss fight never times a player out while they are only watching.
20. **Slices are odds.** Every wheel renderer (TV overlay and stage, phone strips and the reward overlay, GM
    console, Lab) draws segment angles proportional to the segment weights, and every `lastSpin` carries
    `weights` so clients never guess. A painted wheel face (equal wedges) is used only when the odds are equal.
    Found by the QA run on 20 Oct: the wheels showed equal slices for weighted segments.
21. **Stats are a debuff under 3 and a boon at 10, on every weapon.** Besides each game's own lever, every win
    payout is trimmed `items.leverPenaltyPerPoint` (5%) per point below neutral and boosted
    `items.leverBonusPerPoint` (2%) per point above it, capped at stat 10. Loaded Dice's window is −1 under Grit 3
    and up to +3 at 10; the flat levers (Baccarat, Dragon Tiger, Briefcase, Pai Gow) were strengthened. The point
    is gear choice: a weapon whose stat you lack should feel wrong in the hand, and the phone's odds card says so.
