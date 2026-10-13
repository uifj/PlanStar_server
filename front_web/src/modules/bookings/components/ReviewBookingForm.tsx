import { cn } from "tailwind-variants";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/shared/i18n";
import { useReviewBookingForm } from "../hooks/useReviewBookingForm";
import { RatingButton } from "./RatingButton";

interface ReviewBookingFormProps {
	bookingId: string;
}

const ratingOptions = [1, 2, 3, 4, 5];

export function ReviewBookingForm({ bookingId }: ReviewBookingFormProps) {
	const reviewForm = useReviewBookingForm(bookingId);
	const { t } = useTranslation();

	return (
		<form className="grid gap-3" onSubmit={reviewForm.handleSubmit}>
			<fieldset className="grid gap-2 sm:max-w-40">
				<legend className="font-semibold text-foreground text-sm">
					{t("bookings.ratingLabel")}
				</legend>
				<div className="flex items-center gap-1">
					{ratingOptions.map((option) => (
						<RatingButton
							key={option}
							option={option}
							rating={reviewForm.rating}
							disabled={reviewForm.success}
							onChange={reviewForm.handleRatingChange}
						/>
					))}
				</div>
			</fieldset>

			<div className="grid gap-2">
				<label
					htmlFor={`review-text-${bookingId}`}
					className="font-semibold text-foreground text-sm"
				>
					{t("bookings.reviewLabel")}
				</label>
				<Textarea
					id={`review-text-${bookingId}`}
					value={reviewForm.text}
					onChange={reviewForm.handleTextChange}
					disabled={reviewForm.success}
					rows={3}
					className="resize-none"
				/>
			</div>

			<div>
				<Button
					type="submit"
					disabled={reviewForm.loading || reviewForm.success}
				>
					{reviewForm.buttonText}
				</Button>

				{reviewForm.statusMessage ? (
					<p
						className={cn(
							"mt-2 font-semibold text-sm",
							reviewForm.success
								? "text-status-completed"
								: "text-status-cancelled",
						)}
					>
						{reviewForm.statusMessage}
					</p>
				) : null}
			</div>
		</form>
	);
}
