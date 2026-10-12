# Biometric Engine

Facial biometric enrollment and verification service for Secure-Call.
100% open source: InsightFace (ArcFace embeddings) + MediaPipe (liveness),
FastAPI, PostgreSQL, Redis. No cloud biometric APIs.

## Requirements

- Python 3.11 (managed via [uv](https://docs.astral.sh/uv/))
- Docker + Docker Compose plugin (for PostgreSQL and Redis)

## Quickstart (local dev with uv)

```bash
cd biometric_engine
uv python install 3.11
uv venv --python 3.11
uv sync
```

Copy the environment template and adjust values:

```bash
cp .env.example .env
```

## Quickstart (services with Docker Compose)

Start PostgreSQL and Redis (the API image build is validated in Fase 9):

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis
```

Pinned runtime dependencies for Docker/CI are exported in `requirements.txt`
(regenerate with `uv export --no-hashes --no-dev --no-emit-project -o requirements.txt`).

## API endpoints

| Method | Path                    | Description                              |
| ------ | ----------------------- | ---------------------------------------- |
| POST   | `/api/v1/enroll`        | Enroll a face embedding for a user       |
| POST   | `/api/v1/verify`        | Verify a face against enrolled embedding |
| POST   | `/api/v1/verify-liveness` | Liveness check (blink + micro-movement) |
| GET    | `/api/v1/health`        | Service + DB + Redis health status       |

Interactive docs (once the API runs): `http://localhost:8000/docs`.
