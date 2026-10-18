import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../src/lib/prisma.js";
import { bodyTextFromState } from "../../src/modules/collab/projection.js";
import { storeDocument } from "../../src/modules/collab/server.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ADR-0018: the folded Yjs update is the body's sole source, and search text is a
// rebuildable projection of it. Persisting a body over the collab socket must refresh
// Obj.snippet so search results and object cards show a preview without decoding the
// document on every read.
describe.skipIf(!databaseAvailable)(
	"collab storeDocument body projection",
	() => {
		const ownerId = "collab-projection.owner";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Projection owner",
						email: "collab-projection-owner@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({ where: { id: ownerId } });
		});

		const createObject = async (name: string) => {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Projection space" },
					useCase: 2,
				})
			).json();
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			return created.objectId as string;
		};

		function bodyState(lines: string[]): Uint8Array {
			const doc = new Y.Doc();
			const fragment = doc.getXmlFragment("default");
			for (const line of lines) {
				const paragraph = new Y.XmlElement("paragraph");
				paragraph.insert(0, [new Y.XmlText(line)]);
				fragment.push([paragraph]);
			}
			return Y.encodeStateAsUpdate(doc);
		}

		it("stores the Yjs state and projects a snippet onto the object", async () => {
			const objectId = await createObject("Projected page");
			const state = bodyState(["The quick brown fox", "jumps over the dog"]);

			await storeDocument(objectId, state);

			const row = await prisma.documentState.findUnique({
				where: { objectId },
			});
			expect(row).not.toBeNull();
			expect(new Uint8Array(row?.state ?? new Uint8Array())).toEqual(state);

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.snippet).toBe("The quick brown fox jumps over the dog");
		});

		it("refreshes the snippet when the body is stored again", async () => {
			const objectId = await createObject("Rewritten page");

			await storeDocument(objectId, bodyState(["First draft"]));
			await storeDocument(objectId, bodyState(["Second draft"]));

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.snippet).toBe("Second draft");
		});

		it("clears the snippet when the body becomes empty", async () => {
			const objectId = await createObject("Emptied page");

			await storeDocument(objectId, bodyState(["Some text"]));
			await storeDocument(objectId, bodyState([]));

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.snippet).toBe("");
		});

		it("surfaces the projected snippet through ObjectShow", async () => {
			const objectId = await createObject("Shown page");
			await storeDocument(objectId, bodyState(["Body preview text"]));

			signInAs(ownerId);
			const shown = await (
				await post("/api/command/ObjectShow", { objectId })
			).json();

			const details = shown.objectView.details.find(
				(it: any) => it.id === objectId,
			);
			expect(details.details.snippet).toBe("Body preview text");
		});

		it("captures a version snapshot on every store", async () => {
			const objectId = await createObject("Versioned page");

			await storeDocument(objectId, bodyState(["first draft"]));
			await storeDocument(objectId, bodyState(["second draft"]));

			const versions = await prisma.documentVersion.findMany({
				where: { objectId },
				orderBy: { createdAt: "asc" },
			});
			expect(versions.length).toBe(2);
			expect(bodyTextFromState(new Uint8Array(versions[0].state))).toBe(
				"first draft",
			);
			expect(bodyTextFromState(new Uint8Array(versions[1].state))).toBe(
				"second draft",
			);
		});

		it("lists versions through HistoryGetVersions, newest-first", async () => {
			const objectId = await createObject("Listed history");
			await storeDocument(objectId, bodyState(["v1"]));
			await storeDocument(objectId, bodyState(["v2"]));
			await storeDocument(objectId, bodyState(["v3"]));

			signInAs(ownerId);
			const message = await (
				await post("/api/command/HistoryGetVersions", {
					objectId,
					lastVersionId: "",
					limit: 10,
				})
			).json();

			expect(message.error?.code).toBeFalsy();
			expect(message.versions.length).toBe(3);
			// newest-first: the client projects each via Mapper.From.HistoryVersion.
			for (const version of message.versions) {
				expect(typeof version.id).toBe("string");
				expect(typeof version.time).toBe("number");
				expect(Object.hasOwn(version, "authorId")).toBe(true);
			}
		});

		it("restores a version through HistorySetVersion", async () => {
			const objectId = await createObject("Restored page");
			await storeDocument(objectId, bodyState(["first draft"]));
			const v1 = await prisma.documentVersion.findFirst({
				where: { objectId },
				orderBy: { createdAt: "asc" },
			});
			await storeDocument(objectId, bodyState(["second draft"]));

			signInAs(ownerId);
			const restored = await (
				await post("/api/command/HistorySetVersion", {
					objectId,
					versionId: v1?.id,
				})
			).json();
			expect(restored.error?.code).toBeFalsy();

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.snippet).toBe("first draft");

			// Restore writes through the same body path, so it also records a new snapshot.
			const versionCount = await prisma.documentVersion.count({
				where: { objectId },
			});
			expect(versionCount).toBe(3);
		});

		it("previews a version through HistoryShowVersion", async () => {
			const objectId = await createObject("Previewed history");
			await storeDocument(objectId, bodyState(["first draft"]));
			const v1 = await prisma.documentVersion.findFirst({
				where: { objectId },
				orderBy: { createdAt: "asc" },
			});
			await storeDocument(objectId, bodyState(["second draft"]));

			signInAs(ownerId);
			const message = await (
				await post("/api/command/HistoryShowVersion", {
					objectId,
					versionId: v1?.id,
				})
			).json();

			expect(message.error?.code).toBeFalsy();
			expect(message.version.id).toBe(v1?.id);
			const entry = message.objectView.details.find(
				(it: any) => it.id === objectId,
			);
			expect(entry.details.snippet).toBe("first draft");
		});
	},
);

