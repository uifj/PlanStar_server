import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// Removing an option from a relation's editor sends
// RelationListRemoveOption({ optionIds, checkInObjects }) (command.ts:1230). The command
// carries no spaceId, so the shim reads each option's space off its row and requires the
// caller to be able to write it. The deleted option must disappear from the option
// subscription so a reload no longer offers it.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/RelationListRemoveOption",
	() => {
		const owner = "relation-remove.owner";
		const outsider = "relation-remove.outsider";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: owner,
						name: "Remove owner",
						email: "remove-owner@vanlife.test",
					},
					{
						id: outsider,
						name: "Remove outsider",
						email: "remove-outsider@vanlife.test",
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

		const provisionSpace = async () => {
			signInAs(owner);
			const { account } = await (
				await post("/api/command/AccountSelect", {})
			).json();
			const spaceId = account.info.accountSpaceId as string;
			await prisma.relation.upsert({
				where: { spaceId_uniqueKey: { spaceId, uniqueKey: "stage" } },
				create: {
					spaceId,
					uniqueKey: "stage",
					name: "Stage",
					format: "select",
				},
				update: {},
			});
			return spaceId;
		};

		const createOption = async (spaceId: string, name: string) => {
			const created = await (
				await post("/api/command/ObjectCreateRelationOption", {
					spaceId,
					details: {
						relationKey: "stage",
						name,
						relationOptionColor: "grey",
					},
				})
			).json();
			return created.objectId as string;
		};

		it("deletes the named option so it leaves the option subscription", async () => {
			const spaceId = await provisionSpace();
			const keep = await createOption(spaceId, "Keep");
			const remove = await createOption(spaceId, "Remove");

			const body = await (
				await post("/api/command/RelationListRemoveOption", {
					optionIds: [remove],
					checkInObjects: false,
				})
			).json();

			expect(body.error).toEqual({ code: 0, description: "" });

			const subscribed = await (
				await post("/api/command/ObjectSearchSubscribe", {
					spaceId,
					subId: `option-${spaceId}`,
					filters: [],
					sorts: [],
					keys: [],
				})
			).json();

			expect(subscribed.records.map((it: any) => it.id)).toEqual([keep]);
		});

		it("forbids a non-member from removing an option", async () => {
			const spaceId = await provisionSpace();
			const guarded = await createOption(spaceId, "Guarded");

			signInAs(outsider);
			const body = await (
				await post("/api/command/RelationListRemoveOption", {
					optionIds: [guarded],
					checkInObjects: false,
				})
			).json();

			expect(body.error).toEqual({
				code: 2,
				description: "Object access denied.",
			});
		});
	},
);
