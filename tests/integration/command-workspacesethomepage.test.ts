import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The first-run home popup and the space settings menu send WorkspaceSetHomepage({ spaceId,
// homepage }) to choose what the space opens on (popup/space/home.tsx:53 sets it to a freshly
// created home object; :69 sets it to I.HomePredefinedId.Widget === "widgets", a predefined
// marker that is NOT a real object; lib/util/menu.ts:700 sets it from the space menu). It is
// write-only (no response mapper). The shell reads it back as space.homepage off the spaceview
// record (space.ts:217) served by ObjectSearchSubscribe subId="space". There is no homepage
// column on Space, so a faithful answer persists it on the space's hidden spaceView object
// details and projects it back through that subscription — a marker string is stored verbatim
// without requiring an object of that id to exist. Setting the home is a space-info edit, so it
// is owner-gated like WorkspaceSetInfo (the client gates on U.Space.isMyOwner): a writer member
// and a non-member are both FORBIDDEN and leave the homepage unchanged.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/WorkspaceSetHomepage",
	() => {
		const ownerId = "set-homepage.owner";
		const writerId = "set-homepage.writer";
		const outsiderId = "set-homepage.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: ownerId,
						name: "Homepage owner",
						email: "set-homepage-owner@vanlife.test",
					},
					{
						id: writerId,
						name: "Homepage writer",
						email: "set-homepage-writer@vanlife.test",
					},
					{
						id: outsiderId,
						name: "Homepage outsider",
						email: "set-homepage-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: ownerId } });
			await prisma.user.deleteMany({
				where: { id: { in: [ownerId, writerId, outsiderId] } },
			});
		});

		const createSpace = async (name: string) => {
			signInAs(ownerId);
			const { spaceId } = await (
				await post("/api/command/WorkspaceCreate", {
					details: { name },
					useCase: 2,
				})
			).json();
			return spaceId as string;
		};

		const createObject = async (spaceId: string, name: string) => {
			signInAs(ownerId);
			const created = await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name },
				})
			).json();
			return created.objectId as string;
		};

		const setHomepage = async (spaceId: string, homepage: string) => {
			signInAs(ownerId);
			return (
				await post("/api/command/WorkspaceSetHomepage", { spaceId, homepage })
			).json();
		};

		const readHomepage = async (spaceId: string) => {
			signInAs(ownerId);
			const sub = await (
				await post("/api/command/ObjectSearchSubscribe", {
					subId: "space",
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();
			const record = sub.records.find(
				(it: any) => it.targetSpaceId === spaceId,
			);
			return record?.homepage;
		};

		it("persists a real object as the space homepage and reads it back", async () => {
			const spaceId = await createSpace("Home");
			const homeObjectId = await createObject(spaceId, "Welcome");

			const body = await setHomepage(spaceId, homeObjectId);
			expect(body.error).toEqual({ code: 0, description: "" });

			expect(await readHomepage(spaceId)).toBe(homeObjectId);
		});

		it("stores a predefined marker verbatim without an object of that id", async () => {
			const spaceId = await createSpace("Widgets home");

			const body = await setHomepage(spaceId, "widgets");
			expect(body.error).toEqual({ code: 0, description: "" });

			expect(await readHomepage(spaceId)).toBe("widgets");
		});

		it("overwrites a previously set homepage", async () => {
			const spaceId = await createSpace("Reassign");
			const first = await createObject(spaceId, "First");
			const second = await createObject(spaceId, "Second");
			await setHomepage(spaceId, first);

			await setHomepage(spaceId, second);
			expect(await readHomepage(spaceId)).toBe(second);
		});

		it("denies a writer member and leaves the homepage unchanged", async () => {
			const spaceId = await createSpace("Owner only");
			const homeObjectId = await createObject(spaceId, "Welcome");
			await setHomepage(spaceId, homeObjectId);
			await prisma.spaceMember.create({
				data: {
					spaceId,
					userId: writerId,
					permission: "writer",
					status: "active",
				},
			});

			signInAs(writerId);
			const body = await (
				await post("/api/command/WorkspaceSetHomepage", {
					spaceId,
					homepage: "widgets",
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			expect(await readHomepage(spaceId)).toBe(homeObjectId);
		});

		it("denies a non-member and leaves the homepage unchanged", async () => {
			const spaceId = await createSpace("Fortress");
			const homeObjectId = await createObject(spaceId, "Welcome");
			await setHomepage(spaceId, homeObjectId);

			signInAs(outsiderId);
			const body = await (
				await post("/api/command/WorkspaceSetHomepage", {
					spaceId,
					homepage: "widgets",
				})
			).json();
			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});

			expect(await readHomepage(spaceId)).toBe(homeObjectId);
		});
	},
);
