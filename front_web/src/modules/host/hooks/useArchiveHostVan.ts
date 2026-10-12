import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vanQueryKeys } from "@/shared/domain/vans/queryKeys";
import { hostQueryKeys } from "../queryKeys";
import { archiveHostVan } from "../services/hostVanService";

export function useArchiveHostVan() {
	const queryClient = useQueryClient();
	const { mutate, isPending, error, isSuccess } = useMutation({
		mutationFn: archiveHostVan,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: vanQueryKeys.hostList });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.bookings.all });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.dashboard.all });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.income.all });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.reviews.all });
		},
	});

	return {
		archiveVan: mutate,
		loading: isPending,
		error,
		success: isSuccess,
	};
}
