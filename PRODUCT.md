# PRODUCT.md — SecureCall

## What this is
Private WebRTC video calling with local facial-biometric verification (100% open-source engine, no cloud biometric APIs). React 18 + Vite + TypeScript SPA, standalone Express + Socket.IO signaling server (`server/`), FastAPI biometric engine (`biometric_engine/`).

## Who it is for
Small groups and individuals who want device-to-device video calls where only verified participants can act as host. Privacy-first buyers (health, family, professional conversations). Not an enterprise conference tool.

## Surfaces and visitor modes
- `/` Login and `/register` — **Persuade-adjacent Operate**: first impression of the brand, then a two-field form. Earn trust quickly.
- `/dashboard` — **Operate**: create a room (mint 8-char id) or join by code; copy/invite panel.
- `/video-call/:roomId` — **Operate**: role choice (host/guest), live call: local/remote video, mic/camera controls, end call, host-only face/hand scan notifications, collapsible connection diagnostics.
- `/settings`, `/settings/biometric-enroll`, `/login/biometric-verify` — **Operate**: branding (logo upload), biometric enrollment/verification with an engine-signed JWT pasted manually (no real auth backend yet; localStorage mock by design).

## Functional constraints (must survive any redesign)
- Auth is a deliberate localStorage mock (`AuthContext`); verification is client-only (`VerificationContext`).
- Signaling URL is hardcoded in `enhancedVideoCallManager.js` (localhost:3000 / Render remote). The manager singleton and `lib/biometricApi.ts` are core logic — UI never reimplements them.
- `EnhancedWebRTCRoom` callback wiring (`initializeEnhancedVideoCall`, `getEnhancedDebugInfo`, `toggleEnhancedVideo/Audio`, `cleanupEnhancedVideoCall`, `sendScanNotification`) must keep its exact signatures.
- Dashboard's uuid-8 room minting and VideoCall's `setRole` flow are business logic.
- Camera/mic require secure context; CSP + Permissions-Policy live in 4 files and must change together.
- Biometric engine quality gate 0.7 returns HTTP 400 — the UI must surface that error state honestly.

## Visual authority
`DESIGN.md` is the pinned source of truth: warm editorial light theme (Whereby-like), Roslindale-substitute serif display (Playfair Display) at 40–120px, Inter 400/500/600 body/UI, single Iris Violet #2b189b for CTAs (hover #211375), Pale Blush #f8dbd5 hero bands, Mist Gray #f4f4f4 secondary surfaces, ink #000000 text, 40px pill buttons, 12px cards, 1200px page, no sans-serif headlines, no bold weights, no dark filled buttons, elevation reserved for photos/mockups.

## Brand assets in use
`public/LogoPrincipal.png` (default wordmark until user upload via LogoContext), lucide-react icons only (line style, ~1.5px, monochrome ink), Tailwind v3 + PostCSS. The Vite scaffold icon (`vite.svg`) is a migration leftover scheduled for removal.

## Known legacy (not part of the product story)
Unrouted pages, unused services, dead managers under `src/utils` (see AGENTS.md "Dead code") — redesign does not restyle or wire them.
