import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vanQueryKeys } from "@/shared/domain/vans/queryKeys";
import { hostQueryKeys } from "../queryKeys";
import { updateHostVan } from "../services/hostVanService";

export function useUpdateHostVan() {
	const queryClient = useQueryClient();
	const { mutate, isPending, error, data, isSuccess } = useMutation({
		mutationFn: updateHostVan,
		onSuccess: (van) => {
			queryClient.invalidateQueries({ queryKey: vanQueryKeys.hostList });
			queryClient.invalidateQueries({
				queryKey: vanQueryKeys.hostDetail(van.id),
			});
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.dashboard.all });
		},
	});

	return {
		updateVan: mutate,
		van: data,
		loading: isPending,
		error,
		success: isSuccess,
	};
}
