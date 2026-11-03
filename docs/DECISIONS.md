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

## Art and sound pipeline (1 Nov 2026)

22. **Sound stays at 48 kHz.** The pipeline prompt asks for 44.1 kHz cues; the spec's asset table, the legacy
    sound engine and `tools/build-manifest.mjs` (which computes `seconds` from `SAMPLE_RATE = 48000`) all assume
    48 kHz. post.py resamples every cue and loop to 48 kHz 16-bit mono at −16 LUFS, so the manifest's durations
    stay right. Changing the game to 44.1 would have meant editing game code, which the pipeline may not do.
23. **Pixel-set backgrounds are chroma-keyed, not model-segmented.** Every FLUX.2 icon prompt asks for a flat
    pure green (#00FF00) background and post.py keys it out deterministically; rembg (BiRefNet) is used only for
    the painted groups (monster portraits, map dressing) and falls back to a corner flood fill when it is not
    installed. Segmentation models soften pixel edges; a keyed background keeps them hard.
24. **Paper-doll layers are diffs against the body they were drawn on.** For faces, hair, outfits, worn items and
    Legendaries the adapter sends PixelLab the reference body frame for each pose (`ART_BODY_REF`, default
    `body/1_1`, the Enforcer build) as `init_image` and asks for the figure wearing the item; post.py keeps only
    the pixels that differ from that exact frame (SPEC.md › sprites, "diffing against the base"). The layer
    therefore rides the body's hand-drawn frames through the renderer's per-pose offsets, as the spec intends.
25. **Pet stages 2 and 3 and monster tokens are Gemini edits of their parent.** Stage 1 and eggs come from
    PixelLab; the later stages are image-to-image edits of the previous stage so a line stays one creature. A
    token is an edit of the portrait (head-and-shoulders bust). The pipeline orders rows so parents land first
    and refuses a child whose parent is still a placeholder.
26. **Wheel faces are rim textures wrapped in SVG by post.py.** FLUX.2 paints the rim and face texture with no
    divisions; post.py writes the SVG with `<g id="segments">` holding one unstyled `<path>` per label and
    `<g id="labels">` with one `<text>` each, so `packages/ui/wheel.js` can restyle and relabel them and only
    inlines the face when the odds are equal (decision 20). Odds are never baked into art.
27. **Rarity frames are one 9-slice source per rarity.** Four FLUX.2 generations (192 px, 36 px border) are
    sliced by post.py into the six footprints each, so the 24 frame files share one hand per rarity.
28. **SVG UI and TV chrome are generated rasters wrapped in SVG.** The spec's "real SVG or Recraft" for UI is not
    in the prompt's tool table; the rows are SVG files, so post.py wraps a FLUX.2 raster in an SVG of the spec
    size (pixelated for UI, smooth for TV). A hand-drawn vector pass can replace any of them by filename later.
29. **Manual tools queue, never block.** Midjourney and Suno rows append a line to `art/midjourney/queue.md` or
    `art/suno/queue.md` and record `queued` in the ledger; `npm run art:import` picks the results up from
    `art/inbox/<tool>/<key>.png|wav` by filename. A redo re-queues the row (old line marked REDO, new seed, the
    reviewer's note appended) and ignores an inbox file older than the asset it replaced.
30. **API drift is a probe, not a guess.** The adapters follow the public API documents as read on 1 Nov 2026
    (PixelLab v2 `create-image-pixflux` / `animate-with-text-v3` / `background-jobs`, fal queue REST with
    `fal-ai/flux-2-pro`, `fal-ai/flux-2-trainer`, Gemini `generateContent` with inline image parts, ElevenLabs
    `/v1/sound-generation`). `npm run art:probe` fetches each live schema and lists any field an adapter sends
    that the schema lacks; the model ids are `.env.local` overrides. The fal LoRA inference endpoint id in
    particular (`FAL_LORA_MODEL`, default `fal-ai/flux-2/klein/9b/lora`) must be confirmed by the probe before
    the first LoRA batch.
31. **Costs are estimates for the spend cap.** The services bill in credits or per megapixel; the adapters charge
    round USD figures per call (overridable in `.env.local`) so `ART_BUDGET_USD` can stop a run. The ledger's
    `cost` is that estimate, not an invoice.
32. **A Versus item is the attacker's round.** Clash, Dice Duel, Shell Game and Hold'em Duel are played with the
    items adapter on the attacker's phone; that phone (or the GM) reports and the report settles. The defender's
    phone shows "watch the TV" and no buttons, and a defender's `CHALLENGE_REPORT` is refused. Demo night 1 (room
    ZJGG, 2 Nov) had both Shell Game rounds "won" by the defender tapping their own name before anyone played.
33. **`players: "team"` means a best-of-three series, nothing else.** Tetris 1v1 and skribbl.io were flagged
    `team` and needed two rounds of agreeing reports; they are `1v1` now. Use `team` only for entries whose
    rules say "best of three".
34. **The tutorial is three layers, no new events.** (1) The TV cycles the rule cards (`packages/ui/tutorial.js
    ruleCards(state)`, numbers from the room's balance) in the lobby and during creation, and prints the seat
    order with held / owed / dead reasons under To Move all run long. (2) The GM console's Table › Teach row
    pushes any card to every phone as a `📖` `GM_BROADCAST` (the TV rail shows it for 30 s). (3) The phones have
    a context-sensitive Coach, a `?` help sheet, and a solo practice run on the local backend with two bots.
    Nothing here changes the engine or persists in the room.
