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
