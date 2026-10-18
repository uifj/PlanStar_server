import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";

type UpgradeableServer = {
	on(
		event: "upgrade",
		listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
	): unknown;
};

// Hocuspocus v4 reads a WHATWG Request (`.headers` as a Headers instance, an
// absolute `.url`); the node upgrade event hands us an IncomingMessage instead,
// so onConnect's `auth.api.getSession({ headers })` would never see the cookie.
function toWebRequest(request: IncomingMessage): Request {
	const host = request.headers.host ?? "localhost";
	const url = new URL(request.url ?? "/collab", `http://${host}`);
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (value === undefined) {
			continue;
		}
		headers.set(key, Array.isArray(value) ? value.join(", ") : value);
	}
	return new Request(url, { headers });
}

// Hocuspocus' ClientConnection does not subscribe to the socket itself: the
// embedder must forward message/close/pong, exactly as the built-in Server does
// through crossws. Without this the handshake is never processed and the client
// sits "connected" but unsynced forever.
export function attachCollabUpgrade(
	server: UpgradeableServer,
	collab: Hocuspocus,
) {
	const sockets = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		if (!(request.url ?? "").startsWith("/collab")) {
			return;
		}

		sockets.handleUpgrade(request, socket, head, (ws) => {
			const connection = collab.handleConnection(
				ws as never,
				toWebRequest(request),
			);

			ws.on("message", (data) => {
				connection.handleMessage(new Uint8Array(data as ArrayBuffer));
			});
			ws.on("close", (code, reason) => {
				connection.handleClose({ code, reason: reason?.toString() ?? "" });
			});
			ws.on("pong", () => connection.touch());
		});
	});
}
