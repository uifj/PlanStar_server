import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { DATAVIEW_LAYOUT } from "../dataviews/constants.js";
import { dataviewRepository } from "../dataviews/repository.js";
import { RELATION_FORMAT } from "./registry-service.js";

// ADR-0012 makes a saved view an object; this client has no view-object subscription, so the set's
// views travel inline on the dataview block (mapper.ts:270-281). The set therefore keeps the ids of
// its own view objects, and ObjectOpen projects them into the block content the screen reads.
export const SET_VIEWS_KEY = "dataviewViews";
export const SET_ACTIVE_VIEW_KEY = "dataviewActiveView";

// A view row written through the command shim carries the client's own view object, exactly as
// Mapper.To.View sent it (ADR-0020: the shell owns view semantics, so every setting the screen
// exposes round-trips without a translation table). Rows written by the pre-pivot REST API have no
// such blob and are still projected from the kernel fields below.
export const VIEW_WIRE_KEY = "dataviewView";

// The dataview block's own state, which belongs to the object rather than to a view.
export const SET_RELATION_LINKS_KEY = "dataviewRelationLinks";
export const SET_GROUP_ORDERS_KEY = "dataviewGroupOrders";
export const SET_OBJECT_ORDERS_KEY = "dataviewObjectOrders";

// The client's block id for a set/collection dataview (json/constant.ts:210). set.tsx looks the
// child up by this id and the grid's shortcuts assume it.
export const DATAVIEW_BLOCK_ID = "dataview";

// I.ViewType (interface/block/dataview.ts:32).
const VIEW_TYPE: Record<string, number> = {
	grid: 0,
	list: 1,
	gallery: 2,
	board: 3,
	calendar: 4,
};

// I.FilterCondition (interface/block/dataview.ts:60).
const FILTER_CONDITION: Record<string, number> = {
	equal: 1,
	notEqual: 2,
	greater: 3,
	less: 4,
	greaterOrEqual: 5,
	lessOrEqual: 6,
	like: 7,
	notLike: 8,
	in: 9,
	allIn: 13,
	empty: 11,
	notEmpty: 12,
};

// I.SortType: Asc 0, Desc 1.
const SORT_TYPE: Record<string, number> = { asc: 0, desc: 1 };

type Details = Record<string, unknown>;

export function detailsOf(obj: { details: Prisma.JsonValue }): Details {
	return obj.details &&
		typeof obj.details === "object" &&
		!Array.isArray(obj.details)
		? (obj.details as Details)
		: {};
}

// The columns a fresh grid shows: the name plus whatever the object's own type installs, so the set
// screen opens with the same columns the type sidebar offers rather than an empty table.
async function defaultRelationKeys(spaceId: string, typeId: string) {
	const relations = await prisma.relation.findMany({
		where: { spaceId, typeId },
		select: { uniqueKey: true, format: true },
		orderBy: { name: "asc" },
	});

	const keys = [{ key: "name", format: "shortText" }];
	for (const relation of relations) {
		keys.push({ key: relation.uniqueKey, format: relation.format });
	}
	return keys;
}

// The view object a healed set starts with, in the client's own wire shape so the write commands
// mutate it like any view the screen created. The id is stamped by the projection, not stored here.
function defaultWireView(columns: { key: string }[], sourceTypeId: string) {
	return {
		type: VIEW_TYPE.grid,
		name: "Grid",
		coverRelationKey: "",
		coverFit: false,
		cardSize: 0,
		listSize: 0,
		hideIcon: false,
		groupRelationKey: "",
		endRelationKey: "",
		wrapContent: true,
		groupBackgroundColors: false,
		pageLimit: 0,
		defaultTemplateId: "",
		defaultObjectTypeId: sourceTypeId,
		relations: columns.map((column) => ({
			key: column.key,
			isVisible: true,
			width: 0,
			formula: 0,
			align: 0,
		})),
		filters: [],
		// The client echoes a view's sorts verbatim, so this is an Anytype relation key rather than
		// the kernel's column name — a `createdAt` would come back as an unknown relation.
		sorts: [
			{
				id: "sort-0",
				RelationKey: "createdDate",
				type: SORT_TYPE.desc,
				customOrder: [],
				emptyPlacement: 0,
			},
		],
	};
}

