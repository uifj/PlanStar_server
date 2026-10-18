import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatReadMessages { chatObjectId, beforeOrderId, afterOrderId, lastStateId, type } advances the
// caller's per-type read watermark to beforeOrderId (a high-watermark: reading is irreversible and
// never moves back — block/chat.tsx:286, 1266, 1307). type is I.ChatReadType (Message=0, Mention=1).
// The command answers with a ChatStateUpdate event whose state (wire shape, From.ChatState at
// mapper.ts:858) carries the recomputed unread counters, and the next ChatSubscribeLastMessages
// reflects them. Unread messages = live messages with orderId > the watermark; the counter and
// oldestOrderId drive the client's "N unread" badge and jump-to-first-unread divider.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatReadMessages",
	() => {
		const owner = "chat-read.owner";
		const reader = "chat-read.reader";
		const outsider = "chat-read.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Read owner",
						email: "chat-read-owner@vanlife.test",
					},
					{
						id: reader,
						name: "Read reader",
						email: "chat-read-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "Read outsider",
						email: "chat-read-outsider@vanlife.test",
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
					details: { name: "Chat read space" },
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
			mentionAt = 0,
		) => {
			for (let seq = 1; seq <= count; seq++) {
				const marks =
					seq === mentionAt
						? [
								{
									range: { from: 0, to: 4 },
									type: 8,
									param: `_participant_${spaceId.replace(/\./g, "_")}_${reader}`,
								},
							]
						: [];
				await prisma.chatMessage.create({
					data: {
						chatId: chatObjectId,
						spaceId,
						creatorId: owner,
						seq: BigInt(seq),
						orderId: orderId(seq),
						content: { text: `m${seq}`, style: 0, marks },
						attachments: [],
						blocks: [],
						reactions: {},
						createdAt: BigInt(1_700_000_000 + seq),
						modifiedAt: BigInt(1_700_000_000 + seq),
					},
				});
			}
		};

		const subscribeState = async (chatObjectId: string, as = reader) => {
			signInAs(as);
			const body = await (
				await post("/api/command/ChatSubscribeLastMessages", {
					chatObjectId,
					limit: 50,
					subId: "chat-x",
				})
			).json();
			return body.chatState;
		};

		const read = async (
			chatObjectId: string,
			params: Record<string, unknown>,
			as = reader,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatReadMessages", { chatObjectId, ...params })
			).json();
		};

		it("reports every message unread before anything is read", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 5);

			const state = await subscribeState(chatObjectId);
			expect(state.messages.counter).toBe(5);
			expect(state.messages.oldestOrderId).toBe(orderId(1));
		});

		it("clears the unread counter when read to the newest and emits the new state", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 5);

			const body = await read(chatObjectId, {
				afterOrderId: orderId(1),
				beforeOrderId: orderId(5),
				lastStateId: "",
				type: 0,
			});
			expect(body.error).toEqual({ code: 0, description: "" });

			const event = body.event.messages[0].chatStateUpdate;
			expect(event.state.messages.counter).toBe(0);
			expect(event.state.messages.oldestOrderId).toBe("");

			const after = await subscribeState(chatObjectId);
			expect(after.messages.counter).toBe(0);
		});

		it("leaves the newer messages unread on a partial read", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 5);

			await read(chatObjectId, {
				afterOrderId: orderId(1),
				beforeOrderId: orderId(3),
				lastStateId: "",
				type: 0,
			});

			const state = await subscribeState(chatObjectId);
			expect(state.messages.counter).toBe(2);
			expect(state.messages.oldestOrderId).toBe(orderId(4));
		});

		it("never moves the watermark back when an older window is read", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 5);

			await read(chatObjectId, {
				afterOrderId: orderId(1),
				beforeOrderId: orderId(5),
				lastStateId: "",
				type: 0,
			});
			await read(chatObjectId, {
				afterOrderId: orderId(1),
				beforeOrderId: orderId(2),
				lastStateId: "",
				type: 0,
			});

			const state = await subscribeState(chatObjectId);
			expect(state.messages.counter).toBe(0);
		});

		it("counts only messages that mention the caller, and reads them separately", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 5, 2);

			const before = await subscribeState(chatObjectId);
			expect(before.mentions.counter).toBe(1);
			expect(before.mentions.oldestOrderId).toBe(orderId(2));
			// A mention read does not touch the message watermark.
			expect(before.messages.counter).toBe(5);

			await read(chatObjectId, {
				afterOrderId: orderId(2),
				beforeOrderId: orderId(2),
				lastStateId: "",
				type: 1,
			});

			const after = await subscribeState(chatObjectId);
			expect(after.mentions.counter).toBe(0);
			expect(after.messages.counter).toBe(5);
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 2);

			const body = await read(
				chatObjectId,
				{
					afterOrderId: orderId(1),
					beforeOrderId: orderId(2),
					lastStateId: "",
					type: 0,
				},
				outsider,
			);
			expect(body.error.code).toBe(2);
		});

		it("answers NOT_FOUND for an unknown chat object", async () => {
			await provision();

			const body = await read("chat-read.does-not-exist", {
				afterOrderId: orderId(1),
				beforeOrderId: orderId(2),
				lastStateId: "",
				type: 0,
			});
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});
	},
);
