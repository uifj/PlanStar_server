import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isProduction as envIsProduction } from "../../config/env.js";

// The shape Mapper.From.PreviewLink reads (mapper.ts:187): the hover card and the chat-form
// unfurl render title/description/imageUrl, and bookmark creation seeds an object from it.
export type LinkPreview = {
	type: number;
	title: string;
	description: string;
	faviconUrl: string;
	imageUrl: string;
	url: string;
};

// Thrown when the caller-supplied url is one we refuse to fetch (bad scheme, or a host the
// SSRF guard blocks). Kept distinct from a fetch/parse failure so the shim can answer
// FORBIDDEN for a refused url and NOT_FOUND for one that simply would not load.
export class PreviewNotAllowedError extends Error {}

const MAX_PREVIEW_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 5_000;

// The bytes of a preview image (a bookmark's og:image or favicon) plus the content-type the
// server declared, so the caller can derive the file object's mime without re-sniffing.
export type PreviewImage = { bytes: Uint8Array; contentType: string };

// Strip an IPv4-mapped IPv6 address (::ffff:127.0.0.1) down to its IPv4 form so the v4
// ranges below catch it.
function normalizeIp(ip: string): string {
	const lower = ip.toLowerCase();
	return lower.startsWith("::ffff:") ? lower.slice(7) : lower;
}

/**
 * Classifies a resolved IP literal. Link-local (169.254.0.0/16, fe80::/10) and the
 * unspecified address are refused in EVERY environment because they reach cloud metadata
 * (IMDS) and are never a legitimate link-preview target. Loopback, RFC1918 private, CGNAT,
 * multicast and reserved ranges are additionally refused only in production, so local dev and
 * the integration suite can still preview a loopback server.
 */
export function isBlockedAddress(ip: string, isProduction: boolean): boolean {
	const v = normalizeIp(ip);
	const version = isIP(v);

	if (version === 4) {
		const [a, b] = v.split(".").map(Number);
		// 169.254.0.0/16 link-local (incl. 169.254.169.254 IMDS) — always blocked.
		if (a === 169 && b === 254) return true;
		if (!isProduction) return false;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}

	if (version === 6) {
		// fe80::/10 link-local and the unspecified :: — always blocked.
		if (v === "::") return true;
		if (/^fe[89ab]/.test(v)) return true;
		if (!isProduction) return false;
		return (
			v === "::1" ||
			v.startsWith("fc") ||
			v.startsWith("fd") ||
			v.startsWith("ff")
		);
	}

	// Not a parseable IP literal: nothing to classify here (the caller handles hostnames).
	return false;
}

/**
 * Validates a caller-supplied url before any fetch. Returns the parsed URL, or throws
 * PreviewNotAllowedError. Only http(s) is allowed. An IP-literal host is classified directly;
 * a domain host is resolved and every returned address classified — but only in production,
 * so dev/test does not depend on DNS. NOTE: this guards the initial host (and, in the fetch,
 * the final post-redirect url); it does not pin DNS at connect time, so a production
 * deployment behind an egress proxy should also block private ranges at the network layer.
 */
export async function assertPreviewUrlAllowed(
	rawUrl: string,
	isProduction: boolean,
): Promise<URL> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new PreviewNotAllowedError("url is not absolute");
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new PreviewNotAllowedError("scheme is not http(s)");
	}

	const host = parsed.hostname.replace(/^\[|\]$/g, "");
	if (isIP(host)) {
		if (isBlockedAddress(host, isProduction)) {
			throw new PreviewNotAllowedError("host is not allowed");
		}
		return parsed;
	}

	if (isProduction) {
		const records = await lookup(host, { all: true, verbatim: true }).catch(
			() => null,
		);
		if (records === null) {
			throw new PreviewNotAllowedError("host does not resolve");
		}
		if (
			records.length === 0 ||
			records.some((r) => isBlockedAddress(r.address, isProduction))
		) {
			throw new PreviewNotAllowedError("host resolves to a blocked address");
		}
	}

	return parsed;
}

function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
			String.fromCodePoint(parseInt(h, 16)),
		)
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;/g, "'")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&");
}

function tagAttr(tag: string, name: string): string {
	const match = tag.match(
		new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
	);
	if (!match) return "";
	return (match[2] ?? match[3] ?? match[4] ?? "").trim();
}

function absoluteUrl(href: string, base: string): string {
	if (!href) return "";
	try {
		return new URL(href, base).href;
	} catch {
		return "";
	}
}

/**
 * Lifts a preview out of an HTML document. OpenGraph wins over Twitter wins over the plain
 * <title>/meta-description; a relative image or favicon resolves against the page url, and the
 * favicon falls back to the origin's /favicon.ico. Pure so it can be unit-tested without a
 * network.
 */
