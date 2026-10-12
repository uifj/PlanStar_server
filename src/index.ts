import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	() => {
		logger.info(`Server listening on port ${env.PORT}`);
	},
);

async function shutdown(signal: NodeJS.Signals) {
	logger.info({ signal }, "Shutting down server");

	server.close(async (error) => {
		if (error) {
			logger.error({ err: error }, "Failed to close server");
			process.exitCode = 1;
		}

		await prisma.$disconnect();
		process.exit();
	});
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
