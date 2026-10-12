import axios from "axios";

class ApiError extends Error {
	status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

export function createApiError(error: unknown) {
	if (axios.isAxiosError<{ message?: string }>(error)) {
		return new ApiError(
			error.response?.data?.message ?? error.message,
			error.response?.status,
		);
	}

	return error;
}
