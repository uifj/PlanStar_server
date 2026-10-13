# 0002. Store objects with a hybrid JSONB plus link-table model

Status: accepted
Date: 2026-10-13

## Context

Anytype keeps an object's data as an open map of relation keys to values (store/detail.ts nests a map of maps of maps), and per-space relations are user-defined, so the set of columns is not known ahead of time. Three shapes were on the table: JSONB only, full EAV with one row per value, or a hybrid.

## Decision

One Obj table holds identity, the materialised layout/resolvedLayout, the common text fields, and a details JSONB column for scalar values and option-id arrays, indexed with GIN jsonb_path_ops. Object-valued relations go to a separate Link table (fromId, toId, relationKey, sortOrder) with an index on (toId, relationKey) for backlinks. Relation and ObjectType are registry tables unique per space.

## Consequences

Filtering and sorting over details cannot be expressed in Prisma's typed API and goes through raw SQL (see 0007). Values are not validated by Postgres, only at the service boundary. Full EAV was rejected because Anytype values are arrays even for single select, which would force a join per filter term and make counts fragile; JSONB-only was rejected because object relations would lose referential integrity and backlink indexing.
