import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// A board view asks ObjectGroupsSubscribe for the columns of its group relation
// (dataview.ts:483). Each group is mapped by Mapper.From.BoardGroup, which reads
// obj.status.id as the column's value for a select relation. The shim must answer
// with one status group per option of the relation so the board renders a column
// per option.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/ObjectGroupsSubscribe",
	() => {
		const owner = "board-groups.owner";
		const outsider = "board-groups.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{ id: owner, name: "Board owner", email: "board-owner@vanlife.test" },
					{
						id: outsider,
						name: "Board outsider",
						email: "board-outsider@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.space.deleteMany({ where: { createdBy: owner } });
			await prisma.user.deleteMany({
				where: { id: { in: [owner, outsider] } },
			});
		});

		const provisionBoard = async () => {
			signInAs(owner);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			const spaceId = account.info.accountSpaceId as string;
			await prisma.relation.upsert({
				where: { spaceId_uniqueKey: { spaceId, uniqueKey: "status" } },
				create: {
					spaceId,
					uniqueKey: "status",
					name: "Status",
					format: "select",
				},
				update: {},
			});
			return spaceId;
		};

		it("returns one status group per option of the group relation", async () => {
			const spaceId = await provisionBoard();

			const available = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "status",
						name: "Available",
						relationOptionColor: "green",
					},
				})
			).json();
			const sold = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "status",
						name: "Sold",
						relationOptionColor: "grey",
					},
				})
			).json();

			const body = await (
				await post("/api/command/ObjectGroupsSubscribe", {
					spaceId,
					subId: `board-groups-${spaceId}`,
					relationKey: "status",
					filters: [],
					source: [],
					collectionId: "",
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.subId).toBe(`board-groups-${spaceId}`);
			expect(body.groups).toHaveLength(2);

			const byId = Object.fromEntries(
				body.groups.map((group: any) => [group.id, group]),
			);
			expect(byId[available.objectId]).toEqual({
				id: available.objectId,
				status: { id: available.objectId },
			});
			expect(byId[sold.objectId]).toEqual({
				id: sold.objectId,
				status: { id: sold.objectId },
			});
		});

		it("returns tag groups carrying the option id in an array for a multiSelect relation", async () => {
			const spaceId = await provisionBoard();
			// A board grouped on a multiSelect (tag) relation: Mapper.From.BoardGroup reads
			// obj.tag.ids as the column's value (mapper.ts:496), so each group must carry the
			// tag shape, not the status shape a select relation uses.
			await prisma.relation.upsert({
				where: { spaceId_uniqueKey: { spaceId, uniqueKey: "labels" } },
				create: {
					spaceId,
					uniqueKey: "labels",
					name: "Labels",
					format: "multiSelect",
				},
				update: {},
			});

			const urgent = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "labels",
						name: "Urgent",
						relationOptionColor: "red",
					},
				})
			).json();

			const body = await (
				await post("/api/command/ObjectGroupsSubscribe", {
					spaceId,
					subId: `board-groups-${spaceId}`,
					relationKey: "labels",
					filters: [],
					source: [],
					collectionId: "",
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });
			expect(body.groups).toEqual([
				{ id: urgent.objectId, tag: { ids: [urgent.objectId] } },
			]);
		});

		it("forbids a non-member from subscribing to the board groups", async () => {
			const spaceId = await provisionBoard();

			signInAs(outsider);
			const body = await (
				await post("/api/command/ObjectGroupsSubscribe", {
					spaceId,
					subId: `board-groups-${spaceId}`,
					relationKey: "status",
					filters: [],
					source: [],
					collectionId: "",
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
