import { describe, expect, it } from "vitest";
import {
	assertPreviewUrlAllowed,
	isBlockedAddress,
	PreviewNotAllowedError,
	parseLinkPreview,
} from "../../../../src/modules/command/link-preview-service.js";

// LinkPreview fetches a caller-supplied url server-side, so the guard is the security
// boundary. These unit tests pin the address classifier and the url validator directly —
// including the production-only blocks (loopback/private) that the integration suite cannot
// exercise because it runs under NODE_ENV=test — and the pure HTML parser.

describe("isBlockedAddress", () => {
	it("always blocks link-local and unspecified addresses (cloud IMDS)", () => {
		for (const production of [false, true]) {
			expect(isBlockedAddress("169.254.169.254", production)).toBe(true);
			expect(isBlockedAddress("169.254.1.1", production)).toBe(true);
			expect(isBlockedAddress("fe80::1", production)).toBe(true);
			expect(isBlockedAddress("::", production)).toBe(true);
		}
	});

	it("blocks loopback, private, CGNAT and multicast only in production", () => {
		const privateOnly = [
			"127.0.0.1",
			"10.0.0.5",
			"192.168.1.1",
			"172.16.0.1",
			"172.31.255.255",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"::1",
			"fc00::1",
			"fd00::1",
			"ff00::1",
		];
		for (const ip of privateOnly) {
			expect(isBlockedAddress(ip, true)).toBe(true);
			expect(isBlockedAddress(ip, false)).toBe(false);
		}
	});

	it("allows public addresses in every environment", () => {
		for (const production of [false, true]) {
			expect(isBlockedAddress("8.8.8.8", production)).toBe(false);
			expect(isBlockedAddress("1.1.1.1", production)).toBe(false);
			expect(isBlockedAddress("172.32.0.1", production)).toBe(false);
			expect(isBlockedAddress("2606:4700:4700::1111", production)).toBe(false);
		}
	});

	it("classifies an IPv4-mapped IPv6 address as its IPv4 form", () => {
		expect(isBlockedAddress("::ffff:169.254.169.254", false)).toBe(true);
		expect(isBlockedAddress("::ffff:127.0.0.1", true)).toBe(true);
		expect(isBlockedAddress("::ffff:127.0.0.1", false)).toBe(false);
	});
});

describe("assertPreviewUrlAllowed", () => {
	it("rejects a non-http(s) scheme", async () => {
		await expect(
			assertPreviewUrlAllowed("file:///etc/passwd", false),
		).rejects.toBeInstanceOf(PreviewNotAllowedError);
		await expect(
			assertPreviewUrlAllowed("ftp://example.com/x", false),
		).rejects.toBeInstanceOf(PreviewNotAllowedError);
	});

	it("rejects a non-absolute url", async () => {
		await expect(
			assertPreviewUrlAllowed("not a url", false),
		).rejects.toBeInstanceOf(PreviewNotAllowedError);
	});

	it("rejects the metadata IP in every environment", async () => {
		await expect(
			assertPreviewUrlAllowed("http://169.254.169.254/latest/", false),
		).rejects.toBeInstanceOf(PreviewNotAllowedError);
	});

	it("allows loopback outside production but blocks it in production", async () => {
		await expect(
			assertPreviewUrlAllowed("http://127.0.0.1:8080/x", false),
		).resolves.toBeInstanceOf(URL);
		await expect(
			assertPreviewUrlAllowed("http://127.0.0.1:8080/x", true),
		).rejects.toBeInstanceOf(PreviewNotAllowedError);
	});
});

describe("parseLinkPreview", () => {
	const pageUrl = "https://example.com/posts/1";

	it("prefers OpenGraph over the plain title and resolves relative urls", () => {
		const html = [
			"<html><head>",
			"<title>Plain &amp; Boring</title>",
			'<meta property="og:title" content="OG &amp; Rich">',
			'<meta property="og:description" content="Desc">',
			'<meta property="og:image" content="/img/cover.png">',
			'<link rel="apple-touch-icon" href="/touch.png">',
			'<link rel="icon" href="/favicon.ico">',
			"</head></html>",
		].join("");

		const preview = parseLinkPreview(html, pageUrl);
		expect(preview.title).toBe("OG & Rich");
		expect(preview.description).toBe("Desc");
		expect(preview.imageUrl).toBe("https://example.com/img/cover.png");
		expect(preview.faviconUrl).toBe("https://example.com/favicon.ico");
		expect(preview.url).toBe(pageUrl);
		expect(preview.type).toBe(0);
	});

	it("falls back to Twitter then the title tag, and decodes entities", () => {
		const html = [
			"<head>",
			'<meta name="twitter:title" content="Tweet &#39;title&#39;">',
			'<meta name="description" content="Meta desc">',
			'<meta name="twitter:image" content="https://cdn.example.com/t.png">',
			"</head>",
		].join("");

		const preview = parseLinkPreview(html, pageUrl);
		expect(preview.title).toBe("Tweet 'title'");
		expect(preview.description).toBe("Meta desc");
		expect(preview.imageUrl).toBe("https://cdn.example.com/t.png");
	});

	it("uses the title tag and an origin favicon when no meta is present", () => {
		const preview = parseLinkPreview(
			"<html><head><title>Just A Title</title></head></html>",
			pageUrl,
		);
		expect(preview.title).toBe("Just A Title");
		expect(preview.description).toBe("");
		expect(preview.imageUrl).toBe("");
		expect(preview.faviconUrl).toBe("https://example.com/favicon.ico");
	});

	it("returns empty fields for an empty document", () => {
		const preview = parseLinkPreview("", pageUrl);
		expect(preview).toEqual({
			type: 0,
			title: "",
			description: "",
			faviconUrl: "https://example.com/favicon.ico",
			imageUrl: "",
			url: pageUrl,
		});
	});
});
