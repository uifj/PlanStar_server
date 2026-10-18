import { ensureSpaceAccess } from "../../auth/space-access.js";
import type { AuthUser } from "../../lib/auth.js";
import { pubsubRelay } from "./relay.js";

// Pubsub is ephemeral presence + chat typing status, so these handlers touch no tables:
// they only register a topic subscription against the caller's account and relay a
// published payload to the other members' live /events connections (see relay.ts).
// Requiring reader membership means a client cannot subscribe to or broadcast into a
// space it is not a member of.

// The REST transport JSON.stringifies the shell's Uint8Array payload, which serialises
// to a numeric-keyed object ({"0":104,...}); a base64 string is also accepted so a
// future transport can send it compactly. Rebuild the exact bytes for the relay.
export function coerceBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) {
		return value;
	}

	if (typeof value === "string") {
		return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([key]) => /^\d+$/.test(key))
			.sort(([a], [b]) => Number(a) - Number(b));

		return Uint8Array.from(entries.map(([, byte]) => Number(byte) & 0xff));
	}

	return new Uint8Array();
}

export async function subscribe(
	user: AuthUser,
	spaceId: string,
	topics: string[],
	subId: string,
): Promise<void> {
	await ensureSpaceAccess(user.id, spaceId, "reader");
	pubsubRelay.subscribe(user.id, spaceId, topics, subId);
}

export async function publish(
	user: AuthUser,
	spaceId: string,
	topic: string,
	payload: Uint8Array,
): Promise<void> {
	await ensureSpaceAccess(user.id, spaceId, "reader");
	pubsubRelay.publish(user.id, spaceId, topic, payload);
}

// Unsubscribe carries no spaceId, so it cannot re-gate; it only removes the caller's own
// subId, which the relay keys by account, so it can never tear down another account.
export function unsubscribe(user: AuthUser, subId: string): void {
	pubsubRelay.unsubscribe(user.id, subId);
}
