# 0008. Demote VanLife to a generated type behind compatibility shims

Status: accepted
Date: 2026-10-13
Amended: 2026-10-14 (what phase 4 actually found and settled)

## Context

Van, Booking and Review are fixed tables with four modules and 88 tests of behavioural coverage. The target product is object-centric, so keeping them as the organising concept would fork the domain model in two.

## Decision

A generator maps each legacy model to an ObjectType plus Relation rows (Van to ot-van, amenities to a multi-select, the type enum to a select), a data migration copies rows into Obj/Link, and the existing vans/bookings/reviews/host routers become thin shims over the object core while keeping their paths and payloads. The legacy tables are dropped only after the shims are removed.

## Consequences

The schema carries both shapes for a while, which is deliberate: the 26 integration tests and the frontend keep passing at every step, so a regression stays attributable. The cost is a temporary double surface and a deadline nobody will enforce, so the drop step is tracked as its own phase rather than left as a comment.

---

## Amendment, after phase 4

Three things this record assumed turned out to be false, and one decision it left open had to be made.

**There were no tests to keep green.** Not 26 and not 88. No test file in this repository's history has ever requested `/vans`, `/bookings`, `/reviews` or `/host`, and no unit test covered `vanService`, `bookingService`, `reviewService` or `hostService`. The only VanLife-domain coverage was six mock-based agent tool tests asserting `prismaMock.van.*` call shapes. The safety net the plan depended on did not exist, so phase 4 began by writing it: 45 route-level tests pinning envelopes, sort orders, error messages and status codes, plus a role-capable session fixture (`isHost`/`isUser` read `user.role`, which the old fixture always stubbed as `null`). Writing that net found a live defect: a second review on the same booking answered 500 because Prisma reports a broken required relation as P2014, which `translatePrismaError` did not map.

**`ot-van` is not a legal key.** The registry pattern is `^[a-z][a-zA-Z0-9]*$`, so the generated types are `van`, `booking` and `review`, and their relations are `price`, `sleeps`, `rating`, `location`, `imageUrl`, `type`, `amenities`, `startDate`, `endDate`, `guests`, `totalPrice`, `status`, `reviewRating`, `reviewText` plus the object relations `van` and `booking`. `name`, `description` and a retired van are not relations at all — the object table already stores them as columns, so the generator must not declare them.

**A shared space cannot rank a renter below a host.** VanLife data has no `spaceId`, and the kernel refuses every read and write without space membership, so the use case owns one fixed shared space (`vanlife-space`) and enrols every signed-in caller in it. Enrolling by role looked correct until the first renter booked a van: their booking is an object, creating one needs writer rank, and a reader cannot create it. Every caller is therefore enrolled as `writer`, an existing member is only ever raised and never lowered. The consequence is worth stating plainly: inside this space the rank no longer distinguishes hosts from renters, so which rows are "yours" is decided per route by `creatorId`, exactly as the legacy `ownedVanWhere` did. Cross-host ids still answer 404 rather than leaking existence (ADR-0006 holds), but a member can read another member's object through the raw object API. Narrowing that is a per-object permission problem, not this phase's.

**Writes keep the legacy tables as their source of truth, and the catalog keeps reading them.** The overlap check runs in a `Serializable` transaction with a P2034 retry, and one-review-per-booking is a unique index; `details` JSONB offers neither, so moving the write would have traded a real guarantee for an application-level check. Instead every mutation projects the committed row into Obj/Link under the same id, which is what lets the old routes answer for objects they never wrote. Reads split: `GET /vans` and `GET /vans/:id` stay on the tables because that catalog has always been anonymous and ADR-0006 cannot express an unauthenticated read; `GET /host/vans` and its detail route read objects and are proven to do so by editing an object through the kernel and watching the desk answer differently from the table. `GET /bookings` stayed on the tables because its payload embeds each van and review, which needs a batch read by id and a filter over object-valued relations - neither exists in the kernel yet.

**Still open.** Running `backfillVanLife` against a live database (it is built and tested, but a deployment must invoke it), the aggregate routes, `GET /bookings`, and the eventual drop of the legacy tables.
