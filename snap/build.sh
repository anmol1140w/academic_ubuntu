#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if [ "$(dpkg --print-architecture)" != amd64 ]; then
  echo 'This package is currently validated for amd64 only.' >&2
  exit 1
fi
/usr/bin/python3 desktop/build.py
mkdir -p dist
snap pack build/snap dist --filename=academic-planner_0.2.0_amd64.snap
