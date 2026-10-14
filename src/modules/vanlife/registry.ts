import type { CreateObjectTypeInput } from "../object-types/schema.js";
import type { CreateRelationInput } from "../relations/schema.js";

// The shape VanLife takes on the kernel. `name` and `description` are absent
// because the object table already stores them as columns, and a retired van is
// `isArchived` for the same reason (ADR-0002).
export const VAN_LIFE_RELATIONS: CreateRelationInput[] = [
	{ uniqueKey: "location", format: "shortText", name: "Location" },
	{ uniqueKey: "imageUrl", format: "shortText", name: "Image" },
	{ uniqueKey: "type", format: "select", name: "Van type", maxCount: 1 },
	{ uniqueKey: "price", format: "number", name: "Price per night" },
	{ uniqueKey: "sleeps", format: "number", name: "Sleeps" },
	{ uniqueKey: "rating", format: "number", name: "Rating" },
	{ uniqueKey: "amenities", format: "multiSelect", name: "Amenities" },
	{ uniqueKey: "startDate", format: "date", name: "Start date" },
	{ uniqueKey: "endDate", format: "date", name: "End date" },
	{ uniqueKey: "guests", format: "number", name: "Guests" },
	{ uniqueKey: "totalPrice", format: "number", name: "Total price" },
	{
		uniqueKey: "status",
		format: "select",
		name: "Booking status",
		maxCount: 1,
	},
	{ uniqueKey: "reviewRating", format: "number", name: "Review rating" },
	{ uniqueKey: "reviewText", format: "longText", name: "Review text" },
	{ uniqueKey: "van", format: "object", name: "Van", maxCount: 1 },
	{ uniqueKey: "booking", format: "object", name: "Booking", maxCount: 1 },
];

export const VAN_LIFE_TYPES: CreateObjectTypeInput[] = [
	{
		uniqueKey: "van",
		name: "Van",
		iconEmoji: "🚐",
		relationKeys: [
			"location",
			"imageUrl",
			"type",
			"price",
			"sleeps",
			"rating",
			"amenities",
		],
	},
	{
		uniqueKey: "booking",
		name: "Booking",
		iconEmoji: "📅",
		relationKeys: [
			"van",
			"startDate",
			"endDate",
			"guests",
			"totalPrice",
			"status",
		],
	},
	{
		uniqueKey: "review",
		name: "Review",
		iconEmoji: "⭐",
		relationKeys: ["van", "booking", "reviewRating", "reviewText"],
	},
];

// The object type ids the shims need, keyed by the legacy model they replace.
export type VanLifeTypeIds = {
	van: string;
	booking: string;
	review: string;
};
