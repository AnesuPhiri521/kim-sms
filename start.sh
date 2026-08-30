#!/usr/bin/env bash
# Starts the EduManage backend + frontend together (macOS/Linux).
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run this script. Install it from https://nodejs.org/ and try again." >&2
  exit 1
fi

exec node "$DIR/scripts/dev.js" "$@"
