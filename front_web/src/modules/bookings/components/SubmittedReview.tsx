import { FaStar } from "react-icons/fa6";
import { formatBookingDate } from "@/shared/domain/bookings/utils/bookingDates";
import type { BookingReview } from "../types";

interface SubmittedReviewProps {
	review: BookingReview;
}

const starOptions = [1, 2, 3, 4, 5];

export function SubmittedReview({ review }: SubmittedReviewProps) {
	const createdAt = formatBookingDate(review.createdAt);

	return (
		<div className="mt-5 border-line border-t pt-4">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-3">
				<h3 className="font-black text-ink text-lg">Your review</h3>
				<p className="font-semibold text-muted text-sm">{createdAt}</p>
			</div>

			<div
				className="mb-3 flex gap-1 text-clay"
				role="img"
				aria-label={`${review.rating} out of 5 stars`}
			>
				{starOptions.map((option) => (
					<FaStar
						key={option}
						aria-hidden="true"
						className={option <= review.rating ? "text-clay" : "text-line"}
					/>
				))}
			</div>

			<p className="font-medium text-muted leading-7">{review.text}</p>
		</div>
	);
}
