import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getCurrentUser } from "../../auth/current-user.js";
import type { AuthType } from "../../lib/auth.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { sessionMiddleware } from "../../middleware/session.js";
import type { PubsubMessage } from "./relay.js";
import { pubsubRelay } from "./relay.js";
import { spaceEvents } from "./space-events.js";

// GET /api/events is the web shell's session-event stream: the only server->client push it
// has, since the REST transport has no gRPC stream. One EventSource per authenticated tab;
// every relayed Pubsub message is written as an SSE `message` frame whose JSON body mirrors
// the Events.Event shape the shell's Mapper.Event.Data scans ({ spaceId, pubsubMessage }).
// The payload rides base64 because SSE frames are text; the client decodes it back to bytes.
//
// A plain Hono (not the OpenAPI router) keeps this long-lived streaming route out of the
// generated API document, and mounting it at /events scopes its auth middleware to that one
// subtree so unknown routes still answer 404 rather than 401.

const KEEPALIVE_MS = 25_000;

// The dispatcher unwraps every streamed message as an Events.Event: { contextId, messages:
// [ { spaceId, <eventKey>: {...} } ] }. A bare inner message would read as messages=[] and be
// dropped, so the Pubsub relay is wrapped here exactly like the ChatAddMessage command's
// response event. The payload stays base64 (SSE frames are text); the client decodes it.
function frame(message: PubsubMessage): string {
	return JSON.stringify({
		contextId: "",
		messages: [
			{
				spaceId: message.spaceId,
				pubsubMessage: {
					topic: message.topic,
					identity: message.identity,
					subIds: message.subIds,
					payload: Buffer.from(message.payload).toString("base64"),
				},
			},
		],
	});
}

export const pubsubRouter = new Hono<{ Variables: AuthType }>();

pubsubRouter.use("*", sessionMiddleware);
pubsubRouter.use("*", requireAuth);

pubsubRouter.get("/", (c) =>
	streamSSE(c, async (stream) => {
		const user = getCurrentUser(c);

		let notify: () => void = () => {};
		let pending: Promise<void> = new Promise((resolve) => {
			notify = resolve;
		});
		const queue: string[] = [];

		const push = (data: string) => {
			queue.push(data);
			notify();
		};

		const closePubsub = pubsubRelay.connect(user.id, (message) =>
			push(frame(message)),
		);
		const closeSpace = spaceEvents.connect(user.id, (event) =>
			push(JSON.stringify(event)),
		);
		const close = () => {
			closePubsub();
			closeSpace();
		};
		stream.onAbort(close);

		const keepalive = setInterval(() => push(": keepalive\n\n"), KEEPALIVE_MS);
		keepalive.unref();

		while (!stream.aborted) {
			await pending;

			if (stream.aborted) {
				break;
			}

			pending = new Promise<void>((resolve) => {
				notify = resolve;
			});

			while (queue.length > 0) {
				const data = queue.shift();
				if (data === undefined) {
					continue;
				}
				if (data.startsWith(":")) {
					await stream.write(data);
				} else {
					await stream.writeSSE({ event: "message", data });
				}
			}
		}

		clearInterval(keepalive);
		close();
	}),
);
