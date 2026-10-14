import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

const databaseAvailable = await isDatabaseAvailable();

const { del, get, patch, post } = await import("./helpers/request.js");

type Json = Record<string, unknown>;

describe.skipIf(!databaseAvailable)("block documents", () => {
	let spaceId: string;
	let pageTypeId: string;

	async function createPage(name: string) {
		const page = await post(`${API_PREFIX}/spaces/${spaceId}/objects`, {
			typeId: pageTypeId,
			name,
		});
		expect(page.status).toBe(201);

		return ((await page.json()) as Json).id as string;
	}

	async function addBlock(
		objectId: string,
		text: string,
		body: Json = {},
	): Promise<Json> {
		const response = await post(`${API_PREFIX}/objects/${objectId}/blocks`, {
			type: "text",
			text,
			...body,
		});
		expect(response.status).toBe(201);

		return await response.json();
	}

	async function linkBlock(objectId: string, targetId: string) {
		const response = await post(`${API_PREFIX}/objects/${objectId}/blocks`, {
			type: "link",
			text: "a link",
			linkTargetId: targetId,
		});
		expect(response.status).toBe(201);

		return await response.json();
	}

	async function readBlocks(objectId: string) {
		const response = await get(`${API_PREFIX}/objects/${objectId}/blocks`);
		expect(response.status).toBe(200);

		return ((await response.json()) as Json).data as Json[];
	}

	async function readBacklinks(objectId: string) {
		const response = await get(`${API_PREFIX}/objects/${objectId}/backlinks`);
		expect(response.status).toBe(200);

		return ((await response.json()) as Json).data as Json[];
	}

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: "blocks.owner",
				name: "blocks.owner",
				email: "blocks.owner@vanlife.test",
			},
		});
		signInAs("blocks.owner");

		const space = await post(`${API_PREFIX}/spaces`, { name: "Block space" });
		spaceId = (await space.json()).id as string;

		const type = await post(`${API_PREFIX}/spaces/${spaceId}/object-types`, {
			uniqueKey: "page",
			name: "Page",
		});
		pageTypeId = (await type.json()).id as string;
	});

	afterEach(() => {
		// A test that signs in as someone else must not leak that into the next one.
		signInAs("blocks.owner");
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: { startsWith: "blocks." } } });
	});

	it("reads an empty document as an ordered list", async () => {
		// Arrange
		const page = await createPage("Empty page");

		// Act
		const response = await get(`${API_PREFIX}/objects/${page}/blocks`);

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: [] });
	});

	it("appends a text block to the end of the document", async () => {
		// Arrange
		const page = await createPage("Append page");

		// Act
		await addBlock(page, "Day one", { style: "heading1" });
		await addBlock(page, "We drove north.");

		// Assert
		expect(await readBlocks(page)).toEqual([
			expect.objectContaining({ style: "heading1", text: "Day one" }),
			expect.objectContaining({ style: "paragraph", text: "We drove north." }),
		]);
	});

	it("inserts a block after a chosen sibling", async () => {
		// Arrange
		const page = await createPage("Insert page");
		const first = await addBlock(page, "A");
		await addBlock(page, "C");

		// Act
		await addBlock(page, "B", { afterBlockId: first.id });

		// Assert
		expect((await readBlocks(page)).map((block) => block.text)).toEqual([
			"A",
			"B",
			"C",
		]);
	});

	it("keeps order when many blocks land in the same gap", async () => {
		// Arrange
		const page = await createPage("Squeeze page");
		await addBlock(page, "first");
		await addBlock(page, "last");
		const [anchor] = await readBlocks(page);

		// Act — each new block goes between the same two neighbours
		for (const label of ["1", "2", "3", "4", "5"]) {
			await addBlock(page, label, { afterBlockId: anchor.id });
		}

		// Assert — the newest sits right after the anchor, the tail never moved
		expect((await readBlocks(page)).map((block) => block.text)).toEqual([
			"first",
			"5",
			"4",
			"3",
			"2",
			"1",
			"last",
		]);
	});

	it("moves a block to the front of the document", async () => {
		// Arrange
		const page = await createPage("Move page");
		await addBlock(page, "A");
		await addBlock(page, "B");
		const mover = await addBlock(page, "C");

		// Act
		const response = await patch(`${API_PREFIX}/blocks/${mover.id}`, {
			afterBlockId: null,
		});

		// Assert
		expect(response.status).toBe(200);
		expect((await readBlocks(page)).map((block) => block.text)).toEqual([
			"C",
			"A",
			"B",
		]);
	});

	it("edits a block's text and style without moving it", async () => {
		// Arrange
		const page = await createPage("Edit page");
		await addBlock(page, "keeper");
		const target = await addBlock(page, "typo idnent");
		const before = (await readBlocks(page)).map((block) => block.id);

		// Act
		const response = await patch(`${API_PREFIX}/blocks/${target.id}`, {
			text: "fixed indent",
			style: "code",
		});

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: target.id,
			text: "fixed indent",
			style: "code",
		});
		expect((await readBlocks(page)).map((block) => block.id)).toEqual(before);
	});

	it("refuses an anchor that is not a block of this document", async () => {
		// Arrange
		const page = await createPage("Anchor page");
		const other = await createPage("Other page");
		const block = await addBlock(page, "A");
		const foreign = await addBlock(other, "elsewhere");

		// Act
		const response = await patch(`${API_PREFIX}/blocks/${block.id}`, {
			afterBlockId: foreign.id,
		});

		// Assert
		expect(response.status).toBe(422);
	});

	it("puts a document in the graph when a block links another object", async () => {
		// Arrange
		const page = await createPage("Linking page");
		const target = await createPage("Linked target");

		// Act
		await linkBlock(page, target);

		// Assert — the edge exists, so the backlink read finds it
		expect(await readBacklinks(target)).toEqual([
			expect.objectContaining({ id: page, name: "Linking page" }),
		]);
	});

	it("refuses a link block without a usable target", async () => {
		// Arrange
		const page = await createPage("Bad link page");

		// Act
		const noTarget = await post(`${API_PREFIX}/objects/${page}/blocks`, {
			type: "link",
		});
		const unknownTarget = await post(`${API_PREFIX}/objects/${page}/blocks`, {
			type: "link",
			linkTargetId: "no-such-object",
		});

		// Assert — a missing field is a schema failure (400), an unresolvable
		// reference is a registry failure (422)
		expect(noTarget.status).toBe(400);
		expect(unknownTarget.status).toBe(422);
	});

	it("drops the edge only when the last link block to a target is deleted", async () => {
		// Arrange
		const page = await createPage("Twice linking page");
		const target = await createPage("Twice linked target");
		const first = await linkBlock(page, target);
		const second = await linkBlock(page, target);

		// Act — one of two blocks pointing at the same target goes away
		expect((await del(`${API_PREFIX}/blocks/${first.id}`)).status).toBe(204);

		// Assert — the page still links it
		expect(await readBacklinks(target)).toEqual([
			expect.objectContaining({ id: page }),
		]);

		// Act
		expect((await del(`${API_PREFIX}/blocks/${second.id}`)).status).toBe(204);

		// Assert
		expect(await readBacklinks(target)).toEqual([]);
	});

	it("lets a reader read a document but not edit it", async () => {
		// Arrange
		const page = await createPage("Shared page");
		const block = await addBlock(page, "Readable");
		await prisma.user.create({
			data: {
				id: "blocks.reader",
				name: "r",
				email: "blocks.reader@vanlife.test",
			},
		});
		const invite = await post(`${API_PREFIX}/spaces/${spaceId}/participants`, {
			userId: "blocks.reader",
			permission: "reader",
		});
		expect(invite.status).toBe(201);

		// Act — as the reader
		signInAs("blocks.reader");
		const read = await get(`${API_PREFIX}/objects/${page}/blocks`);
		const edited = await patch(`${API_PREFIX}/blocks/${block.id}`, {
			text: "not allowed",
		});
		const added = await post(`${API_PREFIX}/objects/${page}/blocks`, {
			type: "text",
			text: "not allowed either",
		});

		// Assert — membership exists, so the refusal is about the rank (ADR-0006)
		expect(read.status).toBe(200);
		expect(edited.status).toBe(403);
		expect(added.status).toBe(403);
	});

	it("hides another space's document from every block route", async () => {
		// Arrange
		const page = await createPage("Private page");
		const block = await addBlock(page, "Secret");
		await prisma.user.create({
			data: {
				id: "blocks.stranger",
				name: "s",
				email: "blocks.stranger@vanlife.test",
			},
		});

		// Act
		signInAs("blocks.stranger");
		const read = await get(`${API_PREFIX}/objects/${page}/blocks`);
		const edited = await patch(`${API_PREFIX}/blocks/${block.id}`, {
			text: "nope",
		});

		// Assert — existence is not leaked (ADR-0006)
		expect(read.status).toBe(404);
		expect(edited.status).toBe(404);
	});

	it("refuses blocks on an object that is not a page", async () => {
		// Arrange
		const view = await post(`${API_PREFIX}/spaces/${spaceId}/dataviews`, {
			name: "Some view",
			sourceTypeId: pageTypeId,
			viewType: "grid",
		});
		expect(view.status).toBe(201);
		const viewId = ((await view.json()) as Json).id as string;

		// Act
		const response = await post(`${API_PREFIX}/objects/${viewId}/blocks`, {
			type: "text",
			text: "body of a view?",
		});

		// Assert
		expect(response.status).toBe(422);
	});

	it("refuses a parent that is not a block of this document", async () => {
		// Arrange
		const page = await createPage("Parent page");
		const other = await createPage("Other parent page");
		const foreign = await addBlock(other, "elsewhere");

		// Act
		const response = await post(`${API_PREFIX}/objects/${page}/blocks`, {
			type: "text",
			text: "misplaced child",
			parentId: foreign.id,
		});

		// Assert
		expect(response.status).toBe(422);
	});
});
