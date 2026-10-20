## Tuned from bot runs

Bot runs (`npm run bots`, 4 and 8 bots in every mode) set these away from the spec's bracketed defaults; the
reason is in each tunable's note above.

- `items.charges` 5 → 15: at 5 a Common weapon is spent inside one monster fight and the table runs out of weapons by round 6.
- `monsters.healthCommon` 60 → 40, `healthBoss` 200 → 140, `healthRaid` 320 → 240, `healthFinal` 400 → 260: a 10-stake Common hit lands about half the time for 10, so a 60-Health monster took a dozen weapon uses; fights now end inside two or three turns.
- `map.monstersPerRegion` 3 → 2 (plus the region boss): with a 90-second clock a player clears one monster per turn at best; two per region plus bosses fits a Regular map in 60–90 minutes with four to six players.
- Every Shop shelf now stocks one Common weapon (`shop.itemCommon`), and every region boss drops a Citadel Key, so the throne is reachable without level 10.
