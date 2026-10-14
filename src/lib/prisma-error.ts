import { ConflictError, NotFoundError } from "../errors/http-errors.js";
import { Prisma } from "../generated/prisma/client.js";

interface PrismaErrorMessages {
	conflict?: string;
	notFound?: string;
}

export function translatePrismaError(
	error: unknown,
	messages: PrismaErrorMessages = {},
) {
	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		switch (error.code) {
			case "P2002":
			// A write that breaks a required relation - a second review on the same
			// booking, say - arrives as P2014 rather than P2002.
			case "P2014":
				throw new ConflictError(messages.conflict ?? "Resource already exists");

			case "P2025":
				throw new NotFoundError(messages.notFound ?? "Resource not found");
		}
	}

	throw error;
}
