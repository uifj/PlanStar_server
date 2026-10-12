import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/integration/**/*.test.ts"],
		setupFiles: ["./tests/integration/setup.ts"],
		clearMocks: true,
		restoreMocks: true,
		testTimeout: 10_000,
	},
});
