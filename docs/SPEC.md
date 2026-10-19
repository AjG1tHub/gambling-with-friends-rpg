# GWF RPG Edition — Feature List & Gameplay Flow

Spec frozen 18 Oct 2026 · AJ (Mosaic Forge LLC). Source of truth for the build; edits go to the Claude doc first, then here.

## The concept

GWF RPG Edition is a grimdark-casino roguelite played in runs of one to two hours: every run rolls a fresh map, monsters and loot, each player makes a new character on their phone, and what survives the run (a few vaulted items, a veteran character, the pets you caught) is the progression between runs. The 36 minigames become attacks and spells: every weapon or spell is one minigame with its own Health stake, win and the target takes the damage, lose and the stake is gone. Monster fights are to the death and player fights are one hit a turn with a chance to run, Health is hidden and hard to heal, and the GM runs the night from the PC while playing from a phone like everyone else.

| Screen | Device | What it shows / does |
| --- | --- | --- |
| Shared screen (TV) | GM's PC browser, cast or cabled to the TV | Map, whose turn, wheels, minigame stage, standings ticker, shot clock, sound |
| Player phone (one per player) | Phone browser, joins by QR code or 4-letter room code, no install | Character sheet, roll and move, pick a path, bet and play minigames, inventory, pet, emotes |
| GM console | Second window on the PC (or a tablet) | Start/pause, force any event, grant/take Gold, undo, restore points, config, kick/reconnect |

