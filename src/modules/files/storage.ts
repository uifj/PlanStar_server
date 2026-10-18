import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "../../config/env.js";

// The local file store keeps uploaded bytes on disk keyed by the file object's id
// (store/common.ts fileUrl builds `<gateway>/file/<id>`, and the serve route reads the
// same key). A single flat directory under FILE_STORAGE_ROOT is enough for a self-hosted
// web equivalent; the id is a cuid, so there is no collision or traversal risk.
function filePath(id: string): string {
	return resolve(join(env.FILE_STORAGE_ROOT, id));
}

export async function writeFileBytes(
	id: string,
	bytes: Uint8Array,
): Promise<void> {
	const path = filePath(id);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
}

export async function readFileBytes(id: string): Promise<Uint8Array | null> {
	try {
		return await readFile(filePath(id));
	} catch {
		return null;
	}
}
