import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/integration/**/*.test.ts"],
		setupFiles: ["./tests/setup.ts"],
		clearMocks: true,
		restoreMocks: true,
		// src/config/env.ts validates process.env while being imported, so these
		// have to exist before any module under test is loaded.
		env: {
			NODE_ENV: "test",
			LOG_LEVEL: "error",
			DATABASE_URL:
				"postgresql://postgres:postgres@localhost:5432/vanlife_unit",
			BETTER_AUTH_SECRET: "unit-test-secret-value-that-is-long-enough",
			APP_URL: "http://localhost:8000",
			CLIENT_URL: "http://localhost:3000",
		},
	},
});
