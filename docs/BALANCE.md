# Balance

Generated from `data/balance.json` by `tools/build-balance-doc.mjs`; do not edit by hand. 326 tunables in 28 groups.

## Changing a value

- **For one room, from the GM console:** open the config screen (GM › Config). Every number below is listed under its group with the same key. Edit the field and press Apply; the console appends a `CONFIG_SET` event and every phone and the TV pick the new value up at once. The change lives in `state.balance` and is saved with the room, so a restore point or a reconnect keeps it. Reset a field to go back to the default.
- **For every room, permanently:** edit `data/balance.json` (`v` is the value; keep `unit`, `spec` and `note` honest), run `npm run gen` so this document follows, and commit both. Code never carries these numbers: handlers read them through `ctx.B('group').key` or `bal(state, 'group.key')`, and `test/unit/balance-literals.test.mjs` fails when a tunable's value is typed into a handler.
- **Validation:** the config screen refuses a value of the wrong type (`checkOverrides` in `packages/shared/balance.js`) and shows the spec section each number comes from, so you can read the rule before you bend it.
- **What moving it does** below is the intent of the number; the bot suite (`npm run test:bots`) is the quickest way to see what a change does to run length and death rate before a real night.

## table

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `table.maxPlayers` | 8 | players | Decisions | Room cap. Map, monsters and loot are tuned for 4 to 6. |
| `table.tunedMin` | 4 | players | Decisions | Lower end of the player count the auto-scaling targets. |
| `table.tunedMax` | 6 | players | Decisions | Upper end of the player count the auto-scaling targets. |
| `table.targetRunMinutes` | 90 | minutes | Runs | Auto-scaling aims a full map at this length; Short is ~60, Long ~120. |
| `table.proxyAfterSeconds` | 30 | seconds | Interrupts | A phone silent this long hands its prompts to the GM console. |
| `table.lastCallMinutes` | 100 | minutes | Runs | Last Call: a run still going this long after RUN_START ends on placings (score, then kills). 0 turns it off. |

## health

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `health.maxAtLevel1` | 100 | Health | Characters | Max Health of a fresh character. |
| `health.maxPerLevel` | 10 | Health | Characters | Max Health added per level. |
| `health.flatStart` | 100 | Health | Before the run | Starting Health when the GM skips the Buy-in Wheel. |
| `health.buyinMin` | 80 | Health | Wheels | Lowest Buy-in Wheel segment. |
| `health.buyinMax` | 150 | Health | Wheels | Highest Buy-in Wheel segment. |
| `health.innHeal` | 15 | Health | Health economy | Inn heal, once per visit. |
| `health.potionHeal` | 25 | Health | Consumables | A Potion heals this much. |
| `health.tellHigh` | 0.66 | fraction | Characters | Above this fraction of max the lantern burns full. |
| `health.tellLow` | 0.33 | fraction | Characters | Below this fraction the lantern is almost out. |
| `health.gritReducePerPoint` | 0.03 | fraction | Stats | Damage taken reduced per Grit point. |
| `health.greedStreakBonus` | 0.05 | fraction | Stats | Damage multiplier added per Greed point while on a win streak. |
| `health.nerveClockSeconds` | 5 | seconds | Stats | Shot clock seconds added per Nerve point above 3. |

## death

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `death.monsterMissTurns` | 1 | turns | Health economy | Turns missed after dying to a monster. |
| `death.playerMissTurns` | 2 | turns | Health economy | Turns missed after dying to a player or boss. |
| `death.wakeFraction` | 0.5 | fraction | Health economy | Health on waking at the Graveyard. |
| `death.playerKillLevelLoss` | 1 | levels | Health economy | Levels lost when killed by a player or boss. |
| `death.wornDropsOnMonsterDeath` | 1 | items | Health economy | Random worn items dropped on a monster death (plus the whole grid). |
| `death.tileLootRounds` | 1 | rounds | Inventory grid | Loot left on a tile stays this many rounds before it is swept. |

## bloodPact

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `bloodPact.max` | 50 | Health | Health economy | Largest single Blood Pact. |
| `bloodPact.interest` | 0.25 | fraction | Health economy | Interest due on repayment. |
| `bloodPact.dueTurns` | 4 | own turns | Health economy | Turns before the Collector comes. |
| `bloodPact.collectorPerTurn` | 10 | Health | Health economy | What the Collector takes each turn a pact is overdue. |
| `bloodPact.maxPacts` | 2 | pacts | Health economy | Open pacts at once. |
| `bloodPact.greedInterestPerPoint` | 0.02 | fraction | Stats | Extra interest per Greed point above 3. |
| `bloodPact.docksDiscount` | 0.25 | fraction | Map | Interest reduction in The Docks. |
| `bloodPact.ironSetFraction` | 0.5 | fraction | Blockcraft | Interest multiplier with the Iron four-piece bonus (halved). |
| `bloodPact.collectorFloor` | 1 | Health | Health economy | The Collector never takes a character below this Health. |

