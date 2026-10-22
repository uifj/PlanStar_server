import { describe, expect, it } from "vitest";
import { DESKTOP_ORIGIN } from "../desktop";
import { isTrustedNavigation, isTrustedSenderUrl } from "../trustedUrl";

/**
 * The shell used to gate navigation with `url.startsWith(DESKTOP_ORIGIN)`. A URL with userinfo
 * (`http://localhost:8321@evil.com`) starts with the trusted text but resolves to another origin,
 * so the guard was bypassable. These cases pin the origin comparison.
 */
describe("isTrustedNavigation", () => {
	it("accepts the desktop origin, with and without a path", () => {
		expect(isTrustedNavigation(DESKTOP_ORIGIN)).toBe(true);
		expect(isTrustedNavigation(`${DESKTOP_ORIGIN}/main/space`)).toBe(true);
	});

	it("rejects a URL that only looks like the desktop origin", () => {
		expect(isTrustedNavigation("http://localhost:8321@evil.example/")).toBe(
			false,
		);
		expect(isTrustedNavigation(`${DESKTOP_ORIGIN}.evil.example/`)).toBe(false);
		expect(isTrustedNavigation("https://localhost:8321/")).toBe(false);
		expect(isTrustedNavigation("http://127.0.0.1:8321/")).toBe(false);
	});

	it("rejects other schemes except the shell's own waiting page", () => {
		expect(isTrustedNavigation("file:///tmp/index.html")).toBe(false);
		expect(isTrustedNavigation("javascript:alert(1)")).toBe(false);
		expect(isTrustedNavigation("data:text/html,<p>waiting</p>")).toBe(true);
		expect(isTrustedNavigation("data:image/png;base64,AAAA")).toBe(false);
		expect(isTrustedNavigation("not a url")).toBe(false);
	});
});

describe("isTrustedSenderUrl", () => {
	it("accepts only frames on the desktop origin", () => {
		expect(isTrustedSenderUrl(`${DESKTOP_ORIGIN}/main`)).toBe(true);
		expect(isTrustedSenderUrl("http://localhost:8321@evil.example/")).toBe(
			false,
		);
		expect(isTrustedSenderUrl("about:blank")).toBe(false);
	});

	it("rejects a missing frame url", () => {
		expect(isTrustedSenderUrl(undefined)).toBe(false);
		expect(isTrustedSenderUrl(null)).toBe(false);
		expect(isTrustedSenderUrl("")).toBe(false);
	});
});
