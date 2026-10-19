import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../src/lib/prisma.js";
import { readZipEntry, readZipIndex } from "../../src/modules/files/zip.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { get, post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

const zipEntryText = (bytes: Uint8Array, name: string) => {
	const entry = readZipIndex(bytes).find((it) => it.name === name);
	if (!entry) throw new Error(`archive has no entry named ${name}`);
	return new TextDecoder().decode(readZipEntry(bytes, entry));
};

// Settings → Export (component/popup/export.tsx:58 → lib/action.ts:585) hands the server a
// directory to write into — a thing a browser does not have. So the command writes under this
// server's own export root and answers a download URL, and the two formats a self-hosted server
// can actually produce from what it stores are Markdown and JSON.
describe.skipIf(!databaseAvailable)("ObjectListExport", () => {
	const owner = "export.owner";
	const outsider = "export.outsider";

	let spaceId = "";
	let first = "";
	let second = "";

	const docWith = (text: string) => {
		const doc = new Y.Doc();
		doc.getXmlFragment("default").insert(0, [new Y.XmlText(text)]);
		const state = Buffer.from(Y.encodeStateAsUpdate(doc));
		doc.destroy();
		return state;
	};

	beforeAll(async () => {
		for (const id of [owner, outsider]) {
			await prisma.obj.deleteMany({ where: { creatorId: id } });
			await prisma.spaceMember.deleteMany({ where: { userId: id } });
			await prisma.user.deleteMany({ where: { id } });
			await prisma.user.create({
				data: {
					id,
					name: id === owner ? "Exporter" : "Stranger",
					email: `${id}@vanlife.test`,
				},
			});
		}
		await prisma.space.deleteMany({ where: { createdBy: owner } });

		signInAs(owner);
		spaceId = (
			await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Export space" },
					useCase: 2,
				})
			).json()
		).spaceId as string;

		for (const [name, body] of [
			["Bergen wharf", "Wharf at dawn, fog on the water."],
			["Trollstigen", "Closes in October; plan a detour."],
		]) {
			const objectId = (
				await (
					await post("/api/command/ObjectCreate", {
						spaceId,
						details: { name },
					})
				).json()
			).objectId as string;
			if (!first) {
				first = objectId;
			} else {
				second = objectId;
			}
			await prisma.documentState.create({
				data: { objectId, state: docWith(body) },
			});
		}
	});

	const run = async (as: string, body: Record<string, unknown>) => {
		signInAs(as);
		return (
			await post("/api/command/ObjectListExport", {
				spaceId,
				objectIds: [first, second],
				format: 0,
				zip: true,
				includeNested: false,
				includeFiles: false,
				includeArchived: false,
				isJson: false,
				...body,
			})
		).json();
	};

	it("writes every requested object into a downloadable Markdown archive", async () => {
		const answer = await run(owner, {});

		expect(answer.error).toEqual({ code: 0, description: "" });
		expect(answer.report).toEqual({
			objectCount: 2,
			objectErrors: 0,
			fileErrors: 0,
			issues: [],
		});
		expect(answer.path).toContain("/api/export/");

		const download = await get(answer.path.replace(/^https?:\/\/[^/]+/, ""));
		expect(download.status).toBe(200);
		expect(download.headers.get("content-type")).toBe("application/zip");
		expect(download.headers.get("content-disposition")).toContain(
			'attachment; filename="',
		);

		const bytes = new Uint8Array(await download.arrayBuffer());
		const index = readZipIndex(bytes);
		expect(index.map((entry) => entry.name).sort()).toEqual([
			"Bergen wharf.md",
			"Trollstigen.md",
		]);
		expect(zipEntryText(bytes, "Bergen wharf.md")).toContain(
			"Wharf at dawn, fog on the water.",
		);
	});

	it("answers a plain JSON document when one object is exported without zip", async () => {
		const answer = await run(owner, {
			objectIds: [first],
			zip: false,
			format: 2,
		});

		// The download name is URL- and filesystem-safe; the entry inside stays readable.
		expect(answer.filename).toBe("Bergen_wharf.json");

		const download = await get(answer.path.replace(/^https?:\/\/[^/]+/, ""));
		const payload = JSON.parse(await download.text());
		expect(payload.id).toBe(first);
		expect(payload.details.name).toBe("Bergen wharf");
		expect(payload.body).toContain("Wharf at dawn");
	});

	it("reports an id it could not export instead of quietly dropping it", async () => {
		const answer = await run(owner, {
			objectIds: [first, "does-not-exist"],
			zip: false,
		});

		expect(answer.report.objectCount).toBe(1);
		expect(answer.report.objectErrors).toBe(1);
	});

	it("refuses a format this build cannot serialise", async () => {
		const answer = await run(owner, { format: 1 });

		expect(answer.error.code).toBe(12);
		expect(answer.error.description).toContain("Markdown and JSON");
	});

	it("refuses a caller outside the space", async () => {
		const answer = await run(outsider, {});

		expect(answer.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});

	it("does not serve a path outside the export root", async () => {
		const traversal = await get("/api/export/..%2F..%2F.env");
		expect(traversal.status).toBe(404);

		const missing = await get("/api/export/no-such-archive.zip");
		expect(missing.status).toBe(404);
	});
});