## gold

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `gold.perKO` | 50 | Gold | Health economy | Gold paid by the bank for a KO. |
| `gold.scorePerKill` | 50 | score | End of the run | Score per kill in the Free-for-all tiebreak. |
| `gold.startingGold` | 0 | Gold | Health economy | Gold a fresh character starts with. |
| `gold.shopSellFraction` | 0.5 | fraction | Tiles | The Shop buys back at this fraction of price. |
| `gold.robberyMaxFraction` | 0.25 | fraction | Challenge Wheel | A Robbery may name up to this share of the target's Gold. |
| `gold.wantedTurns` | 3 | turns | Challenge Wheel | How long a failed robber is Wanted. |
| `gold.arenaCrowdBonus` | 25 | Gold | Tiles | Crowd bonus paid to the Arena winner. |
| `gold.chestGold` | 40 | Gold | RPG layer | Gold from a Chest when the Loot Wheel lands on Gold, at region tier 1. |
| `gold.chestGoldPerTier` | 20 | Gold | RPG layer | Extra Chest Gold per region tier above 1. |
| `gold.bountyMin` | 25 | Gold | Health economy | Smallest bounty a player may post at a Bounty Board. |

## xp

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `xp.turn` | 5 | XP | Characters | XP for taking a turn. |
| `xp.hit` | 20 | XP | Characters | XP for landing a hit. |
| `xp.crit` | 50 | XP | Characters | XP for a critical hit. |
| `xp.ko` | 50 | XP | Characters | XP for a KO. |
| `xp.petWin` | 40 | XP | Characters | XP for a pet battle win. |
| `xp.quest` | 100 | XP | Characters | XP for a quest. |
| `xp.boss` | 250 | XP | Characters | XP for a boss. |
| `xp.levelCap` | 20 | levels | Characters | Highest level. |
| `xp.perLevelBase` | 100 | XP | Characters | XP needed from level 1 to 2; each level needs this much more than the last. |
| `xp.statPointsPerLevel` | 1 | points | Characters | Stat points per level. |
| `xp.upgradeLevels` | [5, 10, 15, 20] | levels | Classes | Levels that unlock a stronger class active. |
| `xp.titleDamage` | 500 | Health | Characters | Damage dealt for Glass Cannon and taken for Punching Bag. |
| `xp.titleKills` | 3 | kills | Characters | Kills for the Headhunter title. |
| `xp.titleBosses` | 1 | bosses | Characters | Bosses beaten for the Dragon Slayer title. |
| `xp.titleTurns` | 20 | turns | Characters | Turns survived without dying for the Undying title. |
| `xp.titlePets` | 3 | pets | Characters | Pets caught for the Tamer title. |
| `xp.titleGold` | 1000 | Gold | Characters | Gold earned for the Tycoon title. |
| `xp.titleCrits` | 3 | crits | Characters | Critical hits for the Sharpshooter title. |
| `xp.titleChallenges` | 3 | wins | Characters | Challenge Wheel wins for the Duelist title. |
| `xp.titleDeaths` | 2 | deaths | Characters | Deaths survived for the Lazarus title. |

## stats

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `stats.min` | 1 | points | Characters | Floor for any stat. |
| `stats.max` | 10 | points | Characters | Ceiling for any stat. |
| `stats.neutral` | 3 | points | Attacks and spells | Lever pivot: each point above improves the game's odds, each point below worsens them. |
| `stats.creationStart` | 3 | points | Creation | Every stat starts here at creation. |
| `stats.creationCap` | 8 | points | Creation | Highest a stat can reach at creation. |
| `stats.classBonus` | 1 | points | Classes | Bonus to the class's stat. |

## creation

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `creation.chips` | 10 | chips | Creation | Stat Chips to gamble. |
| `creation.minStake` | 1 | chips | Creation | Smallest chip stake per game. |
| `creation.maxStake` | 5 | chips | Creation | Largest chip stake per game. |
| `creation.clockSeconds` | 600 | seconds | Creation | Creation clock; unlocked players get the safe allocation at zero. |
| `creation.greedPayoutPerPoint` | 0.05 | fraction | Creation | Creation payouts rise this much per Greed point. |
| `creation.bloodHealthPerChip` | 10 | Health | Creation | Max Health staked per chip in the Blood option. |
| `creation.bloodMax` | 30 | Health | Creation | Most max Health the Blood option may stake. |
| `creation.safePointPerChip` | 1 | points | Creation | Unstaked chips become this many stat points each. |
| `creation.gambleGames` | [fifty, dice, hilo, buyin] | games | Creation | Games a stat may be gambled on: the starter kit's three plus a Buy-in Wheel spin. |

## clock

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `clock.perTurnSeconds` | 90 | seconds | A turn | Added to a player's clock at the start of their turn. |
| `clock.bankCapSeconds` | 300 | seconds | A turn | Unused time banks up to this. |
| `clock.warningSeconds` | 15 | seconds | A turn | The clock-warning sound plays with this much left. |
| `clock.timeoutSlackMs` | 250 | ms | A turn | A TURN_TIMEOUT appended this close to zero is accepted (covers clock skew between the TV and the backend). |

