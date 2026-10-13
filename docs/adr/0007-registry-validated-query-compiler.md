# 0007. Compile filters to raw SQL validated against the relation registry

Status: accepted
Date: 2026-10-13

## Context

The filter language Anytype clients send (17 conditions, And/Or, nested filters, per-format allowed operators) cannot be expressed type-safely against a JSONB column in Prisma, and relation keys arrive from the client.

## Decision

A pure function in src/modules/objects/filters.ts turns filter and sort arrays into where, params and orderBy. Every relation key must resolve in the space's registry or the request is rejected with 422; every condition must be in the operator whitelist for that relation's format; values are always bound parameters and cast by format (numeric, timestamptz, containment, array overlap). Keys never become SQL identifiers.

## Consequences

docs/conventions.md is amended: prisma.$queryRaw is permitted, but only inside a module's repository.ts. The injection defence is registry validation plus parameter binding, so a new relation format or operator without a mapping is a visible gap rather than a silent string interpolation. The compiler is unit-testable without a database.
