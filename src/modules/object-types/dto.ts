import type { ObjectType } from "../../generated/prisma/client.js";

export function toObjectType(
	objectType: ObjectType,
	relationKeys: readonly string[],
) {
	return {
		id: objectType.id,
		spaceId: objectType.spaceId,
		uniqueKey: objectType.uniqueKey,
		name: objectType.name,
		description: objectType.description,
		iconEmoji: objectType.iconEmoji,
		layout: objectType.layout,
		relationKeys: [...relationKeys],
		createdAt: objectType.createdAt.toISOString(),
		updatedAt: objectType.updatedAt.toISOString(),
	};
}