## items

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `items.stakeCommon` | 10 | Health | Attacks and spells | Stake of a Common weapon or spell. |
| `items.stakeRare` | 20 | Health | Attacks and spells | Stake of a Rare item. |
| `items.stakeEpic` | 35 | Health | Attacks and spells | Stake of an Epic item. |
| `items.stakeLegendary` | 50 | Health | Attacks and spells | Stake of a Legendary item. |
| `items.bonusRare` | 0.1 | fraction | Attacks and spells | Damage bonus of Rare items. |
| `items.bonusEpic` | 0.25 | fraction | Attacks and spells | Damage bonus of Epic items. |
| `items.bonusLegendary` | 0.5 | fraction | Attacks and spells | Damage bonus of Legendary items. |
| `items.charges` | 15 | charges | Attacks and spells | Charges on a dropped weapon or spell. Spec default 5; raised to 15 after bot runs (at 5, a Common weapon dies inside one monster fight and the table runs out of weapons). |
| `items.attacksPerTurn` | 1 | uses | Attacks and spells | Attacks per combat turn. |
| `items.spellsPerTurn` | 1 | uses | Attacks and spells | Spells per combat turn. |
| `items.areaWindowSeconds` | 20 | seconds | Attacks and spells | Bet window for Area items. |
| `items.reachDefault` | 1 | hexes | Map | Attack reach. |
| `items.reachLongArm` | 2 | hexes | Map | Reach with Long Arm. |
| `items.affixesCommon` | 1 | affixes | Gear | Affixes rolled on a Common. |
| `items.affixesRare` | 2 | affixes | Gear | Affixes on a Rare. |
| `items.affixesEpic` | 3 | affixes | Gear | Affixes on an Epic. |
| `items.affixesLegendary` | 4 | affixes | Gear | Affixes on a Legendary, plus its unique. |
| `items.legendaryPerRun` | 1 | items | Legendaries | Most Legendaries that drop in one run. |
| `items.starterPotions` | 2 | items | Before the run | Potions in the starter kit (with Coin Blade, Loaded Dice, Mend). |
| `items.critXpMultiplierThreshold` | 1 | fraction | Attacks and spells | A result at or above this fraction of the game's top multiplier is a crit. |
| `items.leverPenaltyPerPoint` | 0.05 | fraction | Attacks and spells | Threshold levers ("at 5", "at 6") have no graded downside, so below the neutral stat each point instead trims win payouts by this fraction. |
| `items.monsterStakeFraction` | 0.6 | fraction | Attacks and spells | Tuned 1.0 → 0.6 after bot runs. A monster stakes this fraction of its item's stake on its own moves (its Health is the stake pool). |
| `items.setDropChance` | 0.15 | fraction | Blockcraft | Chance an armour drop (helmet, torso, pants, boots) is a Blockcraft set piece instead of a rolled base. |

## affix

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `affix.damageMin` | 0.1 | fraction | Gear | Smallest Damage affix roll. |
| `affix.damageMax` | 0.25 | fraction | Gear | Largest Damage affix roll. |
| `affix.stakeMin` | 0.1 | fraction | Gear | Smallest Stake discount. |
| `affix.stakeMax` | 0.3 | fraction | Gear | Largest Stake discount. |
| `affix.guardMin` | 0.1 | fraction | Gear | Smallest Guard reduction. |
| `affix.guardMax` | 0.3 | fraction | Gear | Largest Guard reduction. |
| `affix.wardMin` | 0.25 | fraction | Gear | Smallest Ward refund. |
| `affix.wardMax` | 0.5 | fraction | Gear | Largest Ward refund. |
| `affix.tempoMin` | 1 | turns | Gear | Smallest Tempo cooldown cut. |
| `affix.tempoMax` | 2 | turns | Gear | Largest Tempo cooldown cut. |
| `affix.tierScale` | 0.25 | fraction | Gear | Affix strength rises this fraction per region tier above 1. |
| `affix.oddsUses` | 1 | uses | Gear | Extra peeks, rerolls or safe picks an Odds affix grants per use of the named game. |
| `affix.economyGold` | 0.25 | fraction | Gear | Extra Gold from KOs on a Greedy (Economy) affix. |
| `affix.economyXp` | 0.2 | fraction | Gear | Extra XP on a Studious (Economy) affix. |
| `affix.economyRarity` | 1 | rarity steps | Gear | Loot rarity shift in the named region on a Fortunate (Economy) affix. |
| `affix.helmetNerveSeconds` | 5 | seconds | Gear | Shot clock seconds on the Helmet utility affix. |
| `affix.torsoMaxHealth` | 10 | Health | Gear | Max Health on the Torso utility affix while worn. |
| `affix.pantsStakeCap` | 30 | Health | Gear | A losing stake costs at most this much Health with the Pants utility affix. |
| `affix.glovesPeeks` | 1 | peeks | Gear | Free hidden-pick peeks per night on the Gloves utility affix. |

