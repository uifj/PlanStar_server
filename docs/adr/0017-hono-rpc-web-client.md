# 0017. Use Hono typed HTTP RPC for the Web client

Status: accepted
Date: 2026-10-16
Implementation: pending; staged delivery in the approved migration plan, not a completed migration.

## Context

`front_web/src` has replaced the custom REST frontend with the actual Anytype-style
client, including its MobX stores and SCSS shell. Its business commands still target
an absent anytype-heart gRPC-web service; showing the authentication selector does not
prove backend connectivity. The existing backend is already Node/Hono with Better Auth.
The user chose self-hosted Web equivalents, not compatibility with the Anytype network.

## Decision

Use Hono resource-grouped HTTP routes and `hc` for business requests. Preserve existing
`/api` URLs, OpenAPI/Zod validation and REST callers. Chain and return `.openapi()` and
`.route()` registrations through every module so inputs and status-specific responses
remain inferable; do not introduce an untyped `POST /rpc { method, payload }` dispatcher.

A separate browser-safe `packages/api-client/` will package server route declarations;
its runtime depends only on `hono/client`, not Prisma, environment loading or auth
instances. Do not duplicate hand-written DTOs. Keep Hono versions compatible and prove
the backend TS7 declarations can be consumed by the TS5.9 frontend. Frontend and backend
retain independent installs, builds and tests (amended [0010](0010-front-web-own-test-rig.md));
the new client and transport get strict type checks without rewriting all upstream code.

Retain the current Anytype shell, MobX, views, properties and chat UI. Hand-written
transport/domain adapters will translate existing command/Response/Mapper conventions
at the client boundary while commands migrate behaviour by behaviour; generated gRPC
files are not the editing surface. Preserve response/event/callback ordering and dedupe
as specified in [0019](0019-authorised-subscription-events.md). Tiptap replaces the body
only ([0018](0018-collaborative-document-source.md)), not the surrounding interface.

Use the existing Better Auth accounts and server sessions for registration, login,
logout and restoration, replacing mnemonic/wallet onboarding rather than simulating a
wallet. Prefer same-origin HttpOnly cookies, protect HTTP mutations against Origin/CSRF
attacks, and do not store authentication secrets in localStorage. Hocuspocus WebSocket
carries Yjs; Hono SSE carries non-body events. Hono HTTP is not a Yjs binary protocol.
The existing Node backend serves these channels and file resources; no gRPC bridge,
anytype-heart deployment or any-sync interoperability is part of the decision.

## Consequences

Cloud features need real self-hosted equivalents; desktop-only actions need a Web
replacement or an explicit not-applicable outcome, never a success stub. A traceable
feature matrix must map every old command to its replacement and acceptance status.
The first login/edit/sync loop is only a milestone; old transport is removed only after
its callers are migrated. Type-negative tests, browser bundle isolation, real Better
Auth sessions and browser acceptance remain implementation gates, not claims made here.

This supersedes the custom UI implementation prescriptions in
[0014](0014-three-column-workspace-shell.md), [0015](0015-object-opens-as-a-page.md) and
[0016](0016-type-scale-follows-anytype-by-role.md), retaining their navigation, page and
role-based styling intent in the current shell. ADRs 0002, 0004–0008 and 0011 remain in
force: the object kernel, membership checks, legacy VanLife compatibility and agent
service boundary are not replaced by a transport migration.
