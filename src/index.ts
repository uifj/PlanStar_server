import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { createCollabServer } from "./modules/collab/server.js";
import { attachCollabUpgrade } from "./modules/collab/upgrade.js";
import {
	startLogRetention,
	stopLogRetention,
} from "./modules/desktop-logs/retention.js";

/**
 * `HOST` is what makes the container reachable: Node binds loopback by default in some setups, and a
 * published port on a container that only listens on 127.0.0.1 is silently unreachable.
 */
const server = serve(
	{
		fetch: app.fetch,
		port: env.PORT,
		hostname: env.HOST,
	},
	() => {
		logger.info(`Server listening on ${env.HOST}:${env.PORT}`);
	},
);

// Hocuspocus rides the same HTTP server so the collab socket is same-origin and
// carries the Better Auth session cookie; only /collab upgrades are hijacked.
const collab = createCollabServer();
attachCollabUpgrade(server, collab);

startLogRetention();

/**
 * Graceful shutdown, ordered around what must not be lost:
 *   1. flush debounced collab stores (edited documents still in memory),
 *   2. close the collab sockets so `server.close()` can actually finish — an open WebSocket keeps the
 *      listener alive and used to make the container sit out its whole stop timeout,
 *   3. stop the retention timer,
 *   4. close the HTTP server, hard-closing whatever is left after 5 s (SSE streams never end on their
 *      own), and only then disconnect Prisma.
 */
const SHUTDOWN_GRACE_MS = 5_000;

let shuttingDown = false;

/**
 * `serve()` returns a union that also allows an HTTP/2 server, which has no `closeAllConnections`.
 * Narrow with `in` rather than casting, so a future switch to HTTP/2 degrades to a plain close.
 */
function forceCloseConnections(): void {
	if ("closeAllConnections" in server) {
		server.closeAllConnections();
	}
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	logger.info({ signal }, "Shutting down server");

	collab.flushPendingStores();
	collab.closeConnections();
	stopLogRetention();

	const forceClose = setTimeout(() => {
		logger.warn("Forcing remaining connections closed");
		forceCloseConnections();
	}, SHUTDOWN_GRACE_MS);
	forceClose.unref();

	await new Promise<void>((resolve) => {
		server.close((error) => {
			if (error) {
				logger.error({ err: error }, "Failed to close server");
				process.exitCode = 1;
			}
			resolve();
		});
	});

	clearTimeout(forceClose);
	await prisma.$disconnect();
	process.exit();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
