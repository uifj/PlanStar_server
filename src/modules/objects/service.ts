import {
	ensureSpaceAccess,
	PERMISSION_RANK,
	type SpacePermissionLevel,
} from "../../auth/space-access.js";
import {
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../errors/http-errors.js";
import type { Obj, Prisma } from "../../generated/prisma/client.js";
import type { RelationFormat } from "../../generated/prisma/enums.js";
import type { AuthUser } from "../../lib/auth.js";
import { createPaginationMeta, getPagination } from "../../pagination/index.js";
import {
	DEFAULT_OBJECT_SORT_FIELD,
	LISTABLE_OBJECT_LAYOUTS,
	SYSTEM_RELATIONS,
} from "./constants.js";
import { toObject } from "./dto.js";
import {
	compileObjectFilters,
	type ObjectFilterInput,
	type ObjectSortInput,
	type RelationDefinition,
	type RelationRegistry,
} from "./filters.js";
import { objectRepository } from "./repository.js";
import {
	type BacklinkListQuery,
	type CreateObjectInput,
	FiltersPayloadSchema,
	type ObjectListQuery,
	SortsPayloadSchema,
	type UpdateObjectInput,
} from "./schema.js";

const ARRAY_FORMATS = new Set<RelationFormat>(["select", "multiSelect"]);

interface NormalizedDetails {
	details: Prisma.InputJsonObject;
	links: Record<string, string[]>;
}

async function loadRegistry(spaceId: string): Promise<RelationRegistry> {
	const relations = await objectRepository.findRelations(spaceId);
	const registry: RelationRegistry = { ...SYSTEM_RELATIONS };

	for (const relation of relations) {
		registry[relation.uniqueKey] = {
			format: relation.format,
			maxCount: relation.maxCount,
		};
	}

	return registry;
}

function parseFilters(raw: string | undefined): ObjectFilterInput[] {
	if (!raw) {
		return [];
	}

	let decoded: unknown;

	try {
		decoded = JSON.parse(raw);
	} catch {
		throw new ValidationError("Filters must be valid JSON.");
	}

	const parsed = FiltersPayloadSchema.safeParse(decoded);

	if (!parsed.success) {
		throw new ValidationError("Filters are not shaped correctly.");
	}

	return parsed.data;
}

function normalizeDetailValue(
	definition: RelationDefinition,
	key: string,
	value: unknown,
): Prisma.InputJsonValue {
	if (ARRAY_FORMATS.has(definition.format)) {
		const list = Array.isArray(value) ? value : [value];

		if (list.some((item) => typeof item !== "string")) {
			throw new ValidationError(`Relation ${key} holds option identifiers.`);
		}

		return definition.maxCount
			? list.slice(0, definition.maxCount)
			: (list as Prisma.InputJsonValue);
	}

	switch (definition.format) {
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) {
				throw new ValidationError(`Relation ${key} expects a number.`);
			}

			return value;
		case "checkbox":
			if (typeof value !== "boolean") {
				throw new ValidationError(`Relation ${key} expects true or false.`);
			}

			return value;
		case "date": {
			const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;

			if (Number.isNaN(parsed)) {
				throw new ValidationError(`Relation ${key} expects a date.`);
			}

			return new Date(parsed).toISOString();
		}
		default:
			if (typeof value !== "string") {
				throw new ValidationError(`Relation ${key} expects text.`);
			}

			return value;
	}
}

function normalizeDetails(
	input: Record<string, unknown>,
	registry: RelationRegistry,
): NormalizedDetails {
	const details: Record<string, Prisma.InputJsonValue> = {};
	const links: Record<string, string[]> = {};

	for (const [key, value] of Object.entries(input)) {
		const definition = registry[key];

		if (!definition) {
			throw new ValidationError(`Unknown relation: ${key}`);
		}

		if (definition.column) {
			throw new ValidationError(
				`Relation ${key} is written as a field, not in details.`,
			);
		}

		// ADR-0002: object values live in Link, not in the JSONB map.
		if (definition.format === "object") {
			const targets = Array.isArray(value) ? value : [value];

			if (targets.some((target) => typeof target !== "string")) {
				throw new ValidationError(`Relation ${key} holds object identifiers.`);
			}

			links[key] = dedupe(targets as string[]);
			continue;
		}

		details[key] = normalizeDetailValue(definition, key, value);
	}

	return { details, links };
}

function dedupe(values: string[]) {
	return [...new Set(values)];
}

function refuseOutsiders(error: unknown): never {
	// ADR-0006: with no membership at all, the object does not exist for the caller.
	if (error instanceof ForbiddenError) {
		throw new NotFoundError("Object not found.");
	}

	throw error;
}