Phones as controllers is the one change that forces a backend: a shared room that every device reads and writes in real time. Supabase (already connected to your Claude) covers it with one table set and realtime channels, and the site stays static on Netlify. Three rules carry over: one computer still runs the night, the app never moves money (the GM records each player's real buy-in in a ledger, nothing more), and the GM can override anything.

## What carries over, what changes, what is new

Most of the current build is logic that does not care where the button lives, so it moves across; the GM-presses-everything input model and the single-browser storage are what get replaced.

| Area | Status in RPG Edition | Notes |
| --- | --- | --- |
| Tile-based board | Kept, reskinned | Same tile engine; tiles get a region, a biome look and branching paths |
| 36 minigames | Kept as attacks and spells | Same rules and odds; the stake is Health and the payout is damage (or healing for spells); each game lives on an item |
| Wheels (Buy-in, Chaos, Pet) | Kept | Buy-in now sets starting Health; the Big Wheel becomes an item; spins tapped from the phone |
| GM controls, undo, restore points, config check | Kept | Same console, now also able to act on any phone (kick, reconnect, hand a turn back) |
| Randomness (Chaos, stakes, Collector) | Kept | Multipliers now scale damage; loans become Blood Pacts (borrowed Health) |
| Pets and Power Level | Kept, promoted | Pet becomes the character's companion slot; battles are fought from the phone |
| Hall of Fame, recap, saved players | Kept, moved to the backend | Survive a browser wipe; a character is the saved player |
| Game Lab | Kept | Also gets a phone mode so every item can be tested from a real phone |
| Gold as the thing you bet | Replaced by Health | Gold stays only as shop money from loot, quests and KOs (decision below) |
| Game tiles | Replaced by Encounters | A monster with its own Health and moves; you fight it with your items |
| GM presses every button | Replaced | Players act on their own phones; GM intervenes, not operates |
| Browser localStorage as the save | Replaced | Supabase room + character tables |
| Google Sheet config | Kept as import, no longer the live source | Config lives in the backend with a GM edit screen; a Sheet import button keeps your tabs usable |
| Characters, classes, Health, XP, levels | New | The RPG layer, defined below |
| Items as moves, rarity, loot | New | Weapons and spells carry the game; armor and jewelry carry randomly rolled affixes keyed to games |
| Regions, quests, bosses on the map | New | Gives the board a reason to be a map |
| Hidden information and secret votes | New | Only possible once each player has a private screen |
| Player-to-player trades, bounties, duels | New | Phone-to-phone offers, GM-visible |

## Feature list

Everything below is a proposal; numbers in brackets are defaults you can change in config.

### Characters

- A new character every run, made on the phone in under a minute: name, crest (emoji by default, uploaded image optional), class. A character that survives can be saved as a veteran and taken into harder dungeons later (see Runs, game modes and meta progression).
- Health is the one resource you stake. Max Health \[100 at level 1, +10 per level\]. Every attack and spell stakes Health; at 0 you are dead (see Health economy). There is no betting with coins. Your exact Health is hidden from the other players: the TV and their phones show only which third you are in (over 66%, 33 to 66%, under 33%) through a subtle tell on your avatar (posture, crest dimming, a blood mark), never a number or a bar.
- Six classes, each with a passive, an active on a cooldown counted in that player's own turns, and upgrades at levels 5, 10, 15 and 20. Full kits in the Classes table below.

  Whale, Pit Boss, Cutpurse, Enforcer, Beastmaster, Croupier.
- Four stats, each 1 to 10, raised by levelling: Luck (reroll odds, loot rarity), Nerve (shot clock bonus seconds, one free re-stake per night), Greed (damage multiplier on win streaks, but Blood Pact interest is higher), Grit (damage taken reduced 3% per point, cheaper revives).
- XP and levels: XP for taking a turn \[+5\], landing a hit \[+20\], a critical hit \[+50\], a KO \[+50\], a pet battle win \[+40\], a quest \[+100\], a boss \[+250\]. Level cap 20; every level gives one stat point and +10 max Health; levels 5, 10, 15, 20 unlock a stronger version of the class active. A new character starts at 1; a veteran keeps its level.
- Equipment: 15 worn slots. Weapon (main and off hand) and Spell x2 carry the games; Helmet, Torso, Pants, Gloves, Boots, four Rings and a Necklace carry randomly rolled affixes that help or protect against specific games (see Gear and item generation). Everything not worn, consumables included, sits in a tile grid where item size is the carry limit (see Inventory grid).
- Titles earned from achievements show under the name on the TV (Glass Cannon, Undying, Dragon Slayer).

### Classes

Each class pushes one way to win: outstake, outlast, outwit, outfight, outbreed or outdeal. Numbers are starting values for config.

| Class | Plays like | Passive | Active \[cooldown\] | Upgrades at 5 / 10 / 15 / 20 |
| --- | --- | --- | --- | --- |
| Whale | All-in gambler | Weapon stakes cost 25% less; hits deal 15% more | Double Down: the next hit deals double damage, win or lose the stake \[6\] | Crit multiplier +0.5 / Double Down also doubles a spell's healing / can use an item whose stake exceeds Health, dropping to 1 / Double Down cooldown 3 |
| Pit Boss | The house; outlasts everyone | Healing items restore 50% more; Blood Pacts cost 15%; takes 10% less from monsters | House Rules: cancel the next Chaos effect, or turn the next roll against you into a push \[5\] | Inn heals twice per visit / Shop prices 25% off / the Collector never visits / House Rules can void an enemy win once per fight |
| Cutpurse | Thief and spy | Fork and Nudge cost half; reads every letter that crosses their tile; one free Smoke Bomb per run | Sleight: swap tiles with any player, or steal the item in a random grid cell of a player in reach \[6\] | Forge replies to intercepted letters / steal a chosen cell / hidden on the TV map for 2 turns after a Smoke Bomb / Sleight cooldown 3 |
| Enforcer | PvP duelist | +25% damage against players; death penalty one turn shorter; cannot be swapped | Call Out: force a fight with any player within 3 tiles; they cannot Smoke Bomb out \[5\] | First hit of a fight +25% / a player kill heals 20 / Long Arm built in / Call Out reaches the whole region |
| Beastmaster | Trainer; pets carry the fight | Pets earn Power 2x; extra egg at run start; first pet faint per run is undone | Rally: heal the active pet to full mid-fight \[4\] | Carry 7 pets / pet attacks +15% / two pets fight before you do / Rally revives a fainted pet |
| Croupier | Odds-maker; spells and rerolls | Spells stake 50% less; one free Reroll per fight | Rig the Deck: pick the result of the next binary outcome (any 50/50, over/under, red/black) for anyone in the fight \[6\] | Cards family +15% / two spells per turn / Reroll works on an opponent's roll / Rig the Deck works on a wheel |

Starting weapon by class: Whale Wheel of Ruin, Pit Boss Ward, Cutpurse Shell Game, Enforcer Loaded Dice, Beastmaster Mend, Croupier Twin Fang, all Common, on top of the shared starter kit. Each class also starts with +1 in its stat: Whale and Croupier Nerve, Pit Boss and Enforcer Grit, Cutpurse and Beastmaster Luck.

### Map

- A hex-tile overworld rolled fresh for every run from five region templates: Casino Strip (start), The Docks, Blackwood, The Caldera, Sky Citadel (endgame, behind a Boss Gate). Each region is a cluster of hexes joined to its neighbours by a few bridge hexes; the clusters, bridges, tile types, monster placement and loot are randomized, and the GM picks only the mode and size.
- Each region has its own tile mix, monster table and one modifier: Docks Blood Pacts are cheaper, Blackwood has double Chaos tiles, Caldera damage is 2x both ways, Citadel loot rolls one rarity higher but entry needs level 10 or a key item.
- Movement: your boots decide how you move (see Boots and movement modes). Whatever the mode, you then step hex to hex choosing any of up to six directions each step, and you may stop early. Only the hex you end on resolves; hexes you pass through do not, except that a monster you walk into stops you and a gated bridge needs its level, item or toll. Void hexes (water, chasm, wall) are impassable, so routes still matter.
- Tile types: Encounter, Wheel, Shop, Inn, Blood Bank, Graveyard, Arena, Chaos, Chest, Event, Boss Gate, Portal, Bounty Board.
- Map size, monster count and loot scale automatically with player count and mode so a full map runs 1 to 2 hours; the GM can still force Short or Long.
- Fog of war optional: a region is revealed on the TV when the first player enters it.
- Every hex also has a secret colour, one of six \[Oxblood, Bone, Brass, Verdigris, Violet, Soot\], rolled with the map and never shown on the TV. Only a player wearing Card boots sees the colours, on their own phone. The colours are a hook for later mechanics (colour-keyed affixes, quests, Chaos effects), so the generator records them from day one. Portals jump between regions. Reach for attacks is counted in hexes: adjacent by default, two with Long Arm, a whole region for the Enforcer's final Call Out.

### Boots and movement modes

The Boots slot is the movement engine, not a stat stick: the pair you wear decides whether you roll, spin or draw each turn, and the phone's movement screen changes to match. Barefoot, you plod 2 hexes.

| Mode | Boots (examples) | How you move | What the phone shows | Affix ideas |
| --- | --- | --- | --- | --- |
| Dice | Cobbler's Slippers d4, Loaded Boots d6, Knucklebone Greaves d8, Decahedron Striders d10, Dodeca Sabatons d12, Fateful Treads d20 | Roll the boots' die for movement points and step that many. Bigger dice buy range with control: d4 and d6 may stop early at any point, d8 and d10 only after half the roll, d12 and d20 must walk the full roll | Dice, moves-left counter, the six-direction rosette | One die size up, two smaller dice instead of one, reroll a 1, keep the stop-early right on a big die, +1 in your own region |
| Wheel | Croupier's Heels, Breaking-Wheel Boots | Spin a movement wheel: 1 to 6 plus specials (Sprint 8, Stumble 0, Teleport to any Portal, Swap with the nearest player) | The wheel, then the rosette | Remove Stumble, add a second Sprint, nudge once per run |
| Card | Dyer's Boots, Painted Soles | Draw a colour card and move to the nearest hex of that colour within range \[4\]; ties, you choose; a double card takes you to the second-nearest; no match in range, step 1 hex | The hexes around you painted in their secret colours, the card drawn, the legal destinations lit | Peek the top card, draw two keep one, range 6, more doubles in the deck |

- Mode is decided by the boots on your feet at the start of your move; swapping boots mid-turn costs the turn's move.
- Legendary boots roll one unique: choose your mode each turn, or move twice.
- Other players see only the result on the TV: the roll, the wheel stop, or (for Card boots) simply where you ended up. The card and the colours stay on your phone.
- The movement wheel and the colour deck are seeded per run like everything else, so the GM can rig or replay them.

### Runs, game modes and meta progression

A run is one rolled map played to its end in 1 to 2 hours; the GM picks a mode when the room is created and everything else is random. Between runs, players keep a vault, veterans and pets.

| Mode | Who fights whom | The run ends when |
| --- | --- | --- |
| Free-for-all | Everyone: players, monsters and bosses | The throne is reached or one player is left standing |
| PvP only | Players only; no monsters, Encounter tiles become Arenas | One player is left standing |
| PvE only | Monsters and bosses only; players cannot hurt each other | The final boss dies, or every player does |
| Teams | Custom teams of any number and size set in the lobby; monsters on, PvP between teams only | One team is left standing, or the final boss dies |

- Roster: at the start of a run you pick a character you have played before or make a new one. A character that survived its last run returns as it left (level, stats, worn gear). One that died is gone: its name goes on the Wall of Names and can never be used again, alive or dead, though you may reuse its look and class under a new name and gamble a fresh stat line. Names are unique across the whole roster, so every name is always one of a kind.
- Vault: at the end of a run a survivor banks up to 3 items from their body or grid; a player who died banks 1. Vaulted items can be pulled into any later run during setup.
- Veterans: a surviving character on the roster keeps its level, stats and worn gear and is the way into harder dungeons: difficulty tiers \[3\] scale monsters, bosses and loot, and each tier unlocks by clearing the one before. A veteran cannot enter a tier below its level band, so new players are never fighting beside a level-20.
- Pets caught across runs are the long progression (see Pets): one or two per run at most, six to a full team.
- Hall of Fame tracks runs cleared, deepest tier, kills, pets caught and the longest-lived character. Metagame ledger, GM-only: one row per player per run with the real buy-in the GM typed in, the mode, the placing, the character played and what was vaulted, with totals per player across the season. It is a record, not a wallet: the app never holds or moves money, and the figure has no effect in-game.

### Attacks and spells (the 36 minigames)

- Every weapon or spell item is one of the 36 minigames with its current rules and odds. Using it: pick a target, set a Health stake, play the game on your phone; the TV shows the stage.
- Outcome: win, and the target loses stake x the game's payout as damage; lose, and you lose the stake; push, nothing. The game's top multiplier is a critical hit and plays the big-win sound.
- Every weapon and spell has its own fixed stake, like a mana cost, set by rarity \[Common 10, Rare 20, Epic 35, Legendary 50\] and lowered by affixes. You cannot use an item whose stake is more than your current Health. One attack and one spell per combat turn.
- Four kinds of item. Attack: one target on your tile or an adjacent one (Long Arm reaches two). Spell: on yourself or an ally, the payout becomes healing, shield points or a steal. Area: every player on the tile stakes at once in a 20-second window and the game resolves for all of them. Versus: both players stake, the loser takes the winner's stake as damage.
- Fights are turn-based. Against monsters: attacker plays an item, then the monster, back and forth until one side is at 0, and nobody walks away. Against players: one Challenge Wheel round per turn, the winner landing a single hit worth their weapon, after which either side may move out of reach (see PvP: the Challenge Wheel). Both stakes, the monster's Health and stats, and every roll result are on the TV for all to see; only player Health totals stay hidden behind the thirds tell. Hidden picks stay on the phone (Mines squares, Scratch panels, Shell choice, Ride the Bus calls) until the reveal.
- Rarity sets the stake and the damage bonus: Common 10, Rare 20 and +10%, Epic 35 and +25%, Legendary 50 and +50%. Items have charges \[5\] and come from chests, the Shop, bosses, kills and the vault.
- Monsters are rolled when the map is generated, with their own Health, stats and two or three items, all shown on the TV. They fight automatically by default; the GM can take over any monster for an encounter and pick its moves. Tuning target: one monster is a fair fight, three or four back to back drain a careful player, a boss needs real preparation (healing items, a pet team, the right gear). PvP is weighted by gear and stats, so the better build usually wins; Fork and Nudge work against monsters.
- Consumables: Nudge for dice and wheel items, Reroll for card items, Fork for any binary outcome, Potion heals 25, Smoke Bomb ends an encounter, Phoenix Feather cancels one KO.
- Side bets: players not in a fight can stake Health on who wins, paid at even money. Optional and off by default.

Every game has a governing stat and a lever: each point above 3 in that stat improves the odds in the way the table says, each point below 3 worsens them the same way, so the stat line you gambled for at creation decides which weapons you are good with. Picks and Wheels lean on Luck, Nerve games on Nerve, Cards on Greed, Dice on Grit. Weapons show their governing stat on the item card.

| Minigame | Item | Kind | How it plays as a move | Stat and lever |
| --- | --- | --- | --- | --- |
| 50/50 | Coin Blade | Attack | Call it; win deals 1x stake | Luck: win chance +2% a point |
| Big Wheel | Wheel of Ruin | Attack | Pick a segment; multipliers up to the wheel's top | Luck: a spin stopping one segment off yours slides onto it 8% a point |
| Roulette | Roulette Storm | Area | Everyone on the tile bets a number or colour | Luck: one extra covered number per 2 points |
| Crash | Fuse Bomb | Attack | Cash out before it blows; the multiplier is the damage | Nerve: the fuse burns 4% slower a point |
| Mines | Minefield | Attack | Each safe pick raises the hit; a mine loses the stake | Nerve: one fewer mine per 2 points |
| Blackjack | Ward | Spell | Beat the dealer to gain a shield worth the payout | Greed: blackjack pays +0.1x a point; double on any two cards at 6 |
| Baccarat | Twin Fang | Attack | Player, Banker or Tie | Greed: banker commission falls 1% a point; Tie pays more |
| Plinko | Rockslide | Attack | Drop a chip; the slot is the multiplier | Luck: pegs lean to the outer high slots 3% a point |
| Hi-Lo | Mend | Spell | Win to heal the payout | Grit: ties heal at 5; peek the next card's colour at 7 |
| Dice | Loaded Dice | Attack | Over, under or exact | Grit: the exact-call window widens by 1 per 3 points |
| Slots | Jackpot Cannon | Attack | Rare huge hit, usually small | Luck: wild symbols 5% more common a point |
| Keno | Star Shower | Attack | Pick numbers; more hits, more damage | Luck: one free extra pick per 2 points |
| Coin Streak | Chain Lightning | Attack | Keep calling; the streak multiplies the damage | Nerve: the first miss of a streak is forgiven at 6 |
| War | Clash | Versus | High card takes the other's stake | Grit: ties go to the higher Grit |
| Dragon Tiger | Dragon's Breath | Attack | Dragon, Tiger or Tie | Greed: Tie pays +1x a point above 3 |
| Red Dog | Hound Snap | Attack | Raise on the spread | Greed: raise multiplier +0.2 a point |
| Chuck-a-Luck | Triple Dice | Attack | Three dice, pick a number | Grit: a triple pays 10x instead of 3x at 6 |
| Sic Bo | Bone Cage | Attack | Totals, triples and combos | Grit: Small and Big lose less of their edge each point; triples no longer kill them at 7 |
| Under/Over 7 | Lucky Seven | Attack | Two dice against 7 | Grit: a 7 is a push instead of a loss at 5 |
| Wheel of Colours | Prism Spin | Attack | Pick a colour | Luck: one extra colour covered per 3 points |
| Scratch Card | Scratch Charm | Spell | Scratch for a heal, a shield or a free item | Luck: one free extra scratch per 2 points |
| Limbo | Limbo Rope | Attack | Name a multiplier before the roll | Nerve: the named multiplier is reached 3% more often a point |
| The Races | Stampede | Area | Everyone backs a runner; losers take damage | Luck: your runner starts one length ahead a point |
| Tower | Siege Tower | Attack | Climb; each floor raises the hit | Nerve: one extra safe tile per floor per 3 points |
| Chicken Cross | Road Run | Attack | Each lane crossed raises the hit | Nerve: traffic 5% slower a point |
| Pachinko | Pachinko Hail | Attack | Launch; the pocket is the multiplier | Luck: the centre pocket 4% wider a point |
| Deal or No Deal | The Briefcase | Spell | Take the deal for a sure heal or hold out | Greed: the banker's offers rise 5% a point |
| Dice Hi-Lo | Dice Duel | Versus | Alternate calls until someone busts | Grit: your bust threshold +1 per 3 points |
| Ride the Bus | The Bus | Attack | Four calls; cash out any time | Nerve: a wrong first call is free at 5 |
| Thimbles | Shell Game | Versus | One hides, one picks | Luck for the picker (+4% a point), Nerve for the hider (-4% a point) |
| Video Poker | Hand of Fate | Attack | Hold and draw; the hand rank is the multiplier | Greed: jacks-or-better pays 2x at 5; a second draw at 7 |
| Three Card Poker | Trident | Attack | Ante and play against the dealer | Greed: the ante bonus pays from one rank lower per 3 points |
| Let It Ride | Let It Ride | Attack | Pull back stake as the cards come | Greed: a pair pays from 9s at 5; pull back a third time at 7 |
| Casino Hold'em | Hold'em Duel | Versus | Heads-up hand | Greed: see one flop card before calling at 6 |
| Craps | Bone Toss | Attack | Pass line; the roll series is the hit | Grit: a come-out 12 is a push at 4; odds pay +5% a point |
| Pai Gow Poker | Twin Ward | Spell | Set two hands; win both for a double shield | Grit: commission falls 1% a point; copies go to you at 6 |

### Gear and item generation

The game you play is always the one on the weapon or spell you chose; everything else you wear changes your odds in that game, or your defence against it. Every item that drops is rolled, not picked from a list, so no two characters end up with the same build.

- Game families link gear to games. Each of the 36 belongs to one family, and affixes target either a family or one named game:
  - Dice: Loaded Dice, Triple Dice, Bone Cage, Lucky Seven, Bone Toss, Dice Duel.
  - Cards: Ward, Twin Fang, Mend, Clash, Dragon's Breath, Hound Snap, The Bus, Hand of Fate, Trident, Let It Ride, Hold'em Duel, Twin Ward.
  - Wheels: Wheel of Ruin, Roulette Storm, Prism Spin, Coin Blade.
  - Nerve (push your luck): Fuse Bomb, Minefield, Chain Lightning, Limbo Rope, Siege Tower, Road Run.
  - Picks: Rockslide, Jackpot Cannon, Star Shower, Scratch Charm, Stampede, Pachinko Hail, The Briefcase, Shell Game.
- Slot roles. Weapons and spells: the game plus an offensive affix. Helmet, Torso, Pants, Gloves: defensive affixes by family plus one slot-specific utility (Helmet Nerve seconds, Torso max Health, Pants stake cap, Gloves one free hidden-pick peek per night). Boots: the movement mode (Dice, Wheel or Card) plus one movement affix and one Guard affix. Rings: offensive and odds affixes keyed to one named game, so four rings let you specialise. Necklace: global and economy affixes (stake refund on a push, XP, loot rarity, Blood Pact interest).
- Generation: base item from the slot's list, rarity from the Loot Wheel, then affixes rolled from the pool for that slot. Common 1 affix, Rare 2, Epic 3, Legendary 4 plus a unique effect that never rolls randomly. Name = prefix + base + suffix (Weighted Iron Helm of the Dealer).
- Region bias: each region's drops lean to one family (Docks Dice, Blackwood Cards, Caldera Nerve, Citadel Wheels, Strip Picks), so where you farm shapes your build.
- Affix strength scales with the region's tier, never with level, so a new character can wear anything they find.
- Rolls are seeded, so a test can regenerate the same item and the GM can hand out a specific one by seed.

| Affix kind | Lives on | Example | Effect |
| --- | --- | --- | --- |
| Damage | Weapon, Ring | Cruel | +10 to +25% damage with this game or family |
| Odds | Weapon, Spell, Ring, Gloves | of the Dealer | One extra peek, reroll or safe pick per use in the named game |
| Stake | Pants, Necklace | Thrifty | Stakes of a family's items cost 10 to 30% less |
| Guard | Helmet, Torso, Pants, Gloves, Boots | Stone | Damage taken from a family reduced 10 to 30% |
| Ward | Torso, Necklace | Mirrored | A losing stake against a family refunds 25 to 50% |
| Tempo | Helmet, Ring | Quick | Class active cooldown shorter by 1 to 2 turns |
| Economy | Necklace, Boots | Greedy | +Gold from KOs, +XP, +1 loot rarity in a region |
| Unique (Legendary only) | Any | The Croupier's Coat | Opponents must stake at least 20 against you |

### Inventory grid

The inventory is a paper doll over a tile grid, worked by drag and drop on the phone. There is no item count limit: the limit is the grid, and how well you pack it.

- Paper doll: the character's crest in the middle with the 15 worn slots around it. Drag an item from the grid onto a slot to equip it; what was there drops back into the grid, and if it does not fit the swap is refused.
- Grid: \[8 columns x 6 rows at level 1\]. Every item has a footprint in cells and must sit entirely on free cells. Items rotate 90 degrees with a tap while lifted, so a 1x3 weapon can lie flat.
- Footprints: Rings, Necklace, consumables 1x1. Gloves, Boots 2x1. Helmet 2x2. Pants 2x2. Torso 2x3. One-hand weapons and spells 1x3. Two-hand weapons (Legendary only, take both hands) 2x4. Pet eggs 2x2.
- Consumables stack \[5 per cell\]; nothing else stacks.
- Growing the grid: +1 row at levels 5, 10, 15 and 20, and Satchel items (Rare drops) add a column each, max 10. Grid size is per character and persists.
- Full grid: loot you cannot fit stays on the tile for one round, shown on the TV, and anyone who lands there can take it. You can drop, sell at a Shop, or trade from the grid at any time.
- Phone controls: long-press lifts an item, it snaps to cells as you drag, a bad placement shakes red and snaps back. Tap an item for its affixes and a Sell / Drop / Trade sheet. An Auto-sort button packs the grid for players who do not want the puzzle.
- Worn items never take grid space; unequipping one needs room for its footprint, so a full grid can lock you into your current gear until you clear space.
- The GM console can open any player's inventory, add or remove items, and resize their grid.
- Chaos, Fate and Trickster effects can hit the grid: scramble it, shrink it by a row for a round, or steal the item in a random cell.

### Character sprites and the paper doll

The character is a pixel-art paper doll in the style of Reroll (reroll.co): a small, chunky, three-quarter-view figure with a big head, dark one-pixel outlines, soft two-step shading and an idle bob, and every piece of gear you equip is a layer drawn onto it. The sprite is the character: it stands on the SELF tab, in the fight panel on the TV, on the hex as a small token, and on the recap.

- Canvas: 64 x 96 px per frame, scaled with nearest-neighbour so it stays crisp at 2x on the phone and 3x on the TV; the hex token is the same sprite at 1x cropped to the head and shoulders.
- Layers, back to front: back-slung weapon, cape or coat tail, body, pants, boots, torso, gloves, head and face, hair, helmet, necklace, ring glints on the hands, main-hand weapon, off-hand weapon or spell focus, spell aura. Each worn item ships one layer sprite per pose; an empty slot shows the class's base clothing.
- Creation: pick a body (3 builds), skin, face (8), hair (12), then the class sets the base outfit and starting weapon. Thirty seconds on the phone.
- Animation on the cheap: body and weapons get hand-drawn frames (idle 4, attack 6, hit 2, death 6, hex step 4); armour layers are drawn once per pose and moved with the body by code (offsets per frame), so an armour piece costs a 5-pose sheet, not 22 frames.
- Rarity shows on the sprite: Common is plain, Rare adds a 1 px silver trim, Epic a gold trim and a 2-frame shimmer, Legendary its own unique sprite with a glow.
- Lantern tell: the lantern hangs from the sprite's belt, so the Health tell lives on the character itself.
- Pets stand beside the sprite at 48 x 48; a fainted pet lies down.
- Generated items are generated as layers: a pixel model is given the naked base body and asked for the character wearing the item, the item layer is extracted by diffing against the base, cleaned up in Aseprite, and saved with its slot and z-order. That one step is what makes hundreds of rolled items wearable.

### Character creation: gambling for your stats

Creation is its own 5 to 10 minute minigame before every run, played on each phone at once: you dress the sprite, then you gamble for your stat line. Nobody rolls 4d6; you pick a game and stake chips on it.

1. Look (1 to 2 minutes): name, crest, body, skin, face, hair, coat colour. The name must be unused by any character on the roster, living or dead; looks can repeat. The class sets the base outfit.
2. Class: pick one of the six; it fixes your starting weapon and gives +1 to its stat.
3. Stats (the gamble): Luck, Nerve, Greed and Grit each start at 3. You hold 10 Stat Chips. For each stat you choose any Common game (the starter kit's three plus a Buy-in Wheel spin), stake 1 to 5 chips, and play it right there on your phone with chips instead of Health. A win pays chips x the game's multiplier into that stat; a loss burns the chips. Stats cap at 8 at creation and never drop below 1.
4. Safe money: chips you never stake become +1 each to any stat when you lock in, so a player who hates the gamble lands on 22 points, a lucky one near 30, an unlucky one around 14. Greed raises creation payouts by 5% a point, so the second stat you gamble can be shaped by the first.
5. Blood option: once per creation you may stake max Health (10 Health = 1 chip, up to 30) for a last pull.
6. Lock in: the finished sprite and stat line show on the TV as a character card. Creation runs on its own clock \[10:00\]; anyone not locked at zero gets the safe allocation.

- Picking from the roster: a survivor keeps its stats and skips step 3. Starting over from a dead character copies its look and class, demands a new name (the old one is on the Wall), and gambles step 3 again. Either way the mirror is open.
- The mirror stays open all run: between your turns the SELF tab has a Mirror toggle that reopens the look editor (hair, face, coat colour, crest, never gear); the change appears on the TV at your next turn. It closes automatically when your clock starts.
- GM Spotlight: during creation the TV shows the lobby with each player's progress; the GM console can pin up to four players' creation games to the TV at once in a 2 x 2 grid, so the table can watch someone gamble their Grit on Crash. Spotlight also works mid-run for any fight.
- Everything here reuses the item engine in chip mode, so the first time the 36 games run from a phone is creation, not the first fight.

### Named Legendaries

Legendaries are never rolled: each is a hand-written item with a unique sprite and a mechanic that winks at another game. They show up at most once per run, from bosses, Citadel chests and the deepest tier, and they are what people vault. The references live in the name, the flavour line and the mechanic, with our own original pixel art and no copied designs, logos or character likenesses, so the homage stays on the right side of the line.

| Legendary | Slot | Nods to | What it does |
| --- | --- | --- | --- |
| Pedestal Blade | Weapon (Clash) | Zelda | Cannot be drawn under level 10. At full Health, reach 3 instead of 1 |
| Gravity Gauntlet | Gloves | Half-Life | Once per run, pull any player within 3 hexes onto your hex |
| Weighted Companion Pendant | Necklace | Portal | When you would die, the pendant is destroyed instead and you stay at 1 Health. It never says goodbye |
| Ember Flask | Consumable, 1 x 1 | Dark Souls | Heals 30; refills to 3 charges at every Inn. Resting resets the region's monsters |
| Big Fancy Gun | Area (Roulette Storm) | Doom | Stake 50; hits every player and monster on your hex and all six neighbours |
| Green-Cap Toadstool | Consumable | Mario | Eat it to bank an extra life: your next death costs no items and no turns |
| Oversized Buster Cleaver | Two-hand weapon, 2 x 4 | Final Fantasy VII | Stake 50, +50% damage, swings last in the turn because of the weight |
| Pip-Buoy | Ring | Fallout | Shows the exact Health of every player within 2 hexes, breaking the thirds tell |
| Tamer's Snare | Consumable | Pokemon | Throw at a monster under 25% Health to catch it as a pet instead of killing it |
| The Shout | Spell | Skyrim | Push every adjacent player and monster 2 hexes away; stake 20 |
| Blockbreaker Pick | Off-hand | Minecraft | Walk through one void hex per turn; it is dug and stays open for everyone |
| Impostor's Visor | Helmet | Among Us | Your letters cannot be intercepted, and for 2 turns the TV shows you as another player's sprite |
| The Joker | Weapon (Hand of Fate) | Balatro | Jokers count wild in your Video Poker hand; a five-of-a-kind is a double crit |
| Chicken Dinner Platter | Consumable | PUBG | Only usable by the last player standing in Royale: heals to full and vaults an extra item |
| Rail Lance | Weapon (Limbo Rope) | Killing Floor 2 | Lock on: name a target within 3 hexes; the next hit cannot miss (a loss becomes a push). Stake 35, one lock per fight |
| Corvette Broadside | Two-hand, 2 x 4 | Elite Dangerous | Fires a line: every player and monster in 3 hexes straight ahead takes the hit. Stake 50; so heavy you move 1 hex less while it is wielded |
| Octane Treads | Boots (Wheel mode) | Rocket League | The movement wheel loses Stumble and gains two Boost 8 segments; ending your move next to a player bumps them 1 hex |
| Amulet of Potency | Necklace | Old School RuneScape | +6% damage on every hit and +1 to all four stats. The plainest Legendary and the one everyone wants |
| Infernal Mantle | Cape (a 16th slot only this line opens) | Old School RuneScape | Never dropped: awarded for clearing the deepest tier without dying. +3 Grit, immune to the Caldera's damage doubling, and the sprite burns |
| Deep-Sea Suit | Torso | Animal Crossing: New Leaf | Water void hexes are passable for you; once per run you surface from one with a random Rare item |
| Skates of the Sixth | Boots (Dice mode) | Pokemon X and Y | Roll 2d6, but you cannot stop early and you slide one extra hex in your last direction |
| Spiny Blue Carapace | Consumable, 2 x 2 | Mario Kart DS | Throw it: the player currently leading on score takes 30 wherever they are. Cannot be dodged; a Fork can split it |
| Clay Ocarina | Spell (Scratch Charm) | Zelda | Three songs, each once per run: return to the last Inn you visited; skip the next Chaos turn; call a fainted pet back at 1 Power |
| Fairy in a Jar | Consumable, 1 x 1 | Zelda | Sits in the grid. When you would die the jar breaks and you stand back up at 50% on the spot, no turns missed, no drops |
| Pool Ladder | Off-hand tool | The Sims | Place it on any hex to make it a pool; take the ladder away and whoever is in the pool cannot leave for 2 turns and loses 5 Health a turn. Put it back to let them out |
| Camera Obscura | Off-hand | Fatal Frame | Three shots per run. A photo of a player reveals their exact Health and worn items to you; a photo of a revenant or wraith deals 15 and pins it for a turn |
| Reset Cartridge | Consumable, 1 x 1 | The Sims (resetsim) | Resets your character to a clean state: clears every curse, pool, Blood Pact interest and Chaos effect on you and stands you on the last safe hex you visited. Also a GM console command for a stuck player |

Reference monsters, pets and bosses, same rule: our own pixel art, the nod is in the behaviour and the name.

- The Grazing Maw (The Sims' cowplant): a pet species, Verdigris element, hatched only in Blackwood. Attacks Bait (Shell Game: hide the cake, bite the wrong guess), Chomp (Loaded Dice), Milk of Grief (Mend, heals its trainer), Swallow Whole (Crash: a long enough fuse eats the target's next turn). Its stage-3 evolution udders a potion once per run.
- Mucklings (The Binding of Isaac's poop and dips): a swarm pet species, Soot element, five little heaps that count as one pet and lose one body per faint instead of fainting outright. Attacks Pile On (Chuck-a-Luck: three dice, one per heap standing), Splat (Plinko), Gilt Heap (Scratch Charm: scratch for Gold), Rainbow Heap (Fate Wheel in miniature). Its stage-3 evolution is a single enormous heap with a face. Dungheap stays as a destructible blocker hex that drops Gold when broken.
- The Grey (XCOM: Enemy Within's Sectoid): a Citadel monster that mind-links with another monster on the map and shares its Health; on its turn it can take control of your active pet for one attack.
- Notorious Moon (Wizard101): a pet species, a moon with a face, Soot element; attacks Tide (Hi-Lo), Eclipse (50/50 that doubles), Crater (Plinko), Lullaby (Mend). Only hatches from an egg found in the Citadel.
- The Litter (Mewgenics): a Blackwood raid boss, five cats that must each be killed by a different game family, with an original circus-dirge track written for the fight. The actual Mewgenics music stays in Mewgenics; Suno gets a prompt for something in that mood.

Blockcraft armour (Minecraft): the one set line in the game, five four-piece sets (Helmet, Torso, Pants, Boots) drawn as our own blocky pixel plate. Pieces drop singly from Chests; wearing all four gives the set bonus. Each chainmail piece carries the same engraved note: "I didn't forget about you, but you're still terrible."

| Set | Rarity | Per piece | Four-piece bonus | Flavour |
| --- | --- | --- | --- | --- |
| Hide | Common | Guard 5% all families; dyeable, the sprite takes any colour you pick | Movement +1 | Smells like the cow it came from |
| Gilt | Rare | Guard 5%, +2 Luck, but the piece loses a charge every fight and crumbles at 0 | Loot Wheel rolls one rarity higher | Beautiful, useless, gone by morning |
| Iron | Rare | Guard 15% all families | Blood Pact interest halved | Does the job |
| Gem | Epic | Guard 25% all families, +1 Grit | Immune to the first hit of every fight | The one everyone digs for |
| Chainmail | Rare | Guard 10%; cannot be crafted, only found; every piece reads the note | Nothing. The note is the bonus | I didn't forget about you, but you're still terrible |

### Wheels and randomness

- Kept: Buy-in Wheel (now sets starting Health \[80 to 150\]), Chaos Wheel. The Pet Wheel becomes the Triple Pet Wheel (see Pets). The Big Wheel becomes the Wheel of Ruin item.
- New: Fortune Wheel (Wheel tiles: Health, Gold or an item), Fate Wheel (Event tiles: windfall, teleport, swap, free item, lose a turn, bounty on you), Loot Wheel (Chest tiles, weighted by region), Boss Wheel (which boss and its mood), Challenge Wheel (every PvP round, built from the GM's editable challenge list).
- The player taps spin on the phone; the GM can secretly fix the next result from the console.
- Chaos keeps its tiers; its multipliers now scale damage, and Chaos can target a region (double damage in the Docks for 3 rounds) or a class.

### RPG layer

- Quests: a deck of random quests plus GM-written ones. Public quests show on the TV; personal quests are secret on the phone. Examples: win three games in Blackwood, hold 2,000 Gold at the end of a round, beat a specific player in a duel, visit every region.
- Loot: chests drop Gold, items, equipment or pet eggs from region loot tables; Luck shifts the roll up a tier.
- Bosses: the five existing bosses live on Boss Gate tiles, fought with the pet and the class ability. The two raid bosses need two or more players on the tile and share the reward.
- Seasons: a season is a run of nights \[8\]. Level and quests reset at season end; pets, titles, equipment and Hall of Fame carry over.

### Health economy

- Health is what you stake, lose and deal. It starts from the Buy-in Wheel and comes back only through healing items: potions, the Mend and Briefcase spells, and a small Inn heal \[15, once per visit\]. It should trend down across a run; healing is scarce on purpose.
- Death: every fight is to the death. Dying to a monster is the minor penalty: you drop everything in your grid plus one random worn item on the tile, miss one turn, and wake at the Graveyard at 50% Health. Dying to a player or a boss is the major one: the same drops, but in PvP the winner chooses which worn item to take, and you miss two turns and lose a level. A Phoenix Feather used before the killing blow cancels death. In PvE-only and Teams modes a teammate can revive you early at the Graveyard with a Phoenix Feather.
- Blood Pact (replaces the loan): borrow up to 50 Health from the Blood Bank; repay with 25% interest within 4 of your turns or the Collector takes 10 Health a turn until it is settled. Max 2 pacts.
- Gold is never bet. It comes from loot, quests and KOs \[50 per KO, paid by the bank\] and is spent in the Shop on items, potions, trinkets and revives. Dropping Gold entirely and pricing the Shop in Health is the alternative (decision below).
- Bank tile: deposit Gold, safe from steals and Chaos; withdraw only at a Bank.
- Auction: sealed Gold bids from phones for a rare item, revealed on the TV.
- Trades: offer Gold, items or a pet to another player from the phone; they accept or decline; the GM sees every trade.
- Bounties: place Gold on a player at a Bounty Board; whoever KOs them collects.
- Stakes and Chaos multipliers apply to damage dealt and taken, not to Gold.

### Pets and Power Level

- Pets are a full side game in the style of a monster-taming RPG, not a bonus: every pet has four attacks, each a minigame roll with its own stake paid from the pet's Power, plus an element, held item and two evolutions as built. Fourteen species: the twelve from the current build plus the Grazing Maw and the Mucklings (see Named Legendaries).
- A player carries up to six pets. Finding them is the long game: a run drops one or two at most (eggs from Chests, bosses, the Beastmaster bonus), so a full team takes several runs. Every hatch is the Triple Pet Wheel: three wheels spin at once on your phone and the TV, each stops on a species, and you keep one of the three. The left wheel is the common pool, the middle is weighted to the region you are in, and the right is the rare pool with blank segments (a dud egg) mixed in, so the choice is between a sure thing and a swing. The GM can rig any of the three from the console. Pets hatched at creation use the same three wheels.
- Pets fight first. In any fight your active pet takes the attacks until it faints; only then does your character take damage. Switching the active pet costs your move.
- A fainted pet stays down for the rest of the run unless revived, and revival is hard: a Rare Pet Revive item or a boss drop. Pets never die for good.
- Pet-versus-pet battles (Arena, Tamer duels) use the four attacks, both players locking a move before the reveal.
- Pet trading between players through the trade screen or by letter.

### PvP and social

- Attacking another player in reach spins the Challenge Wheel (below): one competitive game, one hit for the winner, then both are free to stay or run. The Health tells on the TV are how players size up a fight before starting one. The Arena tile adds a Gold wager and a crowd bonus.
- Secret votes from phones: Chaos picks a victim by vote, or the table votes once a night to send someone to the Graveyard.
- Emotes and taunts sent from the phone appear over the sender's avatar on the TV.
- Letters: hidden messaging that works like post, not chat. A player writes letters to other players from the phone: as many as they like during their own turn, only one while it is not their turn. Each is delivered after a delay \[2 of the recipient's turns\] and can be intercepted on the way: a player who lands on the courier tile shown on the TV, or who wears a Spyglass item, reads it first and may let it through, destroy it, or (Trickster) forge the reply. Alliances are proposed and accepted by letter, so the table never knows who is working together until it shows. Allies are never hit by each other's Area items.

### PvP: the Challenge Wheel

Players never roll against each other; they play each other. Attacking a player spins the Challenge Wheel, which lands on a competitive game the two must play, hosted by the system or run at the table or on Discord. The winner lands one hit worth their weapon, and that is the whole exchange for the turn: afterwards either player can walk away on their own turn, or press the fight again if they are still in reach. PvP is one hit per turn with a chance to run, never a forced fight to the death; only monsters fight to the end.

1. The attacker, on their turn and in reach, picks a weapon and a target; both phones buzz and the defender picks a weapon too.
2. The Challenge Wheel spins. The GM's secret screen already saw the result and can reroll it or force any entry before the TV animation plays; the animation always lands where the GM decided, seeded so it looks fair.
3. The game is played. Hosted entries run on the two phones with the stage on the TV. External entries show the rules card and a timer on both phones, and the TV shows an Off-Screen card instead: the Challenge Wheel logo, both sprites, the game's name and the timer, so the room knows a fight is happening somewhere else.
4. The winner is reported: hosted entries report themselves; external ones ask both phones "Who won?" and settle when the two answers agree, otherwise the GM decides from the console. If the timer runs out with no result, both take 10.
5. The winner's weapon hits once for its stake x multiplier, no roll; a flawless win is a crit. The loser's pet, if standing, takes it first. The exchange is over.
6. Running away: on their own next turn either player simply moves out of reach; nothing stops them and there is no free hit for leaving. Staying in reach invites another spin next turn. The Enforcer's Call Out is the one thing that prevents a Smoke Bomb exit.

Three ways to call a challenge, picked on the attack prompt. All three spin the same wheel and play the same game; only what is on the line changes.

| Call | What is staked | If the attacker wins | If the attacker loses | Target's say |
| --- | --- | --- | --- | --- |
| Duel | Health | One hit for the attacker's weapon | One hit for the defender's weapon | None; being in reach is enough |
| Wager | Gold, equal from both \[attacker names it, up to the poorer player's Gold\] | Takes the pot | Loses the pot | Must accept; a declined Wager costs nothing |
| Robbery | Gold, attacker names up to 25% of the target's Gold | Takes it | Pays the target the same amount and is Wanted for 3 turns: a bounty on them that anyone can claim with a Duel | None; it is a robbery |

Wagers are the friendly option for tables that do not want blood, and the GM can disable Duels per run to make a Gold-only night.

Challenge lists live in the GM console, not in code. The list editor is a table the GM can edit mid-run: name, hosted or external, link, rules text (shown on the phones), time cap, players (1v1 or team), weight on the wheel, enabled. Lists are saved as named presets, switched per run from the lobby, and exported or imported as JSON, so In Person and Discord can diverge and a Quick list can exist for late nights. Hosted entries come from the engine's Versus items and a few purpose-built duels; external entries are whatever the table agrees it can run.

| Preset | Hosted on the phones | Run at the table or on Discord |
| --- | --- | --- |
| In Person | Clash (War), Dice Duel, Shell Game, Hold'em Duel, Quick-Draw (reaction tap when the TV flashes), Speed Math, Memory Match, Trivia (5 questions from the GM's bank), Highest Card | Rock-paper-scissors best of 5, arm wrestle, thumb war, staring contest, paper-ball free throws (3 each), cup stack race, one-minute drawing judged by the table, dice-cup liar's dice |
| Discord | Same hosted set plus Typing Race and Emoji Memory | Chess 3-minute (lichess link), Tetris 1v1 (jstris link), skribbl.io 1v1, GeoGuessr duel, a 1v1 in whatever game both have installed, trivia bot round, first to post a photo of a named household object |
| Quick | Quick-Draw, Highest Card, Clash, Dice Duel only | Rock-paper-scissors best of 3 |

- The table does not wait. While two players play a challenge, the turn order carries on around them: their chess clocks pause and their turns are held. When the challenge ends (a hosted result, or the GM's Drop Back In button for an external one) both are returned to their own spots in the turn order; if a held turn was passed over while they were out, they take it as soon as the current turn ends. Players in a challenge cannot be attacked by a third party until they are back in.
- Each spin sets a time cap from the entry \[hosted 2:00, external 5:00\].
- The same entry cannot come up twice in one fight unless the list has fewer than four enabled entries.
- Team fights (Teams mode, raids) spin the same wheel; entries marked team are relay or best-of-three between the sides.
- Death penalties stand when a challenge hit kills: drops, the killer picks a worn item, the missed turns and the lost level.
- Monsters do not use the wheel; they fight with item rolls to the death as before.

### GM controls

- Everything the console does today: undo, restore points, grant and take Gold, force a tile or wheel result, pause, config check, recap, Hall of Fame.
- Player management: kick, reconnect, hand a dead phone's turn to the GM (proxy mode), put an absent player on autopilot with the existing bot.
- Broadcast a message to every phone, or a private message to one.
- Teleport a player, issue a quest, spawn a boss, start a Chaos tier by hand.
- Rig the next wheel or dice result without the players seeing; on the Challenge Wheel, see the result first and reroll or force it before the TV spins. Challenge list editor with saved presets (In Person, Discord, Quick) and JSON import and export. Drop Back In: one button that ends an off-screen challenge, takes the winner from the two phones' answers or the GM's pick, applies the hit, and puts both players back in their spots in the turn order.
- Config editor in the console, replacing the Sheet as the live source. The GM is usually a player too: the console is a second window on the PC and the GM's own character runs from their phone like everyone else's. Monsters run themselves; the GM steps in only to take over an encounter or fix something.

### Shared screen (TV)

- Map with avatars and pets, region names, revealed fog.
- Turn banner and the chess clocks (the mover's large, everyone's banked time small), standings ticker, event log, monster health bars during fights.
- Wheels and minigame stages exactly as today. Spotlight: the GM can pin up to four players' phone games (creation or fights) to a 2 x 2 grid on the TV. Off-Screen card: when a challenge is being played away from the system, the TV shows the Challenge Wheel logo with both sprites, the game's name and its timer in a corner while the map carries on.
- Join QR code and room code in a corner all night, so late arrivals and reconnects are one scan.

### Phone UI

- Tabs: Play (the current prompt, big buttons; shows who is up when it is not your turn), Cage (paper doll and grid), Self (stats, sprite and the Mirror toggle for look edits between turns), Pets, Map, Letters.
- Movement screen, shaped by your boots: Dice and Wheel boots show the roll or spin, then six hex-shaped direction buttons around a Stop Here button, each labelled with the tile that lies that way and greyed when void, with moves left counting down. Card boots show the hexes around you in their secret colours, the card drawn, and the legal destinations lit to tap. Tapping a hex on the mini-map paths there one step at a time, so a wrong tap costs one move, not the turn. The phone buzzes on your turn, on being challenged, and when a table bet window opens.
- Portrait only, dark theme, 60px tap targets, works on any phone browser, no install.
- Reconnect banner if the connection drops; the game never waits on a phone, the GM proxy covers it.
- Spectator mode: scan to watch and place side bets without a character.

### Persistence and config

- Backend tables: room, player session, roster (with the Wall of Names), character, pet, inventory, event ledger, challenge lists, metagame ledger, config, season, Hall of Fame. The event ledger no longer caps at 5,000 events.
- Export and import of the whole room as JSON stays.
- Classic mode: if the backend is down, the GM can run the current one-computer build unchanged.
- Config: GM edit screen with the existing config check; a one-click import from the GWF Config Sheet keeps your tabs useful.

## Gameplay flow

A run goes: lobby, a loop of turns until the mode's end condition, then the recap and the vault. Every prompt lands on one phone; the TV only ever shows results.

### Before the run

1. GM opens the console, picks a mode and difficulty tier, and starts a room; the map, monsters and loot are rolled. The TV shows the map, a QR code and a room code.
2. Each player scans and either picks a character from their roster or runs creation on their phone (see Character creation): dress the sprite, pick a class, gamble for the stat line; survivors come back as they were if the tier allows. Then pull up to 3 items from the vault, pick a pet team, and tap Ready. Everyone gets the Common starter kit \[Coin Blade, Loaded Dice, Mend, 2 Potions\]. The TV shows the lobby, and the GM can Spotlight up to four players' creation games. In Teams mode the GM sets the teams here.
3. Players with no pets hatch one on the Triple Pet Wheel: three wheels spin, pick one of the three. Everyone gets the session Power bonus.
4. GM enters each player's real buy-in for the night in the metagame ledger, spins the Buy-in Wheel for each player's starting Health or sets a flat start \[100\], then taps Start. Turn order is a shuffle shown on the TV.

### A turn

Your turn (phone buzzes) → roll, spin or draw as your boots decide → step hex to hex, up to your roll → resolve the tile → action phase (shop, bag or attack; optional) → end turn → next player. Chess clock: 1:30 added per turn, unused time banks to 5:00; at zero the turn ends.

Every step is a prompt on the mover's phone; the TV mirrors the dice, the move and the tile. Turns run on a chess clock: each player's clock gets 1:30 added at the start of their turn, unused time banks up to a cap \[5:00\], and when it hits zero the turn ends where it stands (a fight in progress passes the move). Fights count against the clock of whoever is to move.

### What each tile does

| Tile | What happens | Who acts on the phone |
| --- | --- | --- |
| Encounter | A monster from the region's table appears with its own Health and two moves. Fight it with your items; it hits back on its move. It drops Gold, an item or an egg when it dies; you can leave at end of turn. | Mover; allies on the tile may join |
| Wheel | Spin the Fortune Wheel for Health, Gold or an item | Mover |
| Shop | Buy items, potions and trinkets with Gold; sell back at half price | Mover |
| Inn | Safe tile: heal 15 once per visit, buy potions, Collector skips you this round | Mover |
| Blood Bank | Take or repay a Blood Pact | Mover |
| Graveyard | Dead players wake here after their missed turns; what they dropped stays where they fell | Mover |
| Arena | Challenge a player to a Challenge Wheel fight or a pet battle with a Gold wager and a crowd bonus | Mover, then the challenged player |
| Chaos | Spin the Chaos Wheel; tiers escalate as today | Mover; a vote if the result asks for a victim |
| Chest | Spin the Loot Wheel for an item (rarity by region), Gold or an egg | Mover |
| Event | Spin the Fate Wheel | Mover |
| Boss Gate | Fight the region boss if level or key allows, else bounce back three tiles | Mover; allies on the tile for raids |
| Portal | Pick a destination region | Mover |
| Bounty Board | Place or claim a bounty; take a public quest | Mover |

### Interrupts

- Chaos effects, the Collector on a due loan, and GM-forced events resolve at the start of the affected player's next turn, as today.
- A Challenge Wheel fight runs beside the turn order: the two players' clocks pause and their turns are held until the hosted game reports or the GM presses Drop Back In, then they rejoin at their own spots.
- Trade offers can be answered at any time and settle at the next end of turn.
- A phone that drops for 30 seconds hands its prompts to the GM console; the player picks the turn back up on reconnect.
- GM pause freezes every phone and every clock.

### End of the run

- Ends on the mode's condition (throne, last one standing, final boss, last team) or when the GM calls it.
- Winner: whoever meets the condition; among survivors in Free-for-all, score = Gold + 50 per kill + Health remaining.
- The recap shows the same charts as today plus damage dealt and taken, kills, bosses beaten and pets caught; Hall of Fame and titles update.
- Then the vault: survivors bank up to 3 items, the dead bank 1, and survivors may save their character as a veteran.

### Between runs

- Only the vault, veterans, the pet collection and the Hall of Fame persist. Everything else is rolled again.
- Clearing a tier unlocks the next; veterans are the way into it.

## Art direction: grimdark casino

The House is a dead god and every casino is its church. Keep the casino iconography (chips, cards, dice, wheels, neon) but make all of it old, cruel and holy: bone, oxblood, tarnished brass, candle smoke, and one sickly neon colour per region as the only bright thing in frame.

- Palette: black velvet, oxblood, tarnished gold, bone white, candle amber; one accent neon per region (Strip magenta, Docks absinthe green, Blackwood violet, Caldera ember orange, Citadel cold gold).
- World motifs: chips stamped with skulls, cards engraved on bone, dice cut from knucklebones, slot machines as reliquaries, the roulette wheel as a breaking wheel, the Collector as a hooded ledger-keeper, the final boss a faceless Dealer on a throne that is a dealer's chair.
- Characters: Reroll-style pixel paper dolls, chunky and big-headed, in heavy coats and masks, every worn item visible on the sprite; the crest is a worn tarot card behind the sprite on the TV, branded with the class mark (a split coin, a ledger, a fox mask, a cracked knuckle, a leash, a dealer's visor). The painted grimdark look stays for backgrounds, monsters and key art; the pixel sprites sit on top of it like figures on a table.
- Monsters: croupier revenants, a literal card shark, slot golems, roulette wraiths, loan-shark eels in the Docks, hanged-dice gallows spirits in Blackwood, salamander dealers in the Caldera, gilded high-roller angels in the Citadel.
- Items: gambling tools made into weapons (a roulette knuckle-duster, a deck sheathed in a gauntlet, a dice morningstar, a scratch-card razor); rarity shown by frame, tarnished brass to silver to gold to bone-white glow, never by a coloured name alone.
- Inventory: the grid is a casino cage, iron bars and brass trim; the paper doll is a body on a pawn-shop stand.
- Health tell: each avatar carries a lantern; full flame, guttering, almost out. Nothing else on screen gives Health away.
- Letters: wax-sealed envelopes carried by a crow across the map on the TV; an intercepted letter shows a broken seal.
- TV map: hand-inked parchment, fog as ink that has not dried, revealed regions bleeding into colour.
- Sound: brushed jazz and a dirge organ under it; wheel ratchets, bone dice, a cathedral bell on a kill.

| Region | Look | Signature set piece |
| --- | --- | --- |
| Casino Strip | Rain-slick street of shuttered parlours, one sign still lit | The first Encounter is a drunk croupier revenant under the sign |
| The Docks | Drowned pier, lantern fog, Blood Banks on stilts | The loan shark is a shark |
| Blackwood | Gallows forest with dice hanging from the ropes | Chaos tiles are hanging trees |
| The Caldera | Forge-pit casino, molten chips, salamander dealers | The Boss Gate is a furnace door |
| Sky Citadel | Gilded high-roller tower above the clouds, cold gold | The throne is the Dealer's chair |

## Asset list and generation plan

About 420 images, 9 music tracks and 40 sounds for the full game; the first test night needs the 140 marked P1. Everything is generated from one locked style sheet so the pieces match.

| Group | Assets | Count | Spec | Priority |
| --- | --- | --- | --- | --- |
| Hex tiles | Ground texture per region (5) + void per region (5) + 13 tile-type glyphs (Encounter, Wheel, Shop, Inn, Blood Bank, Graveyard, Arena, Chaos, Chest, Event, Boss Gate, Portal, Bounty Board) + bridge, gated bridge, throne, fog | 27 | Pointy-top hex, 512 px, PNG with alpha; glyphs are flat single-colour marks so they read at 26 px on the TV | P1 |
| Map dressing | Parchment frame, region name cartouches (5), courier tile marker, movement path brush, reach ring | 9 | 1024 px PNG | P1 |
| Class art | Base body (3 builds x 4 skins, 22 frames), faces (8), hair (12), class base outfits (6, 5-pose sheets), worn-item layers for every armour and weapon base (82, 5-pose sheets), 14 Legendary unique sprites, tarot crest per class (6), class active icon (6) | 19 | Sprites 64 x 96 px frames, nearest-neighbour scaled, slot and z-order in the manifest; crests 600 x 1000; icons 256 px | P1 one build, 4 faces, 6 hair, all outfits, half the layers; P2 rest |
| Lantern tell | Full flame, guttering, almost out, dead; 4-frame flicker each | 16 | 128 px sprite sheet | P1 |
| Monsters | 4 per region (20) + region boss (5) + raid bosses (2) + the Dealer | 28 | 1024 px portrait with alpha, plus a 256 px head token for the hex | P1 two per region and one boss; rest P2 |
| Weapons and spells | One icon per minigame item (36), two-hand Legendary variants (6) | 42 | 256 px icon, 1 x 3 footprint art for the grid | P1 |
| Armour and jewelry | Helmets (5 bases), torsos (5), pants (4), gloves (4), boots (3 modes x 3 bases = 9), rings (8), necklaces (5) | 40 | 256 px, drawn on the grid footprint (2x2, 2x3, 2x1, 1x1) | P1 half, P2 rest |
| Consumables and specials | Nudge, Reroll, Fork, Potion (3 sizes), Smoke Bomb, Phoenix Feather, Pet Revive, Satchel, Spyglass, egg (generic) | 12 | 128 px | P1 |
| Rarity frames | Common brass, Rare silver, Epic gold, Legendary bone-glow; each for 1x1, 2x1, 1x3, 2x2, 2x3, 2x4 | 24 | 9-slice PNG | P1 |
| Pets | 14 species x 3 stages (42) + 14 eggs + 4 attack-type icons | 52 | 512 px with alpha; stage 1 cute-grim, stage 3 monstrous | P1 four species; rest P2 |
| Wheels | Buy-in, Chaos, the three Pet wheels (common, region, rare), Fortune, Fate, Loot, Boss, Movement, Challenge; one pointer; one hub | 10 | 1024 px wheel face, segments as a separate layer so config can relabel them | P1 Buy-in, Chaos, Loot, Movement |
| Colour cards | 6 colours, 6 doubles, card back | 13 | 600 x 1000 | P1 |
| Dice | d4, d6, d8, d10, d12, d20 face sets | 18 | 256 px, or one 3D model if we roll in 3D | P1 d6 |
| Letters | Sealed envelope, broken seal, crow (3-frame flap), wax seal per class (6) | 11 | 256 px | P2 |
| Phone UI | Hex direction button (3 states), Stop Here hub, cage grid cell, paper-doll stand, 15 empty-slot silhouettes, tab icons (6), buttons (3 states), panel frames (3) | 36 | SVG where possible | P1 |
| TV UI | Header bar, panel frames, chess-clock face, fight panel, standings ticker, Chaos tier banners (4), recap frames | 14 | 1920 px layers | P1 |
| Minigame stages | Background per game family (5) reskinning the 36 existing stages; card back and chip set | 8 | 1920 x 1080 | P1 |
| Titles and badges | Achievement badges | 20 | 128 px | P3 |
| Music | Lobby, one bed per region (5), fight, boss, recap | 9 | 2 to 3 minute loops, brushed jazz over dirge organ | P1 lobby, fight, one region |
| Sound | Hex step, dice, wheel ratchet, card draw, hit, crit, miss, death bell, lantern gutter, letter sent, letter intercepted, loot drop by rarity (4), chaos stinger, boss roar, UI taps (6), buzz, clock warning, plus 12 per-family game sounds | 40 | WAV 48 kHz | P1 half |

Fonts stay Cinzel and IM Fell English (Google Fonts, free for commercial use).

### Which model for what

| Job | Recommendation | Why | Fallback |
| --- | --- | --- | --- |
| Style sheet, key art, region backgrounds, monster and boss portraits | Midjourney V8.1 with style references | Strongest painterly grimdark and the best style-reference system; one moodboard keeps every portrait in the same hand. Not for sprites: general models drift off the pixel grid | FLUX.2 \[pro\] via fal.ai or Replicate |
| Character sprites, worn-item layers, pixel item icons, pets | PixelLab (API, 12 to 50 dollars a month) for characters, poses and animation; Retro Diffusion as an Aseprite extension (one-time 65 dollars, runs locally on the 4070) for the item batches | Both are built for pixel art and keep the grid and palette honest. PixelLab rigs a sprite as a skeleton, rotates it, takes per-project references and inpaints, which is how an item gets drawn onto the base body for the layer diff | FLUX.2 with a pixel-art LoRA, then downscale and palette-quantize in Aseprite; Sprixen for small consistent sprites |
| Icon sets that must match (items, tiles, badges, pets) | FLUX.2 with a style LoRA trained on 25 to 40 approved icons, run as a batch from a prompt template with fixed seeds | The only way to get 150 icons that look like one set; a LoRA costs a few dollars to train on fal.ai | Nano Banana Pro from a reference grid |
| Evolution lines and anything needing edits (pet stage 2 from stage 1, armour recolours, rarity variants) | Nano Banana 2 / Pro (Gemini image) or gpt-image-2 | Both keep a subject consistent through edits and follow instructions precisely | Midjourney character reference |
| Vector UI (tab icons, buttons, rosette, slot silhouettes, badges) | Recraft (vector output) or hand-drawn SVG | Real SVG scales to any phone and recolours in CSS; raster UI will not | Ideogram 4.0 for anything with lettering |
| Wheel faces and cards | Build in SVG from config, with generated textures behind them | Segments and labels change in config; baked text cannot | Ideogram 4.0 for a one-off |
| Cutouts and clean-up | BiRefNet or rembg locally, Real-ESRGAN for upscaling | Free, runs fine on the RTX 4070 | Photoshop |
| Music | Suno | Loops with a style prompt; iterate per region | Udio |
| Sound effects | ElevenLabs Sound Effects | Text to SFX with variations; good for the forty small sounds | Freesound (check licences) |

### Pipeline

1. Lock the style sheet: 12 Midjourney images (one monster, one item, one tile, one card, one crest, one region) that you approve, saved as the reference set.
2. Train one FLUX.2 LoRA on the approved icons, one on the approved portraits.
3. Generate by spreadsheet: a prompt template per asset group, one row per asset, fixed seed per row, so a regenerated asset lands in the same style. Keep the sheet in the repo as the asset manifest.
4. Post-process locally: cut out, trim, resize to spec, drop into the rarity frame, write to /assets with the manifest name.
5. Local option: the RTX 4070 (12 GB) runs FLUX.2 \[klein\] and SD 3.5 Medium in ComfyUI for free, slower batches; use it for iteration and the API for the final set.
6. Licensing: FLUX.2 \[klein\] and SD 3.5 are commercial-safe; FLUX.2 \[dev\] is non-commercial, so use \[pro\] or \[klein\] for anything shipped. Midjourney, Nano Banana, gpt-image-2, Suno and ElevenLabs are fine on paid plans.

## Decisions before development

These shape the architecture, so they come first; the gameplay numbers above can change any time in config.

- [ ] Backend: Supabase (connected, realtime, free tier is enough for a table of 8) or something else? Answer in brackets if blank: \[Supabase\]
- [ ] Same site or a new one? Fold the RPG edition into gambling-with-friends.netlify.app behind a mode switch, or start a second site and leave the classic build untouched? \[second site, shares the game code\]
- [ ] Keep classic one-computer mode alive as a fallback, or is RPG edition the only way to play from now on? \[keep it\] Pets fight first in every fight, including PvE, or only in PvP? \[every fight\]
- [ ] GM device: PC console on the TV machine, or do you want the GM to run it from a tablet or phone too? \[PC, tablet later\]
- [ ] Classes, stats, the five regions, the 36 item names and the affix kinds above: keep, rename, or send your own list? Want set bonuses for wearing matching pieces? \[no sets for now\] Grid 8x6 at level 1, consumables stack to 5? \[as listed; rotation is allowed\] Hex movement: may you stop early, and do pass-through hexes stay silent? \[yes; silent except monsters and gates\] Card boots: range 4, six colours, barefoot plods 2? \[as listed\]
- [ ] Which items are in the starter kit and the Common loot pool for the first night? The slow table games (Pai Gow, Let It Ride, Casino Hold'em) can be Epic and rare.
- [ ] Health numbers: max 100 at level 1 and +10 per level, weapon stakes 10/20/35/50 by rarity, Inn heal 15, death penalties as listed? \[as listed\]
- [ ] Does Gold survive as shop money, or is Health the only currency, with the Shop and auctions priced in Health? \[Gold stays, never bet\]
- [ ] Sprites: 64 x 96 frame, 3 builds, armour as one sprite per pose moved by code? Which Legendaries make the first cut? Creation: stats start at 3, 10 chips, cap 8, 10-minute clock, Blood option on? \[as listed\] Challenge Wheel: one round per turn, winner hits for weapon stake x multiplier with no roll, external time cap 5:00, draw costs both 10, no free hit on a player who runs? \[as listed\] Roster: dead names retired forever on the Wall of Names, looks reusable? \[as listed\] Does the real-money buy-in change anything in-game, or is it ledger only? \[ledger only\]
- [ ] Difficulty tiers: how many and what unlocks them? Vault 3 items for survivors, 1 for the dead? \[3 tiers, each unlocked by clearing the last; vault as listed\]
- [ ] Letters: 2-turn delay, intercepted by landing on the courier tile or wearing a Spyglass? Chess clock banks unused time up to 5:00, or resets to 1:30 each turn? \[as listed; banked\]
- [ ] Should the old GWF Config Sheet stay in the loop at all, or is a GM config screen plus JSON export enough? \[import only\]

## Suggested build order

Each phase ends with something you can play-test from a real phone, so the risky part (phones and the backend) is proven before any RPG content is written.

| Phase | Builds | Done when |
| --- | --- | --- |
| 0. Backend and join | Supabase schema, room create/join, QR on the TV, phone lobby, reconnect, GM proxy | 4 phones join a room, drop and rejoin, GM can kick |
| 1. Phone turn loop | Hex grid engine (neighbours, reach, pathing, secret colours), the three movement modes driven by boots, step-by-step movement with the rosette, chess clock on the phone; TV mirrors results only | A hand-made hex map crossed from phones only |
| 2. Items engine | The 36 games wrapped as items: Health staking, damage and healing payouts, Attack/Spell/Area/Versus modes, hidden picks, rarity caps, monsters fighting back | Every item usable from a phone against a dummy monster in the Game Lab's phone mode |
| 3. Encounters, wheels, Chaos, Blood Pacts, Graveyard, Shop | Existing systems re-pointed at Health; monster tables per region; sealed-bid auction; Challenge Wheel with the hosted duels, external-entry flow and the GM list editor | A whole night played with phones; this is the first real test night |
| 4. Characters and RPG layer | Classes, stats, XP, levels, 15 equipment slots, the item generator and affix pool, the drag-and-drop grid inventory, the layered sprite renderer, the creation minigame (look editor, stat gamble in chip mode, Mirror, GM Spotlight), Named Legendaries, pets fighting first, titles | Characters persist across two nights |
| 5. Overworld | Map generator from region templates, monster generator, the four modes, auto-scaling, Fortune, Fate and Loot wheels, quests, bosses, Portals | A Regular map played start to throne |
| 6. Social | Letters with delay and interception, alliances, trades, bounties, secret votes, emotes, spectators, side bets | Second test night |
| 7. Polish | GM config screen, Sheet import, sound mix, recap additions, Hall of Fame migration, classic mode switch, vault, veterans, difficulty tiers, art pass | Deploy |

Phases 0 to 3 reuse almost all of the current code and give you phones-as-controllers for the game you already have. Phases 4 to 6 are the new design and can be reordered or trimmed after the first test night.
