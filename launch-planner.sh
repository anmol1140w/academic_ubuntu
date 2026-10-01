#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${ACADEMIC_PLANNER_PORT:-4173}"
URL="http://127.0.0.1:${PORT}/index.html"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to launch Academic OS." >&2
  exit 1
fi

if ! curl -fsS "${URL}" >/dev/null 2>&1; then
  (cd "$APP_DIR" && exec python3 -m http.server "$PORT" --bind 127.0.0.1) >"${TMPDIR:-/tmp}/academic-os-${PORT}.log" 2>&1 &
  for _ in {1..30}; do
    if curl -fsS "${URL}" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  printf 'Academic OS is running at %s\n' "$URL"
fi
