#!/bin/sh
# Container entrypoint: run Alembic migrations, then start the API.
# Tables are Alembic-managed (app/infrastructure/db/migrations); without this
# step a fresh postgres volume has no tables and every request 500s.
set -eu

echo "[entrypoint] running database migrations..."
alembic upgrade head
echo "[entrypoint] migrations done, starting API..."

# Render injects PORT (default 10000); local/compose default 8000.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
