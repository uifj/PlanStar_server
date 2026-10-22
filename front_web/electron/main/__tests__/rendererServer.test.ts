import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRendererServer } from "../../server";

/**
 * The loopback server is the only thing between a renderer bug and a crashed main process: a
 * malformed escape used to throw out of the request handler. These cases pin the recovery path and
 * the path-containment check.
 */
const INDEX = "<!doctype html><title>shell</title>";
let server: http.Server;
let port = 0;

const request = (
	path: string,
): Promise<{
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}> =>
	new Promise((resolve, reject) => {
		const req = http.request(
			{ host: "127.0.0.1", port, method: "GET", path },
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});

beforeAll(async () => {
	const root = mkdtempSync(join(tmpdir(), "harness-renderer-"));
	writeFileSync(join(root, "index.html"), INDEX);
	mkdirSync(join(root, "js"), { recursive: true });
	writeFileSync(join(root, "js", "main.js"), "console.log(1);");

	server = createRendererServer(root);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("renderer server", () => {
	it("answers a malformed percent-escape with 400 instead of throwing", async () => {
		const res = await request("/%E0%A4%A");

		expect(res.status).toBe(400);
	});

	it("refuses a path that escapes the renderer root", async () => {
		const res = await request("/../../package.json");

		expect([403, 404]).toContain(res.status);
		expect(res.body).not.toContain('"name"');
	});

	it("falls back to index.html for extension-less routes", async () => {
		const res = await request("/main/space");

		expect(res.status).toBe(200);
		expect(res.body).toBe(INDEX);
	});

	it("serves assets with their content type and hardening headers", async () => {
		const res = await request("/js/main.js");

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toContain("text/javascript");
		expect(res.headers["x-frame-options"]).toBe("DENY");
		expect(res.headers["content-security-policy-report-only"]).toContain(
			"connect-src *",
		);
	});

	it("enforces the three directives that cannot break the bundle", async () => {
		const res = await request("/js/main.js");

		// Enforcing header, separate from the Report-Only one: browsers intersect both.
		const enforced = String(res.headers["content-security-policy"] || "");
		expect(enforced).toContain("object-src 'none'");
		expect(enforced).toContain("base-uri 'none'");
		expect(enforced).toContain("frame-ancestors 'none'");
		// `connect-src`/`script-src` must stay advisory until `?server=` is reworked.
		expect(enforced).not.toContain("connect-src");
	});
});