async function assertObjectAccess(
	user: AuthUser,
	spaceId: string,
	minimum: SpacePermissionLevel,
) {
	const membership = await ensureSpaceAccess(user.id, spaceId, "reader").catch(
		refuseOutsiders,
	);

	// A member without the rank is told so, because they already know it exists.
	if (PERMISSION_RANK[membership.permission] < PERMISSION_RANK[minimum]) {
		throw new ForbiddenError();
	}

	return membership;
}

async function assertLinkTargets(
	spaceId: string,
	links: Record<string, string[]>,
) {
	const targets = [...new Set(Object.values(links).flat())];

	if (targets.length === 0) {
		return;
	}

	const known = await objectRepository.findIdsInSpace(spaceId, targets);
	const missing = targets.filter((target) => !known.has(target));

	if (missing.length > 0) {
		throw new ValidationError(`Unknown objects: ${missing.join(", ")}`);
	}
}

async function withLinks(objects: Obj[]) {
	const links = await objectRepository.findLinksByFromIds(
		objects.map((object) => object.id),
	);
	const grouped = new Map<string, Record<string, string[]>>();

	for (const link of links) {
		const bucket = grouped.get(link.fromId) ?? {};

		bucket[link.relationKey] = [...(bucket[link.relationKey] ?? []), link.toId];
		grouped.set(link.fromId, bucket);
	}

	return objects.map((object) =>
		toObject(object, grouped.get(object.id) ?? {}),
	);
}

interface ObjectListSpec {
	filters: ObjectFilterInput[];
	sorts: ObjectSortInput[];
	layouts: string[];
	page: number;
	limit: number;
}

// One list interface, two adapters: the HTTP query parses into this spec, and a
// saved view hands it its stored filters and sorts without a JSON round trip.
async function list(user: AuthUser, spaceId: string, spec: ObjectListSpec) {
	await ensureSpaceAccess(user.id, spaceId, "reader");

	const registry = await loadRegistry(spaceId);
	const { skip, take } = getPagination(spec);

	const listCompiled = compileObjectFilters({
		registry,
		filters: spec.filters,
		sorts: spec.sorts,
	});
	const countCompiled = compileObjectFilters({
		registry,
		filters: spec.filters,
		sorts: [],
	});

	const [rows, total] = await Promise.all([
		objectRepository.findMany(
			{ spaceId, layouts: spec.layouts, compiled: listCompiled },
			{ limit: take, offset: skip },
		),
		objectRepository.count({
			spaceId,
			layouts: spec.layouts,
			compiled: countCompiled,
		}),
	]);

	return {
		data: await withLinks(rows),
		meta: createPaginationMeta({
			page: spec.page,
			limit: spec.limit,
			total,
		}),
	};
}

async function findMany(
	user: AuthUser,
	spaceId: string,
	query: ObjectListQuery,
) {
	const filters = parseFilters(query.filters);

	if (query.typeId) {
		filters.push({ key: "typeId", operator: "equal", value: query.typeId });
	}

	return list(user, spaceId, {
		filters,
		sorts: [
			{ key: query.sort ?? DEFAULT_OBJECT_SORT_FIELD, order: query.order },
		],
		layouts: query.layout ? [query.layout] : [...LISTABLE_OBJECT_LAYOUTS],
		page: query.page,
		limit: query.limit,
	});
}

async function findById(user: AuthUser, objectId: string) {
	const object = await objectRepository.findById(objectId);

	if (!object) {
		throw new NotFoundError("Object not found.");
	}

	await assertObjectAccess(user, object.spaceId, "reader");

	const [detailed] = await withLinks([object]);

	return detailed;
}

// Blocks, views and any other body writer asks here rather than repeating the
// lookup, so the writer rule and the 404-not-403 rule stay in one place.
async function assertEditable(user: AuthUser, objectId: string) {
	const object = await objectRepository.findById(objectId);

	if (!object) {
		throw new NotFoundError("Object not found.");
	}

	await assertObjectAccess(user, object.spaceId, "writer");

	return {
		id: object.id,
		spaceId: object.spaceId,
		resolvedLayout: object.resolvedLayout,
	};
}

