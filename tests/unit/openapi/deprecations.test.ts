import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { API_PREFIX } from "../../../src/config/constants.js";
import { openApiDocument } from "../../../src/openapi/config.js";
import { markSupersededOperations } from "../../../src/openapi/deprecations.js";
import routes from "../../../src/routes/index.js";

// The pre-pivot REST surface stays mounted (ADR-0021) but the bundled Anytype client reaches none of
// it: every one of those reads and writes goes through POST /api/command/<Name>. The document has to
// say so, because `deprecated` is the only per-operation signal a generated client or a docs reader
// honours. The doc route itself is dev-only, so the transform is asserted against the real route
// table rather than over HTTP.
function document() {
	const app = new OpenAPIHono().basePath(API_PREFIX);
	app.route("/", routes);
	return markSupersededOperations(app.getOpenAPIDocument(openApiDocument));
}

function operations(doc: any, prefix: string) {
	return Object.entries(doc.paths)
		.filter(([path]) => path.startsWith(prefix))
		.flatMap(([, methods]) =>
			Object.entries(methods as object).map(([verb, op]) => ({
				verb,
				op: op as Record<string, unknown>,
			})),
		);
}

describe("markSupersededOperations", () => {
	const doc = document();

	it("marks the REST operations the command shim replaced", () => {
		const prefixes = [
			`${API_PREFIX}/me`,
			`${API_PREFIX}/vans`,
			`${API_PREFIX}/bookings`,
			`${API_PREFIX}/reviews`,
			`${API_PREFIX}/host`,
			`${API_PREFIX}/objects`,
			`${API_PREFIX}/blocks`,
			`${API_PREFIX}/spaces/{spaceId}/`,
		];

		let marked = 0;
		for (const prefix of prefixes) {
			const found = operations(doc, prefix);
			expect(found.length).toBeGreaterThan(0);
			for (const { op } of found) {
				expect(op.deprecated).toBe(true);
				marked += 1;
			}
		}
		expect(marked).toBeGreaterThan(20);
	});

	it("leaves the live client surface unmarked", () => {
		for (const prefix of [
			`${API_PREFIX}/command`,
			`${API_PREFIX}/health`,
			`${API_PREFIX}/ready`,
			`${API_PREFIX}/agent`,
		]) {
			for (const { op } of operations(doc, prefix)) {
				expect(op.deprecated).toBeUndefined();
			}
		}

		// The vault bootstrap calls GET/POST /api/spaces itself, so only its sub-paths are superseded.
		const spaces = operations(doc, `${API_PREFIX}/spaces`);
		const bare = spaces.length
			? Object.entries(doc.paths[`${API_PREFIX}/spaces`] as object).map(
					([, op]) => op as Record<string, unknown>,
				)
			: [];
		expect(bare.length).toBe(2);
		for (const op of bare) {
			expect(op.deprecated).toBeUndefined();
		}
	});

	it("keeps every path it was given", () => {
		const plain = new OpenAPIHono().basePath(API_PREFIX);
		plain.route("/", routes);
		expect(Object.keys(doc.paths).length).toBe(
			Object.keys(plain.getOpenAPIDocument(openApiDocument).paths ?? {}).length,
		);
	});
});
