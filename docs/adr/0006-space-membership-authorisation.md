# 0006. Authorise data by space membership, not by platform role

Status: accepted
Date: 2026-10-13

## Context

The current model is a single comma-joined string on user.role with host and user values, plus a Better Auth admin plugin whose access-control statement is about vans. Anytype scopes everything to a space with per-space permissions (Reader/Writer/Owner/Admin).

## Decision

Add Space and SpaceMember(spaceId, userId, permission) with the rank order reader < writer < admin < owner. A new src/auth/space-access.ts exposes ensureSpaceAccess(userId, spaceId, min) and is called from services only, per the existing rule that ownership checks live in services. user.role keeps meaning only for admin; the access-control statement changes from van to object/space.

## Consequences

Requests for objects in a space the caller is not a member of return 404 rather than 403, so existence is not leaked across tenants. During the transition the old host/user routes keep working off the legacy role while new routes use membership, so the two systems coexist and must not be conflated in new code. Per-space invites and join requests are not in this slice.
