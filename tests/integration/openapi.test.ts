import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, describe, expect, it } from "vitest";
import {
	API_PREFIX,
	APP_NAME,
	OPEN_API_VERSION,
} from "../../src/config/constants.js";
import { isDevelopment } from "../../src/config/env.js";
import { openApiDocument } from "../../src/openapi/config.js";
import routes from "../../src/routes/index.js";
import { get } from "./helpers/request.js";

type OpenApiDocument = Awaited<ReturnType<Response["json"]>>;

describe.skipIf(!isDevelopment)("OpenAPI routes", () => {
	let document: OpenApiDocument;

	beforeAll(async () => {
		const response = await get(`${API_PREFIX}/openapi.json`);

		expect(response.status).toBe(200);

		document = await response.json();
	});

	it("returns an OpenAPI document", () => {
		expect(document.openapi).toBe(OPEN_API_VERSION);
	});

	it("includes API metadata", () => {
		expect(document.info).toBeDefined();
		expect(document.info.title).toBe(APP_NAME);
	});

	it("includes system routes", () => {
		expect(document.paths).toHaveProperty(`${API_PREFIX}/health`);

		expect(document.paths).toHaveProperty(`${API_PREFIX}/ready`);
	});

	it("includes paths object", () => {
		expect(document.paths).toBeDefined();
		expect(Object.keys(document.paths).length).toBeGreaterThan(0);
	});
});

// Not gated on development: the document is generated from the route tree in any
// environment, so a schema the converter cannot express fails here instead of only
// breaking the live docs page.
describe("OpenAPI document generation", () => {
	it("renders every mounted route", async () => {
		// Arrange
		const probe = new OpenAPIHono().basePath(API_PREFIX);
		probe.route("/", routes);
		probe.doc("/openapi.json", openApiDocument);

		// Act
		const response = await probe.request(`${API_PREFIX}/openapi.json`);

		// Assert
		expect(response.status).toBe(200);

		const document = (await response.json()) as unknown as {
			paths: Record<string, unknown>;
		};

		expect(document.paths).toHaveProperty(
			`${API_PREFIX}/spaces/{spaceId}/dataviews`,
		);
		expect(document.paths).toHaveProperty(`${API_PREFIX}/objects/{objectId}`);
	});
});
