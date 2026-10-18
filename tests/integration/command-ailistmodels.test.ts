import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signInAs } from "./helpers/auth-session.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

// I.AiListModelsErrorCode (front_web interface/common.ts:151): the settings screen turns a nonzero
// code straight into its "cannot reach this provider" state, and a success is the config's validation —
// `U.AiProvider.resolveListConfig` hands us {provider, endpoint, token} and response.ts:660 reads
// `models: [{id, ownedBy}]` (mapper.ts keeps ownedBy for the dropdown's grouping).
const AI_OK = 0;
const AI_UNKNOWN = 1;
const AI_BAD_INPUT = 2;
const AI_NOT_REACHABLE = 101;
const AI_AUTH_REQUIRED = 103;

describe("POST /api/command/AIListModels", () => {
	const userId = "ailistmodels.owner";

	let server: Server;
	let baseUrl = "";
	// What the fake provider answers, per test.
	let status = 200;
	let body: unknown = { data: [{ id: "gpt-4o", ownedBy: "x" }] };
	let authHeader = "";

	const list = async (config: unknown) => {
		signInAs(userId);
		return (await post("/api/command/AIListModels", { config })).json();
	};

	beforeAll(async () => {
		server = createServer((req, res) => {
			authHeader = String(req.headers.authorization ?? "");
			res.writeHead(status, { "content-type": "application/json" });
			res.end(typeof body === "string" ? body : JSON.stringify(body));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("lists the models an OpenAI-compatible endpoint answers", async () => {
		status = 200;
		body = {
			data: [
				{ id: "llama3", owned_by: "ollama" },
				{ id: "deepseek-chat", owned_by: "deepseek" },
			],
		};

		const result = await list({
			provider: "custom",
			endpoint: baseUrl,
			token: "probe-token",
		});

		expect(result.error.code).toBe(AI_OK);
		expect(result.models).toEqual([
			{ id: "llama3", ownedBy: "ollama" },
			{ id: "deepseek-chat", ownedBy: "deepseek" },
		]);
		// A token is forwarded as the bearer credential the provider validates.
		expect(authHeader).toBe("Bearer probe-token");
	});

	it("tolerates an endpoint given with a trailing path or slash", async () => {
		status = 200;
		body = { data: [{ id: "only-one", owned_by: "us" }] };

		const result = await list({
			provider: "custom",
			endpoint: `${baseUrl}/v1/`,
			token: "",
		});

		expect(result.error.code).toBe(AI_OK);
		expect(result.models.map((it: any) => it.id)).toEqual(["only-one"]);
	});

	it("answers AuthRequired when the provider rejects the token", async () => {
		status = 401;
		body = { error: { message: "bad key" } };

		const result = await list({
			provider: "custom",
			endpoint: baseUrl,
			token: "x",
		});

		expect(result.error.code).toBe(AI_AUTH_REQUIRED);
		expect(result.models).toEqual([]);
	});

	it("answers NotReachable when nothing is listening", async () => {
		// Port 1 on 127.0.0.1 refuses the connection.
		const result = await list({
			provider: "custom",
			endpoint: "http://127.0.0.1:1",
			token: "",
		});

		expect(result.error.code).toBe(AI_NOT_REACHABLE);
	});

	it("refuses an endpoint that is not a public or loopback http(s) host", async () => {
		// A local provider (Ollama, LM Studio) is the reason loopback is allowed; the rest of the
		// private space is not, and the metadata range never is.
		for (const endpoint of [
			"http://10.0.0.1:11434",
			"http://192.168.1.5:8080",
			"http://169.254.169.254",
			"file:///etc/passwd",
		]) {
			const result = await list({ provider: "custom", endpoint, token: "" });
			expect(result.error.code).toBe(AI_BAD_INPUT);
		}
	});

	it("answers BadInput for an endpoint that is not a URL at all", async () => {
		const result = await list({ provider: "custom", endpoint: "not a url" });

		expect(result.error.code).toBe(AI_BAD_INPUT);
	});

	it("answers Unknown when the endpoint answers something that is not a model list", async () => {
		status = 200;
		body = "<html><body>not json</body></html>";

		const result = await list({
			provider: "custom",
			endpoint: baseUrl,
			token: "",
		});

		expect(result.error.code).toBe(AI_UNKNOWN);
		expect(result.models).toEqual([]);
	});
});
