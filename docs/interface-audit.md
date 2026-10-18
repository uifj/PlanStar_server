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
- The shim answers **129** distinct command names (105 at the audit's first pass, the 22
  `BlockDataview*` writes added by task #250, the inline-block binding of item 24, and `AIListModels`).
- **106 called commands have no server case.** They are not one bucket — see §3.
- Only **2 answered commands are never called**: `ChatUnreadMessages` (the client's unread path uses
  `ChatSubscribeToMessagePreviews` counters instead) and `ObjectToSet` (see §4 — the set screen calls
  a *different* entry point). Both still have integration tests, so they are live-but-unreached
  rather than dead.
- **Measurement caveat:** the split above is derived from literal `C.<Name>(` call sites. Four names
  are dispatched through a computed reference (`C[cmd]`) and so are outside those counts —
  `BlockCopy`/`BlockCut` from `lib/action.ts:679` and `BlockTextListSetColor`/
  `BlockListSetBackgroundColor` from `component/menu/block/action.tsx:497`. All four are legacy
  `Block*` writes; §3b records which of their call sites this build can actually reach. The inventory's
  own `unresolved` list (`needs-review`, 59 entries) is where the generator parks exactly this kind of
  dynamic expression — read it rather than assuming the counts are exhaustive.

## 3. The 106 unhandled commands, classified

**(a) Genuine feature gaps — the set/collection/board/gallery screens.** The client renders those
screens from `component/page/main/set.tsx` and `media.tsx`, which mount the block tree and drive the
dataview through 20 commands. **Nineteen of them are now answered** (task #250, `5001bc2`/`f585562`):
`FilterAdd`/`FilterRemove`/`FilterReplace`/`FilterSort`, `SortAdd`/`SortRemove`/`SortReplace`/`SortSort`,
`ViewCreate`/`ViewUpdate`/`ViewDelete`/`ViewSetActive`/`ViewSetPosition`,
`ViewRelationRemove`/`ViewRelationReplace`/`ViewRelationSort`,
`RelationAdd`/`RelationDelete`/`RelationSet`, `GroupOrderUpdate`, `ObjectOrderUpdate`, `SetSource`.
Three of those 22 — `FilterSort`, `ViewRelationRemove`, `SetSource` — are wrapper-only today, with no
call site in this build; they complete one seam rather than leaving the family partly answered.

That leaves **no gap in this family**: `BlockDataviewCreateFromExistingObject` — the last one, at
`block/dataview.tsx:969`, `block/dataview/head.tsx:121/135/163` and `menu/block/action.tsx:578` — is
answered too (item 24). Which object an inline block shows is carried by the block's own Yjs attrs, so
the command answers the target's views rather than duplicating that state.

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

One member of the family is **not** unreachable: `component/page/main/history.tsx:50` binds
`Cmd/Ctrl+C` and `Cmd/Ctrl+X` on the history pane to `Action.copyBlocks`, which dispatches
`BlockCopy`/`BlockCut` dynamically (`lib/action.ts:679` `C[cmd](…)`, so the name never appears in
`C.<Name>(` form and sat outside §2's 231). The shim answers `NOT_SUPPORTED`, and the callback returns
before `U.Common.clipboardCopy` — but `keyboard.shortcut()` invokes its callback without cancelling the
event, so the browser's own copy still puts the selected text on the clipboard. What is lost is
Anytype's block-structured payload (`textSlot`/`htmlSlot`/`anySlot`), i.e. paste-into-another-surface
as blocks. Deliberate boundary of the same class as `ObjectUndo`/`ObjectRedo` above, not a white
screen. The other two dynamic sites (`menu/block/action.tsx:497` →
`BlockTextListSetColor`/`BlockListSetBackgroundColor`, and `block/table.tsx:897`) belong to menus the
page no longer mounts.

**(c) Intentional boundaries — native, desktop, paid, external.** Account/wallet keys
(`Wallet*`, `AccountCreate`/`Delete`/`Recover`/`Migrate*`, `AccountLocalLink*`), membership,
push-notification registration, `Debug*` (keyboard-only), `Unsplash*` and `Gallery*` (external
services), `ObjectImport*`/`ObjectListExport` (P5-f), `FileDrop` (P5-e), `FileNodeUsage`/
`FileSetAutoDownload`/`FileAutoDownloadSetLimit` (already documented as code 12), and the AI stream
commands (`AIListModels` is answered now, item 25; the streaming `AI*` family has no call site left in
this build at all — the `streamClient` it used to ride was deleted with the transport, so nothing in
`src/ts` asks for a stream).

**`ObjectUndo`/`ObjectRedo` (keyboard.ts:1298/1323) are a deliberate boundary, not a missing
transport.** Body undo and redo work — the Yjs document's own `UndoManager` handles Cmd+Z in the
editor, verified during the live body-sync round. What the commands would add is *detail-level* undo
(reverting a featured-relation edit or a property change), which needs a per-object change log every
write command would have to record; that is a feature, not an interface gap, so the commands answer
code 12 rather than faking a success. Do not re-litigate this as "no transport": the transport exists,
the state it would need to replay does not.

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
   `BlockDataviewCreateFromExistingObject` (§3a) is now answered too — see item 24.
4. **The AI writing tools cannot stream** — **not a defect in this build**. Re-checked against the
   vendored shell: `command.ts` exports exactly one AI wrapper, `AIListModels` (answered, item 25), and
   the transport's only stream seam is `listenSessionEvents` (`lib/api/service.ts:41`), which carries
   session events, not AI. There is no `C.AI*` streaming call site left to give a transport to, so the
   gRPC-web deletion removed nothing the AI feature used (task #254 closed on this evidence).
5. **Publish links pointed off-box** — **fixed**. `U.Space.getPublishDomain` built the link from the
   participant identity (`J.Url.publish` = `any.coop/%s`), so every published page's link led to the
   hosted service while this harness serves `GET /api/publish/:uri` itself. The link is now
   `<api base>/publish/<uri>` (`lib/util/space.ts`), with the slug encoded so it stays the single
   addressable segment the route requires, and it reads its base from `lib/web/serverAddress` — the
   same helper `ServiceClient.commandBase` now delegates to, which removes one of the three duplicate
   base-URL implementations §5 lists. Verified live: `PublishingCreate` → the link the client shows
   returns 200 with the object's name, and after `PublishingRemove` the same link 404s.
6. **`?width=` is ignored** on `/image/:id` — **deferred by decision** (task #154): full-size bytes
   reach the screen today, so this is bandwidth, not a broken feature.
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
8. **Every ownership-gated screen was dead** (task #259) — **fixed**. `U.Space.getMyParticipant` reads
   `_participant_<spaceId>_<accountId>` out of the `subSpace-<spaceId>` subscription, and
   `isMyOwner` / `canManageInvite` / `canMyParticipantModerate` / `canMyParticipantWrite` all answer
   false (or null) when that record is missing. The subId sat in `EMPTY_SUB_IDS`, so the members screen
   rendered its list but no share panel, member controls were hidden, and `U.Space.getCreator` never
   resolved. `subSpaceRecords` now merges the space's participants with the requested objects, and the
   space view names its creator by participant id. Verified live: `isMyOwner` flips false → true and the
   share sheet renders its toggle, Copy link, QR, Manage link and Reset link.
9. **The settings content-model rail was empty, then white-screened** (task #261) — **fixed**. `library`
   was also in `EMPTY_SUB_IDS`; its rows are registry records (the type/relation mirror rows are hidden
   from object lists), so it is answered from `typeRecords`/`relationRecords` narrowed by the rail's own
   filters. Fixing the emptiness exposed the second defect: `S.Block.isAllowed` reads
   `restrictions.indexOf`, and every projection sent `{}` for "no restrictions" — an object there throws
   inside the row renderer and React unmounts the whole tree. `restrictions` is a list. Verified live:
   the rail lists Collection / Page / Task / Template and opens the type editor.
10. **An `id In [...]` filter was ignored** (task #260) — **fixed**. `id` was missing from
    `SYSTEM_RELATIONS`, so the filter either fell to the details-JSONB path (matches nothing) or, with no
    wire format, was dropped outright. Live: one requested id returned all 46 live objects in the space.
11. **An invite link the web build cannot open** — **fixed**. `getInviteLink` always built an
    `anytype://` link, a scheme only the desktop registers. The web build now hands out its own
    `/invite/?cid=…&key=…` route.
12. **The graph drew no edges** — **fixed**. `graphRecords` read edges from the Link table only, while
    the command write path (`ObjectListSetDetails`, the property editor) stores an object relation in
    the object's `details` JSONB (ADR-0002) — the store `navigationObjectInfo` already reads for
    backlinks. Live: 29 nodes, 0 edges. It now unions both stores and de-duplicates a pair written to
    each. The existing test passed throughout because it seeded `prisma.link` directly instead of using
    the write path it claims to cover.
13. **The space Chat page had no chat** — **fixed**. `block/chat.tsx` resolves what it reads as
    `spaceview.chatId || rootId`, and the space view projected `chatId: ""` with no chat object behind
    it: the page rendered a composer over an empty room and every read answered NOT_FOUND. A space now
    provisions a chat system object (layout 22, hidden like the other three) and names it in its space
    view; `numericLayout` lets the details marker decide when the column can only be reporting its
    `basic` default, since the `ObjectLayout` enum has no name for a chat.
14. **Chat messages never look like they are yours** — **fixed**. The client computes
    `isSelf = message.creator == account.id` and derives the author with
    `getParticipantId(space, creator)`, so `creator` is an account id; `chat-service.ts` projected a
    participant id, which double-prefixed the lookup. Live, my own message rendered as someone else's
    with the author "Untitled". The same convention turned out to govern the two sibling fields:
    reaction buckets (`message/reaction.tsx:19` tests `authors.includes(account.id)`) and
    `ChatSearch`'s `creators`, which the search bar sends as a bare identity
    (`popup/search.tsx:2202`) while the object-search token sends both forms — so a filter that only
    decoded participant ids matched nothing. `creator`, reaction ids and the read-state mention
    lookups now speak account ids, and the creator filter accepts either form.
15. **The Chat page stormed `ChatReadMessages` forever** — **fixed**. Opening the space chat fired
    ~28 000 read requests in two minutes (the dev row's `order` reached 57 058), saturating the tab so
    every other fetch failed. `store/chat.ts:432` applies a `ChatStateUpdate` only when its `order` is
    *greater* than the one it holds, and every read — including one that moved no watermark — minted a
    fresh order. The resulting store write re-rendered the block, whose no-overflow scroll path calls
    `readScrolledMessages` again (block/chat.tsx:1564), which reads again. A read that changes nothing
    now returns the state untouched, so the cycle has no second turn.
16. **No chat delta ever reached an open list** — **fixed**. Every chat event was emitted with
    `subIds: []`, and the dispatcher routes each one *by* subId (`checkVaultSubscriptionIds`,
    dispatcher.ts:1222/:1333/:1398) — an empty list resolves to nothing, so a reaction pill never
    rendered even for the person who clicked it, and a peer's open chat applied no push. Opening a
    chat now registers its subId as a watch (released by `ChatUnsubscribe`, dropped when it goes quiet,
    since a closed tab sends no teardown), each session receives its own addresses, and delete/edit/
    reaction/pin fan out to peers the way ChatAdd already did.

17. **`ObjectSearch` answered nothing for a search with no text** — **fixed**. `searchRecords`
    returned `[]` whenever `fullText` was empty and never looked at `filters`, so every filter-only
    search — the link-to picker, the relation-value picker, a template target list — came back empty.
    Live, `ObjectSearch(space, [{name: 'type', Equal, <typeId>}])` returned 0 records against a space
    holding 22 visible objects. It now runs the same registry-validated filter compiler the
    subscriptions use, and an empty query means "no text constraint" rather than "no results";
    `ObjectSearchWithMeta` narrows by its filters the same way.

18. **A type screen listed nothing** — **fixed**. Clicking a type in the rail opens the **type
    object itself** at `/main/set/<typeId>`, and that screen draws only the root's dataview child,
    resolving its query's sources from the record's `setOf` (`block/dataview.tsx:401`). A type had
    neither views nor a source, so the page came up as a header over an empty body — live, "Page"
    showed nothing while the space held seven page objects. Opening a type now heals it into a set
    over its own objects: `setOf: [typeId]` on the record and the same default-view child a set gets.

19. **The Bin could never show anything** — **fixed**. `page/main/archive.tsx` lists its objects
    through `subId: "archive"` with its own `isArchived Equal true` filter (`archiveListTree.tsx:36`),
    and "archive" sat in `EMPTY_SUB_IDS` — a set whose premise is "this subId is not a general object
    list". It is one, so every Bin came back "Your Bin is empty" and Restore was unreachable. Live:
    archiving an object now puts a named row with its date in the Bin, and restoring empties it again.

20. **Every message was born "edited"** — **fixed**. `addMessage` stamped `modifiedAt` with the
    creation time, and the bubble labels a message edited for *any* non-zero value
    (`block/chat/message/index.tsx:261`) — so a freshly posted chat message and every comment carried
    the "(edited)" tag before anyone could edit it. `modifiedAt` is now 0 until `ChatEditMessageContent`
    sets it. Live: a new post renders "text 22:38" with no label, and editing it still produces the
    projected `modifiedAt` and the label. (Rows written before this fix keep the badge until they are
    edited; no back-fill was run on the dev database.)

21. **A join request could not be approved** — **fixed**. `popup/invite/confirm.tsx:67-68` subtracts
    the space's active participants from `spaceview.readersLimit` / `writersLimit` and, when the
    remainder is not a positive number, replaces Accept/Reject with the hosted plan's
    "✦ Add more channel members" upsell (`Action.membershipUpgrade`). The space view projected
    `readersLimit: 0, writersLimit: 0` — "this server sells no membership" — which the store
    normalizes to a number, so the subtraction came out non-positive and the sheet's **only** Approve
    path was gone, including from the notification that asks the owner to approve. A self-hosted space
    now reports 1000 seats of each kind (the value also keeps the members upsell banner hidden).
    Found only by running the two-account flow: every command on that path answered OK while the UI
    offered nothing.

22. **A collection page drew no list** — **fixed**. `U.Object.getSetLayouts()` routes a Collection to
    the *same* screen as a set, and that screen draws only the root's dataview child — but the view
    healing in `loadObjectView` covered only Set (3) and Type (4). A converted object therefore
    arrived as a header with a composer-less empty body, even though its membership was stored and
    servable. A collection now heals like a set (its `setOf` points at itself so the default view has
    something to be created against) while its rows keep arriving through the `collectionId` the
    screen sends in place of a query source (`widget/view/index.tsx:130`). That still left the grid
    empty, and the client's own log said why: `[BlockDataview.loadData] No sources` —
    `block/dataview.tsx:246` refuses to request records unless the block reports sources **or** is a
    collection, and it reads "is a collection" from the block *content* (`mapper.ts:278`:
    `TargetObjectId` / `isCollection`), which the projection pinned at `""`/`false`. The projected
    block now names the collection as its own target, and the page renders its members: verified with
    the grid on screen showing "Name / Bergen wharf / Trollstigen lookout".

23. **`type.uniqueKey` narrowed nothing in a search** — **fixed**. The nested key (an object's
    `typeId` pointing at an `ObjectType.uniqueKey`) is resolved by `typeUniqueKeyClause` for
    subscriptions, but `searchRecords` and `searchRecordsWithMeta` only ran the flat compiler, which
    drops any key containing a dot. So `U.Data.countTemplatesByTypeId`'s filter
    (`lib/util/data.ts:756`) — and the template rail's — was ignored and the search answered with
    every visible object: live, asking for `ot-template` returned the space's pages. Both search
    entries now AND in the same clause. Found while looking for a template to apply; the first test
    for it passed vacuously (it only asserted that hidden registry rows stayed out) and had to be
    rewritten around two *visible* objects of different types to actually go red.

24. **A dataview block in a page body could not be bound to a set** — **fixed**.
    `BlockDataviewCreateFromExistingObject` was unanswered (NOT_SUPPORTED 12), so the inline block's
    source picker — "create new set", "create new collection", or pick an existing one
    (`block/dataview.tsx:969`, `dataview/head.tsx:121/135/163`) — left the block with nothing: the
    client loads `message.views[0].id` from the answer. It now gates on write access to the hosting
    page, keeps the target inside that page's space (a page must not read another space's view list),
    heals the target's default view and answers `{blockId, targetObjectId, view}`. The binding itself
    stays where it belongs — the block's Yjs attrs (ADR-0018). Two gaps surfaced on the way:
    `ensureSetViews` only reused stored views when the holder had a source type, so a set created
    without one gained a **fresh view on every open** (the test caught it as two different ids), and
    the view repository always wrote a source edge, which a sourceless view would have written as a
    dangling `toId: ""`. Verified live: binding a set through the client's own command returns a Grid
    view with the Name column.

25. **Settings → AI could not validate a provider** — **fixed**. `AIListModels` was unanswered, so the
    screen's one AI call — the call that *is* its config check, since a returned list simultaneously
    proves the endpoint reachable, the token valid and the models present
    (`settings/import/aiSettings.tsx:58`) — failed with code 12 and the model dropdown stayed empty.
    It now asks the configured OpenAI-compatible `<endpoint>/models` with the caller's bearer token and
    answers `models: [{id, ownedBy}]`, or the `I.AiListModelsErrorCode` the screen renders
    (103 rejected token, 101 unreachable, 100 rate limited, 2 invalid config, 1 malformed answer).
    Because the fetch leaves the server, the endpoint host goes through the same classification a link
    preview uses, with one deliberate exception: loopback stays allowed, since the local providers this
    screen offers (Ollama, LM Studio) live there. Redirects are not followed — the guard vetted the
    host the caller typed, not whatever it points at next. Verified live: an unreachable local provider
    comes back through the client transport as code 101 with a description.

26. **The history diff marked nothing** — **fixed**. `HistoryDiffVersions` answered events keyed by
    `prisma.block` row ids, but the pane's block tree is not those rows: `HistoryShowVersion` projects
    the version's own paragraphs into the objectView (`versionBodyView`), so `renderDiff`
    (`component/page/main/history.tsx:53`) resolved `#block-<id>` against a tree that never contained
    them and dropped every marker; the fallback `objectDetailsAmend` on the snippet highlights nothing
    either, since its mapper looks for `details.name`/`description`/`iconEmoji`. The earlier note that
    this was architecturally blocked was wrong — the left pane renders the **legacy `<Block>` tree**
    (`history/left.tsx:102`), which does emit `#block-<id>` (`component/block/index.tsx:1282`); the Yjs
    body never appears on this screen. Both sides now come from one projection
    (`collab/projection.ts`: `versionBodyLines` + `bodyLineId`), whose ids are the line **ordinal**, so
    a line matches itself across the version pair the client diffs — a per-version id never could.
    Rewritten lines go out as `blockSetText`, lines only the newer version has as `blockAdd`, and a
    dropped line as the root's `blockSetChildrenIds`, which is the only event
    `history.tsx:120` can read a removal from. Pairs that turn out to be identical (a line shifted by
    an insertion further down) are skipped, or the pane paints a change marker on untouched text.
    Residual approximation, stated plainly: while a version is a flat list of lines, a mid-document
    deletion marks where the ordinals stop matching, not the deleted line itself. Verified live:
    `.diffAdd` on the added block's `.wrapContent`, `<markupchange> south</markupchange>` inside the
    rewritten one, and a `.diffRemove` for the dropped lines.

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

**Frontend — retired, this pass:** the gRPC-web machinery is gone from the transport. `lib/api/service.ts`
is now the whole seam: a JSON `fetch` to `<base>/command/<Name>` plus an `EventSource` on
`<base>/events`, with a local `SessionStream` (`on`/`cancel`) in place of grpc-web's
`ClientReadableStream`. Deleted with it: `GrpcWebClientBase`/`MethodDescriptor`/`MethodType` usage,
`descriptorCache` + `getDescriptor`, the 346-entry `registry` map and the generator step that wrote
`service-registry.ts`, `lib/api/grpc-devtools.ts` + its `.d.ts` and the interceptor options
`dispatcher.init` passed, and `electronMock`'s `GRPC_SERVER_ADDRESS` fallback. The generated proto
bindings under `middleware/` stay (the message types the shell maps are built from them) and
`package.json` no longer lists `grpc-web` or `google-protobuf`: nothing imported them once the
transport was hand-written, `scripts/generate-protos.sh` runs ts-proto alone (no grpc-web plugin), and
removal was an explicitly approved dependency change. Gates after it: the client's own `pnpm typecheck`
and 1397 tests pass, and the web app boots unchanged. Pinned by
`src/ts/lib/api/service.transport.test.ts` (command fetch, HTTP-failure callback, SSE frame wrapper
with its base64 payload decoded, `cancel` closing the source).

**Base URL:** `lib/web/serverAddress.ts` is the only resolution, and it now owns the precedence the
entry point advertises — `?server=` param, then the address a previous boot stored, then the
configured/same-origin API base. Before this, `entry.web.tsx` resolved the param but the transport
resolved its own env/origin value, so the documented `?server=http://HOST:PORT` override moved the
boot log and nothing else.

**Still standing, and deliberately:** `src/json/url.ts` `api: '127.0.0.1:31009'` is not transport — it
is only the default *port* for the Local JSON API setting (`store/auth.ts:22` parses it), and
`dispatcher.metadata()` still builds the token/`local-api-secret` headers for the unary path, which
the web transport ignores. The unreachable legacy block-editor handlers named in §3b are left alone
for the same reason: they are dead in this build, not wired to anything.

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
