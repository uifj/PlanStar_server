import { ensureSpaceAccess } from "../../auth/space-access.js";
import { ConflictError, ValidationError } from "../../errors/http-errors.js";
import type { AuthUser } from "../../lib/auth.js";
import {
	createPaginationMeta,
	getPagination,
	getSorting,
} from "../../pagination/index.js";
import {
	DEFAULT_RELATION_SORT_FIELD,
	DEFAULT_RELATION_SORT_ORDER,
} from "./constants.js";
import { toRelation } from "./dto.js";
import { relationRepository } from "./repository.js";
import type { CreateRelationInput, RelationListQuery } from "./schema.js";

async function findMany(
	user: AuthUser,
	spaceId: string,
	query: RelationListQuery,
) {
	await ensureSpaceAccess(user.id, spaceId, "reader");

	const { skip, take } = getPagination(query);
	const { orderBy } = getSorting(query.sort, query.order, {
		defaultField: DEFAULT_RELATION_SORT_FIELD,
		defaultOrder: DEFAULT_RELATION_SORT_ORDER,
	});
	const where = query.typeId ? { typeId: query.typeId } : {};

	const [relations, total] = await Promise.all([
		relationRepository.findMany(spaceId, where, { skip, take, orderBy }),
		relationRepository.count(spaceId, where),
	]);

	return {
		data: relations.map(toRelation),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function create(
	user: AuthUser,
	spaceId: string,
	input: CreateRelationInput,
) {
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const existing = await relationRepository.findByUniqueKey(
		spaceId,
		input.uniqueKey,
	);

	if (existing) {
		throw new ConflictError(
			`Relation ${input.uniqueKey} already exists in this space.`,
		);
	}

	const relation = await relationRepository.create({
		spaceId,
		uniqueKey: input.uniqueKey,
		format: input.format,
		name: input.name,
		description: input.description ?? null,
		maxCount: input.maxCount ?? null,
		typeId: input.typeId ?? null,
	});

	await relationRepository.upsertMirror({
		id: relation.id,
		spaceId,
		creatorId: user.id,
		name: relation.name,
		description: relation.description,
		details: { uniqueKey: relation.uniqueKey, format: relation.format },
	});

	return toRelation(relation);
}

async function attachKeys(
	spaceId: string,
	typeId: string,
	uniqueKeys: string[],
) {
	if (uniqueKeys.length === 0) {
		return;
	}

	const relations = await relationRepository.findMany(
		spaceId,
		{ uniqueKey: { in: uniqueKeys } },
		{ skip: 0, take: uniqueKeys.length, orderBy: { createdAt: "asc" } },
	);

	if (relations.length !== uniqueKeys.length) {
		const known = new Set(relations.map((relation) => relation.uniqueKey));
		const missing = uniqueKeys.filter((key) => !known.has(key));

		throw new ValidationError(
			`Unknown relations for this space: ${missing.join(", ")}`,
		);
	}

	await relationRepository.attachRelationsToType(spaceId, uniqueKeys, typeId);
}

export const relationService = {
	findMany,
	create,
	attachKeys,
};
