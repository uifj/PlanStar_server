# 0009. Run a normalised object cache beside TanStack Query

Status: accepted
Date: 2026-10-13

## Context

TanStack Query fits lists, pagination and view queries well, but Anytype's Detail store is a per-relation cache shared by the property panel, backlinks, chat and every view that shows the same object. Re-fetching per consumer would duplicate identical objects across query keys.

## Decision

Query owns collections keyed by space, view and a hash of page plus filters. A small ObjectCacheStore, a nested Map exposed through useSyncExternalStore, owns object truth keyed by space and object id. A successful PATCH /objects/:id writes into the store and invalidates only the dataview prefix for that space, because view queries return ids rather than embedded objects.

## Consequences

Two caches must be kept consistent, which is the price of not having Anytype's push events; the rule is that views read through the store and never render from their own copy. Blocks and chat messages are deliberately excluded and stay windowed inside their hooks.
