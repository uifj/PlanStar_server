import { PROTOCOL_SCHEME } from "./desktop";
import { logger } from "./logger";

/**
 * Deep link parsing.
 *
 * Two problems ZCode's `desktopDeepLinkUrl.ts` solves that our previous 14-line inline version
 * did not:
 *   1. Linux/xdg and some browser download dialogs hand us a **double URL-encoded** string
 *      (`planstar%253A%252F%252F...`). One round of `decodeURIComponent` is not enough.
 *   2. Some argv parsers split the query off into a neighbouring argument
 *      (`['planstar://main/edit/abc', '?spaceId=x']`). Concatenating a bounded window of
 *      adjacent args recovers the whole URL.
 *
 * The route whitelist (`/main/*`, `/auth/*`, `/`) is preserved: a link that decodes to anything
 * else is dropped rather than forwarded. That whitelist is the only thing standing between a
 * stray `planstar://evil` and the renderer's router.
 */

const DEEP_LINK_RE = new RegExp(
	`\\b${PROTOCOL_SCHEME}:(?:\\/\\/|\\/)?[^\\s"'<>]+`,
	"i",
);

/** How many adjacent argv entries we are willing to glue together looking for a full URL. */
const MAX_ARGV_JOIN_WINDOW = 5;

/** How many rounds of `decodeURIComponent` we try before giving up. */
const MAX_DECODE_ROUNDS = 3;

const DEEP_LINK_ADDITIONAL_DATA_KEY = "deepLinkUrl";

/**
 * Candidate strings from argv: each single argument, plus every concatenation of up to
 * `MAX_ARGV_JOIN_WINDOW` adjacent arguments. Deduplicated in insertion order.
 */
function buildArgCandidates(args: readonly string[]): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();
	const push = (value: string): void => {
		if (!seen.has(value)) {
			seen.add(value);
			candidates.push(value);
		}
	};

	for (const arg of args) {
		push(arg);
	}

	for (let start = 0; start < args.length; start += 1) {
		let joined = "";
		for (
			let end = start;
			end < Math.min(args.length, start + MAX_ARGV_JOIN_WINDOW);
			end += 1
		) {
			joined += args[end] ?? "";
			if (end > start) {
				push(joined);
			}
		}
	}

	return candidates;
}

function tryDecode(value: string): string | null {
	try {
		const decoded = decodeURIComponent(value);
		// A string that decodes to itself is either not encoded or contains no % sequences; stop.
		return decoded === value ? null : decoded;
	} catch {
		return null;
	}
}

function expandDecodedCandidates(value: string): string[] {
	const candidates = [value];
	let current = value;

	for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
		const decoded = tryDecode(current);
		if (!decoded || candidates.includes(decoded)) {
			break;
		}
		candidates.push(decoded);
		current = decoded;
	}

	return candidates;
}

function extractFromCandidate(value: string): string | null {
	// Strip surrounding quotes and unescape HTML-entity ampersands that some browsers introduce
	// when copying a URL from an anchor's href.
	const trimmed = value.trim().replace(/^["']|["']$/g, "");
	const match = trimmed.match(DEEP_LINK_RE);
	if (!match) {
		return null;
	}
	return match[0].replace(/&amp;/gi, "&").replace(/\\([&=?:/])/g, "$1");
}

function isRouteUrl(parsed: URL): boolean {
	if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) {
		return false;
	}
	const route = routeFromParsedUrl(parsed);
	return route !== null;
}

function isCompleteDeepLinkUrl(value: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return false;
	}
	return isRouteUrl(parsed);
}

/**
 * Scan argv for a deep link, trying every candidate + every decode round. Returns the **longest**
 * candidate that produces a routable URL, so a split argv (`['planstar://main/edit/abc',
 * '?spaceId=x']`) recovers the full URL with query string rather than stopping at the first
 * routable fragment. Falls back to the first regex-matching string when nothing is routable.
 */
export function extractDeepLinkUrlFromArgs(
	args: readonly string[],
): string | null {
	let fallbackMatch: string | null = null;
	let bestRoutable: string | null = null;

	for (const arg of buildArgCandidates(args)) {
		for (const candidate of expandDecodedCandidates(arg)) {
			const match = extractFromCandidate(candidate);
			if (!match) {
				continue;
			}
			if (isCompleteDeepLinkUrl(match)) {
				// Prefer the longest routable match so joined argv entries win over fragments.
				if (!bestRoutable || match.length > bestRoutable.length) {
					bestRoutable = match;
				}
				continue;
			}
			fallbackMatch ??= match;
		}
	}

	return bestRoutable ?? fallbackMatch;
}

