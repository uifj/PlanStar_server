import { describe, expect, it } from "vitest";
import { ensureSpaceAccess } from "../../../src/auth/space-access.js";
import { prismaMock } from "../../mocks/prismaMock.js";

describe("ensureSpaceAccess", () => {
	it("forbids a reader who asks for writer", async () => {
		// Arrange
		prismaMock.spaceMember.findFirst.mockResolvedValue({
			id: "member-1",
			spaceId: "space-1",
			userId: "user-1",
			permission: "reader",
			status: "active",
		});

		// Act
		const attempt = ensureSpaceAccess("user-1", "space-1", "writer");

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 403 });
	});

	it("reports not found when the space does not exist", async () => {
		// Arrange
		prismaMock.spaceMember.findFirst.mockResolvedValue(null);
		prismaMock.space.count.mockResolvedValue(0);

		// Act
		const attempt = ensureSpaceAccess("user-1", "space-1", "reader");

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 404 });
	});

	it("forbids a stranger to an existing space", async () => {
		// Arrange
		prismaMock.spaceMember.findFirst.mockResolvedValue(null);
		prismaMock.space.count.mockResolvedValue(1);

		// Act
		const attempt = ensureSpaceAccess("user-2", "space-1", "reader");

		// Assert
		await expect(attempt).rejects.toMatchObject({ statusCode: 403 });
		await expect(prismaMock.spaceMember.findFirst).toHaveBeenCalledWith({
			where: { spaceId: "space-1", userId: "user-2", status: "active" },
		});
	});

	it("returns the membership when the rank is high enough", async () => {
		// Arrange
		const member = {
			id: "member-2",
			spaceId: "space-1",
			userId: "user-1",
			permission: "owner",
			status: "active",
		};
		prismaMock.spaceMember.findFirst.mockResolvedValue(member);

		// Act
		const result = await ensureSpaceAccess("user-1", "space-1", "admin");

		// Assert
		expect(result).toBe(member);
	});
});
