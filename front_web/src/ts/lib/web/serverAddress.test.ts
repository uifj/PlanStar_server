import { describe, expect, it, vi } from "vitest";

import { serverAddress } from "./serverAddress";

describe("serverAddress", () => {
	it("uses the configured API base, without its trailing slash", () => {
		vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000/api/");

		expect(serverAddress()).toBe("http://localhost:8000/api");

		vi.unstubAllEnvs();
	});

	it("falls back to a same-origin API base, never the retired proxy port", () => {
		vi.stubEnv("VITE_API_BASE_URL", "");

		const value = serverAddress();

		expect(value).not.toContain("31008");
		expect(value).toMatch(/^https?:\/\/.+/);

		vi.unstubAllEnvs();
	});
});
