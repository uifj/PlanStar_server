import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The space's Chat page (component/page/main/chat.tsx → block/chat.tsx) resolves the chat it reads
// with `object.chatId || rootId`, where `object` is the space view. A space view with no chatId
// therefore points the page at the space view's own id, which is not a chat: every read answered
// NOT_FOUND and the page kept only its composer. A space boots with a chat object of its own, named
// by the space view, so the page has something to read and write.
describe.skipIf(!databaseAvailable)("space chat", () => {
	const owner = "spacechat.owner";
	const reader = "spacechat.reader";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Chat owner",
					email: "spacechat-owner@vanlife.test",
				},
				{
					id: reader,
					name: "Chat reader",
					email: "spacechat-reader@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({ where: { id: { in: [owner, reader] } } });
	});

	const createSpace = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Chatting space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	// The space view record the client's global `space` subscription carries.
	const spaceView = async (spaceId: string) => {
		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectSearchSubscribe", { subId: "space" })
		).json();
		return (body.records as any[]).find((it) => it.targetSpaceId === spaceId);
	};

	const wireMessage = (text: string) => ({
		id: "",
		orderId: "",
		creator: "",
		createdAt: 0,
		modifiedAt: 0,
		replyToMessageId: "",
		message: { text, style: 0, marks: [] },
		attachments: [],
		reactions: {},
		blocks: [],
		pinned: false,
	});

	it("names a chat object the client can open", async () => {
		const spaceId = await createSpace();
		const view = await spaceView(spaceId);

		expect(typeof view.chatId).toBe("string");
		expect(view.chatId.length).toBeGreaterThan(0);

		signInAs(owner);
		const opened = await (
			await post("/api/command/ObjectOpen", {
				spaceId,
				objectId: view.chatId,
			})
		).json();

		expect(opened.error).toEqual({ code: 0, description: "" });
		const detail = (opened.objectView.details as any[]).find(
			(it) => it.id === view.chatId,
		);
		expect(detail).toBeTruthy();
		// ObjectLayout.Chat === 22: isChatLayout(22) is what makes the page a chat feed.
		expect(Number(detail.details.layout)).toBe(22);
	});

	it("reads and writes the space's messages through that chat object", async () => {
		const spaceId = await createSpace();
		const { chatId } = await spaceView(spaceId);

		signInAs(owner);
		const added = await (
			await post("/api/command/ChatAddMessage", {
				chatObjectId: chatId,
				message: wireMessage("on the space chat"),
			})
		).json();
		expect(added.error).toEqual({ code: 0, description: "" });

		signInAs(owner);
		const list = await (
			await post("/api/command/ChatGetMessages", {
				spaceId,
				chatObjectId: chatId,
				limit: 10,
				offset: 0,
				direction: 0,
			})
		).json();

		expect(list.error).toEqual({ code: 0, description: "" });
		expect((list.messages as any[]).map((it) => it.id)).toContain(
			added.messageId,
		);
	});

	it("keeps the chat out of the object lists", async () => {
		const spaceId = await createSpace();
		const { chatId } = await spaceView(spaceId);

		// The chat is infrastructure, not content: the space's All-objects list and the search
		// results must not offer it as an object the user opened a chat for.
		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectSearchSubscribe", {
				spaceId,
				subId: `widget-${spaceId}-objects`,
				filters: [
					{ RelationKey: "isDeleted", format: 6, condition: 2, value: true },
					{ RelationKey: "isArchived", format: 6, condition: 2, value: true },
					{ RelationKey: "isHidden", format: 6, condition: 2, value: true },
				],
				sorts: [],
				keys: ["id", "name"],
			})
		).json();

		expect((body.records as any[]).map((it) => it.id)).not.toContain(chatId);
	});
});