## grid

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `grid.cols` | 8 | cells | Inventory grid | Grid columns at level 1. |
| `grid.rows` | 6 | cells | Inventory grid | Grid rows at level 1. |
| `grid.maxCols` | 10 | cells | Inventory grid | Columns cap with Satchels. |
| `grid.rowLevels` | [5, 10, 15, 20] | levels | Inventory grid | Levels that add a row. |
| `grid.stack` | 5 | items | Inventory grid | Consumables per cell. |
| `grid.vaultSurvivor` | 3 | items | Runs | Items a survivor vaults. |
| `grid.vaultDead` | 1 | items | Runs | Items the dead vault. |
| `grid.vaultPull` | 3 | items | Before the run | Items pulled from the vault at setup. |

## movement

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `movement.barefoot` | 2 | hexes | Boots | Steps without boots. |
| `movement.cardRange` | 4 | hexes | Boots | Card boots look this far for a colour. |
| `movement.cardRangeExtended` | 6 | hexes | Boots | Card range with the range6 boots affix. |
| `movement.cardNoMatchStep` | 1 | hexes | Boots | Steps when no hex of the colour is in range. |
| `movement.wheelSprint` | 8 | hexes | Boots | Movement wheel Sprint segment. |
| `movement.wheelStumble` | 0 | hexes | Boots | Movement wheel Stumble segment. |
| `movement.halfStopDice` | [8, 10] | die sizes | Boots | Dice that may stop only after half the roll. |
| `movement.fullWalkDice` | [12, 20] | die sizes | Boots | Dice that must walk the full roll. |
| `movement.colourDoubles` | 6 | cards | Boots | Double cards in the colour deck (one per colour). |
| `movement.bossGateBounce` | 3 | hexes | Tiles | Bounce back when the Boss Gate refuses you. |

## map

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `map.regionHexesShort` | 10 | hexes | Map | Hexes per region at Short size for the tuned table. |
| `map.regionHexesRegular` | 14 | hexes | Map | Hexes per region at Regular size. |
| `map.regionHexesLong` | 19 | hexes | Map | Hexes per region at Long size. |
| `map.hexesPerExtraPlayer` | 0 | hexes | Map | Spec 2; 0 after bot runs: every player gets fewer turns at a bigger table, so the map must not grow with them. Region hexes added per player above the tuned minimum. |
| `map.bridgesPerPair` | 2 | hexes | Map | Bridge hexes joining neighbouring regions. |
| `map.monstersPerRegion` | 2 | monsters | Map | Monsters rolled per region at the tuned table. Spec 3; 2 after bot runs (plus the boss) keeps a Regular map inside two hours. |
| `map.monstersPerExtraPlayer` | 0.5 | monsters | Map | Monsters added per player above the tuned minimum. |
| `map.chestsPerRegion` | 2 | chests | Map | Chest tiles per region. |
| `map.citadelLevel` | 10 | level | Map | Level needed to enter the Sky Citadel without a key. |
| `map.calderaDamageMult` | 2 | multiplier | Map | Damage multiplier both ways in The Caldera. |
| `map.blackwoodChaosMult` | 2 | multiplier | Map | Chaos tile density in Blackwood. |
| `map.citadelLootShift` | 1 | rarity steps | Map | Loot rarity shift in the Citadel. |
| `map.regionBiasWeight` | 3 | weight | Gear | Extra weight on a region's favoured family when rolling drops. |
| `map.fogOfWar` | 1 | on/off | Map | Reveal regions on the TV as players enter them. |
| `map.secretColours` | [Oxblood, Bone, Brass, Verdigris, Violet, Soot] | colours | Map | Secret hex colours. |

## monsters

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `monsters.healthCommon` | 40 | Health | Attacks and spells | Health of a standard region monster at tier 1. Spec 60; 40 after bot runs so a monster dies inside two or three turns of Common hits. |
| `monsters.healthBoss` | 100 | Health | RPG layer | Health of a region boss at tier 1. Spec 200; 140 after bot runs. |
| `monsters.healthRaid` | 180 | Health | RPG layer | Health of a raid boss at tier 1. Spec 320; 240 after bot runs. |
| `monsters.healthFinal` | 180 | Health | RPG layer | Health of the Dealer. Spec 400; 260 after bot runs. |
| `monsters.tierScale` | 0.5 | fraction | Runs | Monster Health and damage rise this fraction per difficulty tier. |
| `monsters.itemsMin` | 2 | items | Attacks and spells | Fewest items a monster carries. |
| `monsters.itemsMax` | 3 | items | Attacks and spells | Most items a monster carries. |
| `monsters.pitBossReduce` | 0.1 | fraction | Classes | Pit Boss takes this much less from monsters. |
| `monsters.hitCapFraction` | 0.6 | fraction | RPG layer | No single monster hit takes more than this fraction of a character's max Health (0 turns the cap off). Added after bot runs: bosses one-shot level-1 characters. |
| `monsters.raidMinPlayers` | 2 | players | RPG layer | Players needed on the tile to start a raid. |
| `monsters.snareThreshold` | 0.25 | fraction | Legendaries | Tamer's Snare catches below this Health fraction. |
| `monsters.lootGoldTierScale` | 0.5 | fraction | Runs | Monster Gold drops rise this fraction per difficulty tier above 1. |
| `monsters.eggChanceScale` | 1 | multiplier | Pets | Multiplier on every species' egg drop chance (0 turns eggs off). |

