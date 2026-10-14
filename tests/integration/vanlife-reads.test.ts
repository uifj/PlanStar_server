import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import type { AuthUser } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { objectService } from "../../src/modules/objects/service.js";
import { vanLifeService } from "../../src/modules/vanlife/service.js";
import { signInAs } from "./helpers/auth-session.js";
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

const { get, post } = await import("./helpers/request.js");

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

describe.skipIf(!databaseAvailable)("the host desk reads objects", () => {
	let host: AuthUser;
	let spaceId: string;

	beforeAll(async () => {
		await clearVanLifeRows();
		host = asAuthUser(await createVanLifeHost("read.host"));
		spaceId = await vanLifeService.ensureVanLifeSpace(host);
	});

	afterEach(async () => {
		await clearVanLifeRows();
	});

	afterAll(async () => {
		await clearVanLifeRows();
		await prisma.user.deleteMany({ where: { id: { startsWith: "read." } } });
	});

	async function publish(
		as: AuthUser,
		overrides: Record<string, unknown> = {},
	) {
		signInAs(as.id, { role: "host" });

		const response = await post(
			`${API_PREFIX}/host/vans`,
			vanRequestBody(overrides),
		);

		expect(response.status).toBe(201);

		return (await response.json()) as Json;
	}

	it("answers the desk from the object core, not the van table", async () => {
		// Arrange
		const van = await publish(host, { name: "Sierra Weekender", price: 89 });

		// Act — the object is edited through the kernel, the van row is not touched
		await objectService.update(host, van.id as string, {
			details: { price: 99 },
		});
		signInAs(host.id, { role: "host" });
		const response = await get(`${API_PREFIX}/host/vans`);

		// Assert
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [
				{
					id: van.id,
					name: "Sierra Weekender",
					price: 99,
					imageUrl: "https://images.example.test/sierra-weekender.jpg",
					type: "simple",
					location: "Mammoth Lakes, CA",
					sleeps: 2,
					rating: 0,
				},
			],
		});
		expect(
			await prisma.van.findUnique({
				where: { id: van.id as string },
				select: { price: true },
			}),
		).toEqual({ price: 89 });
	});

	it("scopes the desk to the caller inside one shared space", async () => {
		// Arrange
		const other = asAuthUser(await createVanLifeHost("read.other"));
		const theirs = await publish(other, { name: "Their Cruiser" });

		// Act
		signInAs(host.id, { role: "host" });
		const response = await get(`${API_PREFIX}/host/vans`);
		const listed = await objectService.list(host, spaceId, {
			filters: [{ key: "name", operator: "equal", value: "Their Cruiser" }],
			sorts: [],
			layouts: [],
			page: 1,
			limit: 10,
		});

		// Assert — the desk hides it, the shared space still holds it
		expect(await response.json()).toEqual({ data: [] });
		expect(listed.data.map((object) => object.id)).toContain(theirs.id);
	});
});
