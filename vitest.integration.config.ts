import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/integration/**/*.test.ts"],
		setupFiles: ["./tests/integration/setup.ts"],
		clearMocks: true,
		restoreMocks: true,
		testTimeout: 10_000,
		// One Postgres backs every file, and the VanLife routes list rows globally,
		// so a second worker changes the counts the first one asserts.
		fileParallelism: false,
	},
});
