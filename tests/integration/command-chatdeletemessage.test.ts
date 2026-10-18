import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatDeleteMessage soft-deletes a message (command.ts:1999): { chatObjectId, messageId } ->
// deleted=true so it drops out of every read path, plus a ChatDelete event { id, subIds } the
// dispatcher uses to remove it from the live lists (dispatcher.ts:1387). Anytype lets a member
// delete their OWN message; a space admin/owner may moderate-delete anyone's. A lesser member
// deleting another's message is refused. Unknown message -> NOT_FOUND; non-member -> FORBIDDEN.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatDeleteMessage",
	() => {
		const owner = "chat-del.owner";
		const writer = "chat-del.writer";
		const admin = "chat-del.admin";
		const outsider = "chat-del.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Del owner",
						email: "chat-del-owner@vanlife.test",
					},
					{
						id: writer,
						name: "Del writer",
						email: "chat-del-writer@vanlife.test",
					},
					{
						id: admin,
						name: "Del admin",
						email: "chat-del-admin@vanlife.test",
					},
					{
						id: outsider,
						name: "Del outsider",
						email: "chat-del-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, writer, admin, outsider] } },
			});
		});

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Chat del space" },
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

		const del = async (chatObjectId: string, messageId: string, as = owner) => {
			signInAs(as);
			return (
				await post("/api/command/ChatDeleteMessage", {
					chatObjectId,
					messageId,
				})
			).json();
		};

		it("soft-deletes the creator's own message and emits a ChatDelete event", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "delete me");

			const body = await del(chatObjectId, id);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.event.contextId).toBe(chatObjectId);
			expect(body.event.messages[0].spaceId).toBe(spaceId);
			expect(body.event.messages[0].chatDelete).toEqual({ id, subIds: [] });

			const row = await prisma.chatMessage.findUnique({ where: { id } });
			expect(row?.deleted).toBe(true);
		});

		it("drops the deleted message from a subsequent read", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "gone");
			await del(chatObjectId, id);

			signInAs(owner);
			const page = await (
				await post("/api/command/ChatGetMessages", {
					chatObjectId,
					beforeOrderId: "",
					afterOrderId: "",
					limit: 50,
					includeBoundary: false,
				})
			).json();
			expect(page.messages).toEqual([]);
		});

		it("refuses a non-creator writer", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "not yours");
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: writer,
					permission: "writer",
					status: "active",
				},
			});

			const body = await del(chatObjectId, id, writer);
			expect(body.error.code).toBe(2);
			const row = await prisma.chatMessage.findUnique({ where: { id } });
			expect(row?.deleted).toBe(false);
		});

		it("lets an admin moderate-delete another member's message", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "moderate me");
			await prisma.spaceMember.create({
				data: { spaceId, userId: admin, permission: "admin", status: "active" },
			});

			const body = await del(chatObjectId, id, admin);
			expect(body.error).toEqual({ code: 0, description: "" });
			const row = await prisma.chatMessage.findUnique({ where: { id } });
			expect(row?.deleted).toBe(true);
		});

		it("answers NOT_FOUND for an unknown message", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, "here");

			const body = await del(chatObjectId, "chat-del.ghost");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "secret");

			const body = await del(chatObjectId, id, outsider);
			expect(body.error.code).toBe(2);
		});
	},
);
