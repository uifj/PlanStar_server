# 0003. Order by fractional string indexes with last-write-wins

Status: accepted
Date: 2026-10-13

## Context

Anytype's ordering fields (orderId, customOrder, spaceOrder) are CRDT derivatives produced by the Go middleware. Our server is PostgreSQL with no merge layer, and the plan is a web-first port.

## Decision

Ordering is a fractional string on Block.index, Link.sortOrder and ObjectType.orderId. Writes are last-write-wins. We assume a single active writer per space for a given document.

## Consequences

Two clients reordering the same list concurrently will overwrite each other rather than merge, and no tombstone history exists for ordering. If collaborative editing becomes a requirement, add a version column to Obj with optimistic concurrency (409 on mismatch) and supersede this record. Gap-based labels keep reordering cheap because siblings are not renumbered.
