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

export const objectRepository = {
	findRelations,
	findTypeInSpace,
	findById,
	create,
	update,
	findMany,
	count,
};
