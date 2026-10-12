# AGENTS.md

SecureCall: React 18 + Vite + TypeScript SPA at the repo root, plus a standalone Express + Socket.IO WebRTC signaling server in `server/`. `README.md` is Spanish and stale: it describes a `client/` directory (there is none) and a "PeerJS server" (the real server is Express + Socket.IO; `peerjs` is only imported by dead code).

## Commands

Frontend (repo root):
- `npm install`, then `npm run dev` - Vite dev server at http://localhost:5173, exposed to LAN (`vite --host`)
- `npm run build` - `tsc && vite build` -> `dist/`; `npm run preview` serves `dist/` on :4173

Signaling server (`server/` is a separate npm project, not a workspace - install its deps separately):
- `cd server && npm install && npm run dev` (same as `npm start`) - `node server.js` on port 3000

Typecheck gotcha: the root `tsconfig.json` is a solution file (`files: []` + project references), so the bare `tsc` in `npm run build` type-checks nothing and `vite build` does not typecheck either - TS errors do not fail the build (verified: `tsc` exits 0 with real type errors present). Run `npx tsc -b` (or `npx tsc -p tsconfig.app.json --noEmit`) to actually see them.

Testing/lint: there are no tests and no test runner. `eslint.config.js` exists but eslint and its plugins are absent from `package.json` and `package-lock.json`, so `npx eslint` cannot run; don't install lint tooling or add scripts unless asked.

## Live architecture (everything else is dead - see below)

- `src/main.tsx` -> `src/App.tsx` (react-router): `/` Login, `/register`, `/settings`, `/dashboard` and `/video-call/:roomId?` behind `ProtectedRoute` inside `Layout`.
- Auth is a localStorage mock (`AuthContext`): any non-empty email/password "logs in"; user stored under localStorage key `user`. Verification is also client-only (`VerificationContext`, 24h expiry). No real auth or biometric backend exists.
- Call path: `Dashboard` mints an 8-char room id (uuid) -> `VideoCall` page -> `RoleSelector` (host/guest) -> `EnhancedWebRTCRoom` -> `src/utils/enhancedVideoCallManager.js` (plain-JS singleton): socket.io-client to the signaling server plus WebRTC offer/answer/ICE, heartbeats, and "scan notification" broadcasts.
- `server/server.js` relays socket events `join-room`, `offer`, `answer`, `ice-candidate`, `media-ready`, `scan-notification`, `heartbeat`, and serves diagnostics `/health`, `/rooms`, `/rooms/:roomId`, `/cors-test`, `/test-connection`. CORS is intentionally wide open (both allow and deny branches call `callback(null, true)`, labeled "guest debugging") - don't "fix" it without asking.
- The signaling URL is hardcoded in `enhancedVideoCallManager.js`: `http://localhost:3000` on localhost, else `https://biometricov4.onrender.com`. The `VITE_PEER_*` values in `.env.development`/`.env.production` are read by no live code - editing them changes nothing (they are committed to git, so don't add secrets to them).

## Dead code - don't wire it up or build on it without asking

- `src/services/{socket,peer,webrtc,database,roomApi}.ts` - imported by nothing.
- `src/components/WebRTCRoom.tsx` (superseded by `EnhancedWebRTCRoom.tsx`); `src/utils/{callManager,connectionManager,videoCallManager,canvasRenderer,videoRenderer,mediaManager}.js` - unreferenced.
- `src/pages/{FacialVerification,FingerprintVerification}.tsx` - not routed.
- Unused deps: `simple-peer`, `zustand`, `axios` (axios only inside dead `roomApi.ts`); `peerjs` only inside dead `services/`.
- `src/utils/*.js` are plain JS (`allowJs` is off, so tsc skips them) - the mixed `.js`/`.ts` under `src/` is legacy; don't bulk-convert.

## Security landmines

- `src/config/db.config.ts` contains plaintext MySQL credentials (Clever Cloud) committed to git. Treat them as compromised; never reuse, copy, or echo them.
- CSP and camera/mic `Permissions-Policy` headers are duplicated in four places: `index.html`, `vite.config.ts`, `vercel.json`, `public/_headers`. Change them together or camera/mic breaks on some hosts.

## Deployment

- Static frontend: Netlify (`netlify.toml`, `public/_redirects`), Vercel (`vercel.json`), or a Render static site (`public/_headers`); build `npm run build`, publish `dist`, SPA rewrites included.
- Signaling server: Render web service rooted at `server/` (`server/Procfile`).
- `.github/workflows/jekyll-gh-pages.yml` runs on pushes to `main` but builds with Jekyll - it does not build this Vite app. It is a leftover, not a quality gate.

## Conventions

- Repo was scaffolded by bolt.new (`.bolt/`); its prompt mandates Tailwind CSS + lucide-react and no other UI/icon libraries unless asked.
- Single branch (`main`); terse commit messages (`Updated X.tsx`), no conventional-commit format.
