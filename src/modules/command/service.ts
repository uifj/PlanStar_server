import { ensureSpaceAccess, PERMISSION_RANK } from "../../auth/space-access.js";
import { APP_VERSION, PAGINATION } from "../../config/constants.js";
import type { AuthUser } from "../../lib/auth.js";
import {
	bodySnippetFromState,
	bodyTextFromState,
} from "../collab/projection.js";
import { storeDocument } from "../collab/server.js";
import {
	coerceBytes,
	publish as publishPubsub,
	subscribe as subscribePubsub,
	unsubscribe as unsubscribePubsub,
} from "../pubsub/service.js";
import { spaceEvents } from "../pubsub/space-events.js";
import { subscriptionRegistry } from "../pubsub/subscription-registry.js";
import {
	accountForSpaceId,
	accountInfo,
	createSpace,
	ensureAccount,
	leaveOrDeleteSpace,
	listAccounts,
	renameSpace,
	setSpaceHomepage,
	setSpaceOrder,
	spaceViewRecord,
	unsetSpaceOrder,
} from "./account-service.js";
import {
	addMessage,
	type ChatRecord,
	deleteMessage,
	editMessage,
	getMessagePreviews,
	getMessages,
	getMessagesByIds,
	getPinned,
	readAllChats,
	readMessages,
	readReactions,
	searchMessages,
	setPinned,
	toggleReaction,
	unreadMessages,
} from "./chat-service.js";
import {
	chatDeltaFor,
	chatEventFor,
	dropChatWatches,
	watchChat,
} from "./chat-subscriptions.js";
import {
	DATAVIEW_WRITE_COMMANDS,
	type DataviewWrite,
	dataviewWrite,
} from "./dataview-write.js";
import { uploadFile } from "./file-service.js";
import {
	fetchLinkPreview,
	PreviewNotAllowedError,
} from "./link-preview-service.js";
import {
	listNotifications,
	replyNotifications,
} from "./notification-service.js";
import {
	addCollectionMembers,
	addDiscussion,
	addObjectRelations,
	applyTemplate,
	convertToCollection,
	convertToSet,
	createdBookmarkDetails,
	createdDateDetails,
	createdSetDetails,
	createObject,
	createObjectFromUrl,
	createObjectType,
	createRelation,
	createRelationOption,
	createSetObject,
	createTemplateFromObject,
	duplicateObjects,
	fetchBookmarkFor,
	findOrCreateDateObject,
	isPersonalWidgetsId,
	loadObjectView,
	modifyObjectDetailValues,
	objectDetails,
	personalWidgetsView,
	relationOptionDetails,
	removeCollectionMembers,
	removeObjectRelations,
	removeRelationOptions,
	setFeaturedRelations,
	setObjectDetails,
	setObjectSources,
	setObjectsArchived,
	setObjectsType,
	setObjectType,
	softDeleteObjects,
	versionBodyView,
} from "./object-service.js";
import {
	getPublishStatus,
	listPublished,
	PublishError,
	publishObject,
	removePublished,
} from "./publishing-service.js";
import {
	archivedRecords,
	boardGroups,
	cleanupSuggestions,
	collectionRecords,
	conflictingRelationIds,
	crossSpaceSearchRecords,
	deletedRecords,
	deletionAuditRecords,
	documentVersionById,
	graphRecords,
	historyDiffEvents,
	historyVersions,
	isTypePickerQuery,
	libraryRecords,
	navigationObjectInfo,
	objectRecords,
	objectSpaceId,
	optionRecords,
	participantRecords,
	recentRecords,
	relationRecordById,
	relationRecords,
	relationsWithValue,
	searchRecords,
	searchRecordsWithMeta,
	searchTypeRecords,
	setCleanupIgnored,
	setRecords,
	setRelationOptionOrder,
	setTypeOrder,
	subSpaceRecords,
	subscribeIdsRecords,
	targetObjectTypeClause,
	typeRecordById,
	typeRecords,
	typeUniqueKeyClause,
} from "./registry-service.js";
import type { CommandBody } from "./schema.js";
import {
	setFilterPredicate,
	setSortComparator,
	translateSetFilters,
	translateSetSorts,
} from "./set-query.js";
import {
	changeInvitePermissions,
	generateInvite,
	getCurrentInvite,
	joinSpace,
	makeSpaceShareable,
	revokeInvite,
	stopSharing,
	viewInvite,
} from "./space-invite-service.js";
import {
	addParticipants,
	approveRequest,
	changeOwnership,
	changeParticipantPermissions,
	declineRequest,
	removeParticipants,
} from "./space-member-service.js";

const OK = { code: 0, description: "" };

// Any nonzero code routes the shell through its normal error envelope, so an
// unsupported command degrades gracefully instead of throwing.
const NOT_SUPPORTED = {
	code: 12,
	description: "Command is not supported by the web backend.",
};

const NOT_FOUND = { code: 3, description: "Object not found." };
const FORBIDDEN = { code: 2, description: "Object access denied." };

const SPACE_SUB_ID = "space";

// Per-space object registries the shell subscribes to as `<prefix>-<spaceId>`
// (subscription.ts createSpace). Each source projects real rows into the record
// shape the client's mappers expect. recentEditMe scopes to the caller's own
// objects; recentEditAll spans the space.
const REGISTRY_SOURCES: Record<
	string,
	(spaceId: string, userId: string) => Promise<Record<string, unknown>[]>
> = {
	type: typeRecords,
	relation: relationRecords,
	participant: participantRecords,
	option: optionRecords,
	deleted: deletedRecords,
	archived: archivedRecords,
	recentEditAll: (spaceId) => recentRecords(spaceId),
	recentEditMe: (spaceId, userId) => recentRecords(spaceId, userId),
};

// Subscription ids (J.Constant.subId, keyed by their `<prefix>-<spaceId>` head) that are NOT
// general object lists and must stay empty rather than be answered with Obj rows: the chat /
// discussion message feeds, the type/relation/store registries read through their own subIds,
// the graph tree-edge probes, the file-manager views and the template list (which
// needs a type.uniqueKey join a later slice adds — until then it must not leak every object).
// Anything else that names a space is an object-list widget subscription (All objects /
// Favorites / Bin and the per-widget tree/list subIds), which the general branch below answers.
// `subSpace` and `library` are neither: each has its own branch, because the client resolves a
// space's people from the first and its content-model rail from the registries behind the second.
const EMPTY_SUB_IDS = new Set<string>([
	"profile",
	"typeStore",
	"relationStore",
	"store",
	"archive",
	"sidebar",
	"lastMessage",
	"fileManagerSynced",
	"fileManagerNotSynced",
	"chatPreview",
	"chat",
	"chatGlobal",
	"discussion",
	"discussionGlobal",
	"treeEdges",
	"treeParents",
	"treeProbe",
]);

