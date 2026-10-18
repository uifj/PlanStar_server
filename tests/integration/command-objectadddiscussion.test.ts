import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectAddDiscussion { objectId } -> { discussionId } (command.ts, section.tsx:619). A discussion is
// a separate chat object the parent points at through its `discussionId` detail; comment/section.tsx
// lazily mints it the first time a user opens the comment pane, then re-reads it via
// S.Detail.get(rootId, rootId, ['discussionId']). The discussionGlobal subscription (subscription.ts:533)
// filters parents by `discussionId NotEmpty`, so the link must project onto the parent's record for the
// client to resolve it. Comments are ordinary chat messages keyed by the discussionId as the chatId, so
// the returned object must be usable by the chat commands. It is idempotent (a second call returns the
// same discussion), writer-gated, and NOT_FOUND for an unknown parent.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectAddDiscussion",
	() => {
		const owner = "obj-disc.owner";
		const outsider = "obj-disc.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Discussion owner",
						email: "obj-disc-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Discussion outsider",
						email: "obj-disc-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, outsider] } },
			});
		});

		const provision = async () => {
			signInAs(owner);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Discussion space" },
					useCase: 2,
				})
			).json();
			const { objectId } = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Discussed page" },
				})
			).json();
			return { spaceId: spaceId as string, objectId: objectId as string };
		};

		const addDiscussion = async (objectId: string, as = owner) => {
			signInAs(as);
			return (
				await post("/api/command/ObjectAddDiscussion", { objectId })
			).json();
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

		it("creates a discussion chat object and returns its id", async () => {
			const { spaceId, objectId } = await provision();

			const body = await addDiscussion(objectId);
			expect(body.error).toEqual({ code: 0, description: "" });
			expect(typeof body.discussionId).toBe("string");
			expect(body.discussionId.length).toBeGreaterThan(0);
			expect(body.discussionId).not.toBe(objectId);

			const row = await prisma.obj.findUnique({
				where: { id: body.discussionId },
			});
			expect(row?.spaceId).toBe(spaceId);
			expect(row?.resolvedLayout).toBe("discussion");
		});

		it("returns a discussion usable as a chat", async () => {
			const { objectId } = await provision();
			const { discussionId } = await addDiscussion(objectId);

			signInAs(owner);
			const added = await (
				await post("/api/command/ChatAddMessage", {
					chatObjectId: discussionId,
					message: wireMessage("a comment"),
				})
			).json();
			expect(added.error).toEqual({ code: 0, description: "" });

			const last = await (
				await post("/api/command/ChatSubscribeLastMessages", {
					chatObjectId: discussionId,
					limit: 10,
				})
			).json();
			expect(last.error).toEqual({ code: 0, description: "" });
			expect(last.messages.map((m: any) => m.message.text)).toContain(
				"a comment",
			);
		});

		it("projects the discussionId onto the parent object's record", async () => {
			const { spaceId, objectId } = await provision();
			const { discussionId } = await addDiscussion(objectId);

			signInAs(owner);
			const body = await (
				await post("/api/command/ObjectSubscribeIds", {
					spaceId,
					ids: [objectId],
				})
			).json();
			expect(body.error).toEqual({ code: 0, description: "" });
			const record = body.records.find((r: any) => r.id === objectId);
			expect(record?.discussionId).toBe(discussionId);
		});

		it("is idempotent — a second call returns the same discussion", async () => {
			const { spaceId, objectId } = await provision();

			const first = await addDiscussion(objectId);
			const second = await addDiscussion(objectId);
			expect(second.discussionId).toBe(first.discussionId);

			const discussions = await prisma.obj.count({
				where: { spaceId, resolvedLayout: "discussion" },
			});
			expect(discussions).toBe(1);
		});

		it("answers NOT_FOUND for an unknown object", async () => {
			await provision();

			const body = await addDiscussion("obj-disc.does-not-exist");
			expect(body.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("refuses a non-member and leaves the parent unlinked", async () => {
			const { objectId } = await provision();

			const body = await addDiscussion(objectId, outsider);
			expect(body.error.code).toBe(2);

			const parent = await prisma.obj.findUnique({ where: { id: objectId } });
			const details = (parent?.details ?? {}) as Record<string, unknown>;
			expect(details.discussionId).toBeUndefined();
		});
	},
);
