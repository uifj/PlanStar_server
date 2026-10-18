import { hc } from "hono/client";
import type app from "../../src/app.js";

const client = hc<typeof app>("http://localhost:8000");

async function readObjects() {
	const response = await client.api.spaces[":spaceId"].objects.$get({
		param: { spaceId: "space-1" },
		query: { page: "1", limit: "10" },
	});

	if (response.status !== 200) throw new Error("Request failed");

	const body = await response.json();
	const total: number = body.meta.total;
	const name: string | undefined = body.data[0]?.name;
	return { total, name };
}

void client.api.spaces[":spaceId"].objects.$get({
	param: { spaceId: "space-1" },
	// @ts-expect-error HTTP query parameters cannot contain nested objects.
	query: { page: { unexpected: true } },
});

void readObjects;
