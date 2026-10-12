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
				throw new ConflictError(messages.conflict ?? "Resource already exists");

			case "P2025":
				throw new NotFoundError(messages.notFound ?? "Resource not found");
		}
	}

	throw error;
}
