import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bookingQueryKeys } from "../queryKeys";
import { cancelBooking } from "../services/bookingService";

export function useCancelBooking() {
	const queryClient = useQueryClient();
	const { mutate, isPending, error } = useMutation({
		mutationFn: cancelBooking,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all });
		},
	});

	return {
		cancelBooking: mutate,
		loading: isPending,
		error,
	};
}
