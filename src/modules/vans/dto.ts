import type { Van } from "../../generated/prisma/client.js";

export function toVanSummary(van: Van) {
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

export function toVan(van: Van) {
	return {
		...toVanSummary(van),
		description: van.description,
		amenities: van.amenities,
	};
}
