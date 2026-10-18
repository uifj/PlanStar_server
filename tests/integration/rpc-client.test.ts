import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";
import { createApiClient } from "../../src/client.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();
const client = createApiClient("http://localhost", {
	fetch: (input, init) => app.request(new Request(input, init)),
});

describe.skipIf(!databaseAvailable)("typed HTTP object client", () => {
	const userId = "rpc-client.owner";
	let spaceId: string;

	beforeAll(async () => {
		await prisma.user.create({
			data: { id: userId, name: "RPC owner", email: "rpc-client@vanlife.test" },
		});
		signInAs(userId);
		const space = await post("/api/spaces", { name: "RPC space" });
		expect(space.status).toBe(201);
		spaceId = (await space.json()).id;
		const object = await post(`/api/spaces/${spaceId}/objects`, {
			name: "Typed client page",
		});
		expect(object.status).toBe(201);
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	it("reads the stored objects through the grouped API", async () => {
		signInAs(userId);
		const response = await client.api.spaces[":spaceId"].objects.$get({
			param: { spaceId },
			query: { page: "1", limit: "10" },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			data: [{ name: "Typed client page", spaceId }],
			meta: { total: 1, page: 1, limit: 10 },
		});
	});
});
