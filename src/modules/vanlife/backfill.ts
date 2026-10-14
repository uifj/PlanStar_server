import type { Booking, Review, Van } from "../../generated/prisma/client.js";

function isoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}

export function vanObject(van: Van) {
	return {
		id: van.id,
		name: van.name,
		description: van.description,
		creatorId: van.hostId,
		isArchived: van.archivedAt !== null,
		createdAt: van.createdAt,
		details: {
			location: van.location,
			imageUrl: van.imageUrl,
			type: [van.type],
			price: van.price,
			sleeps: van.sleeps,
			rating: van.rating,
			amenities: van.amenities,
		},
	};
}

// Object-valued relations live in the Link table, never in `details` (ADR-0002),
// so a booking's van is an edge the caller adds separately.
export function bookingObject(booking: Booking) {
	return {
		id: booking.id,
		name: `Booking ${isoDay(booking.startDate)}`,
		description: null,
		creatorId: booking.userId,
		isArchived: false,
		createdAt: booking.createdAt,
		details: {
			startDate: booking.startDate.toISOString(),
			endDate: booking.endDate.toISOString(),
			guests: booking.guests,
			totalPrice: booking.totalPrice,
			status: [booking.status],
		},
	};
}

export function reviewObject(review: Review) {
	return {
		id: review.id,
		name: `${review.rating} star review`,
		description: null,
		creatorId: review.userId,
		isArchived: false,
		createdAt: review.createdAt,
		details: {
			reviewRating: review.rating,
			reviewText: review.text,
		},
	};
}
