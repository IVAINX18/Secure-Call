#!/bin/sh
# Container entrypoint: run Alembic migrations, then start the API.
# Tables are Alembic-managed (app/infrastructure/db/migrations); without this
# step a fresh postgres volume has no tables and every request 500s.
set -eu

echo "[entrypoint] running database migrations..."
alembic upgrade head
echo "[entrypoint] migrations done, starting API..."

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
