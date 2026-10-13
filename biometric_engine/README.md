# Biometric Engine

Facial biometric enrollment and verification service for Secure-Call.
100% open source: InsightFace (ArcFace embeddings) + MediaPipe (liveness),
FastAPI, PostgreSQL, Redis. No cloud biometric APIs.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the hexagonal layout, request
flows, and design decisions.

## Requirements

- Python 3.11 (managed via [uv](https://docs.astral.sh/uv/))
- Docker + Docker Compose plugin (for the full stack)
- ~2 GB free disk for the API image; ~20 MB download on first run
  (InsightFace model bundle ~16 MB, MediaPipe task bundle ~3.6 MB)

## Setup

1. Copy the environment template and adjust values:

```bash
cd biometric_engine
cp .env.example .env
```

Key variables (see `.env.example` for the full list):

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@localhost:5432/biometric` | Async SQLAlchemy URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis cache URL |
| `JWT_SECRET_KEY` | `change-me-to-a-long-random-secret` | HS256 signing key (generate with `openssl rand -hex 32`) |
| `BIOMETRIC_THRESHOLD` | `0.85` | Cosine-similarity gate for verify |
| `LIVENESS_THRESHOLD` | `0.7` | Confidence gate for liveness |
| `API_PORT` / `POSTGRES_PORT` / `REDIS_PORT` | `8000` / `5432` / `6379` | Host-port overrides for the compose stack |

## Quickstart (full stack with Docker)

```bash
./docker/dev-start.sh
```

This builds the `biometric-api` image if needed, starts postgres + redis +
the API, waits on healthchecks, prints status, then follows the API logs
(Ctrl+C detaches; the stack keeps running). Health:

```bash
curl http://localhost:8000/api/v1/health
```

Stop the stack (containers removed, `pgdata` volume kept):

```bash
./docker/dev-stop.sh
```

## Quickstart (local API with uv)

```bash
cd biometric_engine
uv python install 3.11
uv venv --python 3.11
uv sync
cp .env.example .env
```

Start only the backing services, then run the API locally:

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis
uv run uvicorn app.main:app --host 0.0.0.0 --port 8800
```

Pinned runtime dependencies for Docker/CI are exported in `requirements.txt`
(regenerate with `uv export --no-hashes --no-dev --no-emit-project -o requirements.txt`).

## Authentication

All `/api/v1/*` endpoints except docs require a Bearer JWT. Mint one with the
same `JWT_SECRET_KEY` the API uses:

```bash
JWT_SECRET_KEY="$(grep '^JWT_SECRET_KEY=' .env | cut -d= -f2-)"
export TOKEN
TOKEN="$(uv run python -c "
from app.core.security import create_access_token
print(create_access_token('qa-user'))
")"
echo "$TOKEN"
```

Non-UUID subjects are mapped deterministically via uuid5 inside the API, so
any stable subject string works for QA.

## Examples (curl)

These examples assume the stack on `localhost:8000` and a `TOKEN` from above.
`face_leveled.jpg` ships in `tests/fixtures/images/` (it passes the 0.7
quality gate; the raw `single_face.jpg` does not — see ARCHITECTURE.md).

Health (no auth):

```bash
curl -s http://localhost:8000/api/v1/health
```

Enroll (stores one embedding for the JWT subject):

```bash
IMG="$(base64 -w0 tests/fixtures/images/face_leveled.jpg)"
curl -s -X POST http://localhost:8000/api/v1/enroll \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"image_base64\": \"$IMG\"}"
```

Verify (same image → `verified: true`, `confidence: 1.0`):

```bash
IMG="$(base64 -w0 tests/fixtures/images/face_leveled.jpg)"
curl -s -X POST http://localhost:8000/api/v1/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"image_base64\": \"$IMG\"}"
```

Liveness (static frames → `live: false`; a real check needs a blink sequence).
Six frames of base64 (~158 KB) exceed the Linux per-argument limit (128 KB),
so build the payload via a file:

```bash
uv run python -c "
import base64, json
img = base64.b64encode(open('tests/fixtures/images/face_leveled.jpg','rb').read()).decode()
json.dump({'video_frames_base64': [img] * 6}, open('/tmp/liveness.json','w'))
"
curl -s -X POST http://localhost:8000/api/v1/verify-liveness \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/liveness.json
```

## API endpoints

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST | `/api/v1/enroll` | Bearer | Enroll a face embedding for the JWT subject |
| POST | `/api/v1/verify` | Bearer | Verify a face against enrolled embeddings |
| POST | `/api/v1/verify-liveness` | Bearer | Liveness check (blink + micro-movement) |
| GET | `/api/v1/health` | none | Service + DB + Redis health status |
| GET | `/metrics` | none | Prometheus metrics (note trailing-slash redirect) |

Interactive docs (once the API runs): `http://localhost:8000/docs`.

Rate limit: 100 requests/minute per user (per JWT subject, else client IP);
exceeding it returns `429` with a JSON detail.

```
Client -> FastAPI (/api/v1/*) -> BiometricService (domain)
    -> InsightFace (detect + embed) + MediaPipe (liveness)
    -> PostgreSQL (users, embeddings, audit) + Redis (fail-open cache)
```

## Troubleshooting

- **Ports already in use**: the compose host ports are env-overridable —
  `API_PORT=8800 POSTGRES_PORT=5433 REDIS_PORT=6380 docker compose -f docker/docker-compose.yml up -d`
  Never bind ports owned by another tenant's containers.
- **First run is slow**: the container downloads the InsightFace bundle
  (~16 MB) and the MediaPipe task bundle (~3.6 MB) on first use, and the
  MediaPipe FaceLandmarker init takes ~60 s (TF-Lite delegate build).
  The `biometric-api` healthcheck allows a 90 s start period for this.
- **Image build takes 10-20 min**: insightface/mediapipe/onnxruntime wheels
  are heavy. This is normal; be patient and keep the build log.
- **Enroll returns 400 LowQualityFace**: the image fails the 0.7 quality
  gate (tilt, blur, or small face). Use `tests/fixtures/images/face_leveled.jpg`
  for smoke tests, not `single_face.jpg`.
- **`/metrics` 307 redirect**: curl with `-L` or request `/metrics/`.
- **Docker daemon down but podman available**: the compose file is
  runtime-agnostic — build with `podman build -f docker/Dockerfile -t biometric-api .`
  and run the three services with podman on free host ports.
