#!/usr/bin/env bash
# Starts the EduManage backend + frontend together (macOS/Linux).
#
# First run on a new machine is self-bootstrapping: scripts/dev.js installs uv
# (+ Python 3.12), the backend and frontend dependencies, creates the .env
# files, applies DB migrations and seeds baseline data before starting both
# servers. The only prerequisite is Node.js 20.9+ (which also ships npm).
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20.9+ is required to run this script. Install it from https://nodejs.org/ and try again." >&2
  exit 1
fi

exec node "$DIR/scripts/dev.js" "$@"
