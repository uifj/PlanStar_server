# Architecture

VanLife API follows a **module-driven architecture** with a clear separation of concerns. The goal is to keep features isolated while sharing common infrastructure across the application.

## Design Principles

The project is built around the following principles:

* Feature-oriented organization
* Clear separation of responsibilities
* Reusable shared infrastructure
* Type safety
* Testability
* Scalability

Each feature owns its own business logic, while cross-cutting concerns are shared through common infrastructure.

# Project Structure

```text
src
├── auth/
├── config/
├── errors/
├── lib/
├── middleware/
├── modules/
├── openapi/
├── pagination/
├── response/
└── routes/
```

The project is divided into two main areas:

* **Feature modules**
* **Shared infrastructure**

# Feature Modules

Every feature lives inside the `modules` directory.

Example:

```text
modules/
└── bookings/
    ├── constants.ts
    ├── dto.ts
    ├── filters.ts
    ├── repository.ts
    ├── router.ts
    ├── routes.ts
    ├── schema.ts
    └── service.ts
```

Each module is responsible for its own:

* Routes
* Validation
* Business logic
* Data access
* OpenAPI definitions

This keeps features self-contained and makes them easier to maintain as the application grows.

# Shared Infrastructure

Code that is reused across multiple features belongs outside of `modules`.

Examples include:

* Authentication
* Database client
* Logging
* Error handling
* Pagination
* API responses
* OpenAPI configuration

Shared infrastructure should remain generic and independent of any specific feature.

# Application Layers

## Router

Responsible for:

* Registering endpoints
* Connecting routes to services
* Applying middleware

Routers should remain thin and contain little or no business logic.

Protected routers should opt in to authentication explicitly.

```ts
import { createProtectedRouter } from "../../auth/protected-router.js";

export const router = createProtectedRouter();
```

`createProtectedRouter()` applies session lookup before `requireAuth`. Public modules should use a regular `OpenAPIHono` router and should not perform session lookup.

Authorization decisions that depend on a specific resource, such as ownership, belong in services because they usually require loading domain data.

## Service

Responsible for:

* Business rules
* Resource ownership checks
* Authorization decisions
* Coordinating repositories
* Returning application data

Services should not be aware of HTTP-specific concerns.

## Repository

Responsible for:

* Database queries
* Prisma interaction
* Persistence logic

Repositories isolate persistence logic from the rest of the application, making data access easier to maintain and test.

## Schema

Responsible for:

* Request validation
* Response schemas
* OpenAPI schema definitions

Validation should occur before business logic is executed.

## DTO

Responsible for transforming domain objects into API responses.

DTOs help prevent database models from leaking directly into the public API.

## Filters

Responsible for building query options such as:

* Filtering
* Searching
* Sorting
* Pagination

Keeping query construction separate makes repositories simpler and easier to test.

## Constants

Responsible for:

- Feature-specific constants
- Default values
- Shared configuration used within the module

Keeping constants together avoids magic values being scattered throughout the codebase.

# Request Flow

A typical request follows this flow:

```text
Client
    │
    ▼
Router
    │
    ▼
Middleware
    │
    ▼
Validation
    │
    ▼
Service
    │
    ▼
Repository
    │
    ▼
Database
```

The response then travels back through the same layers until it is returned to the client.

# Why Module-Driven?

A module-driven structure scales better than organizing code by technical layers alone.

Instead of grouping every controller, service, or schema together, each feature owns everything it needs.

Benefits include:

* Easier navigation
* Better encapsulation
* Reduced coupling
* Simpler feature extraction
* Improved maintainability

# Shared Conventions

VanLife API follows several conventions:

* Business logic belongs in services.
* Database access belongs in repositories.
* Validation is performed using Zod.
* OpenAPI documentation is defined alongside routes.
* API responses use standardized payload helpers.
* Authentication is opt-in per protected router.
* Role and ownership checks belong in services.
* Shared utilities remain framework-agnostic whenever possible.

Following these conventions keeps the codebase consistent as additional modules are added.
