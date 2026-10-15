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

## Amendment, after phase 6 — superseded by the phase 7 amendment

The space browser first rendered a view as a table, gallery, board or calendar with the
choice held in the URL alone: a saved view persisted only its source type, filters and
sorts. Phase 7 moved the choice onto the view; what follows is kept as the reasoning it
was replaced by, and the client-side grouping it describes is still how the renderings
are built.

Grouping was client-side: a board grouped by a select relation's values and a calendar by
a date relation's month, both computed from the page of objects the view already returned.
`matched`/`total` still described the whole set, so a board could read "3 of 9 simple"
while only the first page's cards were visible.

## Amendment, after phase 7

The layout is stored on the view. A saved view persists `viewType` (grid, gallery, board,
calendar) and the two relations that layout reads (`coverRelationKey`,
`groupRelationKey`) in its own `details`, and `PATCH /spaces/{spaceId}/dataviews/{id}`
writes them, so applying a view decides what the visitor sees instead of the address bar.
Saving a view carries the layout that is on screen at the time, so nothing is configured
twice.

Two rules follow from where the check lives:

- These keys are not relations, so the generic object write cannot take them -
  `normalizeDetails` refuses a key the registry does not know (0002). The dataview service
  checks them itself against the view's source type: a requested cover or group must be a
  relation that type carries, and a requested group must be one the layout can bucket
  (board: select or multiSelect, calendar: date). A layout no build can draw - `graph` -
  stays refused at the route.
- Only what the request names can be refused. Moving a grouped board to a gallery keeps a
  grouping key the gallery ignores, and moving it to a layout that buckets another format
  drops the key rather than turning the switch away, which is what the reference app does
  by re-picking a group option. A client that asked for the switch reads the layout back
  off the answer instead of keeping what it sent.

A view's record list now excludes archived objects in both passes, so its counters and the
browser's unsaved list of the same type agree; the kernel still lists archived objects to
any caller who asks (0007).
