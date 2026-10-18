import { ensureSpaceAccess } from "../../auth/space-access.js";
import { ConflictError } from "../../errors/http-errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthUser } from "../../lib/auth.js";
import {
	createPaginationMeta,
	getPagination,
	getSorting,
} from "../../pagination/index.js";
import { relationService } from "../relations/service.js";
import {
	DEFAULT_OBJECT_TYPE_SORT_FIELD,
	DEFAULT_OBJECT_TYPE_SORT_ORDER,
} from "./constants.js";
import { toObjectType } from "./dto.js";
import { objectTypeRepository } from "./repository.js";
import type { CreateObjectTypeInput, ObjectTypeListQuery } from "./schema.js";

async function findMany(
	user: AuthUser,
	spaceId: string,
	query: ObjectTypeListQuery,
) {
	await ensureSpaceAccess(user.id, spaceId, "reader");

	const { skip, take } = getPagination(query);
	const { orderBy } = getSorting(query.sort, query.order, {
		defaultField: DEFAULT_OBJECT_TYPE_SORT_FIELD,
		defaultOrder: DEFAULT_OBJECT_TYPE_SORT_ORDER,
	});
	const where: Prisma.ObjectTypeWhereInput = query.search
		? {
				OR: [
					{ name: { contains: query.search, mode: "insensitive" } },
					{ uniqueKey: { contains: query.search, mode: "insensitive" } },
				],
			}
		: {};

	const [types, total] = await Promise.all([
		objectTypeRepository.findMany(spaceId, where, { skip, take, orderBy }),
		objectTypeRepository.count(spaceId, where),
	]);

	return {
		data: types.map((type) =>
			toObjectType(
				type,
				type.relations.map((relation) => relation.uniqueKey),
			),
		),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function create(
	user: Pick<AuthUser, "id">,
	spaceId: string,
	input: CreateObjectTypeInput,
) {
	await ensureSpaceAccess(user.id, spaceId, "writer");

	const existing = await objectTypeRepository.findByUniqueKey(
		spaceId,
		input.uniqueKey,
	);

	if (existing) {
		throw new ConflictError(
			`Type ${input.uniqueKey} already exists in this space.`,
		);
	}

	const created = await objectTypeRepository.create({
		spaceId,
		uniqueKey: input.uniqueKey,
		name: input.name,
		description: input.description ?? null,
		iconEmoji: input.iconEmoji ?? null,
		layout: "basic",
	});

	const relationKeys = input.relationKeys ?? [];

	await relationService.attachKeys(spaceId, created.id, relationKeys);

	await objectTypeRepository.upsertMirror({
		id: created.id,
		spaceId,
		creatorId: user.id,
		name: created.name,
		description: created.description,
		iconEmoji: created.iconEmoji,
		details: {
			uniqueKey: created.uniqueKey,
			recommendedRelationKeys: relationKeys,
		},
	});

	return toObjectType(created, relationKeys);
}

export const objectTypeService = {
	findMany,
	create,
};
