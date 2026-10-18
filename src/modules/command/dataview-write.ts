import { ensureSpaceAccess } from "../../auth/space-access.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { DATAVIEW_LAYOUT } from "../dataviews/constants.js";
import { dataviewRepository } from "../dataviews/repository.js";
import { type SessionEvent, spaceEvents } from "../pubsub/space-events.js";
import { RELATION_FORMAT } from "./registry-service.js";
import type { CommandBody } from "./schema.js";
import {
	detailsOf,
	ensureSetViews,
	SET_ACTIVE_VIEW_KEY,
	SET_GROUP_ORDERS_KEY,
	SET_OBJECT_ORDERS_KEY,
	SET_RELATION_LINKS_KEY,
	SET_VIEWS_KEY,
	VIEW_WIRE_KEY,
	wireOf,
} from "./set-view.js";

// The set screen's own controls write through this family (component/block/dataview/controls.tsx,
// component/menu/dataview/*). Every command is a small mutation of state the screen already sent us
// in its own wire shape: a view row keeps the client's view object (VIEW_WIRE_KEY) and the holder
// object keeps the block-level lists, so nothing here needs a translation table (ADR-0020) and every
// setting the shell exposes survives the round trip.
//
// Each answer carries the event the client's dispatcher applies to its store (dispatcher.ts:1872
// feeds a response's event through the same handler as the stream), so the screen updates without a
// reload — the same message core pushes.

type Details = Record<string, unknown>;

export type DataviewWrite = {
	// The event the client applies locally; null when the command has no event.
	event: Details | null;
	// Extra response keys the client's mapper reads (viewId, filterId).
	response: Details;
};

const ELEMENTS = {
	Filter: { field: "filters", idField: "id", eventKey: "filter" },
	Sort: { field: "sorts", idField: "id", eventKey: "sort" },
	ViewRelation: { field: "relations", idField: "key", eventKey: "relation" },
} as const;

type ElementKind = keyof typeof ELEMENTS;

// I.ViewType numeric → the kernel's layout string, kept on the row for the REST read path.
const VIEW_KERNEL_TYPE: Record<number, string> = {
	0: "grid",
	1: "list",
	2: "gallery",
	3: "board",
	4: "calendar",
};

export const DATAVIEW_WRITE_COMMANDS: ReadonlySet<string> = new Set([
	"BlockDataviewViewCreate",
	"BlockDataviewViewUpdate",
	"BlockDataviewViewDelete",
	"BlockDataviewViewSetPosition",
	"BlockDataviewViewSetActive",
	"BlockDataviewFilterAdd",
	"BlockDataviewFilterRemove",
	"BlockDataviewFilterReplace",
	"BlockDataviewFilterSort",
	"BlockDataviewSortAdd",
	"BlockDataviewSortRemove",
	"BlockDataviewSortReplace",
	"BlockDataviewSortSort",
	"BlockDataviewViewRelationRemove",
	"BlockDataviewViewRelationReplace",
	"BlockDataviewViewRelationSort",
	"BlockDataviewRelationAdd",
	"BlockDataviewRelationDelete",
	"BlockDataviewRelationSet",
	"BlockDataviewSetSource",
	"BlockDataviewGroupOrderUpdate",
	"BlockDataviewObjectOrderUpdate",
]);

function text(value: unknown) {
	return typeof value === "string" ? value : "";
}

function object(value: unknown): Details {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Details)
		: {};
}

function list(value: unknown): Details[] {
	return Array.isArray(value) ? (value as Details[]) : [];
}

function strings(value: unknown) {
	return Array.isArray(value)
		? value.filter((it): it is string => typeof it === "string")
		: [];
}

type Holder = {
	id: string;
	spaceId: string;
	typeId: string | null;
	creatorId: string;
	actorId: string;
	details: Details;
};

