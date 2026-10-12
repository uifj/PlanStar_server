import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { isDatabaseAvailable, resetDatabase } from "./helpers/database.js";

const databaseAvailable = await isDatabaseAvailable();

describe.skipIf(!databaseAvailable)("Database connection", () => {
	beforeEach(async () => {
		await resetDatabase();
	});

	it("connects successfully", async () => {
		const result = await prisma.$queryRaw<
			Array<{ result: number }>
		>`SELECT 1 as result`;

		expect(result).toEqual([
			{
				result: 1,
			},
		]);
	});
});
