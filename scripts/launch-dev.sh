#!/bin/bash
# Launch wrapper for wb-ads dev server (used by launchd).
# 1. Starts npm run dev in foreground (launchd watches this PID for KeepAlive).
# 2. В фоне поллит порт 3001, после готовности открывает http://127.0.0.1:3001/ в Google Chrome.
# 3. Логи: data/launchd-stdout.log + data/launchd-stderr.log (см. plist).

set -u
cd /Users/octopus/Projects/wb-ads || exit 1

# Background: wait for server up, open Chrome (only if it isn't already showing the URL).
(
  for i in {1..60}; do
    if curl -s -o /dev/null --max-time 2 http://127.0.0.1:3001/; then
      # Opens default Chrome and reuses the existing window if already running.
      /usr/bin/open -a "Google Chrome" "http://127.0.0.1:3001/"
      exit 0
    fi
    sleep 2
  done
) &

# Make sure homebrew binaries are on PATH (launchd has minimal env by default).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Foreground — npm run dev. exec replaces shell so launchd tracks the actual PID.
exec /opt/homebrew/bin/npm run dev
