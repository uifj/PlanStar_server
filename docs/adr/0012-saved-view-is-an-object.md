# 0012. A saved view is an object

Status: accepted
Date: 2026-10-14

## Context

A grid view needs somewhere to keep its source type, its filter and sort clauses and
its default layout. Anytype keeps that in a `dataview` block inside the object that
shows the set, and we have no blocks yet (phase 3). The other option was a dedicated
Dataview table with typed columns for `viewType`, `filtersJson` and `sortsJson`, which
would make the configuration queryable without JSONB and let Postgres check the shape.

## Decision

A view is an Obj with `resolvedLayout = "dataview"`. Its configuration lives in the
same open `details` map as any other object, under reserved keys (`sourceTypeKey`,
`viewType`, `dataviewFilters`, `dataviewSorts`) that the dataview service validates with
a Zod schema at its own boundary. The view's source is a Link edge with relation key
`setSource`, which is how the object core already stores object-valued relations
(0002). Listing views therefore reuses `GET /spaces/{spaceId}/objects?layout=dataview`
(0005) and running one reuses the filter compiler (0007) unchanged. A view's record
list answers with two counters, `matched` and `total`, rather than per-relation groups.

## Consequences

The configuration is not checked by the database, so a hand-edited row can hold a
relation key the space no longer registers; reading such a view fails with a 422 at the
compiler instead of being caught earlier. Unlike a registry row (0005) there is no
second authoritative table here, so the Obj row is the truth and nothing can drift from
it. `ObjectLayout` grows a fourth value, which means an enum migration before any view
can be written. Per-relation counters for the view sidebar are deferred, and the two
numbers do not tell a client which values are missing from a filtered set.
