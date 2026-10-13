# 0004. Represent every relation value as an array

Status: accepted
Date: 2026-10-13

## Context

In Anytype, select, multi-select, file and object values are homogeneous arrays of opaque ids even when the relation holds a single value, and maxCount truncates them (lib/relation.ts:374-422, 838-849).

## Decision

The storage format and the public API keep array cardinality for those formats. A single-select relation still yields a one-element array, and maxCount is enforced in the service layer by truncating.

## Consequences

Clients must not assume a scalar for single-valued relations, which is mildly awkward in the UI. The gain is that one code path serves both cardinalities, maxCount becomes a pure data change, and a future Anytype-shaped client or import maps onto us without a conversion layer.
