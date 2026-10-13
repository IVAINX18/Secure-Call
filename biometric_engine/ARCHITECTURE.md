# Biometric Engine — Architecture

Facial biometric enrollment and verification for Secure-Call.
100% open source: InsightFace (ArcFace embeddings) + MediaPipe (liveness),
FastAPI, PostgreSQL, Redis. No cloud biometric APIs.

## Hexagonal layout

```
app/
  api/                 # inbound adapters (FastAPI routers: enroll, verify,
                       # verify_liveness, health; JWT + rate-limit wiring)
  domain/              # pure business logic (services.py, models, exceptions,
                       # value_objects) — no FastAPI, no SQLAlchemy imports
  infrastructure/
    adapters/          # InsightFace face detector/embedder
    liveness/          # MediaPipe Tasks FaceLandmarker detector
    db/                # SQLAlchemy models, repositories, session, migrations
    cache/             # Redis client + embedding cache
  core/                # cross-cutting: logging, security (JWT), rate_limit, metrics
  dependencies.py      # FastAPI dependency wiring (DB session, service, user)
  config.py            # pydantic-settings (DATABASE_URL, thresholds, TTL, ...)
  main.py              # app factory, middleware, lifespan (engine + redis)
```

Rules: `api` depends on `domain` through `dependencies.py`; `domain`
defines Port protocols and `infrastructure` implements them. The service
constructor takes structural Ports, so unit tests inject fakes without casts.

## Enrollment flow

```
JWT Bearer -> get_current_user (sub) -> uuid5 map (non-UUID subjects)
  -> base64 decode (400 on invalid/empty)
  -> service.enroll:
     detect face (InsightFace)              -> NoFaceDetected / MultipleFacesDetected
     quality gate overall >= 0.7            -> LowQualityFace
       (0.2*brightness + 0.3*sharpness + 0.2*face_size + 0.3*pose)
     embedding (512-d ArcFace) -> blob -> repository flush
     cache invalidate (embedding changed)
     audit row ENROLL (ok AND rejected — failure audits persist, Fase 7 fix)
  -> 200 {embedding_id, quality_score}; 100/min per-user rate limit
```

DB tables (`users`, `embeddings`, `audit_logs`) are Alembic-managed
(`app/infrastructure/db/migrations`); the container entrypoint runs
`alembic upgrade head` before uvicorn so fresh volumes get tables.

## Verification flow

```
JWT Bearer -> base64 decode (400 on invalid/empty)
  -> service.verify:
     cache get (fail-open: Redis errors log a warning, fall through to DB)
     DB miss (unknown user / no embeddings) -> verified=False, confidence=0.0 (200, not 404)
     detect + embed probe -> cosine similarity vs stored (best match)
     verified = similarity >= BIOMETRIC_THRESHOLD (0.85)
     cache set (TTL EMBEDDING_CACHE_TTL=300s); audit row VERIFY
  -> 200 {verified, confidence, embedding_id}
```

Empty-list is a valid cached value (`None` = miss only), so the
no-embeddings audit branch is preserved on both cache paths.

## Liveness flow

```
JWT Bearer -> frames base64 decode (400 on invalid/empty)
  -> MediaPipe Tasks FaceLandmarker (IMAGE mode, per-frame static)
  -> per frame: 468 landmarks -> EAR per eye (6-point eye topology)
  -> blink = EAR dips below 0.15 and recovers (calibrated; textbook 0.2
     false-triggered on the narrow-eyed fixture at mean EAR 0.1997)
  -> movement = landmark variance across frames (threshold 1e-6:
     static repeats score exactly 0.0)
  -> confidence = 0.6*blink + 0.4*min(1, var/1e-5)
  -> live requires blink AND movement AND confidence >= LIVENESS_THRESHOLD (0.7)
  -> audit row LIVENESS_CHECK
```

