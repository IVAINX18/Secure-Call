# AGENTS.md

SecureCall: React 18 + Vite + TypeScript SPA at the repo root, a standalone Express + Socket.IO WebRTC signaling server in `server/`, and a FastAPI facial-biometric engine in `biometric_engine/` (100% open source, no cloud biometric APIs). Product/architecture overview lives in `README.md` and `Docs/`; the engine documents itself in `biometric_engine/{README,ARCHITECTURE}.md` plus `biometric_engine/docs/deployment.md` — read those before touching their areas instead of duplicating here.

## Commands

Frontend (repo root):
- `npm install`, then `npm run dev` — Vite dev server at http://localhost:5173, exposed to LAN (`vite --host`)
- `npm run build` — `tsc && vite build` -> `dist/`; `npm run preview` serves `dist/` on :4173
- Typecheck gotcha: the root `tsconfig.json` is a solution file (`files: []` + project references), so the bare `tsc` in `npm run build` type-checks nothing and `vite build` does not typecheck either — TS errors do not fail the build. Run `npx tsc -b` to actually see them (currently reports pre-existing errors only in untouched legacy files).
- Testing/lint: no tests and no test runner for the frontend. `eslint.config.js` exists but eslint and its plugins are absent from `package.json`, so `npx eslint` cannot run; don't install lint tooling or add scripts unless asked.

Signaling server (`server/` is a separate npm project — install its deps separately):
- `cd server && npm install && npm run dev` (same as `npm start`) — `node server.js` on the `PORT` env var or 3000.

Biometric engine (`biometric_engine/`, Python 3.11 via uv):
- `.venv/bin/python -m pytest tests/ -q --cov=app --cov-fail-under=95` (coverage needs dotted `--cov` module paths; greenlet concurrency is configured in pyproject; suite is 106 tests at 100%)
- `.venv/bin/ruff check app tests`, `.venv/bin/mypy app` — both must be clean
- Needs PostgreSQL + Redis. Local `.env` (gitignored) points at podman `sc-postgres` (:55432) / `sc-redis` (:56379); canonical compose ports are 5432/6379/8000. This machine's port 8000 is taken — local uvicorn QA binds :8800. Never touch other tenants' containers.

## Live architecture

