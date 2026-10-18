import { API_PREFIX } from "../config/constants.js";

// The REST surface the command shim took over (ADR-0020): the bundled client reaches none of it, yet
// it stays mounted because it is the harness's own published API and is covered by its own tests
// (ADR-0021). `deprecated` is the only per-operation signal a docs reader or a generated client
// honours, so the document carries it rather than a prose note.
//
// A trailing slash is part of a prefix on purpose: `${API_PREFIX}/spaces/` marks the object-core
// sub-paths while leaving GET/POST /api/spaces, which the client's auth bootstrap does call.
const SUPERSEDED_PREFIXES = [
	`${API_PREFIX}/me`,
	`${API_PREFIX}/vans`,
	`${API_PREFIX}/bookings`,
	`${API_PREFIX}/reviews`,
	`${API_PREFIX}/host`,
	`${API_PREFIX}/objects`,
	`${API_PREFIX}/blocks`,
	`${API_PREFIX}/spaces/`,
];

export function isSupersededPath(path: string): boolean {
	return SUPERSEDED_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(prefix),
	);
}

type Operation = Record<string, unknown>;

// Typed loosely on purpose: the generator's own `PathItemObject` has no index signature, so a
// structural constraint on it would reject the document the caller just built.
export function markSupersededOperations<
	D extends { paths?: Record<string, unknown> },
>(doc: D): D {
	const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;

	const marked: Record<string, unknown> = {};
	for (const [path, methods] of Object.entries(paths)) {
		if (!isSupersededPath(path) || typeof methods !== "object" || !methods) {
			marked[path] = methods;
			continue;
		}

		marked[path] = Object.fromEntries(
			Object.entries(methods).map(([verb, operation]) => [
				verb,
				typeof operation === "object" && operation !== null
					? { ...(operation as Operation), deprecated: true }
					: operation,
			]),
		);
	}

	return { ...doc, paths: marked } as D;
}