export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
	const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
	const byKey = new Map<string, string>();
	for (const tag of metas) {
		const key = (
			tagAttr(tag, "property") || tagAttr(tag, "name")
		).toLowerCase();
		const content = tagAttr(tag, "content");
		if (key && content && !byKey.has(key)) byKey.set(key, content);
	}
	const pick = (...keys: string[]): string => {
		for (const key of keys) {
			const value = byKey.get(key);
			if (value) return value;
		}
		return "";
	};

	const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	const title =
		pick("og:title", "twitter:title") ||
		(titleMatch ? decodeEntities(titleMatch[1]).trim() : "") ||
		"";
	const description = pick(
		"og:description",
		"twitter:description",
		"description",
	);

	let favicon = "";
	for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
		// rel is a space-separated token list: match the exact "icon" token (also covers
		// "shortcut icon") but not "apple-touch-icon", which is a different rel.
		const relTokens = tagAttr(tag, "rel").toLowerCase().split(/\s+/);
		if (relTokens.includes("icon")) {
			favicon = absoluteUrl(tagAttr(tag, "href"), pageUrl);
			if (favicon) break;
		}
	}
	if (!favicon) {
		try {
			favicon = `${new URL(pageUrl).origin}/favicon.ico`;
		} catch {
			favicon = "";
		}
	}

	return {
		// I.LinkPreviewType is unused by the web client's renderers; 0 is the proto default.
		type: 0,
		title: decodeEntities(title).trim(),
		description: decodeEntities(description).trim(),
		faviconUrl: favicon,
		imageUrl: absoluteUrl(
			pick("og:image", "og:image:secure_url", "twitter:image"),
			pageUrl,
		),
		url: pageUrl,
	};
}

async function readBounded(
	body: ReadableStream<Uint8Array> | null,
	max: number,
): Promise<string> {
	if (!body) return "";
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > max) {
			chunks.push(value.subarray(0, value.byteLength - (total - max)));
			await reader.cancel();
			break;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Fetches a caller-supplied url and returns its link preview, or null when the page would not
 * load or was not HTML. Refuses disallowed urls by throwing PreviewNotAllowedError. The final
 * post-redirect url is re-checked so a public url that bounces to an internal host yields no
 * preview rather than leaking internal content.
 */
export async function fetchLinkPreview(
	rawUrl: string,
	isProduction: boolean = envIsProduction,
): Promise<LinkPreview | null> {
	const pageUrl = await assertPreviewUrlAllowed(rawUrl, isProduction);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(pageUrl.href, {
			signal: controller.signal,
			redirect: "follow",
			headers: {
				Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
				"User-Agent": "agent-harness-link-preview/1.0",
			},
		});

		const finalUrl = response.url || pageUrl.href;
		if (finalUrl !== pageUrl.href) {
			// A redirect landed somewhere else: re-validate before trusting the body.
			await assertPreviewUrlAllowed(finalUrl, isProduction);
		}

		const contentType = response.headers.get("content-type") ?? "";
		if (contentType && !/html|xml/i.test(contentType)) return null;

		const html = await readBounded(response.body, MAX_PREVIEW_BYTES);
		return parseLinkPreview(html, finalUrl);
	} catch (error) {
		if (error instanceof PreviewNotAllowedError) throw error;
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// A binary counterpart to readBounded: collects up to `max` bytes and REFUSES (null) rather than
// truncates past it, because a half-stored image is corrupt where a half-read html document still
// parses. Used for og:image/favicon downloads, which are larger than the html cap.
async function readBoundedBytes(
	body: ReadableStream<Uint8Array> | null,
	max: number,
): Promise<Uint8Array | null> {
	if (!body) return null;
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	if (total === 0) return null;
	return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Fetches a preview image url (a bookmark's og:image or favicon) and returns its bytes, or null
 * when the url is refused, unreachable, oversized, or empty. It runs the SAME SSRF guard as the
 * page fetch — assertPreviewUrlAllowed before connecting, and again on the final post-redirect url
 * — so a public page cannot point a bookmark's cover at link-local/IMDS (blocked in every env) or,
 * in production, a private range. A refused or failed image never throws: the bookmark is still
 * created, just without a picture, so the guard's outcome is "no image", not "no bookmark".
 */
export async function fetchPreviewImage(
	rawUrl: string,
	isProduction: boolean = envIsProduction,
): Promise<PreviewImage | null> {
	let parsed: URL;
	try {
		parsed = await assertPreviewUrlAllowed(rawUrl, isProduction);
	} catch {
		return null;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(parsed.href, {
			signal: controller.signal,
			redirect: "follow",
			headers: { "User-Agent": "agent-harness-link-preview/1.0" },
		});

		const finalUrl = response.url || parsed.href;
		if (finalUrl !== parsed.href) {
			// A redirect landed elsewhere: re-validate before trusting the bytes. Throws
			// PreviewNotAllowedError, caught below, so a bounce to an internal host yields no image.
			await assertPreviewUrlAllowed(finalUrl, isProduction);
		}

		if (!response.ok) return null;

		const contentType = response.headers.get("content-type") ?? "";
		const bytes = await readBoundedBytes(response.body, MAX_IMAGE_BYTES);
		if (bytes === null) return null;

		return { bytes, contentType };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
