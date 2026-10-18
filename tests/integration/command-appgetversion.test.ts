import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// AppGetVersion feeds the "contact support" URL the keyboard shortcut builds (keyboard.ts:1223):
// `message.version` is the middleware version and `message.details` the build. The self-hosted
// web backend reports its own real application version for both — there is no separate any-sync
// middleware build to report.
describe.skipIf(!databaseAvailable)("POST /api/command/AppGetVersion", () => {
	const userId = "appversion.user";

	beforeAll(async () => {
		await prisma.user.create({
			data: {
				id: userId,
				name: "Version user",
				email: "appversion@vanlife.test",
			},
		});
	});

	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: userId } });
	});

	it("reports the application version", async () => {
		signInAs(userId);
		const body = await (await post("/api/command/AppGetVersion", {})).json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.version).toBe(APP_VERSION);
		expect(body.details).toBe(APP_VERSION);
	});
});
