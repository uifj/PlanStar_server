import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { env } from "../../../src/config/env.js";
import { corsMiddleware } from "../../../src/middleware/cors.js";

const app = new Hono();

app.use("*", corsMiddleware);
app.get("/probe", (c) => c.json({ ok: true }));

function allowOriginFor(origin: string) {
	return app
		.request("/probe", { headers: { origin } })
		.then((response) => response.headers.get("access-control-allow-origin"));
}

describe("CORS middleware", () => {
	it("allows the web client", async () => {
		expect(await allowOriginFor(env.CLIENT_URL)).toBe(env.CLIENT_URL);
	});

	it("allows the native app scheme", async () => {
		expect(await allowOriginFor("myapp://")).toBe("myapp://");
	});

	it("allows the API's own origin", async () => {
		expect(await allowOriginFor(env.APP_URL)).toBe(env.APP_URL);
	});

	it("sends credentials for allowed origins", async () => {
		const response = await app.request("/probe", {
			headers: { origin: "myapp://" },
		});

		expect(response.headers.get("access-control-allow-credentials")).toBe(
			"true",
		);
	});

	it("does not allow an unlisted origin", async () => {
		expect(await allowOriginFor("https://evil.example.test")).toBeNull();
	});
});
