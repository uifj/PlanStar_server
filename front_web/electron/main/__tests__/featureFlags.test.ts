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
			// A packaged build ships with every subsystem live: an app that cannot update, report a
			// crash or upload its logs is not operable, and opting in per deployment meant those paths
			// were never exercised in the field.
			expect(flags.logger).toBe(true);
			expect(flags.menu).toBe(true);
			expect(flags.feedback).toBe(true);
			expect(flags.exportLogs).toBe(true);
			expect(flags.autoUpdate).toBe(true);
			expect(flags.crashReporter).toBe(true);
			expect(flags.forceUpdate).toBe(true);
			expect(flags.logUpload).toBe(true);
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

		it("can switch the application menu off", () => {
			expect(
				resolveFeatureFlags({ HARNESS_DESKTOP_ENABLE_MENU: "0" }).menu,
			).toBe(false);
		});

		it("only exposes flags that something reads", () => {
			// `tray` / `notifications` are capability placeholders, not switchable subsystems: a flag
			// for them would toggle nothing, so neither may reappear here.
			const flags = resolveFeatureFlags({}) as unknown as Record<
				string,
				unknown
			>;
			expect(flags.deepLinkHardening).toBeUndefined();
			expect(flags.tray).toBeUndefined();
			expect(flags.notifications).toBeUndefined();
		});
	});
});
