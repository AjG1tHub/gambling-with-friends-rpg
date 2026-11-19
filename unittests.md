# unittests.md — the hourly test run

This file is the whole brief for the test agent. Follow it exactly; do not change game code.

## What you are testing
Gambling With Friends: RPG Edition (`/home/claude/gambling-with-friends-rpg`, branch `main`). Another agent is
editing that folder while you run, so **never run tests in it**. Work in your own copy.

## Steps
1. Make a clean copy of the latest pushed `main`:
   ```bash
   R=/home/claude/gambling-with-friends-rpg; W=/home/claude/gwf-testrun
   git -C $R fetch -q origin main
   git -C $R worktree remove --force $W 2>/dev/null; rm -rf $W
   git -C $R worktree add --detach $W origin/main
   ln -s $R/node_modules $W/node_modules
   cd $W && npm run build 2>&1 | tail -1
   ```
2. Run everything (about 25–35 minutes; run it in the background and wait for it):
   ```bash
   cd /home/claude/gwf-testrun && export PW_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome
   node tools/test-report.mjs
   ```
   It runs, in order: `unit` (node --test, ~400 tests), `bots` (bot games in every mode), and the browser gates
   `gate`, `qa`, `tutorial`, `lab`, `small-phone`, `tv-layout`, `reconnect`, `offline`, `sidebet`, `modes`,
   `gm-layout`, `clock`, `table-business`, `ramp`. Results land in `test/reports/<stamp>/`: `report.json`, `report.html`, **`report.png`**
   (the screenshot of the results) and one `<suite>.log` each. Gate screenshots land in `test/shots/`.
3. Open `report.png` with the Read tool and confirm it matches `report.json`.
4. For every failed suite: read its `.log`, re-run that one suite once (`node test/browser/<id>.mjs`) to tell a
   flake from a real failure, and open the most relevant screenshot in `test/shots/`.
5. Copy the evidence where it survives the worktree:
   ```bash
   D=/home/claude/gwf-test-reports/$(date +%m%d-%H%M); mkdir -p $D
   cp /home/claude/gwf-testrun/test/reports/*/report.* $D/; cp /home/claude/gwf-testrun/test/reports/*/*.log $D/
   ```
   and copy any screenshot you cite into `$D` too.

## What to report back (keep it under 250 words)
- The commit tested and the absolute path of `report.png`.
- Suites passed / failed, and total checks.
- For each failure: suite, the failing assertion verbatim, **flake or real** (did the re-run pass?), the
  screenshot path, and your best one-line guess at the cause (file and function if you can see it).
- Anything odd in a passing run (a suite twice as slow as its neighbours, warnings in a log).

## Rules
- Do not edit, commit or push anything. Do not touch `/home/claude/gambling-with-friends-rpg` except `git fetch`/`worktree`.
- Do not use the network beyond what the tests do themselves.
- If the build or the copy fails, report that and stop.
