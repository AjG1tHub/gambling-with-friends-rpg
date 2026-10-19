# Gambling With Friends — questions for AJ (10 Oct 2026, updated after the 24 new games)

Answer what you can; anything left blank keeps the default in brackets.

## Blocking (nothing ships without these)

1. **Deploy.** The live site is still the 3 Sep build. Do you want to (a) log into Netlify in Chrome and have Claude deploy, or (b) drag the `site` folder onto Netlify → gambling-with-friends → Deploys yourself?
2. **Google Sheet.** Is the GM browser actually pointed at the Sheet (⚙ Settings shows an endpoint URL)? If yes, the Sheet needs rows for 28 of the 36 games and five pet wheel rows or those disappear from the real table. May Claude edit the Sheet directly, or would you rather paste `sheet/Code.gs` into Apps Script and run **GWF → Add missing tabs & rows**?
3. **Apps Script source.** Can you paste the script currently deployed on the Sheet (Extensions → Apps Script)? `sheet/Code.gs` was written from the Sheet's layout without seeing it.

## Game rules

4. **Big Wheel pays back 192%** on average (every other game is 93–100%). Intentional “fun tile”, or should it come down? If down, to what — ~97% like the rest? [left as is]
5. **What does a buy-in give you?** The Buy-in Wheel decides how you pay, but there is no rule for what you receive (a fresh 500? a GM-chosen amount?). [GM types a grant amount]
6. **Hedge power-up** (“lock one shop rate for 5 turns”) is sold but does nothing. Shop rates never change during a session except under Chaos tier 3+. Build it as “your rate survives Chaos”, change what it does, or remove it? [warned about in the config check]
7. **Gold below zero.** `GoldCanGoNegative` exists in the Sheet but nothing enforces FALSE. Do you ever want a hard floor at 0? If so, what happens to a bet you can't cover? [Gold can go negative]
8. **Loan terms:** 25% interest, due in 4 of your turns, then +20% and the Collector takes 150/turn; max 2 loans, 100–2,000 Gold. Right feel? [as listed]
9. **Shot clock** only nags (sound + red bar). Should running out cost something (skip, fine, GM's choice)? [nag only]
10. **Blackjack:** splits to 4 hands, double after split, insurance, 3:2, dealer stands on soft 17, split aces get one card. Want surrender, hitting split aces, or 6:5? [as listed]
11. **Keno / Slots paytables** were designed to return ~94–96%. Any jackpots you want bigger/rarer? [as built]

## The 24 new games (added 10 Oct, evening)

27. **Play-test them in the Game Lab** (`/lab`, or the 🧪 button in the GM bar): press N to step through, tick ✅ Works or ⚠️ Problem, type notes, then press **Copy report** and paste it into the chat. That report is the fastest way to tell me what to fix.
28. **Which games stay on the board?** All 36 are switched on, so a GAME tile can be anything. Pai Gow, Let It Ride and Casino Hold'em take a minute to explain. Switch some off (Built = FALSE), or keep everything? [all on]
29. **Should the new games use power-ups** (Nudge / Reroll / Fork)? Today only the 12 classics do. [no]
30. **The Races:** one bettor per race today. Want everyone at the table to be able to back a runner? Should the runners be the players' pets? [one bettor, fixed runners]
31. **Payout levels.** The new games return 94–98.6% (listed in the lab's Payout panel and by `node test/balance.mjs`). Anything you want looser or tighter?

## Pets & Power Level (all of this was invented — please react)

12. **Species.** 12 pets (Emberfox, Tidepup, Sprigbun, …) with two evolutions each, 5 bosses, 2 raid bosses, 5 held items. Keep, rename, or send your own list?
13. **Art.** Keep the generated emoji crests, or will you supply images (one per species, optionally per evolution)?
14. **Power economy:** +2 per turn, +10 game win, +25 big win, +20 battle win, +50 at session start; egg 100, cap 1,000. Should Power be scarcer or more plentiful? [as listed]
15. **Should pet battles matter to the main game more?** Today: optional Gold wager in PvP, bosses pay Gold. Should winning a pet battle ever move you on the board, free you from jail, etc.? [no]
16. **Elements** use ×1.5 strong / ×0.75 resisted (×2 / ×½ made matchups a foregone conclusion in simulation). OK? [yes]
17. **Do pets carry over between nights forever**, or reset each season? [carry over]

## Setup & hardware

18. **GM computer:** Windows or Mac? Any non-US keyboard (AltGr)? This decides whether Ctrl+Alt hotkeys are safe.
19. **How do people see the game** — one TV from the GM's PC only, or does anyone ever want it on their phone? Phone / remote play needs a backend (Supabase is already connected to your Claude).
20. **Sound:** nobody has heard it. After a test night: too much, too little, which cues annoy?
21. **How long is a real night, and how many players?** The ledger keeps the newest 5,000 events (~550 turns); longer nights lose the oldest rows from the recap charts (standings stay exact).

## Project housekeeping

22. **Is “Bigger Number Better Person” the same project** as this browser game, or a separate Roblox game? The vault note mixes the two.
23. **Private GitHub repo** for the source? Today it lives in `C:\Users\Aj\Claude\Projects\Gambling With Friends` plus a zip. [not done]
24. **History and saved players live in one browser's storage.** Fine, or should they be backed up somewhere (Drive file, Supabase)? [export buttons only]
25. **Game icons changed** (Big Wheel 🎡, 50/50 ⚖️; the Sheet still says 🎰 / 🎡). Which set do you want?
26. **What's next after deploy?** Pick from the “Ideas” row on the flow map (phones as controllers, remote play, more minigames, pet trading, tournament bracket, achievements, replay) — or something not on it.
