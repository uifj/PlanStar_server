import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../src/lib/prisma.js";
import { signedOut, signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { get, post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The self-hosted equivalent of the any.co publish network: PublishingCreate binds an object to a
// slug and returns `${APP_URL}/api/publish/<slug>`, and the client opens that URL with
// Action.openUrl. This route serves it — publicly, with no session — as the published object's
// projected content, decoding the body from its stored Yjs document (ADR-0018).
function tiptapState(blocks: string[][]): Uint8Array {
	const doc = new Y.Doc();
	const fragment = doc.getXmlFragment("default");
	for (const runs of blocks) {
		const paragraph = new Y.XmlElement("paragraph");
		runs.forEach((text, index) => {
			paragraph.insert(index, [new Y.XmlText(text)]);
		});
		fragment.push([paragraph]);
	}
	return Y.encodeStateAsUpdate(doc);
}

describe.skipIf(!databaseAvailable)("GET /api/publish/:uri", () => {
	const ownerId = "serve.owner";

	beforeAll(async () => {
		await prisma.user.create({
			data: { id: ownerId, name: "Serve owner", email: "serve@vanlife.test" },
		});
	});

	afterAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: ownerId } });
		await prisma.user.deleteMany({ where: { id: ownerId } });
	});

	const provisionSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Serve space" },
				useCase: 2,
			})
		).json();
		return spaceId as string;
	};

	const createObject = async (spaceId: string, name: string) => {
		signInAs(ownerId);
		const { objectId } = await (
			await post("/api/command/ObjectCreate", { spaceId, details: { name } })
		).json();
		return objectId as string;
	};

	const seedBody = async (objectId: string, blocks: string[][]) => {
		await prisma.documentState.create({
			data: { objectId, state: Buffer.from(tiptapState(blocks)) },
		});
	};

	it("serves a published object's content to an anonymous caller", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Served page");
		await seedBody(objectId, [["Hello published world"]]);

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "served-page",
			joinSpace: true,
		});

		// The route is public: no session is presented, proving it does not require auth.
		signedOut();
		const res = await get("/api/publish/served-page");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.uri).toBe("served-page");
		expect(body.objectId).toBe(objectId);
		expect(body.spaceId).toBe(spaceId);
		expect(body.name).toBe("Served page");
		expect(body.joinSpace).toBe(true);
		// The body is decoded from the stored Yjs document, not returned as raw bytes.
		expect(body.body).toBe("Hello published world");
		expect(body.details.id).toBe(objectId);
		expect(body.details.name).toBe("Served page");
	});

	it("returns 404 for an unknown slug", async () => {
		signedOut();
		const res = await get("/api/publish/does-not-exist");
		expect(res.status).toBe(404);
	});

	it("stops serving an object once it is unpublished", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Retracted page");
		await seedBody(objectId, [["Temporary"]]);

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "retracted-page",
			joinSpace: false,
		});
		await post("/api/command/PublishingRemove", { spaceId, objectId });

		signedOut();
		const res = await get("/api/publish/retracted-page");
		expect(res.status).toBe(404);
	});
});
