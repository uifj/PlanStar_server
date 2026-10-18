import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Publishing is the "share to web" surface (menu/publish.tsx, settings/data/publish.tsx). The
// self-hosted backend has no any.co network, so PublishingCreate binds an object to a public slug
// (stored on PublishedObject) and returns the gateway URL the client opens with Action.openUrl.
// The slug round-trips as PublishState.uri; the returned top-level uri is the absolute serve URL.
describe.skipIf(!databaseAvailable)("POST /api/command Publishing", () => {
	const ownerId = "pub.owner";
	const outsiderId = "pub.outsider";

	beforeAll(async () => {
		await prisma.user.createMany({
			data: [
				{ id: ownerId, name: "Pub owner", email: "pub@vanlife.test" },
				{
					id: outsiderId,
					name: "Pub outsider",
					email: "pub-outsider@vanlife.test",
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

	const provisionSpace = async () => {
		signInAs(ownerId);
		const { spaceId } = await (
			await post("/api/command/WorkspaceCreate", {
				details: { name: "Publish space" },
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

	it("publishes an object at a slug and persists the binding", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Public page");

		signInAs(ownerId);
		const res = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId,
				uri: "public-page",
				joinSpace: false,
			})
		).json();

		expect(res.error).toEqual({ code: 0, description: "" });
		expect(res.uri).toBe(`${env.APP_URL}/api/publish/public-page`);

		const row = await prisma.publishedObject.findUnique({
			where: { spaceId_objectId: { spaceId, objectId } },
		});
		expect(row).not.toBeNull();
		expect(row?.uri).toBe("public-page");
		expect(row?.joinSpace).toBe(false);
		expect(row?.version).toBe(1);
		expect(row?.publishedBy).toBe(ownerId);
		expect(Number(row?.timestamp)).toBeGreaterThan(0);
	});

	it("re-publishing the same object upserts and bumps the version", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Republished");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "first-slug",
			joinSpace: false,
		});
		const res = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId,
				uri: "second-slug",
				joinSpace: true,
			})
		).json();

		expect(res.error).toEqual({ code: 0, description: "" });
		expect(res.uri).toBe(`${env.APP_URL}/api/publish/second-slug`);

		const rows = await prisma.publishedObject.findMany({
			where: { spaceId, objectId },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].uri).toBe("second-slug");
		expect(rows[0].joinSpace).toBe(true);
		expect(rows[0].version).toBe(2);
	});

	it("refuses a caller who cannot write to the space", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Guarded");

		signInAs(outsiderId);
		const res = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId,
				uri: "guarded",
				joinSpace: false,
			})
		).json();

		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(res.uri).toBeUndefined();
		const row = await prisma.publishedObject.findUnique({
			where: { spaceId_objectId: { spaceId, objectId } },
		});
		expect(row).toBeNull();
	});

	it("refuses to publish an object that is not in the space", async () => {
		const spaceId = await provisionSpace();

		signInAs(ownerId);
		const res = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId: "missing-object",
				uri: "nope",
				joinSpace: false,
			})
		).json();

		expect(res.error).toEqual({ code: 3, description: "Object not found." });
	});

	it("refuses a slug already published by another object", async () => {
		const spaceId = await provisionSpace();
		const a = await createObject(spaceId, "A");
		const b = await createObject(spaceId, "B");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId: a,
			uri: "taken",
			joinSpace: false,
		});
		const res = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId: b,
				uri: "taken",
				joinSpace: false,
			})
		).json();

		expect(res.error.code).toBe(1);
		expect(res.uri).toBeUndefined();
	});

	it("refuses an empty or path-breaking slug", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Bad slug");

		signInAs(ownerId);
		const empty = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId,
				uri: "   ",
				joinSpace: false,
			})
		).json();
		expect(empty.error.code).toBe(1);

		const slashed = await (
			await post("/api/command/PublishingCreate", {
				spaceId,
				objectId,
				uri: "a/b",
				joinSpace: false,
			})
		).json();
		expect(slashed.error.code).toBe(1);

		const row = await prisma.publishedObject.findUnique({
			where: { spaceId_objectId: { spaceId, objectId } },
		});
		expect(row).toBeNull();
	});

	it("returns the publish state for a published object, or null when unpublished", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Status page");

		signInAs(ownerId);
		const before = await (
			await post("/api/command/PublishingGetStatus", { spaceId, objectId })
		).json();
		expect(before.error).toEqual({ code: 0, description: "" });
		expect(before.publish).toBeNull();

		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "status-page",
			joinSpace: true,
		});

		const after = await (
			await post("/api/command/PublishingGetStatus", { spaceId, objectId })
		).json();
		expect(after.error).toEqual({ code: 0, description: "" });
		expect(after.publish).not.toBeNull();
		// PublishState.uri is the slug (round-trips into the menu input), not the serve URL.
		expect(after.publish.uri).toBe("status-page");
		expect(after.publish.status).toBe(1);
		expect(after.publish.version).toBe("1");
		expect(after.publish.spaceId).toBe(spaceId);
		expect(after.publish.objectId).toBe(objectId);
		expect(after.publish.joinSpace).toBe(true);
		expect(typeof after.publish.timestamp).toBe("number");
		expect(typeof after.publish.size).toBe("number");
		expect(after.publish.details.id).toBe(objectId);
		expect(after.publish.details.name).toBe("Status page");
	});

	it("gates publish status on space read access", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Guarded status");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "guarded-status",
			joinSpace: false,
		});

		signInAs(outsiderId);
		const res = await (
			await post("/api/command/PublishingGetStatus", { spaceId, objectId })
		).json();
		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(res.publish).toBeUndefined();
	});

	it("unpublishes an object so its status clears", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Removable");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "removable",
			joinSpace: false,
		});

		const removed = await (
			await post("/api/command/PublishingRemove", { spaceId, objectId })
		).json();
		expect(removed.error).toEqual({ code: 0, description: "" });

		const row = await prisma.publishedObject.findUnique({
			where: { spaceId_objectId: { spaceId, objectId } },
		});
		expect(row).toBeNull();

		const status = await (
			await post("/api/command/PublishingGetStatus", { spaceId, objectId })
		).json();
		expect(status.publish).toBeNull();
	});

	it("treats unpublishing an unpublished object as a no-op", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Never published");

		signInAs(ownerId);
		const res = await (
			await post("/api/command/PublishingRemove", { spaceId, objectId })
		).json();
		expect(res.error).toEqual({ code: 0, description: "" });
	});

	it("gates unpublish on space write access", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Guarded remove");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "guarded-remove",
			joinSpace: false,
		});

		signInAs(outsiderId);
		const res = await (
			await post("/api/command/PublishingRemove", { spaceId, objectId })
		).json();
		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});

		const row = await prisma.publishedObject.findUnique({
			where: { spaceId_objectId: { spaceId, objectId } },
		});
		expect(row).not.toBeNull();
	});

	it("lists the caller's published objects across their spaces when spaceId is empty", async () => {
		const spaceA = await provisionSpace();
		const objA = await createObject(spaceA, "Listed A");
		const spaceB = await provisionSpace();
		const objB = await createObject(spaceB, "Listed B");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId: spaceA,
			objectId: objA,
			uri: "listed-a",
			joinSpace: false,
		});
		await post("/api/command/PublishingCreate", {
			spaceId: spaceB,
			objectId: objB,
			uri: "listed-b",
			joinSpace: true,
		});

		// settings/data/publish.tsx calls PublishingList('') — an empty spaceId means "all my spaces",
		// membership-scoped like ObjectCrossSpaceSearch.
		const res = await (
			await post("/api/command/PublishingList", { spaceId: "" })
		).json();
		expect(res.error).toEqual({ code: 0, description: "" });
		expect(Array.isArray(res.publishes)).toBe(true);

		const uris = res.publishes.map((p) => p.uri);
		expect(uris).toContain("listed-a");
		expect(uris).toContain("listed-b");

		const a = res.publishes.find((p) => p.uri === "listed-a");
		expect(a.objectId).toBe(objA);
		expect(a.spaceId).toBe(spaceA);
		expect(a.status).toBe(1);
		expect(a.joinSpace).toBe(false);
		expect(a.details.name).toBe("Listed A");

		const b = res.publishes.find((p) => p.uri === "listed-b");
		expect(b.joinSpace).toBe(true);
	});

	it("lists only one space's publishes when spaceId is given", async () => {
		const spaceA = await provisionSpace();
		const objA = await createObject(spaceA, "Scoped A");
		const spaceB = await provisionSpace();
		const objB = await createObject(spaceB, "Scoped B");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId: spaceA,
			objectId: objA,
			uri: "scoped-a",
			joinSpace: false,
		});
		await post("/api/command/PublishingCreate", {
			spaceId: spaceB,
			objectId: objB,
			uri: "scoped-b",
			joinSpace: false,
		});

		const res = await (
			await post("/api/command/PublishingList", { spaceId: spaceA })
		).json();
		expect(res.error).toEqual({ code: 0, description: "" });
		expect(res.publishes.map((p) => p.uri)).toEqual(["scoped-a"]);
	});

	it("does not leak another member's publishes into an empty-spaceId list", async () => {
		const spaceA = await provisionSpace();
		const objA = await createObject(spaceA, "Private publish");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId: spaceA,
			objectId: objA,
			uri: "private-publish",
			joinSpace: false,
		});

		// The outsider shares no space with the owner, so their account-wide list is empty.
		signInAs(outsiderId);
		const res = await (
			await post("/api/command/PublishingList", { spaceId: "" })
		).json();
		expect(res.error).toEqual({ code: 0, description: "" });
		expect(res.publishes.map((p) => p.uri)).not.toContain("private-publish");
	});

	it("gates a single-space list on read access", async () => {
		const spaceId = await provisionSpace();
		const objectId = await createObject(spaceId, "Guarded list");

		signInAs(ownerId);
		await post("/api/command/PublishingCreate", {
			spaceId,
			objectId,
			uri: "guarded-list",
			joinSpace: false,
		});

		signInAs(outsiderId);
		const res = await (
			await post("/api/command/PublishingList", { spaceId })
		).json();
		expect(res.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
		expect(res.publishes).toBeUndefined();
	});
});
