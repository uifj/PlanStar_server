import axios from "axios";
import { env } from "@/shared/config/env";
import { createApiError } from "./apiError";

export const apiClient = axios.create({
	baseURL: env.apiBaseUrl,
	withCredentials: true,
	headers: {
		"Content-Type": "application/json",
	},
});

apiClient.interceptors.response.use(
	(response) => response,
	(error) => {
		throw createApiError(error);
	},
);
