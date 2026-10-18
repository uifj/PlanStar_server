# 0020. Run the shell's existing command surface on a client-first command shim during migration

Status: accepted
Date: 2026-10-16
Implementation: staged; the shim and the first working boot slice are implemented, the typed-route end state is not.
Amends: [0017](0017-hono-rpc-web-client.md) for the migration phase only; 0017's typed-route end state remains the target.

## Context

[0017](0017-hono-rpc-web-client.md) prescribes Hono resource-grouped typed routes consumed
through `hc`, and forbids an untyped `POST /rpc { method, payload }` dispatcher. The vendored
Anytype-style shell in `front_web/src` still drives every business action through its own
command dispatcher with proto-shaped request/Response/Mapper conventions; migrating each
command to a typed route would require rewriting every caller before any slice can boot.
The migration baseline has no working end-to-end slice at all, so an authentication screen
is not evidence of backend integration.

The shell also stores a desktop `accountId` that the Web build must ignore, and the Prisma
`ObjectLayout` enum cannot represent the numeric Anytype layouts (page, note, set, …) that
system objects carry.

## Decision

During the migration phase, run the shell's existing command surface on a client-first
command shim: one session-protected `POST /api/command/:name` endpoint whose path carries
the vendored command name and whose body is that command's request fields, returning the
proto-shaped envelope the shell's Response/Mapper conventions expect. This amends 0017's
typed-route prescription for the shell's pre-existing command surface only; new business
endpoints and the eventual end state still follow 0017 (typed routes via `hc`, no untyped
dispatcher). The shim is a transport adapter, not a new RPC protocol: it preserves the
vendored dispatcher/Response/Mapper untouched so commands migrate behaviour by behaviour.

Store system objects as `Obj` rows with `resolvedLayout` set to the enum's basic value and
the true numeric Anytype layout carried in the details JSON, until the Prisma enum is
extended to represent page/note/set layouts. Do not fake numeric layouts into the enum.

Boot the Web build lean: authenticate against the existing Better Auth session and run the
minimal AccountSelect → WorkspaceOpen → space/object subscriptions → `/main/void/empty`
sequence, ignoring any stale desktop `accountId` storage. A working boot into a real empty
space is the migration's first acceptance gate.

## Consequences

The shim is a deliberate, contained deviation from 0017 that must be removed once its
callers are migrated; it is not the transport end state. Because the shim answers command
names with permissive bodies, its request validation is weaker than 0017's typed routes and
needs hardening or replacement as callers migrate. The deferred layout enum means numeric
Anytype layouts are not yet queryable through `resolvedLayout`; consumers must read the
details JSON until the enum is extended. The lean boot proves connectivity but not editing;
object create/open and Tiptap body editing remain separate slices. ADRs 0002, 0004–0008,
0011 and 0018–0019 remain in force; this record amends only 0017's migration-phase transport.
