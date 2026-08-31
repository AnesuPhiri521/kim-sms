#!/usr/bin/env bash
# Runs ON THE SERVER to pull the latest code and redeploy the docker-compose
# stack. Usage: ssh onto the server, cd into the repo checkout, then run this.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

git pull origin main

docker compose build
docker compose up -d

docker compose ps
