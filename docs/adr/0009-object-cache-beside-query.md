# 0009. Run a normalised object cache beside TanStack Query

Status: superseded-by-0019; this proposal was never implemented
Date: 2026-10-13

## Context

TanStack Query fits lists, pagination and view queries well, but Anytype's Detail store is a per-relation cache shared by the property panel, backlinks, chat and every view that shows the same object. Re-fetching per consumer would duplicate identical objects across query keys.

## Decision

Query owns collections keyed by space, view and a hash of page plus filters. A small ObjectCacheStore, a nested Map exposed through useSyncExternalStore, owns object truth keyed by space and object id. A successful PATCH /objects/:id writes into the store and invalidates only the dataview prefix for that space, because view queries return ids rather than embedded objects.

## Consequences

Two caches must be kept consistent, which is the price of not having Anytype's push events; the rule is that views read through the store and never render from their own copy. Blocks and chat messages are deliberately excluded and stay windowed inside their hooks.

## Status note, after phase 9 review

**Not implemented.** No `ObjectCacheStore` and no `useSyncExternalStore` exist anywhere in
`src` or `front_web/src`. What shipped instead is one-sided: every write calls
`invalidateQueries({ queryKey: objectQueryKeys.all })`
(`front_web/src/modules/spaces/hooks/useObjectActions.ts`), so a single
value saved re-fetches every object list, view record set and object detail that is mounted -
which is correct but coarse, and it is why the context panel and the browser both flash after
a blur-commit.

One premise of the decision is also wrong for this kernel as built. The record list does not
return ids: `GET /spaces/{spaceId}/dataviews/{dataviewId}/records` answers whole objects
(`ViewRecordsResponse.data: ObjectDetail[]`, ADR-0012), so a store keyed by object id would
not invalidate a view on its own - either the view has to read through the store, or the
records route has to change to return ids plus a batch read by id (the same missing kernel
read that keeps `GET /bookings` on the legacy tables, ADR-0008).

Implementing this remains open work, and it is a decision to revisit with that batch read
rather than an implementation detail: the cheapest honest ordering is batch-read-by-id first,
then the store, then narrowing the invalidation to the space prefix.

## Amendment, 2026-10-16 — superseded before implementation

The phase 9 note above describes the replaced custom frontend and its then-open work;
its file paths and cache behaviour are historical, not assertions about the current
Anytype client. [0019](0019-authorised-subscription-events.md) supersedes this proposal:
retain the current MobX stores, fed by authorised Hono SSE snapshots, deltas and replay.
Do not implement the proposed TanStack Query/ObjectCacheStore pair or add a new TanStack
cache. Subscription delivery and its acceptance tests are pending staged implementation;
the presence of MobX alone does not mean the server event channel is connected.
