import { cn } from "tailwind-variants";
import { useReviewBookingForm } from "../hooks/useReviewBookingForm";
import { RatingButton } from "./RatingButton";

interface ReviewBookingFormProps {
	bookingId: string;
}

const ratingOptions = [1, 2, 3, 4, 5];

export function ReviewBookingForm({ bookingId }: ReviewBookingFormProps) {
	const reviewForm = useReviewBookingForm(bookingId);

	return (
		<form className="grid gap-3" onSubmit={reviewForm.handleSubmit}>
			<fieldset className="grid gap-2 sm:max-w-40">
				<legend className="font-semibold text-ink text-sm">Rating</legend>
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
					className="font-semibold text-ink text-sm"
				>
					Review
				</label>
				<textarea
					id={`review-text-${bookingId}`}
					value={reviewForm.text}
					onChange={reviewForm.handleTextChange}
					disabled={reviewForm.success}
					rows={3}
					className="resize-none rounded-lg border border-line bg-surface px-3 py-2 font-medium text-muted outline-none ring-clay transition placeholder:text-soft focus:text-ink focus:ring-2 disabled:text-soft"
				/>
			</div>

			<div>
				<button
					type="submit"
					disabled={reviewForm.loading || reviewForm.success}
					className="rounded-lg bg-clay px-4 py-2 font-bold text-sm text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-line disabled:text-muted"
				>
					{reviewForm.buttonText}
				</button>

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
