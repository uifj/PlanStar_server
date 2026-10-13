# 0008. Demote VanLife to a generated type behind compatibility shims

Status: accepted
Date: 2026-10-13

## Context

Van, Booking and Review are fixed tables with four modules and 88 tests of behavioural coverage. The target product is object-centric, so keeping them as the organising concept would fork the domain model in two.

## Decision

A generator maps each legacy model to an ObjectType plus Relation rows (Van to ot-van, amenities to a multi-select, the type enum to a select), a data migration copies rows into Obj/Link, and the existing vans/bookings/reviews/host routers become thin shims over the object core while keeping their paths and payloads. The legacy tables are dropped only after the shims are removed.

## Consequences

The schema carries both shapes for a while, which is deliberate: the 26 integration tests and the frontend keep passing at every step, so a regression stays attributable. The cost is a temporary double surface and a deadline nobody will enforce, so the drop step is tracked as its own phase rather than left as a comment.
