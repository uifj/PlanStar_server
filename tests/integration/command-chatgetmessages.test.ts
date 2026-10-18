import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatGetMessages pages a chat's history. The client loads older messages with
// { beforeOrderId: oldestLoaded, afterOrderId: '', includeBoundary: false } and newer with
// { beforeOrderId: '', afterOrderId: newestLoaded, includeBoundary: false } (block/chat.tsx:467-500);
// a jump-to-message fetches the window ending at the target with includeBoundary true, then the
// messages after it with includeBoundary false (chat.tsx:663-676). Response is { messages, chatState }
// (response.ts:751), messages ordered ascending by orderId in the wire shape From.ChatMessage reads.
describe.skipIf(!databaseAvailable)("POST /api/command/ChatGetMessages", () => {
	const owner = "chat-get.owner";
	const reader = "chat-get.reader";
	const outsider = "chat-get.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{ id: owner, name: "Get owner", email: "chat-get-owner@vanlife.test" },
				{
					id: reader,
					name: "Get reader",
					email: "chat-get-reader@vanlife.test",
				},
				{
					id: outsider,
					name: "Get outsider",
					email: "chat-get-outsider@vanlife.test",
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
				details: { name: "Chat get space" },
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

	// Seed n messages with explicit, evenly spaced orderIds so pagination boundaries are precise.
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

	const getMessages = async (
		chatObjectId: string,
		params: Record<string, unknown>,
		as = owner,
	) => {
		signInAs(as);
		return (
			await post("/api/command/ChatGetMessages", { chatObjectId, ...params })
		).json();
	};

	it("returns the chat's messages ascending in the wire shape", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, ["one", "two", "three"]);

		const body = await getMessages(chatObjectId, {
			beforeOrderId: "",
			afterOrderId: "",
			limit: 50,
			includeBoundary: false,
		});
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.messages.map((m: any) => m.message.text)).toEqual([
			"one",
			"two",
			"three",
		]);
		expect(body.messages[0].creator).toBe(
			`_participant_${spaceId.replace(/\./g, "_")}_${owner}`,
		);
		expect(body.messages[0].createdAt).toBe(1_700_000_000);
	});

	const FIVE = ["one", "two", "three", "four", "five"];
	const texts = (body: any) => body.messages.map((m: any) => m.message.text);

	it("loads the older page before a cursor, excluding the boundary", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, FIVE);

		// Older than "four" (orderId 000000000004), newest two of them.
		const body = await getMessages(chatObjectId, {
			beforeOrderId: "000000000004",
			afterOrderId: "",
			limit: 2,
			includeBoundary: false,
		});
		expect(texts(body)).toEqual(["two", "three"]);
	});

	it("includes the boundary message when includeBoundary is true", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, FIVE);

		const body = await getMessages(chatObjectId, {
			beforeOrderId: "000000000004",
			afterOrderId: "",
			limit: 2,
			includeBoundary: true,
		});
		expect(texts(body)).toEqual(["three", "four"]);
	});

	it("loads the newer page after a cursor, excluding the boundary", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, FIVE);

		// Newer than "two" (orderId 000000000002), oldest two of them.
		const body = await getMessages(chatObjectId, {
			beforeOrderId: "",
			afterOrderId: "000000000002",
			limit: 2,
			includeBoundary: false,
		});
		expect(texts(body)).toEqual(["three", "four"]);
	});

	it("returns the latest window, capped at limit, with no cursor", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, FIVE);

		const body = await getMessages(chatObjectId, {
			beforeOrderId: "",
			afterOrderId: "",
			limit: 2,
			includeBoundary: false,
		});
		expect(texts(body)).toEqual(["four", "five"]);
	});

	it("lets a reader read the history", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, FIVE);
		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		const body = await getMessages(
			chatObjectId,
			{
				beforeOrderId: "",
				afterOrderId: "",
				limit: 50,
				includeBoundary: false,
			},
			reader,
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(texts(body)).toEqual(FIVE);
	});

	it("refuses a non-member", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, FIVE);

		const body = await getMessages(
			chatObjectId,
			{
				beforeOrderId: "",
				afterOrderId: "",
				limit: 50,
				includeBoundary: false,
			},
			outsider,
		);
		expect(body.error.code).toBe(2);
	});

	it("answers NOT_FOUND for an unknown chat object", async () => {
		await provision();

		const body = await getMessages("chat-get.does-not-exist", {
			beforeOrderId: "",
			afterOrderId: "",
			limit: 50,
			includeBoundary: false,
		});
		expect(body.error).toEqual({ code: 3, description: "Object not found." });
	});
});
