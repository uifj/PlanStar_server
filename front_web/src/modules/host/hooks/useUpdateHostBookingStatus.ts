import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hostQueryKeys } from "../queryKeys";
import { updateHostBookingStatus } from "../services/hostBookingService";

export function useUpdateHostBookingStatus() {
	const queryClient = useQueryClient();
	const { mutate, isPending, error } = useMutation({
		mutationFn: updateHostBookingStatus,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.bookings.all });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.dashboard.all });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.income.all });
		},
	});

	return {
		updateStatus: mutate,
		loading: isPending,
		error,
	};
}
