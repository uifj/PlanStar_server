import { describe, expect, it } from "vitest";
import {
	isHttpsUrl,
	resolveCookieAttributes,
} from "../../../src/lib/cookie-attributes.js";

/**
 * Attribute pair per deployment shape. The desktop shell is a cross-site client
 * (`http://localhost:8321` → `https://api.<domain>`), so `Lax` silently breaks it; `None` without
 * `Secure` is dropped by every browser. This is the one place that can get it wrong.
 *
 * @see docs/adr/0026-cloud-cookie-policy.md
 */
describe("resolveCookieAttributes", () => {
	it("uses SameSite=None; Secure for an https deployment", () => {
		expect(resolveCookieAttributes("https://api.harness.example")).toEqual({
			httpOnly: true,
			path: "/",
			secure: true,
			sameSite: "none",
		});
	});

	it("stays on SameSite=Lax for plain http", () => {
		expect(resolveCookieAttributes("http://api.harness.example")).toEqual({
			httpOnly: true,
			path: "/",
			secure: false,
			sameSite: "lax",
		});
	});

	it("treats loopback urls as non-https, whatever the port", () => {
		expect(resolveCookieAttributes("http://localhost:8321").sameSite).toBe(
			"lax",
		);
		expect(resolveCookieAttributes("http://127.0.0.1:8000").secure).toBe(false);
	});

	it("ignores path, query and port when reading the scheme", () => {
		expect(
			resolveCookieAttributes("https://harness.example:8443/api").sameSite,
		).toBe("none");
		expect(
			resolveCookieAttributes("http://harness.example:8080/?x=1").sameSite,
		).toBe("lax");
	});

	it("falls back to the safe policy for an unparseable value", () => {
		expect(resolveCookieAttributes("")).toEqual({
			httpOnly: true,
			path: "/",
			secure: false,
			sameSite: "lax",
		});
	});

	it("never returns a None cookie without Secure", () => {
		for (const url of [
			"https://a.test",
			"http://a.test",
			"localhost",
			"",
			"https://",
		]) {
			const attributes = resolveCookieAttributes(url);
			if (attributes.sameSite === "none") {
				expect(attributes.secure).toBe(true);
			}
			expect(attributes.httpOnly).toBe(true);
		}
	});
});

describe("isHttpsUrl", () => {
	it("only accepts the https scheme", () => {
		expect(isHttpsUrl("https://a.test")).toBe(true);
		expect(isHttpsUrl("http://a.test")).toBe(false);
		expect(isHttpsUrl("ws://a.test")).toBe(false);
		expect(isHttpsUrl("not a url")).toBe(false);
	});
});
