import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vanQueryKeys } from "@/shared/domain/vans/queryKeys";
import { hostQueryKeys } from "../queryKeys";
import { createHostVan } from "../services/hostVanService";

export function useCreateHostVan() {
	const queryClient = useQueryClient();
	const { mutate, isPending, error, data, isSuccess } = useMutation({
		mutationFn: createHostVan,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: vanQueryKeys.hostList });
			queryClient.invalidateQueries({ queryKey: hostQueryKeys.dashboard.all });
		},
	});

	return {
		createVan: mutate,
		van: data,
		loading: isPending,
		error,
		success: isSuccess,
	};
}
