import { Prisma } from "../../src/generated/prisma/client.js";

type PrismaErrorCode = Prisma.PrismaClientKnownRequestError["code"];

function createPrismaKnownRequestError(
	code: PrismaErrorCode,
	message = "Prisma error",
): Prisma.PrismaClientKnownRequestError {
	return new Prisma.PrismaClientKnownRequestError(message, {
		code,
		clientVersion: "test",
	});
}

export function uniqueConstraintError() {
	return createPrismaKnownRequestError("P2002");
}

export function recordNotFoundError() {
	return createPrismaKnownRequestError("P2025");
}
