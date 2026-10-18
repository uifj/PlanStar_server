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
- The shim answers **127** distinct command names (105 at the audit's first pass, plus the 22
  `BlockDataview*` writes added by task #250).
- **108 called commands have no server case.** They are not one bucket — see §3.
- Only **2 answered commands are never called**: `ChatUnreadMessages` (the client's unread path uses
  `ChatSubscribeToMessagePreviews` counters instead) and `ObjectToSet` (see §4 — the set screen calls
  a *different* entry point). Both still have integration tests, so they are live-but-unreached
  rather than dead.

## 3. The 108 unhandled commands, classified

**(a) Genuine feature gaps — the set/collection/board/gallery screens.** The client renders those
screens from `component/page/main/set.tsx` and `media.tsx`, which mount the block tree and drive the
dataview through 20 commands. **Nineteen of them are now answered** (task #250, `5001bc2`/`f585562`):
`FilterAdd`/`FilterRemove`/`FilterReplace`/`FilterSort`, `SortAdd`/`SortRemove`/`SortReplace`/`SortSort`,
`ViewCreate`/`ViewUpdate`/`ViewDelete`/`ViewSetActive`/`ViewSetPosition`,
`ViewRelationRemove`/`ViewRelationReplace`/`ViewRelationSort`,
`RelationAdd`/`RelationDelete`/`RelationSet`, `GroupOrderUpdate`, `ObjectOrderUpdate`, `SetSource`.
Three of those 22 — `FilterSort`, `ViewRelationRemove`, `SetSource` — are wrapper-only today, with no
call site in this build; they complete one seam rather than leaving the family partly answered.

The one remaining gap is **`BlockDataviewCreateFromExistingObject`** (`block/dataview.tsx:969`,
`block/dataview/head.tsx:121/135/163`, `menu/block/action.tsx:578`): pointing a dataview block inside a
page's body at an existing set, or converting that inline block into a collection. It needs the inline
block to exist as a block with its own target object, which the body model does not yet project (the
Yjs dataview node from task #229 lives only in the document), so it is tracked as its own task rather
than half-implemented here.

Call sites of the answered family: `component/block/dataview/*`, `component/menu/dataview/*`,
`lib/dataview.ts`, and `component/sidebar/page/widget.tsx` (the sidebar widget's sort menu). ADR-0012
stores a view as an object and the shim already reads views (`ObjectSearchSubscribe` honors a set's
stored filters), so the read side exists and only the write side is missing.

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

1. **A converted set rendered nothing** (task #249) — **fixed**. Three causes, each with a test:
   `objectDetails()` hardcoded the Page layout (`bc5e309`); a set owned no dataview block, which is
   the only child the set screen draws (`d6d5de2`); and the space had no relation rows, so the grid's
   columns could not resolve and its cells stayed empty. Verified live: the set now routes to
   `/main/set/<id>` and its grid lists the Name column with all eight member objects.
2. **A space boots with no relation registry** (task #255) — **fixed** with the same boot path that
   installs the default types: `name`, `done`, `description`, `createdDate`, `lastModifiedDate`,
   writer-gated like the types. Before this, `relation-<spaceId>` answered `total: 0` for a real
   space while `type-<spaceId>` answered 4.
3. **Dataview writes are unsupported** (§3a) — **fixed** for the whole set-screen family (`5001bc2`,
   `f585562`). Live verification caught a defect the tests had missed: `ViewCreate` answered the row id
   while the event it pushed carried a separately minted one, so the screen's lookup by the answered id
   (`controls.tsx:342`) found nothing and the new view never opened. Verified live in the browser: a
   created view now appears in the client's store under the answered id, a filter added to it lands in
   the store without a reload, and the view survives a reload and comes back with the same id.
   Remaining: `BlockDataviewCreateFromExistingObject` (§3a) for dataview blocks inside a page body.
4. **The AI writing tools cannot stream** — `service.ts:383-394` keeps `client`/`streamClient`
   instances that nothing uses, and `getDescriptor` (`:397-425`, path
   `/anytype.ClientCommands/<Name>`) is dead. Any `C.AI*` call that expects a stream has no transport.
5. **Publish links pointed off-box** — **fixed**. `U.Space.getPublishDomain` built the link from the
   participant identity (`J.Url.publish` = `any.coop/%s`), so every published page's link led to the
   hosted service while this harness serves `GET /api/publish/:uri` itself. The link is now
   `<api base>/publish/<uri>` (`lib/util/space.ts`), with the slug encoded so it stays the single
   addressable segment the route requires, and it reads its base from `lib/web/serverAddress` — the
   same helper `ServiceClient.commandBase` now delegates to, which removes one of the three duplicate
   base-URL implementations §5 lists. Verified live: `PublishingCreate` → the link the client shows
   returns 200 with the object's name, and after `PublishingRemove` the same link 404s.
6. **`?width=` is ignored** on `/image/:id` (P5-g, known).
7. **A reload loses the object it was asked for** — **fixed**. Reloading
   `/main/set/<id>/spaceId/<spaceId>` ended on `/main/edit/<widgets object>` (tab title "Widgets"): the
   web boot (`front_web/src/ts/app.tsx`, `bootWebAccount`) called
   `U.Router.switchSpace(account.info.accountSpaceId, '', false, routeParam, true)` with an **empty
   route**, so `U.Data.onSpaceSwitch` took the non-restorable path and opened the dashboard — while
   `routeSync` treats memory history as the source of truth and never read the address bar back. The
   boot now prefers a `/main/...` URL (`app.tsx:353`) and hands both its space and its route to
   `switchSpace`, the way the desktop path already did at `app.tsx:541`. Verified live: the set URL
   reloads to `/main/set/<id>` with its grid (8 rows, Name column), and a bare-root boot still lands
   on Widgets. The server was never at fault — `ObjectOpen` answered the full dataview block both times.

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

**Frontend:** the grpc-web residue — `lib/api/dispatcher.ts:7,62`,
`lib/api/grpc-devtools.ts` + its `.d.ts`, `package.json` `grpc-web`, `electronMock.ts:477`
`window.GRPC_SERVER_ADDRESS`, `src/json/url.ts:29` `api: '127.0.0.1:31009'` feeding
`store/auth.ts:22`; and the unreachable legacy block-editor handlers named in §3b.

Two of §5's items are now **closed**:

- *The duplicated base-URL helper.* `lib/web/serverAddress.ts` is the one implementation; both
  `ServiceClient.commandBase` and `lib/api/spaces.ts`'s `apiBase` delegate to it, so the command shim,
  the SSE channel and the space bootstrap cannot drift to a retired host.
- *The transport was not durable.* `lib/api/service.ts` was gitignored as a codegen artifact —
  `scripts/generate-service-registry.js` wrote the whole file from an embedded template that still
  emitted the **gRPC-web** client. So the REST/SSE transport lived only in the working copy: a fresh
  clone had no client, and the documented `pnpm generate:protos` step silently reverted it. The
  generated half is now `lib/api/service-registry.ts` (still ignored, reproduced byte-identically),
  `service.ts` is hand-written and tracked, and the generator no longer touches it.

`ServiceClient.getDescriptor` / `descriptorCache` / `client` / `streamClient` / `hostname` remain dead
— they only feed the retired proto framing, and `service-registry.ts` is their sole consumer. Removing
them is the rest of task #251.

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
