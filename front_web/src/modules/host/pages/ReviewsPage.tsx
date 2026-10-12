import { useState } from "react";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { DaysFilter } from "../components/DaysFilter";
import { RatingDistributionRow } from "../components/RatingDistributionRow";
import { ReviewCard } from "../components/ReviewCard";
import { StarRating } from "../components/StarRating";
import { useReviews } from "../hooks/useReviews";

export default function ReviewsPage() {
	const [days, setDays] = useState(30);
	const { reviews, loading, error, refetch } = useReviews({ days });

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	if (!reviews) {
		return null;
	}

	const reviewCountLabel = `${reviews.reviews.length} ${
		reviews.reviews.length === 1 ? "review" : "reviews"
	}`;

	return (
		<section>
			<PageHeader
				eyebrow="Guest reviews"
				title="Reviews from recent trips."
				aside={
					<div className="flex flex-col gap-3 lg:items-end">
						<p className="font-medium text-muted">Last {reviews.days} days</p>
						<DaysFilter value={days} onChange={setDays} />
					</div>
				}
			/>

			<div className="grid gap-6 lg:grid-cols-3">
				<section
					aria-labelledby="overall-rating"
					className="rounded-xl bg-surface p-6 shadow-sm"
				>
					<div className="flex items-center gap-4">
						<h2 id="overall-rating" className="font-black text-5xl text-ink">
							{reviews.overallRating.toFixed(1)}
						</h2>
						<div>
							<StarRating rating={Math.round(reviews.overallRating)} />
							<p className="mt-2 font-medium text-muted text-sm">
								Based on {reviewCountLabel}
							</p>
						</div>
					</div>

					<div className="mt-8 grid gap-4">
						{reviews.ratingDistribution.map((row) => (
							<RatingDistributionRow key={row.rating} row={row} />
						))}
					</div>
				</section>

				<section aria-labelledby="review-list" className="lg:col-span-2">
					<div className="mb-4 flex items-end justify-between gap-4">
						<h2 id="review-list" className="font-black text-2xl text-ink">
							Latest feedback
						</h2>
						<p className="font-medium text-muted text-sm">{reviewCountLabel}</p>
					</div>

					{reviews.reviews.length > 0 ? (
						<div className="grid gap-4">
							{reviews.reviews.map((review) => (
								<ReviewCard key={review.id} review={review} />
							))}
						</div>
					) : (
						<EmptyState
							title="No reviews yet"
							message="Guest feedback will appear here after completed trips are reviewed."
						/>
					)}
				</section>
			</div>
		</section>
	);
}
