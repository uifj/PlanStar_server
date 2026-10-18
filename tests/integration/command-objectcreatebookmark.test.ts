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

// ObjectCreateBookmark is the chat composer's paste-a-link path (block/chat/form.tsx:1143): the
// client sends { details: { source, createdInContext, createdInContextRef }, spaceId, templateId }
// and reads back { objectId, details }. It is the same bookmark minting as ObjectCreateFromUrl, only
// the url rides in details.source rather than a top-level url field, so it goes through the same
// SSRF-guarded fetch and lands a Bookmark-layout object (I.ObjectLayout.Bookmark === 11).
describe.skipIf(!databaseAvailable)(
	"POST /api/command ObjectCreateBookmark",
	() => {
		const ownerId = "bmark.owner";
		const outsiderId = "bmark.outsider";
		let server: Server;
		let baseUrl: string;

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{ id: ownerId, name: "Bmark owner", email: "bmark@vanlife.test" },
					{
						id: outsiderId,
						name: "Bmark outsider",
						email: "bmark-outsider@vanlife.test",
					},
				],
			});

			server = createServer((req, res) => {
				if (req.url === "/article") {
					res.writeHead(200, {
						"Content-Type": "text/html; charset=utf-8",
					});
					res.end(
						[
							"<html><head>",
							"<title>Plain Title</title>",
							'<meta property="og:title" content="OG Chat Bookmark">',
							'<meta property="og:description" content="OG chat body">',
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
					details: { name: "Chat bookmark space" },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		it("creates a bookmark object from details.source, lifting the page title", async () => {
			const spaceId = await createSpace();
			const url = `${baseUrl}/article`;

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectCreateBookmark", {
					details: {
						source: url,
						createdInContext: "ctx-root",
						createdInContextRef: "",
					},
					spaceId,
					templateId: "",
				})
			).json();

			expect(res.error).toEqual({ code: 0, description: "" });
			const objectId = res.objectId as string;
			expect(typeof objectId).toBe("string");
			expect(objectId.length).toBeGreaterThan(0);

			// The details record the chat composer reads back: a Bookmark layout carrying the url.
			expect(res.details.id).toBe(objectId);
			expect(res.details.layout).toBe(11);
			expect(res.details.source).toBe(url);
			expect(res.details.name).toBe("OG Chat Bookmark");
			expect(res.details.description).toBe("OG chat body");

			// Real read-back: a bookmark row in the space whose details carry the source url.
			const obj = await prisma.obj.findUnique({ where: { id: objectId } });
			expect(obj).not.toBeNull();
			expect(obj?.resolvedLayout).toBe("bookmark");
			expect(obj?.spaceId).toBe(spaceId);
			expect(obj?.name).toBe("OG Chat Bookmark");
			const details = obj?.details as Record<string, unknown>;
			expect(details.source).toBe(url);
		});

		it("refuses a non-http(s) source and creates no object", async () => {
			const spaceId = await createSpace();
			const before = await prisma.obj.count({
				where: { spaceId, resolvedLayout: "bookmark" },
			});

			signInAs(ownerId);
			const res = await (
				await post("/api/command/ObjectCreateBookmark", {
					details: { source: "file:///etc/passwd" },
					spaceId,
					templateId: "",
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

			signInAs(outsiderId);
			const res = await (
				await post("/api/command/ObjectCreateBookmark", {
					details: { source: `${baseUrl}/article` },
					spaceId,
					templateId: "",
				})
			).json();

			expect(res.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
			expect(res.objectId).toBeUndefined();
		});
	},
);
