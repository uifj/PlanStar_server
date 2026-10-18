import { describe, expect, it } from "vitest";
import { createSubscriptionRegistry } from "../../../../src/modules/pubsub/subscription-registry.js";

// ADR-0009's live half, in minimal form: remember which object ids a client's subscription
// currently shows, so that when one is deleted/archived we can push a SubscriptionRemove to
// THAT account's tab (the one owning the subId) instead of forcing a reload. Delivery is
// injected so the registry stays a pure, testable store.

describe("subscription registry", () => {
	it("pushes a SubscriptionRemove to the owning account when a shown object is hidden", () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		registry.register("set-1", "u-2", "space-a", ["obj-x", "obj-y"]);

		registry.hideObject("obj-x");

		expect(delivered.length).toBe(1);
		expect(delivered[0].userId).toBe("u-2");
		expect(delivered[0].event).toEqual({
			contextId: "set-1",
			messages: [
				{
					spaceId: "space-a",
					subscriptionRemove: { id: "obj-x", subId: "set-1" },
				},
			],
		});
	});

	it("only removes a hidden object once and leaves the other shown ids intact", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("set-1", "u-2", "space-a", ["obj-x", "obj-y"]);

		registry.hideObject("obj-x");
		registry.hideObject("obj-x"); // already gone from this sub

		expect(delivered.length).toBe(1);
	});

	it("fans a hidden object out to every subscription that shows it, across accounts", () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		registry.register("set-1", "u-2", "space-a", ["obj-x"]);
		registry.register("coll-1", "u-3", "space-a", ["obj-x", "obj-z"]);

		registry.hideObject("obj-x");

		expect(delivered.length).toBe(2);
		expect(delivered.map((d) => d.userId).sort()).toEqual(["u-2", "u-3"]);
	});

	it("ignores a hidden object that no subscription is showing", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("set-1", "u-2", "space-a", ["obj-y"]);

		registry.hideObject("obj-x");

		expect(delivered.length).toBe(0);
	});

	it("drops the whole subscription on unsubscribe so it no longer receives removes", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("set-1", "u-2", "space-a", ["obj-x"]);
		registry.remove("set-1");

		registry.hideObject("obj-x");

		expect(delivered.length).toBe(0);
	});

	it("re-registering the same subId replaces its shown ids", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("set-1", "u-2", "space-a", ["obj-x"]);
		registry.register("set-1", "u-2", "space-a", ["obj-y"]); // widened query now shows only y

		registry.hideObject("obj-x");

		expect(delivered.length).toBe(0);

		registry.hideObject("obj-y");
		expect(delivered.length).toBe(1);
	});

	it("pushes an ObjectDetailsAmend to every subscription showing the edited object", () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		registry.register("set-1", "u-2", "space-a", ["obj-x", "obj-y"]);

		registry.amendObject("obj-x", { name: "Renamed" });

		expect(delivered.length).toBe(1);
		expect(delivered[0].userId).toBe("u-2");
		expect(delivered[0].event).toEqual({
			contextId: "obj-x",
			messages: [
				{
					spaceId: "space-a",
					objectDetailsAmend: {
						id: "obj-x",
						subIds: ["set-1"],
						details: { name: "Renamed" },
					},
				},
			],
		});
	});

	it("leaves the shown ids intact after an amend so the object can still be removed later", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("set-1", "u-2", "space-a", ["obj-x"]);
		registry.amendObject("obj-x", { done: true });
		registry.hideObject("obj-x");

		// one for the amend, one for the remove
		expect(delivered.length).toBe(2);
	});

	it("ignores an amend to an object no subscription shows", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("set-1", "u-2", "space-a", ["obj-y"]);

		registry.amendObject("obj-x", { name: "Unseen" });

		expect(delivered.length).toBe(0);
	});

	it("reveals a newly-added collection member to that collection's subscribers", () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		registry.register("coll-view", "u-2", "space-a", ["obj-a"], "coll-1");

		registry.revealMembers("coll-1", "space-a", [
			{ id: "obj-new", details: { id: "obj-new", name: "Fresh" } },
		]);

		expect(delivered.length).toBe(1);
		expect(delivered[0].userId).toBe("u-2");
		expect(delivered[0].event).toEqual({
			contextId: "coll-view",
			messages: [
				{
					spaceId: "space-a",
					objectDetailsSet: {
						id: "obj-new",
						subIds: ["coll-view"],
						details: { id: "obj-new", name: "Fresh" },
					},
				},
				{
					spaceId: "space-a",
					subscriptionAdd: { id: "obj-new", afterId: "", subId: "coll-view" },
				},
			],
		});
	});

	it("does not reveal a member into an unrelated collection's subscription", () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("coll-view", "u-2", "space-a", [], "coll-2");

		registry.revealMembers("coll-1", "space-a", [
			{ id: "obj-new", details: { id: "obj-new" } },
		]);

		expect(delivered.length).toBe(0);
	});

	it("unreveals (targeted SubscriptionRemove) only the collection's own view, not other subs", () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		registry.register("coll-view", "u-2", "space-a", ["obj-x"], "coll-1");
		registry.register("all-list", "u-3", "space-a", ["obj-x"], ""); // still shows it as All objects

		registry.unrevealMembers("coll-1", "space-a", ["obj-x"]);

		// only the collection view is told to drop it; the All-objects list keeps it
		expect(delivered.length).toBe(1);
		const event = delivered[0].event;
		expect(event.messages).toEqual([
			{
				spaceId: "space-a",
				subscriptionRemove: { id: "obj-x", subId: "coll-view" },
			},
		]);
	});

	it("reevaluate adds a newly-matching object to a query-backed subscription", async () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		// A general "All objects" sub: its runner returns the live query result, which now
		// includes a freshly-created object the snapshot does not yet have.
		registry.register(
			"all-list",
			"u-2",
			"space-a",
			["obj-a"],
			"",
			async () => [
				{ id: "obj-a", name: "A" },
				{ id: "obj-new", name: "New" },
			],
		);

		await registry.reevaluate("space-a");

		expect(delivered.length).toBe(1);
		expect(delivered[0].userId).toBe("u-2");
		expect(delivered[0].event).toEqual({
			contextId: "all-list",
			messages: [
				{
					spaceId: "space-a",
					objectDetailsSet: {
						id: "obj-new",
						subIds: ["all-list"],
						details: { id: "obj-new", name: "New" },
					},
				},
				{
					spaceId: "space-a",
					subscriptionAdd: { id: "obj-new", afterId: "", subId: "all-list" },
				},
			],
		});
	});

	it("reevaluate removes objects that no longer match and updates the snapshot", async () => {
		const delivered: Array<{ userId: string; event: any }> = [];
		const registry = createSubscriptionRegistry((userId, event) =>
			delivered.push({ userId, event }),
		);

		registry.register(
			"all-list",
			"u-2",
			"space-a",
			["obj-a", "obj-gone"],
			"",
			async () => [{ id: "obj-a", name: "A" }],
		);

		await registry.reevaluate("space-a");

		expect(delivered.length).toBe(1);
		expect(delivered[0].event.messages).toEqual([
			{
				spaceId: "space-a",
				subscriptionRemove: { id: "obj-gone", subId: "all-list" },
			},
		]);

		// idempotent: a second reevaluate with the same result emits nothing new
		await registry.reevaluate("space-a");
		expect(delivered.length).toBe(1);
	});

	it("reevaluate ignores subs in another space and those with no runner", async () => {
		const delivered: unknown[] = [];
		const registry = createSubscriptionRegistry(() => delivered.push(1));

		registry.register("s1", "u-2", "space-b", [], "", async () => [
			{ id: "x" },
		]);
		registry.register("s2", "u-2", "space-a", []); // no runner

		await registry.reevaluate("space-a");

		expect(delivered.length).toBe(0);
	});
});
