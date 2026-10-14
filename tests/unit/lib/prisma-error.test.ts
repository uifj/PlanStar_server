import { describe, expect, it } from "vitest";
import { ConflictError } from "../../../src/errors/http-errors.js";
import { Prisma } from "../../../src/generated/prisma/client.js";
import { translatePrismaError } from "../../../src/lib/prisma-error.js";

function knownRequestError(code: string, message: string) {
	return new Prisma.PrismaClientKnownRequestError(message, {
		code: code as never,
		clientVersion: "test",
	});
}

describe("translatePrismaError", () => {
	it("answers a broken required relation with the caller's conflict", () => {
		// Arrange - Prisma reports a second review on the same booking as P2014
		const error = knownRequestError(
			"P2014",
			"The change you attempted would violate the required relation 'ReviewToBooking'.",
		);

		// Act
		const act = () =>
			translatePrismaError(error, {
				conflict: "This booking already has a review.",
			});

		// Assert
		expect(act).toThrow(ConflictError);
		expect(act).toThrow("This booking already has a review.");
	});

	it("leaves a database failure nobody asked about a server fault", () => {
		// Arrange
		const error = knownRequestError("P2010", "Raw query failed.");

		// Act + Assert
		expect(() => translatePrismaError(error, {})).toThrow(error);
	});
});