## challenge

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `challenge.hostedCapSeconds` | 120 | seconds | Challenge Wheel | Time cap for hosted entries. |
| `challenge.externalCapSeconds` | 300 | seconds | Challenge Wheel | Time cap for external entries. |
| `challenge.timeoutDamage` | 10 | Health | Challenge Wheel | Both take this when the timer runs out with no result. |
| `challenge.noRepeatMinEntries` | 4 | entries | Challenge Wheel | With at least this many enabled entries the same one cannot repeat in a fight. |
| `challenge.callOutRange` | 3 | hexes | Classes | Enforcer Call Out reach. |
| `challenge.enforcerPvpBonus` | 0.25 | fraction | Classes | Enforcer damage bonus against players. |
| `challenge.gmWindowSeconds` | 6 | seconds | Challenge Wheel | After a spin the GM sees the result this long before the TV animation; reroll or force within it. |
| `challenge.winMult` | 1 | multiplier | Challenge Wheel | The winner's weapon hits for stake times this, no roll. |
| `challenge.critMult` | 2 | multiplier | Challenge Wheel | A flawless win is a crit: the hit uses this multiplier instead. |
| `challenge.seriesWins` | 2 | wins | Challenge Wheel | Wins needed in a team (best-of-three) entry. |
| `challenge.quickdrawMinDelayMs` | 1500 | ms | Challenge Wheel | Quick-Draw: shortest wait before the TV flashes. |
| `challenge.quickdrawMaxDelayMs` | 5000 | ms | Challenge Wheel | Quick-Draw: longest wait before the TV flashes. |
| `challenge.quickdrawFlawlessMs` | 300 | ms | Challenge Wheel | Quick-Draw: a winning reaction at or under this is flawless. |
| `challenge.speedMathQuestions` | 5 | questions | Challenge Wheel | Speed Math: questions per duel; first to answer them all correctly wins. |
| `challenge.speedMathMaxOperand` | 20 | number | Challenge Wheel | Speed Math: largest operand rolled. |
| `challenge.triviaQuestions` | 5 | questions | Challenge Wheel | Trivia: questions drawn from the bank per duel. |
| `challenge.memoryPairs` | 6 | pairs | Challenge Wheel | Memory Match: pairs in the grid (6 pairs = 4 by 3). |
| `challenge.emojiSequenceLength` | 10 | emoji | Challenge Wheel | Emoji Memory: length of the full sequence; reaching it is flawless. |
| `challenge.typingMaxErrors` | 2 | characters | Challenge Wheel | Typing Race: a submission with at most this many errors counts as finished. |

## pets

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `pets.teamMax` | 6 | pets | Pets | Pets a player carries. |
| `pets.beastmasterTeamMax` | 7 | pets | Classes | Beastmaster carry cap at level 5. |
| `pets.attacks` | 4 | attacks | Pets | Attacks per pet. |
| `pets.startPower` | 40 | Power | Pets | Power of a freshly hatched pet. |
| `pets.powerPerStage` | 20 | Power | Pets | Power added per evolution stage. |
| `pets.sessionPowerBonus` | 10 | Power | Before the run | Power every pet gets at the start of a run. |
| `pets.rareWheelBlanks` | 2 | segments | Pets | Dud-egg segments on the rare pet wheel. |
| `pets.beastmasterPowerMult` | 2 | multiplier | Classes | Beastmaster pets earn Power at this multiple. |
| `pets.beastmasterAttackBonus` | 0.15 | fraction | Classes | Beastmaster pet attack bonus at level 10. |
| `pets.swarmBodies` | 5 | bodies | Legendaries | Bodies in a Mucklings swarm. |
| `pets.evolveAt` | [100, 200] | Power | Pets | Power thresholds at which a pet reaches its second and third stage. |
| `pets.winPower` | 5 | Power | Pets | Power a pet earns when one of its attacks wins. |
| `pets.battleMaxRounds` | 12 | rounds | Pets | Pet-versus-pet battles end after this many rounds; higher Power left wins. |
| `pets.wheelSegments` | 8 | segments | Pets | Segments on each of the three pet wheels. |

## social

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `social.letterDelayTurns` | 2 | recipient turns | PvP and social | Delivery delay of a letter. |
| `social.lettersOffTurn` | 1 | letters | PvP and social | Letters you may write when it is not your turn. |
| `social.smokeBombFree` | 1 | uses | Classes | Free Smoke Bombs for the Cutpurse per run. |
| `social.sideBetsOn` | 0 | on/off | Attacks and spells | Side bets for players not in the fight. |
| `social.tableVotesPerNight` | 1 | votes | PvP and social | Table votes to send someone to the Graveyard. |
| `social.impostorTurns` | 2 | turns | Legendaries | Impostor's Visor disguise length. |
| `social.letterMaxChars` | 280 | characters | PvP and social | Longest letter a phone may send. |
| `social.sideBetMax` | 20 | Health | Attacks and spells | Largest side bet a spectator or bystander may place. |
| `social.voteSeconds` | 30 | seconds | PvP and social | How long a vote stays open when the opener names no deadline. |
| `social.emoteKeep` | 20 | emotes | PvP and social | Emotes kept for the TV to float over avatars. |

