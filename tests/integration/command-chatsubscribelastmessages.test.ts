import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatSubscribeLastMessages is the chat block's initial load: { chatObjectId, limit, subId }
// (command.ts:2044). The client reads the snapshot straight off the envelope —
// response.messages (mapped From.ChatMessage) and response.chatState (From.ChatState, null when
// absent) (response.ts:764) — not a subscription registry, so the subId only names the client-side
// cache. It must return the LAST `limit` messages in ascending orderId order (block/chat.tsx:376
// seeds the window), gated at reader access.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatSubscribeLastMessages",
	() => {
		const owner = "chat-sub.owner";
		const reader = "chat-sub.reader";
		const outsider = "chat-sub.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Sub owner",
						email: "chat-sub-owner@vanlife.test",
					},
					{
						id: reader,
						name: "Sub reader",
						email: "chat-sub-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "Sub outsider",
						email: "chat-sub-outsider@vanlife.test",
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
					details: { name: "Chat sub space" },
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

		const seed = async (
			chatObjectId: string,
			spaceId: string,
			texts: string[],
		) => {
			for (let i = 0; i < texts.length; i++) {
				const seq = BigInt(i + 1);
				await prisma.chatMessage.create({
					data: {
						chatId: chatObjectId,
						spaceId,
						creatorId: owner,
						seq,
						orderId: seq.toString().padStart(12, "0"),
						content: { text: texts[i], style: 0, marks: [] },
						attachments: [],
						blocks: [],
						reactions: {},
						createdAt: BigInt(1_700_000_000 + i),
						modifiedAt: BigInt(1_700_000_000 + i),
					},
				});
			}
		};

		const subscribe = async (
			chatObjectId: string,
			params: Record<string, unknown>,
			as = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatSubscribeLastMessages", {
					chatObjectId,
					...params,
				})
			).json();
		};

		const texts = (body: any) => body.messages.map((m: any) => m.message.text);

		it("returns the last N messages ascending in the wire shape", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, [
				"one",
				"two",
				"three",
				"four",
				"five",
			]);

			const body = await subscribe(chatObjectId, { limit: 2, subId: "chat-x" });
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(texts(body)).toEqual(["four", "five"]);
			expect(body.messages[0].creator).toBe(
				`_participant_${spaceId.replace(/\./g, "_")}_${owner}`,
			);
			expect(body.messages[0].createdAt).toBe(1_700_000_003);
		});

		it("returns a defined chatState alongside the snapshot", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, ["only"]);

			const body = await subscribe(chatObjectId, { limit: 1, subId: "chat-x" });
			expect(body.chatState).toBeDefined();
			expect(body.chatState.messages).toBeDefined();
			expect(body.chatState.mentions).toBeDefined();
		});

		it("returns an empty snapshot for a chat with no messages", async () => {
			const { chatObjectId } = await provision();

			const body = await subscribe(chatObjectId, {
				limit: 20,
				subId: "chat-x",
			});
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.messages).toEqual([]);
		});

		it("lets a reader load the snapshot", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, ["one", "two", "three"]);
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: reader,
					permission: "reader",
					status: "active",
				},
			});

			const body = await subscribe(
				chatObjectId,
				{ limit: 50, subId: "chat-x" },
				reader,
			);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(texts(body)).toEqual(["one", "two", "three"]);
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, ["one"]);

			const body = await subscribe(
				chatObjectId,
				{ limit: 50, subId: "chat-x" },
				outsider,
			);
			expect(body.error.code).toBe(2);
		});

		it("answers NOT_FOUND for an unknown chat object", async () => {
			await provision();

			const body = await subscribe("chat-sub.does-not-exist", {
				limit: 50,
				subId: "chat-x",
			});
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});
	},
);
