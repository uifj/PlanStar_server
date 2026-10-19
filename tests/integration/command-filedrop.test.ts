import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";
import { storeDocument } from "../../src/modules/collab/server.js";
import { paragraphState } from "../../src/modules/command/import-service.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// FileDrop is the drag-and-drop ingress (component/drag/provider.tsx:279, and the set cell of
// block/dataview.tsx:1877). The web build reaches it for real: the drop hands over the paths the
// browser upload ingress staged, so the server holds the bytes and only has to make a file object
// of each one and put the body's attachment node where the drop landed. The body node is the
// editor's `attachment` atom (component/editor/attachment.ts: url / filename / size), so the page
// has to render it after a reload — that is what these tests assert, through the stored document.
describe.skipIf(!databaseAvailable)("FileDrop onto a page body", () => {
	const owner = "drop.owner";
	const viewer = "drop.viewer";

	const stage = (filename: string, content: string) => {
		const dir = resolve(env.FILE_UPLOAD_STAGING_ROOT);
		mkdirSync(dir, { recursive: true });
		// The same shape both upload ingresses stamp: `<ms>-<random>-<name>` (see staged-path.ts).
		const path = resolve(dir, `${Date.now()}-vitest-${filename}`);
		writeFileSync(path, content, "utf8");
		return path;
	};

	let spaceId = "";
	let pageId = "";

	const drop = async (
		as: string,
		body: Record<string, unknown>,
	): Promise<any> => {
		signInAs(as);
		return await (await post("/api/command/FileDrop", body)).json();
	};

	// The stored document as the editor sees it: block node names, and for an attachment the
	// three attrs the node renders.
	const bodyNodes = async (objectId: string) => {
		const stored = await prisma.documentState.findUnique({
			where: { objectId },
		});
		if (!stored) {
			return [];
		}
		const doc = new Y.Doc();
		Y.applyUpdate(doc, new Uint8Array(stored.state));
		return doc
			.getXmlFragment("default")
			.toArray()
			.map((node) =>
				node instanceof Y.XmlElement
					? {
							name: node.nodeName,
							text: node.toString().slice(0, 40),
							url: node.getAttribute("url"),
							filename: node.getAttribute("filename"),
						}
					: { name: "text", text: node.toString(), url: null, filename: null },
			);
	};

	beforeAll(async () => {
		for (const id of [owner, viewer]) {
			await prisma.obj.deleteMany({ where: { creatorId: id } });
			await prisma.spaceMember.deleteMany({ where: { userId: id } });
			await prisma.user.deleteMany({ where: { id } });
			await prisma.user.create({
				data: {
					id,
					name: id === owner ? "Dropper" : "Viewer",
					email: `${id}@vanlife.test`,
				},
			});
		}
		await prisma.space.deleteMany({ where: { createdBy: owner } });

		signInAs(owner);
		spaceId = (
			await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Drop space" },
					useCase: 2,
				})
			).json()
		).spaceId as string;
		pageId = (
			await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Drop target" },
				})
			).json()
		).objectId as string;

		await storeDocument(
			pageId,
			paragraphState(["An earlier paragraph."]),
			null,
		);
	});

	it("turns each dropped file into a file object the body links to", async () => {
		const path = stage("ferry-timetable.txt", "06:15 Mortavika - Arsvagen\n");

		const answer = await drop(owner, {
			spaceId,
			contextId: pageId,
			dropTargetId: "",
			position: 4, // I.BlockPosition.Bottom
			localFilePaths: [path],
			style: 0,
		});

		expect(answer.error).toEqual({ code: 0, description: "" });
		expect(answer.objectIds).toHaveLength(1);

		const fileId = answer.objectIds[0] as string;
		const file = await prisma.obj.findUnique({ where: { id: fileId } });
		expect(file?.spaceId).toBe(spaceId);
		expect(file?.resolvedLayout).toBe("file");
		expect((file?.details as any)?.name).toBe("ferry-timetable.txt");

		const nodes = await bodyNodes(pageId);
		expect(nodes[0].name).toBe("paragraph");
		expect(nodes[0].text).toContain("An earlier paragraph.");
		const attachment = nodes.find((node) => node.name === "attachment");
		expect(attachment?.filename).toBe("ferry-timetable.txt");
		expect(attachment?.url).toBe(`${env.APP_URL}/api/file/${fileId}`);
	});

	it("refuses a local path the upload ingress could not have staged", async () => {
		const before = await bodyNodes(pageId);
		const files = await prisma.obj.count({
			where: { spaceId, resolvedLayout: "file" },
		});

		const answer = await drop(owner, {
			spaceId,
			contextId: pageId,
			dropTargetId: "",
			position: 4,
			localFilePaths: ["/etc/passwd"],
			style: 0,
		});

		expect(answer.error.code).toBe(2);
		expect(
			await prisma.obj.count({ where: { spaceId, resolvedLayout: "file" } }),
		).toBe(files);
		expect(await bodyNodes(pageId)).toEqual(before);
	});

	it("refuses a caller who cannot write the page's space", async () => {
		await prisma.spaceMember.create({
			data: { spaceId, userId: viewer, permission: "reader", status: "active" },
		});
		const path = stage("not-yours.txt", "reader drop");

		const answer = await drop(viewer, {
			spaceId,
			contextId: pageId,
			dropTargetId: "",
			position: 4,
			localFilePaths: [path],
			style: 0,
		});

		expect(answer.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(
			(await bodyNodes(pageId)).some((node) => node.name === "attachment"),
		).toBe(true);
		expect(
			(await bodyNodes(pageId)).filter((node) => node.name === "attachment"),
		).toHaveLength(1);
	});

	it("declines to guess where a file belongs inside a set view", async () => {
		signInAs(owner);
		const setId = (
			await (
				await post("/api/command/ObjectCreateSet", {
					spaceId,
					details: { name: "Notes" },
				})
			).json()
		).objectId as string;
		const path = stage("where.md", "# Where\n\nIn a set.");

		const answer = await drop(owner, {
			spaceId,
			contextId: setId,
			dropTargetId: "",
			position: 4,
			localFilePaths: [path],
			style: 0,
		});

		expect(answer.error.code).toBe(12);
	});
});
