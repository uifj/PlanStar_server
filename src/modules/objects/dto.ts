import type { Obj } from "../../generated/prisma/client.js";

export function toObject(object: Obj) {
	return {
		id: object.id,
		spaceId: object.spaceId,
		typeId: object.typeId,
		layout: object.layout,
		resolvedLayout: object.resolvedLayout,
		name: object.name,
		description: object.description,
		snippet: object.snippet,
		iconEmoji: object.iconEmoji,
		details: object.details,
		isArchived: object.isArchived,
		isDeleted: object.isDeleted,
		isHidden: object.isHidden,
		isFavorite: object.isFavorite,
		done: object.done,
		creatorId: object.creatorId,
		createdAt: object.createdAt.toISOString(),
		updatedAt: object.updatedAt.toISOString(),
	};
}
