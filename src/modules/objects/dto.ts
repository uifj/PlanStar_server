import type { Obj, Prisma } from "../../generated/prisma/client.js";

function detailMap(details: Prisma.JsonValue | null) {
	if (
		details === null ||
		typeof details !== "object" ||
		Array.isArray(details)
	) {
		return {};
	}

	return details as Record<string, unknown>;
}

export function toObject(object: Obj, links: Record<string, string[]> = {}) {
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
		// ADR-0002: object relations read from Link, so the client still sees one
		// array-valued map (ADR-0004).
		details: { ...detailMap(object.details), ...links },
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
