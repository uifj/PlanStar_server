import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatReadAll {} (no args — the readAllMessages shortcut, keyboard.ts:1189) marks every chat in the
// caller's active spaces fully read: each chat's message + mention watermark jumps to its newest
// orderId. It only ever touches the CALLER's own ChatReadState rows, so one member clearing their
// badges never affects another's. There is no per-chat push event (a single envelope carries one
// contextId, and this spans many chats); the client's next ChatSubscribeLastMessages per chat reflects
// the cleared counters.
describe.skipIf(!databaseAvailable)("POST /api/command/ChatReadAll", () => {
	const owner = "chat-readall.owner";
	const reader = "chat-readall.reader";
	const loner = "chat-readall.loner";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "ReadAll owner",
					email: "chat-readall-owner@vanlife.test",
				},
				{
					id: reader,
					name: "ReadAll reader",
					email: "chat-readall-reader@vanlife.test",
				},
				{
					id: loner,
					name: "ReadAll loner",
					email: "chat-readall-loner@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, reader, loner] } },
		});
	});

	const orderId = (seq: number) => BigInt(seq).toString().padStart(12, "0");

	const makeChat = async (spaceId: string, name: string) => {
		const { objectId } = await (
			await post("/api/command/ObjectCreate", { spaceId, details: { name } })
		).json();
		return objectId as string;
	};

	const seed = async (chatObjectId: string, spaceId: string, count: number) => {
		for (let seq = 1; seq <= count; seq++) {
			await prisma.chatMessage.create({
				data: {
					chatId: chatObjectId,
					spaceId,
					creatorId: owner,
					seq: BigInt(seq),
					orderId: orderId(seq),
					content: { text: `m${seq}`, style: 0, marks: [] },
					attachments: [],
					blocks: [],
					reactions: {},
					createdAt: BigInt(1_700_000_000 + seq),
					modifiedAt: BigInt(1_700_000_000 + seq),
				},
			});
		}
	};

	const counter = async (chatObjectId: string, as: string) => {
		signInAs(as);
		const body = await (
			await post("/api/command/ChatSubscribeLastMessages", {
				chatObjectId,
				limit: 50,
				subId: "chat-x",
			})
		).json();
		return body.chatState.messages.counter as number;
	};

	const readAll = async (as: string) => {
		signInAs(as);
		return (await post("/api/command/ChatReadAll", {})).json();
	};

	it("clears the caller's unread across every chat in their spaces", async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "ReadAll space" },
				useCase: 2,
			})
		).json();
		const chatA = await makeChat(spaceId as string, "Chat A");
		const chatB = await makeChat(spaceId as string, "Chat B");
		await seed(chatA, spaceId as string, 3);
		await seed(chatB, spaceId as string, 2);
		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		expect(await counter(chatA, reader)).toBe(3);
		expect(await counter(chatB, reader)).toBe(2);

		const body = await readAll(reader);
		expect(body.error).toEqual({ code: 0, description: "" });

		expect(await counter(chatA, reader)).toBe(0);
		expect(await counter(chatB, reader)).toBe(0);
	});

	it("leaves another member's unread state untouched", async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "ReadAll isolation space" },
				useCase: 2,
			})
		).json();
		const chat = await makeChat(spaceId as string, "Shared chat");
		await seed(chat, spaceId as string, 4);
		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		// The owner clears their own badges; the reader's unread must survive.
		await readAll(owner);

		expect(await counter(chat, reader)).toBe(4);
		expect(await counter(chat, owner)).toBe(0);
	});

	it("is a safe no-op for a member with no chats", async () => {
		const body = await readAll(loner);
		expect(body.error).toEqual({ code: 0, description: "" });
	});
});