// The event the acting client applies to its store, fanned out to the peers with the same object
// open — the message core would push them, so a second member's view list moves without a reload.
function eventFor(
	holder: Holder,
	blockId: string,
	key: string,
	payload: Details,
): Details {
	const event = {
		contextId: holder.id,
		messages: [{ spaceId: holder.spaceId, [key]: { id: blockId, ...payload } }],
	};

	spaceEvents.emit(holder.spaceId, event as SessionEvent, holder.actorId);

	return event;
}

// The object the dataview block lives on. Resolved from contextId, write-gated, and healed so a set
// created before this path already has a readable view list to mutate.
async function resolveHolder(
	user: AuthUser,
	contextId: string,
): Promise<Holder | null> {
	const obj = await prisma.obj.findUnique({
		where: { id: contextId },
		select: {
			id: true,
			spaceId: true,
			typeId: true,
			creatorId: true,
			details: true,
		},
	});
	if (!obj) {
		return null;
	}

	await ensureSpaceAccess(user.id, obj.spaceId, "writer");

	const healed = await ensureSetViews(obj.spaceId, obj.creatorId ?? "", obj);

	return {
		id: obj.id,
		spaceId: obj.spaceId,
		typeId: obj.typeId,
		creatorId: obj.creatorId ?? "",
		actorId: user.id,
		details: detailsOf(healed),
	};
}

function viewIdsOf(holder: Holder): string[] {
	return strings(holder.details[SET_VIEWS_KEY]);
}

async function saveHolder(holder: Holder, patch: Details) {
	await prisma.obj.update({
		where: { id: holder.id },
		data: {
			details: {
				...holder.details,
				...patch,
			} as unknown as Prisma.InputJsonObject,
		},
	});
}

// The view row a view-scoped command addresses, with the client's view object it carries. A view id
// that isn't one of the holder's own rows is refused, so a command can't reach across a set.
async function targetView(holder: Holder, viewId: string) {
	if (!viewIdsOf(holder).includes(viewId)) {
		return null;
	}

	const row = await prisma.obj.findFirst({
		where: {
			id: viewId,
			spaceId: holder.spaceId,
			resolvedLayout: DATAVIEW_LAYOUT,
			isDeleted: false,
		},
	});
	const view = row ? wireOf(row) : null;

	return row && view ? { row, view, details: detailsOf(row) } : null;
}

async function saveView(
	target: { row: { id: string; name: string }; details: Details },
	view: Details,
) {
	await prisma.obj.update({
		where: { id: target.row.id },
		data: {
			name: text(view.name) || target.row.name,
			details: {
				...target.details,
				[VIEW_WIRE_KEY]: view,
			} as unknown as Prisma.InputJsonObject,
		},
	});
}

// The client reorders these lists by handing back their ids in the new order.
function reorder(
	elements: Details[],
	idField: string,
	ids: string[],
): Details[] {
	const byId = new Map(elements.map((it) => [text(it[idField]), it]));
	const ordered = ids
		.map((id) => byId.get(id))
		.filter((it): it is Details => !!it);

	return [
		...ordered,
		...elements.filter((it) => !ids.includes(text(it[idField]))),
	];
}

// One mutation of a view's filters, sorts or columns: apply it to the stored view, persist the row,
// and answer with the element operation the client's dispatcher replays on its copy.
async function updateElements(
	user: AuthUser,
	body: CommandBody,
	kind: ElementKind,
	mutate: (
		elements: Details[],
		body: CommandBody,
	) => { elements: Details[]; element: Details; response?: Details },
): Promise<DataviewWrite | null> {
	const owner = await resolveHolder(user, text(body.contextId));
	const target = owner ? await targetView(owner, text(body.viewId)) : null;
	if (!owner || !target) {
		return null;
	}

	const { elements, element, response } = mutate(
		list(target.view[ELEMENTS[kind].field]),
		body,
	);
	await saveView(target, {
		...target.view,
		[ELEMENTS[kind].field]: elements,
	});

	return {
		event: eventFor(owner, text(body.blockId), "blockDataviewViewUpdate", {
			viewId: target.row.id,
			[ELEMENTS[kind].eventKey]: [element],
		}),
		response: response ?? {},
	};
}

