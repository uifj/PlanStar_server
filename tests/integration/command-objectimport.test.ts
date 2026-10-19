import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";
import { bodyTextFromState } from "../../src/modules/collab/projection.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Settings → Import is reachable in the web build: the file picker stages bytes through
// POST /api/web-upload and hands back the resulting server path (lib/web/electronMock.ts),
// which is the same shape FileUpload already reads as localPath. ObjectImport is therefore a
// server-side reader, not a desktop-only command — so it answers here, and the Import screen
// (settings/import/index.tsx:27) only needs error.code to stay 0 before it opens the target.
//
// The bytes are read from the disk of the process that serves the API, so the accepted paths
// are confined to the two directories the browser upload ingress writes into: the configured
// staging root and the dev mirror in the OS temp dir. Anything else is refused, otherwise a
// writer in any space could ask the server to read /etc/passwd and have it become a page.
describe.skipIf(!databaseAvailable)("ObjectImport of staged files", () => {
	const owner = "imp.owner";
	const stranger = "imp.stranger";

	const stage = (filename: string, content: string) => {
		const dir = resolve(env.FILE_UPLOAD_STAGING_ROOT);
		mkdirSync(dir, { recursive: true });
		// The same shape both upload ingresses stamp: `<ms>-<random>-<name>` (see staged-path.ts).
		const path = resolve(dir, `${Date.now()}-vitest-${filename}`);
		writeFileSync(path, content, "utf8");
		return path;
	};

	let spaceId = "";

	beforeAll(async () => {
		for (const id of [owner, stranger]) {
			await prisma.obj.deleteMany({ where: { creatorId: id } });
			await prisma.spaceMember.deleteMany({ where: { userId: id } });
			await prisma.user.deleteMany({ where: { id } });
			await prisma.user.create({
				data: {
					id,
					name: id === owner ? "Importer" : "Stranger",
					email: `${id}@vanlife.test`,
				},
			});
		}
		await prisma.space.deleteMany({ where: { createdBy: owner } });

		signInAs(owner);
		spaceId = (
			await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Import space" },
					useCase: 2,
				})
			).json()
		).spaceId as string;
	});

	// Markdown is I.ImportType.Markdown (interface/common.ts:126) and rides markdownParams.path.
	const importMarkdown = async (as: string, path: string) => {
		signInAs(as);
		return (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 1,
				mode: 1,
				noProgress: false,
				isMigration: false,
				isNewSpace: false,
				updateExistingObjects: false,
				snapshots: [],
				markdownParams: { path: [path], createDirectoryPages: true },
			})
		).json();
	};

	const openPage = async (objectId: string) => {
		signInAs(owner);
		const opened = await (
			await post("/api/command/ObjectOpen", { spaceId, objectId })
		).json();
		const detail = opened.objectView.details.find(
			(it: any) => it.id === objectId,
		);
		const stored = await prisma.documentState.findUnique({
			where: { objectId },
		});
		return {
			name: detail?.details?.name as string,
			body: stored ? bodyTextFromState(new Uint8Array(stored.state)) : "",
		};
	};

	it("creates a page named from the heading whose body is the markdown text", async () => {
		const path = stage(
			"fog.md",
			"# Fog lines\n\nFirst paragraph.\n\nSecond paragraph.",
		);

		const body = await importMarkdown(owner, path);
		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.objectIds).toHaveLength(1);

		const page = await openPage(body.objectIds[0]);
		expect(page.name).toBe("Fog lines");
		expect(page.body).toContain("First paragraph.");
		expect(page.body).toContain("Second paragraph.");
	});

	it("refuses a path the browser upload ingress could not have produced", async () => {
		const before = await prisma.obj.count({ where: { spaceId } });

		const body = await importMarkdown(owner, "/etc/passwd");

		expect(body.error).toEqual({
			code: 2,
			description: "Import path is outside the upload staging directory.",
		});
		expect(await prisma.obj.count({ where: { spaceId } })).toBe(before);
	});

	it("refuses a caller who is not a member of the target space", async () => {
		const path = stage("mine.md", "# Mine\n\nSecrets.");

		signInAs(stranger);
		const body = await (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 1,
				mode: 1,
				snapshots: [],
				markdownParams: { path: [path] },
			})
		).json();

		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});

	it("builds a body the editor can read back as separate paragraphs", async () => {
		const path = stage("two.md", "# Two\n\nAlpha.\n\nBeta.");
		const body = await importMarkdown(owner, path);
		const state = await prisma.documentState.findUnique({
			where: { objectId: body.objectIds[0] },
		});

		// y-prosemirror binds block nodes as XmlElement children of the "default" fragment,
		// so a body of bare XmlText nodes is what the collab editor cannot render.
		const doc = new Y.Doc();
		Y.applyUpdate(doc, new Uint8Array(state!.state));
		const blocks = doc
			.getXmlFragment("default")
			.toArray()
			.map((it) =>
				it instanceof Y.XmlElement ? it.nodeName : it.constructor.name,
			);

		expect(blocks).toEqual(["paragraph", "paragraph"]);
	});

	it("answers a format the reader does not implement as a capability limit", async () => {
		const path = stage("rows.csv", "name,done\nFog,true");

		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 6,
				mode: 1,
				snapshots: [],
				csvParams: { path: [path] },
			})
		).json();

		expect(body.error.code).toBe(12);
		expect(body.error.description).toContain("plain-text");
	});

	it("imports every staged file of one request as its own page", async () => {
		const first = stage("first.md", "# First page\n\nAlpha.");
		const second = stage("second.md", "# Second page\n\nBeta.");

		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 1,
				mode: 1,
				snapshots: [],
				markdownParams: { path: [first, second] },
			})
		).json();

		expect(body.objectIds).toHaveLength(2);
		expect((await openPage(body.objectIds[0])).name).toBe("First page");
		expect((await openPage(body.objectIds[1])).name).toBe("Second page");
	});

	it("names an HTML page from its h1 and drops the markup", async () => {
		const path = stage(
			"wharf.html",
			"<html><head><title>Ignored</title></head><body><h1>Wharf notes</h1><p>Bergen &amp; the <b>morning</b> fog.</p><script>evil()</script></body></html>",
		);

		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 4,
				mode: 1,
				snapshots: [],
				htmlParams: { path: [path] },
			})
		).json();

		const page = await openPage(body.objectIds[0]);
		expect(page.name).toBe("Wharf notes");
		expect(page.body).toBe("Bergen & the morning fog.");
		expect(page.body).not.toContain("evil");
	});

	it("names a plain-text import after the file, not its staging stamp", async () => {
		const path = stage("trip notes.txt", "Depart 06:15.\n\nFerry at odds.");

		signInAs(owner);
		const body = await (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 5,
				mode: 1,
				snapshots: [],
				txtParams: { path: [path] },
			})
		).json();

		const page = await openPage(body.objectIds[0]);
		expect(page.name).toBe("trip notes");
		expect(page.body).toContain("Depart 06:15.");
	});

	it("refuses a reader of the space, because import writes objects", async () => {
		const viewer = "imp.viewer";
		await prisma.user.deleteMany({ where: { id: viewer } });
		await prisma.user.create({
			data: { id: viewer, name: "Viewer", email: "imp-viewer@vanlife.test" },
		});
		await prisma.spaceMember.create({
			data: { spaceId, userId: viewer, permission: "reader", status: "active" },
		});

		const path = stage("reader.md", "# Not yours\n\nBlocked.");

		signInAs(viewer);
		const body = await (
			await post("/api/command/ObjectImport", {
				spaceId,
				type: 1,
				mode: 1,
				snapshots: [],
				markdownParams: { path: [path] },
			})
		).json();

		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});
});
