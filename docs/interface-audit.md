# Interface audit — front_web ↔ harness server

Audited 2026-10-18 against commit `57dc702`. Every claim below is a call site or a route
registration, not an inference: the command counts come from the client's own wrapper list
(`front_web/src/ts/lib/api/command.ts`) diffed against the shim's `case` list
(`src/modules/command/service.ts`), and the REST counts from `src/routes/index.ts`.

## 1. The live transport surface

What the shipped web client actually reaches:

| Surface | Client side | Server side | State |
| --- | --- | --- | --- |
| `POST /api/command/<Name>` | `lib/api/service.ts:427` (`ServiceClient.request`) | `src/modules/command/router.ts` → `run()` | live, 105 commands answered |
| `GET /api/events` (SSE) | `lib/api/service.ts:461` (`listenSessionEvents`) | `src/modules/pubsub/router.ts` | live |
| `GET/POST /api/spaces` | `lib/api/spaces.ts:34,47` | `src/modules/spaces/router.ts` | live, but only the auth bootstrap path |
| `POST /api/web-upload` | `lib/web/electronMock.ts:27` | `src/modules/files/router.ts:26` | live (file picker) |
| `/api/auth/*` (better-auth) | `lib/api/better-auth.ts:5` | `src/modules/auth` | live |
| `<gateway>/file/<id>`, `<gateway>/image/<id>?width=N` | `store/common.ts:598,608` | `files/router.ts:110,113` | live; `?width=` is ignored (P5-g) |
| `ws://<api>/collab` (Hocuspocus) | `component/editor/collabBody.tsx:19` | `src/modules/collab` | live |

`gatewayUrl` is `${APP_URL}${API_PREFIX}` (`command/account-service.ts:394`), so media and file
downloads are same-host, cross-port requests carrying the session cookie.

## 2. Command coverage

Reproduce with `pnpm inventory` (`scripts/client-inventory.ts` → `docs/frontend-capabilities.json`,
2,196 entries: 236 `command-use`, 265 wrappers, 346 registry names, 347 proto RPCs). The inventory
deliberately records every capability as `pending` — it joins the client's surface, never claims the
migration is done — so the answered/pending split below comes from diffing it against the shim.

- 259 exported wrappers in `command.ts`; **231 of them are called** from client code.
- The shim answers **105** distinct command names.
- **127 called commands have no server case.** They are not one bucket — see §3.
- Only **2 answered commands are never called**: `ChatUnreadMessages` (the client's unread path uses
  `ChatSubscribeToMessagePreviews` counters instead) and `ObjectToSet` (see §4 — the set screen calls
  a *different* entry point). Both still have integration tests, so they are live-but-unreached
  rather than dead.

## 3. The 127 unhandled commands, classified

**(a) Genuine feature gaps — the set/collection/board/gallery screens.** The client renders those
screens from `component/page/main/set.tsx` and `media.tsx`, which mount the block tree and drive the
dataview through 20 commands, none answered:

`BlockDataviewCreateFromExistingObject`, `FilterAdd`/`FilterRemove`/`FilterReplace`,
`GroupOrderUpdate`, `ObjectOrderUpdate`, `RelationAdd`/`RelationDelete`/`RelationSet`,
`SortAdd`/`SortRemove`/`SortReplace`/`SortSort`, `ViewCreate`/`ViewDelete`/`ViewUpdate`,
`ViewRelationReplace`/`ViewRelationSort`/`ViewSetActive`/`ViewSetPosition`.

