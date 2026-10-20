import { describe, expect, it } from "vitest";

import { __test__, resolveFeatureFlags } from "../featureFlags";

const { readFlag, ENV_KEYS, DEFAULTS } = __test__;

describe("featureFlags", () => {
	describe("readFlag", () => {
		it("returns the default when the env var is absent", () => {
			expect(readFlag("logger", {})).toBe(DEFAULTS.logger);
			expect(readFlag("autoUpdate", {})).toBe(DEFAULTS.autoUpdate);
		});

		it("treats 1/true/yes/on as truthy (case-insensitive)", () => {
			for (const value of ["1", "true", "TRUE", "yes", "On"]) {
				expect(readFlag("autoUpdate", { [ENV_KEYS.autoUpdate]: value })).toBe(
					true,
				);
			}
		});

		it("treats 0/false/no/off/empty as falsy", () => {
			for (const value of ["0", "false", "no", "off", ""]) {
				expect(readFlag("logger", { [ENV_KEYS.logger]: value })).toBe(false);
			}
		});

		it("treats garbage as falsy", () => {
			expect(readFlag("logger", { [ENV_KEYS.logger]: "maybe" })).toBe(false);
		});

		it("trims surrounding whitespace", () => {
			expect(readFlag("logger", { [ENV_KEYS.logger]: "  1  " })).toBe(true);
		});
	});

	describe("resolveFeatureFlags", () => {
		it("returns the documented defaults for an empty env", () => {
			const flags = resolveFeatureFlags({});
			expect(flags.logger).toBe(true);
			expect(flags.menu).toBe(true);
			expect(flags.deepLinkHardening).toBe(true);
			expect(flags.feedback).toBe(true);
			expect(flags.exportLogs).toBe(true);
			expect(flags.tray).toBe(false);
			expect(flags.notifications).toBe(true);
			expect(flags.autoUpdate).toBe(false);
			expect(flags.crashReporter).toBe(false);
			expect(flags.forceUpdate).toBe(false);
		});

		it("is frozen", () => {
			const flags = resolveFeatureFlags({});
			expect(Object.isFrozen(flags)).toBe(true);
		});

		it("honours per-flag overrides", () => {
			const flags = resolveFeatureFlags({
				HARNESS_DESKTOP_ENABLE_AUTO_UPDATE: "1",
				HARNESS_DESKTOP_ENABLE_LOGGER: "0",
			});
			expect(flags.autoUpdate).toBe(true);
			expect(flags.logger).toBe(false);
		});
	});
});
