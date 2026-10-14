import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { vanLifeService } from "../../src/modules/vanlife/service.js";
import { asAuthUser, signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import {
	clearVanLifeRows,
	createVanLifeHost,
	vanRequestBody,
} from "./helpers/vanlife-data.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

const databaseAvailable = await isDatabaseAvailable();

const { del, post } = await import("./helpers/request.js");

describe.skipIf(!databaseAvailable)("the planner's catalog search", () => {
	let spaceId: string;

	async function publish(
		hostId: string,
		overrides: Record<string, unknown> = {},
	): Promise<string> {
		signInAs(hostId, { role: "host" });

		const response = await post(
			`${API_PREFIX}/host/vans`,
			vanRequestBody(overrides),
		);

		expect(response.status).toBe(201);

		return ((await response.json()) as { id: string }).id;
	}

	beforeAll(async () => {
		await clearVanLifeRows();
		const host = asAuthUser(await createVanLifeHost("search.host"));

		spaceId = await vanLifeService.ensureVanLifeSpace(host);

		await publish(host.id, {
			name: "Moab Trailhouse",
			price: 129,
			type: "rugged",
			location: "Moab, UT",
		});
		await publish(host.id, {
			name: "Desert Runner",
			price: 89,
			location: "Moab, UT",
			sleeps: 3,
			amenities: ["camp stove"],
		});
		await publish(host.id, {
			name: "Cheap Aspen",
			price: 70,
			location: "Aspen, CO",
		});
		const retiredId = await publish(host.id, {
			name: "Retired Runner",
			price: 50,
			location: "Moab, UT",
		});

		signInAs(host.id, { role: "host" });
		await del(`${API_PREFIX}/host/vans/${retiredId}`);
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({
			where: { id: { startsWith: "search." } },
		});
	});

	it("keeps the place and the budget the planner asked for", async () => {
		// Arrange
		const host = asAuthUser(
			await prisma.user.findUniqueOrThrow({ where: { id: "search.host" } }),
		);

		// Act
		const found = await vanLifeService.searchListedVans(host, spaceId, {
			location: "moab",
			maxPrice: 150,
			limit: 5,
		});

		// Assert — case-insensitive place, budget respected, retired van gone
		expect(found.map((van) => van.name)).toEqual([
			"Desert Runner",
			"Moab Trailhouse",
		]);
		expect(found[0]).toMatchObject({
			name: "Desert Runner",
			price: 89,
			location: "Moab, UT",
			sleeps: 3,
			type: "simple",
		});
	});

	it("answers with the cheapest matches when the planner narrows first", async () => {
		// Arrange
		const host = asAuthUser(
			await prisma.user.findUniqueOrThrow({ where: { id: "search.host" } }),
		);

		// Act
		const found = await vanLifeService.searchListedVans(host, spaceId, {
			maxPrice: 100,
			limit: 1,
		});

		// Assert
		expect(found.map((van) => van.name)).toEqual(["Cheap Aspen"]);
		expect(found[0]?.amenities).toEqual([]);
	});
});