Call sites: `component/block/dataview/*`, `component/menu/dataview/*`, `lib/dataview.ts`, and
`component/sidebar/page/widget.tsx` (the sidebar widget's sort menu). ADR-0012 stores a view as an
object and the shim already reads views (`ObjectSearchSubscribe` honors a set's stored filters), so
the read side exists and only the write side is missing.

**(b) Dead call sites left by the Tiptap body port.** ~45 `Block*` commands (`BlockTextSetText`,
`BlockList*`, `BlockTable*`, `BlockCopy`/`BlockPaste`/`BlockSplit`/`BlockMerge`, `BlockCreate`, …) are
referenced only from code the page no longer mounts: `component/editor/page.tsx:3351` renders
`<CollabBody>` and contains **no** `<Block>` render, so the legacy block editor handlers in that same
file (and `component/block/index.tsx`'s text/table branches) are unreachable in this build. They fail
silently because the shim answers `NOT_SUPPORTED`, not because the interface is wrong.

**(c) Intentional boundaries — native, desktop, paid, external.** Account/wallet keys
(`Wallet*`, `AccountCreate`/`Delete`/`Recover`/`Migrate*`, `AccountLocalLink*`), membership,
push-notification registration, `Debug*` (keyboard-only), `Unsplash*` and `Gallery*` (external
services), `ObjectImport*`/`ObjectListExport` (P5-f), `FileDrop` (P5-e), `FileNodeUsage`/
`FileSetAutoDownload`/`FileAutoDownloadSetLimit` (already documented as code 12), and the AI stream
commands (`AIListModels` and friends — the client opens those over `streamClient`, which the shim
transport never implemented, see §5).

## 4. Outstanding defects found by this audit

1. **A converted set renders nothing** (task #249). `ObjectToSet` (`command/service.ts:2216`) flips
   the object into a set but the client keeps showing a plain page, so `PageMainSet` never mounts.
   Reproduced live: `ObjectToSet` → code 0, then the object page shows only its title.
2. **Dataview writes are unsupported** (§3a) — view create/switch, filter, sort, relation and
   column-order edits cannot persist.
3. **The AI writing tools cannot stream** — `service.ts:383-394` keeps `client`/`streamClient`
   instances that nothing uses, and `getDescriptor` (`:397-425`, path
   `/anytype.ClientCommands/<Name>`) is dead. Any `C.AI*` call that expects a stream has no transport.
4. **Publish links point off-box** — `lib/util/space.ts:872` builds `https://<publishDomain>/<slug>`
   from `src/json/url.ts` (`any.coop/%s`), while the server serves `GET /publish/:uri`. The settings
   screen's link therefore never reaches this harness.
5. **`?width=` is ignored** on `/image/:id` (P5-g, known).

## 5. Dead code and obsolete surface to prune

**Backend (unreferenced by the client, per §1's grep of path literals):** `/api/objects`,
`/api/blocks`, `/api/dataviews`, `/api/relations`, `/api/object-types`, `/api/publish`,
`/api/me`, `/api/vans`, `/api/bookings`, `/api/reviews`, `/api/host`, `/api/system`, `/api/agent`,
`/api/ai`. These are the pre-pivot REST API and the Genkit mounts; they are heavily covered by
integration tests, so removing them is a scope decision, not a cleanup — **decided: keep them
mounted and mark the superseded operations deprecated** (ADR-0021, `src/openapi/deprecations.ts`).
36 documented operations now carry `deprecated`; the live surface is `/api`, `/api/health`,
`/api/ready`, `/api/spaces`, `/api/command/{name}` and `/api/agent/trip-planner/messages` — the agent
mount stays unmarked because nothing supersedes it, it simply has no caller in this client.

**Frontend:** the grpc-web residue — `lib/api/service.ts:3-9,383-425`, `lib/api/dispatcher.ts:7,62`,
`lib/api/grpc-devtools.ts` + its `.d.ts`, `package.json:70` `grpc-web`, `electronMock.ts:477`
`window.GRPC_SERVER_ADDRESS`, `src/json/url.ts:29` `api: '127.0.0.1:31009'` feeding
`store/auth.ts:22`; the duplicated base-URL helper (`lib/api/spaces.ts:21` and
`lib/web/serverAddress.ts:24` re-implement `commandBase()`); and the unreachable legacy block-editor
handlers named in §3b.

## 6. Deepening candidates

1. **One command-seam per domain instead of a 3,000-line switch.** `run()` is one shallow module
   whose interface (body key names, error codes, envelope shape) is re-derived per case. Extract the
   dataview write family behind a `dataviewWrite` module that takes the same `Set`-shaped input the
   read path already uses — then §3a's 20 commands are one table, not 20 cases.
2. **A real seam for the view model.** ADR-0012 says a saved view is an object; the read side compiles
   stored filters/sorts (`set-query.ts`) but the write side has no owner. A `views` module that both
   the REST dataview router and the shim call would delete the duplication and make the dataview
   commands testable through one interface.
3. **Prune the pre-pivot REST API** (or re-declare it as the harness's public product API and give
   the client a reason to use it). Deletion test: removing it moves no complexity anywhere — the
   client already gets all of that behaviour through the shim.
4. **Collapse the transport leftovers into `commandBase()`.** Three implementations of the base URL
   and two dead grpc-web clients; one module, one adapter.
5. **Seed the body a set needs.** Make set creation own both halves (the object *and* its dataview
   node in the collab doc), which also closes #249.
