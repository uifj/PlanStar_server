import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatSubscribeToMessagePreviews { subId } (command.ts:2052, fired once for J.Constant.subId.chatSpace
// in util/data.ts:508) seeds the space chat list: one preview per chat the caller is an active member
// of, carrying that chat's newest live message plus the caller's unread projection. The client maps each
// through From.ChatPreview (mapper.ts:868) to { spaceId, chatId, message, state, dependencies } and adds
// the message at index 0 of both the space sub-list and the chat's own preview sub-list. It is scoped to
// the caller's own memberships (no space arg), so it never leaks another member's private chats. Each
// test uses its own caller so the returned preview set is exactly the chats that test seeds.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatSubscribeToMessagePreviews",
	() => {
		const owner = "chat-prev.owner";
		const listMember = "chat-prev.list";
		const orderMember = "chat-prev.order";
		const deletedMember = "chat-prev.deleted";
		const outsider = "chat-prev.outsider";
		const members = [listMember, orderMember, deletedMember, outsider];

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Previews owner",
						email: "chat-prev-owner@vanlife.test",
					},
					{
						id: listMember,
						name: "Previews list member",
						email: "chat-prev-list@vanlife.test",
					},
					{
						id: orderMember,
						name: "Previews order member",
						email: "chat-prev-order@vanlife.test",
					},
					{
						id: deletedMember,
						name: "Previews deleted member",
						email: "chat-prev-deleted@vanlife.test",
					},
					{
						id: outsider,
						name: "Previews outsider",
						email: "chat-prev-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, ...members] } },
			});
		});

		const orderId = (seq: number) => BigInt(seq).toString().padStart(12, "0");

		const makeChat = async (spaceId: string, name: string) => {
			const { objectId } = await (
				await post("/api/command/ObjectCreate", { spaceId, details: { name } })
			).json();
			return objectId as string;
		};

		const seed = async (
			chatObjectId: string,
			spaceId: string,
			count: number,
			base = 1_700_000_000,
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
						createdAt: BigInt(base + seq),
						modifiedAt: BigInt(base + seq),
					},
				});
			}
		};

		const makeSpace = async (name: string) => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const enrol = async (spaceId: string, userId: string) => {
			await prisma.spaceMember.create({
				data: { spaceId, userId, permission: "reader", status: "active" },
			});
		};

		const previews = async (as: string) => {
			signInAs(as);
			return (
				await post("/api/command/ChatSubscribeToMessagePreviews", {
					subId: "chatSpace",
				})
			).json();
		};

		const byChat = (list: any[], chatObjectId: string) =>
			list.find((p) => p.chatObjectId === chatObjectId);

		it("returns a preview per chat with its newest message and the caller's unread state", async () => {
			const spaceId = await makeSpace("Previews list space");
			const chatA = await makeChat(spaceId, "Chat A");
			const chatB = await makeChat(spaceId, "Chat B");
			await seed(chatA, spaceId, 3);
			await seed(chatB, spaceId, 2);
			await enrol(spaceId, listMember);

			const body = await previews(listMember);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.previews).toHaveLength(2);

			const a = byChat(body.previews, chatA);
			expect(a.spaceId).toBe(spaceId);
			expect(a.message.orderId).toBe(orderId(3));
			expect(a.message.message.text).toBe("m3");
			expect(a.state.messages.counter).toBe(3);
			expect(a.dependencies).toEqual([]);

			const b = byChat(body.previews, chatB);
			expect(b.message.orderId).toBe(orderId(2));
			expect(b.state.messages.counter).toBe(2);
		});

		it("orders previews by most recent message first", async () => {
			const spaceId = await makeSpace("Previews order space");
			const older = await makeChat(spaceId, "Older");
			const newer = await makeChat(spaceId, "Newer");
			await seed(older, spaceId, 2, 1_700_000_000);
			await seed(newer, spaceId, 2, 1_700_500_000);
			await enrol(spaceId, orderMember);

			const body = await previews(orderMember);
			expect(body.previews.map((p: any) => p.chatObjectId)).toEqual([
				newer,
				older,
			]);
		});

		it("skips soft-deleted messages when picking the preview", async () => {
			const spaceId = await makeSpace("Previews deleted space");
			const chat = await makeChat(spaceId, "Chat");
			await seed(chat, spaceId, 3);
			await prisma.chatMessage.updateMany({
				where: { chatId: chat, orderId: orderId(3) },
				data: { deleted: true },
			});
			await enrol(spaceId, deletedMember);

			const body = await previews(deletedMember);
			const preview = byChat(body.previews, chat);
			expect(preview.message.orderId).toBe(orderId(2));
			// The deleted message is not counted as unread either.
			expect(preview.state.messages.counter).toBe(2);
		});

		it("excludes chats in spaces the caller is not an active member of", async () => {
			const spaceId = await makeSpace("Previews private space");
			const chat = await makeChat(spaceId, "Private chat");
			await seed(chat, spaceId, 2);

			const body = await previews(outsider);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(byChat(body.previews, chat)).toBeUndefined();
		});

		it("returns an empty list for a member with no chats", async () => {
			const body = await previews(outsider);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.previews).toEqual([]);
		});
	},
);
