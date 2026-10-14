# 0011. Keep agent tools on services and scope chats to a space

Status: accepted
Date: 2026-10-13

## Context

src/modules/agent/tools.ts currently reaches into Prisma directly for van and booking reads, which breaks the repository rule and will not survive the object core. The Genkit setup itself is deliberate: beta instance, provider chosen by AGENT_MODEL, Prisma-backed session store, and offline tests driven by mockModel.

## Decision

Agent tools become thin wrappers over the same service functions the HTTP routes expose, so a tool and an endpoint cannot disagree. AgentChat gains spaceId, and the service asserts membership before each turn. Provider selection, the session store and the offline mock-model tests stay unchanged.

## Consequences

Tools inherit the service layer's validation and authorisation instead of duplicating them, and the offline tests keep running without an API key. The direct Prisma access in the current tools is fixed as part of this migration rather than left as a known wart.

---

## Amendment, after phase 5

Landed on 2026-10-14, with one mechanism replaced because the library forbids it.

**Session-state injection is not available to a stored agent.** `@genkit-ai/ai` 1.42 rejects it outright — `assertInitMatchesStateManagement` throws `FAILED_PRECONDITION` on `init.state && config.store`, and setting `stateManagement: "client"` does not lift it. Our trip planner keeps its `PrismaAgentChatStore` because "restore an earlier turn from the database in a later request" is a tested behaviour, so the actor cannot travel in from the caller. It is resolved from the conversation row instead: `agentSessionService.findSession(sessionId)` returns the `{ actor, spaceId }` the tools ask services with. Identity still never comes from the model — a tool that is handed `{ userId: "somebody else" }` reads the conversation owner regardless.

**`AgentChat.spaceId` is written at creation and read on every later turn**, so a conversation stays in the space it began in; rows that predate the column fall back to the caller's resolved space, which also enrols them. Ordering matters: the ownership checks run before the space is resolved, otherwise an unknown chat id answers 500 on a foreign-key violation instead of 404.

**What the three tools now call.** `searchVans` → `vanLifeService.searchListedVans` (object core, cheapest first, `location` as `like` and `maxPrice` as `lessOrEqual` — the budget filter the raw query had and the legacy `vanService` query string cannot express); `checkAvailability` → `vanLifeService.findListedVan` plus `bookingService.findConflictingBooking`; `myUpcomingTrips` → `bookingService.findUpcoming`. The overlap predicate is shared (`buildOverlapWhere`) between the advisory read and the transaction that enforces it, so the planner cannot promise dates the write will reject.

**Consequences nobody chose.** `findUpcoming` keeps the renter guard, and the trip planner is a renter's surface in the client already (nav and route both require `role === "user"`), so a host calling `POST /api/agent/trip-planner/messages` directly now gets a tool failure where it previously got someone's bookings. The four tool tests that asserted `prismaMock.van.*` call shapes were rewritten against the services; `tests/helpers/fixtures/vans.ts` became dead and was removed. The `/api/ai/*` Genkit protocol mount shares the same agent, so it inherits the conversation-row lookup — and it still has no consumer in `front_web`, so that path is verified only by its own route tests.
