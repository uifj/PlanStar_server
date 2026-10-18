import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { get, post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// FileUpload is the web file ingress (popup/upload.tsx, command.ts:289): the client hands
// the backend a server-side path (or an http url) plus an I.FileType, and reads back
// { objectId }. That object is a file object — its layout is Image/Audio/Video/Pdf/File by
// content, its bytes live on the file store keyed by the object id, and its record projects
// fileExt/fileMimeType/sizeInBytes/name so the shell can render an icon and a size. The
// bytes are then served at GET /file/{id} (store/common.ts fileUrl), landing straight in an
// <img>/<video>/<audio> src.
describe.skipIf(!databaseAvailable)("POST /api/command FileUpload", () => {
	const ownerId = "file-up.owner";
	const outsiderId = "file-up.outsider";
	let tempDir: string;

	beforeAll(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "fileupload-"));
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Upload owner",
					email: "file-up-owner@vanlife.test",
				},
				{
					id: outsiderId,
					name: "Upload outsider",
					email: "file-up-outsider@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({
			where: { id: { in: [ownerId, outsiderId] } },
		});
	});

	const createSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Upload space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const subscribeIds = async (spaceId: string, ids: string[]) => {
		signInAs(ownerId);
		return (
			await post("/api/command/ObjectSubscribeIds", { spaceId, ids })
		).json();
	};

	it("stores an uploaded image's bytes and serves them at GET /file/:id", async () => {
		const spaceId = await createSpace();
		const bytes = randomBytes(2048);
		const localPath = join(tempDir, "photo.png");
		await writeFile(localPath, bytes);

		signInAs(ownerId);
		const res = await (
			await post("/api/command/FileUpload", {
				spaceId,
				localPath,
				type: 2, // I.FileType.Image
				imageKind: 0,
				details: { name: "photo.png" },
			})
		).json();

		expect(res.error).toEqual({ code: 0, description: "" });
		const objectId = res.objectId as string;
		expect(typeof objectId).toBe("string");
		expect(objectId.length).toBeGreaterThan(0);

		// The bytes come back verbatim with the content-type the <img> needs.
		const served = await get(`/api/file/${objectId}`);
		expect(served.status).toBe(200);
		expect(served.headers.get("content-type")).toBe("image/png");
		const servedBytes = Buffer.from(await served.arrayBuffer());
		expect(servedBytes.equals(bytes)).toBe(true);

		// The record projects the file metadata the shell reads (util/file.ts).
		const records = await subscribeIds(spaceId, [objectId]);
		const record = records.records.find((it: any) => it.id === objectId);
		expect(record?.layout).toBe(8); // I.ObjectLayout.Image
		expect(record?.name).toBe("photo.png");
		expect(record?.fileExt).toBe("png");
		expect(record?.fileMimeType).toBe("image/png");
		expect(record?.sizeInBytes).toBe(bytes.length);
	});

	it("answers NOT_FOUND for an unknown file id", async () => {
		const res = await get("/api/file/does-not-exist");
		expect(res.status).toBe(404);
	});

	it("denies a caller who cannot write the space", async () => {
		const spaceId = await createSpace();
		const bytes = randomBytes(64);
		const localPath = join(tempDir, "guarded.png");
		await writeFile(localPath, bytes);

		signInAs(outsiderId);
		const res = await (
			await post("/api/command/FileUpload", {
				spaceId,
				localPath,
				type: 2,
				imageKind: 0,
				details: { name: "guarded.png" },
			})
		).json();
		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});

	it("writes the file id onto the context object's iconImage detail for an icon picker", async () => {
		const spaceId = await createSpace();

		signInAs(ownerId);
		const { objectId: contextId } = await (
			await post("/api/command/ObjectCreate", {
				spaceId,
				details: { name: "Decorated page" },
			})
		).json();

		const bytes = randomBytes(128);
		const localPath = join(tempDir, "icon.png");
		await writeFile(localPath, bytes);

		const res = await (
			await post("/api/command/FileUpload", {
				spaceId,
				localPath,
				type: 2,
				imageKind: 2, // I.ImageKind.Icon
				createdInContext: contextId,
				createdInContextRef: "iconImage",
				details: { name: "icon.png" },
			})
		).json();
		const fileId = res.objectId as string;

		const records = await subscribeIds(spaceId, [contextId as string]);
		const context = records.records.find((it: any) => it.id === contextId);
		expect(context?.iconImage).toBe(fileId);
	});

	it("fetches an http url's bytes, stores them, and derives the name from the path", async () => {
		const spaceId = await createSpace();
		const bytes = randomBytes(512);

		// A real ephemeral server on loopback: no external network, and the fetch
		// path inside FileUpload runs against actual HTTP (popup/upload.tsx onSubmitUrl).
		let server: Server;
		const url = await new Promise<string>((resolve, reject) => {
			server = createServer((req, res) => {
				if (req.url === "/pic.png") {
					res.writeHead(200, { "Content-Type": "image/png" });
					res.end(bytes);
					return;
				}
				res.writeHead(404).end();
			});
			server.on("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				const port = typeof address === "object" && address ? address.port : 0;
				resolve(`http://127.0.0.1:${port}/pic.png`);
			});
		});

		try {
			signInAs(ownerId);
			const res = await (
				await post("/api/command/FileUpload", {
					spaceId,
					url,
					type: 2, // I.FileType.Image
					imageKind: 0,
					// no details.name: the name must come from the url path's basename
				})
			).json();

			expect(res.error).toEqual({ code: 0, description: "" });
			const objectId = res.objectId as string;

			const served = await get(`/api/file/${objectId}`);
			expect(served.status).toBe(200);
			expect(served.headers.get("content-type")).toBe("image/png");
			const servedBytes = Buffer.from(await served.arrayBuffer());
			expect(servedBytes.equals(bytes)).toBe(true);

			const records = await subscribeIds(spaceId, [objectId]);
			const record = records.records.find((it: any) => it.id === objectId);
			expect(record?.layout).toBe(8); // I.ObjectLayout.Image
			expect(record?.name).toBe("pic.png");
			expect(record?.fileExt).toBe("png");
			expect(record?.fileMimeType).toBe("image/png");
			expect(record?.sizeInBytes).toBe(bytes.length);
		} finally {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
	});
});
