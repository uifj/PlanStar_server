import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { objectService } from "../../src/modules/objects/service.js";
import { vanLifeService } from "../../src/modules/vanlife/service.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { createRenter, createVanLifeHost } from "./helpers/vanlife-data.js";

const databaseAvailable = await isDatabaseAvailable();

function asAuthUser(user: {
	id: string;
	name: string;
	email: string;
	role: string | null;
}): AuthUser {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: true,
		image: null,
		role: user.role,
	} as AuthUser;
}

describe.skipIf(!databaseAvailable)("the shared VanLife space", () => {
	let host: AuthUser;
	let renter: AuthUser;

	beforeAll(async () => {
		host = asAuthUser(await createVanLifeHost("space.host"));
		renter = asAuthUser(await createRenter("space.renter"));
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: { startsWith: "space." } } });
	});

	it("enrols a host so the object kernel lets them write", async () => {
		// Act
		const spaceId = await vanLifeService.ensureVanLifeSpace(host);
		const object = await objectService.create(host, spaceId, {
			name: "Sierra Weekender",
		});

		// Assert
		expect(object.spaceId).toBe(spaceId);
		expect(object.name).toBe("Sierra Weekender");
	});

	it("puts every caller in the same space, reading what others listed", async () => {
		// Arrange
		const hostSpace = await vanLifeService.ensureVanLifeSpace(host);
		await objectService.create(host, hostSpace, { name: "Alpine Cruiser" });

		// Act
		const renterSpace = await vanLifeService.ensureVanLifeSpace(renter);
		const listed = await objectService.list(renter, renterSpace, {
			filters: [],
			sorts: [],
			layouts: [],
			page: 1,
			limit: 10,
		});

		// Assert — one space, not one per caller
		expect(renterSpace).toBe(hostSpace);
		expect(listed.data.map((object) => object.name)).toContain(
			"Alpine Cruiser",
		);
	});

	it("enrols a renter, because a renter's own booking is an object", async () => {
		// Arrange
		const spaceId = await vanLifeService.ensureVanLifeSpace(renter);

		// Act
		const booking = await objectService.create(renter, spaceId, {
			name: "Three nights in Moab",
		});

		// Assert
		expect(booking.spaceId).toBe(spaceId);
		expect(booking.creatorId).toBe(renter.id);
	});

	it("raises a member who already holds less than the use case needs", async () => {
		// Arrange — someone was enrolled as a plain reader before this rule
		const spaceId = await vanLifeService.ensureVanLifeSpace(renter);
		await prisma.spaceMember.update({
			where: { spaceId_userId: { spaceId, userId: renter.id } },
			data: { permission: "reader" },
		});

		// Act
		await vanLifeService.ensureVanLifeSpace(renter);
		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: renter.id } },
			select: { permission: true },
		});

		// Assert
		expect(member?.permission).toBe("writer");
	});

	it("never lowers a member who already holds more", async () => {
		// Arrange
		const spaceId = await vanLifeService.ensureVanLifeSpace(host);
		await prisma.spaceMember.update({
			where: { spaceId_userId: { spaceId, userId: host.id } },
			data: { permission: "owner" },
		});

		// Act — the owner now browses as a plain renter
		await vanLifeService.ensureVanLifeSpace(
			asAuthUser({ ...host, role: "user" }),
		);

		// Assert
		const member = await prisma.spaceMember.findUnique({
			where: { spaceId_userId: { spaceId, userId: host.id } },
			select: { permission: true },
		});

		expect(member?.permission).toBe("owner");
	});
});
