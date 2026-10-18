import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ChatSearch is the in-chat full-text search (command.ts:2070): { spaceId, chatId, fullText, offset,
// limit, sorts, creators } -> { results } where each result is a ChatSearchResult wire record
// (response.ts:785, From.ChatSearchResult mapper.ts:980 reads spaceId/chatId/messageId/score/
// highlight/highlightRanges/message). Matches are case-insensitive over the stored body text, scoped
// to one chat, newest-first, paginated by offset/limit, and optionally narrowed to specific creators
// (participant ids). Reader floor; an unknown chat answers NOT_FOUND.
describe.skipIf(!databaseAvailable)("POST /api/command/ChatSearch", () => {
	const owner = "chat-search.owner";
	const member = "chat-search.member";
	const reader = "chat-search.reader";
	const outsider = "chat-search.outsider";

	const pid = (spaceId: string, userId: string) =>
		`_participant_${spaceId.replace(/\./g, "_")}_${userId}`;

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: owner,
					name: "Search owner",
					email: "chat-search-owner@vanlife.test",
				},
				{
					id: member,
					name: "Search member",
					email: "chat-search-member@vanlife.test",
				},
				{
					id: reader,
					name: "Search reader",
					email: "chat-search-reader@vanlife.test",
				},
				{
					id: outsider,
					name: "Search outsider",
					email: "chat-search-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({
			where: { id: { in: [owner, member, reader, outsider] } },
		});
	});

	const provision = async () => {
		signInAs(owner);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Chat search space" },
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
				spaceId: spaceId as string,
				userId: member,
				permission: "writer",
				status: "active",
			},
		});
		return { spaceId: spaceId as string, chatObjectId: objectId as string };
	};

	// Seed messages with a chosen creator so the creators filter is exercised.
	const seed = async (
		chatObjectId: string,
		spaceId: string,
		rows: { text: string; creatorId: string }[],
	) => {
		const ids: string[] = [];
		for (let i = 0; i < rows.length; i++) {
			const seq = BigInt(i + 1);
			const row = await prisma.chatMessage.create({
				data: {
					chatId: chatObjectId,
					spaceId,
					creatorId: rows[i].creatorId,
					seq,
					orderId: seq.toString().padStart(12, "0"),
					content: { text: rows[i].text, style: 0, marks: [] },
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

	const search = async (
		spaceId: string,
		chatId: string,
		params: Record<string, unknown>,
		as = owner,
	) => {
		signInAs(as);
		return (
			await post("/api/command/ChatSearch", {
				spaceId,
				chatId,
				offset: 0,
				limit: 20,
				sorts: [],
				creators: [],
				...params,
			})
		).json();
	};

	it("matches body text case-insensitively in the wire result shape", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [
			{ text: "The Quick Brown Fox", creatorId: owner },
			{ text: "nothing relevant", creatorId: owner },
		]);

		const body = await search(spaceId, chatObjectId, { fullText: "quick" });
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.results).toHaveLength(1);
		const hit = body.results[0];
		expect(hit.spaceId).toBe(spaceId);
		expect(hit.chatId).toBe(chatObjectId);
		expect(hit.messageId).toBeTruthy();
		expect(hit.message.message.text).toBe("The Quick Brown Fox");
		expect(hit.message.creator).toBe(owner);
	});

	it("returns no results when nothing matches", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [{ text: "alpha", creatorId: owner }]);

		const body = await search(spaceId, chatObjectId, { fullText: "zzz" });
		expect(body.results).toEqual([]);
	});

	it("orders newest-first and paginates by offset/limit", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [
			{ text: "match one", creatorId: owner },
			{ text: "match two", creatorId: owner },
			{ text: "match three", creatorId: owner },
		]);

		const first = await search(spaceId, chatObjectId, {
			fullText: "match",
			limit: 2,
			offset: 0,
		});
		expect(first.results.map((r: any) => r.message.message.text)).toEqual([
			"match three",
			"match two",
		]);

		const next = await search(spaceId, chatObjectId, {
			fullText: "match",
			limit: 2,
			offset: 2,
		});
		expect(next.results.map((r: any) => r.message.message.text)).toEqual([
			"match one",
		]);
	});

	it("narrows to the requested creators", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [
			{ text: "hello from owner", creatorId: owner },
			{ text: "hello from member", creatorId: member },
		]);

		// popup/search.tsx:2202 sends [getTokenIdentity(token)] — the bare ACCOUNT id, resolved from
		// a participant id by U.Space.getAccountFromParticipantId (space.ts:491).
		const body = await search(spaceId, chatObjectId, {
			fullText: "hello",
			creators: [member],
		});
		expect(body.results).toHaveLength(1);
		expect(body.results[0].message.message.text).toBe("hello from member");
	});

	it("narrows equally when the caller addresses a creator by participant id", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [
			{ text: "hello from owner", creatorId: owner },
			{ text: "hello from member", creatorId: member },
		]);

		// The object-search creator token (search.tsx:2108) pushes both forms into one filter list;
		// a chat query that carries either must narrow the same way.
		const byParticipant = await search(spaceId, chatObjectId, {
			fullText: "hello",
			creators: [pid(spaceId, member)],
		});
		expect(byParticipant.results).toHaveLength(1);
		expect(byParticipant.results[0].message.message.text).toBe(
			"hello from member",
		);

		const both = await search(spaceId, chatObjectId, {
			fullText: "hello",
			creators: [owner, pid(spaceId, member)],
		});
		expect(
			both.results
				.map((r: any) => r.message.message.text)
				.sort()
				.join(),
		).toBe("hello from member,hello from owner");
	});

	it("matches nothing for a creator outside this space", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [{ text: "hello", creatorId: owner }]);

		const body = await search(spaceId, chatObjectId, {
			fullText: "hello",
			creators: [pid("someone.else.space", owner)],
		});
		expect(body.results).toEqual([]);
	});

	it("excludes soft-deleted messages", async () => {
		const { spaceId, chatObjectId } = await provision();
		const [a] = await seed(chatObjectId, spaceId, [
			{ text: "findme", creatorId: owner },
		]);
		await prisma.chatMessage.update({
			where: { id: a },
			data: { deleted: true },
		});

		const body = await search(spaceId, chatObjectId, { fullText: "findme" });
		expect(body.results).toEqual([]);
	});

	it("lets a reader search", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [
			{ text: "reader visible", creatorId: owner },
		]);
		await prisma.spaceMember.create({
			data: { spaceId, userId: reader, permission: "reader", status: "active" },
		});

		const body = await search(
			spaceId,
			chatObjectId,
			{ fullText: "visible" },
			reader,
		);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.results).toHaveLength(1);
	});

	it("refuses a non-member", async () => {
		const { spaceId, chatObjectId } = await provision();
		await seed(chatObjectId, spaceId, [{ text: "secret", creatorId: owner }]);

		const body = await search(
			spaceId,
			chatObjectId,
			{ fullText: "secret" },
			outsider,
		);
		expect(body.error.code).toBe(2);
	});

	it("answers NOT_FOUND for an unknown chat", async () => {
		const { spaceId } = await provision();

		const body = await search(spaceId, "chat-search.ghost", { fullText: "x" });
		expect(body.error).toEqual({ code: 3, description: "Object not found." });
	});
});
