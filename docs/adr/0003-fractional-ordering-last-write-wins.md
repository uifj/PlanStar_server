# 0003. Order by fractional string indexes with last-write-wins

Status: superseded-by-0018 for body authority and concurrency; non-body fractional ordering retained
Date: 2026-10-13

## Context

Anytype's ordering fields (orderId, customOrder, spaceOrder) are CRDT derivatives produced by the Go middleware. Our server is PostgreSQL with no merge layer, and the plan is a web-first port.

## Decision

Ordering is a fractional string on Block.index, Link.sortOrder and ObjectType.orderId. Writes are last-write-wins. We assume a single active writer per space for a given document.

## Consequences

Two clients reordering the same list concurrently will overwrite each other rather than merge, and no tombstone history exists for ordering. If collaborative editing becomes a requirement, add a version column to Obj with optimistic concurrency (409 on mismatch) and supersede this record. Gap-based labels keep reordering cheap because siblings are not renumbered.

## Amendment, 2026-10-16 — collaborative bodies and metadata conflicts

The paragraphs above record the original single-writer model, not the new collaboration
contract. [0018](0018-collaborative-document-source.md) supersedes body last-write-wins
and the single-active-writer assumption: the Tiptap/Yjs document is authoritative, and
`Block.index` is only a possible projection of body order. Fractional indexes remain for
non-body ordering, including `Link.sortOrder` and `ObjectType.orderId`. Metadata stays
in PostgreSQL, but writes use revision/CAS and server add/set/remove operations with
409 conflicts rather than unconditional whole-details last-write-wins. These are accepted
decisions with staged implementation pending, not a claim that existing writes have
already gained those guarantees.
