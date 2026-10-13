import { FaStar } from "react-icons/fa6";
import { formatBookingDate } from "@/shared/domain/bookings/utils/bookingDates";
import { LANGUAGE_LOCALES, useTranslation } from "@/shared/i18n";
import type { BookingReview } from "../types";

interface SubmittedReviewProps {
	review: BookingReview;
}

const starOptions = [1, 2, 3, 4, 5];

export function SubmittedReview({ review }: SubmittedReviewProps) {
	const { t, language } = useTranslation();
	const createdAt = formatBookingDate(
		review.createdAt,
		LANGUAGE_LOCALES[language],
	);

	return (
		<div className="mt-5 border-border border-t pt-4">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-3">
				<h3 className="font-black text-foreground text-lg">
					{t("bookings.yourReview")}
				</h3>
				<p className="font-semibold text-muted-foreground text-sm">
					{createdAt}
				</p>
			</div>

			<div
				className="mb-3 flex gap-1 text-primary"
				role="img"
				aria-label={t("bookings.ratingAriaLabel", { rating: review.rating })}
			>
				{starOptions.map((option) => (
					<FaStar
						key={option}
						aria-hidden="true"
						className={option <= review.rating ? "text-primary" : "text-border"}
					/>
				))}
			</div>

			<p className="font-medium text-muted-foreground leading-7">
				{review.text}
			</p>
		</div>
	);
}
