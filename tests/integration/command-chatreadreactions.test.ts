import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatReadReactions { chatObjectId, orderId } advances the caller's reaction watermark (command.ts:2033;
// block/chat.tsx:1312 fires it when the message carrying the unread reaction scrolls into view). The
// chatState.unreadReactionOrderId then projects the oldest live message above the watermark that has
// any reaction — the client uses it to show the "new reactions" jump marker. High-watermark like the
// other reads; reader-gated; answers with a ChatStateUpdate event.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ChatReadReactions",
	() => {
		const owner = "chat-rxn.owner";
		const reader = "chat-rxn.reader";
		const outsider = "chat-rxn.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Rxn owner",
						email: "chat-rxn-owner@vanlife.test",
					},
					{
						id: reader,
						name: "Rxn reader",
						email: "chat-rxn-reader@vanlife.test",
					},
					{
						id: outsider,
						name: "Rxn outsider",
						email: "chat-rxn-outsider@vanlife.test",
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
		const reactor = (spaceId: string) =>
			`_participant_${spaceId.replace(/\./g, "_")}_${owner}`;

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Chat rxn space" },
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

		// Seed `count` messages; the ones listed in `reactedSeqs` carry a reaction from the owner.
		const seed = async (
			chatObjectId: string,
			spaceId: string,
			count: number,
			reactedSeqs: number[],
		) => {
			for (let seq = 1; seq <= count; seq++) {
				const reactions = reactedSeqs.includes(seq)
					? { reactions: { "👍": { ids: [reactor(spaceId)] } } }
					: {};
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
						reactions,
						createdAt: BigInt(1_700_000_000 + seq),
						modifiedAt: BigInt(1_700_000_000 + seq),
					},
				});
			}
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

		const readReactions = async (
			chatObjectId: string,
			orderIdArg: string,
			as = reader,
		) => {
			signInAs(as);
			return (
				await post("/api/command/ChatReadReactions", {
					chatObjectId,
					orderId: orderIdArg,
				})
			).json();
		};

		it("points the unread-reaction marker at the oldest reacted message", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 4, [2, 3]);

			const before = await state(chatObjectId);
			expect(before.unreadReactionOrderId).toBe(orderId(2));
		});

		it("advances the marker past reactions the caller has now seen", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 4, [2, 3]);

			const body = await readReactions(chatObjectId, orderId(2));
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(
				body.event.messages[0].chatStateUpdate.state.unreadReactionOrderId,
			).toBe(orderId(3));

			await readReactions(chatObjectId, orderId(3));
			const after = await state(chatObjectId);
			expect(after.unreadReactionOrderId).toBe("");
		});

		it("ignores messages with no reaction", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 4, [3]);

			// Reading up to message 2 leaves the marker on 3 (the only reacted message above it).
			await readReactions(chatObjectId, orderId(2));
			const after = await state(chatObjectId);
			expect(after.unreadReactionOrderId).toBe(orderId(3));
		});

		it("never moves the reaction watermark back", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 4, [2, 3]);

			await readReactions(chatObjectId, orderId(3));
			await readReactions(chatObjectId, orderId(2));

			const after = await state(chatObjectId);
			expect(after.unreadReactionOrderId).toBe("");
		});

		it("refuses a non-member", async () => {
			const { spaceId, chatObjectId } = await provision();
			await seed(chatObjectId, spaceId, 2, [1]);

			const body = await readReactions(chatObjectId, orderId(1), outsider);
			expect(body.error.code).toBe(2);
		});

		it("answers NOT_FOUND for an unknown chat object", async () => {
			await provision();

			const body = await readReactions("chat-rxn.does-not-exist", orderId(1));
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});
	},
);
