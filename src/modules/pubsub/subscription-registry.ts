import { type SessionEvent, spaceEvents } from "./space-events.js";

// Minimal ADR-0009 registry: remembers the object ids a client subscription is currently
// showing, keyed by the subId the client owns, so an object that leaves the view (deleted or
// archived) can be pushed out as a SubscriptionRemove instead of waiting for a reload. It is
// a process-local snapshot, not a durable store — it never claims to know more than the last
// result it served for that subId.

type Delivery = (userId: string, event: SessionEvent) => void;

type Registration = {
	userId: string;
	spaceId: string;
	ids: Set<string>;
	collectionId: string;
	runner?: () => Promise<Array<Record<string, unknown>>>;
};

export function createSubscriptionRegistry(deliver: Delivery) {
	const subs = new Map<string, Registration>();

	function register(
		subId: string,
		userId: string,
		spaceId: string,
		ids: string[],
		collectionId = "",
		runner?: () => Promise<Array<Record<string, unknown>>>,
	): void {
		subs.set(subId, {
			userId,
			spaceId,
			ids: new Set(ids),
			collectionId,
			runner,
		});
	}

	function remove(subId: string): void {
		subs.delete(subId);
	}

	// Push a SubscriptionRemove to every subscription currently showing the object, then drop
	// it from those snapshots so a repeat call (batch delete touching the same view) is idempotent.
	function hideObject(objectId: string): void {
		for (const [subId, sub] of subs) {
			if (!sub.ids.has(objectId)) {
				continue;
			}

			sub.ids.delete(objectId);

			const event: SessionEvent = {
				contextId: subId,
				messages: [
					{
						spaceId: sub.spaceId,
						subscriptionRemove: { id: objectId, subId },
					},
				],
			};

			deliver(sub.userId, event);
		}
	}

	// Push an ObjectDetailsAmend to every subscription currently showing the edited object, so
	// a rename / field change is reflected in peers' open rows without a reload. The shown ids
	// are left intact (the object stays in the view).
	function amendObject(
		objectId: string,
		details: Record<string, unknown>,
	): void {
		for (const [subId, sub] of subs) {
			if (!sub.ids.has(objectId)) {
				continue;
			}

			const event: SessionEvent = {
				contextId: objectId,
				messages: [
					{
						spaceId: sub.spaceId,
						objectDetailsAmend: { id: objectId, subIds: [subId], details },
					},
				],
			};

			deliver(sub.userId, event);
		}
	}

	// A collection gained members: push each new member's record + its SubscriptionAdd to the
	// subscriptions of THAT collection (a de-collection'd object still lives in other views, so
	// collection membership deltas are matched by collectionId, never by the id snapshot alone).
	function revealMembers(
		collectionId: string,
		spaceId: string,
		members: Array<{ id: string; details: Record<string, unknown> }>,
	): void {
		if (members.length === 0) {
			return;
		}
		for (const [subId, sub] of subs) {
			if (sub.collectionId !== collectionId) {
				continue;
			}

			const messages = members.flatMap((member) => {
				sub.ids.add(member.id);
				return [
					{
						spaceId,
						objectDetailsSet: {
							id: member.id,
							subIds: [subId],
							details: member.details,
						},
					},
					{
						spaceId,
						subscriptionAdd: {
							id: member.id,
							afterId: "",
							subId,
						},
					},
				];
			});

			deliver(sub.userId, { contextId: subId, messages });
		}
	}

	// A collection lost members: push a targeted SubscriptionRemove to that collection's views
	// only (the object itself still exists and may show elsewhere, so this must not reuse
	// hideObject, which would drop it from every view that happens to show it).
	function unrevealMembers(
		collectionId: string,
		spaceId: string,
		objectIds: string[],
	): void {
		for (const [subId, sub] of subs) {
			if (sub.collectionId !== collectionId) {
				continue;
			}

			const removed = objectIds.filter((id) => {
				if (!sub.ids.has(id)) {
					return false;
				}
				sub.ids.delete(id);
				return true;
			});
			if (removed.length === 0) {
				continue;
			}

			const messages = removed.map((id) => ({
				spaceId,
				subscriptionRemove: { id, subId },
			}));

			deliver(sub.userId, { contextId: subId, messages });
		}
	}

	// Re-run each query-backed subscription's own result set for a space and reconcile the
	// snapshot: newly-matching rows get objectDetailsSet + SubscriptionAdd, rows that dropped
	// out get SubscriptionRemove. Because it reuses the exact subscribe query, membership is
	// decided the same way the initial subscribe decided it — no re-implemented filter logic.
	async function reevaluate(spaceId: string): Promise<void> {
		for (const [subId, sub] of subs) {
			if (sub.spaceId !== spaceId || !sub.runner) {
				continue;
			}

			let records: Array<Record<string, unknown>>;
			try {
				records = await sub.runner();
			} catch {
				continue;
			}

			const nextIds = new Set(records.map((record) => record.id as string));
			const added = records.filter(
				(record) => !sub.ids.has(record.id as string),
			);
			const removed = [...sub.ids].filter((id) => !nextIds.has(id));

			if (added.length === 0 && removed.length === 0) {
				continue;
			}

			const messages = [
				...added.flatMap((record) => [
					{
						spaceId,
						objectDetailsSet: {
							id: record.id,
							subIds: [subId],
							details: record,
						},
					},
					{
						spaceId,
						subscriptionAdd: {
							id: record.id,
							afterId: "",
							subId,
						},
					},
				]),
				...removed.map((id) => ({
					spaceId,
					subscriptionRemove: { id, subId },
				})),
			];

			sub.ids = nextIds;
			deliver(sub.userId, { contextId: subId, messages });
		}
	}

	return {
		register,
		remove,
		hideObject,
		amendObject,
		revealMembers,
		unrevealMembers,
		reevaluate,
	};
}

export const subscriptionRegistry = createSubscriptionRegistry(
	(userId, event) => spaceEvents.deliverTo(userId, event),
);
