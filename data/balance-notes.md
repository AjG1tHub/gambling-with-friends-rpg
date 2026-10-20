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
