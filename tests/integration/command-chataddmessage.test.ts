import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A chat block posts to its object's chat feed. The client's C.ChatAddMessage sends the mapped wire
// message (Mapper.To.ChatMessage): the body text lives under `message.message` ({text, style, marks}),
// and id/orderId/creator/timestamps are left for the server to assign (form.tsx:1080-1097 posts only
// content/attachments/reactions/blocks/replyToMessageId). The server is authoritative: it mints the
// id, a monotonic per-chat orderId (ADR-0003 fractional ordering), stamps the creator and createdAt
// (unix seconds), persists the content, and answers { messageId } plus a ChatAdd event carrying the
// assigned orderId (dispatcher.ts:1202 -> messageAdd). response.ts:773 reads only messageId off the
// envelope; the orderId reaches the store through the event.
describe.skipIf(!databaseAvailable)("POST /api/command/ChatAddMessage", () => {
	const owner = "chat-add.owner";
	const reader = "chat-add.reader";
	const outsider = "chat-add.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{ id: owner, name: "Chat owner", email: "chat-add-owner@vanlife.test" },
				{
					id: reader,
					name: "Chat reader",
					email: "chat-add-reader@vanlife.test",
				},
				{
					id: outsider,
					name: "Chat outsider",
					email: "chat-add-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, reader, outsider] } },
		});
	});

	const provision = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Chat space" },
				useCase: 2,
			})
		).json();
		const { objectId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Chat object" },
			})
		).json();
		return { spaceId: spaceId as string, chatObjectId: objectId as string };
	};

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

	const addMessage = async (chatObjectId: string, text: string, as = owner) => {
		signInAs(as);
		return (
			await post("/api/command/ChatAddMessage", {
				chatObjectId,
				message: wireMessage(text),
			})
		).json();
	};

	it("stores a posted message and returns its id", async () => {
		const { spaceId, chatObjectId } = await provision();

		const body = await addMessage(chatObjectId, "hello world");
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(typeof body.messageId).toBe("string");
		expect(body.messageId.length).toBeGreaterThan(0);

		const row = await prisma.chatMessage.findUnique({
			where: { id: body.messageId },
		});
		expect(row).not.toBeNull();
		expect(row?.chatId).toBe(chatObjectId);
		expect(row?.spaceId).toBe(spaceId);
		expect(row?.creatorId).toBe(owner);
		expect(row?.seq).toBe(1n);
		expect(row?.orderId).toBe("000000000001");
		expect(row?.content).toEqual({ text: "hello world", style: 0, marks: [] });
		expect(Number(row?.createdAt)).toBeGreaterThan(0);
	});

	it("assigns each message a strictly increasing per-chat orderId", async () => {
		const { chatObjectId } = await provision();

		const first = await addMessage(chatObjectId, "first");
		const second = await addMessage(chatObjectId, "second");

		expect(first.messageId).not.toBe(second.messageId);

		const firstRow = await prisma.chatMessage.findUnique({
			where: { id: first.messageId },
		});
		const secondRow = await prisma.chatMessage.findUnique({
			where: { id: second.messageId },
		});
		expect(secondRow?.seq).toBe(2n);
		expect(secondRow?.orderId).toBe("000000000002");
		// The client sorts and paginates by lexicographic orderId compare, so the later message's
		// orderId must sort after the earlier one's.
		expect((secondRow?.orderId ?? "") > (firstRow?.orderId ?? "")).toBe(true);
	});

	it("returns a ChatAdd event carrying the record and its orderId", async () => {
		const { spaceId, chatObjectId } = await provision();

		const body = await addMessage(chatObjectId, "event payload");

		expect(body.event?.contextId).toBe(chatObjectId);
		const chatAdd = body.event?.messages?.[0]?.chatAdd;
		expect(body.event?.messages?.[0]?.spaceId).toBe(spaceId);
		expect(chatAdd?.id).toBe(body.messageId);
		expect(chatAdd?.orderId).toBe("000000000001");
		// The event's message is the wire shape From.ChatMessage reads: body text under `message`,
		// creator projected to a participant id, timestamps in unix seconds.
		expect(chatAdd?.message?.message).toEqual({
			text: "event payload",
			style: 0,
			marks: [],
		});
		expect(chatAdd?.message?.creator).toBe(
			`_participant_${spaceId.replace(/\./g, "_")}_${owner}`,
		);
		expect(chatAdd?.message?.createdAt).toBeGreaterThan(0);
	});

	it("refuses a member below the writer floor", async () => {
		const { spaceId, chatObjectId } = await provision();
		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		const body = await addMessage(chatObjectId, "nope", reader);
		expect(body.error.code).toBe(2);

		const count = await prisma.chatMessage.count({
			where: { chatId: chatObjectId },
		});
		expect(count).toBe(0);
	});

	it("refuses a non-member", async () => {
		const { chatObjectId } = await provision();

		const body = await addMessage(chatObjectId, "nope", outsider);
		expect(body.error.code).toBe(2);
	});

	it("answers NOT_FOUND when the chat object does not exist", async () => {
		await provision();

		const body = await addMessage("chat-add.does-not-exist", "nope");
		expect(body.error).toEqual({ code: 3, description: "Object not found." });
	});
});
