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

// ObjectCreateFromUrl is the reachable bookmark-creation command: the dataview "new bookmark"
// menu (menu/dataview/create/bookmark.tsx:53) and the paste-a-url path (lib/util/menu.ts:1536)
// both call it with the bookmark type's uniqueKey, the url and addPageContent. The backend
// fetches the page (SSRF-guarded, reusing LinkPreview's fetch), lifts the title/description and
// mints a Bookmark-layout object (I.ObjectLayout.Bookmark === 11) whose `source` relation is the
// url. The caller reads message.details as the new object record and opens it.
describe.skipIf(!databaseAvailable)(
	"POST /api/command ObjectCreateFromUrl",
	() => {
		const ownerId = "bookmark.owner";
		const outsiderId = "bookmark.outsider";
		let server: Server;
		let baseUrl: string;

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Bookmark owner",
						email: "bookmark@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Bookmark outsider",
						email: "bookmark-outsider@vanlife.test",
					},
				],
			});

			server = createServer((req, res) => {
				if (req.url === "/article") {
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(
						[
							"<html><head>",
							"<title>Plain Title</title>",
							'<meta property="og:title" content="OG Bookmark">',
							'<meta property="og:description" content="OG body">',
							'<meta property="og:image" content="/cover.png">',
							'<link rel="icon" href="/favicon.ico">',
							"</head><body>hello</body></html>",
						].join(""),
					);
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
					details: { name: "Bookmark space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		it("creates a bookmark object from a url, lifting the page title and description", async () => {
			const spaceId = await createSpace();
			const url = `${baseUrl}/article`;

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectCreateFromUrl", {
					spaceId,
					url,
					objectTypeUniqueKey: "",
					addPageContent: true,
					details: {},
				})
			).json();

			expect(res.error).toEqual({ code: 0, description: "" });
			const objectId = res.objectId as string;
			expect(typeof objectId).toBe("string");
			expect(objectId.length).toBeGreaterThan(0);

			// The details record the caller opens: a Bookmark layout carrying the url on `source`.
			expect(res.details.id).toBe(objectId);
			expect(res.details.layout).toBe(11);
			expect(res.details.source).toBe(url);
			expect(res.details.name).toBe("OG Bookmark");
			expect(res.details.description).toBe("OG body");

			// Real read-back: the object row is a bookmark whose details carry the source url.
			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj).not.toBeNull();
			expect(obj?.resolvedLayout).toBe("bookmark");
			expect(obj?.spaceId).toBe(spaceId);
			expect(obj?.name).toBe("OG Bookmark");
			const details = obj?.details as Record<string, unknown>;
			expect(details.source).toBe(url);
		});

		it("refuses a non-http(s) url and creates no object", async () => {
			const spaceId = await createSpace();
			const before = await prisma.obj.count({
				where: { spaceId, resolvedLayout: "bookmark" },
			});

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectCreateFromUrl", {
					spaceId,
					url: "file:///etc/passwd",
					objectTypeUniqueKey: "",
					addPageContent: true,
					details: {},
				})
			).json();

			// The SSRF guard rejects the scheme before any fetch or row write.
			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect(res.objectId).toBeUndefined();
			const after = await prisma.obj.count({
				where: { spaceId, resolvedLayout: "bookmark" },
			});
			expect(after).toBe(before);
		});

		it("refuses a caller who cannot write to the target space", async () => {
			const spaceId = await createSpace();

			// The outsider is not a member of the owner's space, so planting a bookmark there
			// is refused by the writer check before the url is ever fetched.
			signInAs(outsiderId);
			const res = await (
				await post("/api/command/ObjectCreateFromUrl", {
					spaceId,
					url: `${baseUrl}/article`,
					objectTypeUniqueKey: "",
					addPageContent: true,
					details: {},
				})
			).json();

			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect(res.objectId).toBeUndefined();
		});

		it("still creates the bookmark, named by the url, when the page is not parseable", async () => {
			const spaceId = await createSpace();
			// The stub answers unknown paths with 404 text/plain, so the preview fetch yields null.
			const url = `${baseUrl}/missing`;

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectCreateFromUrl", {
					spaceId,
					url,
					objectTypeUniqueKey: "",
					addPageContent: true,
					details: {},
				})
			).json();

			expect(res.error).toEqual({ code: 0, description: "" });
			expect(res.details.layout).toBe(11);
			expect(res.details.source).toBe(url);
			// With no title to lift, the url itself becomes the name rather than an empty string.
			expect(res.details.name).toBe(url);
			expect(res.details.description).toBe("");
		});
	},
);
