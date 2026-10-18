import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { get, post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The browser file dialog has no filesystem, so it stages the picked file's base64 to
// POST /api/web-upload (lib/web/electronMock.ts uploadFileToServer), which writes the bytes
// under the staging root and returns { path }. That path is then handed to C.FileUpload as
// localPath. In production this endpoint must live on the hono backend, not only in the
// Vite dev middleware, or the web client cannot upload at all.
describe.skipIf(!databaseAvailable)("POST /api/web-upload", () => {
	const ownerId = "web-up.owner";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{
					id: ownerId,
					name: "Web upload owner",
					email: "web-up-owner@vanlife.test",
				},
			],
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({ where: { id: ownerId } });
	});

	const createSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Web upload space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	it("stages base64 to a server path that FileUpload then serves at /file/:id", async () => {
		const spaceId = await createSpace();
		const bytes = randomBytes(1024);

		signInAs(ownerId);
		const staged = await (
			await post("/api/web-upload", {
				filename: "diagram.png",
				content: bytes.toString("base64"),
			})
		).json();

		expect(typeof staged.path).toBe("string");
		expect(staged.path.length).toBeGreaterThan(0);
		// The bytes really landed on disk at the returned path.
		expect(Buffer.from(await readFile(staged.path)).equals(bytes)).toBe(true);

		const uploaded = await (
			await post("/api/command/FileUpload", {
				spaceId,
				localPath: staged.path,
				type: 2,
				imageKind: 0,
				details: { name: "diagram.png" },
			})
		).json();
		const objectId = uploaded.objectId as string;

		const served = await get(`/api/file/${objectId}`);
		expect(served.status).toBe(200);
		expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
	});

	it("keeps a traversal filename inside the staging root", async () => {
		const bytes = randomBytes(16);

		signInAs(ownerId);
		const staged = await (
			await post("/api/web-upload", {
				filename: "../../../../etc/evil.png",
				content: bytes.toString("base64"),
			})
		).json();

		const root = resolve(env.FILE_UPLOAD_STAGING_ROOT);
		expect(resolve(staged.path).startsWith(root)).toBe(true);
	});

	it("rejects a request missing filename or content", async () => {
		signInAs(ownerId);
		const res = await post("/api/web-upload", { filename: "only-name.png" });
		expect(res.status).toBe(400);
	});
});
