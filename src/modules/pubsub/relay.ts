// A process-local fan-out relay for Anytype Pubsub, the only server->client push the
// web shell gets (it has no gRPC stream). It carries ephemeral presence + chat typing
// status between accounts, so it is deliberately in-memory: nothing here survives a
// restart and nothing belongs in the object kernel. A message published on a topic is
// delivered to every OTHER account's live connections that subscribed to that topic,
// matching the shell's expectation that it never sees its own presence echo.

export type PubsubMessage = {
	spaceId: string;
	topic: string;
	identity: string;
	subIds: string[];
	payload: Uint8Array;
};

type Sink = (message: PubsubMessage) => void;

type Subscription = { spaceId: string; topics: Set<string> };

const topicKey = (spaceId: string, topic: string): string =>
	`${spaceId}\u0000${topic}`;

export function createPubsubRelay() {
	// Live connections per account. A single account may hold several browser tabs.
	const channels = new Map<string, Set<Sink>>();
	// Each account's subId -> the space + topics it registered, kept so unsubscribe can
	// reverse exactly the byTopic rows it created.
	const subs = new Map<string, Map<string, Subscription>>();
	// topicKey -> userId -> subIds subscribed to that topic. The publish side reads this
	// so a topic fan-out is O(subscribers) rather than a scan of every subscription.
	const byTopic = new Map<string, Map<string, Set<string>>>();

	function connect(userId: string, sink: Sink): () => void {
		let set = channels.get(userId);
		if (!set) {
			set = new Set<Sink>();
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

	function subscribe(
		userId: string,
		spaceId: string,
		topics: string[],
		subId: string,
	): void {
		let bySub = subs.get(userId);
		if (!bySub) {
			bySub = new Map<string, Subscription>();
			subs.set(userId, bySub);
		}

		// Re-subscribing the same subId replaces its topic set, so drop its old rows first.
		const previous = bySub.get(subId);
		if (previous) {
			for (const topic of previous.topics) {
				dropTopicRow(spaceId, topic, userId, subId);
			}
		}

		const topicSet = new Set(topics);
		bySub.set(subId, { spaceId, topics: topicSet });

		for (const topic of topicSet) {
			const key = topicKey(spaceId, topic);
			let rows = byTopic.get(key);
			if (!rows) {
				rows = new Map<string, Set<string>>();
				byTopic.set(key, rows);
			}
			let ids = rows.get(userId);
			if (!ids) {
				ids = new Set<string>();
				rows.set(userId, ids);
			}
			ids.add(subId);
		}
	}

	function unsubscribe(userId: string, subId: string): void {
		const bySub = subs.get(userId);
		const subscription = bySub?.get(subId);
		if (!bySub || !subscription) {
			return;
		}
		for (const topic of subscription.topics) {
			dropTopicRow(subscription.spaceId, topic, userId, subId);
		}
		bySub.delete(subId);
		if (bySub.size === 0) {
			subs.delete(userId);
		}
	}

	function dropTopicRow(
		spaceId: string,
		topic: string,
		userId: string,
		subId: string,
	): void {
		const rows = byTopic.get(topicKey(spaceId, topic));
		const ids = rows?.get(userId);
		if (!rows || !ids) {
			return;
		}
		ids.delete(subId);
		if (ids.size === 0) {
			rows.delete(userId);
		}
		if (rows.size === 0) {
			byTopic.delete(topicKey(spaceId, topic));
		}
	}

	function publish(
		fromUserId: string,
		spaceId: string,
		topic: string,
		payload: Uint8Array,
	): void {
		const rows = byTopic.get(topicKey(spaceId, topic));
		if (!rows) {
			return;
		}

		for (const [userId, subIds] of rows) {
			if (userId === fromUserId) {
				continue;
			}
			const live = channels.get(userId);
			if (!live || live.size === 0) {
				continue;
			}

			const message: PubsubMessage = {
				spaceId,
				topic,
				identity: fromUserId,
				subIds: [...subIds],
				payload,
			};

			for (const sink of [...live]) {
				sink(message);
			}
		}
	}

	return { connect, subscribe, unsubscribe, publish };
}

export const pubsubRelay = createPubsubRelay();
