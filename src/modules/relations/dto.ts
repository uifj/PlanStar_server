import type { Relation } from "../../generated/prisma/client.js";

export function toRelation(relation: Relation) {
	return {
		id: relation.id,
		spaceId: relation.spaceId,
		typeId: relation.typeId,
		uniqueKey: relation.uniqueKey,
		format: relation.format,
		name: relation.name,
		description: relation.description,
		isReadOnly: relation.isReadOnly,
		isHidden: relation.isHidden,
		maxCount: relation.maxCount,
		createdAt: relation.createdAt.toISOString(),
		updatedAt: relation.updatedAt.toISOString(),
	};
}
