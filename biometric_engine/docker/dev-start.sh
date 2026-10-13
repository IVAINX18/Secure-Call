#!/usr/bin/env bash
# Bring up the full biometric-engine stack (postgres + redis + biometric-api).
# Builds the API image on first run; subsequent runs reuse the cached image.
# Usage: ./docker/dev-start.sh   (run from the repo root: biometric_engine/)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
# Forward biometric_engine/.env so host-level knobs (JWT_SECRET_KEY,
# thresholds, ports) match what the README token-minting snippet reads.
# Compose interpolates ${...} from the project directory (docker/), not from
# biometric_engine/, so without this the container would silently fall back
# to default secrets and every authenticated example would 401.
ENV_ARGS=()
if [ -f "$SCRIPT_DIR/../.env" ]; then
  ENV_ARGS=(--env-file "$SCRIPT_DIR/../.env")
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: 'docker' CLI not found. Install Docker + the Compose plugin first." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' plugin missing. Install the Docker Compose plugin first." >&2
  exit 1
fi

echo "[dev-start] building + starting all services..."
docker compose "${ENV_ARGS[@]}" -f "$COMPOSE_FILE" up --build -d

echo "[dev-start] service status:"
docker compose "${ENV_ARGS[@]}" -f "$COMPOSE_FILE" ps

echo "[dev-start] following biometric-api logs (Ctrl+C detaches, stack keeps running)..."
docker compose "${ENV_ARGS[@]}" -f "$COMPOSE_FILE" logs -f biometric-api
