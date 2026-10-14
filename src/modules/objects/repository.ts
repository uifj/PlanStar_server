import type {
	Obj,
	Prisma,
	RelationFormat,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CompiledObjectFilters } from "./filters.js";

export interface ObjectScope {
	spaceId: string;
	layouts: string[];
	compiled: CompiledObjectFilters;
}

const SELECT_COLUMNS = [
	'o."id"',
	'o."spaceId"',
	'o."typeId"',
	'o."layout"',
	'o."resolvedLayout"',
	'o."name"',
	'o."description"',
	'o."snippet"',
	'o."iconEmoji"',
	'o."details"',
	'o."isArchived"',
	'o."isDeleted"',
	'o."isHidden"',
	'o."isFavorite"',
	'o."done"',
	'o."creatorId"',
	'o."createdAt"',
	'o."updatedAt"',
].join(", ");

function buildWhere(scope: ObjectScope) {
	const params = [...scope.compiled.params];
	const fragments: string[] = [];

	if (scope.compiled.where) {
		fragments.push(`(${scope.compiled.where})`);
	}

	params.push(scope.spaceId);
	fragments.push(`o."spaceId" = $${params.length}`);

	if (scope.layouts.length === 1) {
		params.push(scope.layouts[0]);
		fragments.push(`o."resolvedLayout" = $${params.length}`);
	} else if (scope.layouts.length > 1) {
		const placeholders = scope.layouts.map((layout) => {
			params.push(layout);

			return `$${params.length}`;
		});

		fragments.push(`o."resolvedLayout" IN (${placeholders.join(", ")})`);
	}

	fragments.push(`o."isDeleted" = false`);

	return { sql: fragments.join(" AND "), params };
}

async function findRelations(spaceId: string) {
	return prisma.relation.findMany({
		where: { spaceId },
		select: { uniqueKey: true, format: true, maxCount: true },
	});
}

async function findTypeInSpace(spaceId: string, typeId: string) {
	return prisma.objectType.findFirst({
		where: { id: typeId, spaceId },
		select: { id: true, layout: true },
	});
}

async function findById(objectId: string) {
	return prisma.obj.findUnique({ where: { id: objectId } });
}

async function create(data: Prisma.ObjUncheckedCreateInput) {
	return prisma.obj.create({ data });
}

async function update(id: string, data: Prisma.ObjUpdateInput) {
	return prisma.obj.update({ where: { id }, data });
}

async function findMany(
	scope: ObjectScope,
	options: { limit: number; offset: number },
) {
	const where = buildWhere(scope);

	where.params.push(options.limit);
	const limitIndex = where.params.length;
	where.params.push(options.offset);
	const offsetIndex = where.params.length;

	return prisma.$queryRawUnsafe<Obj[]>(
		`SELECT ${SELECT_COLUMNS} FROM "Obj" o ` +
			`WHERE ${where.sql} ` +
			`ORDER BY ${[scope.compiled.orderBy, 'o."id"'].filter(Boolean).join(", ")} ` +
			`LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
		...where.params,
	);
}

async function count(scope: ObjectScope) {
	const where = buildWhere(scope);

	const rows = await prisma.$queryRawUnsafe<{ total: number }[]>(
		`SELECT COUNT(*)::int AS total FROM "Obj" o WHERE ${where.sql}`,
		...where.params,
	);

	return rows[0].total;
}

export type RegisteredRelation = {
	uniqueKey: string;
	format: RelationFormat;
	maxCount: number | null;
};

async function findLinksByFromIds(fromIds: string[]) {
	if (fromIds.length === 0) {
		return [];
	}

	return prisma.link.findMany({
		where: { fromId: { in: fromIds } },
		orderBy: [{ relationKey: "asc" }, { sortOrder: "asc" }],
	});
}

// ADR-0002: object-valued relations are edges, so Link is their only store.
async function writeLinks(input: {
	spaceId: string;
	fromId: string;
	links: Record<string, string[]>;
}) {
	const relationKeys = Object.keys(input.links);

	if (relationKeys.length === 0) {
		return;
	}

	const rows = relationKeys.flatMap((relationKey) =>
		input.links[relationKey].map((toId, index) => ({
			spaceId: input.spaceId,
			fromId: input.fromId,
			relationKey,
			toId,
			sortOrder: String(index + 1).padStart(4, "0"),
		})),
	);

	await prisma.$transaction([
		prisma.link.deleteMany({
			where: { fromId: input.fromId, relationKey: { in: relationKeys } },
		}),
		prisma.link.createMany({ data: rows }),
	]);
}

// ADR-0002: the (toId, relationKey) index serves this reverse lookup.
async function findBacklinkSourceIds(spaceId: string, toId: string) {
	const links = await prisma.link.findMany({
		where: { spaceId, toId },
		select: { fromId: true },
		orderBy: { sortOrder: "asc" },
	});

	return [...new Set(links.map((link) => link.fromId))];
}

async function findManyByIds(ids: string[]) {
	if (ids.length === 0) {
		return [];
	}

	return prisma.obj.findMany({ where: { id: { in: ids }, isDeleted: false } });
}

async function findIdsInSpace(spaceId: string, ids: string[]) {
	const rows = await prisma.obj.findMany({
		where: { spaceId, id: { in: ids } },
		select: { id: true },
	});

	return new Set(rows.map((row) => row.id));
}

export const objectRepository = {
	findRelations,
	findTypeInSpace,
	findById,
	create,
	update,
	findMany,
	count,
	findLinksByFromIds,
	writeLinks,
	findBacklinkSourceIds,
	findManyByIds,
	findIdsInSpace,
};
