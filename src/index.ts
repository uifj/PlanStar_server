import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { createCollabServer } from "./modules/collab/server.js";
import { attachCollabUpgrade } from "./modules/collab/upgrade.js";

const server = serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	() => {
		logger.info(`Server listening on port ${env.PORT}`);
	},
);

// Hocuspocus rides the same HTTP server so the collab socket is same-origin and
// carries the Better Auth session cookie; only /collab upgrades are hijacked.
const collab = createCollabServer();
attachCollabUpgrade(server, collab);

async function shutdown(signal: NodeJS.Signals) {
	logger.info({ signal }, "Shutting down server");

	collab.flushPendingStores();

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