// ADR-0013: a link is the page's edge, not the block's. The body's objectLink mentions are
// authored over the collab socket, so storeDocument must rebuild the source object's "links"
// rows from the decoded document — giving the graph and backlinks the same edges the block
// editor used to write through BlockLink.
describe.skipIf(!databaseAvailable)(
	"collab storeDocument body-link projection",
	() => {
		const ownerId = "collab-bodylink.owner";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Body-link owner",
						email: "collab-bodylink-owner@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({ where: { id: ownerId } });
		});

		async function createSpaceWithTwoObjects() {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Body-link space" },
					useCase: 2,
				})
			).json();
			const source = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Source page" },
				})
			).json();
			const target = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Target page" },
				})
			).json();
			return { spaceId, sourceId: source.objectId, targetId: target.objectId };
		}

		function bodyMentioning(targetId: string | null): Uint8Array {
			const doc = new Y.Doc();
			const fragment = doc.getXmlFragment("default");
			const paragraph = new Y.XmlElement("paragraph");
			paragraph.insert(0, [new Y.XmlText("see ")]);
			if (targetId) {
				const link = new Y.XmlElement("objectLink");
				link.setAttribute("targetObjectId", targetId);
				paragraph.insert(1, [link]);
			}
			fragment.push([paragraph]);
			return Y.encodeStateAsUpdate(doc);
		}

		it("projects an in-body objectLink into a links edge", async () => {
			const { sourceId, targetId } = await createSpaceWithTwoObjects();
			await storeDocument(sourceId, bodyMentioning(targetId));

			const edge = await prisma.link.findFirst({
				where: {
					fromId: sourceId,
					toId: targetId,
					relationKey: "links",
				},
			});
			expect(edge).not.toBeNull();
		});

		it("feeds the edge to ObjectGraph", async () => {
			const { spaceId, sourceId, targetId } = await createSpaceWithTwoObjects();
			await storeDocument(sourceId, bodyMentioning(targetId));

			signInAs(ownerId);
			const graph = await (
				await post("/api/command/ObjectGraph", { spaceId })
			).json();
			expect(
				graph.edges.some(
					(e: any) => e.source === sourceId && e.target === targetId,
				),
			).toBe(true);
		});

		it("drops the edge when the body no longer mentions the target", async () => {
			const { sourceId, targetId } = await createSpaceWithTwoObjects();
			await storeDocument(sourceId, bodyMentioning(targetId));
			await storeDocument(sourceId, bodyMentioning(null));

			const edge = await prisma.link.findFirst({
				where: {
					fromId: sourceId,
					toId: targetId,
					relationKey: "links",
				},
			});
			expect(edge).toBeNull();
		});

		it("ignores a link to an unknown object instead of breaking the store", async () => {
			const { sourceId } = await createSpaceWithTwoObjects();
			await expect(
				storeDocument(sourceId, bodyMentioning("does-not-exist")),
			).resolves.not.toThrow();

			const edges = await prisma.link.findMany({
				where: { fromId: sourceId, relationKey: "links" },
			});
			expect(edges).toHaveLength(0);
		});
	},
);
