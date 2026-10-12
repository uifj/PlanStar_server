import type { Booking, Review, Van } from "../../generated/prisma/client.js";

type BookingWithVan = Booking & {
	van: Pick<Van, "id" | "name" | "imageUrl" | "type" | "location">;
	review: Pick<Review, "id" | "rating" | "text" | "createdAt"> | null;
};

function toDateString(date: Date) {
	return date.toISOString().slice(0, 10);
}

export function toBooking(booking: Booking) {
	return {
		id: booking.id,
		startDate: toDateString(booking.startDate),
		endDate: toDateString(booking.endDate),
		guests: booking.guests,
		totalPrice: booking.totalPrice,
		status: booking.status,
		createdAt: booking.createdAt.toISOString(),
	};
}

export function toBookingListItem(booking: BookingWithVan) {
	return {
		id: booking.id,
		startDate: toDateString(booking.startDate),
		endDate: toDateString(booking.endDate),
		guests: booking.guests,
		totalPrice: booking.totalPrice,
		status: booking.status,
		createdAt: booking.createdAt.toISOString(),
		review: booking.review
			? {
					id: booking.review.id,
					rating: booking.review.rating,
					text: booking.review.text,
					createdAt: booking.review.createdAt.toISOString(),
				}
			: null,
		van: {
			id: booking.van.id,
			name: booking.van.name,
			imageUrl: booking.van.imageUrl,
			type: booking.van.type,
			location: booking.van.location,
		},
	};
}
