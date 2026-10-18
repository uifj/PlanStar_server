import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatGetMessagesByIds hydrates specific messages by id — the client uses it to resolve a reply's
// parent and a message's dependencies (command.ts:2063). { chatObjectId, messageIds } -> { messages }
// in the wire shape From.ChatMessage reads (response.ts:758), returned in the requested id order and
// skipping ids that are missing or soft-deleted. Reader-gated like the other chat reads.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatGetMessagesByIds",
	() => {
		const owner = "chat-byid.owner";
		const reader = "chat-byid.reader";
		const outsider = "chat-byid.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "ById owner",
						email: "chat-byid-owner@vanlife.test",
					},
					{
						id: reader,
						name: "ById reader",
						email: "chat-byid-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "ById outsider",
						email: "chat-byid-outsider@vanlife.test",
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
					details: { name: "Chat byid space" },
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
			const ids: string[] = [];
			for (let i = 0; i < texts.length; i++) {
				const seq = BigInt(i + 1);
				const row = await prisma.chatMessage.create({
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
				ids.push(row.id);
			}
			return ids;
		};

		const byIds = async (
			chatObjectId: string,
			messageIds: string[],
			as = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatGetMessagesByIds", {
					chatObjectId,
					messageIds,
				})
			).json();
		};

		it("returns the requested messages in the requested order", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a, b, c] = await seed(chatObjectId, spaceId, [
				"one",
				"two",
				"three",
			]);

			const body = await byIds(chatObjectId, [c, a]);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.messages.map((m: any) => m.message.text)).toEqual([
				"three",
				"one",
			]);
			expect(body.messages.map((m: any) => m.id)).toEqual([c, a]);
			expect(body.messages[0].creator).toBe(
				`_participant_${spaceId.replace(/\./g, "_")}_${owner}`,
			);
			expect(b).toBeTruthy();
		});

		it("skips unknown and soft-deleted ids", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a, b] = await seed(chatObjectId, spaceId, ["one", "two"]);
			await prisma.chatMessage.update({
				where: { id: b },
				data: { deleted: true },
			});

			const body = await byIds(chatObjectId, [a, b, "chat-byid.ghost"]);
			expect(body.messages.map((m: any) => m.id)).toEqual([a]);
		});

		it("returns an empty list for an empty id set", async () => {
			const { chatObjectId } = await provision();

			const body = await byIds(chatObjectId, []);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.messages).toEqual([]);
		});

		it("lets a reader hydrate messages", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a] = await seed(chatObjectId, spaceId, ["one"]);
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: reader,
					permission: "reader",
					status: "active",
				},
			});

			const body = await byIds(chatObjectId, [a], reader);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.messages.map((m: any) => m.id)).toEqual([a]);
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a] = await seed(chatObjectId, spaceId, ["one"]);

			const body = await byIds(chatObjectId, [a], outsider);
			expect(body.error.code).toBe(2);
		});

		it("answers NOT_FOUND for an unknown chat object", async () => {
			await provision();

			const body = await byIds("chat-byid.does-not-exist", ["x"]);
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});
	},
);
