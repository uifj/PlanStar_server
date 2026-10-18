import type { SessionEvent } from "../pubsub/space-events.js";

// Every chat delta the client receives is routed BY subId: dispatcher.ts:1222 (ChatAdd), :1398
// (ChatUpdateReactions), :1333 (ChatStateUpdate) and their siblings each resolve the subscriptions
// named on the event and apply it there — so an event with no subIds reaches nobody and the open chat
// never updates. A chat's addresses are the subIds that asked for it (ChatSubscribeLastMessages names
// one) until they tear down (ChatUnsubscribe) or go quiet: a closed tab sends no teardown, so a watch
// is dropped after this period. Process-local and ephemeral, like the ADR-0009 registry.

const WATCH_TTL_MS = 30 * 60 * 1000;

const watches = new Map<
	string,
	Map<string, { userId: string; seenAt: number }>
>();

export function watchChat(
	chatObjectId: string,
	subId: string,
	userId: string,
): void {
	if (!chatObjectId || !subId) {
		return;
	}
	let list = watches.get(chatObjectId);
	if (!list) {
		list = new Map();
		watches.set(chatObjectId, list);
	}
	list.set(subId, { userId, seenAt: Date.now() });
}

export function dropChatWatches(chatObjectId: string, subIds: string[]): void {
	const list = watches.get(chatObjectId);
	if (!list) {
		return;
	}
	for (const subId of subIds) {
		list.delete(subId);
	}
	if (list.size === 0) {
		watches.delete(chatObjectId);
	}
}

export function chatSubIdsFor(chatObjectId: string, userId: string): string[] {
	const list = watches.get(chatObjectId);
	if (!list) {
		return [];
	}
	const now = Date.now();
	const ids: string[] = [];
	for (const [subId, watch] of list) {
		if (now - watch.seenAt > WATCH_TTL_MS) {
			list.delete(subId);
		} else if (watch.userId === userId) {
			ids.push(subId);
		}
	}
	if (list.size === 0) {
		watches.delete(chatObjectId);
	}
	return ids;
}

// One chat delta, addressed to what `userId` has open. `body` is the event's own payload minus
// subIds, which this owns — so a command builds its body once and hands it to both its own response
// and the per-peer events of spaceEvents.emitScoped.
export function chatDeltaFor(
	chatObjectId: string,
	spaceId: string,
	userId: string,
	kind: string,
	body: Record<string, unknown>,
): Record<string, unknown> {
	return {
		spaceId,
		[kind]: { ...body, subIds: chatSubIdsFor(chatObjectId, userId) },
	};
}

export function chatEventFor(
	chatObjectId: string,
	spaceId: string,
	userId: string,
	kind: string,
	body: Record<string, unknown>,
): SessionEvent {
	return {
		contextId: chatObjectId,
		messages: [chatDeltaFor(chatObjectId, spaceId, userId, kind, body)],
	};
}
