// Space-scoped fan-out for object-mutation deltas (a new chat message, an edited object),
// the push half of "live updates". It is membership-scoped: a frame is delivered only to
// accounts that have opened the space (registered at WorkspaceOpen, which is already
// reader-gated, so openers are members) and never to the acting account, whose own command
// response already carries the event. Process-local and ephemeral — nothing here is stored.

export type SessionEvent = { contextId: string; messages: unknown[] };

type ESink = (event: SessionEvent) => void;

export function createSpaceEvents() {
	const channels = new Map<string, Set<ESink>>();
	const openers = new Map<string, Set<string>>();

	function connect(userId: string, sink: ESink): () => void {
		let set = channels.get(userId);
		if (!set) {
			set = new Set<ESink>();
			channels.set(userId, set);
		}
		set.add(sink);

		return () => {
			const live = channels.get(userId);
			if (!live) {
				return;
			}
			live.delete(sink);
			if (live.size === 0) {
				channels.delete(userId);
			}
		};
	}

	function track(spaceId: string, userId: string): void {
		let members = openers.get(spaceId);
		if (!members) {
			members = new Set<string>();
			openers.set(spaceId, members);
		}
		members.add(userId);
	}

	function leave(spaceId: string, userId: string): void {
		const members = openers.get(spaceId);
		if (!members) {
			return;
		}
		members.delete(userId);
		if (members.size === 0) {
			openers.delete(spaceId);
		}
	}

	function emit(
		spaceId: string,
		event: SessionEvent,
		excludeUserId: string,
	): void {
		const members = openers.get(spaceId);
		if (!members) {
			return;
		}

		for (const userId of members) {
			if (userId === excludeUserId) {
				continue;
			}
			deliverTo(userId, event);
		}
	}

	// Push an event to a single account's live connections. Used by the subscription
	// registry, which knows exactly which account owns a given subId (unlike the space-wide
	// emit, which fans to every opener).
	function deliverTo(userId: string, event: SessionEvent): void {
		const live = channels.get(userId);
		if (!live) {
			return;
		}
		for (const sink of [...live]) {
			sink(event);
		}
	}

	return { connect, track, leave, emit, deliverTo };
}

export const spaceEvents = createSpaceEvents();