## classes

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `classes.whaleStakeDiscount` | 0.25 | fraction | Classes | Whale weapon stakes cost this much less. |
| `classes.whaleDamageBonus` | 0.15 | fraction | Classes | Whale hits deal this much more. |
| `classes.whaleCooldown` | 6 | own turns | Classes | Double Down cooldown. |
| `classes.pitBossHealBonus` | 0.5 | fraction | Classes | Pit Boss healing bonus. |
| `classes.pitBossPactDiscount` | 0.15 | fraction | Classes | Pit Boss Blood Pact discount. |
| `classes.pitBossCooldown` | 5 | own turns | Classes | House Rules cooldown. |
| `classes.cutpurseCooldown` | 6 | own turns | Classes | Sleight cooldown. |
| `classes.enforcerCooldown` | 5 | own turns | Classes | Call Out cooldown. |
| `classes.enforcerKillHeal` | 20 | Health | Classes | Enforcer heals this on a player kill at level 10. |
| `classes.beastmasterCooldown` | 4 | own turns | Classes | Rally cooldown. |
| `classes.croupierSpellDiscount` | 0.5 | fraction | Classes | Croupier spells stake this much less. |
| `classes.croupierCooldown` | 6 | own turns | Classes | Rig the Deck cooldown. |
| `classes.upgradedCooldown` | 3 | own turns | Classes | Cooldown after the level-20 upgrade for Whale and Cutpurse. |
| `classes.whaleCritBonus` | 0.5 | multiplier | Classes | Whale crit multiplier bonus at level 5. |
| `classes.pitBossShopDiscount` | 0.25 | fraction | Classes | Pit Boss shop discount at level 10. |
| `classes.cutpurseHiddenTurns` | 2 | turns | Classes | Turns the Cutpurse is hidden on the TV after a Smoke Bomb. |
| `classes.croupierCardsBonus` | 0.15 | fraction | Classes | Croupier Cards family bonus at level 5. |

## wheels

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `wheels.fortuneHealth` | 20 | Health | Wheels | Fortune Wheel Health prize. |
| `wheels.fortuneGold` | 60 | Gold | Wheels | Fortune Wheel Gold prize. |
| `wheels.fateWindfall` | 80 | Gold | Wheels | Fate Wheel windfall. |
| `wheels.chaosRegionRounds` | 3 | rounds | Wheels | Length of a region-targeted Chaos effect. |
| `wheels.chaosGridShrinkRounds` | 1 | rounds | Inventory grid | Rounds a Chaos grid shrink lasts. |
| `wheels.lootWeightCommon` | 60 | weight | Wheels | Loot Wheel weight of Common. |
| `wheels.lootWeightRare` | 27 | weight | Wheels | Loot Wheel weight of Rare. |
| `wheels.lootWeightEpic` | 11 | weight | Wheels | Loot Wheel weight of Epic. |
| `wheels.lootWeightLegendary` | 2 | weight | Wheels | Loot Wheel weight of Legendary (subject to the per-run cap). |
| `wheels.luckRarityShiftPerPoints` | 4 | points | RPG layer | Luck points per one-step rarity shift. |
| `wheels.fateMissTurns` | 1 | turns | Wheels | Turns lost on the Fate Wheel's Lose a Turn. |
| `wheels.chaosClassRounds` | 2 | rounds | Wheels | Length of a class-targeted Chaos effect. |

## runs

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `runs.tiers` | 3 | tiers | Runs | Difficulty tiers; each unlocks by clearing the one before. |
| `runs.seasonNights` | 8 | nights | RPG layer | Nights in a season. |
| `runs.tierLevelBand` | 7 | levels | Runs | Width of each tier's level band; a veteran cannot enter a tier below its band. |
| `runs.legendaryTier` | 3 | tier | Legendaries | Deepest tier; Infernal Mantle is awarded for clearing it without dying. |
| `runs.scorePerHealth` | 1 | score | End of the run | Score per point of Health remaining in the Free-for-all tiebreak. |
| `runs.pvpChestMult` | 2 | multiplier | Runs | PvP only: chest tiles per region are multiplied by this (no monsters, more loot). |
| `runs.pveExtraMonsters` | 1 | monsters | Runs | PvE only: extra monsters rolled per region. |
| `runs.pveBossMult` | 1.25 | multiplier | Runs | PvE only: boss Health multiplier. |

