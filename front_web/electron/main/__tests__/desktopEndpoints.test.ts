import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal electron mock: crashReporter.ts imports `app` and the `crashReporter` module at load.
// Only the URL helpers are exercised here, so the stubs never get called — they just keep the
// import from throwing outside an Electron runtime.
vi.mock("electron", () => ({
	app: {
		name: "Anytype Harness",
		getVersion: () => "0.0.0-test",
		getPath: () => "/tmp/desktop-test",
	},
	crashReporter: { start: () => undefined },
}));

import { __test__ as crashTest } from "../crashReporter";
import { __test__ as manifestTest } from "../manifestProvider";

/**
 * B4 endpoint-contract coverage: the shell subsystems that the `crashReporter` / `autoUpdate` /
 * `forceUpdate` flags gate must construct exactly the URLs the harness backend now serves under
 * `/api/desktop` (see src/modules/desktop). A drift here — a renamed path, a missing query param —
 * would silently 404 in the field, so the wiring is asserted end to end rather than assumed.
 */
describe("desktop subsystem endpoint contracts (B4)", () => {
	afterEach(() => {
		delete process.env.HARNESS_API_URL;
	});

	describe("crashReporter → POST /api/desktop/crash-report", () => {
		it("defaults to the loopback harness crash-report intake", () => {
			delete process.env.HARNESS_API_URL;
			expect(crashTest.defaultSubmitURL()).toBe(
				"http://localhost:8000/api/desktop/crash-report",
			);
		});

		it("honours HARNESS_API_URL and strips a trailing slash", () => {
			process.env.HARNESS_API_URL = "https://harness.example.com/";
			expect(crashTest.defaultSubmitURL()).toBe(
				"https://harness.example.com/api/desktop/crash-report",
			);
		});
	});

	describe("manifestProvider → GET /api/desktop/releases/manifest", () => {
		it("builds the manifest URL with the platform/channel query the backend reads", () => {
			expect(
				manifestTest.buildManifestUrl(
					"http://localhost:8000/api/desktop/releases",
					"darwin-arm64",
					"stable",
				),
			).toBe(
				"http://localhost:8000/api/desktop/releases/manifest?platform=darwin-arm64&channel=stable",
			);
		});

		it("resolves the platform header value as `${platform}-${arch}`", () => {
			expect(manifestTest.resolvePlatform("win32-x64")).toBe("win32-x64");
			expect(manifestTest.resolvePlatform()).toBe(
				`${process.platform}-${process.arch}`,
			);
		});

		it("accepts a policy manifest without `path` (version is the only required key)", () => {
			const info = manifestTest.parseManifestYaml(
				"version: 0.58.0\nis_forced: true\n",
			);

			expect(info.version).toBe("0.58.0");
			expect(info.path).toBeUndefined();
			expect(info.is_forced).toBe(true);
		});

		it("rejects a manifest with no `version`", () => {
			expect(() =>
				manifestTest.parseManifestYaml("path: Harness-0.58.0.dmg\n"),
			).toThrow(/missing required `version`/);
		});
	});
});