// The ids an `id In [...]` filter names — how U.Subscription.createSubSpace addresses the space's
// creator, the caller's own participant record and the homepage object.
function idFilterValues(wireFilters: unknown): string[] {
	if (!Array.isArray(wireFilters)) {
		return [];
	}

	const ids: string[] = [];
	for (const raw of wireFilters) {
		const filter = raw as { RelationKey?: unknown; value?: unknown };
		if (filter.RelationKey !== "id") {
			continue;
		}
		if (Array.isArray(filter.value)) {
			ids.push(...stringList(filter.value));
		} else if (typeof filter.value === "string") {
			ids.push(filter.value);
		}
	}

	return ids;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function emptySubscription() {
	return {
		error: OK,
		event: null,
		counters: { total: 0, nextCount: 0, prevCount: 0 },
		records: [],
		dependencies: [],
	};
}

export async function run(
	user: AuthUser,
	name: string,
	body: CommandBody,
): Promise<Record<string, unknown>> {
	switch (name) {
		case "AccountSelect": {
			const account = await ensureAccount(user);

			return {
				error: OK,
				event: null,
				account: {
					id: user.id,
					info: accountInfo(account, user.id),
					config: {},
					// AccountStatusType.Active === 0 in the client's enum.
					status: { statusType: 0, deletionDate: 0 },
				},
			};
		}

		case "WorkspaceOpen": {
			const requested = typeof body.spaceId === "string" ? body.spaceId : "";

			if (!requested) {
				const account = await ensureAccount(user);
				return { error: OK, event: null, info: accountInfo(account, user.id) };
			}

			try {
				await ensureSpaceAccess(user.id, requested, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			// Membership is confirmed, so register this account as a space opener: live
			// object-mutation deltas for this space are pushed to its open tabs (see space-events).
			spaceEvents.track(requested, user.id);

			const account = await accountForSpaceId(requested, user.id);
			if (!account) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null, info: accountInfo(account, user.id) };
		}

		// Response.WorkspaceCreate maps response.spaceId -> objectId, so the new
		// space's id rides in `spaceId` (response.ts:615-620).
		case "WorkspaceCreate": {
			const details =
				body.details && typeof body.details === "object"
					? (body.details as Record<string, unknown>)
					: {};
			const name = typeof details.name === "string" ? details.name : "";
			const account = await createSpace(user, name);

			return {
				error: OK,
				event: null,
				spaceId: account.spaceId,
				startingObjectId: "",
			};
		}

		// The client gates space-info edits on ownership (U.Space.isMyOwner), so a
		// non-owner is denied rather than silently ignored.
		case "WorkspaceSetInfo": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const details =
				body.details && typeof body.details === "object"
					? (body.details as Record<string, unknown>)
					: {};

			try {
				await ensureSpaceAccess(user.id, spaceId, "owner");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			if (typeof details.name === "string" && details.name) {
				await renameSpace(spaceId, details.name);
			}

			return { error: OK, event: null };
		}

		// Choosing the space's home object is a space-info edit, so it is owner-gated like
		// WorkspaceSetInfo. `homepage` may be a real object id or a predefined marker
		// (I.HomePredefinedId.Widget === "widgets"), so it is stored verbatim.
		case "WorkspaceSetHomepage": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const homepage = typeof body.homepage === "string" ? body.homepage : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "owner");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const account = await accountForSpaceId(spaceId, user.id);
			if (!account) {
				return { error: NOT_FOUND, event: null };
			}

			await setSpaceHomepage(account.spaceViewId, homepage);

			return { error: OK, event: null };
		}

		case "SpaceDelete": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			await leaveOrDeleteSpace(user.id, spaceId);

			return { error: OK, event: null };
		}

		// Pinning/reordering the vault rail sends the full ordered list of pinned space views
		// (vault.tsx:198 drag, menu.ts:881 pin). The arrangement is personal, so it lands on the
		// caller's own membership rows (see setSpaceOrder); the response echoes positional order
		// keys the client writes back as each record's orderId (response.ts:739). No space-access
		// gate is needed: the write is scoped to the caller's memberships, so a foreign or stale
		// spaceView id simply matches nothing.
		case "SpaceSetOrder": {
			const spaceViewOrder = Array.isArray(body.spaceViewOrder)
				? body.spaceViewOrder.filter(
						(id): id is string => typeof id === "string",
					)
				: [];

			const orderIds = await setSpaceOrder(user.id, spaceViewOrder);

			return { error: OK, event: null, spaceViewOrder: orderIds };
		}

		// SpaceUnsetOrder is the unpin inverse: it names one spaceView and clears just that
		// space's order key for the caller, leaving the rest of the rail's order intact. No
		// access gate for the same reason as SpaceSetOrder — the write is scoped to the
		// caller's memberships, so a foreign or unknown spaceView id matches nothing.
		case "SpaceUnsetOrder": {
			const spaceViewId =
				typeof body.spaceViewId === "string" ? body.spaceViewId : "";

			await unsetSpaceOrder(user.id, spaceViewId);

			return { error: OK, event: null };
		}

		// The global "space" list and the per-space object registries (type, relation,
		// option, participant) are real. Recents, chats and the cross-space lists stay
		// empty until later slices.
		case "ObjectSearchSubscribe":
		case "ObjectCrossSpaceSearchSubscribe": {
			const subId = typeof body.subId === "string" ? body.subId : "";

			if (subId === SPACE_SUB_ID) {
				const accounts = await listAccounts(user);
				const records = accounts.map((account) => spaceViewRecord(account));

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			// A collection's members are read through the same subscription the shell
			// uses for a dataview, keyed by collectionId. Membership lives in Link
			// (ADR-0002) and is projected in stored order.
			const collectionId =
				typeof body.collectionId === "string" ? body.collectionId : "";
			if (collectionId) {
				let spaceId =
					typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
				if (!spaceId) {
					const account = await ensureAccount(user);
					spaceId = account.spaceId;
				}

				try {
					await ensureSpaceAccess(user.id, spaceId, "reader");
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				const records = await collectionRecords(
					spaceId,
					collectionId,
					translateSetFilters(body.filters),
				);

				subscriptionRegistry.register(
					subId,
					user.id,
					spaceId,
					records.map((record) => record.id),
					collectionId,
				);

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			// A set's records are read through the same subscription, keyed by `source`
			// (the set's setOf type ids) rather than collectionId — lib/dataview.ts
			// getRecords sends source for a set and collectionId for a collection, and
			// command.ts ObjectSearchSubscribe puts the sources array on the `source`
			// field. Every live object in the space whose type is one of them comes back.
			const sources = stringList(body.source);
			if (sources.length > 0) {
				let spaceId =
					typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
				if (!spaceId) {
					const account = await ensureAccount(user);
					spaceId = account.spaceId;
				}

				try {
					await ensureSpaceAccess(user.id, spaceId, "reader");
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				const runner = () =>
					setRecords(
						spaceId,
						sources,
						translateSetFilters(body.filters),
						translateSetSorts(body.sorts),
						setSortComparator(body.sorts),
						setFilterPredicate(body.filters),
					);

				const records = await runner();

				subscriptionRegistry.register(
					subId,
					user.id,
					spaceId,
					records.map((record) => record.id),
					"",
					runner,
				);

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			const registry = subId.split("-")[0];

			// The per-space subSpace subscription: the client reads its own participant record out of
			// it, so isMyOwner / canManageInvite / canMyParticipantModerate / canMyParticipantWrite —
			// and with them the share sheet, member management and the Bin entry — decide on this answer.
			if (registry === "subSpace") {
				let spaceId =
					typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
				if (!spaceId) {
					const account = await ensureAccount(user);
					spaceId = account.spaceId;
				}

				try {
					await ensureSpaceAccess(user.id, spaceId, "reader");
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				const records = await subSpaceRecords(
					spaceId,
					idFilterValues(body.filters),
				);

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			// The settings content-model rail lists the space's types or properties out of the
			// registries, not out of the object table, so it is answered the same way the type
			// picker is rather than left empty.
			if (registry === "library") {
				let spaceId =
					typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
				if (!spaceId) {
					const account = await ensureAccount(user);
					spaceId = account.spaceId;
				}

				try {
					await ensureSpaceAccess(user.id, spaceId, "reader");
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				const records = await libraryRecords(spaceId, body.filters);

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			if (REGISTRY_SOURCES[registry]) {
				let spaceId =
					typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
				if (!spaceId) {
					const account = await ensureAccount(user);
					spaceId = account.spaceId;
				}

				try {
					await ensureSpaceAccess(user.id, spaceId, "reader");
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				const source = REGISTRY_SOURCES[registry];
				const records = await source(spaceId, user.id);

				// The Recent widgets list live objects, so they reconcile like any other
				// query-backed view. The registry sources (types, relations, options,
				// participants) and the deleted/archived bins stay unregistered: their rows are
				// not the object projections a delta addresses, and a delete must not pull an
				// object out of the very list that exists to show deleted ones.
				if (registry === "recentEditAll" || registry === "recentEditMe") {
					subscriptionRegistry.register(
						subId,
						user.id,
						spaceId,
						records.map((record) => record.id as string),
						"",
						() => source(spaceId, user.id),
					);
				}

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			// Everything else that names a space is a general object-list subscription: the
			// sidebar widgets (All objects / Favorites / Bin) and the per-widget tree/list
			// subscriptions send filters + keys + sorts with no collectionId and no set source.
			// The client's getBaseFilters already injected isDeleted/isArchived/isHidden (and the
			// widget adds isFavorite/resolvedLayout) constraints, so translateSetFilters narrows
			// faithfully and objectRecords projects the live rows. The special-purpose subIds in
			// EMPTY_SUB_IDS are not object lists and fall through to empty rather than leak Obj rows.
			if (!EMPTY_SUB_IDS.has(registry)) {
				let spaceId =
					typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
				if (!spaceId) {
					const account = await ensureAccount(user);
					spaceId = account.spaceId;
				}

				try {
					await ensureSpaceAccess(user.id, spaceId, "reader");
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				const where = {
					AND: [
						translateSetFilters(body.filters),
						await typeUniqueKeyClause(spaceId, body.filters),
						targetObjectTypeClause(body.filters),
					],
				};
				const orderBy = translateSetSorts(body.sorts);
				const compare = setSortComparator(body.sorts);
				const predicate = setFilterPredicate(body.filters);
				// The same query is re-run on later creates to reconcile this view (see
				// reevaluate) — captured here so membership is decided exactly as it was now.
				const runner = () =>
					objectRecords(spaceId, where, orderBy, compare, predicate);

				const records = await runner();

				subscriptionRegistry.register(
					subId,
					user.id,
					spaceId,
					records.map((record) => record.id),
					"",
					runner,
				);

				return {
					error: OK,
					event: null,
					counters: { total: records.length, nextCount: 0, prevCount: 0 },
					records,
					dependencies: [],
				};
			}

			return emptySubscription();
		}

		case "ObjectSearchUnsubscribe": {
			// Drop the registry snapshot so a later delete no longer pushes SubscriptionRemove to
			// a view the client has closed. The client-side teardown is still the real cleanup;
			// this only prunes the live-update bookkeeping.
			for (const subId of stringList(body.subIds)) {
				subscriptionRegistry.remove(subId);
			}

			return { error: OK, event: null };
		}

		// ObjectClose { objectId, spaceId } (action.ts:43) is the shell's best-effort
		// teardown notification, fired only after the client has already cleared its own
		// object and subscription state. Opening a view is a pure read here — the web
		// backend keeps no server-side open-object handles — so there is nothing to
		// release and it answers OK unconditionally, mirroring ObjectSearchUnsubscribe.
		case "ObjectClose":
			return { error: OK, event: null };

		// Hydrate the details of a known set of object ids (U.Subscription.subscribeIds).
		// The records are the space's objects for those ids, in request order; dependencies
		// stay empty as they do for the other subscriptions (the client hydrates referenced
		// objects through their own subscriptions).
		case "ObjectSubscribeIds": {
			let spaceId =
				typeof body.spaceId === "string" && body.spaceId ? body.spaceId : "";
			if (!spaceId) {
				const account = await ensureAccount(user);
				spaceId = account.spaceId;
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const records = await subscribeIdsRecords(spaceId, stringList(body.ids));

			return { error: OK, event: null, records, dependencies: [] };
		}

		case "ObjectCreate": {
			const obj = await createObject(user, body);

			// Live: reconcile the space's query-backed subscriptions so a newly-created object
			// appears in any All-objects / Favorites / filtered list that now matches it.
			await subscriptionRegistry.reevaluate(obj.spaceId);

			return {
				error: OK,
				event: null,
				objectId: obj.id,
				details: objectDetails(obj),
				middleTime: 0,
			};
		}

		// ObjectCreateSet mints a fresh Set object (dataview.tsx:964, dataview/head.tsx:134,
		// menu/block/action.tsx:556, page/main/relation.tsx:115) and answers { objectId, details }
		// with the Set layout so the caller opens it as a dataview. body.source is the type ids the
		// set queries; a non-member is refused by createSetObject's writer check.
		case "ObjectCreateSet": {
			let obj: Awaited<ReturnType<typeof createSetObject>>;
			try {
				obj = await createSetObject(user, body, stringList(body.source));
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: obj.id,
				details: createdSetDetails(obj),
				middleTime: 0,
			};
		}

		// ObjectCreateFromUrl mints a Bookmark object from a web url (bookmark.tsx:53,
		// menu.ts:1536). It fetches the page through the SSRF-guarded preview fetch and stores the
		// url on `source`; a refused url or a space the caller cannot write answers FORBIDDEN.
		case "ObjectCreateFromUrl": {
			let obj: Awaited<ReturnType<typeof createObjectFromUrl>>;
			try {
				obj = await createObjectFromUrl(user, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: obj.id,
				details: createdBookmarkDetails(obj),
				middleTime: 0,
			};
		}

		// ObjectCreateBookmark is the chat composer's paste-a-link path (block/chat/form.tsx:1143):
		// { details: { source, createdInContext, createdInContextRef }, spaceId, templateId } ->
		// { objectId, details }. It mints the same Bookmark object as ObjectCreateFromUrl, only the
		// url rides in details.source, so it shares the SSRF-guarded fetch and bookmark projection.
		// A refused url or a space the caller cannot write answers FORBIDDEN.
		case "ObjectCreateBookmark": {
			let obj: Awaited<ReturnType<typeof createObjectFromUrl>>;
			try {
				obj = await createObjectFromUrl(user, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: obj.id,
				details: createdBookmarkDetails(obj),
				middleTime: 0,
			};
		}

		// ObjectBookmarkFetch re-fetches an existing bookmark's source (cell/index.tsx:372,
		// menu/object.tsx:519, head/editor.tsx:175). The callers are fire-and-forget; a refused url
		// or a space the caller cannot write answers FORBIDDEN, a missing object answers NOT_FOUND.
		case "ObjectBookmarkFetch": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			const url = typeof body.url === "string" ? body.url : "";

			let id: string | null;
			try {
				id = await fetchBookmarkFor(user, contextId, url);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (id === null) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null };
		}

		// ObjectAddDiscussion mints the parent's comment chat (comment/section.tsx:619): { objectId } ->
		// { discussionId }. The discussionId is a detail on the parent pointing at a separate hidden
		// Discussion-layout object the chat commands then use as a chatId. Idempotent; a missing or
		// deleted parent answers NOT_FOUND, a space the caller cannot write answers FORBIDDEN.
		case "ObjectAddDiscussion": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";

			let discussionId: string | null;
			try {
				discussionId = await addDiscussion(user, objectId);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (discussionId === null) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null, discussionId };
		}

		// ObjectDateByTimestamp finds-or-creates the per-day Date object a date mention or date
		// block links to (menu/block/mention.tsx:223, menu/block/add.tsx:412, object.ts:779):
		// { spaceId, timestamp } -> { details }. Anytype keys one object per UTC day, so repeat
		// calls for that day are idempotent; a space the caller cannot write answers FORBIDDEN and
		// a missing spaceId answers NOT_FOUND.
		case "ObjectDateByTimestamp": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}
			const timestamp = typeof body.timestamp === "number" ? body.timestamp : 0;

			let obj: Awaited<ReturnType<typeof findOrCreateDateObject>>;
			try {
				obj = await findOrCreateDateObject(user, spaceId, timestamp);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return {
				error: OK,
				event: null,
				details: createdDateDetails(obj),
				middleTime: 0,
			};
		}

		case "ObjectCreateObjectType": {
			let type: Awaited<ReturnType<typeof createObjectType>>;
			try {
				type = await createObjectType(user, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const details = await typeRecordById(type.id);
			if (!details) {
				return { error: NOT_FOUND, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: type.id,
				details,
			};
		}

		// A custom relation created from the dataview/block relation editor
		// (edit.tsx:594). The client sends a numeric relationFormat and a name and reads
		// the created relation record off `details` (updating the relation subscription by
		// details.id); response.ts:245 also maps `key` -> relationKey.
		case "ObjectCreateRelation": {
			let relation: Awaited<ReturnType<typeof createRelation>>;
			try {
				relation = await createRelation(user, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const details = await relationRecordById(relation.id);
			if (!details) {
				return { error: NOT_FOUND, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: relation.id,
				key: relation.uniqueKey,
				details,
			};
		}

		case "ObjectCreateRelationOption": {
			let option: Awaited<ReturnType<typeof createRelationOption>>;
			try {
				option = await createRelationOption(user, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			if (!option) {
				return { error: NOT_FOUND, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: option.id,
				details: relationOptionDetails(option),
			};
		}

		// A board view's columns: one group per option of the group relation. The
		// records inside each column are fetched separately by the column via
		// ObjectSearchSubscribe with a filter on the group relation.
		case "ObjectGroupsSubscribe": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const subId = typeof body.subId === "string" ? body.subId : "";
			const relationKey =
				typeof body.relationKey === "string" ? body.relationKey : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const groups = await boardGroups(spaceId, relationKey);

			return { error: OK, event: null, subId, groups };
		}

		// The date page lists which relations reference an object (date.tsx:69); response.ts:797
		// maps `list` -> { relations: [{ relationKey, counter }] }. Object-relation values are
		// written through ObjectListSetDetails into Obj.details JSONB, so relationsWithValue counts
		// the objects whose value list holds `value` for each object-format relation in the space.
		case "RelationListWithValue": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const value = typeof body.value === "string" ? body.value : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const list = await relationsWithValue(spaceId, value);

			return { error: OK, event: null, list };
		}

		// The graph "navigation" page (page/main/navigation.tsx:190) asks for one object plus the
		// objects it links to and the objects that link back, rendering three columns. response.ts:593
		// maps `object` -> { id, info, links: { inbound, outbound } }. The request carries only an
		// objectId, so resolve the object's space first and authorize against it (reader) before
		// projecting; an unknown id is NOT_FOUND and a non-member is FORBIDDEN.
		case "NavigationGetObjectInfoWithLinks": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";

			const spaceId = await objectSpaceId(objectId);
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const navigation = await navigationObjectInfo(objectId);
			if (!navigation) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null, object: navigation.object };
		}

		// The caller dragged a relation's options into a new order (optionSelect.tsx:634).
		// Persist it so the option subscription and board columns read the order back
		// across a reload; echo relationOptionOrder for the client's response mapper
		// (response.ts:808).
		case "RelationOptionSetOrder": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const relationKey =
				typeof body.relationKey === "string" ? body.relationKey : "";
			const optionIds = stringList(body.relationOptionOrder);

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const relationOptionOrder = await setRelationOptionOrder(
				spaceId,
				relationKey,
				optionIds,
			);

			return { error: OK, event: null, relationOptionOrder };
		}

		// The caller dragged the widget's type rail into a new order (widget/object.tsx:244).
		// Persist it so the type subscription reads the order back across a reload; echo
		// orderIds for the client's response mapper (response.ts:587), which assigns
		// details.orderId = orderIds[i] to the i-th type. Reordering the rail is a space
		// write, so it is writer-gated like the option order above.
		case "ObjectTypeSetOrder": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const typeIds = stringList(body.typeIds);

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const orderIds = await setTypeOrder(spaceId, typeIds);

			return { error: OK, event: null, orderIds };
		}

		// ObjectTypeListConflictingRelations backs the type sidebar's "found relations" list
		// (sidebar/section/type/relation.tsx:95, util/data.ts:1457): the client sends
		// { spaceId, typeObjectId } and reads relationIds -> conflictRelationIds (response.ts:581),
		// resolving each id through the space relation registry and offering the ones the type does
		// not already install. Reading a type's relation surface is a space read, so it is gated at
		// the reader floor; an unknown or foreign type answers NOT_FOUND.
		case "ObjectTypeListConflictingRelations": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const typeObjectId =
				typeof body.typeObjectId === "string" ? body.typeObjectId : "";
			const relationIds = await conflictingRelationIds(spaceId, typeObjectId);
			if (relationIds === null) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null, relationIds };
		}

		// The caller removed select options from a relation's editor (edit.tsx:129). The
		// command carries no spaceId, so each option's space is read off its row and the
		// caller must be able to write it. checkInObjects is a confirm-first guard the
		// client always sends false; it is accepted but not yet acted on, so the options
		// are removed either way.
		case "RelationListRemoveOption": {
			const optionIds = stringList(body.optionIds);

			try {
				await removeRelationOptions(user, optionIds);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return { error: OK, event: null };
		}

		case "ObjectListDelete": {
			const objectIds = stringList(body.objectIds);

			try {
				await softDeleteObjects(user, objectIds);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			// Live-update peers: push a SubscriptionRemove to any tab currently showing a
			// deleted object, so it leaves their list without a reload.
			for (const objectId of objectIds) {
				subscriptionRegistry.hideObject(objectId);
			}

			return { error: OK, event: null };
		}

		// ObjectDeletionAudit backs the space settings "Deletion audit" page
		// (settings/space/deletionAudit.tsx): the client sends { spaceId, keys, offset, limit } and
		// reads { records, total } (response.ts:308). It lists the space's soft-deleted objects as an
		// audit trail; each record carries its removal stamp and isUninstalled:false.
		case "ObjectDeletionAudit": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			// The audit trail names who deleted what, so it is membership-gated at the reader
			// floor; the client narrows visibility further to moderators, but the wire must not
			// leak removals to a non-member. ensureSpaceAccess throws -> FORBIDDEN.
			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const limit =
				typeof body.limit === "number" && body.limit > 0
					? Math.min(body.limit, PAGINATION.MAX_LIMIT)
					: PAGINATION.DEFAULT_LIMIT;
			const offset =
				typeof body.offset === "number" && body.offset > 0 ? body.offset : 0;

			const { records, total } = await deletionAuditRecords(
				spaceId,
				offset,
				limit,
			);

			return { error: OK, event: null, records, total };
		}

		// ObjectCleanupSuggestions backs the Bin's "Suggested for cleanup" tab
		// (component/page/main/archiveSuggested.tsx:81, lib/util/data.ts:77): the client sends
		// { spaceId, keys } and reads { items: [{ details, isRoot, reason }] } (response.ts:292),
		// rendering the space's orphaned objects as a forest. Like the deletion audit it is a
		// space-wide read gated at the reader floor — a non-member must not learn the space's
		// contents — and `keys` is not narrowed: the full object record is projected so the
		// client's detail mapper always finds id/createdInContext/resolvedLayout.
		case "ObjectCleanupSuggestions": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const items = await cleanupSuggestions(spaceId);

			return { error: OK, event: null, items };
		}

		// ObjectCleanupSuggestionIgnore (command.ts:1663, archiveSuggested.tsx:240) permanently
		// dismisses rows from that forest: the client sends { objectIds, ignored } and reads only
		// error.code before reloading. The request carries no spaceId, so the space is resolved from
		// the first object id that exists, and the write is gated at the writer floor — it mutates
		// durable per-object state, so a reader or non-member must not flip it. setCleanupIgnored
		// scopes its updateMany to that resolved space, so an id mixed in from another space cannot
		// be touched. Ignoring a root also drops its descendants (in cleanupSuggestions); ignored=false
		// is the reversible path that puts the subtree back.
		case "ObjectCleanupSuggestionIgnore": {
			const objectIds = Array.isArray(body.objectIds)
				? body.objectIds.filter((id): id is string => typeof id === "string")
				: [];

			let spaceId: string | null = null;
			for (const objectId of objectIds) {
				const resolved = await objectSpaceId(objectId);
				if (resolved) {
					spaceId = resolved;
					break;
				}
			}
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			await setCleanupIgnored(spaceId, objectIds, body.ignored === true);

			return { error: OK, event: null };
		}

		// SpaceInviteGenerate backs the space share sheet (settings/space/share.tsx): the client
		// sends { spaceId, inviteType, permissions, shareWithinSpace } and reads back
		// { inviteCid, inviteFileKey, inviteType, permissions } (response.ts:707). Only an owner or
		// admin may mint a link, so the gate is the admin floor; a lesser member is refused.
		case "SpaceInviteGenerate": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const inviteType =
				typeof body.inviteType === "number" ? body.inviteType : 0;
			const permissions =
				typeof body.permissions === "number" ? body.permissions : 0;

			const invite = await generateInvite(
				spaceId,
				user.id,
				inviteType,
				permissions,
			);

			return {
				error: OK,
				event: null,
				inviteCid: invite.inviteCid,
				inviteFileKey: invite.inviteFileKey,
				inviteType: invite.inviteType,
				permissions: invite.permissions,
			};
		}

		// SpaceInviteGetCurrent reads the space's single live invite for the share sheet; the client
		// maps it to { inviteCid, inviteKey, inviteType, permissions, heldByOwner } (response.ts:716)
		// and renders a link only when inviteCid is non-empty. Gated at the admin floor: only a
		// moderator manages sharing. heldByOwner is always false here because the invite is stored
		// server-side and readable by any moderator, unlike Anytype's owner-account-held file.
		case "SpaceInviteGetCurrent": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const invite = await getCurrentInvite(spaceId);
			return { error: OK, event: null, ...invite, heldByOwner: false };
		}

		// SpaceInviteRevoke retires the live invite so its cid/key stops resolving in
		// SpaceInviteView/SpaceJoin. Idempotent, admin-gated.
		case "SpaceInviteRevoke": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			await revokeInvite(spaceId);
			return { error: OK, event: null };
		}

		// SpaceInviteChange re-points the live invite's granted permissions without minting a new
		// link, so a moderator can widen or narrow what the existing share URL admits. Admin-gated.
		case "SpaceInviteChange": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const permissions =
				typeof body.permissions === "number" ? body.permissions : 0;
			await changeInvitePermissions(spaceId, permissions);
			return { error: OK, event: null };
		}

		// SpaceInviteView resolves a cid/key pair to the space's public preview for an invitee who is
		// NOT yet a member, so it is gated by possession of a live invite rather than by membership.
		// The client maps it to { spaceId, spaceName, iconImage, creatorName, creatorIcon, inviteType,
		// iconOption, spaceType } (response.ts:726). An unknown or revoked pair answers NOT_FOUND.
		case "SpaceInviteView": {
			const cid = typeof body.inviteCid === "string" ? body.inviteCid : "";
			const key =
				typeof body.inviteFileKey === "string" ? body.inviteFileKey : "";

			const view = await viewInvite(cid, key);
			if (!view) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null, ...view };
		}

		// SpaceJoin enrols the caller in the space a live invite points at, at the invite's granted
		// permissions. An unknown or revoked pair answers NOT_FOUND and enrols no one; re-joining is
		// idempotent. The client reads only the error code, so spaceId is returned for convenience.
		case "SpaceJoin": {
			const cid = typeof body.inviteCid === "string" ? body.inviteCid : "";
			const key =
				typeof body.inviteFileKey === "string" ? body.inviteFileKey : "";

			const joined = await joinSpace(user.id, cid, key);
			if (!joined) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null, spaceId: joined.spaceId };
		}

		// SpaceParticipantsAddList enrols people directly from the members sheet (no invite link):
		// { spaceId, identities[], permissions }, identities being participant ids. Owner/admin only.
		case "SpaceParticipantsAddList": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const identities = stringList(body.identities);
			const permissions =
				typeof body.permissions === "number" ? body.permissions : 0;
			await addParticipants(spaceId, identities, permissions);
			return { error: OK, event: null };
		}

		// SpaceParticipantPermissionsChange re-grades members: { spaceId, changes: [{ identity, perms }] }
		// (mapper.ts:1326). The owner is skipped so a moderator cannot lock the owner out. Admin only.
		case "SpaceParticipantPermissionsChange": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const changes = Array.isArray(body.changes)
				? body.changes
						.filter((it: any): it is Record<string, any> => !!it)
						.map((it: any) => ({
							identity: typeof it.identity === "string" ? it.identity : "",
							perms: typeof it.perms === "number" ? it.perms : 0,
						}))
				: [];
			await changeParticipantPermissions(spaceId, changes);
			return { error: OK, event: null };
		}

		// SpaceParticipantRemove soft-removes members: { spaceId, identities[] }. The owner is never
		// removed. Admin only.
		case "SpaceParticipantRemove": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const identities = stringList(body.identities);
			await removeParticipants(spaceId, identities);
			return { error: OK, event: null };
		}

		// SpaceRequestApprove resolves a pending join request from the Request tab or the invite-confirm
		// popup: { spaceId, identity, permissions }. The moderator's chosen role overrides the invited
		// suggestion, and the requester becomes an active member. Admin only; an identity that is not a
		// live 'joining' request answers NOT_FOUND without touching any row.
		case "SpaceRequestApprove": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const identity = typeof body.identity === "string" ? body.identity : "";
			const permissions =
				typeof body.permissions === "number" ? body.permissions : 0;

			const approved = await approveRequest(spaceId, identity, permissions);
			if (!approved) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// SpaceRequestDecline withdraws a pending join request: { spaceId, identity }. The requester was
		// never a member, so the 'joining' row is removed outright. Admin only; an identity that is not a
		// live request answers NOT_FOUND, so an active member can never be removed through this path.
		case "SpaceRequestDecline": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "admin");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const identity = typeof body.identity === "string" ? body.identity : "";

			const declined = await declineRequest(spaceId, identity);
			if (!declined) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// ChatAddMessage appends to an object's chat feed: { chatObjectId, message }. The client posts the
		// mapped wire message with id/orderId/creator/timestamps empty (form.tsx:1080), so the server is
		// authoritative: it mints the id and a monotonic orderId, stamps the creator and createdAt, and
		// answers { messageId } plus a ChatAdd event (dispatcher.ts:1202 -> messageAdd) carrying the record
		// so the sender's store learns the orderId. Writer floor; an unknown chat object answers NOT_FOUND.
		case "ChatAddMessage": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const wire =
				body.message && typeof body.message === "object"
					? (body.message as Record<string, unknown>)
					: {};
			const record: ChatRecord = await addMessage(
				chatObjectId,
				spaceId,
				user.id,
				wire,
			);

			const chatBody = {
				id: record.id,
				orderId: record.orderId,
				message: record,
				dependencies: [],
			};
			// Addressed per session: the caller's own open chat and each peer's are different subIds.
			const chatEvent = chatEventFor(
				chatObjectId,
				spaceId,
				user.id,
				"chatAdd",
				chatBody,
			);

			// Push the same ChatAdd delta to the space's other open tabs so a member sees a new
			// message without reloading; the caller already receives it in this response.
			spaceEvents.emitScoped(spaceId, user.id, (peer) =>
				chatEventFor(chatObjectId, spaceId, peer, "chatAdd", chatBody),
			);

			return {
				error: OK,
				event: chatEvent,
				messageId: record.id,
			};
		}

		// ChatGetMessages pages a chat's history: { chatObjectId, beforeOrderId, afterOrderId, limit,
		// includeBoundary } -> { messages, chatState } (response.ts:751). Older/newer pagination and
		// jump-to-message both route through here (block/chat.tsx:467-500, 663-676). Reader floor; an
		// unknown chat object answers NOT_FOUND.
		case "ChatGetMessages": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const page = await getMessages(
				chatObjectId,
				spaceId,
				user.id,
				typeof body.beforeOrderId === "string" ? body.beforeOrderId : "",
				typeof body.afterOrderId === "string" ? body.afterOrderId : "",
				typeof body.limit === "number" ? body.limit : 50,
				body.includeBoundary === true,
			);

			return {
				error: OK,
				event: null,
				messages: page.messages,
				chatState: page.chatState,
			};
		}

		// ChatSubscribeLastMessages is the chat block's initial load (command.ts:2044): { chatObjectId,
		// limit, subId }. The client reads the snapshot straight off the envelope — response.messages
		// (From.ChatMessage) and response.chatState (From.ChatState) (response.ts:764) — but the subId is
		// not just a client-side cache name: it is the address every later delta for this chat has to be
		// sent to (see chat-subscriptions.ts), so opening a chat registers the watch.
		// It is the no-cursor page of the same history: the LAST `limit` messages, ascending. Reader-gated.
		case "ChatSubscribeLastMessages": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const page = await getMessages(
				chatObjectId,
				spaceId,
				user.id,
				"",
				"",
				typeof body.limit === "number" ? body.limit : 50,
				false,
			);

			watchChat(
				chatObjectId,
				typeof body.subId === "string" ? body.subId : "",
				user.id,
			);

			return {
				error: OK,
				event: null,
				messages: page.messages,
				chatState: page.chatState,
			};
		}

		// ChatReadMessages advances the caller's read watermark (command.ts:2016): { chatObjectId,
		// beforeOrderId, afterOrderId, lastStateId, type } where type is I.ChatReadType (Message=0,
		// Mention=1). The client fires it for the contiguous window the user actually saw
		// (block/chat.tsx:1266, 1307), so the watermark rises to beforeOrderId and the unread counters
		// fall. It answers with a ChatStateUpdate event carrying the recomputed wire state — the
		// dispatcher stores it via From.ChatState (dispatcher.ts:1329) so every open tab re-syncs its
		// badge. Reader floor: marking-read is a view action, not a write. Unknown chat -> NOT_FOUND.
		case "ChatReadMessages": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const state = await readMessages(
				chatObjectId,
				spaceId,
				user.id,
				typeof body.beforeOrderId === "string" ? body.beforeOrderId : "",
				typeof body.type === "number" ? body.type : 0,
			);

			return {
				error: OK,
				event: {
					contextId: chatObjectId,
					messages: [
						chatDeltaFor(chatObjectId, spaceId, user.id, "chatStateUpdate", {
							state,
						}),
					],
				},
			};
		}

		// ChatUnreadMessages is the inverse (command.ts:2026): { chatObjectId, afterOrderId } moves the
		// caller's message watermark back so afterOrderId and everything newer is unread again. Same
		// ChatStateUpdate event and reader floor as ChatReadMessages; unknown chat -> NOT_FOUND.
		case "ChatUnreadMessages": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const state = await unreadMessages(
				chatObjectId,
				spaceId,
				user.id,
				typeof body.afterOrderId === "string" ? body.afterOrderId : "",
			);

			return {
				error: OK,
				event: {
					contextId: chatObjectId,
					messages: [
						chatDeltaFor(chatObjectId, spaceId, user.id, "chatStateUpdate", {
							state,
						}),
					],
				},
			};
		}

		// ChatReadReactions advances the caller's reaction watermark (command.ts:2033): { chatObjectId,
		// orderId }. The recomputed state's unreadReactionOrderId then points at the oldest reacted
		// message still above the watermark. Same ChatStateUpdate event and reader floor; unknown chat
		// -> NOT_FOUND.
		case "ChatReadReactions": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const state = await readReactions(
				chatObjectId,
				spaceId,
				user.id,
				typeof body.orderId === "string" ? body.orderId : "",
			);

			return {
				error: OK,
				event: {
					contextId: chatObjectId,
					messages: [
						chatDeltaFor(chatObjectId, spaceId, user.id, "chatStateUpdate", {
							state,
						}),
					],
				},
			};
		}

		// ChatReadAll advances the caller's read watermark to the newest message of every chat across the
		// spaces they're an active member of (command.ts). No space check: it only writes the caller's own
		// ChatReadState rows in spaces they already belong to. No push event either — one envelope carries one
		// contextId but this spans many chats, so the client re-reads per chat on its next subscribe.
		case "ChatReadAll": {
			await readAllChats(user.id);
			return { error: OK, event: null };
		}

		// ChatSubscribeToMessagePreviews { subId } (command.ts:2052) seeds the space chat list: one preview
		// per chat in the caller's active spaces carrying its newest live message + the caller's unread
		// state. Scoped to the caller's own memberships (the subId names no space), so like ChatReadAll it
		// needs no space-access check. The client maps each entry through From.ChatPreview (mapper.ts:868).
		case "ChatSubscribeToMessagePreviews": {
			const previews = await getMessagePreviews(user.id);
			return { error: OK, event: null, previews };
		}

		// ChatUnsubscribe { chatObjectId, subId } (command.ts:2056) tears down a chat subscription: the
		// watch that gives this chat's later deltas an address is released, so a closed view stops being
		// written to. Nothing else is held server-side — every chat read is a plain request/response —
		// so it answers OK unconditionally, mirroring ObjectSearchUnsubscribe above.
		case "ChatUnsubscribe": {
			dropChatWatches(
				typeof body.chatObjectId === "string" ? body.chatObjectId : "",
				typeof body.subId === "string" ? [body.subId] : [],
			);
			return { error: OK, event: null };
		}

		// PubsubSubscribe { spaceId, topics[], subId } registers the caller's account as a
		// listener of those space topics. Presence + chat typing status ride this: the shell
		// then reads relayed messages back as Event_PubsubMessage on its /events stream. Reader
		// gated so a client cannot listen into a space it is not a member of.
		case "PubsubSubscribe": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const topics = stringList(body.topics);
			const subId = typeof body.subId === "string" ? body.subId : "";

			try {
				await subscribePubsub(user, spaceId, topics, subId);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return { error: OK, event: null };
		}

		// PubsubUnsubscribe { subId } tears down one of the caller's own subscriptions. It
		// carries no spaceId, and the relay keys subscriptions by account, so this can only
		// release the caller's own subId.
		case "PubsubUnsubscribe": {
			const subId = typeof body.subId === "string" ? body.subId : "";
			unsubscribePubsub(user, subId);

			return { error: OK, event: null };
		}

		// PubsubPublish { spaceId, topic, payload } fans an ephemeral payload out to the other
		// members of the space listening on that topic. The shell JSON.stringifies the Uint8Array
		// it publishes, so the body arrives as a numeric-keyed object; coerceBytes rebuilds it.
		case "PubsubPublish": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const topic = typeof body.topic === "string" ? body.topic : "";

			try {
				await publishPubsub(user, spaceId, topic, coerceBytes(body.payload));
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			return { error: OK, event: null };
		}

		// ChatGetMessagesByIds hydrates specific messages (command.ts:2063): { chatObjectId, messageIds }
		// -> { messages } in the requested order, skipping missing/soft-deleted ids. The client uses it to
		// resolve a reply's parent and a message's dependencies. Reader-gated like the other chat reads.
		case "ChatGetMessagesByIds": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const messages = await getMessagesByIds(
				chatObjectId,
				spaceId,
				Array.isArray(body.messageIds)
					? body.messageIds.filter((id): id is string => typeof id === "string")
					: [],
			);

			return { error: OK, event: null, messages };
		}

		// ChatDeleteMessage soft-deletes a message (command.ts:1999): { chatObjectId, messageId }. The row
		// is flagged deleted (it drops out of every read path) and a ChatDelete event { id, subIds } lets
		// the client remove it from the live lists (dispatcher.ts:1387). A member may delete their own
		// message; a space admin/owner may moderate-delete anyone's. Writer floor for access, then the
		// creator-or-moderator rule inside deleteMessage.
		case "ChatDeleteMessage": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			let member: Awaited<ReturnType<typeof ensureSpaceAccess>>;
			try {
				member = await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const messageId =
				typeof body.messageId === "string" ? body.messageId : "";
			const canModerate =
				PERMISSION_RANK[member.permission] >= PERMISSION_RANK.admin;

			const result = await deleteMessage(
				chatObjectId,
				messageId,
				user.id,
				canModerate,
			);
			if (result === "not_found") {
				return { error: NOT_FOUND, event: null };
			}
			if (result === "forbidden") {
				return { error: FORBIDDEN, event: null };
			}

			const deleteBody = { id: messageId };
			spaceEvents.emitScoped(spaceId, user.id, (peer) =>
				chatEventFor(chatObjectId, spaceId, peer, "chatDelete", deleteBody),
			);

			return {
				error: OK,
				event: chatEventFor(
					chatObjectId,
					spaceId,
					user.id,
					"chatDelete",
					deleteBody,
				),
			};
		}

		// ChatEditMessageContent rewrites a message's body (command.ts:1983): { chatObjectId, messageId,
		// editedMessage }. editedMessage is the mapped wire message; the server keeps id/orderId/creator/
		// createdAt authoritative, bumps modifiedAt, and emits a ChatUpdate event { id, message, subIds }
		// the client merges into the live lists (dispatcher.ts:1301). Creator-only — no moderator override.
		case "ChatEditMessageContent": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const messageId =
				typeof body.messageId === "string" ? body.messageId : "";
			const wire =
				body.editedMessage && typeof body.editedMessage === "object"
					? (body.editedMessage as Record<string, unknown>)
					: {};

			const result = await editMessage(chatObjectId, messageId, user.id, wire);
			if (result.status === "not_found") {
				return { error: NOT_FOUND, event: null };
			}
			if (result.status === "forbidden") {
				return { error: FORBIDDEN, event: null };
			}

			const editBody = { id: messageId, message: result.record };
			spaceEvents.emitScoped(spaceId, user.id, (peer) =>
				chatEventFor(chatObjectId, spaceId, peer, "chatUpdate", editBody),
			);

			return {
				error: OK,
				event: chatEventFor(
					chatObjectId,
					spaceId,
					user.id,
					"chatUpdate",
					editBody,
				),
			};
		}

		// ChatToggleMessageReaction adds/removes the caller's reaction (command.ts:1991): { chatObjectId,
		// messageId, emoji }. The new wire reactions map ({ reactions: { [emoji]: { ids } } }) is pushed via
		// a ChatUpdateReactions event { id, reactions, subIds } (dispatcher.ts:1401). Any member may react to
		// any message (writer floor); an unknown/deleted message answers NOT_FOUND.
		case "ChatToggleMessageReaction": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const messageId =
				typeof body.messageId === "string" ? body.messageId : "";
			const emoji = typeof body.emoji === "string" ? body.emoji : "";

			const result = await toggleReaction(
				chatObjectId,
				messageId,
				user.id,
				emoji,
			);
			if (result.status === "not_found") {
				return { error: NOT_FOUND, event: null };
			}

			const reactionBody = { id: messageId, reactions: result.reactions };
			spaceEvents.emitScoped(spaceId, user.id, (peer) =>
				chatEventFor(
					chatObjectId,
					spaceId,
					peer,
					"chatUpdateReactions",
					reactionBody,
				),
			);

			return {
				error: OK,
				event: chatEventFor(
					chatObjectId,
					spaceId,
					user.id,
					"chatUpdateReactions",
					reactionBody,
				),
			};
		}

		// ChatSetPinnedMessages flags/unflags messages as pinned (command.ts:2082): { chatObjectId,
		// messageIds, pinned }. Emits one ChatUpdatePinnedStatus event { message, isPinned, subIds } per
		// touched message (dispatcher.ts:1478). Writer floor.
		case "ChatSetPinnedMessages": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const messageIds = Array.isArray(body.messageIds)
				? body.messageIds.filter((id): id is string => typeof id === "string")
				: [];
			const pinned = body.pinned === true;

			const updated = await setPinned(
				chatObjectId,
				spaceId,
				messageIds,
				pinned,
			);

			// One ChatUpdatePinnedStatus message per touched row, addressed to what each session has open.
			const pinnedMessages = (userId: string) =>
				updated.map((record) =>
					chatDeltaFor(
						chatObjectId,
						spaceId,
						userId,
						"chatUpdatePinnedStatus",
						{
							message: record,
							isPinned: pinned,
						},
					),
				);
			spaceEvents.emitScoped(spaceId, user.id, (peer) => ({
				contextId: chatObjectId,
				messages: pinnedMessages(peer),
			}));

			return {
				error: OK,
				event: {
					contextId: chatObjectId,
					messages: pinnedMessages(user.id),
				},
			};
		}

		// ChatGetPinnedMessages returns the chat's pinned bar (command.ts:2090): { chatObjectId } ->
		// { messages } ascending (response.ts:791). Reader floor.
		case "ChatGetPinnedMessages": {
			const chatObjectId =
				typeof body.chatObjectId === "string" ? body.chatObjectId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const messages = await getPinned(chatObjectId, spaceId);
			return { error: OK, event: null, messages };
		}

		// ChatSearch is the in-chat full-text search (command.ts:2070): { spaceId, chatId, fullText,
		// offset, limit, sorts, creators } -> { results } (response.ts:785). Access is gated on the chat
		// object's own space (chatId), so the passed spaceId cannot be used to reach another space's chat.
		// Reader floor; an unknown chat answers NOT_FOUND.
		case "ChatSearch": {
			const chatObjectId = typeof body.chatId === "string" ? body.chatId : "";

			const spaceId = chatObjectId ? await objectSpaceId(chatObjectId) : null;
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const results = await searchMessages(
				spaceId,
				chatObjectId,
				typeof body.fullText === "string" ? body.fullText : "",
				typeof body.offset === "number" ? body.offset : 0,
				typeof body.limit === "number" ? body.limit : 20,
				Array.isArray(body.creators)
					? body.creators.filter((c): c is string => typeof c === "string")
					: [],
			);

			return { error: OK, event: null, results };
		}

		// SpaceChangeOwnership transfers the owner role (menu/changeOwner.tsx): { spaceId,
		// newOwnerIdentity, oldOwnerPermissions }. Owner-only; the target must already be an active
		// member, else NOT_FOUND. The old owner is demoted to oldOwnerPermissions (Anytype sends Writer).
		case "SpaceChangeOwnership": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "owner");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const newOwnerIdentity =
				typeof body.newOwnerIdentity === "string" ? body.newOwnerIdentity : "";
			const oldOwnerPermissions =
				typeof body.oldOwnerPermissions === "number"
					? body.oldOwnerPermissions
					: 1;

			const changed = await changeOwnership(
				spaceId,
				newOwnerIdentity,
				user.id,
				oldOwnerPermissions,
			);
			if (!changed) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// SpaceMakeShareable flips the space to Shared so the share sheet can mint a link
		// (settings/space/share.tsx onLinkToggle). Owner-only: changing a space's access type is an
		// owner power in Anytype, and a lesser moderator is refused.
		case "SpaceMakeShareable": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "owner");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			await makeSpaceShareable(spaceId);
			return { error: OK, event: null };
		}

		// SpaceStopSharing returns the space to Private and revokes its live invite (menu.ts:947).
		// Owner-only.
		case "SpaceStopSharing": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				await ensureSpaceAccess(user.id, spaceId, "owner");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			await stopSharing(spaceId);
			return { error: OK, event: null };
		}

		// ObjectListDuplicate is the 'pageCopy' action (menu/object.tsx:447): the client sends
		// { objectIds } and opens response.ids[0]. duplicateObjects copies each source's content,
		// Yjs body and outbound links into a fresh row; a non-member is refused (FORBIDDEN) and an
		// all-unknown list answers NOT_FOUND.
		case "ObjectListDuplicate": {
			const objectIds = stringList(body.objectIds);

			let ids: string[] | null;
			try {
				ids = await duplicateObjects(user, objectIds);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (ids === null) {
				return { error: NOT_FOUND, event: null };
			}

			// Live: the copies are new rows in whatever lists the originals showed.
			for (const id of ids) {
				const space = await objectSpaceId(id);
				if (space) {
					await subscriptionRegistry.reevaluate(space);
				}
			}

			return { error: OK, event: null, ids };
		}

		// TemplateCreateFromObject is the 'templateCreate' action (menu/object.tsx:526): the
		// client sends { contextId } and reads response.id (response.ts:609) to open the fresh
		// template. createTemplateFromObject mints an ot-template object copying the source's
		// details and Yjs body; a non-member is refused (FORBIDDEN) and an unknown source
		// answers NOT_FOUND.
		case "TemplateCreateFromObject": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";

			let id: string | null;
			try {
				id = await createTemplateFromObject(user, contextId);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (id === null) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null, id };
		}

		// ObjectApplyTemplate (banner.tsx:60, featured.tsx:378) replaces an object's body with
		// a template's; the client sends { contextId, templateId } and reads nothing back
		// (write-only). applyTemplate overwrites the target's Yjs body, keeping its name/type;
		// a non-member is refused (FORBIDDEN) and a missing target or template answers
		// NOT_FOUND.
		case "ObjectApplyTemplate": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			const templateId =
				typeof body.templateId === "string" ? body.templateId : "";

			let applied: boolean;
			try {
				applied = await applyTemplate(user, contextId, templateId);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (!applied) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null };
		}

		case "FileUpload": {
			let uploaded: {
				objectId: string;
				details: Record<string, unknown>;
			} | null;
			try {
				uploaded = await uploadFile(user, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (uploaded === null) {
				return { error: NOT_FOUND, event: null };
			}

			return {
				error: OK,
				event: null,
				objectId: uploaded.objectId,
				details: uploaded.details,
			};
		}

		case "LinkPreview": {
			const url = typeof body.url === "string" ? body.url : "";
			if (!url) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				const preview = await fetchLinkPreview(url);
				if (preview === null) {
					return { error: NOT_FOUND, event: null };
				}
				return { error: OK, event: null, linkPreview: preview };
			} catch (error) {
				// A url the SSRF guard refuses is the caller's fault, not a missing object.
				if (error instanceof PreviewNotAllowedError) {
					return { error: FORBIDDEN, event: null };
				}
				return { error: NOT_FOUND, event: null };
			}
		}

		case "ObjectListSetIsArchived": {
			const objectIds = stringList(body.objectIds);
			const isArchived = body.isArchived === true;

			try {
				await setObjectsArchived(user, objectIds, isArchived);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			// Archiving leaves the object out of every active list, so push a SubscriptionRemove
			// to tabs showing it. Either direction can also change which query-backed lists match
			// (a restored object re-enters them), so reconcile the spaces afterwards.
			if (isArchived) {
				for (const objectId of objectIds) {
					subscriptionRegistry.hideObject(objectId);
				}
			}
			for (const objectId of objectIds) {
				const space = await objectSpaceId(objectId);
				if (space) {
					await subscriptionRegistry.reevaluate(space);
				}
			}

			return { error: OK, event: null };
		}

		// Collection membership writes: ordered Link edges under the collection
		// relation (ADR-0002). Both need writer access to the collection's space.
		case "ObjectToCollection": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			let spaceId: string | null;
			try {
				spaceId = await convertToCollection(user, contextId);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (spaceId === null) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		case "ObjectCollectionAdd": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			const objectIds = stringList(body.objectIds);
			let spaceId: string | null;
			try {
				spaceId = await addCollectionMembers(user, contextId, objectIds);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (spaceId === null) {
				return { error: NOT_FOUND, event: null };
			}

			// Live: reveal the new members to peers' open views of this collection. Reuse the
			// exact projected records the list itself serves, so a peer's row is complete.
			const memberRecords = await subscribeIdsRecords(spaceId, objectIds);
			subscriptionRegistry.revealMembers(
				contextId,
				spaceId,
				memberRecords.map((record) => ({
					id: record.id as string,
					details: record,
				})),
			);

			return { error: OK, event: null };
		}

		case "ObjectCollectionRemove": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			const objectIds = stringList(body.objectIds);
			let spaceId: string | null;
			try {
				spaceId = await removeCollectionMembers(user, contextId, objectIds);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (spaceId === null) {
				return { error: NOT_FOUND, event: null };
			}

			// Live: drop the removed members from that collection's open views only (the object
			// still exists, so targeted removal — not hideObject, which would clear other views).
			subscriptionRegistry.unrevealMembers(contextId, spaceId, objectIds);

			return { error: OK, event: null };
		}

		// Set conversion and source writes. ObjectToSet/ObjectSetSource carry the type ids
		// on `source` (front_web command.ts); the set's records are read back through the
		// `sources` subscription branch above, so nothing else is returned here.
		case "ObjectToSet": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			let spaceId: string | null;
			try {
				spaceId = await convertToSet(user, contextId, stringList(body.source));
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (spaceId === null) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		case "ObjectSetSource": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			let spaceId: string | null;
			try {
				spaceId = await setObjectSources(
					user,
					contextId,
					stringList(body.source),
				);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (spaceId === null) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// The featured type picker re-points an object at a type by the type's uniqueKey
		// (featured.tsx:376), not its id; setObjectType resolves it within the object's space.
		case "ObjectSetObjectType": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			const typeKey =
				typeof body.objectTypeUniqueKey === "string"
					? body.objectTypeUniqueKey
					: "";

			let typeId: string | null;
			try {
				typeId = await setObjectType(user, contextId, typeKey);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (typeId === null) {
				return { error: NOT_FOUND, event: null };
			}

			// Retyping can move an object in/out of a set or type-filtered list; reconcile the
			// space's query-backed views so peers' lists follow the new type.
			const retypedSpace = await objectSpaceId(contextId);
			if (retypedSpace) {
				await subscriptionRegistry.reevaluate(retypedSpace);
			}

			return { error: OK, event: null };
		}

		// The multi-select "change type" action retypes a batch of objects at one type uniqueKey
		// (menu/object/context.tsx:299), fire-and-forget. setObjectsType re-points each listed
		// object within its own space; unknown ids are ignored, and nothing retyped is NOT_FOUND.
		case "ObjectListSetObjectType": {
			const typeKey =
				typeof body.objectTypeUniqueKey === "string"
					? body.objectTypeUniqueKey
					: "";

			let retyped: string[] | null;
			try {
				retyped = await setObjectsType(
					user,
					stringList(body.objectIds),
					typeKey,
				);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (retyped === null) {
				return { error: NOT_FOUND, event: null };
			}

			// Same reconciliation a single retype does: each retyped object can enter or leave
			// the type-filtered lists its new type resolves to.
			for (const objectId of retyped) {
				const space = await objectSpaceId(objectId);
				if (space) {
					await subscriptionRegistry.reevaluate(space);
				}
			}

			return { error: OK, event: null };
		}

		// ObjectRelationAdd hangs existing relations off an object so they surface in its
		// "local" relation list (block/relation.tsx:58, sidebar/page/object/relation.tsx:132).
		// addObjectRelations seeds each key onto the object's details; the proto response carries
		// only error/event, so the caller re-reads to see the new relation.
		case "ObjectRelationAdd": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";

			let added: string[] | null;
			try {
				added = await addObjectRelations(
					user,
					contextId,
					stringList(body.relationKeys),
				);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (added === null) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// ObjectRelationDelete lifts relation keys off an object (sidebar/page/object/relation.tsx:105
		// 'remove', util/object.ts:1113). removeObjectRelations drops each key from the details JSONB;
		// the proto response carries only error/event, so the caller re-reads to see it gone.
		case "ObjectRelationDelete": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";

			let removed: string[] | null;
			try {
				removed = await removeObjectRelations(
					user,
					contextId,
					stringList(body.relationKeys),
				);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (removed === null) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// The two directions of action.ts:1295 toggleFeatureRelation: move a relation key into or
		// out of the object's featured block. body.relations carries the keys; setFeaturedRelations
		// rewrites details.featuredRelations. The proto response is only error/event.
		case "ObjectRelationAddFeatured":
		case "ObjectRelationRemoveFeatured": {
			const contextId =
				typeof body.contextId === "string" ? body.contextId : "";
			const mode = name === "ObjectRelationAddFeatured" ? "add" : "remove";

			let featured: string[] | null;
			try {
				featured = await setFeaturedRelations(
					user,
					contextId,
					stringList(body.relations),
					mode,
				);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (featured === null) {
				return { error: NOT_FOUND, event: null };
			}
			return { error: OK, event: null };
		}

		// The client's single write path for relation values (rename, custom relations,
		// checkboxes). Each entry is Mapper.To.Details output: { id, details }.
		case "ObjectListSetDetails": {
			const rawDetails = Array.isArray(body.details) ? body.details : [];
			const entries: { id: string; details: Record<string, unknown> }[] = [];
			for (const raw of rawDetails) {
				if (!raw || typeof raw !== "object") {
					continue;
				}
				const entry = raw as { id?: unknown; details?: unknown };
				if (typeof entry.id !== "string") {
					continue;
				}
				entries.push({
					id: entry.id,
					details:
						entry.details && typeof entry.details === "object"
							? (entry.details as Record<string, unknown>)
							: {},
				});
			}

			let missing: string[];
			try {
				({ missing } = await setObjectDetails(user, entries));
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (missing.length > 0) {
				return { error: NOT_FOUND, event: null };
			}

			// Live-update peers: push an ObjectDetailsAmend to any tab currently showing an
			// edited object, so a rename / field change is reflected without a reload.
			const touchedSpaces = new Set<string>();
			for (const entry of entries) {
				subscriptionRegistry.amendObject(entry.id, entry.details);
				const space = await objectSpaceId(entry.id);
				if (space) {
					touchedSpaces.add(space);
				}
			}

			// An edit can also change whether an object matches a filtered list (e.g. ticking a
			// checkbox drops it from an "incomplete" view) — reconcile the query-backed views.
			for (const space of touchedSpaces) {
				await subscriptionRegistry.reevaluate(space);
			}

			return { error: OK, event: null };
		}

		// The batch relation-value editor: the dataview bulk action and the multi-object
		// relation popup send one add/set/remove per operation (a proto oneof). Each value
		// is stored in Obj.details JSONB, so the mutation is read back on the next subscribe.
		case "ObjectListModifyDetailValues": {
			const objectIds = stringList(body.objectIds);
			const rawOperations = Array.isArray(body.operations)
				? body.operations
				: [];
			const operations: {
				relationKey: string;
				add?: unknown;
				set?: unknown;
				remove?: unknown;
			}[] = [];

			for (const raw of rawOperations) {
				if (!raw || typeof raw !== "object") {
					continue;
				}
				const op = raw as {
					relationKey?: unknown;
					add?: unknown;
					set?: unknown;
					remove?: unknown;
				};
				if (typeof op.relationKey !== "string" || !op.relationKey) {
					continue;
				}
				const operation: {
					relationKey: string;
					add?: unknown;
					set?: unknown;
					remove?: unknown;
				} = { relationKey: op.relationKey };
				if (op.set !== undefined) {
					operation.set = op.set;
				}
				if (op.add !== undefined) {
					operation.add = op.add;
				}
				if (op.remove !== undefined) {
					operation.remove = op.remove;
				}
				operations.push(operation);
			}

			let missing: string[];
			try {
				({ missing } = await modifyObjectDetailValues(
					user,
					objectIds,
					operations,
				));
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (missing.length > 0) {
				return { error: NOT_FOUND, event: null };
			}

			// Live: the batch relation editor rewrites values peers are looking at, so amend the
			// open rows with the stored result and reconcile the lists the new values match.
			const modifiedSpaces = new Set<string>();
			for (const objectId of objectIds) {
				const space = await objectSpaceId(objectId);
				if (!space) {
					continue;
				}
				modifiedSpaces.add(space);

				for (const record of await subscribeIdsRecords(space, [objectId])) {
					subscriptionRegistry.amendObject(objectId, record);
				}
			}
			for (const space of modifiedSpaces) {
				await subscriptionRegistry.reevaluate(space);
			}

			return { error: OK, event: null };
		}

		// The sidebar create button sends an empty context, so no link block is
		// produced and targetId is the new object itself.
		case "BlockLinkCreateWithObject": {
			const obj = await createObject(user, body);

			// This is the create path the dataview "New object" button and the link-block
			// placeholder use, so it reconciles like ObjectCreate does.
			await subscriptionRegistry.reevaluate(obj.spaceId);

			return {
				error: OK,
				event: null,
				blockId: "",
				targetId: obj.id,
				details: objectDetails(obj),
				middleTime: 0,
			};
		}

		case "ObjectOpen":
		case "ObjectShow": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";

			// The client opens its synthetic personal widgets object on every space switch;
			// it has no Obj row, so answer its view instead of failing the open.
			if (isPersonalWidgetsId(objectId)) {
				const requestedSpaceId =
					typeof body.spaceId === "string" ? body.spaceId : "";

				let widgetsView: Awaited<ReturnType<typeof personalWidgetsView>> | null;
				try {
					widgetsView = await personalWidgetsView(
						user,
						objectId,
						requestedSpaceId,
					);
				} catch {
					return { error: FORBIDDEN, event: null };
				}

				return { error: OK, event: null, objectView: widgetsView };
			}

			let view: Awaited<ReturnType<typeof loadObjectView>>;
			try {
				view = await loadObjectView(user, objectId);
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			if (!view) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: null, objectView: view };
		}

		// Global full-text search over the space: matches live objects by name or by
		// the body snippet projected from the Yjs document (ADR-0018). Scoped to a
		// space the caller can read.
		case "ObjectSearch": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const fullText = typeof body.fullText === "string" ? body.fullText : "";
			const limit =
				typeof body.limit === "number" && body.limit > 0
					? Math.min(body.limit, PAGINATION.MAX_LIMIT)
					: PAGINATION.DEFAULT_LIMIT;
			const offset =
				typeof body.offset === "number" && body.offset > 0 ? body.offset : 0;

			// A filter naming a type-only relation is the shell's type picker asking for the
			// space's registry, which is not an Obj row the column-backed search can compare.
			const records = isTypePickerQuery(body.filters)
				? await searchTypeRecords(
						spaceId,
						body.filters,
						fullText,
						limit,
						offset,
					)
				: await searchRecords(spaceId, fullText, limit, offset, body.filters);
			return { error: OK, event: null, records };
		}

		// ObjectSearchWithMeta: the global search popup's read. Same query and gating as
		// ObjectSearch, but each hit carries its detail record plus per-field highlight
		// metadata, and the response mapper reads `results` rather than `records`.
		case "ObjectSearchWithMeta": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const fullText = typeof body.fullText === "string" ? body.fullText : "";
			const limit =
				typeof body.limit === "number" && body.limit > 0
					? Math.min(body.limit, PAGINATION.MAX_LIMIT)
					: PAGINATION.DEFAULT_LIMIT;
			const offset =
				typeof body.offset === "number" && body.offset > 0 ? body.offset : 0;

			const results = await searchRecordsWithMeta(
				spaceId,
				fullText,
				limit,
				offset,
				body.filters,
			);
			return { error: OK, event: null, results };
		}

		// Cross-space search: the global popup spans every space the caller is an
		// active member of, so the readable set is derived from membership rather than
		// a spaceId argument (there is none).
		case "ObjectCrossSpaceSearch": {
			const fullText = typeof body.fullText === "string" ? body.fullText : "";
			const limit =
				typeof body.limit === "number" && body.limit > 0
					? Math.min(body.limit, PAGINATION.MAX_LIMIT)
					: PAGINATION.DEFAULT_LIMIT;
			const offset =
				typeof body.offset === "number" && body.offset > 0 ? body.offset : 0;

			const records = await crossSpaceSearchRecords(
				user.id,
				fullText,
				limit,
				offset,
			);
			return { error: OK, event: null, records };
		}

		// History: list prior body snapshots (DocumentVersion rows written on each collab
		// store), newest-first, cursor-paged by lastVersionId. Reader access to the object's
		// space gates it; the version's authorId is the captured last editor ("" when none).
		case "HistoryGetVersions": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";
			if (!objectId) {
				return { error: NOT_FOUND, event: null };
			}

			const spaceId = await objectSpaceId(objectId);
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const lastVersionId =
				typeof body.lastVersionId === "string" ? body.lastVersionId : "";
			const limit =
				typeof body.limit === "number" && body.limit > 0
					? Math.min(body.limit, PAGINATION.MAX_LIMIT)
					: 0;

			const versions = await historyVersions(
				spaceId,
				objectId,
				lastVersionId,
				limit,
			);

			return { error: OK, event: null, versions };
		}

		// Restore a prior body: write that version's Yjs state back as the object's current
		// document through the canonical body-write path (storeDocument), so the snippet,
		// body links and a fresh snapshot all stay consistent and the open editor reloads it.
		// Writer access to the space is required, mirroring the collab edit gate.
		case "HistorySetVersion": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";
			const versionId =
				typeof body.versionId === "string" ? body.versionId : "";
			if (!objectId || !versionId) {
				return { error: NOT_FOUND, event: null };
			}

			const spaceId = await objectSpaceId(objectId);
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "writer");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const version = await documentVersionById(spaceId, versionId);
			if (!version || version.objectId !== objectId) {
				return { error: NOT_FOUND, event: null };
			}

			await storeDocument(objectId, version.state, user.id);

			return { error: OK, event: null };
		}

		// Diff two stored versions as the event list the client's history pane consumes:
		// { objectId, currentVersion, previousVersion } (command.ts:1121) -> { historyEvents }
		// (response.ts:570). Reader access to the object's space gates it, like the other
		// history reads; a version from another space or another object never resolves.
		case "HistoryDiffVersions": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";
			const currentVersion =
				typeof body.currentVersion === "string" ? body.currentVersion : "";
			const previousVersion =
				typeof body.previousVersion === "string" ? body.previousVersion : "";
			if (!objectId || !currentVersion || !previousVersion) {
				return { error: NOT_FOUND, event: null };
			}

			const spaceId = await objectSpaceId(objectId);
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const from = await documentVersionById(spaceId, previousVersion);
			const to = await documentVersionById(spaceId, currentVersion);
			if (
				!from ||
				!to ||
				from.objectId !== objectId ||
				to.objectId !== objectId
			) {
				return { error: NOT_FOUND, event: null };
			}

			const historyEvents = await historyDiffEvents(
				spaceId,
				objectId,
				bodyTextFromState(from.state),
				bodyTextFromState(to.state),
			);

			return { error: OK, event: null, historyEvents };
		}

		// Preview a prior version: the version record plus an objectView whose projected
		// body text (Obj.snippet) is rebuilt from that version's stored Yjs state. The
		// block tree in the view stays the object's current (ADR-0018: blocks are vestigial
		// for a Yjs body); the version's recoverable text is the snippet projection.
		case "HistoryShowVersion": {
			const objectId = typeof body.objectId === "string" ? body.objectId : "";
			const versionId =
				typeof body.versionId === "string" ? body.versionId : "";
			if (!objectId || !versionId) {
				return { error: NOT_FOUND, event: null };
			}

			const spaceId = await objectSpaceId(objectId);
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const version = await documentVersionById(spaceId, versionId);
			if (!version || version.objectId !== objectId) {
				return { error: NOT_FOUND, event: null };
			}

			const view = await loadObjectView(user, objectId);
			if (!view) {
				return { error: NOT_FOUND, event: null };
			}

			const snippet = bodySnippetFromState(version.state);
			for (const entry of view.details) {
				if (entry.id === objectId) {
					entry.details = { ...entry.details, snippet };
				}
			}

			// The pane renders blocks, not the snippet, so the version's paragraphs have to
			// be projected into the view it is handed.
			const previewView = versionBodyView(
				view,
				objectId,
				version.id,
				bodyTextFromState(version.state)
					.split("\n")
					.filter((line) => line !== ""),
			);

			return {
				error: OK,
				event: null,
				version: {
					id: version.id,
					authorId: version.authorId,
					groupId: version.groupId,
					time: version.time,
				},
				objectView: previewView,
			};
		}

		// The graph view read: live objects as nodes, their object-valued relations
		// (Link rows) as edges. Scoped to a space the caller can read.
		case "ObjectGraph": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			if (!spaceId) {
				return { error: NOT_FOUND, event: null };
			}

			try {
				await ensureSpaceAccess(user.id, spaceId, "reader");
			} catch {
				return { error: FORBIDDEN, event: null };
			}

			const limit =
				typeof body.limit === "number" && body.limit > 0
					? Math.min(body.limit, PAGINATION.MAX_LIMIT)
					: 0;

			const { nodes, edges } = await graphRecords(spaceId, limit);
			return { error: OK, event: null, nodes, edges };
		}

		// Boot handshake: the client reports its platform/version/log settings and
		// only needs an acknowledgement. The web backend derives these from its own
		// environment, so there is nothing to persist — but falling through to
		// NOT_SUPPORTED would surface as a startup error on the client.
		case "InitialSetParameters":
			return { error: OK, event: null };

		// AppGetVersion: the client builds its "contact support" URL from `version` (middleware)
		// and `details` (build). The self-hosted web backend has no separate any-sync middleware
		// build, so it reports its own application version for both.
		case "AppGetVersion":
			return {
				error: OK,
				event: null,
				version: APP_VERSION,
				details: APP_VERSION,
			};

		// NotificationList { includeRead, limit } (command.ts:1790): the caller's own notifications,
		// newest-first. The boot fetch is unread-only (data.ts:496 includeRead=false); the popup can
		// include read ones. Scoped to the caller, so no space-access check is needed (like ChatReadAll).
		case "NotificationList": {
			const notifications = await listNotifications(
				user.id,
				body.includeRead === true,
				typeof body.limit === "number" ? body.limit : 0,
			);

			return { error: OK, event: null, notifications };
		}

		// NotificationReply { ids, actionType } (command.ts:1797): Close is the only action the client
		// sends; it marks the caller's notifications Replied so they leave the unread list. ids are
		// scoped to the caller in the service, so a foreign or unknown id matches nothing.
		case "NotificationReply": {
			await replyNotifications(user.id, stringList(body.ids));

			return { error: OK, event: null };
		}

		// PublishingCreate { spaceId, objectId, uri, joinSpace } (command.ts:2103): bind an object to a
		// public slug on the self-hosted gateway. Returns the absolute URL the client opens
		// (menu/publish.tsx:80 reads message.url); the stored PublishState.uri keeps just the slug.
		case "PublishingCreate": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const objectId = typeof body.objectId === "string" ? body.objectId : "";
			const uri = typeof body.uri === "string" ? body.uri : "";
			const joinSpace = body.joinSpace === true;

			try {
				const published = await publishObject(
					user,
					spaceId,
					objectId,
					uri,
					joinSpace,
				);
				return { error: OK, event: null, uri: published.uri };
			} catch (error) {
				if (error instanceof PublishError) {
					return {
						error: { code: error.code, description: error.message },
						event: null,
					};
				}
				return { error: FORBIDDEN, event: null };
			}
		}

		// PublishingGetStatus { spaceId, objectId } (command.ts:2127): the object's live publish state, or
		// null when unpublished. The menu gates Publish vs Unpublish/Update off `publish` being non-null
		// (menu/publish.tsx:127) and seeds its slug input from PublishState.uri.
		case "PublishingGetStatus": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const objectId = typeof body.objectId === "string" ? body.objectId : "";

			try {
				const publish = await getPublishStatus(user, spaceId, objectId);
				return { error: OK, event: null, publish };
			} catch {
				return { error: FORBIDDEN, event: null };
			}
		}

		// PublishingRemove { spaceId, objectId } (command.ts:2112): unpublish. The client only checks
		// error.code (response.ts has no mapper), so a bare OK envelope is the whole contract.
		case "PublishingRemove": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
			const objectId = typeof body.objectId === "string" ? body.objectId : "";

			try {
				await removePublished(user, spaceId, objectId);
				return { error: OK, event: null };
			} catch {
				return { error: FORBIDDEN, event: null };
			}
		}

		// PublishingList { spaceId } (command.ts:2119): the settings publish list. An empty spaceId (the
		// client passes '') spans every space the caller is an active member of; a given spaceId is scoped
		// to that space. response.ts maps `publishes` through Mapper.From.PublishState.
		case "PublishingList": {
			const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";

			try {
				const publishes = await listPublished(user, spaceId);
				return { error: OK, event: null, publishes };
			} catch {
				return { error: FORBIDDEN, event: null };
			}
		}

		// The set screen's dataview controls (BlockDataview*) are one family: the module owns the
		// whole table, so a command's guard mapping and event envelope live in one place rather
		// than repeated 22 times here.
		default: {
			if (!DATAVIEW_WRITE_COMMANDS.has(name)) {
				return { error: NOT_SUPPORTED, event: null };
			}

			let answered: DataviewWrite | null;
			try {
				answered = await dataviewWrite(user, name, body);
			} catch {
				return { error: FORBIDDEN, event: null };
			}
			if (answered === null) {
				return { error: NOT_FOUND, event: null };
			}

			return { error: OK, event: answered.event, ...answered.response };
		}
	}
}

export const commandService = { run };
