# Rulebook

Generated from `data/*.json` and `data/balance.json` by `tools/build-rulebook.mjs`; do not edit by hand. The phone's rules sheet renders the same sections from `data/rulebook.generated.json`.

Contents: [The game in one paragraph](#concept) · [Your turn](#turn) · [Classes](#classes) · [Stats, XP and levels](#stats) · [The 36 weapons and spells](#items) · [How to play each one](#howto) · [Consumables](#consumables) · [Inventory: the cage and the paper doll](#grid) · [Boots and movement](#boots) · [What each hex does](#tiles) · [Regions](#map) · [Health, death and Blood Pacts](#health) · [PvP: the Challenge Wheel](#challenge) · [Wheels](#wheels) · [Named Legendaries](#legendaries) · [Blockcraft armour sets](#sets) · [Pets](#pets) · [Letters, alliances and votes](#social) · [How a run ends](#end)

## The game in one paragraph <a id="concept"></a>

GWF RPG Edition is a grimdark-casino roguelite played in runs of one to two hours: every run rolls a fresh map, monsters and loot, each player makes a new character on their phone, and what survives the run (a few vaulted items, a veteran character, the pets you caught) is the progression between runs. The 36 minigames become attacks and spells: every weapon or spell is one minigame with its own Health stake, win and the target takes the damage, lose and the stake is gone. Monster fights are to the death and player fights are one hit a turn with a chance to run, Health is hidden and hard to heal, and the GM runs the night from the PC while playing from a phone like everyone else.

Everything is a run: the GM creates a room, the TV shows the map, a QR code and a four-letter room code, every phone joins, and you make or pick a character. Up to 8 players; the map is tuned for 4 to 6 and a Regular run aims at about 90 minutes.

## Your turn <a id="turn"></a>

- Your phone buzzes. Roll, spin or draw as your boots decide, then step hex to hex, up to your roll, choosing a direction each step; you may stop early unless the boots say otherwise.
- Only the hex you end on resolves. Walking into a monster stops you; a gated bridge needs its level, key or toll; void hexes (water, chasm, wall) are impassable.
- Action phase: one attack and one spell per combat turn, plus shop, bag, trades and letters. Then end your turn.
- Chess clock: 1:30 is added at the start of your turn, unused time banks up to 5:00, and at zero the turn ends where it stands. Each Nerve point above 3 adds 5 s. The clock warning sounds with 15 s left.
- A phone silent for 30 s hands its prompts to the GM console; you pick the turn back up on reconnect.

## Classes <a id="classes"></a>

Six classes, each with a passive, an active on a cooldown counted in your own turns, and upgrades at levels 5, 10, 15 and 20. Each class starts with +1 in its stat and its own Common starting weapon on top of the shared starter kit (Coin Blade, Loaded Dice, Mend and 2 Potions).

| Class | Plays like | Stat | Passive | Active [cooldown] | Upgrades 5 / 10 / 15 / 20 | Starting weapon |
| --- | --- | --- | --- | --- | --- | --- |
| Whale | All-in gambler | Nerve | Weapon stakes cost 25% less; hits deal 15% more | Double Down: The next hit deals double damage, win or lose the stake [6] | Crit multiplier +0.5 / Double Down also doubles a spell's healing / Can use an item whose stake exceeds Health, dropping to 1 / Double Down cooldown 3 | Wheel of Ruin |
| Pit Boss | The house; outlasts everyone | Grit | Healing items restore 50% more; Blood Pacts cost 15%; takes 10% less from monsters | House Rules: Cancel the next Chaos effect, or turn the next roll against you into a push [5] | Inn heals twice per visit / Shop prices 25% off / The Collector never visits / House Rules can void an enemy win once per fight | Ward |
| Cutpurse | Thief and spy | Luck | Fork and Nudge cost half; reads every letter that crosses their tile; one free Smoke Bomb per run | Sleight: Swap tiles with any player, or steal the item in a random grid cell of a player in reach [6] | Forge replies to intercepted letters / Steal a chosen cell / Hidden on the TV map for 2 turns after a Smoke Bomb / Sleight cooldown 3 | Shell Game |
| Enforcer | PvP duelist | Grit | +25% damage against players; death penalty one turn shorter; cannot be swapped | Call Out: Force a fight with any player within 3 tiles; they cannot Smoke Bomb out [5] | First hit of a fight +25% / A player kill heals 20 / Long Arm built in / Call Out reaches the whole region | Loaded Dice |
| Beastmaster | Trainer; pets carry the fight | Luck | Pets earn Power 2x; extra egg at run start; first pet faint per run is undone | Rally: Heal the active pet to full mid-fight [4] | Carry 7 pets / Pet attacks +15% / Two pets fight before you do / Rally revives a fainted pet | Mend |
| Croupier | Odds-maker; spells and rerolls | Nerve | Spells stake 50% less; one free Reroll per fight | Rig the Deck: Pick the result of the next binary outcome (any 50/50, over/under, red/black) for anyone in the fight [6] | Cards family +15% / Two spells per turn / Reroll works on an opponent's roll / Rig the Deck works on a wheel | Twin Fang |

## Stats, XP and levels <a id="stats"></a>

Four stats, 1 to 10: Luck (reroll odds, loot rarity), Nerve (shot clock seconds, one free re-stake per night), Greed (damage multiplier on win streaks, but Blood Pact interest +2% a point), Grit (damage taken reduced 3% per point, cheaper revives). Every game has a governing stat: each point above 3 improves its odds the way the item table says, each point below worsens them.

XP: 5 for a turn, 20 for a hit, 50 for a crit, 50 for a KO, 40 for a pet battle, 100 for a quest, 250 for a boss. Level cap 20; every level gives one stat point and +10 max Health (100 at level 1). A veteran keeps its level.

Creation is a gamble: every stat starts at 3, you hold 10 Stat Chips, stake 1 to 5 on any starter game per stat, and a win pays chips × the multiplier into that stat (cap 8 at creation). Unspent chips become +1 each when you lock in. Once per creation you may stake max Health (10 Health = 1 chip, up to 30 chips). The creation clock is 10:00; anyone unlocked at zero gets the safe allocation.

## The 36 weapons and spells <a id="items"></a>

Every weapon or spell is one minigame. Using it: pick a target, stake its Health cost, play the game on your phone while the TV shows the stage. Win and the target takes stake × the game's payout as damage (spells heal, shield or steal instead); lose and the stake is gone; push, nothing. The game's top multiplier is a critical hit. Stakes by rarity: Common 10, Rare 20 (+10% damage), Epic 35 (+25%), Legendary 50 (+50%). Items have 15 charges. You cannot use an item whose stake is more than your current Health.

Kinds: Attack hits one target on your hex or an adjacent one (Long Arm reaches 2). Spell targets yourself or an ally. Area makes every player on the hex stake at once in a 20-second window. Versus has both players stake; the loser takes the winner's stake as damage.

| Item | Minigame | Kind | Family | Stat | Lever |
| --- | --- | --- | --- | --- | --- |
| Coin Blade | fifty | Attack | Wheels | Luck | win chance +2% a point |
| Wheel of Ruin | bigwheel | Attack | Wheels | Luck | a spin stopping one segment off yours slides onto it 8% a point |
| Roulette Storm | roulette | Area | Wheels | Luck | one extra covered number per 2 points |
| Fuse Bomb | crash | Attack | Nerve | Nerve | the fuse burns 4% slower a point |
| Minefield | mines | Attack | Nerve | Nerve | one fewer mine per 2 points |
| Ward | blackjack | Spell | Cards | Greed | blackjack pays +0.1x a point; double on any two cards at 6 |
| Twin Fang | baccarat | Attack | Cards | Greed | Player and Banker pay 2% more a point; Tie pays more |
| Rockslide | plinko | Attack | Picks | Luck | pegs lean to the outer high slots 3% a point |
| Mend | hilo | Spell | Cards | Grit | ties heal at 5; peek the next card's colour at 7 |
| Loaded Dice | dice | Attack | Dice | Grit | win window −1 under Grit 3, up to +3 at 10 |
| Jackpot Cannon | slots | Attack | Picks | Luck | wild symbols 5% more common a point |
| Star Shower | keno | Attack | Picks | Luck | one free extra pick per 2 points |
| Chain Lightning | coinstreak | Attack | Nerve | Nerve | the first miss of a streak is forgiven at 6 |
| Clash | war | Versus | Cards | Grit | ties go to the higher Grit |
| Dragon's Breath | dragontiger | Attack | Cards | Greed | Tie pays +1× a point; a Dragon/Tiger bet keeps 10% more on a tie per point |
| Hound Snap | reddog | Attack | Cards | Greed | raise multiplier +0.2 a point |
| Triple Dice | chuckaluck | Attack | Dice | Grit | a triple pays 10x instead of 3x at 6 |
| Bone Cage | sicbo | Attack | Dice | Grit | Small and Big lose less of their edge each point; triples no longer kill them at 7 |
| Lucky Seven | underover7 | Attack | Dice | Grit | a 7 is a push instead of a loss at 5 |
| Prism Spin | colorwheel | Attack | Wheels | Luck | one extra colour covered per 3 points |
| Scratch Charm | scratch | Spell | Picks | Luck | one free extra scratch per 2 points |
| Limbo Rope | limbo | Attack | Nerve | Nerve | the named multiplier is reached 3% more often a point |
| Stampede | race | Area | Picks | Luck | your runner starts one length ahead a point |
| Siege Tower | tower | Attack | Nerve | Nerve | one extra safe tile per floor per 3 points |
| Road Run | chicken | Attack | Nerve | Nerve | traffic 5% slower a point |
| Pachinko Hail | pachinko | Attack | Picks | Luck | the centre pocket 4% wider a point |
| The Briefcase | deal | Spell | Picks | Greed | the banker's offers rise 8% a point |
| Dice Duel | hilodice | Versus | Dice | Grit | your bust threshold +1 per 3 points |
| The Bus | bus | Attack | Cards | Nerve | a wrong first call is free at 5 |
| Shell Game | thimbles | Versus | Picks | Luck | Luck for the picker (+4% a point), Nerve for the hider (-4% a point) |
| Hand of Fate | videopoker | Attack | Cards | Greed | jacks-or-better pays 2x at 5; a second draw at 7 |
| Trident | threecard | Attack | Cards | Greed | the ante bonus pays from one rank lower per 3 points |
| Let It Ride | letitride | Attack | Cards | Greed | a pair pays from 9s at 5; pull back a third time at 7 |
| Hold'em Duel | holdem | Versus | Cards | Greed | see one flop card before calling at 6 |
| Bone Toss | craps | Attack | Dice | Grit | a come-out 12 is a push at 4; odds pay +5% a point |
| Twin Ward | paigow | Spell | Cards | Grit | commission falls 1.5% a point |

## How to play each one <a id="howto"></a>

Every round starts the same way: the item is readied against a target, the stake is on the table, and your phone shows the game. What you tap next is below. Hidden picks (mines, scratch panels, the shell, bus calls) are never shown on the TV.

- **Coin Blade** (fifty, attack) — *Call it, then spin.* A coin on a wheel: tap SPIN and it lands heads or tails. Heads hits for 1× your stake; tails and the stake is gone. The simplest swing in the game — no choices, just nerve.
- **Wheel of Ruin** (bigwheel, attack) — *One spin, seven segments.* Spin the big wheel: it stops on 1×, 2×, 3×, 5×, 10×, 20× or LOSE. Whatever multiplier it lands on is what the target takes, times your stake; LOSE costs you the stake. The big segments are small — most spins are 1× or 2×.
- **Roulette Storm** (roulette, area) — *Pick a bet, spin, cover the room.* An Area item: everyone on the tile may bet. Choose RED/BLACK, ODD/EVEN, LOW/HIGH (pays 1:1), a dozen or a column (2:1), or tap a single number (35:1), then SPIN. The ball lands on one pocket; every bet that covers it pays.
- **Fuse Bomb** (crash, attack) — *Light the fuse, cash out before it blows.* Tap LAUNCH and the multiplier starts climbing from 1×. Tap CASH OUT any time to lock the multiplier you see — or set an Auto cash-out first. If the fuse blows before you cash out, you lose the stake. The longer you wait, the bigger the hit and the bigger the risk.
- **Minefield** (mines, attack) — *Clear safe squares, walk away in time.* A 5×5 grid hides a few mines. Tap squares: each safe one raises the multiplier. Tap Walk away to bank what you have. Hit a mine and the stake is gone. Your picks are hidden from the table until the round ends.
- **Ward** (blackjack, spell) — *Beat the dealer without going over 21.* A healing spell. You see two cards and the dealer's up-card. HIT to take a card, STAND to stop, DOUBLE to double the stake for exactly one more card. Beat the dealer's total without busting past 21 to heal; a natural blackjack pays 1.5×. Bust or lose the hand and the stake is burned.
- **Twin Fang** (baccarat, attack) — *Player, Banker or Tie — then watch.* Pick a side before the deal: PLAYER (1:1), BANKER (0.97:1) or TIE (9:1). Two hands are dealt by the book, closest to 9 wins. Nothing to do after the bet — it's a pure read on the odds.
- **Rockslide** (plinko, attack) — *Drop the rock, hope it bounces wide.* Tap DROP and a chip falls through a field of pegs into one of the slots along the bottom. The edges pay huge (33×), the middle pays under 1×. Where it lands is where it lands.
- **Mend** (hilo, spell) — *Higher or lower, card after card.* A healing spell. One card shows. Call HIGHER or LOWER for the next; the multiplier grows with every right call (the unlikely call pays more). CASH OUT whenever you like to heal for the multiplier you have. One wrong call and the stake is gone.
- **Loaded Dice** (dice, attack) — *Roll 1–100 against your own target.* Choose UNDER or OVER a number: the safer the call, the smaller the multiplier (under 95 pays 1.03×; under 25 pays 4×). Tap ROLL. If the roll is on your side of the target you hit for that multiplier; otherwise you lose the stake. Grit moves the line: a point against you below 3, up to three points in your favour at 10.
- **Jackpot Cannon** (slots, attack) — *Pull the lever, match the reels.* Tap PULL. Three reels spin; matching symbols pay by the paytable, with the jackpot symbol paying the most and wilds standing in for anything. No decisions — a pure swing.
- **Star Shower** (keno, attack) — *Pick your stars, the sky draws ten.* Tap up to 10 numbers on the board (or Quick 5), then DRAW. Ten numbers are drawn; the more of yours that come up, the bigger the multiplier. Picking fewer numbers makes each hit worth more.
- **Chain Lightning** (coinstreak, attack) — *Call the coin, ride the streak.* Call HEADS or TAILS; each right call roughly doubles the multiplier and you may CASH OUT after any of them. A wrong call ends the streak and takes the stake. Two in a row is already a strong hit — greed is the whole game.
- **Clash** (war, versus) — *High card wins. Ties go to Grit.* A Versus item for duels: you and your opponent each turn one card, the higher card wins the round outright. Ties go to the higher Grit. Nothing to decide — the fastest fight on the table.
- **Dragon's Breath** (dragontiger, attack) — *Dragon or Tiger — one card each.* Bet DRAGON (1:1), TIGER (1:1) or TIE (13:1) before the deal. One card is dealt to each side; the higher card wins. A tie pays big but is rare.
- **Hound Snap** (reddog, attack) — *Will the next card fall between the first two?* Two cards are dealt. If a third card could fall strictly between them, choose: DEAL THE CARD with your stake as it is, or DOUBLE THE STAKE first for twice the win (and twice the loss). A tight gap pays 5:1, a wide gap 1:1. Consecutive cards push; a pair pays 11:1 if the third card matches.
- **Triple Dice** (chuckaluck, attack) — *Pick a number, three dice roll.* Pick a number from 1 to 6. Three dice are rolled: you hit once for each die showing your number (1×, 2×, 3× — a triple pays extra at high Grit). None of them and you lose the stake.
- **Bone Cage** (sicbo, attack) — *Three dice, a board of bets.* Bet on the three-dice total: SMALL (4–10) or BIG (11–17) at even money, ODD/EVEN, an exact total (up to 68:1 for a 4 or 17), or ANY TRIPLE (33:1). Then roll. Triples beat Small and Big unless your Grit is high.
- **Lucky Seven** (underover7, attack) — *Two dice: under, over or exactly 7.* Bet UNDER 7 or OVER 7 (1.3:1) or EXACTLY 7 (4.75:1), then roll two dice. The total decides it. At Grit 5 a rolled 7 pushes instead of losing on Under/Over.
- **Prism Spin** (colorwheel, attack) — *Bet a colour, spin the prism.* Bet a colour — Red pays 1.1:1 and covers nearly half the wheel; Purple pays 23:1 and is a sliver — then spin. Luck lets you cover an extra colour.
- **Scratch Charm** (scratch, spell) — *Scratch panels, match three.* A healing spell. Nine hidden panels: tap to scratch them one at a time, or Scratch all. Three matching symbols heal for that symbol's multiplier. Your scratches are hidden from the table.
- **Limbo Rope** (limbo, attack) — *Name a multiplier, see if the rope holds.* Type or pick a target multiplier (1.5× is likely, 50× is a prayer), then GO. A number is drawn; if it reaches your target you hit for exactly that multiplier, otherwise the stake is gone.
- **Stampede** (race, area) — *Back a runner, watch the stampede.* An Area item: everyone on the tile may bet. Back one of six runners — favourites pay about 3×, the long shot pays 15× — then the race runs. Only the winner pays. Luck gives your runner a head start.
- **Siege Tower** (tower, attack) — *Climb floor by floor, one door is safe.* Each floor shows three doors; one or two are safe. Tap a door: safe and you climb, the multiplier rising with every floor; CASH OUT between floors to bank it. Open the wrong door and you fall with the stake.
- **Road Run** (chicken, attack) — *Cross the road one lane at a time.* Tap STEP to cross a lane; each lane raises the multiplier and the risk shown before you step. CASH OUT when you've had enough. Get hit and the stake is gone.
- **Pachinko Hail** (pachinko, attack) — *Drop five balls, hope for the centre.* Tap Drop 5 balls. Each ball rattles down the pins into a pocket; the centre pocket pays most, the edges pay least, and the five results add up into one multiplier.
- **The Briefcase** (deal, spell) — *Keep a case, take the banker's offer or open yours.* A healing spell. Pick one of ten cases to keep. Open the others a few at a time; between rounds the banker offers a buyout — take DEAL to heal for the offer, or NO DEAL and keep going. Open all the rest and you heal for whatever your case holds.
- **Dice Duel** (hilodice, versus) — *Higher or lower on the dice, cash out before you bust.* A Versus item for duels: a die shows; call HIGHER or LOWER for the next roll (the long call pays more). Right calls stack the multiplier; CASH OUT to lock it. A wrong call busts. Grit widens your bust threshold.
- **The Bus** (bus, attack) — *Ride the bus: four calls in a row.* Red or black? Higher or lower? Inside or outside? Which suit? Four calls, each one multiplying the stake; GET OFF after any right call to keep what you have. A wrong call stops the bus and takes the stake. Your calls are hidden from the table.
- **Shell Game** (thimbles, versus) — *Find the pea under one of three cups.* A Versus item: one player hides the pea, the other points at a cup. Find it and the picker hits; miss and the hider does. Luck helps the picker, Nerve helps the hider.
- **Hand of Fate** (videopoker, attack) — *Hold the cards you like, draw the rest.* Five cards are dealt. Tap the ones to HOLD (or tap Suggest), then DRAW to replace the rest. Jacks-or-better pays, pairs upward through straights, flushes and a royal. Below a pair and the stake is gone.
- **Trident** (threecard, attack) — *Three cards: play or fold.* You see your three cards. PLAY (doubling the stake) to go against the dealer's three, or FOLD and lose only the ante. A straight or better also pays an ante bonus whatever the dealer holds.
- **Let It Ride** (letitride, attack) — *Three bets riding — pull them back or let it ride.* Three cards and three bets. Before each of the two community cards is turned you may pull one bet back or LET IT RIDE. A pair of 10s or better pays on every bet still riding; anything less loses them.
- **Hold'em Duel** (holdem, versus) — *Hole cards, a flop, call or fold.* A Versus item for duels: two hole cards each, then the flop. CALL (2× the bet) to see the turn and river against your opponent's hand, or FOLD and lose only the ante. Best five-card hand wins the pot.
- **Bone Toss** (craps, attack) — *Come-out roll, then make your point.* Tap ROLL. On the come-out, 7 or 11 wins, 2, 3 or 12 loses; any other total becomes your point. Keep rolling: make the point again before a 7 to hit, roll a 7 first and the stake is gone.
- **Twin Ward** (paigow, spell) — *Split seven cards into a high hand and a low hand.* A healing spell. From seven cards tap two for the small hand (or tap House way), the rest make the big hand — the big hand must outrank the small. Win both against the dealer to heal (less the commission); win one and it pushes; lose both and the stake is burned.

## Consumables <a id="consumables"></a>

Nudge for dice and wheel items, Reroll for card items, Fork for any binary outcome, Potion heals 25, Smoke Bomb ends an encounter, Phoenix Feather cancels one KO. Consumables stack 5 to a cell. Shop prices: Potion 40, Nudge 30, Reroll 30, Fork 45, Smoke Bomb 60, Phoenix Feather 150 Gold; the Shop buys back at 50%.

## Inventory: the cage and the paper doll <a id="grid"></a>

Fifteen worn slots around the crest: main hand, off hand, two spells, helmet, torso, pants, gloves, boots, four rings and a necklace (a cape slot opens only for the Infernal Mantle). Everything else sits in a 8 × 6 grid at level 1: items have footprints (rings, necklaces and consumables 1×1; gloves and boots 2×1; helmet and pants 2×2; torso 2×3; one-hand weapons and spells 1×3; two-hand Legendaries 2×4; eggs 2×2), rotate with a tap, and must sit on free cells. +1 row at levels 5, 10, 15, 20; Satchels add a column each up to 10. Loot that does not fit stays on the hex for 1 round for anyone to take.

## Boots and movement <a id="boots"></a>

Your boots decide how you move. Barefoot you plod 2 hexes. Dice boots roll their die for movement points; Wheel boots spin the movement wheel; Card boots draw a colour card and move you to the nearest hex of that colour within 4 hexes (ties: you choose; a double takes you to the second-nearest; no match in range, step 1). Only a player wearing Card boots sees the secret hex colours, on their own phone. Swapping boots mid-turn costs the turn's move.

| Boots | Mode | Die | Stopping early | Rarity floor |
| --- | --- | --- | --- | --- |
| Cobbler's Slippers | Dice | d4 | Whenever you like | Common |
| Loaded Boots | Dice | d6 | Whenever you like | Common |
| Knucklebone Greaves | Dice | d8 | After half the roll | Rare |
| Decahedron Striders | Dice | d10 | After half the roll | Rare |
| Dodeca Sabatons | Dice | d12 | Never: walk it all | Epic |
| Fateful Treads | Dice | d20 | Never: walk it all | Epic |
| Croupier's Heels | Wheel | — | Whenever you like | Common |
| Breaking-Wheel Boots | Wheel | — | Whenever you like | Rare |
| Dyer's Boots | Card | — | Whenever you like | Common |
| Painted Soles | Card | — | Whenever you like | Rare |

Movement wheel: 1, 2, 3, 4, 5, 6, Sprint (8), Stumble (0), Teleport, Swap.

Legendary boots roll one unique: Choose your mode; Move twice; Skates of the Sixth; Octane Treads.

## What each hex does <a id="tiles"></a>

| Hex | What happens | Who acts on the phone |
| --- | --- | --- |
| Encounter | A monster from the region's table appears with its own Health and two moves. Fight it with your items; it drops Gold, an item or an egg when it dies. | Mover; allies on the tile may join |
| Wheel | Spin the Fortune Wheel for Health, Gold or an item. | Mover |
| Shop | Buy items, potions and trinkets with Gold; sell back at half price. | Mover |
| Inn | Safe tile: heal once per visit, buy potions, the Collector skips you this round. | Mover |
| Blood Bank | Take or repay a Blood Pact. | Mover |
| Graveyard | Dead players wake here after their missed turns; what they dropped stays where they fell. | Mover |
| Arena | Challenge a player to a Challenge Wheel fight or a pet battle with a Gold wager and a crowd bonus. | Mover, then the challenged player |
| Chaos | Spin the Chaos Wheel; tiers escalate as the run goes on. | Mover; a vote if the result asks for a victim |
| Chest | Spin the Loot Wheel for an item (rarity by region), Gold or an egg. | Mover |
| Event | Spin the Fate Wheel. | Mover |
| Boss Gate | Fight the region boss if level or key allows, else bounce back three tiles. | Mover; allies on the tile for raids |
| Portal | Pick a destination region and step through. | Mover |
| Bounty Board | Place or claim a bounty; take a public quest. | Mover |
| The Throne | The Dealer's chair. Sit on it once the Dealer is dead and the run is won. | Mover |
| Courier Post | The crow's roost. Letters in transit pass through here; whoever stands on it reads them first. | Mover |

Inn heal: 15, once per visit. Void hexes (Black Water, Chasm, Wall) are never entered.

## Regions <a id="map"></a>

| Region | Tier | Loot leans to | Modifier |
| --- | --- | --- | --- |
| Casino Strip | 1 | Picks | Where every run begins. The House is still friendly here. |
| The Docks | 2 | Dice | Blood Pacts are cheaper on the pier; the Blood Banks stand on stilts. |
| Blackwood | 2 | Cards | Twice the Chaos tiles; the Chaos tiles are hanging trees. |
| The Caldera | 3 | Nerve | Damage is doubled both ways in the forge-pit. |
| Sky Citadel | 3 | Wheels | Loot rolls one rarity higher; entry needs level 10 or a key. The throne is the Dealer's chair. |

## Health, death and Blood Pacts <a id="health"></a>

Health is what you stake, lose and deal. It starts from the Buy-in Wheel (80 to 150) or a flat 100, and comes back only through healing: potions, the Mend and Briefcase spells, the Inn. Your exact Health is hidden: the TV and other phones show only your third (over 66%, 33% to 66%, under 33%) through the lantern on your sprite.

Death: a fight with a monster is to the death. Dying to a monster drops everything in your grid plus 1 random worn item on the hex, you miss 1 turn and wake at the Graveyard at 50% Health. Dying to a player or a boss: the same drops, but the winner chooses which worn item to take, you miss 2 turns and lose 1 level. A Phoenix Feather used before the killing blow cancels death; in PvE and Teams a teammate can revive you early at the Graveyard with one.

Blood Pact: borrow up to 50 Health at the Blood Bank, repay with 25% interest within 4 of your turns or the Collector takes 10 Health a turn until it is settled. At most 2 pacts open at once.

Gold is never bet: it comes from loot, quests and KOs (50 per KO, paid by the bank) and is spent in the Shop. Free-for-all tiebreak score = Gold + 50 per kill + Health remaining.

## PvP: the Challenge Wheel <a id="challenge"></a>

Players never roll against each other; they play each other. Attacking a player in reach spins the Challenge Wheel, which lands on a competitive game the two must play, on the phones or at the table. The winner lands one hit worth their weapon (stake × multiplier, no roll; a flawless win is a crit); afterwards either player may simply move out of reach on their own turn. Time caps: hosted 2:00, external 5:00; if the timer runs out with no result both take 10. The same entry cannot come up twice in one fight once the list has 4 or more enabled entries. The table does not wait: the two players' clocks pause and their turns are held until the game reports or the GM presses Drop Back In.

| Call | What is staked | If the attacker wins | If the attacker loses | Target's say |
| --- | --- | --- | --- | --- |
| Duel | Health | One hit for the attacker's weapon | One hit for the defender's weapon | None; being in reach is enough |
| Wager | Gold, equal from both (attacker names it, up to the poorer player's Gold) | Takes the pot | Loses the pot | Must accept; a declined Wager costs nothing |
| Robbery | Gold, attacker names up to 25% of the target's Gold | Takes it | Pays the target the same amount and is Wanted for 3 turns | None; it is a robbery |

| In Person: entry | Where | Rules | Cap | Weight |
| --- | --- | --- | --- | --- |
| Clash (War) | Phones | One card each from a fresh deck, high card wins. Ties go to war: three down, one up. | 2:00 | 3 |
| Dice Duel | Phones | Roll and stack. Stop when you like; bust past the threshold and you lose. Highest total standing wins. | 2:00 | 3 |
| Shell Game | Phones | The defender hides the pea, the attacker picks a shell. Find it to win. | 2:00 | 2 |
| Hold'em Duel | Phones | Heads-up hold'em, one hand, all-in. Best five cards win. | 2:00 | 2 |
| Quick-Draw | Phones | Watch the TV. When it flashes, tap. First tap wins; tap early and you lose. | 2:00 | 3 |
| Speed Math | Phones | Five sums. First to five right wins; most right when the clock runs out. | 2:00 | 2 |
| Memory Match | Phones | Twelve cards, six pairs, taking turns. A match keeps your turn. Most pairs wins. | 2:00 | 2 |
| Trivia | Phones | Five questions from the GM's bank. Most right wins; the faster player breaks a tie. | 2:00 | 2 |
| Highest Card | Phones | One card each. Highest wins; ties redraw. | 2:00 | 3 |
| Rock-Paper-Scissors (best of 5) | Table / Discord | Best of five throws, on three. Tell the phones who won. | 5:00 | 3 |
| Arm Wrestle | Table / Discord | Elbows on the table, one pull. Back of the hand touches, you lose. | 5:00 | 2 |
| Thumb War | Table / Discord | One, two, three, four. Pin for a count of three. | 5:00 | 2 |
| Staring Contest | Table / Discord | No blinking, no talking, no faces. The table judges. | 5:00 | 2 |
| Paper-Ball Free Throws | Table / Discord | Three throws each into the bin from the agreed line. Most in wins; sudden death on a tie. | 5:00 | 2 |
| Cup Stack Race | Table / Discord | Stack and unstack the pyramid. First back to flat wins. | 5:00 | 2 |
| One-Minute Drawing | Table / Discord | The GM names a thing. One minute to draw it. The table votes the better one. | 5:00 | 1 |
| Liar's Dice | Table / Discord | Five dice each under the cup. Bid or call liar. First to lose all five dice loses. | 5:00 | 2 |

| Discord: entry | Where | Rules | Cap | Weight |
| --- | --- | --- | --- | --- |
| Clash (War) | Phones | One card each from a fresh deck, high card wins. Ties go to war: three down, one up. | 2:00 | 3 |
| Dice Duel | Phones | Roll and stack. Stop when you like; bust past the threshold and you lose. Highest total standing wins. | 2:00 | 3 |
| Shell Game | Phones | The defender hides the pea, the attacker picks a shell. Find it to win. | 2:00 | 2 |
| Hold'em Duel | Phones | Heads-up hold'em, one hand, all-in. Best five cards win. | 2:00 | 2 |
| Quick-Draw | Phones | Watch the stream. When the TV flashes, tap. First tap wins; tap early and you lose. | 2:00 | 3 |
| Speed Math | Phones | Five sums. First to five right wins; most right when the clock runs out. | 2:00 | 2 |
| Memory Match | Phones | Twelve cards, six pairs, taking turns. A match keeps your turn. Most pairs wins. | 2:00 | 2 |
| Trivia | Phones | Five questions from the GM's bank. Most right wins; the faster player breaks a tie. | 2:00 | 2 |
| Highest Card | Phones | One card each. Highest wins; ties redraw. | 2:00 | 3 |
| Typing Race | Phones | Type the sentence. First to finish with two mistakes or fewer wins. | 2:00 | 2 |
| Emoji Memory | Phones | A growing emoji sequence. Repeat it back each round. Longest run wins. | 2:00 | 2 |
| Chess, 3 minutes | Table / Discord | Open the link, challenge each other, 3+0. Loser or the draw reports. | 5:00 | 2 |
| Tetris 1v1 | Table / Discord | Make a private room on jstris, one game. Last one topped out wins. | 5:00 | 2 |
| skribbl.io 1v1 | Table / Discord | Private room, two rounds. Higher score wins. | 5:00 | 2 |
| GeoGuessr Duel | Table / Discord | One duel. Winner reports. | 5:00 | 1 |
| Any Installed 1v1 | Table / Discord | A 1v1 in whatever game you both have installed. Agree the game before the timer starts. | 5:00 | 1 |
| Trivia Bot Round | Table / Discord | One round of the server's trivia bot, just the two of you answering. Higher score wins. | 5:00 | 2 |
| Photo Hunt | Table / Discord | The GM names a household object. First to post a photo of theirs in the channel wins. | 5:00 | 2 |

| Quick: entry | Where | Rules | Cap | Weight |
| --- | --- | --- | --- | --- |
| Quick-Draw | Phones | Watch the TV. When it flashes, tap. First tap wins; tap early and you lose. | 2:00 | 3 |
| Highest Card | Phones | One card each. Highest wins; ties redraw. | 2:00 | 3 |
| Clash (War) | Phones | One card each from a fresh deck, high card wins. Ties go to war: three down, one up. | 2:00 | 3 |
| Dice Duel | Phones | Roll and stack. Stop when you like; bust past the threshold and you lose. Highest total standing wins. | 2:00 | 3 |
| Rock-Paper-Scissors (best of 3) | Table / Discord | Best of three throws, on three. Tell the phones who won. | 5:00 | 2 |

## Wheels <a id="wheels"></a>

You tap spin on your phone; the TV animates it. Buy-in sets starting Health, Fortune (Wheel hexes) gives Health, Gold or an item, Fate (Event hexes) is a windfall, teleport, swap, free item, lost turn or a bounty on you, Loot (Chest hexes) is weighted by region, Chaos escalates, Boss picks the boss's mood.

| Fortune wheel | Chance | What happens |
| --- | --- | --- |
| Second Wind | 30% | Heal 20. |
| Payday | 30% | 60 Gold from the house. |
| A Gift | 25% | An item rolled on the Loot Wheel's rarity. |
| Nothing But Vibes | 15% | The wheel owes you nothing. |

| Fate wheel | Chance | What happens |
| --- | --- | --- |
| Windfall | 18% | 80 Gold. |
| Trapdoor | 16% | Dropped onto a random hex in another region. The hex does not resolve. |
| Switcheroo | 16% | Swap places with a random living player (never an Enforcer). |
| Found Property | 16% | A free item at Loot Wheel rarity. |
| Blackout | 18% | Miss 1 turn. |
| Wanted | 16% | The house posts 50 on your head. |

| Loot wheel | Chance | What happens |
| --- | --- | --- |
| Item | 67% | An item; rarity from the four loot weights, shifted by Luck and region. |
| Gold | 25% | 40 plus 20 per region tier. |
| Egg | 8% | A pet egg of the region. |

| Chaos wheel | Chance | What happens |
| --- | --- | --- |
| The Collector | 12% | The hooded ledger-keeper takes 10 Health from the spinner. |
| Blood in the Water | 12% | Damage ×2 in the spinner's region for 3 rounds. |
| Marked Class | 10% | One class at the table takes ×2 for 2 rounds. |
| Shuffle the Cage | 10% | The spinner's grid is scrambled (inventory module). |
| Mercy | 9% | The wheel spares you. This time. |
| Scapegoat | 10% | The table votes a victim; the Collector visits them. |
| Tighten the Bars | 9% | The spinner's grid loses a row for 1 rounds (inventory module). |
| Sticky Fingers | 9% | A random grid cell of the spinner is stolen by the house (inventory module). |
| Escalation | 7% | Chaos rises a tier at once. |
| Scatter | 7% | Every living character is thrown to a random hex of their region. |
| Apocalypse | 5% | Everyone takes the Collector's cut, every region bleeds, and the tier is pinned at max. |

| Bugreward wheel | Chance | What happens |
| --- | --- | --- |
| A Rare Find | 25% | A Rare item rolled for your region, straight into the grid. |
| Epic Thanks | 20% | An Epic item rolled for your region, straight into the grid. |
| The House Owes You | 6% | A Legendary (an Epic if the run's Legendary has already dropped). |
| Hush Money | 15% | 150 Gold from the house. |
| Round of Potions | 12% | 3 Potions. |
| Patched Up | 10% | Full Health and +15 max Health for the run. |
| Sharper | 8% | +1 stat point to spend on Self. |
| Something Hatching | 4% | A pet egg of your region. |

Chaos tiers multiply damage ×1, ×1.25, ×1.5, ×2, ×3; the tier rises every 4 rounds up to tier 5.

## Named Legendaries <a id="legendaries"></a>

Legendaries are never rolled: each is a hand-written item with a unique sprite and a mechanic that winks at another game. They show up at most once per run, from bosses, Citadel chests and the deepest tier (3), and they are what people vault.

| Legendary | Slot | Nods to | What it does |
| --- | --- | --- | --- |
| Pedestal Blade | Weapon 1×3 | Zelda | Cannot be drawn under level 10. At full Health, reach 3 instead of 1. |
| Gravity Gauntlet | Gloves 2×1 | Half-Life | Once per run, pull any player within 3 hexes onto your hex. |
| Weighted Companion Pendant | Necklace 1×1 | Portal | When you would die, the pendant is destroyed instead and you stay at 1 Health. It never says goodbye. |
| Ember Flask | Consumable 1×1 | Dark Souls | Heals 30; refills to 3 charges at every Inn. Resting resets the region's monsters. |
| Big Fancy Gun | Weapon 2×4 | Doom | Stake 50; hits every player and monster on your hex and all six neighbours. |
| Green-Cap Toadstool | Consumable 1×1 | Mario | Eat it to bank an extra life: your next death costs no items and no turns. |
| Oversized Buster Cleaver | Weapon 2×4 | Final Fantasy VII | Stake 50, +50% damage, swings last in the turn because of the weight. |
| Pip-Buoy | Ring 1×1 | Fallout | Shows the exact Health of every player within 2 hexes, breaking the thirds tell. |
| Tamer's Snare | Consumable 1×1 | Pokemon | Throw at a monster under 25% Health to catch it as a pet instead of killing it. |
| The Shout | Spell 1×3 | Skyrim | Push every adjacent player and monster 2 hexes away; stake 20. |
| Blockbreaker Pick | Offhand 1×3 | Minecraft | Walk through one void hex per turn; it is dug and stays open for everyone. |
| Impostor's Visor | Helmet 2×2 | Among Us | Your letters cannot be intercepted, and for 2 turns the TV shows you as another player's sprite. |
| The Joker | Weapon 1×3 | Balatro | Jokers count wild in your Video Poker hand; a five-of-a-kind is a double crit. |
| Chicken Dinner Platter | Consumable 1×1 | PUBG | Only usable by the last player standing in Royale: heals to full and vaults an extra item. |
| Rail Lance | Weapon 1×3 | Killing Floor 2 | Lock on: name a target within 3 hexes; the next hit cannot miss (a loss becomes a push). Stake 35, one lock per fight. |
| Corvette Broadside | Weapon 2×4 | Elite Dangerous | Fires a line: every player and monster in 3 hexes straight ahead takes the hit. Stake 50; so heavy you move 1 hex less while it is wielded. |
| Octane Treads | Boots 2×1 | Rocket League | The movement wheel loses Stumble and gains two Boost 8 segments; ending your move next to a player bumps them 1 hex. |
| Amulet of Potency | Necklace 1×1 | Old School RuneScape | +6% damage on every hit and +1 to all four stats. The plainest Legendary and the one everyone wants. |
| Infernal Mantle | Cape 2×3 | Old School RuneScape | Never dropped: awarded for clearing the deepest tier without dying. +3 Grit, immune to the Caldera's damage doubling, and the sprite burns. |
| Deep-Sea Suit | Torso 2×3 | Animal Crossing: New Leaf | Water void hexes are passable for you; once per run you surface from one with a random Rare item. |
| Skates of the Sixth | Boots 2×1 | Pokemon X and Y | Roll 2d6, but you cannot stop early and you slide one extra hex in your last direction. |
| Spiny Blue Carapace | Consumable 2×2 | Mario Kart DS | Throw it: the player currently leading on score takes 30 wherever they are. Cannot be dodged; a Fork can split it. |
| Clay Ocarina | Spell 1×3 | Zelda | Three songs, each once per run: return to the last Inn you visited; skip the next Chaos turn; call a fainted pet back at 1 Power. |
| Fairy in a Jar | Consumable 1×1 | Zelda | Sits in the grid. When you would die the jar breaks and you stand back up at 50% on the spot, no turns missed, no drops. |
| Pool Ladder | Offhand 1×3 | The Sims | Place it on any hex to make it a pool; take the ladder away and whoever is in the pool cannot leave for 2 turns and loses 5 Health a turn. Put it back to let them out. |
| Camera Obscura | Offhand 1×3 | Fatal Frame | Three shots per run. A photo of a player reveals their exact Health and worn items to you; a photo of a revenant or wraith deals 15 and pins it for a turn. |
| Reset Cartridge | Consumable 1×1 | The Sims (resetsim) | Resets your character to a clean state: clears every curse, pool, Blood Pact interest and Chaos effect on you and stands you on the last safe hex you visited. Also a GM console command for a stuck player. |
| The Croupier's Coat | Torso 2×3 | The affix table's own example | Opponents must stake at least 20 against you. |

## Blockcraft armour sets <a id="sets"></a>

The one set line in the game: five four-piece sets (helmet, torso, pants, boots). Pieces drop singly from Chests; wearing all four gives the bonus.

| Set | Rarity | Per piece | Four-piece bonus | Flavour |
| --- | --- | --- | --- | --- |
| Hide | Common | Guard 5% all families | Movement +1 | Smells like the cow it came from. |
| Gilt | Rare | Guard 5% all families; +2 Luck; Loses a charge every fight and crumbles at 0 | Loot Wheel rolls one rarity higher | Beautiful, useless, gone by morning. |
| Iron | Rare | Guard 15% all families | Blood Pact interest halved | Does the job. |
| Gem | Epic | Guard 25% all families; +1 Grit | Immune to the first hit of every fight | The one everyone digs for. |
| Chainmail | Rare | Guard 10% | Nothing. The note is the bonus. | I didn't forget about you, but you're still terrible. |

## Pets <a id="pets"></a>

Every pet has 4 attacks, each a minigame roll with its own stake paid from the pet's Power (40 at hatch, +20 per stage, +10 at the start of every run). You carry up to 6 (Beastmaster 7). Every hatch is the Triple Pet Wheel: common, region and rare pools; keep one of the three. Pets fight first: your active pet takes the hits until it faints, and a fainted pet stays down for the run unless revived. Pets never die for good.

| Species | Element | Pool | Stages | Attacks |
| --- | --- | --- | --- | --- |
| Cinderfox | Oxblood | Common | Cinderfox → Pyrewolf → Ashen Kitsune | Nip (fifty, 8), Ember Pounce (dice, 10), Tail Flick (hilo, 8), Wildfire (crash, 14) |
| Brinepup | Violet | Common | Brinepup → Wharfseal → Drowned Leviathan | Splash (fifty, 8), Undertow (hilo, 10), Barnacle Bite (dice, 10), Riptide (underover7, 12) |
| Mossbun | Verdigris | Common | Mossbun → Thornhare → Elderstag | Thump (fifty, 8), Bramble (mines, 12), Nibble Heal (hilo, 8), Antler Charge (dice, 12) |
| Sparkrat | Brass | Common | Sparkrat → Voltrat → Neon Lynx | Static (fifty, 8), Short Circuit (coinstreak, 10), Arc (limbo, 12), Blackout (crash, 14) |
| Gloomcat | Soot | Region | Gloomcat → Shadeprowler → Umbral Tiger | Scratch (scratch, 8), Pounce (dice, 10), Night Claw (hilo, 10), Nine Lives (tower, 14) |
| Candleowl | Bone | Region | Candleowl → Vigil Owl → Seraph of Wax | Peck (fifty, 8), Hoot (hilo, 8), Wing Beat (bigwheel, 12), Snuff (colorwheel, 12) |
| Boulderox | Verdigris | Region | Boulderox → Granitebull → Quarry Titan | Shove (fifty, 10), Gore (dice, 12), Rockslide (plinko, 12), Stampede (chuckaluck, 15) |
| Gallowhawk | Brass | Region | Gallowhawk → Squallwing → Thunder Roc | Dive (fifty, 10), Talon (dice, 12), Squall (limbo, 12), Thunderhead (crash, 15) |
| Cindertoad | Oxblood | Region | Cindertoad → Magmander → Calderasaur | Tongue Lash (fifty, 10), Hot Spit (dice, 12), Slag Bath (hilo, 10), Eruption (sicbo, 15) |
| Voidling | Soot | Rare | Voidling → Riftstalker → Null Sovereign | Blink (thimbles, 10), Unmake (dice, 12), Hunger (mines, 14), Event Horizon (crash, 18) |
| Pyredrake | Oxblood | Rare | Pyredrake → Furnace Wyrm → Ash Sovereign | Bite (fifty, 10), Breath (dragontiger, 14), Tail Sweep (chuckaluck, 14), Immolate (crash, 18) |
| Gilded Goose | Bone | Rare | Gilded Goose → Tarnished Swan → Aurum Phoenix | Honk (fifty, 10), Golden Egg (scratch, 10), Wing Slap (bigwheel, 12), Jackpot Feather (slots, 15) |
| The Grazing Maw | Verdigris | Region | Grazing Sprout → Grazing Maw → Uddered Maw | Bait (thimbles, 10), Chomp (dice, 12), Milk of Grief (hilo, 10), Swallow Whole (crash, 16) |
| Mucklings | Soot | Common | Mucklings → Muckheap → The Great Heap | Pile On (chuckaluck, 10), Splat (plinko, 10), Gilt Heap (scratch, 8), Rainbow Heap (bigwheel, 12) |
| Notorious Moon | Soot | Rare | Notorious Moon → Gibbous Grin → Full Notoriety | Tide (hilo, 10), Eclipse (fifty, 12), Crater (plinko, 12), Lullaby (hilo, 10) |

## Letters, alliances and votes <a id="social"></a>

Letters work like post: as many as you like on your own turn, 1 while it is not, each delivered after 2 of the recipient's turns. A player standing on the courier hex, or wearing a Spyglass, reads a letter in transit first and may pass it, destroy it or (Trickster) forge the reply. Alliances are proposed and accepted by letter; allies are never hit by each other's Area items. The table may vote 1 time a night to send someone to the Graveyard.

## How a run ends <a id="end"></a>

Free-for-all ends when the throne is reached or one player is left; PvP when one player is left; PvE when the final boss dies or every player does; Teams when one team stands or the final boss dies. Then the recap, and the vault: survivors bank 3 items, the dead 1, and survivors may save their character as a veteran. A dead character's name goes on the Wall of Names forever. 3 difficulty tiers, each unlocked by clearing the one before; a season is 8 nights.
