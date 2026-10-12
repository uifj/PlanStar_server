# Conventions

This document describes the conventions used throughout the project. Following these conventions helps keep the codebase consistent, predictable, and easy to maintain.

---

# File Naming

Use **kebab-case** for all file names.

Examples:

```text
request-id.ts
require-auth.ts
current-user.ts
```

Avoid:

```text
requestId.ts
RequestId.ts
request_id.ts
```

---

# Directory Organization

Feature code belongs inside `src/modules`.

```text
src/modules/
├── vans/
├── bookings/
└── reviews/
```

Shared infrastructure belongs outside feature modules.

Examples:

* `auth/`
* `config/`
* `errors/`
* `lib/`
* `middleware/`
* `openapi/`
* `pagination/`
* `response/`

---

# Module Structure

Each feature should own everything it needs.

Example:

```text
bookings/
├── constants.ts
├── dto.ts
├── filters.ts
├── repository.ts
├── router.ts
├── routes.ts
├── schema.ts
└── service.ts
```

Not every module must contain every file. Add files only when they provide value.

---

# Import Style

Prefer relative imports within a feature.

Example:

```ts
import { CreateBookingSchema } from "./schema.js";
```

Import shared infrastructure from its dedicated directory.

```ts
import { prisma } from "../../lib/prisma.js";
```

Always include the `.js` extension when importing local modules.

---

# Route Design

Use plural resource names.

Examples:

```text
GET    /vans
GET    /vans/:id
POST   /bookings
POST   /bookings/:id/cancel
PATCH  /host/bookings/:id/status
```

Keep routes RESTful and resource-oriented.

---

# Validation

Validate all request data using Zod.

Validation should happen before business logic is executed.

---

# Business Logic

Business rules belong in services.

Avoid placing business logic inside:

* routers
* repositories
* middleware

---

# Database Access

Repositories are responsible for all Prisma interaction.

Services should not execute Prisma queries directly.

---

# Error Handling

Throw application-specific errors rather than returning error objects.

Use the provided HTTP error classes whenever possible.

Unexpected errors are handled by the global error middleware.

---

# API Responses

Return standardized payloads.

Single resource:

```json
{
  "id": "resource-id"
}
```

Paginated collection:

```json
{
  "data": [],
  "meta": {}
}
```

Avoid returning raw database objects directly.

---

# Pagination

Use the shared pagination utilities.

Supported features include:

* page
* limit
* sorting

Feature modules should reuse the shared pagination helpers instead of implementing their own.

---

# Logging

Use the shared logger.

Avoid using `console.log()` inside application code.

---

# Authentication

Authentication is handled through Better Auth.

Session lookup is opt-in. Public routes should not use session middleware.

Protected routes should use `createProtectedRouter()`.

```ts
import { createProtectedRouter } from "../../auth/protected-router.js";

export const router = createProtectedRouter();
```

Use `getCurrentUser()` inside protected handlers instead of reading session data directly.

Do not apply `requireAuth` without first applying `sessionMiddleware`. `createProtectedRouter()` handles this ordering.

Keep role definitions centralized. Do not scatter role strings such as `"admin"` through feature modules.

Resource ownership and role checks belong in services when they depend on domain data. For example, the host van service verifies that the authenticated user has the host role and owns the specific van before updates.

---

# Testing

Place tests under the `tests` directory.

Recommended structure:

```text
tests/
├── unit/
├── integration/
├── helpers/
└── mocks/
```

Keep test helpers reusable and avoid duplicating setup logic.

---

# Environment Variables

Validate all environment variables during application startup.

Never access `process.env` directly outside the environment configuration.

---

# Commits

Follow the Conventional Commits specification.

Examples:

```text
feat(bookings): add cancellation endpoint
fix(auth): handle expired sessions
refactor(pagination): simplify sorting helper
docs: improve architecture guide
test(host): add booking workflow tests
```

---

# General Guidelines

* Keep modules focused on a single responsibility.
* Prefer composition over duplication.
* Reuse shared infrastructure whenever possible.
* Keep functions small and easy to understand.
* Write code that is easy to test.
* Favor clarity over cleverness.
