import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

const stateOf = (lines: string[]) => {
	const doc = new Y.Doc();
	doc.getXmlFragment("default").insert(
		0,
		lines.map((line) => new Y.XmlText(line)),
	);
	const state = Buffer.from(Y.encodeStateAsUpdate(doc));
	doc.destroy();
	return state;
};

// The history pane previews a version by rendering the objectView the command returns. A
// Yjs body's Block rows are stale or absent (ADR-0018), so answering with the object's
// current rows left the preview blank: the version's own text has to be projected into the
// block tree the client renders.
describe.skipIf(!databaseAvailable)(
	"HistoryShowVersion previews the version body",
	() => {
		const owner = "histpreview.owner";

		let spaceId = "";
		let objectId = "";
		let olderVersionId = "";

		beforeAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({ where: { id: owner } });
			await prisma.user.create({
				data: {
					id: owner,
					name: "Preview owner",
					email: "histpreview-owner@vanlife.test",
				},
			});

			signInAs(owner);
			spaceId = (
				await (
					await post("/api/command/WorkspaceCreate", {
						details: { name: "Preview space" },
						useCase: 2,
					})
				).json()
			).spaceId as string;
			objectId = (
				await (
					await post("/api/command/ObjectCreate", {
						spaceId,
						details: { name: "Previewable" },
					})
				).json()
			).objectId as string;

			const older = await prisma.documentVersion.create({
				data: {
					spaceId,
					objectId,
					state: stateOf(["First paragraph", "Second paragraph"]),
					createdAt: new Date(Date.now() - 60_000),
				},
				select: { id: true },
			});
			olderVersionId = older.id;

			await prisma.documentVersion.create({
				data: {
					spaceId,
					objectId,
					state: stateOf(["Rewritten first"]),
					createdAt: new Date(),
				},
			});
		});

		it("returns the version's own paragraphs as blocks", async () => {
			signInAs(owner);
			const body = await (
				await post("/api/command/HistoryShowVersion", {
					objectId,
					versionId: olderVersionId,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.version.id).toBe(olderVersionId);

			const texts = (body.objectView.blocks || [])
				.map((block: any) => block.text?.text)
				.filter((text: unknown) => typeof text === "string");

			expect(texts).toContain("First paragraph");
			expect(texts).toContain("Second paragraph");
			expect(texts).not.toContain("Rewritten first");
		});

		it("attaches the projected blocks to the view root", async () => {
			signInAs(owner);
			const body = await (
				await post("/api/command/HistoryShowVersion", {
					objectId,
					versionId: olderVersionId,
				})
			).json();

			const view = body.objectView;
			const root = view.blocks.find((block: any) => block.id === view.rootId);

			expect(root).toBeTruthy();
			expect(root.childrenIds.length).toBe(2);
		});
	},
);
