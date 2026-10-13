import { apiClient } from "@/shared/api/apiClient";
import { apiPaths } from "@/shared/api/endpoints";
import type { TripPlannerMessage, TripPlannerReply } from "../types";

export async function sendTripPlannerMessage(input: TripPlannerMessage) {
	const response = await apiClient.post<TripPlannerReply>(
		apiPaths.agent.tripPlanner,
		input,
	);

	return response.data;
}
