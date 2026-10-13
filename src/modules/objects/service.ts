import { ensureSpaceAccess } from "../../auth/space-access.js";
import {
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../errors/http-errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
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
	type RelationDefinition,
	type RelationRegistry,
} from "./filters.js";
import { objectRepository } from "./repository.js";
import {
	type CreateObjectInput,
	FiltersPayloadSchema,
	type ObjectListQuery,
	type UpdateObjectInput,
} from "./schema.js";

const ARRAY_FORMATS = new Set<RelationFormat>([
	"select",
	"multiSelect",
	"object",
]);

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
	if (definition.format === "object") {
		throw new ValidationError(
			`Relation ${key} links objects, which are not writable yet.`,
		);
	}

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
): Prisma.InputJsonObject {
	const details: Record<string, Prisma.InputJsonValue> = {};

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

		details[key] = normalizeDetailValue(definition, key, value);
	}

	return details;
}

async function assertObjectAccess(
	user: AuthUser,
	spaceId: string,
	minimum: "reader" | "writer",
) {
	try {
		return await ensureSpaceAccess(user.id, spaceId, minimum);
	} catch (error) {
		// ADR-0006: an object the caller cannot reach is simply not found.
		if (error instanceof ForbiddenError) {
			throw new NotFoundError("Object not found.");
		}

		throw error;
	}
}

async function findMany(
	user: AuthUser,
	spaceId: string,
	query: ObjectListQuery,
) {
	await ensureSpaceAccess(user.id, spaceId, "reader");

	const registry = await loadRegistry(spaceId);
	const filters = parseFilters(query.filters);

	if (query.typeId) {
		filters.push({ key: "typeId", operator: "equal", value: query.typeId });
	}

	const layouts = query.layout ? [query.layout] : [...LISTABLE_OBJECT_LAYOUTS];
	const sorts = [
		{ key: query.sort ?? DEFAULT_OBJECT_SORT_FIELD, order: query.order },
	];
	const { skip, take } = getPagination(query);

	const listCompiled = compileObjectFilters({ registry, filters, sorts });
	const countCompiled = compileObjectFilters({ registry, filters, sorts: [] });

	const [rows, total] = await Promise.all([
		objectRepository.findMany(
			{ spaceId, layouts, compiled: listCompiled },
			{ limit: take, offset: skip },
		),
		objectRepository.count({ spaceId, layouts, compiled: countCompiled }),
	]);

	return {
		data: rows.map(toObject),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function findById(user: AuthUser, objectId: string) {
	const object = await objectRepository.findById(objectId);

	if (!object) {
		throw new NotFoundError("Object not found.");
	}

	await assertObjectAccess(user, object.spaceId, "reader");

	return toObject(object);
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

	const object = await objectRepository.create({
		spaceId,
		typeId: type?.id ?? null,
		resolvedLayout: type?.layout ?? "basic",
		name: input.name,
		description: input.description ?? null,
		snippet: input.snippet ?? null,
		iconEmoji: input.iconEmoji ?? null,
		details: normalizeDetails(input.details ?? {}, registry),
		done: input.done ?? null,
		isFavorite: input.isFavorite ?? false,
		creatorId: user.id,
	});

	return toObject(object);
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

	if (input.details) {
		const current = (object.details ?? {}) as Record<string, unknown>;
		const merged = { ...current };

		for (const [key, value] of Object.entries(input.details)) {
			if (value === null) {
				delete merged[key];
				continue;
			}

			merged[key] = value;
		}

		fields.details = normalizeDetails(merged, registry);
	}

	const updated = await objectRepository.update(object.id, fields);

	return toObject(updated);
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
	findMany,
	findById,
	create,
	update,
	archive,
};