## legendaries

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `legendaries.pedestalLevel` | 10 | level | Legendaries | Pedestal Blade cannot be drawn under this level. |
| `legendaries.pedestalReach` | 3 | hexes | Legendaries | Pedestal Blade reach at full Health. |
| `legendaries.gravityRange` | 3 | hexes | Legendaries | Gravity Gauntlet pull range. |
| `legendaries.emberHeal` | 30 | Health | Legendaries | Ember Flask heal. |
| `legendaries.emberCharges` | 3 | charges | Legendaries | Ember Flask charges after an Inn. |
| `legendaries.bigGunStake` | 50 | Health | Legendaries | Big Fancy Gun stake. |
| `legendaries.pipBuoyRange` | 2 | hexes | Legendaries | Pip-Buoy reveal range. |
| `legendaries.shoutPush` | 2 | hexes | Legendaries | The Shout push distance. |
| `legendaries.shoutStake` | 20 | Health | Legendaries | The Shout stake. |
| `legendaries.railStake` | 35 | Health | Legendaries | Rail Lance stake. |
| `legendaries.railRange` | 3 | hexes | Legendaries | Rail Lance lock range. |
| `legendaries.broadsideRange` | 3 | hexes | Legendaries | Corvette Broadside line length. |
| `legendaries.broadsideMovePenalty` | 1 | hexes | Legendaries | Movement lost while wielding the Broadside. |
| `legendaries.potencyDamage` | 0.06 | fraction | Legendaries | Amulet of Potency damage bonus. |
| `legendaries.potencyStats` | 1 | points | Legendaries | Amulet of Potency bonus to all stats. |
| `legendaries.mantleGrit` | 3 | points | Legendaries | Infernal Mantle Grit. |
| `legendaries.carapaceDamage` | 30 | Health | Legendaries | Spiny Blue Carapace damage. |
| `legendaries.fairyRevive` | 0.5 | fraction | Legendaries | Fairy in a Jar revive fraction. |
| `legendaries.poolTurns` | 2 | turns | Legendaries | Turns trapped in the pool. |
| `legendaries.poolDamage` | 5 | Health | Legendaries | Health lost per turn in the pool. |
| `legendaries.cameraShots` | 3 | shots | Legendaries | Camera Obscura shots per run. |
| `legendaries.cameraDamage` | 15 | Health | Legendaries | Camera Obscura damage to a revenant or wraith. |
| `legendaries.pedestalFullHealth` | 1 | fraction | Legendaries | Health fraction counted as full for the Pedestal Blade. |
| `legendaries.busterDamage` | 0.5 | fraction | Legendaries | Oversized Buster Cleaver damage bonus. |
| `legendaries.jokerCritMult` | 2 | multiplier | Legendaries | The Joker's five-of-a-kind crit multiplier. |
| `legendaries.coatMinStake` | 20 | Health | Legendaries | The Croupier's Coat: opponents must stake at least this much against the wearer. |

## sets

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `sets.hideGuard` | 0.05 | fraction | Blockcraft | Hide piece Guard. |
| `sets.hideMove` | 1 | hexes | Blockcraft | Hide four-piece movement bonus. |
| `sets.giltGuard` | 0.05 | fraction | Blockcraft | Gilt piece Guard. |
| `sets.giltLuck` | 2 | points | Blockcraft | Gilt piece Luck. |
| `sets.ironGuard` | 0.15 | fraction | Blockcraft | Iron piece Guard. |
| `sets.gemGuard` | 0.25 | fraction | Blockcraft | Gem piece Guard. |
| `sets.gemGrit` | 1 | points | Blockcraft | Gem piece Grit. |
| `sets.chainGuard` | 0.1 | fraction | Blockcraft | Chainmail piece Guard. |
| `sets.pieces` | 4 | pieces | Blockcraft | Pieces for the set bonus. |
| `sets.giltCharges` | 5 | charges | Blockcraft | Fights a Gilt piece survives before it crumbles. |

## shop

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `shop.potion` | 40 | Gold | Tiles | Potion price. |
| `shop.nudge` | 30 | Gold | Tiles | Nudge price. |
| `shop.reroll` | 30 | Gold | Tiles | Reroll price. |
| `shop.fork` | 45 | Gold | Tiles | Fork price. |
| `shop.smokeBomb` | 60 | Gold | Tiles | Smoke Bomb price. |
| `shop.phoenixFeather` | 150 | Gold | Tiles | Phoenix Feather price. |
| `shop.petRevive` | 120 | Gold | Tiles | Pet Revive price. |
| `shop.satchel` | 90 | Gold | Tiles | Satchel price. |
| `shop.spyglass` | 70 | Gold | Tiles | Spyglass price. |
| `shop.itemCommon` | 50 | Gold | Tiles | Common gear price. |
| `shop.itemRare` | 120 | Gold | Tiles | Rare gear price. |
| `shop.itemEpic` | 250 | Gold | Tiles | Epic gear price. |
| `shop.stock` | 5 | items | Tiles | Items on a Shop's shelf. |
| `shop.revive` | 100 | Gold | Tiles | Early revive at the Shop. |
| `shop.itemLegendary` | 500 | Gold | Tiles | Price a Legendary sells back from (never stocked). |
| `shop.cutpurseConsumableFraction` | 0.5 | fraction | Classes | What a Cutpurse pays for Fork and Nudge (half). |
| `shop.restockRounds` | 3 | rounds | Tiles | A Shop refills its shelf this many rounds after it was first opened. |

