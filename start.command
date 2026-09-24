#!/bin/bash
# Double-click this in Finder to start the local server and open the site.
# Closing this Terminal window (or Ctrl+C) stops the server.
cd "$(dirname "$0")"

PORT=8000
URL="http://localhost:$PORT"

if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use -- assuming the server is already running."
  open "$URL"
  exit 0
fi

(sleep 1 && open "$URL") &
echo "Starting Trail Tracker at $URL (Ctrl+C or close this window to stop)"
python3 scripts/serve.py "$PORT"
