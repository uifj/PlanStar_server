# 0005. Project registry rows into the object table

Status: accepted
Date: 2026-10-13

## Context

Relations and types are themselves objects in Anytype (layout Relation, type.uniqueKey ot-relation), which is what lets a client list them with the same query it uses for everything else. Our registries are ordinary tables (0002).

## Decision

Relation and ObjectType stay authoritative for their own metadata. Each registry write also upserts a mirror row in Obj carrying the display fields, so GET /objects can list types and relations without a union query.

## Consequences

A second copy of some data exists, so drift is possible; the mirror is written only from the registry services and is read-only everywhere else. The alternative, storing registry entries purely as Obj rows with JSONB-queried metadata, was rejected as slower and as losing the unique constraints that keep keys sane per space.
