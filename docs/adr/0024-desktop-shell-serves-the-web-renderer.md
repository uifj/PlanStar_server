# 0024. The desktop shell serves the web renderer over a fixed loopback origin

Status: accepted
Date: 2026-10-19
Relates to: [0020](0020-client-first-command-shim-transport.md) — the transport this shell carries
unchanged; [0006](0006-authorisation-checked-per-space-per-command.md) — the session it must preserve.

## Context

`front_web` was ported from Anytype's web release and speaks to this backend over `POST
/api/command/:name` plus an SSE channel, authenticated by a Better Auth **httpOnly cookie**. The task
now is a macOS desktop build of the same client. Upstream anytype-ts ships one (`electron/ts/main.ts`,
`scripts/build-electron.js`, an electron-builder `build` key) and it is the obvious reference — but
three of its properties belong to a world this project left behind:

* It loads the renderer from **`file://`** (`electron/ts/window.ts:965`). A `file://` document is an
  opaque origin, so a cookie issued by `http://localhost:8000` is never attached: every command would
  answer 401 and the app would sit on the login screen looking like an auth bug.
* Its renderer's native surface is `window.Electron`, a ~35-method preload bridge to an **embedded
  anytype-core** Go middleware, a keychain (`keytar`), an auto-updater and a native messaging host.
  None of those exist here, and the ported client already satisfies itself with `lib/web/electronMock.ts`
  — which is what the audited interface surface was verified against.
* Its packaging signs with a Developer ID, notarizes, uploads sourcemaps to Sentry and publishes to a
  vendor bucket.

## Decision

**One renderer, two targets.** `pnpm build` produces the same `dist-web` bundle for both; the desktop
target adds a shell and nothing else.

1. **The shell serves the built renderer over `http://localhost:8321`** (`electron/server.ts`, bound to
   127.0.0.1, read-only, SPA fallback, path containment against the resolved root). Ports do not affect
   same-site, so this origin and the API's are same-site: the session cookie rides along, the request is
   still cross-*origin*, and CORS is what permits it.
2. **The port is fixed and shared by both sides.** `TRUSTED_ORIGINS` gains `env.DESKTOP_ORIGIN`
   (default `http://localhost:8321`), which also feeds Better Auth's `trustedOrigins`. Deliberately
   *not* a wildcard localhost allowance: that would let any local page present the session cookie.
   `tests/unit/middleware/cors.test.ts` pins the two sides together, because they state the same value
   in two languages.
3. **`window.Electron` stays the mock; the preload adds only what a native window can offer.**
   `electron/preload.ts` exposes `window.Desktop` (identity) and forwards deep links as history
   navigations, which `lib/web/routeSync.ts` already resolves with its query string intact. Replacing
   the mock would silently change behaviour the web target and the interface audit depend on.
4. **The shell treats the backend as a peer it waits for, not a child it starts.** It probes
   `/api/health`; when nothing answers it shows a waiting page and reconnects on its own. Packaging the
   API (Prisma engines, a Postgres it would have to start) was rejected: the server is the product's
   self-hosted half, and the desktop app is a client of it.
5. **Packaging is local and unsigned**: `electron-builder.yml` with `identity: null`, targets `dir` and
   `dmg`, arm64 from the CLI (`--arm64`; a `mac.arch` key is not in electron-builder 26's schema). The
   upstream signing, notarization, Sentry and publish steps are dropped rather than stubbed.
6. **`HARNESS_DESKTOP_SMOKE=1` makes the shell verify itself** (`electron/smoke.ts`): inside the real
   renderer it signs up, reloads, waits for the app to leave `/auth/`, calls `AccountSelect`, and prints
   one JSON line. The desktop risk is cookie and CORS plumbing, where a blank login page and a blocked
   request look identical from outside.

## Consequences

* Gained: a macOS `.app` and `.dmg` from `pnpm dist:mac`; deep links, a native menu, persisted window
  frame, and a repeatable desktop self-check — with zero changes to `src/ts`, so both targets keep
  passing the same 1405 client tests.
* Accepted: the desktop app inherits the web target's limits (file dialogs and the tab API stay mocked,
  no tray, no notifications), and it fails loudly if :8321 is taken rather than falling back to another
  port — because a fallback port would not be a trusted origin.
* Accepted: `TRUSTED_ORIGINS` now names a second local origin. It is a fixed loopback port, not a
  pattern, and it is the shell's own; the `?server=` override still governs which *API* the client dials.
* Amended: the "no auto-update" limit no longer holds. [0025](0025-desktop-auto-update-via-electron-updater.md)
  adds `electron-updater` over a generic feed that forwards electron-builder's `latest-mac.yml`, still
  with `identity: null`, so an update can be downloaded and verified but not installed. The other
  clauses above — loopback origin, mock contract, unsigned local packaging — stay in force.
* Rejected alternatives, with the reason each fails: `file://` (no session cookie); a custom
  `scheme://` handler (cross-site for cookies, so the same failure); shipping the server inside the app
  (Prisma/Postgres deployment problem, not a client one); replacing the mock with the upstream IPC
  bridge (re-implements a core that no longer exists, and invalidates the audited surface).