// Idempotent: a set that already owns readable views keeps them, so healing a set that predates this
// path — or re-opening one after a partial write — never duplicates a view. Returns the set's row as
// it now stands, so the caller projects the ids it just wrote.
export async function ensureSetViews(
	spaceId: string,
	creatorId: string,
	obj: { id: string; details: Prisma.JsonValue; typeId: string | null },
) {
	const details = detailsOf(obj);
	const stored = Array.isArray(details[SET_VIEWS_KEY])
		? (details[SET_VIEWS_KEY] as string[])
		: [];

	const sourceTypeIds = Array.isArray(details.setOf)
		? (details.setOf as string[]).filter((it) => typeof it === "string")
		: [];
	const sourceTypeId = sourceTypeIds[0] ?? obj.typeId ?? "";

	if (stored.length && sourceTypeId) {
		const rows = await prisma.obj.findMany({
			where: { id: { in: stored }, spaceId, resolvedLayout: DATAVIEW_LAYOUT },
		});
		if (rows.length === stored.length) {
			// Views healed before a row carried its own view object get one on the next open, so
			// every write command starts from the same shape the screen created.
			const stale = rows.filter((row) => !wireOf(row));
			if (stale.length) {
				const columns = await defaultRelationKeys(spaceId, sourceTypeId);
				await Promise.all(
					stale.map((row) =>
						prisma.obj.update({
							where: { id: row.id },
							data: {
								details: {
									...detailsOf(row),
									[VIEW_WIRE_KEY]: projectKernelView(
										row,
										detailsOf(row),
										sourceTypeId,
										columns,
									),
								} as Prisma.InputJsonObject,
							},
						}),
					),
				);
			}
			return obj;
		}
	}

	if (!sourceTypeId) {
		return obj;
	}

	const columns = await defaultRelationKeys(spaceId, sourceTypeId);
	const view = await dataviewRepository.create({
		spaceId,
		creatorId,
		name: "Grid",
		sourceTypeId,
		layout: {
			viewType: "grid",
			dataviewRelations: columns.map((it) => it.key),
			[VIEW_WIRE_KEY]: defaultWireView(columns, sourceTypeId),
		} as Prisma.InputJsonObject,
		filters: [],
		// The client echoes a view's sorts verbatim, so these are Anytype relation keys rather
		// than the kernel's column names — a `createdAt` would come back as an unknown relation.
		sorts: [
			{ key: "createdDate", order: "desc" },
		] as unknown as Prisma.InputJsonValue,
	});

	const viewIds = [view.id];
	return prisma.obj.update({
		where: { id: obj.id },
		data: {
			details: {
				...details,
				[SET_VIEWS_KEY]: viewIds,
				[SET_ACTIVE_VIEW_KEY]: view.id,
			} as Prisma.InputJsonObject,
		},
		select: { id: true, details: true, typeId: true },
	});
}

function projectSorts(stored: unknown) {
	if (!Array.isArray(stored)) {
		return [];
	}
	return stored.flatMap((it, index) => {
		const sort = it as { key?: unknown; order?: unknown };
		if (typeof sort.key !== "string") {
			return [];
		}
		return [
			{
				id: `sort-${index}`,
				RelationKey: sort.key,
				type: SORT_TYPE[String(sort.order ?? "asc")] ?? 0,
				customOrder: [],
				emptyPlacement: 0,
			},
		];
	});
}

function projectFilters(stored: unknown) {
	if (!Array.isArray(stored)) {
		return [];
	}
	return stored.flatMap((it, index) => {
		const filter = it as { key?: unknown; operator?: unknown; value?: unknown };
		if (typeof filter.key !== "string") {
			return [];
		}
		return [
			{
				id: `filter-${index}`,
				RelationKey: filter.key,
				operator: 0,
				condition: FILTER_CONDITION[String(filter.operator ?? "")] ?? 0,
				quickOption: 0,
				value: filter.value ?? null,
				nestedFilters: [],
			},
		];
	});
}