- `src/main.tsx` -> `src/App.tsx` (react-router): `/` Login, `/register`, `/settings`, `/dashboard`, `/video-call/:roomId?`, `/settings/biometric-enroll` (protected, inside `Layout`) and `/login/biometric-verify` (public, like Login).
- Auth stays a localStorage mock (`AuthContext`); verification is client-only (`VerificationContext`, 24h). No real auth backend exists. Biometric pages take an engine-signed JWT pasted by the user (localStorage key `biometric_api_token`); mint with the engine secret (see `biometric_engine/README.md` Authentication section).
- Call path: `Dashboard` mints an 8-char room id (uuid) -> `VideoCall` -> `RoleSelector` (host/guest) -> `EnhancedWebRTCRoom` -> `src/utils/enhancedVideoCallManager.js` (plain-JS singleton): socket.io-client to the signaling server plus WebRTC offer/answer/ICE, heartbeats, and "scan notification" broadcasts.
- `server/server.js` relays socket events `join-room`, `offer`, `answer`, `ice-candidate`, `media-ready`, `scan-notification`, `heartbeat`, and serves diagnostics `/health`, `/rooms`, `/rooms/:roomId`, `/cors-test`, `/test-connection`. CORS is intentionally wide open (both allow and deny branches call `callback(null, true)`, labeled "guest debugging") — don't "fix" it without asking.
- The signaling URL is hardcoded in `enhancedVideoCallManager.js`: `http://localhost:3000` on localhost, else `https://biometricov4.onrender.com`. The `VITE_PEER_*` values in `.env.development`/`.env.production` are read by no live code — editing them changes nothing (they are committed to git, so don't add secrets to them).
- Biometric API: `POST /api/v1/{enroll,verify,verify-liveness}` + `GET /api/v1/health`, Swagger at `/docs`. Frontend base URL is build-time `VITE_BIOMETRIC_API_URL` (default `http://localhost:8000`; local dev on this machine uses `:8800` because 8000 is taken). Quality gate 0.7 rejects tilted/blurry faces (HTTP 400); rate limit 100 req/min per user (429); liveness = blink (EAR 0.15, calibrated) + micro-movement, `MIN_FRAMES = 5`.

## Dead code — don't wire it up or build on it without asking

- `src/services/{socket,peer,webrtc,database,roomApi}.ts` — imported by nothing (verified, still unreferenced).
- `src/components/WebRTCRoom.tsx` (superseded by `EnhancedWebRTCRoom.tsx`); `src/utils/{callManager,connectionManager,videoCallManager,canvasRenderer,videoRenderer,mediaManager}.js` — unreferenced.
- `src/pages/{FacialVerification,FingerprintVerification}.tsx` — not routed.
- Unused deps: `simple-peer`, `zustand`, `axios` (axios only inside dead `roomApi.ts`); `peerjs` only inside dead `services/`.
- `src/utils/*.js` are plain JS (`allowJs` is off, so tsc skips them) — the mixed `.js`/`.ts` under `src/` is legacy; don't bulk-convert.

## biometric_engine gotchas (hard-earned — respect these)

- Fixtures: `tests/fixtures/images/single_face.jpg` FAILS the 0.7 quality gate by design (~15° head tilt); never enroll it — use `face_leveled.jpg` (derivation recipe in `tests/fixtures/images/SOURCES.md`).
- structlog: the first positional arg IS `event` — never pass `event=` as a kwarg.
- Async singletons are loop-bound (engine, Redis client, liveness detector): recreate when the running loop changes; pytest-asyncio gives a fresh loop per test, so test engines are function-scoped (`tests/conftest.py`).
- `AsyncSession.rollback()` expires ORM rows — capture UUID scalars before any rollback (otherwise a sync lazy-load raises `MissingGreenlet`).
- Sessions commit on clean request exit AND on controlled `HTTPException` (4xx) so failure audits survive; unexpected errors roll back (`app/dependencies.py:get_db_session`).
- A driver-less `postgresql://` URL is normalized to `+asyncpg` for the app, and sync tooling (Alembic) needs `psycopg[binary]` (installed). Don't remove either mechanism.
- Redis cache is fail-open: cache errors must never break verify/enroll; `None` = miss, empty list = valid cached value.
- Embeddings are float32 blobs; cosine similarity clamps to [-1.0, 1.0] (float32 ULP noise varies by CPU/BLAS).
- Keep `uv.lock` + runtime `requirements.txt` in sync via `uv export --no-hashes --no-dev --no-emit-project -o requirements.txt` (never let `-e .` in); the Dockerfile pip-installs `requirements.txt`, so any new runtime dep must land there.
- JWT subjects: plain UUIDs are used directly; anything else maps deterministically via uuid5 (`secure-call:{sub}`).

## Docker / compose (`biometric_engine/docker/`)

- Compose interpolation of `${...}` resolves from the compose project dir (`docker/`), NOT from `biometric_engine/.env` — so `dev-start.sh`/`dev-stop.sh` forward `../.env` via conditional `--env-file` (host-level knobs only: ports, secrets, thresholds). Container `DATABASE_URL`/`REDIS_URL` are hardcoded to service DNS (`postgres:5432`, `redis:6379`) so a host-oriented `.env` can't leak `localhost` URLs into containers — don't re-interpolate them.
- Entrypoint runs `alembic upgrade head` then uvicorn, binding `"${PORT:-8000}"`. Render injects `PORT` (default 10000) — never hardcode the port again.

## Security landmines

- `src/config/db.config.ts` contains plaintext MySQL credentials (Clever Cloud) committed to git. Treat them as compromised; never reuse, copy, or echo them.
- `biometric_engine/.env` is gitignored and holds the JWT secret; `.env.example` is the canonical template. Committed root `.env.*` files get public values only — never secrets.
- CSP `connect-src` lives in exactly three places (`index.html`, `vite.config.ts`, `vercel.json`); camera/mic `Permissions-Policy` additionally in `public/_headers` (which has NO CSP). Change headers together.
- Render Docker web services must bind `$PORT`; the entrypoint handles it — don't revert to a hardcoded port.

## Deployment

- Static frontend: Netlify (`netlify.toml`, `public/_redirects`), Vercel (`vercel.json`), or a Render static site; build `npm run build`, publish `dist`. Render ignores the Netlify-style `_redirects`/`_headers` — configure its `/*` -> `/index.html` rewrite in the dashboard/Blueprint, and set `VITE_BIOMETRIC_API_URL` at build time to the engine URL (Vite bakes it in).
- Biometric backend: `render.yaml` Blueprint at repo root (Docker web service + PostgreSQL 15 + Key Value; `autoDeployTrigger: off`, CI-gated deploy hook). Needs the `RENDER_DEPLOY_HOOK` secret and `CORS_ORIGINS` set to the frontend origin, or browsers block everything; see `biometric_engine/docs/deployment.md`.
- Signaling server: Render web service rooted at `server/` (`server/Procfile`).
- CI: only `biometric-engine CI` (`.github/workflows/ci.yml`: ruff + mypy, pytest with `--cov-fail-under=95`, docker build) triggered by `deploy.yml` (Render hook, skips gracefully without the secret). Green CI on main is the deploy gate.

## Conventions

- Repo was scaffolded by bolt.new (`.bolt/`); its prompt mandates Tailwind CSS + lucide-react and no other UI/icon libraries unless asked. `electron/` is an experimental container shell (single `main.js`, no npm scripts).
- Single branch (`main`); terse single-line commit messages, no footers/trailers/format prefixes; never force-push or amend pushed history.
- Never stage `.omo/`, `.env` files, coverage artifacts, or build outputs (`dist/`, `htmlcov/`, `*.tsbuildinfo`).
