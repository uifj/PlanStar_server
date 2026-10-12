import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bookingQueryKeys } from "../queryKeys";
import { createReview } from "../services/bookingService";

export function useCreateReview() {
	const queryClient = useQueryClient();
	const { mutate, isPending, error, isSuccess } = useMutation({
		mutationFn: createReview,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all });
		},
	});

	return {
		createReview: mutate,
		loading: isPending,
		error,
		success: isSuccess,
	};
}