## chaos

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `chaos.tierDamageMult` | [1, 1.25, 1.5, 2, 3] | multiplier | Wheels | Damage multiplier per Chaos tier (tiers 1 to 5). |
| `chaos.tierUpEveryRounds` | 4 | rounds | Wheels | Chaos tier rises every this many rounds. |
| `chaos.maxTier` | 5 | tier | Wheels | Highest Chaos tier. |
| `chaos.collectorTakes` | 10 | Health | Wheels | What the Collector takes when Chaos sends them. |
| `chaos.regionMult` | 2 | multiplier | Wheels | Damage multiplier of a region-targeted Chaos effect (double damage in the Docks). |
| `chaos.classMult` | 2 | multiplier | Wheels | Damage multiplier against a Chaos-marked class. |
| `chaos.voteSeconds` | 30 | seconds | PvP and social | How long the table has to vote a Chaos victim. |

## quests

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `quests.perRun` | 3 | quests | RPG layer | Public quests dealt at the start. |
| `quests.personalPerPlayer` | 1 | quests | RPG layer | Secret quests per player. |
| `quests.goldReward` | 100 | Gold | RPG layer | Gold for a quest. |
| `quests.holdGold` | 2000 | Gold | RPG layer | Gold to hold for the hoarder quest. |
| `quests.bankGold` | 500 | Gold | RPG layer | Banked Gold needed for the banker quest. |
| `quests.winsInRegion` | 3 | hits | RPG layer | Hits landed in the named region for the regional quests. |
| `quests.monsterKills` | 3 | kills | RPG layer | Monster kills for the hunter quest. |
| `quests.surviveChaosTier` | 3 | tier | RPG layer | Chaos tier to be alive at for the survivor quest. |
| `quests.reachLevel` | 5 | level | RPG layer | Level for the climber quest. |
| `quests.openChests` | 2 | chests | RPG layer | Chests for the looter quest. |

## auction

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `auction.minBid` | 10 | Gold | Health economy | Smallest sealed bid. |
| `auction.windowSeconds` | 30 | seconds | Health economy | Bid window. |
| `auction.houseCut` | 0.1 | fraction | Health economy | Share of the winning bid the house keeps when a player sells at auction. |

## royale

| Key | Default | Unit | Spec section | What moving it does |
| --- | --- | --- | --- | --- |
| `royale.shrinkEveryRounds` | 3 | rounds | Polish | Rounds between map shrinks in Royale. |
| `royale.outsideDamage` | 10 | Health | Polish | Damage per turn outside the circle. |
| `royale.minRadius` | 1 | hexes | Polish | The circle never shrinks closer than this to the throne. |

## Tuned from bot runs

_Filled by the lead from `npm run test:bots` output: run length by size and player count, deaths per run, Health curve, loot rarity counts. Put the notes in `data/balance-notes.md`; they are appended here verbatim._

## Tuned from bot runs

Bot runs (`npm run bots`, 4 and 8 bots in every mode) set these away from the spec's bracketed defaults; the
reason is in each tunable's note above.

- `items.charges` 5 → 15: at 5 a Common weapon is spent inside one monster fight and the table runs out of weapons by round 6.
- `monsters.healthCommon` 60 → 40, `healthBoss` 200 → 100, `healthRaid` 320 → 180, `healthFinal` 400 → 180: a 10-stake Common hit lands about half the time for 10, so a 60-Health monster took a dozen weapon uses; a region boss now falls in one long turn or two, and a key holder can take the Dealer in two.
- `items.monsterStakeFraction` 1.0 → 0.6 and the new `monsters.hitCapFraction` 0.6: bosses were one-shotting level-1 characters (a 174-Health Hold'em hit on a 130-Health character). A monster now stakes 60% of its item and no single monster hit takes more than 60% of your max Health: two bad swings still kill you, one never does.
- `table.lastCallMinutes` 100 (new): whatever the mode, a run still going 100 minutes after RUN_START ends on placings ("Last Call: the House closed"). Four-player tables reach the throne or the Dealer in 60–85 minutes on their own; six- and eight-player tables usually end on Last Call, because 8 players get only 10–12 turns each in 100 minutes. 0 turns it off.
- `map.hexesPerExtraPlayer` 2 → 0: every extra player means fewer turns for everyone, so the map must not grow with the table; `monstersPerExtraPlayer` still adds monsters so nobody waits for a fight.
- `map.monstersPerRegion` 3 → 2 (plus the region boss): with a 90-second clock a player clears one monster per turn at best; two per region plus bosses fits a Regular map in 60–90 minutes with four to six players.
- Every Shop shelf now stocks one Common weapon and one pair of Loaded Boots (both at `shop.itemCommon`), so nobody is weaponless or barefoot for long; every region boss drops a Citadel Key, so the throne is reachable without level 10, and the key is a quest item that stays with you through death.

### How the simulated clock is charged

`tools/bots.mjs` charges pessimistic phone times: 8 s per tap, 3 s per step, 25 s per minigame round, 10 s per monster action, 45 s per hosted-challenge report, and a flat 10 minutes for creation (everyone creates at once). A plain turn costs 50–80 s, a boss fight 3–5 minutes, in line with the 1:30 chess clock. The two-hour gate in CI is measured on that clock.
