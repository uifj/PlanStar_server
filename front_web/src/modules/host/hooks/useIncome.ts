import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hostQueryKeys } from "../queryKeys";
import { getIncome } from "../services/statsService";

interface UseIncomeOptions {
	days?: number;
}

export function useIncome({ days = 30 }: UseIncomeOptions = {}) {
	const { isPending, error, data, refetch } = useQuery({
		queryKey: hostQueryKeys.income.detail(days),
		queryFn: () => getIncome(days),
		placeholderData: keepPreviousData,
	});

	return { loading: isPending, error, income: data, refetch };
}
