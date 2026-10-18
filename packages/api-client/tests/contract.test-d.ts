import { createApiClient } from "../dist/index.js";

const client = createApiClient("http://localhost:8000");
const listObjects = client.api.spaces[":spaceId"].objects.$get;

async function readObjects() {
	const response = await listObjects({
		param: { spaceId: "space-1" },
		query: { page: "1", limit: "10", order: "asc" },
	});
	if (response.status === 200) {
		const body = await response.json();
		const total: number = body.meta.total;
		const name: string | undefined = body.data[0]?.name;
		// @ts-expect-error Successful responses do not have an error message.
		body.message;
		return { total, name };
	}
	const body = await response.json();
	const message: string = body.message;
	// @ts-expect-error Error responses do not contain object data.
	body.data;
	return { message };
}

// @ts-expect-error The required space path parameter is missing.
void listObjects({ query: {} });
void listObjects({
	// @ts-expect-error Space identifiers are strings.
	param: { spaceId: 123 },
	query: {},
});
void listObjects({
	param: { spaceId: "space-1" },
	// @ts-expect-error Sort order is an enum, not an arbitrary string.
	query: { order: "sideways" },
});
void listObjects({
	param: { spaceId: "space-1" },
	// @ts-expect-error Pagination is serialized as an HTTP query string.
	query: { page: { value: 1 } },
});

void readObjects;
