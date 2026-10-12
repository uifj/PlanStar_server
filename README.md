# VanLife API

VanLife API is the backend for the VanLife application. It provides
authentication, role-based access, van browsing, booking requests, host
management, reviews, pagination, and OpenAPI documentation for the React
frontend.

Frontend repository:
[kangcommit/vanlife](https://github.com/kangcommit/vanlife)

## Tech Stack

| Area | Tools |
| --- | --- |
| Runtime | Node.js |
| API | Hono |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | Better Auth |
| Validation | Zod |
| API docs | OpenAPI, Scalar |
| Quality | Biome, TypeScript |

## Features

- Email/password authentication with Better Auth.
- Cookie-backed sessions.
- Renter and host roles.
- Host-only route protection.
- Public van listing and van detail endpoints.
- Search, filter, sort, and pagination support for vans.
- Booking request creation.
- Renter booking history.
- Host booking status management.
- Host van CRUD.
- Host dashboard, income, and review summaries.
- Review creation for completed bookings.
- Zod request validation.
- OpenAPI documentation.

## Seed Accounts

```text
Host:          host@vanlife.test / password123
Second host:   host.two@vanlife.test / password123
Renter:        renter@vanlife.test / password123
Second renter: renter.two@vanlife.test / password123
```

Seeded data includes:

- multiple hosts and renters for ownership scenarios
- public camper van listings across `simple`, `rugged`, and `luxury` types
- van-focused listing images from Pexels
- pending booking requests
- confirmed bookings
- completed bookings
- cancelled bookings
- an overlapping pending booking for conflict testing
- a completed booking with a review
- a completed booking available for review
- an archived van visible to host-side flows
- host vans, income, dashboard, and review data

Pexels photos are used under the Pexels license. See:
[Pexels license information](https://help.pexels.com/hc/en-us/articles/360042295174-What-is-the-license-of-the-photos-and-videos-on-Pexels)

## Getting Started

Install dependencies:

```bash
pnpm install
```

Create and configure `.env`:

```bash
cp .env.example .env
```

Required environment variables:

```text
NODE_ENV=development
PORT=8000
LOG_LEVEL=debug
APP_URL=http://localhost:8000
CLIENT_URL=http://localhost:3000
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
```

Prepare the database:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Start the API:

```bash
pnpm dev
```

The API runs at:

```text
http://localhost:8000
```

The frontend should use:

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

## API Documentation

When the server is running:

| Resource | URL |
| --- | --- |
| Scalar UI | `http://localhost:8000/api/docs` |
| OpenAPI JSON | `http://localhost:8000/api/openapi.json` |
| Current user | `http://localhost:8000/api/me` |

## Main Endpoints

Public:

- `GET /api/vans`
- `GET /api/vans/:id`

Auth:

- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-out`
- `POST /api/auth/change-password`
- `POST /api/register/host`
- `GET /api/me`

Renter:

- `POST /api/bookings`
- `GET /api/bookings`
- `POST /api/bookings/:id/cancel`
- `POST /api/reviews`

Host:

- `GET /api/host/dashboard`
- `GET /api/host/income`
- `GET /api/host/reviews`
- `GET /api/host/bookings`
- `PATCH /api/host/bookings/:id/status`
- `GET /api/host/vans`
- `GET /api/host/vans/:id`
- `POST /api/host/vans`
- `PATCH /api/host/vans/:id`
- `DELETE /api/host/vans/:id`

## Booking Lifecycle

New renter bookings start as `pending`.

Renters may cancel their own `pending` or `confirmed` bookings.

Host-controlled status flow:

```text
pending -> confirmed -> completed
pending -> cancelled
confirmed -> cancelled
```

Only completed bookings can be reviewed. Each booking can have one review.

## Project Structure

```text
src/
  auth/          Roles and auth helpers
  config/        Environment config and constants
  errors/        App and HTTP error classes
  generated/     Generated Prisma client
  lib/           Auth, logger, Prisma, and Prisma error helpers
  middleware/    CORS, session, auth, logger, request id, error handling
  modules/
    auth/        Auth routes and schemas
    bookings/    Booking routes, service, repository, filters
    host/        Host dashboard, vans, bookings, income, reviews
    me/          Current-user route
    reviews/     Review creation
    system/      Health/readiness endpoints
    vans/        Public van browsing
  openapi/       OpenAPI config, schemas, requests, responses
  pagination/    Pagination and sorting helpers
  response/      Response payload helpers
  app.ts
  index.ts
```

Domain modules keep route definitions, routers, services, repositories, DTOs,
and schemas close together. Shared infrastructure lives outside `modules`.

## Quality Checks

```bash
pnpm check
```
