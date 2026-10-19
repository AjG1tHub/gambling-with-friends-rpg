#!/bin/sh
# Unit tests:            sh test/run.sh            (add a file name to run just one)
# Everything (slow):     sh test/run.sh all        unit + two-window browser run + game lab run + balance report + soak
cd "$(dirname "$0")/.." || exit 1
if [ "$1" = "all" ]; then
  node --test --test-reporter=${REPORTER:-dot} test/unit/*.test.mjs && node test/ui.mjs && node test/lab.mjs 2 && node test/balance.mjs 50000 && node test/soak.mjs ${2:-20} ${3:-300}
else
  node --test --test-reporter=${REPORTER:-dot} ${1:-test/unit/*.test.mjs}
fi
