import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatToggleMessageReaction adds or removes the caller's reaction (command.ts:1991): { chatObjectId,
// messageId, emoji }. Reactions are stored in the wire shape From.ChatMessageReaction reads —
// { reactions: { [emoji]: { ids: participantId[] } } } (mapper.ts:969) — and the caller is identified
// by their participant id. Toggling twice removes it; an emoji left with no ids drops out of the map.
// A ChatUpdateReactions event { id, reactions, subIds } pushes the new map to the live lists
// (dispatcher.ts:1401). Any member may react to any message (writer floor); unknown -> NOT_FOUND.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatToggleMessageReaction",
	() => {
		const owner = "chat-react.owner";
		const member = "chat-react.member";
		const other = "chat-react.other";
		const outsider = "chat-react.outsider";

		const pid = (spaceId: string, userId: string) =>
			`_participant_${spaceId.replace(/\./g, "_")}_${userId}`;

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "React owner",
						email: "chat-react-owner@vanlife.test",
					},
					{
						id: member,
						name: "React member",
						email: "chat-react-member@vanlife.test",
					},
					{
						id: other,
						name: "React other",
						email: "chat-react-other@vanlife.test",
					},
					{
						id: outsider,
						name: "React outsider",
						email: "chat-react-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, member, other, outsider] } },
			});
		});

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Chat react space" },
					useCase: 2,
				})
			).json();
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Chat object" },
				})
			).json();
			for (const userId of [member, other]) {
				await prisma.spaceMember.create({
					data: {
						spaceId: spaceId as string,
						userId,
						permission: "writer",
						status: "active",
					},
				});
			}
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

		const toggle = async (
			chatObjectId: string,
			messageId: string,
			emoji: string,
			as = member,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatToggleMessageReaction", {
					chatObjectId,
					messageId,
					emoji,
				})
			).json();
		};

		const storedReactions = async (id: string) => {
			const row = await prisma.chatMessage.findUnique({ where: { id } });
			return row?.reactions;
		};

		it("adds the caller's reaction and emits a ChatUpdateReactions event", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "react to me");

			const body = await toggle(chatObjectId, id, "👍");
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.event.contextId).toBe(chatObjectId);
			expect(body.event.messages[0].spaceId).toBe(spaceId);
			expect(body.event.messages[0].chatUpdateReactions.id).toBe(id);
			expect(body.event.messages[0].chatUpdateReactions.reactions).toEqual({
				reactions: { "👍": { ids: [pid(spaceId, member)] } },
			});
			expect(body.event.messages[0].chatUpdateReactions.subIds).toEqual([]);

			expect(await storedReactions(id)).toEqual({
				reactions: { "👍": { ids: [pid(spaceId, member)] } },
			});
		});

		it("removes the caller's reaction on a second toggle, dropping the empty emoji", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "react to me");
			await toggle(chatObjectId, id, "👍");

			const body = await toggle(chatObjectId, id, "👍");
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.event.messages[0].chatUpdateReactions.reactions).toEqual({
				reactions: {},
			});
			expect(await storedReactions(id)).toEqual({ reactions: {} });
		});

		it("keeps distinct reactors under the same emoji", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "react to me");
			await toggle(chatObjectId, id, "🎉", member);
			await toggle(chatObjectId, id, "🎉", other);

			const reactions: any = await storedReactions(id);
			expect(reactions.reactions["🎉"].ids.sort()).toEqual(
				[pid(spaceId, member), pid(spaceId, other)].sort(),
			);
		});

		it("keeps distinct emojis independent", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "react to me");
			await toggle(chatObjectId, id, "👍", member);
			await toggle(chatObjectId, id, "❤️", member);

			const reactions: any = await storedReactions(id);
			expect(Object.keys(reactions.reactions).sort()).toEqual(
				["❤️", "👍"].sort(),
			);
		});

		it("answers NOT_FOUND for an unknown message", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, "here");

			const body = await toggle(chatObjectId, "chat-react.ghost", "👍");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			const id = await seed(chatObjectId, spaceId, "secret");

			const body = await toggle(chatObjectId, id, "👍", outsider);
			expect(body.error.code).toBe(2);
		});
	},
);
