import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const destination = new URL("packages/api-client/dist/", root);
await mkdir(destination, { recursive: true });
await Promise.all(
	["js", "d.ts"].map((extension) =>
		copyFile(
			new URL(`dist/api-client/client.${extension}`, root),
			new URL(`index.${extension}`, destination),
		),
	),
);
