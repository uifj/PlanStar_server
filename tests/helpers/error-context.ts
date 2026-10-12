import { vi } from "vitest";

export function createErrorContext() {
	return {
		req: {
			method: "GET",
			path: "/test",
		},
		get: vi.fn((key: string) => {
			if (key === "requestId") {
				return "req-123";
			}
			return undefined;
		}),
		json: vi.fn((body, status) => ({
			body,
			status,
		})),
	};
}