// The relation links a block-level RelationAdd earns its numeric format from: the space's own
// registry, the same table the views' columns resolve against.
async function relationFormats(spaceId: string, keys: string[]) {
	const rows = await prisma.relation.findMany({
		where: { spaceId, uniqueKey: { in: keys } },
		select: { uniqueKey: true, format: true },
	});

	return new Map(
		rows.map((row) => [row.uniqueKey, RELATION_FORMAT[row.format] ?? 0]),
	);
}

function linksOf(holder: Holder) {
	return list(holder.details[SET_RELATION_LINKS_KEY]).map((it) => ({
		key: text(it.key),
		format: Number(it.format ?? 0),
	}));
}

export async function dataviewWrite(
	user: AuthUser,
	name: string,
	body: CommandBody,
): Promise<DataviewWrite | null> {
	const blockId = text(body.blockId);
	const contextId = text(body.contextId);

	switch (name) {
		// The screen's "Create view" sends the whole view object it built locally. The row mints its
		// own id and the projection stamps it onto the view, so the response, the event and a later
		// ObjectOpen all name the same view — the screen looks the new one up by response.viewId
		// (controls.tsx:342) and switches to it only if that lookup succeeds.
		case "BlockDataviewViewCreate": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const view: Details = { ...object(body.view) };
			const sources = strings(body.source);
			const sourceTypeId =
				sources[0] ?? strings(owner.details.setOf)[0] ?? owner.typeId ?? "";

			const created = await dataviewRepository.create({
				spaceId: owner.spaceId,
				creatorId: owner.creatorId,
				name: text(view.name),
				sourceTypeId,
				layout: {
					viewType: VIEW_KERNEL_TYPE[Number(view.type ?? 0)] ?? "grid",
					dataviewRelations: list(view.relations).map((it) => text(it.key)),
					[VIEW_WIRE_KEY]: view,
				} as Prisma.InputJsonObject,
				filters: [],
				sorts: [],
			});

			await saveHolder(owner, {
				[SET_VIEWS_KEY]: [...viewIdsOf(owner), created.id],
				[SET_ACTIVE_VIEW_KEY]: created.id,
			});

			return {
				event: eventFor(owner, blockId, "blockDataviewViewSet", {
					view: { ...view, id: created.id },
				}),
				response: { viewId: created.id },
			};
		}

		case "BlockDataviewViewUpdate": {
			const owner = await resolveHolder(user, contextId);
			const target = owner ? await targetView(owner, text(body.viewId)) : null;
			if (!owner || !target) {
				return null;
			}

			const view = { ...target.view, ...object(body.view), id: target.row.id };
			await saveView(target, view);

			return {
				event: eventFor(owner, blockId, "blockDataviewViewSet", { view }),
				response: {},
			};
		}

		case "BlockDataviewViewDelete": {
			const owner = await resolveHolder(user, contextId);
			const target = owner ? await targetView(owner, text(body.viewId)) : null;
			if (!owner || !target) {
				return null;
			}

			const remaining = viewIdsOf(owner).filter((id) => id !== target.row.id);
			const active =
				text(owner.details[SET_ACTIVE_VIEW_KEY]) === target.row.id
					? (remaining[remaining.length - 1] ?? "")
					: text(owner.details[SET_ACTIVE_VIEW_KEY]);

			await saveHolder(owner, {
				[SET_VIEWS_KEY]: remaining,
				[SET_ACTIVE_VIEW_KEY]: active,
			});
			await prisma.obj.update({
				where: { id: target.row.id },
				data: { isDeleted: true },
			});

			return {
				event: eventFor(owner, blockId, "blockDataviewViewDelete", {
					viewId: target.row.id,
				}),
				response: {},
			};
		}

		case "BlockDataviewViewSetPosition": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const viewId = text(body.viewId);
			const ids = viewIdsOf(owner);
			if (!ids.includes(viewId)) {
				return null;
			}

			const ordered = ids.filter((id) => id !== viewId);
			const position = Number(body.position ?? 0);
			ordered.splice(
				Math.max(0, Math.min(ordered.length, position)),
				0,
				viewId,
			);

			await saveHolder(owner, { [SET_VIEWS_KEY]: ordered });

			return {
				event: eventFor(owner, blockId, "blockDataviewViewOrder", {
					viewIds: ordered,
				}),
				response: {},
			};
		}

		// The screen already switched its own meta before sending this; the write is what makes the
		// switch survive a reload, so it answers with no event.
		case "BlockDataviewViewSetActive": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const viewId = text(body.viewId);
			if (!viewIdsOf(owner).includes(viewId)) {
				return null;
			}

			await saveHolder(owner, { [SET_ACTIVE_VIEW_KEY]: viewId });

			return { event: null, response: {} };
		}

		case "BlockDataviewFilterAdd":
			return updateElements(user, body, "Filter", (elements, payload) => {
				const source = object(payload.filter);
				const filter = {
					...source,
					id: text(source.id) || crypto.randomUUID(),
				};

				return {
					elements: [...elements, filter],
					element: { add: { afterId: "", items: [filter] } },
					response: { filterId: filter.id },
				};
			});

		case "BlockDataviewFilterRemove":
			return updateElements(user, body, "Filter", (elements, payload) => {
				const ids = strings(payload.ids);

				return {
					elements: elements.filter((it) => !ids.includes(text(it.id))),
					element: { remove: { ids } },
				};
			});

		case "BlockDataviewFilterReplace":
			return updateElements(user, body, "Filter", (elements, payload) => {
				const id = text(payload.id);
				const item = { ...object(payload.filter), id };

				return {
					elements: elements.map((it) => (text(it.id) === id ? item : it)),
					element: { update: { id, item } },
				};
			});

		case "BlockDataviewFilterSort":
			return updateElements(user, body, "Filter", (elements, payload) => {
				const ids = strings(payload.ids);

				return {
					elements: reorder(elements, ELEMENTS.Filter.idField, ids),
					element: { move: { afterId: "", ids } },
				};
			});

		case "BlockDataviewSortAdd":
			return updateElements(user, body, "Sort", (elements, payload) => {
				const source = object(payload.sort);
				const sort = { ...source, id: text(source.id) || crypto.randomUUID() };

				return {
					elements: [...elements, sort],
					element: { add: { afterId: "", items: [sort] } },
				};
			});

		case "BlockDataviewSortRemove":
			return updateElements(user, body, "Sort", (elements, payload) => {
				const ids = strings(payload.ids);

				return {
					elements: elements.filter((it) => !ids.includes(text(it.id))),
					element: { remove: { ids } },
				};
			});

		case "BlockDataviewSortReplace":
			return updateElements(user, body, "Sort", (elements, payload) => {
				const id = text(payload.id);
				const item = { ...object(payload.sort), id };

				return {
					elements: elements.map((it) => (text(it.id) === id ? item : it)),
					element: { update: { id, item } },
				};
			});

		case "BlockDataviewSortSort":
			return updateElements(user, body, "Sort", (elements, payload) => {
				const ids = strings(payload.ids);

				return {
					elements: reorder(elements, ELEMENTS.Sort.idField, ids),
					element: { move: { afterId: "", ids } },
				};
			});

		// A view's columns are keyed by relation, so these commands splice by key rather than id.
		case "BlockDataviewViewRelationRemove":
			return updateElements(user, body, "ViewRelation", (elements, payload) => {
				const keys = strings(payload.relationKeys);

				return {
					elements: elements.filter((it) => !keys.includes(text(it.key))),
					element: { remove: { ids: keys } },
				};
			});

		// Dataview.viewRelationAdd (lib/dataview.ts:102) shows a new column through this command, so
		// a key the view doesn't carry yet is appended rather than dropped.
		case "BlockDataviewViewRelationReplace":
			return updateElements(user, body, "ViewRelation", (elements, payload) => {
				const key = text(payload.relationKey);
				const item = { ...object(payload.relation), key };
				const exists = elements.some((it) => text(it.key) === key);

				return {
					elements: exists
						? elements.map((it) => (text(it.key) === key ? item : it))
						: [...elements, item],
					element: { add: { afterId: "", items: [item] } },
				};
			});

		case "BlockDataviewViewRelationSort":
			return updateElements(user, body, "ViewRelation", (elements, payload) => {
				const keys = strings(payload.relationKeys);

				return {
					elements: reorder(elements, ELEMENTS.ViewRelation.idField, keys),
					element: { move: { afterId: "", ids: keys } },
				};
			});

		// Block-level: the links every view of this object can offer its columns.
		case "BlockDataviewRelationAdd": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const keys = strings(body.relationKeys);
			const formats = await relationFormats(owner.spaceId, keys);
			const existing = linksOf(owner);
			const relationLinks = [
				...existing,
				...keys
					.filter((key) => !existing.some((it) => it.key === key))
					.map((key) => ({ key, format: formats.get(key) ?? 0 })),
			];

			await saveHolder(owner, { [SET_RELATION_LINKS_KEY]: relationLinks });

			return {
				event: eventFor(owner, blockId, "blockDataviewRelationSet", {
					relationLinks,
				}),
				response: {},
			};
		}

		case "BlockDataviewRelationDelete": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const keys = strings(body.relationKeys);
			await saveHolder(owner, {
				[SET_RELATION_LINKS_KEY]: linksOf(owner).filter(
					(it) => !keys.includes(it.key),
				),
			});

			return {
				event: eventFor(owner, blockId, "blockDataviewRelationDelete", {
					relationKeys: keys,
				}),
				response: {},
			};
		}

		case "BlockDataviewRelationSet": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const keys = strings(body.relationKeys);
			const formats = await relationFormats(owner.spaceId, keys);
			const relationLinks = keys.map((key) => ({
				key,
				format: formats.get(key) ?? 0,
			}));

			await saveHolder(owner, { [SET_RELATION_LINKS_KEY]: relationLinks });

			return {
				event: eventFor(owner, blockId, "blockDataviewRelationSet", {
					relationLinks,
				}),
				response: {},
			};
		}

		// The set's sources are its own details: the query the screen runs reads them from there.
		case "BlockDataviewSetSource": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			await saveHolder(owner, { setOf: strings(body.source) });

			return { event: null, response: {} };
		}

		case "BlockDataviewGroupOrderUpdate": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const order = object(body.groupOrder);
			const viewId = text(order.viewId);
			const groupOrders = [
				...list(owner.details[SET_GROUP_ORDERS_KEY]).filter(
					(it) => text(it.viewId) !== viewId,
				),
				order,
			];

			await saveHolder(owner, { [SET_GROUP_ORDERS_KEY]: groupOrders });

			return {
				event: eventFor(owner, blockId, "blockDataViewGroupOrderUpdate", {
					groupOrder: order,
				}),
				response: {},
			};
		}

		case "BlockDataviewObjectOrderUpdate": {
			const owner = await resolveHolder(user, contextId);
			if (!owner) {
				return null;
			}

			const orders = list(body.objectOrders);
			const key = (it: Details) => `${text(it.viewId)}|${text(it.groupId)}`;
			const stored = list(owner.details[SET_OBJECT_ORDERS_KEY]);

			const objectOrders = orders.reduce<Details[]>((acc, order) => {
				const previous = acc.find((it) => key(it) === key(order));
				const moved = strings(order.objectIds);
				const kept = strings(previous?.objectIds).filter(
					(id) => !moved.includes(id),
				);

				return [
					...acc.filter((it) => key(it) !== key(order)),
					{ ...order, objectIds: [...kept, ...moved] },
				];
			}, stored);

			await saveHolder(owner, { [SET_OBJECT_ORDERS_KEY]: objectOrders });

			const first = orders[0] ?? {};

			return {
				event: eventFor(owner, blockId, "blockDataViewObjectOrderUpdate", {
					viewId: text(first.viewId),
					groupId: text(first.groupId),
					changes: orders,
				}),
				response: {},
			};
		}

		default:
			return null;
	}
}