async function create(
	user: AuthUser,
	spaceId: string,
	input: CreateObjectInput,
) {
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const registry = await loadRegistry(spaceId);
	const type = input.typeId
		? await objectRepository.findTypeInSpace(spaceId, input.typeId)
		: null;

	if (input.typeId && !type) {
		throw new NotFoundError("Type not found.");
	}

	const normalized = normalizeDetails(input.details ?? {}, registry);
	await assertLinkTargets(spaceId, normalized.links);
	const object = await objectRepository.create({
		spaceId,
		typeId: type?.id ?? null,
		resolvedLayout: type?.layout ?? "basic",
		name: input.name,
		description: input.description ?? null,
		snippet: input.snippet ?? null,
		iconEmoji: input.iconEmoji ?? null,
		details: normalized.details,
		done: input.done ?? null,
		isFavorite: input.isFavorite ?? false,
		creatorId: user.id,
	});

	await objectRepository.writeLinks({
		spaceId,
		fromId: object.id,
		links: normalized.links,
	});

	return toObject(object, normalized.links);
}

async function update(
	user: AuthUser,
	objectId: string,
	input: UpdateObjectInput,
) {
	const object = await objectRepository.findById(objectId);

	if (!object) {
		throw new NotFoundError("Object not found.");
	}

	await assertObjectAccess(user, object.spaceId, "writer");

	const registry = await loadRegistry(object.spaceId);
	const fields: Prisma.ObjUpdateInput = {};

	if (input.name !== undefined) fields.name = input.name;
	if (input.description !== undefined) fields.description = input.description;
	if (input.snippet !== undefined) fields.snippet = input.snippet;
	if (input.iconEmoji !== undefined) fields.iconEmoji = input.iconEmoji;
	if (input.done !== undefined) fields.done = input.done;
	if (input.isFavorite !== undefined) fields.isFavorite = input.isFavorite;

	let linkPatch: Record<string, string[]> = {};

	if (input.details) {
		const incoming: Record<string, unknown> = {};
		const cleared: string[] = [];

		for (const [key, value] of Object.entries(input.details)) {
			if (value === null) {
				cleared.push(key);
				continue;
			}

			incoming[key] = value;
		}

		const normalized = normalizeDetails(incoming, registry);
		const current = (object.details ?? {}) as Record<string, unknown>;
		const merged = { ...current, ...normalized.details };

		for (const key of cleared) {
			delete merged[key];
		}

		fields.details = merged as Prisma.InputJsonObject;
		linkPatch = { ...normalized.links };

		for (const key of cleared) {
			linkPatch[key] = [];
		}
	}

	await assertLinkTargets(object.spaceId, linkPatch);

	const updated = await objectRepository.update(object.id, fields);

	await objectRepository.writeLinks({
		spaceId: object.spaceId,
		fromId: object.id,
		links: linkPatch,
	});

	const [detailed] = await withLinks([updated]);

	return detailed;
}

// The filter language belongs to this module (ADR-0007), so a saved view hands its
// stored configuration here rather than re-declaring the schema. The recursive
// filter tree cannot be rendered into OpenAPI, which is why the route schemas keep
// these as free-form JSON and the shape is checked here instead.
async function validateQuery(
	spaceId: string,
	filters: unknown,
	sorts: unknown,
) {
	const parsedFilters = FiltersPayloadSchema.safeParse(filters);

	if (!parsedFilters.success) {
		throw new ValidationError("Filters are not shaped correctly.");
	}

	const parsedSorts = SortsPayloadSchema.safeParse(sorts);

	if (!parsedSorts.success) {
		throw new ValidationError("Sorts are not shaped correctly.");
	}

	compileObjectFilters({
		registry: await loadRegistry(spaceId),
		filters: parsedFilters.data,
		sorts: parsedSorts.data,
	});

	return {
		filters: parsedFilters.data as ObjectFilterInput[],
		sorts: parsedSorts.data as ObjectSortInput[],
	};
}

async function findBacklinks(
	user: AuthUser,
	objectId: string,
	query: BacklinkListQuery,
) {
	const object = await objectRepository.findById(objectId);

	if (!object) {
		throw new NotFoundError("Object not found.");
	}

	await assertObjectAccess(user, object.spaceId, "reader");

	const sourceIds = await objectRepository.findBacklinkSourceIds(
		object.spaceId,
		object.id,
	);
	const { skip, take } = getPagination(query);
	const rows = await objectRepository.findManyByIds(
		sourceIds.slice(skip, skip + take),
	);

	return {
		data: await withLinks(rows),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total: sourceIds.length,
		}),
	};
}

async function archive(user: AuthUser, objectId: string) {
	const object = await objectRepository.findById(objectId);

	if (!object) {
		throw new NotFoundError("Object not found.");
	}

	await assertObjectAccess(user, object.spaceId, "writer");

	await objectRepository.update(object.id, { isArchived: true });
}

export const objectService = {
	list,
	validateQuery,
	assertEditable,
	findMany,
	findById,
	findBacklinks,
	create,
	update,
	archive,
};
