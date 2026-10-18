import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import {
	type SessionEvent,
	spaceEvents,
} from "../../src/modules/pubsub/space-events.js";
import { subscriptionRegistry } from "../../src/modules/pubsub/subscription-registry.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Live list updates (the completable half of ADR-0009): a peer's ObjectSearchSubscribe
// records which ids the view is showing; when another member deletes one, the registry pushes
// a SubscriptionRemove to that peer's open /events connection so the row leaves without a
// reload. The whole path runs over real HTTP commands, the registry, the space-event hub and a
// connected sink — no stubs between them.
describe.skipIf(!databaseAvailable)(
	"live SubscriptionRemove on object delete",
	() => {
		const owner = "livesub.owner";
		const peer = "livesub.peer";

		const closes: Array<() => void> = [];

		beforeAll(async () => {
			await prisma.space.deleteMany({
				where: { createdBy: { in: [owner, peer] } },
			});
			await prisma.user.deleteMany({ where: { id: { in: [owner, peer] } } });
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Live sub owner",
						email: "livesub-owner@vanlife.test",
					},
					{
						id: peer,
						name: "Live sub peer",
						email: "livesub-peer@vanlife.test",
					},
				],
			});
		});

		afterEach(() => {
			for (const close of closes.splice(0)) {
				close();
			}
			subscriptionRegistry.remove("live-list-1");
			subscriptionRegistry.remove("gen-live-1");
		});

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Live space" },
					useCase: 2,
				})
			).json();
			await prisma.spaceMember.create({
				data: {
					spaceId: spaceId as string,
					userId: peer,
					permission: "reader",
				},
			});
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Removable" },
				})
			).json();
			return { spaceId: spaceId as string, objectId: objectId as string };
		};

		it("pushes a SubscriptionRemove to a subscribed peer when the owner deletes the object", async () => {
			const { spaceId, objectId } = await provision();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));

			signInAs(peer);
			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: "live-list-1",
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 100,
				})
			).json();
			expect(subscribed.error).toEqual({ code: 0, description: "" });
			expect(
				subscribed.records.some((record: any) => record.id === objectId),
			).toBe(true);

			signInAs(owner);
			const deleted = await (
				await post("/api/command/ObjectListDelete", { objectIds: [objectId] })
			).json();
			expect(deleted.error).toEqual({ code: 0, description: "" });

			expect(received.length).toBe(1);
			const message = received[0].messages[0] as Record<string, any>;
			expect(message.spaceId).toBe(spaceId);
			expect(message.subscriptionRemove).toEqual({
				id: objectId,
				subId: "live-list-1",
			});
		});

		it("does not push to a peer that unsubscribed first", async () => {
			const { spaceId, objectId } = await provision();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));

			signInAs(peer);
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "live-list-1",
				filters: [],
				sorts: [],
				keys: [],
				offset: 0,
				limit: 100,
			});

			signInAs(peer);
			await post("/api/command/ObjectSearchUnsubscribe", {
				subIds: ["live-list-1"],
			});

			signInAs(owner);
			await post("/api/command/ObjectListDelete", { objectIds: [objectId] });

			expect(received.length).toBe(0);
		});

		it("pushes an ObjectDetailsAmend to a subscribed peer when the owner edits the object", async () => {
			const { spaceId, objectId } = await provision();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));

			signInAs(peer);
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "live-list-1",
				filters: [],
				sorts: [],
				keys: [],
				offset: 0,
				limit: 100,
			});

			signInAs(owner);
			const edited = await (
				await post("/api/command/ObjectListSetDetails", {
					objectIds: [objectId],
					details: [{ id: objectId, details: { name: "Renamed live" } }],
				})
			).json();
			expect(edited.error).toEqual({ code: 0, description: "" });

			expect(received.length).toBe(1);
			const message = received[0].messages[0] as Record<string, any>;
			expect(message.spaceId).toBe(spaceId);
			expect(message.objectDetailsAmend).toEqual({
				id: objectId,
				subIds: ["live-list-1"],
				details: { name: "Renamed live" },
			});
		});

		it("reveals a newly-added collection member to a peer viewing that collection", async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Reveal space" },
					useCase: 2,
				})
			).json();
			await prisma.spaceMember.create({
				data: {
					spaceId: spaceId as string,
					userId: peer,
					permission: "reader",
				},
			});
			const { objectId: collectionId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "My collection" },
				})
			).json();
			await post("/api/command/ObjectToCollection", {
				contextId: collectionId,
			});
			const { objectId: member } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "To reveal" },
				})
			).json();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));
			closes.push(() => subscriptionRegistry.remove("coll-live-1"));

			signInAs(peer);
			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					collectionId,
					subId: "coll-live-1",
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 100,
				})
			).json();
			expect(subscribed.error).toEqual({ code: 0, description: "" });
			expect(subscribed.records.length).toBe(0);

			// Owner adds the member to the collection -> the peer's open view gains it live.
			signInAs(owner);
			const added = await (
				await post("/api/command/ObjectCollectionAdd", {
					contextId: collectionId,
					objectIds: [member],
				})
			).json();
			expect(added.error).toEqual({ code: 0, description: "" });

			expect(received.length).toBe(1);
			const keys = received[0].messages.map((m: any) =>
				m.objectDetailsSet ? "set" : m.subscriptionAdd ? "add" : "?",
			);
			expect(keys).toEqual(["set", "add"]);
			const set = received[0].messages[0] as Record<string, any>;
			expect(set.objectDetailsSet.id).toBe(member);
			expect(set.objectDetailsSet.subIds).toEqual(["coll-live-1"]);
			const add = received[0].messages[1] as Record<string, any>;
			expect(add.subscriptionAdd).toEqual({
				id: member,
				afterId: "",
				subId: "coll-live-1",
			});

			// Removing it targets only the collection view, not the peer's other subs.
			signInAs(owner);
			await post("/api/command/ObjectCollectionRemove", {
				contextId: collectionId,
				objectIds: [member],
			});

			const removed = received[1]?.messages[0] as Record<string, any>;
			expect(removed.subscriptionRemove).toEqual({
				id: member,
				subId: "coll-live-1",
			});
		});

		it("reveals a newly-created object to a peer's general list subscription", async () => {
			const { spaceId } = await provision();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));

			signInAs(peer);
			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: "gen-live-1",
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 100,
				})
			).json();
			expect(subscribed.error).toEqual({ code: 0, description: "" });
			const before = received.length;

			// Owner creates a fresh object -> the peer's All-objects view gains it live.
			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Created live" },
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const newId = created.objectId as string;
			expect(received.length).toBeGreaterThan(before);

			const add = received
				.slice(before)
				.flatMap((e) => e.messages as Array<Record<string, any>>)
				.find((m) => m.subscriptionAdd?.id === newId);
			expect(add?.subscriptionAdd?.subId).toBe("gen-live-1");

			const set = received
				.slice(before)
				.flatMap((e) => e.messages as Array<Record<string, any>>)
				.find((m) => m.objectDetailsSet?.id === newId);
			expect(set?.objectDetailsSet?.details?.name).toBe("Created live");
		});

		it("reveals an object created through a link block to a peer's general list", async () => {
			const { spaceId } = await provision();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));

			signInAs(peer);
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: "gen-live-1",
				filters: [],
				sorts: [],
				keys: [],
				offset: 0,
				limit: 100,
			});
			const before = received.length;

			// BlockLinkCreateWithObject is the create path the dataview "New object" button uses.
			signInAs(owner);
			const created = await (
				await post("/api/command/BlockLinkCreateWithObject", {
					spaceId,
					details: { name: "Linked live" },
					style: { contentType: "link" },
					targetObjectId: "",
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const newId = created.targetId as string;
			const messages = received
				.slice(before)
				.flatMap((e) => e.messages as Array<Record<string, any>>);
			expect(
				messages.some(
					(m) =>
						m.subscriptionAdd?.id === newId &&
						m.subscriptionAdd?.subId === "gen-live-1",
				),
			).toBe(true);
		});

		it("gains a newly-created object in a peer's Recent list subscription", async () => {
			const { spaceId } = await provision();
			const subId = `recentEditAll-${spaceId}`;

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (event) => received.push(event)));
			closes.push(() => subscriptionRegistry.remove(subId));

			signInAs(peer);
			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId,
					filters: [],
					sorts: [],
					keys: [],
					offset: 0,
					limit: 10,
				})
			).json();
			expect(subscribed.error).toEqual({ code: 0, description: "" });
			const before = received.length;

			signInAs(owner);
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Recent live" },
				})
			).json();
			expect(created.error).toEqual({ code: 0, description: "" });

			const messages = received
				.slice(before)
				.flatMap((e) => e.messages as Array<Record<string, any>>);
			expect(
				messages.some(
					(m) =>
						m.subscriptionAdd?.id === created.objectId &&
						m.subscriptionAdd?.subId === subId,
				),
			).toBe(true);
		});
	},
);
