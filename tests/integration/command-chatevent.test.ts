import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import {
	type SessionEvent,
	spaceEvents,
} from "../../src/modules/pubsub/space-events.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Live chat updates: ChatAddMessage already returns the ChatAdd delta to the caller; it now
// also fans the same event out to the space's OTHER open members through the session-event
// hub, so a peer's chat tab shows the message without reloading. The peer registers as an
// opener by calling WorkspaceOpen (membership-gated), so the push never crosses into a space
// it is not a member of.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatAddMessage live space event",
	() => {
		const owner = "chatev.owner";
		const peer = "chatev.peer";

		beforeAll(async () => {
			await prisma.space.deleteMany({
				where: { createdBy: { in: [owner, peer] } },
			});
			await prisma.user.deleteMany({ where: { id: { in: [owner, peer] } } });
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Chat ev owner",
						email: "chatev-owner@vanlife.test",
					},
					{ id: peer, name: "Chat ev peer", email: "chatev-peer@vanlife.test" },
				],
			});
		});

		const closes: Array<() => void> = [];
		afterEach(() => {
			for (const close of closes.splice(0)) {
				close();
			}
		});

		const wireMessage = (text: string) => ({
			id: "",
			orderId: "",
			creator: "",
			createdAt: 0,
			modifiedAt: 0,
			replyToMessageId: "",
			message: { text, style: 0, marks: [] },
			attachments: [],
			reactions: {},
			blocks: [],
			pinned: false,
		});

		it("pushes the ChatAdd event to a peer member that opened the space", async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Live chat space" },
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
					details: { name: "Chat feed" },
				})
			).json();

			// The peer has an open /events connection and has opened the space.
			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (e) => received.push(e)));
			signInAs(peer);
			await post("/api/command/WorkspaceOpen", { spaceId });

			// ...and is watching this chat, which is the only reason the delta has an address: the
			// dispatcher applies a ChatAdd to the subIds it names (dispatcher.ts:1222).
			const peerSubId = `chat-${spaceId}-${objectId}:chat.tab-peer`;
			signInAs(peer);
			await post("/api/command/ChatSubscribeLastMessages", {
				chatObjectId: objectId,
				limit: 50,
				subId: peerSubId,
			});

			// The owner posts a message; the caller's response already carries it, and the
			// hub pushes the identical delta to the peer.
			signInAs(owner);
			await post("/api/command/ChatAddMessage", {
				chatObjectId: objectId,
				message: wireMessage("ping from owner"),
			});

			expect(received.length).toBe(1);
			const message = received[0].messages[0] as Record<string, unknown>;
			expect(received[0].contextId).toBe(objectId);
			expect(message.chatAdd as Record<string, unknown>).toBeDefined();
			const chatAdd = message.chatAdd as Record<string, any>;
			expect(chatAdd.message.message.text).toBe("ping from owner");
			// The creator is the ACCOUNT id — the chat bubble matches it against account.id.
			expect(chatAdd.message.creator).toBe(owner);
			expect(typeof chatAdd.orderId).toBe("string");
			expect(chatAdd.subIds).toEqual([peerSubId]);
		});

		// Every chat delta is addressed by subId, not just ChatAdd: a reaction written by one member has
		// to land in the open list of the member who is watching the chat.
		it("addresses a peer's reaction delta to the chat that peer has open", async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Reaction push space" },
					useCase: 2,
				})
			).json();
			await prisma.spaceMember.create({
				data: {
					spaceId: spaceId as string,
					userId: peer,
					permission: "writer",
					status: "active",
				},
			});
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Reaction feed" },
				})
			).json();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (e) => received.push(e)));
			signInAs(peer);
			await post("/api/command/WorkspaceOpen", { spaceId });
			const peerSubId = `chat-${spaceId}-${objectId}:chat.tab-peer`;
			await post("/api/command/ChatSubscribeLastMessages", {
				chatObjectId: objectId,
				limit: 50,
				subId: peerSubId,
			});

			// The peer writes the message the owner then reacts to.
			const posted = await (
				await post("/api/command/ChatAddMessage", {
					chatObjectId: objectId,
					message: wireMessage("react to this"),
				})
			).json();

			signInAs(owner);
			await post("/api/command/ChatToggleMessageReaction", {
				chatObjectId: objectId,
				messageId: posted.messageId,
				emoji: "👍",
			});

			const frame = received
				.map((e) => e.messages[0] as Record<string, any>)
				.find((m) => m.chatUpdateReactions);
			expect(frame.chatUpdateReactions.subIds).toEqual([peerSubId]);
			expect(frame.chatUpdateReactions.reactions).toEqual({
				reactions: { "👍": { ids: [owner] } },
			});
		});

		it("does not push into a space the peer never opened", async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Unopened space" },
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
					details: { name: "Other feed" },
				})
			).json();

			const received: SessionEvent[] = [];
			closes.push(spaceEvents.connect(peer, (e) => received.push(e)));
			// No WorkspaceOpen for this space, so the peer is not a tracked opener.

			signInAs(owner);
			await post("/api/command/ChatAddMessage", {
				chatObjectId: objectId,
				message: wireMessage("should not arrive"),
			});

			expect(received.length).toBe(0);
		});
	},
);
