# 0019. Feed MobX with authorised subscription events

Status: accepted
Date: 2026-10-16
Implementation: pending; snapshot/replay, revocation and collaboration acceptance are staged work.

## Context

[0009](0009-object-cache-beside-query.md) proposed a normalised cache beside TanStack
Query but was never implemented. The replacement frontend already uses MobX and expects
push updates. HTTP responses alone cannot keep query windows, counts and object details
consistent across clients; authorising a connection only once also leaves revoked users
able to receive data.

## Decision

Keep MobX as the client projection of server object details and query membership; do not
add TanStack Query or another normalised object cache. Use Hono SSE for non-body
subscriptions and Hocuspocus WebSocket for body/awareness traffic
([0017](0017-hono-rpc-web-client.md), [0018](0018-collaborative-document-source.md)).
Do not replay body content over SSE into the editor as a second update path.

A subscription starts with an authorised snapshot and a consistent watermark, then
receives detail deltas and list additions, removals, positions and counts. Establishing
the subscription must not lose changes between snapshot and live delivery. Persist
cursor/eventId for deduplication and reconnect replay; an expired replay window explicitly
requires a fresh snapshot. Apply events in sequence, detect gaps and recover rather than
silently accepting an incomplete projection. Preserve command response/event/callback
ordering and correlate response-applied changes with stream event IDs/revisions so one
mutation is not applied twice.

Commit object, relation-edge, registry-mirror changes and their outbox records in the
same repository transaction, with explicit batch atomicity. Deliver committed events
with retry/deduplication, not a promise of exactly-once networking. Old REST callers use
the same services and write sequence. VanLife legacy write authority, overlapping-booking
transactions and mirror behaviour remain intact.

HTTP, SSE, WS and private file access derive identity from the existing Better Auth
session and resolve real object/space membership; a client-supplied spaceId or document
name is not permission. Authorise both the SSE connection and every subscription,
snapshot and replay against current access. Removal, downgrade, logout and expiry stop
unauthorised delivery and invalidate affected client state, not just the next page load.
WS handshake checks session and Origin and maps the document name to its actual owner.
Enforce reader-only access even if the first Yjs sync frame carries an update. Revocation
must close affected connections and prevent later updates or awareness disclosure.

Validate message size/rate, document size, node schema and references on the server;
hiding editor actions is not write protection. Document offline state and pending
updates use account-isolated IndexedDB/Yjs storage. Reauthorise before uploading on
reconnect; clear local caches on logout. Refused offline edits stay visibly rejected or
may be explicitly exported, never silently copied into another space. Already downloaded
content cannot be guaranteed remotely erased. Metadata, chats, membership and external
tasks initially require online access rather than borrowing the document CRDT queue.

## Consequences

This supersedes 0009's unimplemented two-cache proposal; MobX stores are projections,
not a second server authority. Durable event logging, snapshot boundaries, replay expiry
and active revocation are new work. Tests must use real Better Auth sessions and actual
Node SSE/WS connections with two writers, a reader and an unauthorised account, covering
duplicates, gaps, reconnect, replay permissions, handshake writes, expiry and revocation.
Mocked sessions or a successful HTTP endpoint alone do not establish acceptance.
