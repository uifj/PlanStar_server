# 0021. Keep the pre-pivot REST API mounted and mark the operations the shim superseded

Status: accepted
Date: 2026-10-18
Amends: [0020](0020-client-first-command-shim-transport.md) — the shim is now the shell's only
transport, which leaves 0017's typed routes with no client.

## Context

The interface audit (`docs/interface-audit.md`) diffed the routes registered in `src/routes/index.ts`
against what `front_web` actually reaches. The client calls exactly six HTTP surfaces:
`POST /api/command/<Name>`, `GET /api/events`, `GET|POST /api/spaces` (its auth bootstrap),
`POST /api/web-upload`, `/api/auth/*` and the gateway file/image URLs, plus `ws://…/collab`.

Everything else the repo grew before the object-kernel pivot — `/api/objects`, `/api/blocks`,
`/api/dataviews`, `/api/relations`, `/api/object-types`, `/api/me`, `/api/vans`, `/api/bookings`,
`/api/reviews`, `/api/host`, `/api/publish`'s management routes — has no caller. Deleting them would
pass the deletion test cleanly: no complexity reappears anywhere, because the shim already answers
the same behaviour.

But those routes are the harness's own published API, they carry their own integration coverage, and
they are the deliverables of phases 2–7. Removing them destroys tested surface for a tidiness win,
and a future reader cannot tell "unused by the bundled client" from "broken".

## Decision

Keep every REST router mounted. Mark the operations the command shim superseded as `deprecated` in
the OpenAPI document, by a path-prefix transform applied when the document is generated
(`src/openapi/deprecations.ts`, wired in `src/app.ts`).

`GET /api/spaces` and `POST /api/spaces` stay unmarked because the client does call them; only their
object-core sub-paths (`/api/spaces/{spaceId}/…`) are superseded. `/api/agent/*` and the `/api/ai`
protocol mount stay unmarked too: nothing supersedes the trip-planner agent, it simply has no caller
in this client, which is a different statement from "deprecated".

## Consequences

* The document is built through `app.getOpenAPIDocument(...)` + transform instead of `app.doc(...)`,
  because the generator exposes no per-operation hook.
* 36 documented operations now read `deprecated`; the live surface reads 7.
* The deprecation is asserted against the real route table in `tests/unit/openapi/deprecations.test.ts`
  — the document route itself is development-only, so an HTTP assertion would be skipped by the gate.
* Deleting these routes stays available later; the marks make the remaining question ("does anything
  still call this?") answerable from the document alone.
