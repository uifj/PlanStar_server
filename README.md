# PlanStar API

> 中文文档：[README.zh-CN.md](./README.zh-CN.md)

PlanStar API is the backend for **PlanStar (企划星)** — a self-hosted knowledge
workspace. It provides authentication and cookie-backed sessions, a
workspace/content model (spaces, objects, blocks, data views, relations,
object types), a command bus the client shell drives, publishing and realtime
events, file handling, desktop release and log services, and a Genkit agent —
with an OpenAPI/Scalar surface generated from the typed routes for the React
frontend.

The React client is a **separate repository**,
[`uifj/PlanStar_frontend`](https://github.com/uifj/PlanStar_frontend) (web +
Electron desktop shell). This repository ignores `front_web/`, so a clone of the
API does not carry the client; check it out alongside the API as `front_web/`
when you want to run both.

A bundled **vanlife sample domain** (vans, bookings, reviews, host dashboard,
and the trip-planner agent) ships alongside the workspace modules as a worked
example of the same Hono + Prisma + Better Auth stack; see
[Vanlife sample domain](#vanlife-sample-domain).

## Tech Stack

| Area | Tools |
| --- | --- |
| Runtime | Node.js ≥ 24, pnpm ≥ 11 |
| API | Hono (`@hono/zod-openapi`) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | Better Auth |
| Validation | Zod |
| Realtime | Server-sent events (`/api/events`) + Yjs over WebSocket (`/collab`) |
| Agent | Genkit (DeepSeek or Google GenAI provider) |
| API docs | OpenAPI, Scalar |
| Quality | Biome, TypeScript, Vitest |

## Capabilities

Grouped by the routers mounted in [`src/routes/index.ts`](src/routes/index.ts):

- **Auth & sessions** — email/password sign-in and sign-up through Better Auth,
  cookie-backed sessions, current-user lookup (`/api/me`), password change,
  role-protected routes.
- **Workspaces & content** — spaces, objects, blocks, data views, relations and
  object types: the knowledge-base model the client renders.
- **Command bus** — `POST /api/command/{name}` is the RPC surface the web and
  Electron shells drive for account/space lifecycle (e.g. `AccountStop` also
  revokes the Better Auth session at the transport boundary).
- **Publishing & realtime** — public sharing (`/api/publish/{uri}`), a
  server-sent subscribe channel (`/api/events`), and Yjs document
  collaboration from the client editor over Hocuspocus on the same HTTP
  server (`/collab`, WebSocket upgrade with the Better Auth session cookie).
- **Files & exports** — root-level upload (`POST /api/web-upload`), download
  (`/api/file/{id}`, `/api/image/{id}`) and object-list export archives
  (`/api/export/{name}`).
- **Desktop services** (`/api/desktop`) — release manifest / download / feed for
  auto-update, feedback and crash-report intake, and an anonymous log uplink
  (`POST /api/desktop/logs`) with per-device quota and 14-day retention
  ([ADR-0027](docs/adr/0027-desktop-log-uplink.md)).
- **Agent** — a Genkit `tripPlanner` agent over REST and Genkit's own protocol,
  with conversations persisted per user.
- **System** — `/api/health` and `/api/ready` probes.

## Getting Started

Requirements: Node.js ≥ 24 and pnpm ≥ 11 (`engines` in `package.json`).

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
CLIENT_URL=http://localhost:3030
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...

# Optional: provider for the agent. The API starts without a key
# and the agent answers 503 until one is configured.
AGENT_MODEL=deepseek/deepseek-chat
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
```

These are the keys needed to boot. The full schema — `HOST`, the file-store
roots (`FILE_STORAGE_ROOT`, `FILE_UPLOAD_STAGING_ROOT`, `EXPORT_ROOT`), the
desktop release/log settings (`DESKTOP_ORIGIN`, `DESKTOP_RELEASE_*`,
`DESKTOP_LOG_*`) and the agent model — is validated in
[`src/config/env.ts`](src/config/env.ts); every default is listed there.

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

The API runs at `http://localhost:8000`.

## Frontend (`front_web`)

The client is its own repository and its own pnpm project; it is not a member of
the root workspace, and this repository ignores `front_web/`. Check it out next
to the API:

```bash
git clone git@github.com:uifj/PlanStar_frontend.git front_web
cd front_web
pnpm install --ignore-workspace
```

Create `front_web/.env` and point it at the API:

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

At boot the client resolves its base in this order: the `?server=` URL parameter,
the address stored by a previous boot, `VITE_API_BASE_URL`, then the page's own
origin plus `/api`. An origin-only value gains the `/api` suffix.

Start the Vite server:

```bash
pnpm dev
```

The app runs at `http://localhost:3030`. Frontend checks are `pnpm typecheck`
and `pnpm check`, run from `front_web`. See
[`front_web/README.md`](https://github.com/uifj/PlanStar_frontend) for the
client's own docs.

## API Documentation

With the server running in development (`NODE_ENV=development`):

| Resource | URL |
| --- | --- |
| Scalar UI | `http://localhost:8000/api/docs` |
| OpenAPI JSON | `http://localhost:8000/api/openapi.json` |
| Health / readiness | `http://localhost:8000/api/health`, `/api/ready` |
| Current user | `http://localhost:8000/api/me` |

Scalar and the OpenAPI document are mounted only when `NODE_ENV` is
`development`; production deployments do not expose them.

## API Surface

Every route below is mounted under the `/api` prefix. The authoritative list of
operations and schemas is the generated OpenAPI document at `/api/openapi.json`.

| Mount | Module | Responsibility |
| --- | --- | --- |
| `/`, `/health`, `/ready` | system | info and probes |
| `/auth/*`, `/register/host`, `/me` | auth, me | Better Auth sessions, host sign-up, current user |
| `/spaces` | spaces | space list/create |
| `/spaces/{spaceId}/participants[/{participantId}]` | spaces | membership |
| `/spaces/{spaceId}/objects` | objects | space-scoped object list/create |
| `/objects/{objectId}` | objects | object read/update/delete |
| `/objects/{objectId}/backlinks` | objects | backlinks |
| `/spaces/{spaceId}/relations`, `/object-types` | relations, object-types | schema registry |
| `/spaces/{spaceId}/dataviews[/{dataviewId}][/records]` | dataviews | views and records |
| `/objects/{objectId}/blocks` | blocks | block list/create |
| `/blocks/{blockId}` | blocks | block update/delete |
| `/command/{name}` | command | RPC bus for the client shells |
| `/publish/{uri}` | publish | public sharing |
| `/events` | pubsub | server-sent subscribe channel |
| `/web-upload`, `/file/{id}`, `/image/{id}`, `/export/{name}` | files | uploads, downloads, exports |
| `/desktop/{feedback,crash-report,releases/*,logs*}` | desktop, desktop-logs | releases, intake, log uplink |
| `/agent/trip-planner/messages`, `/ai/tripPlanner` | agent | agent over REST + Genkit protocol |
| `/vans`, `/bookings`, `/reviews`, `/host/*` | vanlife sample | see below |

Outside the `/api` prefix, the same HTTP server answers a WebSocket upgrade on
`/collab` (Hocuspocus + Yjs) for live document collaboration.

## Vanlife sample domain

A self-contained example built on the same stack, seeded with demo data:

- Public van listing and detail with search, filter, sort, pagination.
- Renter booking requests, history, cancellation; one review per completed booking.
- Host dashboard, income, reviews, bookings, and van CRUD/archive.
- Host/renter roles and host-only route protection.
- The `tripPlanner` Genkit agent (see below).

### Seed accounts

```text
Host:          host@vanlife.test / password123
Second host:   host.two@vanlife.test / password123
Renter:        renter@vanlife.test / password123
Second renter: renter.two@vanlife.test / password123
```

Seeded data includes multiple hosts and renters, camper van listings across
`simple`, `rugged`, and `luxury` types (images from Pexels under the
[Pexels license](https://help.pexels.com/hc/en-us/articles/360042295174-What-is-the-license-of-the-photos-and-videos-on-Pexels)),
and bookings in every lifecycle state (pending / confirmed / completed /
cancelled, an overlap for conflict testing, and a reviewable completed booking).

Booking status flow (host-controlled):

```text
pending -> confirmed -> completed
pending -> cancelled
confirmed -> cancelled
```

## Trip Planner Agent

`src/modules/agent` defines a Genkit agent named `tripPlanner` that plans van
trips for the signed-in traveller, answering from tool output rather than
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
can only be continued by the user who started it. The provider plugin is chosen
from the `AGENT_MODEL` prefix (`deepseek/...` or `googleai/<model>`) and only the
matching plugin is loaded; without a key the API still starts and a turn returns
`503`. To open the Genkit Dev UI against this server:

```bash
pnpm exec genkit start -- pnpm dev
```

## Production deployment

The repository ships a single-host production stack (Caddy + API + Postgres) and
a runbook meant to be executed top to bottom on a fresh machine:

- **[docs/deploy/README.md](docs/deploy/README.md)** — prerequisites, secret
  generation, `.env.production`, first start, migrations, first admin, release
  rehearsal, backups, upgrade and rollback, log retrieval, and a go-live checklist.
- **[docs/deploy/troubleshooting.md](docs/deploy/troubleshooting.md)** — failure
  modes, each with a discriminator that separates it from its look-alikes.
- `deploy/podman/` — `compose.yaml` for a single host, `quadlet/` for a
  systemd-native Linux install, `scripts/` for backup / restore / upgrade /
  release staging / smoke.

```bash
deploy/podman/scripts/backup.sh     # database + /data (desktop/logs excluded)
deploy/podman/scripts/upgrade.sh    # backup → build → migrate → roll → health gate → rollback
deploy/podman/scripts/smoke.sh      # 5 checks through the public entrypoint
```

Deployment depends on
[ADR-0026](docs/adr/0026-cloud-cookie-policy.md) (cross-site session cookies) and
[ADR-0027](docs/adr/0027-desktop-log-uplink.md) (desktop log uplink).

## Project Structure

```text
src/
  auth/          Roles, current-user and protected-router helpers
  config/        Environment config (Zod) and constants
  errors/        App and HTTP error classes
  lib/           Auth, Genkit, logger, Prisma, and Prisma error helpers
  middleware/    CORS, session, auth, logger, request id, error handling
  modules/
    agent/       Trip-planner Genkit agent, tools, chat store, both transports
    auth/        Auth routes and schemas
    blocks/      Block operations
    collab/      Hocuspocus/Yjs collaboration (WebSocket upgrade at /collab)
    command/     Command bus (RPC surface for the client shells)
    dataviews/   Data view operations
    desktop/     Release manifest/download/feed, feedback, crash reports
    desktop-logs/ Anonymous log uplink, quota, retention
    files/       Uploads, downloads, export archives
    objects/     Object CRUD and space-scoped queries
    object-types/ Object type registry
    publish/     Public sharing
    pubsub/      Realtime subscribe channel (/api/events)
    relations/   Relation operations
    spaces/      Workspace/space management
    system/      Health/readiness endpoints
    vanlife/     Shared vanlife domain
    vans/ bookings/ reviews/ host/   Vanlife sample domain
  openapi/       OpenAPI config, schemas, requests, responses, Scalar
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
