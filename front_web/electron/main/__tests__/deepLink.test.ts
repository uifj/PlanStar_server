import { describe, expect, it } from "vitest";

import {
	__test__,
	createDeepLinkSingleInstanceData,
	createPendingRoute,
	extractDeepLinkUrlFromArgs,
	extractDeepLinkUrlFromSingleInstanceData,
	routeFromArgv,
	routeFromUrl,
} from "../deepLink";

const { buildArgCandidates, expandDecodedCandidates, MAX_ARGV_JOIN_WINDOW } =
	__test__;

describe("deepLink", () => {
	describe("routeFromUrl", () => {
		it("routes a plain deep link", () => {
			expect(routeFromUrl("anytype-harness://main/edit/abc?spaceId=x")).toBe(
				"/main/edit/abc?spaceId=x",
			);
		});

		it("routes the root", () => {
			expect(routeFromUrl("anytype-harness://")).toBe("/");
			expect(routeFromUrl("anytype-harness:///")).toBe("/");
		});

		it("routes /auth/*", () => {
			expect(routeFromUrl("anytype-harness://auth/callback?code=1")).toBe(
				"/auth/callback?code=1",
			);
		});

		it("rejects a non-whitelisted host", () => {
			expect(routeFromUrl("anytype-harness://evil/payload")).toBeNull();
		});

		it("rejects a foreign protocol", () => {
			expect(routeFromUrl("http://example.com/main/edit/abc")).toBeNull();
			expect(
				routeFromUrl("https://anytype-harness://main/edit/abc"),
			).toBeNull();
		});

		it("rejects null/undefined/empty", () => {
			expect(routeFromUrl(null)).toBeNull();
			expect(routeFromUrl(undefined)).toBeNull();
			expect(routeFromUrl("")).toBeNull();
		});

		it("tolerates a single-encoded URL passed as a raw string", () => {
			const encoded = encodeURIComponent("anytype-harness://main/edit/abc");
			expect(routeFromUrl(encoded)).toBe("/main/edit/abc");
		});
	});

	describe("extractDeepLinkUrlFromArgs", () => {
		it("finds a direct match", () => {
			const args = [
				"/usr/bin/electron",
				".",
				"anytype-harness://main/edit/abc",
			];
			expect(extractDeepLinkUrlFromArgs(args)).toBe(
				"anytype-harness://main/edit/abc",
			);
		});

		it("finds a single-encoded xdg match", () => {
			const encoded = encodeURIComponent("anytype-harness://main/edit/abc");
			expect(extractDeepLinkUrlFromArgs([encoded])).toBe(
				"anytype-harness://main/edit/abc",
			);
		});

		it("finds a double-encoded match", () => {
			const once = encodeURIComponent("anytype-harness://main/edit/abc");
			const twice = encodeURIComponent(once);
			expect(extractDeepLinkUrlFromArgs([twice])).toBe(
				"anytype-harness://main/edit/abc",
			);
		});

		it("joins split argv entries", () => {
			const args = ["anytype-harness://main/edit/abc", "?spaceId=x"];
			expect(extractDeepLinkUrlFromArgs(args)).toBe(
				"anytype-harness://main/edit/abc?spaceId=x",
			);
		});

		it("returns null when nothing matches", () => {
			expect(extractDeepLinkUrlFromArgs(["--flag", "value"])).toBeNull();
		});

		it("joins up to the window size and prefers the longest routable match", () => {
			// The join window is 5, so the first segment plus 4 trailing `/x` entries are glued.
			// The result is still routable (matches `/main/*`), and longer than the first segment
			// alone, so the implementation returns the joined form.
			const args = [
				"anytype-harness://main/edit/abc",
				...Array(MAX_ARGV_JOIN_WINDOW + 2).fill("/x"),
			];
			const result = extractDeepLinkUrlFromArgs(args);
			expect(result).toBe("anytype-harness://main/edit/abc/x/x/x/x");
			expect(routeFromUrl(result)).toBe("/main/edit/abc/x/x/x/x");
		});
	});

	describe("routeFromArgv", () => {
		it("routes a well-formed argv", () => {
			expect(routeFromArgv([".", "anytype-harness://main/edit/abc"])).toBe(
				"/main/edit/abc",
			);
		});

		it("returns null when argv has no deep link", () => {
			expect(routeFromArgv([".", "--dev"])).toBeNull();
		});
	});

	describe("single-instance additionalData", () => {
		it("round-trips a deep link through additionalData", () => {
			const args = ["anytype-harness://main/edit/abc"];
			const data = createDeepLinkSingleInstanceData(args);
			expect(extractDeepLinkUrlFromSingleInstanceData(data)).toBe(
				"anytype-harness://main/edit/abc",
			);
		});

		it("returns an empty object when no link is present", () => {
			expect(createDeepLinkSingleInstanceData(["--flag"])).toEqual({});
		});

		it("tolerates a malformed additionalData payload", () => {
			expect(extractDeepLinkUrlFromSingleInstanceData(null)).toBeNull();
			expect(extractDeepLinkUrlFromSingleInstanceData({})).toBeNull();
			expect(
				extractDeepLinkUrlFromSingleInstanceData({ deepLinkUrl: 42 }),
			).toBeNull();
		});
	});

	describe("buildArgCandidates", () => {
		it("includes singles and bounded joins", () => {
			const candidates = buildArgCandidates(["a", "b", "c"]);
			expect(candidates).toContain("a");
			expect(candidates).toContain("b");
			expect(candidates).toContain("c");
			expect(candidates).toContain("ab");
			expect(candidates).toContain("abc");
		});

		it("deduplicates", () => {
			const candidates = buildArgCandidates(["a", "a"]);
			expect(candidates.filter((c) => c === "a")).toHaveLength(1);
		});
	});

	describe("expandDecodedCandidates", () => {
		it("stops when decode is a no-op", () => {
			expect(expandDecodedCandidates("plain")).toEqual(["plain"]);
		});

		it("chains decodes", () => {
			const twice = encodeURIComponent(
				encodeURIComponent("anytype-harness://x"),
			);
			const expanded = expandDecodedCandidates(twice);
			expect(expanded).toContain("anytype-harness://x");
		});
	});
});

describe("pending route", () => {
	it("keeps only the most recent navigation intent", () => {
		const pending = createPendingRoute();

		pending.set("/main/space/a");
		pending.set("/main/space/b");

		expect(pending.take()).toBe("/main/space/b");
	});

	it("hands the route over exactly once", () => {
		const pending = createPendingRoute();

		pending.set("/main/space/a");

		expect(pending.take()).toBe("/main/space/a");
		expect(pending.take()).toBeNull();
	});
});
