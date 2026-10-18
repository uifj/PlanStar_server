import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// ObjectBookmarkFetch is the "reload source data" command for an existing bookmark: the dataview
// source cell (cell/index.tsx:372), the object menu pageReload action (menu/object.tsx:519) and the
// page-head url editor (head/editor.tsx:175) all call it with the object id and a url. The backend
// re-fetches the page (SSRF-guarded, reusing LinkPreview's fetch) and refreshes the bookmark's
// title/description plus its `source` relation. The callers are fire-and-forget (no response
// mapper), so the honest contract is that the update really persists and reads back.
describe.skipIf(!databaseAvailable)(
	"POST /api/command ObjectBookmarkFetch",
	() => {
		const ownerId = "bookmark-fetch.owner";
		const outsiderId = "bookmark-fetch.outsider";
		let server: Server;
		let baseUrl: string;

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Bookmark fetch owner",
						email: "bookmark-fetch@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Bookmark fetch outsider",
						email: "bookmark-fetch-outsider@vanlife.test",
					},
				],
			});

			server = createServer((req, res) => {
				const page = (title: string, description: string) => {
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(
						[
							"<html><head>",
							`<meta property="og:title" content="${title}">`,
							`<meta property="og:description" content="${description}">`,
							"</head><body>hello</body></html>",
						].join(""),
					);
				};
				if (req.url === "/article") {
					page("Original Title", "Original body");
					return;
				}
				if (req.url === "/updated") {
					page("Updated Title", "Updated body");
					return;
				}
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("nope");
			});

			await new Promise<void>((resolve) => {
				server.listen(0, "127.0.0.1", () => resolve());
			});
			const address = server.address() as AddressInfo;
			baseUrl = `http://127.0.0.1:${address.port}`;
		});

		afterAll(async () => {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, outsiderId] } },
			});
		});

		const createSpace = async () => {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "Bookmark fetch space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const seedBookmark = async (spaceId: string, url: string) => {
			signInAs(ownerId);
			const created = await (
				await post("/api/command/ObjectCreateFromUrl", {
					spaceId,
					url,
					objectTypeUniqueKey: "",
					addPageContent: true,
					details: {},
				})
			).json();
			return created.objectId as string;
		};

		it("re-fetches a bookmark's source and updates its title, description and url", async () => {
			const spaceId = await createSpace();
			const objectId = await seedBookmark(spaceId, `${baseUrl}/article`);

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectBookmarkFetch", {
					contextId: objectId,
					url: `${baseUrl}/updated`,
				})
			).json();

			expect(res.error).toEqual({ code: 0, description: "" });

			// Real read-back: the row now carries the refreshed metadata and the new source url.
			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.name).toBe("Updated Title");
			expect(obj?.description).toBe("Updated body");
			const details = obj?.details as Record<string, unknown>;
			expect(details.source).toBe(`${baseUrl}/updated`);
		});

		it("refuses a non-http(s) url and leaves the bookmark untouched", async () => {
			const spaceId = await createSpace();
			const objectId = await seedBookmark(spaceId, `${baseUrl}/article`);

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectBookmarkFetch", {
					contextId: objectId,
					url: "file:///etc/passwd",
				})
			).json();

			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			// The guard rejects the url before any write, so the original metadata survives.
			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.name).toBe("Original Title");
			const details = obj?.details as Record<string, unknown>;
			expect(details.source).toBe(`${baseUrl}/article`);
		});

		it("answers NOT_FOUND for an object that does not exist", async () => {
			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectBookmarkFetch", {
					contextId: "no-such-object",
					url: `${baseUrl}/updated`,
				})
			).json();

			expect(res.error).toEqual({ code: 3, description: "Object not found." });
		});

		it("refuses a caller who cannot write to the bookmark's space", async () => {
			const spaceId = await createSpace();
			const objectId = await seedBookmark(spaceId, `${baseUrl}/article`);

			signInAs(outsiderId);
			const res = await (
				await post("/api/command/ObjectBookmarkFetch", {
					contextId: objectId,
					url: `${baseUrl}/updated`,
				})
			).json();

			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj?.name).toBe("Original Title");
		});
	},
);
