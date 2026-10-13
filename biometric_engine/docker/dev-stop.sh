#!/usr/bin/env bash
# Stop the biometric-engine stack (containers removed, pgdata volume kept).
# Usage: ./docker/dev-stop.sh   (run from the repo root: biometric_engine/)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
# Same --env-file forwarding as dev-start.sh (symmetry: identical interpolation).
ENV_ARGS=()
if [ -f "$SCRIPT_DIR/../.env" ]; then
  ENV_ARGS=(--env-file "$SCRIPT_DIR/../.env")
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: 'docker' CLI not found. Nothing to stop." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' plugin missing. Nothing to stop." >&2
  exit 1
fi

echo "[dev-stop] stopping stack..."
docker compose "${ENV_ARGS[@]}" -f "$COMPOSE_FILE" down

echo "[dev-stop] done. Volumes kept (use 'docker compose -f $COMPOSE_FILE down -v' to wipe pgdata)."
