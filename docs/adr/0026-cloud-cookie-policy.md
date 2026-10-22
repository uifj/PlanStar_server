# 0026. Cloud session cookies are `SameSite=None; Secure` when `APP_URL` is https

Status: accepted
Date: 2026-10-22
Relates to: [0024](0024-desktop-shell-serves-the-web-renderer.md) — the shell renderer's fixed
`http://localhost:8321` origin, which is what makes the API cross-site; [0025](0025-desktop-auto-update-via-electron-updater.md)
— the other half of the "one backend, many clients" deployment this record assumes.

## Context

The desktop shell serves its renderer from a loopback origin (`http://localhost:8321`) and dials the
API at its own URL (`https://api.<domain>` in production). Better Auth's session cookie defaulted to
`SameSite=Lax`, which browsers attach only to same-site navigation and same-site subresource requests.
A `fetch(..., { credentials: "include" })` from the renderer to the API is neither, so the cookie was
never sent and every authenticated endpoint answered 401 while the web renderer (same origin as the
API) worked fine.

The tempting fixes all hide the failure instead of fixing it:

* **Serve the renderer from the API origin.** Not available: 0024 fixed the loopback origin because
  the shell must work offline and the CSP/`connect-src` policy is built around a local document.
* **Proxy `/api/*` through the shell.** Works, but means proxying SSE and WebSocket upgrades in the
  main process — a large, streaming-shaped regression surface in exchange for a cookie attribute.
* **`SameSite=None` without `Secure`.** Silently dropped by every browser; sessions break more
  quietly than with `Lax`.

Browsers only accept `SameSite=None` on a `Secure` cookie, so the attribute pair is really a
statement about the deployment: **is this API reachable over https?** `APP_URL` already answers that.

## Decision

**One pure function maps `APP_URL` to the cookie attribute set, and the auth instance is built from
it.**

1. `src/lib/cookie-attributes.ts` owns the policy: `https:` → `{ sameSite: "none", secure: true,
   httpOnly: true, path: "/" }`; anything else (plain http, loopback, unparseable) → `{ sameSite:
   "lax", secure: false, httpOnly: true, path: "/" }`. `SameSite=None` is never emitted without
   `Secure`, which is the invariant that keeps a misconfigured deploy from *looking* like it works.
2. `src/lib/auth.ts` passes it as `advanced.defaultCookieAttributes`, and sets
   `advanced.useSecureCookies` to the same https test — otherwise Better Auth would keep the
   `__Secure-` name prefix on an http deployment and browsers would ignore the cookie outright.
3. `createAuthOptions({ appUrl, secret })` is exported so a test can build the identical
   configuration against an https URL without reloading the module graph. Production boots
   `betterAuth(createAuthOptions({ appUrl: env.APP_URL, secret: env.BETTER_AUTH_SECRET }))`; there is
   no second code path that can drift.
4. Verification is two-layered: `tests/unit/lib/cookie-attributes.test.ts` pins the mapping
   (https/http/loopback/port/path/garbage), and `tests/integration/auth-cookie.test.ts` drives a real
   Better Auth sign-up through the real Hono app (http → `SameSite=Lax`, no `Secure`) and through an
   https-configured instance (`__Secure-` prefix + `SameSite=None; Secure`), asserting the emitted
   `Set-Cookie` rather than the option object.

`TRUSTED_ORIGINS` is deliberately unchanged: the cookie attributes and CORS are separate gates, and
the desktop origin was already trusted there.

## Consequences

* Gained: the desktop and web clients share one session model. No renderer-side workaround, no
  proxy, no per-client auth. The decision is unit-testable because it is a pure function of one
  input.
* Accepted: an http deployment keeps `SameSite=Lax`, so a desktop client pointing at a plain-http
  API still fails. That is the intended failure mode — `SameSite=None` there would be dropped by the
  browser and produce a 401 that looks like a server bug.
* Accepted: **third-party-cookie blocking is a residual risk.** Safari (ITP) and Chrome's
  third-party-cookie restrictions can drop `SameSite=None` cookies set in a cross-site context
  regardless of attributes. If that happens, the symptom is DevTools showing no `Cookie` request
  header while `Application → Cookies` shows the cookie as blocked.
* **Fallback (documented, not enabled):** proxy `/api/*` from the shell's loopback origin
  (`electron/server.ts`) so the renderer becomes same-origin with the API. `serverAddress.ts`
  already supports a `${origin}/api` same-origin base. Trigger it only when the DevTools evidence
  above is reproduced on a shipping OS version; adopting it unconditionally would trade a cookie
  attribute for a streaming proxy.
* Accepted: `localhost` over http can never be `SameSite=None; Secure`, so local desktop↔local API
  development uses `Lax` and relies on the fact that both are loopback (same-site, different port).
