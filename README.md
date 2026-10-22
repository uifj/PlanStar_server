# VanLife API

> 中文文档：[README.zh-CN.md](./README.zh-CN.md)

VanLife API is the backend for the VanLife application. It provides
authentication, role-based access, van browsing, booking requests, host
management, reviews, pagination, and OpenAPI documentation for the React
frontend.

The React frontend lives in this repository under
[`front_web/`](./front_web).

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
| Agent | Genkit (DeepSeek or Google GenAI provider) |
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
- Trip planner agent built on Genkit, answering through van search,
  availability, and upcoming-trip tools.
- The agent is reachable over both a REST endpoint and Genkit's own protocol.
- Agent conversations persisted per user in PostgreSQL.

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

Environment variables:

```text
NODE_ENV=development
PORT=8000
LOG_LEVEL=debug
APP_URL=http://localhost:8000
CLIENT_URL=http://localhost:3000
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...

# Optional: provider for the trip planner agent. The API starts without a key
# and the agent answers 503 until one is configured.
AGENT_MODEL=deepseek/deepseek-chat
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
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

## Frontend (`front_web`)

`front_web` is a separate pnpm project and is not a member of the root pnpm
workspace, so installing from the repository root leaves it untouched:

```bash
cd front_web
pnpm install --ignore-workspace
```

Create `front_web/.env`. The client reads `VITE_API_BASE_URL` only and ships no
default:

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

Start the Vite server:

```bash
pnpm dev
```

The app runs at:

```text
http://localhost:3000
```

Frontend checks are `pnpm typecheck` and `pnpm check`, run from `front_web`.

## Production deployment

The repository ships a single-host production stack (Caddy + API + Postgres) and a runbook that is
meant to be executed top to bottom on a fresh machine:

- **[docs/deploy/README.md](docs/deploy/README.md)** — prerequisites, secret generation,
  `.env.production`, first start, migrations, first admin, release rehearsal, backups, upgrade and
  rollback, log retrieval, and a 26-line go-live checklist.
- **[docs/deploy/troubleshooting.md](docs/deploy/troubleshooting.md)** — seventeen failure modes,
  each with a discriminator that separates it from its look-alikes (401 loops, update 400s, install
  refused, collab, unhealthy containers, disk, migrations, slow shutdown, missing compose provider,
  TLS, `/data` permissions, registry pull failures, `ERR_MODULE_NOT_FOUND`, build OOM, Prisma
  `enums.ts`, Caddy bind permission, and compose-file drift in the deploy scripts).
- `deploy/podman/` — `compose.yaml` for a single host, `quadlet/` for a systemd-native Linux
  install, `scripts/` for backup / restore / upgrade / release staging / smoke.

Quick shape of it:

```bash
deploy/podman/scripts/backup.sh     # database + /data (desktop/logs excluded)
deploy/podman/scripts/upgrade.sh    # backup → build → migrate → roll → health gate → rollback
deploy/podman/scripts/smoke.sh      # 5 checks through the public entrypoint
```

Architecture decisions that the deployment depends on:
[ADR-0026](docs/adr/0026-cloud-cookie-policy.md) (cross-site session cookies) and
[ADR-0027](docs/adr/0027-desktop-log-uplink.md) (desktop log uplink).

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

Agent (any signed-in user):

- `POST /api/agent/trip-planner/messages`
- `/api/ai/tripPlanner` (all methods, Genkit protocol)

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

## Trip Planner Agent

`src/modules/agent` defines a Genkit agent named `tripPlanner` that plans van
trips for the signed-in traveller. It answers from tool output rather than
invention:

| Tool | Purpose |
| --- | --- |
| `searchVans` | Search listed vans by location and nightly budget |
| `checkAvailability` | Test a van against live bookings for a date range, and report the blocking dates |
| `myUpcomingTrips` | Take no arguments; resolve the traveller from the conversation and list upcoming trips |

Two transports are mounted for the same agent:

- `POST /api/agent/trip-planner/messages` takes `{ "message": "...", "chatId": "..." }`
  and returns `{ chatId, snapshotId, reply }`. Omit `chatId` to start a new
  conversation.
- `/api/ai/tripPlanner` speaks Genkit's own wire format, which the browser
  `remoteAgent` client and the Genkit Dev UI use.

Conversations persist as `AgentChat` and `AgentSnapshot` rows, and a `chatId`
can only be continued by the user who started it.

The provider plugin is chosen from the `AGENT_MODEL` prefix
(`deepseek/deepseek-chat`, `deepseek/deepseek-reasoner`, or `googleai/<model>`)
and only the matching plugin is loaded — registering a second provider makes
agents resolve to that provider's default model instead. Without a key the API
still starts and a turn returns `503`.

To open the Genkit Dev UI against this server:

```bash
pnpm exec genkit start -- pnpm dev
```

## Project Structure

```text
src/
  auth/          Roles and auth helpers
  config/        Environment config and constants
  errors/        App and HTTP error classes
  generated/     Generated Prisma client
  lib/           Auth, Genkit, logger, Prisma, and Prisma error helpers
  middleware/    CORS, session, auth, logger, request id, error handling
  modules/
    agent/       Trip planner agent, tools, chat store, and both transports
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
  routes/        Mounts every module router, including the agent transports
  app.ts
  index.ts
```

Domain modules keep route definitions, routers, services, repositories, DTOs,
and schemas close together. Shared infrastructure lives outside `modules`.

## Quality Checks

```bash
pnpm check
```

`pnpm check` runs Biome, `tsc --noEmit`, and both test suites. To run the steps
individually:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit         # Vitest unit suite
pnpm test:integration  # Vitest against the .env.test database
pnpm test:all
```

Build and run the compiled API:

```bash
pnpm build
pnpm start
```
