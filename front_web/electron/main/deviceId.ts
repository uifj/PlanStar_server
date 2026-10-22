import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

/**
 * Stable per-install device id.
 *
 * The log uplink is anonymous, so the id is the only correlation key between an operator's query and
 * a machine in the field. It is generated once, persisted in `userData` (survives updates, dies with
 * the install) and never derived from hardware: a rotated id is a new device to the server, which is
 * exactly the behaviour a reinstall should have.
 *
 * `randomUUID()` satisfies the server's `[A-Za-z0-9_-]{8,64}` device-id constraint (36 chars, dashes
 * allowed) and, unlike a hostname or a MAC, carries no personal information.
 */

const FILE_NAME = "device-id";
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Absolute path of the persisted id. */
export function deviceIdPath(): string {
	return join(app.getPath("userData"), FILE_NAME);
}

/**
 * Read the persisted id, creating it on first run. A corrupt file is replaced rather than reported:
 * a device without an id cannot upload at all, and losing the correlation is better than losing the
 * logs.
 */
export function getOrCreateDeviceId(): string {
	const path = deviceIdPath();
	try {
		const existing = readFileSync(path, "utf8").trim();
		if (DEVICE_ID.test(existing)) {
			return existing;
		}
	} catch {
		// Missing or unreadable: fall through and write a fresh one.
	}

	const id = randomUUID();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, id, { mode: 0o600 });
	} catch {
		// Read-only userData: the in-memory id still lets this session upload.
	}
	return id;
}
