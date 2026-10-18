import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatEditMessageContent rewrites a message's body (command.ts:1983): { chatObjectId, messageId,
// editedMessage } where editedMessage is the mapped wire ChatMessage (content under `message`, plus
// attachments/blocks). The server keeps id/orderId/creator/createdAt authoritative, bumps modifiedAt,
// and emits a ChatUpdate event { id, message, subIds } the dispatcher merges into the live lists
// (dispatcher.ts:1301). Only the creator may edit their own message — unlike delete, there is no
// moderator override (you cannot rewrite someone else's words). Unknown/deleted -> NOT_FOUND.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatEditMessageContent",
	() => {
		const owner = "chat-edit.owner";
		const writer = "chat-edit.writer";
		const outsider = "chat-edit.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Edit owner",
						email: "chat-edit-owner@vanlife.test",
					},
					{
						id: writer,
						name: "Edit writer",
						email: "chat-edit-writer@vanlife.test",
					},
					{
						id: outsider,
						name: "Edit outsider",
						email: "chat-edit-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, writer, outsider] } },
			});
		});

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Chat edit space" },
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
			text: string,
		) => {
			const row = await prisma.chatMessage.create({
				data: {
					chatId: chatObjectId,
					spaceId,
					creatorId: owner,
					seq: 1n,
					orderId: "000000000001",
					content: { text, style: 0, marks: [] },
					attachments: [],
					blocks: [],
					reactions: {},
					createdAt: BigInt(1_700_000_000),
					modifiedAt: BigInt(1_700_000_000),
				},
			});
			return row.id;
		};

		// The wire editedMessage the client posts (Mapper.To.ChatMessage): only the body fields matter,
		// the server ignores any id/creator/timestamps the client echoes back.
		const editedMessage = (text: string) => ({
			id: "ignored",
			orderId: "ignored",
			creator: "ignored",
			createdAt: 999,
			modifiedAt: 999,
			replyToMessageId: "",
			message: { text, style: 0, marks: [] },
			attachments: [],
			reactions: {},
			blocks: [],
			pinned: false,
		});

		const edit = async (
			chatObjectId: string,
			messageId: string,
			text: string,
			as = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatEditMessageContent", {
					chatObjectId,
					messageId,
					editedMessage: editedMessage(text),
				})
			).json();
		};

		it("rewrites the creator's own message and emits a ChatUpdate event", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "before");

			const body = await edit(chatObjectId, id, "after");
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.event.contextId).toBe(chatObjectId);
			expect(body.event.messages[0].spaceId).toBe(spaceId);
			expect(body.event.messages[0].chatUpdate.id).toBe(id);
			expect(body.event.messages[0].chatUpdate.message.message).toEqual({
				text: "after",
				style: 0,
				marks: [],
			});
			expect(body.event.messages[0].chatUpdate.subIds).toEqual([]);
			// An edit is what turns the client's "(edited)" label on (index.tsx:261 reads any
			// non-zero modifiedAt), so the projected record must carry the new stamp.
			expect(
				body.event.messages[0].chatUpdate.message.modifiedAt,
			).toBeGreaterThan(1_700_000_000);

			const row = await prisma.chatMessage.findUnique({ where: { id } });
			expect(row?.content).toEqual({ text: "after", style: 0, marks: [] });
			expect(Number(row?.modifiedAt)).toBeGreaterThan(1_700_000_000);
			// Server-authoritative fields are untouched by the client's echoed values.
			expect(row?.orderId).toBe("000000000001");
			expect(row?.creatorId).toBe(owner);
			expect(Number(row?.createdAt)).toBe(1_700_000_000);
		});

		it("refuses a non-creator writer", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "mine");
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: writer,
					permission: "writer",
					status: "active",
				},
			});

			const body = await edit(chatObjectId, id, "hijacked", writer);
			expect(body.error.code).toBe(2);
			const row = await prisma.chatMessage.findUnique({ where: { id } });
			expect(row?.content).toEqual({ text: "mine", style: 0, marks: [] });
		});

		it("answers NOT_FOUND for an unknown message", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, "here");

			const body = await edit(chatObjectId, "chat-edit.ghost", "x");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("answers NOT_FOUND when editing a deleted message", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "doomed");
			await prisma.chatMessage.update({
				where: { id },
				data: { deleted: true },
			});

			const body = await edit(chatObjectId, id, "revive");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "secret");

			const body = await edit(chatObjectId, id, "x", outsider);
			expect(body.error.code).toBe(2);
		});
	},
);
