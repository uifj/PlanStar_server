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

function detailsOf(obj: { details: Prisma.JsonValue }): Details {
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

	if (stored.length) {
		const live = await prisma.obj.count({
			where: { id: { in: stored }, spaceId, resolvedLayout: DATAVIEW_LAYOUT },
		});
		if (live === stored.length) {
			return obj;
		}
	}

	const sourceTypeIds = Array.isArray(details.setOf)
		? (details.setOf as string[]).filter((it) => typeof it === "string")
		: [];
	const sourceTypeId = sourceTypeIds[0] ?? obj.typeId ?? "";
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

// The dataview block content the set screen renders: the set's view objects projected into the
// client's inline view shape, with the relation links its grid columns resolve their formats from.
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
		const viewDetails = detailsOf(row);
		const keys = Array.isArray(viewDetails.dataviewRelations)
			? (viewDetails.dataviewRelations as string[])
			: columns.map((it) => it.key);
		const type =
			VIEW_TYPE[String(viewDetails.viewType ?? "grid")] ?? VIEW_TYPE.grid;

		return {
			id: row.id,
			type,
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
	});

	return {
		source: sourceTypeIds,
		activeView:
			activeViewId && byId.has(activeViewId) ? activeViewId : ordered[0].id,
		TargetObjectId: "",
		isCollection: false,
		relationLinks: columns.map((it) => ({
			key: it.key,
			format: RELATION_FORMAT[it.format] ?? 0,
		})),
		groupOrders: [],
		objectOrders: [],
		views,
	};
}
