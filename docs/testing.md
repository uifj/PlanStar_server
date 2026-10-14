# Testing

This project uses **Vitest** for unit and integration testing.

The testing strategy separates isolated unit tests from database-backed integration tests to provide fast feedback during development while ensuring the application behaves correctly in real-world scenarios.

---

# Test Structure

```text
tests/
├── helpers/
├── integration/
├── mocks/
├── setup.ts
└── unit/
```

## Unit Tests

Unit tests verify individual pieces of functionality in isolation.

Typical candidates include:

* Services
* Repositories (mocked)
* Middleware
* Utilities
* Helpers

Unit tests should not depend on a running database.

Run unit tests:

```bash
pnpm test:unit
```

---

## Integration Tests

Integration tests verify that multiple components work together correctly.

Examples include:

* HTTP endpoints
* Database interaction
* Authentication flow
* OpenAPI endpoints

Integration tests use a real PostgreSQL database.

Integration files run **one at a time** (`fileParallelism: false`). One database backs every file, and some routes list rows globally, so a second worker would change the counts another file asserts. Each file still creates its own rows under an id prefix and deletes them again.

A fixture that publishes a VanLife row for a route reading the object core must publish it **through the route**: inserting into `Van` directly leaves no object behind, the same way an un-backfilled legacy row would.

Run integration tests:

```bash
pnpm test:integration
```

---

# Running All Tests

Run the complete test suite:

```bash
pnpm test:all
```

Generate a coverage report:

```bash
pnpm test:coverage
```

---

# Test Database

Integration tests use a dedicated test database configured through `.env.test`.

This database should be isolated from development and production databases.

Before running integration tests, ensure the PostgreSQL test database is available.

---

# Performance Gate

Object lists filter a JSONB column, so the storage decision in
`docs/adr/0002-hybrid-object-storage.md` carries an explicit budget: a space with
50,000 objects must answer a filtered, sorted, paginated list in under 20ms at p95.

```bash
pnpm perf:objects
```

The gate seeds its own space inside the test database and deletes it again
(`afterAll`), so it never joins `pnpm test:all`: it takes seconds, and a slow
storage decision should be visible rather than flaking the suite. Measured on
2026-10-14 (Podman Postgres 16, macOS arm64, in-process requests):

```text
run 1: 50000 objects per space, p50=13ms p95=15ms, matched=39900
run 2: 50000 objects per space, p50=14ms p95=17ms, matched=39900
```

The budget is met but not by a wide margin, so treat a p95 near 20ms as the signal
to revisit indexing rather than as a pass.

Two things the run does not cover: `@>` containment filters (select and
multi-select relations) are the path that the GIN index serves, and range filters
like the one above fall back to a scan over the space's rows. Re-run the gate with
a select filter before changing either shape. The run also prints a `pg`
deprecation warning about a client queried while busy, which comes from the
adapter during the bulk `createMany` seeding and not from the request path.

---

# Test Helpers

Shared test utilities are located in:

```text
tests/helpers/
```

These helpers reduce duplication and provide reusable setup logic.

Examples include:

* Authentication helpers
* Middleware context helpers
* Prisma error factories
* Shared fixtures

Reuse existing helpers whenever possible instead of duplicating setup code.

---

# Mocking

Unit tests use mocks to isolate dependencies.

Reusable mocks are located in:

```text
tests/mocks/
```

Avoid mocking external libraries directly in multiple test files when a shared mock can be reused.

---

# Writing New Tests

When adding a new feature:

* Add unit tests for business logic.
* Add integration tests for HTTP behavior.
* Reuse existing helpers and fixtures.
* Cover both successful and failure scenarios.

Typical cases include:

* Successful requests
* Validation failures
* Authentication failures
* Authorization failures
* Resource not found
* Conflict errors

Protected route tests should cover:

* Authenticated requests returning success
* Unauthenticated requests returning `401`
* Session lookup failures returning `503`

Authorization tests should cover:

* Renters and hosts receiving access to the routes they own
* Users with the wrong role receiving `403`
* Missing users returning `401`

---

# General Guidelines

* Keep tests independent.
* Keep tests deterministic.
* Prefer clear Arrange–Act–Assert structure.
* Reset mocks between tests.
* Use descriptive test names that describe behavior rather than implementation.

Example:

```text
✓ returns vans ordered by price
✓ throws NotFoundError when the booking does not exist
✓ rejects unauthenticated requests
```

Good tests document expected behavior and make refactoring safer without exposing implementation details.
