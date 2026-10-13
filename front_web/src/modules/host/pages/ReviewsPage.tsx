import { useState } from "react";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { DaysFilter } from "../components/DaysFilter";
import { RatingDistributionRow } from "../components/RatingDistributionRow";
import { ReviewCard } from "../components/ReviewCard";
import { StarRating } from "../components/StarRating";
import { useReviews } from "../hooks/useReviews";

export default function ReviewsPage() {
	const { t } = useTranslation();
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

	const reviewCount = reviews.reviews.length;
	const reviewCountLabel = t(
		reviewCount === 1
			? "host.reviews.reviewCountOne"
			: "host.reviews.reviewCountMany",
		{ count: reviewCount },
	);

	return (
		<section>
			<PageHeader
				eyebrow={t("host.reviews.eyebrow")}
				title={t("host.reviews.title")}
				aside={
					<div className="flex flex-col gap-3 lg:items-end">
						<p className="font-medium text-muted-foreground">
							{t("host.lastDays", { days: reviews.days })}
						</p>
						<DaysFilter value={days} onChange={setDays} />
					</div>
				}
			/>

			<div className="grid gap-6 lg:grid-cols-3">
				<section
					aria-labelledby="overall-rating"
					className="rounded-xl bg-card p-6 shadow-sm"
				>
					<div className="flex items-center gap-4">
						<h2
							id="overall-rating"
							className="font-black text-5xl text-foreground"
						>
							{reviews.overallRating.toFixed(1)}
						</h2>
						<div>
							<StarRating rating={Math.round(reviews.overallRating)} />
							<p className="mt-2 font-medium text-muted-foreground text-sm">
								{t("host.reviews.basedOn", { count: reviewCountLabel })}
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
						<h2
							id="review-list"
							className="font-black text-2xl text-foreground"
						>
							{t("host.reviews.latest")}
						</h2>
						<p className="font-medium text-muted-foreground text-sm">
							{reviewCountLabel}
						</p>
					</div>

					{reviews.reviews.length > 0 ? (
						<div className="grid gap-4">
							{reviews.reviews.map((review) => (
								<ReviewCard key={review.id} review={review} />
							))}
						</div>
					) : (
						<EmptyState
							title={t("host.reviews.emptyTitle")}
							message={t("host.reviews.emptyMessage")}
						/>
					)}
				</section>
			</div>
		</section>
	);
}
