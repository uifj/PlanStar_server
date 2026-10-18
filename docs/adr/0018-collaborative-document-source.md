# 0018. Make the collaborative document the sole body source

Status: accepted
Date: 2026-10-16
Implementation: pending; staged rollout and legacy body migration are not yet accepted as complete.

## Context

[0003](0003-fractional-ordering-last-write-wins.md) assumed a single active document
writer; [0013](0013-documents-are-ordered-blocks.md) made Block rows authoritative.
Those assumptions cannot support the chosen multi-user Tiptap/Hocuspocus editor without
two writers overwriting the same body. Object metadata still belongs in PostgreSQL.

## Decision

One object has one Ydoc. Its Tiptap document structure is the sole authoritative body,
synchronised by Yjs through Hocuspocus in the existing Node service. Block rows, body
links and search text become rebuildable projections tagged with document revision,
not independent write sources. Projection lag must be observable. Metadata, registry,
view configuration, members, chats and file metadata remain PostgreSQL Obj/details +
Link data; do not move them into a general-purpose Ydoc.

Persist Yjs binary snapshots, schemaVersion and sequenced incremental updates with a
recoverable compaction watermark. Never reconstruct a fresh Ydoc from JSON on every
save. Provider `synced` or an empty outbound queue is not a database commit: use update
batch identifiers and a database commit watermark for a separate durable acknowledgement,
including deletion updates, not just state-vector comparison. The UI distinguishes
unsynchronised, synchronised-but-not-durable, saved and failed. Failed persistence must
not acknowledge success; retry idempotently or isolate the document and recover from
committed state before later snapshots. Every acknowledged update must survive restart.
Hook ordering and acknowledgement behaviour must be verified against locked compatible
Hocuspocus/Tiptap/Yjs versions before implementation is accepted.

Every body writer uses the shared document service and Hocuspocus direct connection to
the same active document lifecycle, including unopened documents: editor transactions,
templates, import, AI, history restore and legacy Block REST writes. No detached copy
may replace the whole active document. Replace old body save, drag, paste and undo paths;
use collaborative body history, without duplicate StarterKit history or metadata undo.
Keep headers, covers, properties, comments and Set/Chat surfaces in the existing shell.
Stable node IDs and marks must survive copying, migration and concurrent edits so links,
comment anchors and history remain addressable.

Migrate each old Block tree once, idempotently, retaining original rows/export evidence
and checking hierarchy, order, marks and links. Unsupported content is reported, never
truncated and called migrated. On cutover disable the old authoritative writer; legacy
routes must use the document service, not dual-write. Embedded views contain stable
references only; their Obj configuration remains authoritative (amended
[0012](0012-saved-view-is-an-object.md)).

Fractional indexes remain for non-body ordering. Metadata uses revision/CAS and server
add/set/remove operations with explicit 409 conflicts, not unconditional whole-details
last-write-wins; legacy REST must enter the same service/write sequence. Metadata and
outbox writes share repository transactions ([0019](0019-authorised-subscription-events.md)).
Combined metadata/body operations use explicit idempotent, recoverable steps; a database
transaction cannot atomically enclose an in-memory WebSocket document.

## Consequences

This supersedes 0003's body single-writer/last-write-wins assumption and 0013's Block
write authority, not non-body fractional ordering or the object kernel. Body migration,
rich nodes and all writers must be verified before the old source is retired. Start
with one Node instance owning active documents, draining connections and persistence
queues on shutdown. Multiple replicas require room ownership, fencing and cross-node
event distribution; adding Redis alone is not sufficient. Authorisation and offline
boundaries are defined in 0019. Multi-writer, reader, failure/restart and repeat-migration
tests remain required; this record does not claim collaborative editing is implemented.
