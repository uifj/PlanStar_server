import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../../src/lib/auth.js";
import { objectService } from "../../../src/modules/objects/service.js";
import { prismaMock } from "../../mocks/prismaMock.js";

const user = { id: "user-1" } as AuthUser;

function ownerOfSpace() {
	prismaMock.spaceMember.findFirst.mockResolvedValue({
		id: "member-1",
		spaceId: "space-1",
		userId: user.id,
		permission: "owner",
		status: "active",
	});
}

function register(relation: {
	uniqueKey: string;
	format: string;
	maxCount?: number | null;
}) {
	prismaMock.relation.findMany.mockResolvedValue([
		{ maxCount: null, ...relation },
	]);
}

function captureCreated() {
	prismaMock.obj.create.mockImplementation(({ data }: { data: never }) =>
		Promise.resolve({
			id: "obj-1",
			spaceId: "space-1",
			typeId: null,
			layout: null,
			resolvedLayout: "basic",
			name: "",
			description: null,
			snippet: null,
			iconEmoji: null,
			isArchived: false,
			isDeleted: false,
			isHidden: false,
			isFavorite: false,
			done: null,
			creatorId: user.id,
			createdAt: new Date("2026-10-13T00:00:00.000Z"),
			updatedAt: new Date("2026-10-13T00:00:00.000Z"),
			...data,
		}),
	);
}

describe("object details", () => {
	it("keeps a single select value as a one-element array", async () => {
		// Arrange
		ownerOfSpace();
		register({ uniqueKey: "status", format: "select" });
		captureCreated();

		// Act
		const object = await objectService.create(user, "space-1", {
			name: "Iceland",
			details: { status: "planned" },
		});

		// Assert
		expect(object.details).toEqual({ status: ["planned"] });
	});

	it("truncates a multi-select to the relation's max count", async () => {
		// Arrange
		ownerOfSpace();
		register({ uniqueKey: "tags", format: "multiSelect", maxCount: 2 });
		captureCreated();

		// Act
		const object = await objectService.create(user, "space-1", {
			details: { tags: ["a", "b", "c"] },
		});

		// Assert
		expect(object.details).toEqual({ tags: ["a", "b"] });
	});

	it("rejects a detail key the space has not registered", async () => {
		// Arrange
		ownerOfSpace();
		register({ uniqueKey: "status", format: "select" });

		// Act
		const attempt = objectService.create(user, "space-1", {
			details: { ghost: 1 },
		});

		// Assert
		await expect(attempt).rejects.toMatchObject({
			statusCode: 422,
			message: "Unknown relation: ghost",
		});
	});

	it("rejects a scalar written to a column-backed relation", async () => {
		// Arrange
		ownerOfSpace();
		register({ uniqueKey: "status", format: "select" });

		// Act
		const attempt = objectService.create(user, "space-1", {
			details: { name: "sneaky" },
		});

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 422 });
	});

	it("writes object relations as edges instead of duplicating them into details", async () => {
		// Arrange
		ownerOfSpace();
		register({ uniqueKey: "related", format: "object" });
		captureCreated();
		prismaMock.obj.findMany.mockResolvedValue([
			{ id: "obj-a" },
			{ id: "obj-b" },
		]);

		// Act
		await objectService.create(user, "space-1", {
			details: { related: ["obj-a", "obj-b"] },
		});

		// Assert — the JSONB map must not carry a second copy of the edge list
		expect(prismaMock.obj.create.mock.calls[0][0].data.details).toEqual({});
		expect(prismaMock.link.createMany.mock.calls[0][0].data).toEqual([
			expect.objectContaining({
				fromId: "obj-1",
				relationKey: "related",
				toId: "obj-a",
				sortOrder: "0001",
			}),
			expect.objectContaining({ toId: "obj-b", sortOrder: "0002" }),
		]);
	});
});