/**
 * Convert a parsed deep-link URL into an in-app route.
 *
 * Layout mirrors the pre-refactor `main.ts::routeFromUrl`:
 *   `planstar://main/edit/<id>/spaceId/<space>` → `/main/edit/<id>/spaceId/<space>`
 *   `planstar:///main/edit/<id>`                → `/main/edit/<id>`
 *
 * The whitelist is enforced here: a URL that decodes to `/evil/...` returns null.
 */
export function routeFromParsedUrl(parsed: URL): string | null {
	if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) {
		return null;
	}

	const host = parsed.host ? `/${parsed.host}` : "";
	const rawRoute = `${host}${parsed.pathname}${parsed.search}`;
	const route = rawRoute.replace(/\/$/, "") || "/";

	if (
		route === "/" ||
		route.startsWith("/main/") ||
		route.startsWith("/auth/")
	) {
		return route;
	}
	return null;
}

/**
 * Public entry: given a raw string (from `open-url` on macOS, or an argv entry), return the
 * in-app route or null.
 */
export function routeFromUrl(raw: string | null | undefined): string | null {
	if (!raw) {
		return null;
	}
	if (!raw.toLowerCase().startsWith(`${PROTOCOL_SCHEME}:`)) {
		// Tolerate being handed the still-encoded form: try one round of decode before giving up.
		const decoded = tryDecode(raw);
		if (!decoded || !decoded.toLowerCase().startsWith(`${PROTOCOL_SCHEME}:`)) {
			return null;
		}
		return routeFromUrl(decoded);
	}
	try {
		const parsed = new URL(raw);
		return routeFromParsedUrl(parsed);
	} catch (error) {
		logger.warn("[deep-link] failed to parse URL:", raw, error);
		return null;
	}
}

/** Same as `routeFromUrl` but scans an argv array for the first usable link. */
export function routeFromArgv(argv: readonly string[]): string | null {
	const url = extractDeepLinkUrlFromArgs(argv);
	return url ? routeFromUrl(url) : null;
}

/**
 * Additional-data helpers for the single-instance lock.
 *
 * `app.requestSingleInstanceLock({ deepLinkUrl })` lets the first instance receive the URL that
 * woke the second one; on macOS this is more reliable than parsing argv, which for a
 * protocol-handler launch often contains only the app path.
 */
export function createDeepLinkSingleInstanceData(
	args: readonly string[],
): Record<string, string> {
	const url = extractDeepLinkUrlFromArgs(args);
	return url ? { [DEEP_LINK_ADDITIONAL_DATA_KEY]: url } : {};
}

export function extractDeepLinkUrlFromSingleInstanceData(
	additionalData: unknown,
): string | null {
	if (!additionalData || typeof additionalData !== "object") {
		return null;
	}
	const value = (additionalData as Record<string, unknown>)[
		DEEP_LINK_ADDITIONAL_DATA_KEY
	];
	if (typeof value !== "string") {
		return null;
	}
	// Run through the same tolerant parser: the value may itself have been re-encoded by the OS.
	return extractDeepLinkUrlFromArgs([value]);
}

/**
 * A one-slot mailbox for a deep-link route that arrived before the renderer could accept it.
 *
 * It is deliberately a single slot, not an unbounded queue: these are navigation intents, so the
 * most recent one wins. An unbounded array also let a stream of links grow memory while the
 * window sat on the "backend is down" waiting page (a `data:` document, where `pushState` throws).
 */
export interface PendingRoute {
	set(route: string): void;
	take(): string | null;
}

export function createPendingRoute(): PendingRoute {
	let route: string | null = null;

	return {
		set(next) {
			route = next;
		},
		take() {
			const next = route;
			route = null;
			return next;
		},
	};
}

export const __test__ = {
	buildArgCandidates,
	expandDecodedCandidates,
	extractFromCandidate,
	isCompleteDeepLinkUrl,
	MAX_ARGV_JOIN_WINDOW,
	MAX_DECODE_ROUNDS,
};
