import type { Van } from "../../generated/prisma/client.js";

// Both a Van table row and an object read back through the kernel satisfy this.
export type VanColumns = Pick<
	Van,
	| "id"
	| "name"
	| "price"
	| "imageUrl"
	| "type"
	| "location"
	| "sleeps"
	| "rating"
	| "description"
	| "amenities"
>;

export function toVanSummary(van: VanColumns) {
	return {
		id: van.id,
		name: van.name,
		price: van.price,
		imageUrl: van.imageUrl,
		type: van.type,
		location: van.location,
		sleeps: van.sleeps,
		rating: van.rating,
	};
}

export function toVan(van: VanColumns) {
	return {
		...toVanSummary(van),
		description: van.description,
		amenities: van.amenities,
	};
}
