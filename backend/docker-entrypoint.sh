#!/bin/sh
set -e

# --no-sync: the image is built with `uv sync --frozen --no-dev`, so the venv
# already has exactly what's needed. Without this flag, `uv run` re-checks
# the lockfile against installed groups and pulls in the dev group (mypy,
# ruff, ...) over the network on every container start/restart.
uv run --no-sync alembic upgrade head
uv run --no-sync python -m app.db.seed

exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8000