First FaceLandmarker init costs ~60 s wall (TF-Lite XNNPACK delegate build)
but is lazy; the model bundle (~3.6 MB) auto-downloads to
`~/.cache/mediapipe/` (`MEDIAPIPE_MODEL_PATH` overrides). InsightFace
`buffalo_sc` (~16 MB) caches under `~/.insightface/`.

## Design decisions

| Decision | Choice | Why |
| -------- | ------ | --- |
| Face embeddings | InsightFace `buffalo_sc` (SCRFD det_500m + ArcFace w600k_mbf) | Open source, CPU-only, ~16 MB total, det_size (640,640); `buffalo_l` reserved as quality option via constructor param |
| Liveness | MediaPipe Tasks API `FaceLandmarker` | Installed mediapipe 1.1.0 removed `mp.solutions.face_mesh`; Tasks API is the supported path; eye topology indices identical so EAR math unchanged |
| Database | PostgreSQL + async SQLAlchemy | Async stack matches FastAPI; Alembic migrations; UUID PKs, FK-safe user rows |
| Embedding storage | float32 blobs, not pgvector arrays | Zero extra extension; cosine computed in Python; base64-JSON in Redis (never pickle) |
| Cache | Redis, fail-open | Cache errors never break verify/enroll; helpers `_cache_get/_set/_invalidate` in the service with structlog warning + DB fallback |
| Transaction semantics | Commit on success AND controlled 4xx | A blanket rollback erased failure audits; `get_db_session` commits on clean exit and on `HTTPException` (endpoints map domain rejections to 4xx), rolls back only on unexpected errors |
| Rate limiting | slowapi 100/min per user | Custom key_func on JWT sub (fallback client IP); Limiter in app.state + JSON 429 handler registered specifically for `RateLimitExceeded` |
| Auth | JWT Bearer, subjects + uuid5 mapping | UUID subjects used directly; other subjects map deterministically (`secure-call:{sub}`) to stable FK-safe rows |
| Quality gate | 0.7 composite | Brightness gray-mean, sharpness Laplacian-var, face-size bbox ratio, pose from 5-point landmarks; rejects tilt/blur/small faces before they poison the gallery |
| EAR threshold | 0.15, calibrated | Textbook 0.2 false-triggered on the fixture (open-eye mean EAR 0.1997); closed eye ~0.05; 0.15 splits both margins |
| Logging | structlog JSON | First positional arg is `event`; request-id middleware binds per-request context |
| Metrics | prometheus_client `/metrics` | Mounted ASGI app; note the 307 redirect to `/metrics/` |

## Known limitations

- **Fixture tilt**: shipped `single_face.jpg` fails the 0.7 gate (overall 0.43;
  ~14.9 deg head tilt crushes the pose term). Smoke tests must use
  `tests/fixtures/images/face_leveled.jpg` (derotated variant, quality ~0.76).
  Recipe in `tests/fixtures/images/SOURCES.md`.
- **Coverage tracing needs greenlet mode**: SQLAlchemy's async driver switches
  greenlets on every DB await, and without greenlet-aware tracing coverage.py's
  C tracer loses frame association across those switches. Fase 11 proved this
  with evidence: the identical suite reported enroll.py at 83% (lines 62-69
  "missed" although the 400 responses proved they execute) plus phantom line
  numbers from other files, while `concurrency = ["greenlet"]` in
  `pyproject.toml` reports the true 100% with zero phantoms. An independent
  `sys.settrace` probe confirmed the handler lines execute. Do not remove the
  `[tool.coverage.run]` setting or endpoint coverage will falsely regress.
- **Models volume for prod**: models download into container-local caches on
  first use (~20 MB + 60 s MediaPipe init). For production, mount persistent
  volumes for `~/.insightface` and `~/.cache/mediapipe` (or bake the bundles
  into the image) to avoid cold-start latency on every redeploy.
- **Container runtime**: Fase 9 validated the stack end-to-end with Docker
  26.1.5 (image builds, 3 services Up/healthy, containerized enroll→verify
  green). The compose file and Dockerfile are runtime-agnostic; podman works
  as a fallback when no Docker daemon is available.