// The view object a row carries for the client, or null for a row that only has kernel fields.
export function wireOf(row: { details: Prisma.JsonValue }) {
	const stored = detailsOf(row)[VIEW_WIRE_KEY];
	return stored && typeof stored === "object" && !Array.isArray(stored)
		? (stored as Details)
		: null;
}

// A view row written by the pre-pivot REST router has no view object of its own: the kernel's
// layout fields are translated into the client's shape instead.
function projectKernelView(
	row: { id: string; name: string },
	viewDetails: Details,
	sourceTypeId: string,
	columns: { key: string }[],
): Details {
	const keys = Array.isArray(viewDetails.dataviewRelations)
		? (viewDetails.dataviewRelations as string[])
		: columns.map((it) => it.key);

	return {
		id: row.id,
		type: VIEW_TYPE[String(viewDetails.viewType ?? "grid")] ?? VIEW_TYPE.grid,
		name: row.name,
		coverRelationKey: "",
		coverFit: false,
		cardSize: 0,
		listSize: 0,
		hideIcon: false,
		groupRelationKey: String(viewDetails.groupRelationKey ?? ""),
		endRelationKey: "",
		wrapContent: true,
		pageLimit: 0,
		defaultTemplateId: "",
		defaultObjectTypeId: sourceTypeId,
		relations: keys.map((key) => ({
			key,
			isVisible: true,
			width: 0,
			formula: 0,
			align: 0,
		})),
		filters: projectFilters(viewDetails.dataviewFilters),
		sorts: projectSorts(viewDetails.dataviewSorts),
	};
}

// The dataview block content the set screen renders: the set's view objects echoed in the client's
// inline view shape, with the relation links its grid columns resolve their formats from.
export async function dataviewBlockFor(
	spaceId: string,
	obj: { id: string; typeId: string | null; details: Prisma.JsonValue },
) {
	const stored = detailsOf(obj);
	const viewIds = Array.isArray(stored[SET_VIEWS_KEY])
		? (stored[SET_VIEWS_KEY] as string[])
		: [];
	const activeViewId =
		typeof stored[SET_ACTIVE_VIEW_KEY] === "string"
			? (stored[SET_ACTIVE_VIEW_KEY] as string)
			: (viewIds[0] ?? "");

	const rows = viewIds.length
		? await prisma.obj.findMany({
				where: {
					id: { in: viewIds },
					spaceId,
					resolvedLayout: DATAVIEW_LAYOUT,
				},
			})
		: [];
	const byId = new Map(rows.map((row) => [row.id, row]));
	const ordered = viewIds
		.map((id) => byId.get(id))
		.filter((row): row is (typeof rows)[number] => !!row);

	if (!ordered.length) {
		return null;
	}

	const sourceTypeIds = Array.isArray(stored.setOf)
		? (stored.setOf as string[]).filter((it) => typeof it === "string")
		: [];
	const sourceTypeId = sourceTypeIds[0] ?? obj.typeId ?? "";
	const columns = sourceTypeId
		? await defaultRelationKeys(spaceId, sourceTypeId)
		: [];

	const views = ordered.map((row) => {
		const view = wireOf(row);
		return {
			...(view ??
				projectKernelView(row, detailsOf(row), sourceTypeId, columns)),
			id: row.id,
		};
	});

	const relationLinks = Array.isArray(stored[SET_RELATION_LINKS_KEY])
		? (stored[SET_RELATION_LINKS_KEY] as { key?: unknown; format?: unknown }[])
		: columns.map((it) => ({
				key: it.key,
				format: RELATION_FORMAT[it.format] ?? 0,
			}));

	return {
		source: sourceTypeIds,
		activeView:
			activeViewId && byId.has(activeViewId) ? activeViewId : ordered[0].id,
		TargetObjectId: "",
		isCollection: false,
		relationLinks: relationLinks.map((it) => ({
			key: String(it.key ?? ""),
			format: Number(it.format ?? 0),
		})),
		groupOrders: Array.isArray(stored[SET_GROUP_ORDERS_KEY])
			? (stored[SET_GROUP_ORDERS_KEY] as Details[])
			: [],
		objectOrders: Array.isArray(stored[SET_OBJECT_ORDERS_KEY])
			? (stored[SET_OBJECT_ORDERS_KEY] as Details[])
			: [],
		views,
	};
}
