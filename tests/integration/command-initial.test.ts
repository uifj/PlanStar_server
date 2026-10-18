import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// The client fires InitialSetParameters during analytics/boot (analytics.ts:236) to
// hand the middleware its platform, version and log settings. It is a startup
// handshake with no persisted effect on the web backend, but it must acknowledge with
// OK rather than fall through to NOT_SUPPORTED, which would surface as a boot error.
describe.skipIf(!databaseAvailable)(
	"POST /api/command/InitialSetParameters",
	() => {
		const userId = "command-initial.user";

		beforeAll(async () => {
			await prisma.user.createMany({
				data: [
					{
						id: userId,
						name: "Initial user",
						email: "command-initial-user@vanlife.test",
					},
				],
			});
		});

		afterAll(async () => {
			await prisma.user.deleteMany({ where: { id: userId } });
		});

		it("acknowledges the startup handshake with OK", async () => {
			signInAs(userId);
			const res = await post("/api/command/InitialSetParameters", {
				platform: "web",
				version: "0.51.5",
				workdir: "",
				logLevel: "ERROR",
				doNotSendLogs: true,
				doNotSaveLogs: true,
			});

			expect(await res.json()).toEqual({
				error: { code: 0, description: "" },
				event: null,
			});
		});
	},
);
