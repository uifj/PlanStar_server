# 0010. Give front_web its own test rig instead of joining the workspace

Status: accepted - independent boundaries retained; configuration prescriptions amended
Date: 2026-10-13

## Context

The client has no test tooling at all: no test script, no vitest, no testing library, zero test files. It is also not a member of the root pnpm workspace, so pnpm install at the root silently does nothing for it.

## Decision

Add vitest, jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom and msw to front_web, with front_web/vitest.config.ts extending the existing Vite config so the @ alias and Tailwind plugin are inherited, plus test and test:watch scripts. Dependencies stay installed with pnpm install --ignore-workspace.

## Consequences

There are two installs and two gates to run locally, and nothing enforces either because the repository has no working CI. Making the client a workspace member would unify installs but would also merge lockfiles and change how the API image is built, which is a larger and separately reversible decision.

## Amendment, 2026-10-16 — retain the boundary, replace configuration assumptions

Independent frontend/backend installation, builds and tests remain the decision. The
no-tests/no-CI inventory, Tailwind plugin, `@` alias and Vite/Vitest inheritance recipe
above describe the replaced custom frontend; they are not assertions about the current
Anytype client or prescriptions to restore its predecessor's configuration.

[0017](0017-hono-rpc-web-client.md) adds a separately built browser-safe API client and
strict transport/type tests, including backend TS7 declarations consumed by frontend
TS5.9. The staged gates are root `pnpm check`/`pnpm build`, frontend `pnpm typecheck`,
`pnpm test` and `pnpm build`, plus the client package's strict type/build checks. Adapt
test configuration to the current client rather than inheriting stale settings; do not
merge installations or lockfiles merely to share route types. Actual Better Auth cookie
sessions, Node WS/SSE listeners and multi-browser acceptance complement isolated tests.
This amendment records required work, not a claim that the new rigs or gates are already
implemented or passing; no configuration changes are made by this documentation update.
