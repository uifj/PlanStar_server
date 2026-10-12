import type {
	Booking,
	Review,
	User,
	Van,
} from "../../generated/prisma/client.js";
import { toVan } from "../vans/dto.js";

type HostReview = Review & {
	user: Pick<User, "name">;
	van: Pick<Van, "id" | "name" | "type">;
};

type HostBooking = Booking & {
	user: Pick<User, "id" | "name">;
	van: Pick<Van, "id" | "name" | "imageUrl" | "type">;
};

type IncomeBooking = Booking & {
	van: Pick<Van, "id" | "name" | "type">;
};

function toDateString(date: Date) {
	return date.toISOString().slice(0, 10);
}

function toPeriod(date: Date) {
	return date.toISOString().slice(0, 7);
}

export function toHostVan(van: Van) {
	return toVan(van);
}

export function toDashboard(input: {
	days: number;
	income: number;
	bookingCount: number;
	averageReviewScore: number | null;
	reviewCount: number;
	listedVanCount: number;
}) {
	return {
		days: input.days,
		income: input.income,
		bookingCount: input.bookingCount,
		averageReviewScore: input.averageReviewScore ?? 0,
		reviewCount: input.reviewCount,
		listedVanCount: input.listedVanCount,
	};
}

export function toIncome(input: { days: number; bookings: IncomeBooking[] }) {
	const periodTotals = new Map<
		string,
		{ income: number; bookingCount: number }
	>();

	for (const booking of input.bookings) {
		const period = toPeriod(booking.createdAt);
		const totals = periodTotals.get(period) ?? {
			income: 0,
			bookingCount: 0,
		};

		periodTotals.set(period, {
			income: totals.income + booking.totalPrice,
			bookingCount: totals.bookingCount + 1,
		});
	}

	return {
		days: input.days,
		total: input.bookings.reduce(
			(total, booking) => total + booking.totalPrice,
			0,
		),
		periods: [...periodTotals.entries()]
			.sort(([leftPeriod], [rightPeriod]) =>
				leftPeriod.localeCompare(rightPeriod),
			)
			.map(([period, totals]) => ({
				period,
				income: totals.income,
				bookingCount: totals.bookingCount,
			})),
		transactions: input.bookings.map((booking) => ({
			id: booking.id,
			amount: booking.totalPrice,
			date: toDateString(booking.createdAt),
			van: {
				id: booking.van.id,
				name: booking.van.name,
				type: booking.van.type,
			},
		})),
	};
}

export function toReviews(input: {
	days: number;
	overallRating: number | null;
	ratingCounts: Map<number, number>;
	reviews: HostReview[];
}) {
	const totalReviews = input.reviews.length;

	return {
		days: input.days,
		overallRating: input.overallRating ?? 0,
		ratingDistribution: [5, 4, 3, 2, 1].map((rating) => {
			const count = input.ratingCounts.get(rating) ?? 0;
			const percentage =
				totalReviews === 0 ? 0 : Math.round((count / totalReviews) * 100);

			return {
				rating,
				count,
				percentage,
			};
		}),
		reviews: input.reviews.map((review) => ({
			id: review.id,
			renterName: review.user.name,
			date: toDateString(review.createdAt),
			rating: review.rating,
			text: review.text,
			van: {
				id: review.van.id,
				name: review.van.name,
				type: review.van.type,
			},
		})),
	};
}

export function toHostBooking(booking: HostBooking) {
	return {
		id: booking.id,
		startDate: toDateString(booking.startDate),
		endDate: toDateString(booking.endDate),
		guests: booking.guests,
		totalPrice: booking.totalPrice,
		status: booking.status,
		createdAt: booking.createdAt.toISOString(),
		renter: {
			id: booking.user.id,
			name: booking.user.name,
		},
		van: {
			id: booking.van.id,
			name: booking.van.name,
			imageUrl: booking.van.imageUrl,
			type: booking.van.type,
		},
	};
}
