import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatUnreadMessages { chatObjectId, afterOrderId } is the inverse of ChatReadMessages: it moves the
// caller's message watermark back so afterOrderId and everything newer counts as unread again (the
// "mark unread from here" action). The watermark becomes the newest live message strictly before
// afterOrderId; with none, the whole chat is unread. Like the read commands it answers with a
// ChatStateUpdate event and is reader-gated.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatUnreadMessages",
	() => {
		const owner = "chat-unread.owner";
		const reader = "chat-unread.reader";
		const outsider = "chat-unread.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Unread owner",
						email: "chat-unread-owner@vanlife.test",
					},
					{
						id: reader,
						name: "Unread reader",
						email: "chat-unread-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "Unread outsider",
						email: "chat-unread-outsider@vanlife.test",
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

		const orderId = (seq: number) => BigInt(seq).toString().padStart(12, "0");

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Chat unread space" },
					useCase: 2,
				})
			).json();
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Chat object" },
				})
			).json();
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: reader,
					permission: "reader",
					status: "active",
				},
			});
			return { spaceId: spaceId as string, chatObjectId: objectId as string };
		};

		const seed = async (
			chatObjectId: string,
			spaceId: string,
			count: number,
		) => {
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

		const readAll = async (chatObjectId: string, count: number) => {
			signInAs(reader);
			await post("/api/command/ChatReadMessages", {
				chatObjectId,
				afterOrderId: orderId(1),
				beforeOrderId: orderId(count),
				lastStateId: "",
				type: 0,
			});
		};

		const state = async (chatObjectId: string) => {
			signInAs(reader);
			const body = await (
				await post("/api/command/ChatSubscribeLastMessages", {
					chatObjectId,
					limit: 50,
					subId: "chat-x",
				})
			).json();
			return body.chatState;
		};

		const unread = async (
			chatObjectId: string,
			afterOrderId: string,
			as = reader,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatUnreadMessages", {
					chatObjectId,
					afterOrderId,
				})
			).json();
		};

		it("marks the cursor and everything newer unread again", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 5);
			await readAll(chatObjectId, 5);
			expect((await state(chatObjectId)).messages.counter).toBe(0);

			const body = await unread(chatObjectId, orderId(3));
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(
				body.event.messages[0].chatStateUpdate.state.messages.counter,
			).toBe(3);

			const after = await state(chatObjectId);
			expect(after.messages.counter).toBe(3);
			expect(after.messages.oldestOrderId).toBe(orderId(3));
		});

		it("unreads the whole chat from the first message", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 4);
			await readAll(chatObjectId, 4);

			await unread(chatObjectId, orderId(1));

			const after = await state(chatObjectId);
			expect(after.messages.counter).toBe(4);
			expect(after.messages.oldestOrderId).toBe(orderId(1));
		});

		it("leaves nothing unread when the cursor is past the newest message", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 3);
			await readAll(chatObjectId, 3);

			await unread(chatObjectId, orderId(9));

			const after = await state(chatObjectId);
			expect(after.messages.counter).toBe(0);
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 2);

			const body = await unread(chatObjectId, orderId(1), outsider);
			expect(body.error.code).toBe(2);
		});

		it("answers NOT_FOUND for an unknown chat object", async () => {
			await provision();

			const body = await unread("chat-unread.does-not-exist", orderId(1));
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});
	},
);
