import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { readFileBytes } from "../../src/modules/files/storage.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A bookmark's cover (details.picture) and favicon (details.iconImage) are FILE OBJECT IDS: the
// client renders them through S.Common.imageUrl(id) = `${gatewayUrl}/image/${id}` (head/editor.tsx:
// 89,194), so a raw external url there would build a broken gateway url. ObjectCreateFromUrl already
// lifts the page's og:image/favicon urls into the preview but discards them; this exercises the
// round-trip that downloads those bytes (through the SAME SSRF guard as the page fetch) and stores
// them as image file objects in the bookmark's space, pointing picture/iconImage at their ids.
describe.skipIf(!databaseAvailable)("POST /api/command bookmark images", () => {
	const ownerId = "bookmarkimg.owner";
	let server: Server;
	let baseUrl: string;

	const COVER_BYTES = Buffer.from("cover-image-bytes");
	const FAVICON_BYTES = Buffer.from("favicon-bytes");

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Bookmark image owner",
					email: "bookmark-img@vanlife.test",
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
						'<meta property="og:title" content="Covered">',
						'<meta property="og:image" content="/cover.png">',
						'<link rel="icon" href="/favicon.ico">',
						"</head><body>hi</body></html>",
					].join(""),
				);
				return;
			}
			if (req.url === "/plain") {
				// No og:image and no icon link; the favicon fallback (/favicon.ico) 404s below,
				// so this page yields a bookmark with neither picture nor iconImage.
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
				});
				res.end(
					[
						"<html><head>",
						'<meta property="og:title" content="No images">',
						"</head><body>hi</body></html>",
					].join(""),
				);
				return;
			}
			if (req.url === "/blocked-article") {
				// og:image points at link-local IMDS, which the SSRF guard blocks in EVERY
				// environment, so the cover must be skipped without contacting it.
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
				});
				res.end(
					[
						"<html><head>",
						'<meta property="og:title" content="Blocked cover">',
						'<meta property="og:image" content="http://169.254.169.254/cover.png">',
						"</head><body>hi</body></html>",
					].join(""),
				);
				return;
			}
			if (req.url === "/html-cover-article") {
				// og:image resolves to a 200 text/html error page, not an image.
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
				});
				res.end(
					[
						"<html><head>",
						'<meta property="og:title" content="HTML cover">',
						'<meta property="og:image" content="/html-cover.png">',
						"</head><body>hi</body></html>",
					].join(""),
				);
				return;
			}
			if (req.url === "/cover.png") {
				res.writeHead(200, { "Content-Type": "image/png" });
				res.end(COVER_BYTES);
				return;
			}
			if (req.url === "/favicon.ico") {
				res.writeHead(200, { "Content-Type": "image/x-icon" });
				res.end(FAVICON_BYTES);
				return;
			}
			if (req.url === "/html-cover.png") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end("<html>not an image</html>");
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
		await prisma.user.deleteMany({ where: { id: ownerId } });
	});

	const createSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Bookmark image space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const createBookmark = async (spaceId: string, url: string) => {
		signInAs(ownerId);
		return (
			await post("/api/command/ObjectCreateFromUrl", {
				spaceId,
				url,
				objectTypeUniqueKey: "",
				addPageContent: true,
				details: {},
			})
		).json();
	};

	it("stores the page's og:image as an image file object on details.picture", async () => {
		const spaceId = await createSpace();
		const res = await createBookmark(spaceId, `${baseUrl}/article`);

		expect(res.error).toEqual({ code: 0, description: "" });
		const pictureId = res.details.picture as string;
		expect(typeof pictureId).toBe("string");
		expect(pictureId.length).toBeGreaterThan(0);

		// The picture id is a real image-layout object in the bookmark's space carrying the
		// fetched bytes, so imageUrl(id) -> GET /api/image/:id serves the cover.
		const fileObj = await prisma.obj.findUnique({
			where: { id: pictureId },
		});
		expect(fileObj).not.toBeNull();
		expect(fileObj?.spaceId).toBe(spaceId);
		expect(fileObj?.resolvedLayout).toBe("image");
		const stored = await readFileBytes(pictureId);
		expect(stored).not.toBeNull();
		expect(Buffer.from(stored as Uint8Array).equals(COVER_BYTES)).toBe(true);
	});

	it("stores the page's favicon as an image file object on details.iconImage", async () => {
		const spaceId = await createSpace();
		const res = await createBookmark(spaceId, `${baseUrl}/article`);

		expect(res.error).toEqual({ code: 0, description: "" });
		const iconId = res.details.iconImage as string;
		expect(typeof iconId).toBe("string");
		expect(iconId.length).toBeGreaterThan(0);

		const fileObj = await prisma.obj.findUnique({ where: { id: iconId } });
		expect(fileObj?.resolvedLayout).toBe("image");
		const stored = await readFileBytes(iconId);
		expect(Buffer.from(stored as Uint8Array).equals(FAVICON_BYTES)).toBe(true);
	});

	it("skips a cover whose url the SSRF guard blocks, and still creates the bookmark", async () => {
		const spaceId = await createSpace();
		const res = await createBookmark(spaceId, `${baseUrl}/blocked-article`);

		// The page itself is on the loopback stub (allowed), so the bookmark is created; only
		// the og:image on link-local IMDS is refused, leaving picture unset rather than failing.
		expect(res.error).toEqual({ code: 0, description: "" });
		expect(res.details.name).toBe("Blocked cover");
		expect(res.details.picture ?? "").toBe("");

		const obj = await prisma.obj.findUnique({
			where: { id: res.objectId as string },
		});
		const details = (obj?.details ?? {}) as Record<string, unknown>;
		expect(details.picture).toBeUndefined();
	});

	it("skips a cover the server returns as a non-image content-type", async () => {
		const spaceId = await createSpace();
		const res = await createBookmark(spaceId, `${baseUrl}/html-cover-article`);

		expect(res.error).toEqual({ code: 0, description: "" });
		const obj = await prisma.obj.findUnique({
			where: { id: res.objectId as string },
		});
		const details = (obj?.details ?? {}) as Record<string, unknown>;
		// A 200 text/html "cover" is an error page, not an image, so nothing is stored.
		expect(details.picture).toBeUndefined();
	});

	it("refreshes picture and iconImage when the bookmark source is re-fetched", async () => {
		const spaceId = await createSpace();
		// Create from a page with no images, so the bookmark starts without a cover.
		const created = await createBookmark(spaceId, `${baseUrl}/plain`);
		const objectId = created.objectId as string;
		const before = await prisma.obj.findUnique({ where: { id: objectId } });
		expect(
			((before?.details ?? {}) as Record<string, unknown>).picture,
		).toBeUndefined();

		// "Reload source data" re-fetches a page that DOES have a cover and favicon.
		signInAs(ownerId);
		const res = await (
			await post("/api/command/ObjectBookmarkFetch", {
				contextId: objectId,
				url: `${baseUrl}/article`,
			})
		).json();
		expect(res.error).toEqual({ code: 0, description: "" });

		const after = await prisma.obj.findUnique({ where: { id: objectId } });
		const details = (after?.details ?? {}) as Record<string, unknown>;
		const pictureId = details.picture as string;
		const iconId = details.iconImage as string;
		expect(typeof pictureId).toBe("string");
		expect(pictureId.length).toBeGreaterThan(0);
		expect(typeof iconId).toBe("string");
		expect(iconId.length).toBeGreaterThan(0);

		const cover = await readFileBytes(pictureId);
		expect(Buffer.from(cover as Uint8Array).equals(COVER_BYTES)).toBe(true);
	});
});
