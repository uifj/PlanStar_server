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

// LinkPreview is the link/bookmark hover card and the chat-form unfurl
// (preview/link.tsx, menu/dataview/create/bookmark.tsx, block/chat/form.tsx). The client
// hands the backend a url and reads back message.linkPreview through
// Mapper.From.PreviewLink -> { type, title, description, faviconUrl, imageUrl, url }. The
// backend fetches the page server-side and lifts OpenGraph/Twitter meta, the <title> and the
// favicon. Because it fetches a caller-supplied url, it is an SSRF surface: the scheme must be
// http(s), link-local/IMDS is always refused, and in production loopback/private hosts are
// refused too. These tests run on loopback under NODE_ENV=test, which the guard permits.
describe.skipIf(!databaseAvailable)("POST /api/command LinkPreview", () => {
	const ownerId = "link-preview.owner";
	let server: Server;
	let baseUrl: string;

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: ownerId,
				name: "Preview owner",
				email: "link-preview@vanlife.test",
			},
		});

		server = createServer((req, res) => {
			if (req.url === "/article") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					[
						"<html><head>",
						"<title>Plain Title</title>",
						'<meta property="og:title" content="OG Title">',
						'<meta property="og:description" content="OG description">',
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
		await prisma.user.deleteMany({ where: { id: ownerId } });
	});

	const preview = async (url: string) => {
		signInAs(ownerId);
		return (await post("/api/command/LinkPreview", { url })).json();
	};

	it("lifts the OpenGraph title, description, image and favicon from the page", async () => {
		const res = await preview(`${baseUrl}/article`);

		expect(res.error).toEqual({ code: 0, description: "" });
		const link = res.linkPreview;
		// og:title wins over the plain <title>.
		expect(link.title).toBe("OG Title");
		expect(link.description).toBe("OG description");
		// A relative og:image / favicon resolves against the page url.
		expect(link.imageUrl).toBe(`${baseUrl}/cover.png`);
		expect(link.faviconUrl).toBe(`${baseUrl}/favicon.ico`);
		expect(link.url).toBe(`${baseUrl}/article`);
	});

	it("refuses a non-http(s) scheme rather than fetching it", async () => {
		const res = await preview("file:///etc/passwd");
		// FORBIDDEN: the guard rejected the url, no fetch happened.
		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(res.linkPreview).toBeUndefined();
	});

	it("refuses a link-local metadata host in every environment", async () => {
		// 169.254.169.254 is cloud IMDS; it is blocked even outside production so a
		// compromised caller cannot read instance metadata through the preview fetch.
		const res = await preview("http://169.254.169.254/latest/meta-data/");
		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(res.linkPreview).toBeUndefined();
	});

	it("answers NOT_FOUND when the target is not an HTML page", async () => {
		// The stub server answers unknown paths with 404 text/plain.
		const res = await preview(`${baseUrl}/missing`);
		expect(res.error).toEqual({ code: 3, description: "Object not found." });
		expect(res.linkPreview).toBeUndefined();
	});
});
