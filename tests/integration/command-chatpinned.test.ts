import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatSetPinnedMessages flags/unflags messages as pinned (command.ts:2082): { chatObjectId,
// messageIds, pinned }, emitting one ChatUpdatePinnedStatus event { message, isPinned, subIds } per
// id (dispatcher.ts:1478). ChatGetPinnedMessages (command.ts:2090) returns the pinned set ascending
// in the wire shape (response.ts:791) for the chat block's pinned bar (block/chat.tsx:919). Pinning is
// a write (writer floor); reading the pinned bar is a read (reader floor).
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatSetPinnedMessages",
	() => {
		const owner = "chat-pin.owner";
		const reader = "chat-pin.reader";
		const outsider = "chat-pin.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Pin owner",
						email: "chat-pin-owner@vanlife.test",
					},
					{
						id: reader,
						name: "Pin reader",
						email: "chat-pin-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "Pin outsider",
						email: "chat-pin-outsider@vanlife.test",
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
					details: { name: "Chat pin space" },
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

		const setPinned = async (
			chatObjectId: string,
			messageIds: string[],
			pinned: boolean,
			as = owner,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatSetPinnedMessages", {
					chatObjectId,
					messageIds,
					pinned,
				})
			).json();
		};

		const getPinned = async (chatObjectId: string, as = owner) => {
			signInAs(as);
			return (
				await post("/api/command/ChatGetPinnedMessages", { chatObjectId })
			).json();
		};

		it("pins messages and emits a ChatUpdatePinnedStatus event per id", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a, b] = await seed(chatObjectId, spaceId, ["one", "two"]);

			const body = await setPinned(chatObjectId, [a, b], true);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.event.contextId).toBe(chatObjectId);
			const updates = body.event.messages.map(
				(m: any) => m.chatUpdatePinnedStatus,
			);
			expect(updates).toHaveLength(2);
			expect(updates.every((u: any) => u.isPinned === true)).toBe(true);
			expect(updates.map((u: any) => u.message.id).sort()).toEqual(
				[a, b].sort(),
			);
			expect(updates[0].subIds).toEqual([]);

			const rows = await prisma.chatMessage.findMany({
				where: { id: { in: [a, b] } },
			});
			expect(rows.every((r) => r.pinned)).toBe(true);
		});

		it("returns the pinned set ascending from ChatGetPinnedMessages", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a, b, c] = await seed(chatObjectId, spaceId, [
				"one",
				"two",
				"three",
			]);
			await setPinned(chatObjectId, [c, a], true);

			const body = await getPinned(chatObjectId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.messages.map((m: any) => m.message.text)).toEqual([
				"one",
				"three",
			]);
			expect(body.messages.every((m: any) => m.pinned)).toBe(true);
			expect(b).toBeTruthy();
		});

		it("unpins on pinned:false so the message leaves the pinned set", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a] = await seed(chatObjectId, spaceId, ["one"]);
			await setPinned(chatObjectId, [a], true);

			const body = await setPinned(chatObjectId, [a], false);
			expect(body.event.messages[0].chatUpdatePinnedStatus.isPinned).toBe(
				false,
			);

			const pinned = await getPinned(chatObjectId);
			expect(pinned.messages).toEqual([]);
		});

		it("lets a reader read the pinned bar but not change it", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a] = await seed(chatObjectId, spaceId, ["one"]);
			await setPinned(chatObjectId, [a], true);
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: reader,
					permission: "reader",
					status: "active",
				},
			});

			const read = await getPinned(chatObjectId, reader);
			expect(read.error).toEqual({ code: 0, description: "" });
			expect(read.messages.map((m: any) => m.id)).toEqual([a]);

			const write = await setPinned(chatObjectId, [a], false, reader);
			expect(write.error.code).toBe(2);
		});

		it("refuses a non-member on both commands", async () => {
			const { spaceId, chatObjectId } = await provision();
			const [a] = await seed(chatObjectId, spaceId, ["one"]);

			expect(
				(await setPinned(chatObjectId, [a], true, outsider)).error.code,
			).toBe(2);
			expect((await getPinned(chatObjectId, outsider)).error.code).toBe(2);
		});

		it("answers NOT_FOUND for an unknown chat object", async () => {
			await provision();

			expect((await setPinned("chat-pin.ghost", ["x"], true)).error).toEqual({
				code: 3,
				description: "Object not found.",
			});
			expect((await getPinned("chat-pin.ghost")).error).toEqual({
				code: 3,
				description: "Object not found.",
			});
		});
	},
);
