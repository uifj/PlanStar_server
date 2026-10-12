import { useQuery } from "@tanstack/react-query";
import { hostQueryKeys } from "../queryKeys";
import { getDashboard } from "../services/statsService";

interface UseDashboardOptions {
	days?: number;
}

export function useDashboard({ days = 30 }: UseDashboardOptions = {}) {
	const { isPending, error, data, refetch } = useQuery({
		queryKey: hostQueryKeys.dashboard.detail(days),
		queryFn: () => getDashboard(days),
	});

	return { loading: isPending, error, dashboard: data, refetch };
}
