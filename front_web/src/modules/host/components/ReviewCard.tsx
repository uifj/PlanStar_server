import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import type { HostReview } from "../types";
import { formatShortDate } from "../utils/formatStats";
import { StarRating } from "./StarRating";

interface ReviewCardProps {
	review: HostReview;
}

export function ReviewCard({ review }: ReviewCardProps) {
	return (
		<article className="rounded-xl bg-surface p-5 shadow-sm">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="font-bold text-ink">{review.renterName}</h3>
					<p className="mt-1 font-medium text-muted text-sm">
						{formatShortDate(review.date)}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<p className="font-bold text-ink text-sm">{review.van.name}</p>
						<VanTypeBadge
							type={review.van.type}
							className="px-2 py-0.5 text-xs"
						/>
					</div>
				</div>
				<StarRating rating={review.rating} />
			</div>
			<p className="font-medium text-muted leading-7">{review.text}</p>
		</article>
	);
}
