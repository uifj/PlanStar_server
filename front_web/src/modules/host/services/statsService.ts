import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type { Dashboard, Income, Reviews } from "../types";

export async function getDashboard(days: number) {
	const response = await apiClient.get<Dashboard>(apiPaths.host.dashboard, {
		params: { days },
	});

	return response.data;
}

export async function getIncome(days: number) {
	const response = await apiClient.get<Income>(apiPaths.host.income, {
		params: { days },
	});

	return response.data;
}

export async function getReviews(days: number) {
	const response = await apiClient.get<Reviews>(apiPaths.host.reviews, {
		params: { days },
	});

	return response.data;
}
