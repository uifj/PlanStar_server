import { VAN_TYPES } from "../vans/constants.js";

// A van stored as relations reads back as the row the old routes always answered.
export interface CatalogVan {
	id: string;
	name: string;
	price: number;
	description: string;
	imageUrl: string;
	type: (typeof VAN_TYPES)[number];
	location: string;
	sleeps: number;
	rating: number;
	amenities: string[];
}

type ObjectWithDetails = {
	id: string;
	name: string;
	description: string | null;
	details: unknown;
};

function text(value: unknown) {
	return typeof value === "string" ? value : "";
}

function count(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function choice(value: unknown): CatalogVan["type"] {
	const first = Array.isArray(value) ? value[0] : value;

	return VAN_TYPES.includes(first as CatalogVan["type"])
		? (first as CatalogVan["type"])
		: "simple";
}

function words(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function vanFromObject(object: ObjectWithDetails): CatalogVan {
	const details = (object.details ?? {}) as Record<string, unknown>;

	return {
		id: object.id,
		name: object.name,
		price: count(details.price),
		description: object.description ?? "",
		imageUrl: text(details.imageUrl),
		type: choice(details.type),
		location: text(details.location),
		sleeps: count(details.sleeps),
		rating: count(details.rating),
		amenities: words(details.amenities),
	};
}
