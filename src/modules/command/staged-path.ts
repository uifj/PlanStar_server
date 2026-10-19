import { tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { env } from "../../config/env.js";

// The only directories a command may read a "local path" from. A browser cannot hand the server
// a filesystem path, so the web transport stages the picked bytes itself and gets a path back:
// this server's own upload route writes under FILE_UPLOAD_STAGING_ROOT
// (src/modules/files/router.ts) and the Vite dev middleware writes to a temp directory
// (front_web/vite.web.config.ts:77). The commands that take such a path — FileUpload's
// localPath, ObjectImport's and FileDrop's paths — run as the API process's own user, so
// reading anything else would let any space writer import /etc/passwd and fetch it back.
export function stagingRoots() {
	return [
		resolve(env.FILE_UPLOAD_STAGING_ROOT),
		resolve(`${tmpdir()}${sep}anytype-web-uploads`),
	];
}

export function isStagedPath(path: string) {
	const target = resolve(path);
	return stagingRoots().some((root) => target.startsWith(`${root}${sep}`));
}

// Both upload ingresses stamp a staged file as `<timestamp>-<random>-<original name>` — the Vite
// dev middleware (front_web/vite.web.config.ts:77) and POST /api/web-upload. The commands that
// receive only the path (FileUpload's localPath, ObjectImport's and FileDrop's paths) therefore
// have to take the prefix back off, or a dropped `route.pdf` shows up in the user's body as
// `1792374827952-hm2yx-route.pdf`.
export function stagedFileName(path: string) {
	const name = basename(path);
	return name.replace(/^\d{10,}-[a-z0-9]{3,8}-/i, "") || name;
}
