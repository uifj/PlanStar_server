import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hostQueryKeys } from "../queryKeys";
import { getReviews } from "../services/statsService";

interface UseReviewsOptions {
	days?: number;
}

export function useReviews({ days = 30 }: UseReviewsOptions = {}) {
	const { isPending, error, data, refetch } = useQuery({
		queryKey: hostQueryKeys.reviews.detail(days),
		queryFn: () => getReviews(days),
		placeholderData: keepPreviousData,
	});

	return { loading: isPending, error, reviews: data, refetch };
}
