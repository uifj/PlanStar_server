import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Create and open are the first commands that touch real document data: the shell's
// sidebar create button and type menu both funnel into ObjectCreate /
// BlockLinkCreateWithObject, and EditorPage renders whatever ObjectOpen returns as an
// objectView. The shim must persist real Obj/Block rows and hand back the proto-shaped
// envelope the Response mappers read, not a stub.
describe.skipIf(!databaseAvailable)("POST /api/command/:name object lifecycle", () => {
	const userId = "command-object.owner";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Object owner",
				email: "command-object@vanlife.test",
			},
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: userId } });
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	it("creates a page object bound to the caller's space", async () => {
		signInAs(userId);

		const response = await post("/api/command/ObjectCreate", {
			details: { name: "Trip notes" },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error).toEqual({ code: 0, description: "" });

		const objectId = body.objectId;
		expect(typeof objectId).toBe("string");
		expect(objectId.length).toBeGreaterThan(0);
		// The ObjectCreate mapper reads objectId plus a struct-encoded details whose
		// id downstream code uses to open the object.
		expect(body.details.id).toBe(objectId);
		// I.ObjectLayout.Page === 0 in the client enum.
		expect(body.details.layout).toBe(0);

		const obj = await prisma.obj.findUnique({ where: { id: objectId } });
		expect(obj).not.toBeNull();
		expect(obj?.name).toBe("Trip notes");

		const space = await prisma.space.findFirst({ where: { createdBy: userId } });
		expect(obj?.spaceId).toBe(space?.id);
	});

	it("creates an object through the sidebar link-create path", async () => {
		signInAs(userId);

		const response = await post("/api/command/BlockLinkCreateWithObject", {
			contextId: "",
			targetId: "",
			details: { name: "Linked page" },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error).toEqual({ code: 0, description: "" });

		// The mapper reads blockId/targetId/details; with an empty context no link
		// block is produced, so targetId is the new object itself.
		expect(body.details.id).toBe(body.targetId);

		const obj = await prisma.obj.findUnique({ where: { id: body.targetId } });
		expect(obj?.name).toBe("Linked page");
	});

	it("opens an object with its document blocks", async () => {
		signInAs(userId);

		const created = await (
			await post("/api/command/ObjectCreate", { details: { name: "Doc" } })
		).json();
		const objectId = created.objectId;

		const block = await prisma.block.create({
			data: {
				objectId,
				type: "text",
				style: "paragraph",
				text: "First paragraph",
				index: "a0",
			},
		});

		const response = await post("/api/command/ObjectOpen", { objectId });

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error).toEqual({ code: 0, description: "" });

		const view = body.objectView;
		expect(view.rootId).toBe(objectId);

		// The root block is a smartblock whose children are the top-level blocks.
		const root = view.blocks.find((b: any) => b.id === objectId);
		expect(root).toBeDefined();
		expect(root.childrenIds).toContain(block.id);

		// Text blocks carry their content under the `text` prop the Block mapper keys on.
		const textBlock = view.blocks.find((b: any) => b.id === block.id);
		expect(textBlock.text.text).toBe("First paragraph");

		// details is an array of {id, details} including the root object.
		const rootDetails = view.details.find((d: any) => d.id === objectId);
		expect(rootDetails).toBeDefined();
		expect(rootDetails.details.name).toBe("Doc");
	});

	it("answers a missing object with an error envelope", async () => {
		signInAs(userId);

		const response = await post("/api/command/ObjectOpen", {
			objectId: "not-a-real-object",
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.error.code).not.toBe(0);
	});
});
