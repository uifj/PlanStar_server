import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

test("the browser bundle contains only the client and Hono runtime", async () => {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		platform: "browser",
		format: "esm",
		metafile: true,
		write: false,
	});
	for (const path of Object.keys(result.metafile.inputs)) {
		assert.ok(
			path.endsWith("dist/index.js") || /\/hono\/dist\//.test(path),
			`Unexpected browser dependency: ${path}`,
		);
	}
	const { createApiClient } = await import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
	);
	let request;
	const client = createApiClient("https://api.example.test", {
		init: { credentials: "include" },
		fetch: async (input, init) => {
			request = new Request(input, init);
			return Response.json({ data: [], meta: { total: 0 } });
		},
	});
	const response = await client.api.spaces[":spaceId"].objects.$get({
		param: { spaceId: "space-1" },
		query: { page: "2", limit: "10" },
	});
	assert.equal(
		request.url,
		"https://api.example.test/api/spaces/space-1/objects?page=2&limit=10",
	);
	assert.equal(request.credentials, "include");
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { data: [], meta: { total: 0 } });
});

test("the declarations have no backend or generated model dependencies", async () => {
	const declaration = await readFile(
		new URL("../dist/index.d.ts", import.meta.url),
		"utf8",
	);
	const importRe = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
	const imports = [...declaration.matchAll(importRe)].map((m) => m[1]);
	assert.ok(imports.length > 0, "expected at least one import in declarations");
	for (const dep of imports) {
		assert.ok(
			dep.startsWith("hono/"),
			`Declaration imports unexpected module: ${dep}`,
		);
	}
});
