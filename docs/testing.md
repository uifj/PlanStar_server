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

---

# Acceptance run — 2026-10-18 (command shim, web client)

Environment: API on `:8000` (`pnpm dev`, tsx watch), the ported Anytype client on `:3030`
(`pnpm dev` in `front_web`, `VITE_API_BASE_URL=http://localhost:8000/api`), Postgres 16 in the
`vanlife-postgres` Podman container. The client talks to `POST /api/command/:name` plus the SSE
channel `GET /api/events`; the retired gRPC-web proxy on `:31008` is no longer dialled.

Flow executed in the browser, each step observed rather than assumed:

| Step | Evidence |
| --- | --- |
| login / session restore | `[App] Init http://localhost:8000/api`, `AccountSelect` → code 0 |
| open a space | `WorkspaceOpen` + the space's registry/list subscriptions → code 0 |
| object page | body edit persisted through Hocuspocus, survived a reload, produced a new `DocumentVersion` |
| history diff | panel fires `HistoryGetVersions → HistoryShowVersion → HistoryDiffVersions → HistoryShowVersion`, all code 0; selecting an older row swaps the preview text; the diff markers land on that preview tree (`.diffAdd` / `.diffRemove` on `#block-<object>-body-<n> > .wrapContent`, inline `<markupchange>` for a rewritten line) |
| live update | `GET /api/events [200] text/event-stream`; on the client's own subId `recentEditAll-<spaceId>` a create delivers one frame: `objectDetailsSet + subscriptionAdd + subscriptionRemove` |
| import (Settings → Import) | picker stages to `POST /api/web-upload` → `ObjectImport` code 0 → the new page opens with two rendered paragraphs; a `reader` gets code 2 |
| file drop | dropping a file onto a page stages it, `FileDrop` code 0, and the body gains an `attachment` node whose filename has the `<timestamp>-<rand>-` staging prefix stripped |
| export (Settings → Export) | `ObjectListExport` code 0 with `report.objectCount` for the whole space; the returned `/api/export/<name>` serves `200 application/zip` starting `PK\x03\x04`, and the browser download saves it |
| type recommended layout | sidebar sets a type to Task → `ObjectCreate` of that type answers `{layout: 2, resolvedLayout: 2}` and the type's grid renders the row as `class="row isTask"`; an object created before the recommendation stays `layout: 0` until `ObjectTypeResolveLayoutConflicts` answers code 0 and its projection becomes 2 |
| deep link / reload | cold-load `/main/object/?id=…&spaceId=…` → resolves to `/main/edit/<id>/spaceId/<space>`, `#header .side.center` shows the title and the Tiptap body renders the persisted document; before the fix the same URL fell through to the space dashboard because only the pathname was restored |
| cold-load editing + single drag system | on that reloaded page `contenteditable="true"` and typing reaches the server (DOM text and `ObjectShow`'s `snippet` match); 0 `.dragHandle` nodes even after hovering a block, and an empty body shows one placeholder, not two (ADR-0023) |

Interface sweep (each command called with the payload the client's `command.ts` actually sends):
`ObjectShow`, `ObjectSearchWithMeta`, `ObjectCrossSpaceSearch`, `ObjectGraph`,
`NavigationGetObjectInfoWithLinks`, `ObjectSubscribeIds`, `ObjectGroupsSubscribe`,
`ObjectDeletionAudit`, `ObjectCleanupSuggestions`, `RelationListWithValue`,
`ObjectDateByTimestamp`, `NotificationList`, `PublishingList`, `SpaceInviteGetCurrent`,
`TemplateCreateFromObject`, `ChatGetMessages`, `ChatSubscribeLastMessages`,
`ChatUnreadMessages`, `ChatReadReactions`, `ChatGetPinnedMessages`, `ChatGetMessagesByIds`,
`ChatReadAll`, `ChatSearch`, `ChatAddMessage`, `ObjectAddDiscussion`,
`ObjectTypeListConflictingRelations` → all code 0.

Defects this run found and fixed (each with a test):

* `ObjectOpen` of the client's synthetic `_personalWidgets_<spaceId>` answered NOT_FOUND → `e8c8b9c`
* the browser never opened `/api/events` (`startStream` was reachable only from
  `WalletCreateSession`) → `758172d`
* a stored `:31008` address outranked the API base on every later boot → `faf9dea`, `7d5992f`
* `recentEditMe` / `recentEditAll` were answered but never registered, so the Recent widget could
  not receive a delta → `a056a8e`
* `HistoryShowVersion` returned the object's current (stale or absent) block rows, leaving the
  preview pane blank → `ab5ff3d`
* a space installed no object types at all, so the shell's `type-<spaceId>` registry was empty and
  both type surfaces read "No Objects found" → `ba8d7b6`
* the create menu's `ObjectSearch` ignored `body.filters` entirely and searched object rows by
  text, so the type picker had nothing to list even once a registry existed → `4c21ba3`

Screens beyond that flow, also driven in the browser: the **graph** opens from the header and
draws the object's node (canvas + label, no error codes); the **discussion** panel on an object
page lazily creates its chat object (`ObjectAddDiscussion`), then `ChatSubscribeLastMessages` +
`ChatAddMessage` + `ChatGetMessages` post and render a comment with author and time, and the editor
clears. Across both screens the console shows only the three intentional `code 12` file commands
and the vendored SVG/React warnings — no new interface failures.

Known boundaries, not defects: `FileNodeUsage`, `FileSetAutoDownload` and
`FileAutoDownloadSetLimit` answer code 12 (native-only), and the `type` / `relation` / `option` /
`participant` / `deleted` / `archived` registry sources stay unregistered on purpose, so those
panels still refresh on reload.

Gates at this commit: integration 605 passed / 5 skipped, unit 174 passed, `tsc --noEmit` clean,
`pnpm build` clean, client `tsc` clean and 1386 client tests passing. Repo-wide `pnpm lint`
remains red on the vendored `front_web/dist` assets — see the note in the memory index; scope the
check with `npx biome check src tests front_web/src/ts`.

# Re-run after the block-drag removal — 2026-10-19 (task #277)

Both dev servers were stopped and relaunched (API `pnpm dev` on `:8000`, client `pnpm dev` on `:3030`)
after `@tiptap/extension-drag-handle` and `@tiptap/extension-node-range` were dropped from
`front_web/package.json`; Vite reported `Re-optimizing dependencies because lockfile has changed`,
which is the point at which a leftover import of a removed package would surface.

Driven in the running client, observed rather than assumed:

| Step | Evidence |
| --- | --- |
| boot with the advertised `?server=http://localhost:8000` | `[App] Init http://localhost:8000/api`, stored address `http://localhost:8000/api`, lands on `Widgets - My Space` (before the fix this boot dead-ended on `/auth/better-login`; audit §4-33) |
| screen sweep | `U.Router.go` over void/set/media/archive/graph/navigation/chat/settings/import/history/date/relation/edit: 24 command calls, all code 0 except the three documented `code 12` file commands and `GalleryDownloadManifest` (code 12, gallery install has no web backend) |
| object page | cold deep-link load of `/main/object/?id=…&spaceId=…` resolves to `/main/edit/<id>/spaceId/<space>`, `#header .side.center` shows `Grid`, body restores `sweep 2026-10-19 interface check second sweep line`, `contenteditable="true"`, **0 `.dragHandle` nodes**, one placeholder |
| body persistence | typing reaches the server through Hocuspocus: `ObjectShow` answers the same string as `snippet` |
| history | the two stores produced two `versions`; `HistoryShowVersion` answers an `objectView` with 2 blocks; `HistoryDiffVersions` answers one `historyEvents` entry, `blockSetText` on `<id>-body-1` carrying the new text |
| chat | `ObjectAddDiscussion` → `discussionId`; `ChatAddMessage` → `messageId`; `ChatGetMessages` returns the message with `creator` = the account id; `ChatDeleteMessage` then lists 0; `ChatUnreadMessages` code 0 |
| write paths | `ObjectCreate` (code 0, `objectId`), `ObjectOpen` 0, `TemplateCreateFromObject` 0 (`id`), `ObjectApplyTemplate` 0, `ObjectListDuplicate` 0 (`ids[1]`), `ObjectListDelete` 0 twice, and the purged probe answers `ObjectOpen` code 3 |
| publish | `PublishingCreate` 0 → `GET /api/publish/<uri>` 200 → `PublishingGetStatus` 0 → `PublishingRemove` 0 |
| type layout | `ObjectTypeResolveLayoutConflicts` on a real `objectType` row answers code 0 with 0 reset objects (no recommendation set); on non-type ids it answers code 12, which is the `notAType` branch working |
| export | `ObjectListExport` with the numeric `format: 0` answers `/api/export/<name>`; the browser fetch gets 200 `application/zip`, 5515 bytes starting `PK\x03\x04` (curl gets 401 — the route is session-cookie scoped) |
| push channel | `GET /api/events` → 200 `text/event-stream` from the booted page |

Wire keys that made an earlier hand-probe read a healthy interface as broken — check these before
concluding a defect from a raw `POST /api/command/<Name>`:

* filters are keyed **`RelationKey`** (`Mapper.To.Filter`), not `relation`; a filter without it adds no
  constraint, so `ObjectSearch` looks like it ignores filtering. With the right key,
  `name`/`Equal` narrowed 30 records to 4.
* `ObjectSearch` records project name/layout/type at the **top level**, not under `fields`.
* `HistoryGetVersions` answers **`versions`**; `HistoryDiffVersions` answers **`historyEvents`**;
  `ObjectListDuplicate` answers `ids`, `ObjectAddDiscussion` answers `discussionId`,
  `TemplateCreateFromObject` answers `id`, `ChatAddMessage` answers `messageId`.
* `ObjectListExport` needs the **numeric** format (0 Markdown, 2 JSON); a format string reaches the
  `ImportUnsupportedError` branch and reads back as code 12.
* `ObjectDuplicate` (declared, no call site in the client) is genuinely code 12; the UI's duplicate
  action is `ObjectListDuplicate`.

Gates at this commit: unit 185 passed, integration 694 passed / 5 skipped (140 files), root
`tsc --noEmit` and `pnpm build` clean, client `tsc` clean and **1403** client tests passing,
`pnpm coverage` unchanged at 265 declared / 236 called / 134 answered / 107 unanswered, and
`pnpm inventory:check` matches after regenerating the manifest for the removed `dragHandle.ts`.

