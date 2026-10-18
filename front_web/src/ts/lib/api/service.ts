/**
 * The client's transport seam (ADR-0020). Commands are JSON posted to the Hono command shim under
 * the Better Auth session cookie; session events arrive on the SSE channel at <base>/events. The
 * gRPC-web client this replaced — its binary framing, method descriptors, interceptors and the
 * generated per-method registry — is retired, and nothing here imports it, so this module loads
 * without the generated protobuf bindings.
 */

import { serverAddress } from 'Lib/web/serverAddress';

// Commands go to the same API base the client booted against; there is no separate proxy host.
const commandBase = serverAddress;

// The slice of the old streaming interface the shell actually uses: register listeners, then cancel.
export interface SessionStream {
	on (kind: 'data' | 'end' | 'status', fn: (arg: any) => void): SessionStream;
	cancel (): void;
};

export class ServiceClient {

	request (commandName: string, data: any, metadata: any, callback: (error: any, response: any) => void) {
		fetch(`${commandBase()}/command/${commandName}`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		}).then(async (response) => {
			if (!response.ok) {
				callback({ code: response.status, message: `HTTP ${response.status}` }, null);
				return;
			};

			callback(null, await response.json());
		}).catch((error: any) => {
			callback({ code: 1, message: error?.message || 'Network error' }, null);
		});
	};

	// The account is carried by the session cookie, so the stream needs no request body or metadata.
	listenSessionEvents (): SessionStream {
		// Each `message` frame carries one Events.Event, with the Pubsub payload base64-encoded
		// because SSE frames are text; decode it back to bytes so Mapper.Event.PubsubMessage hands
		// the shell a Uint8Array. EventSource resumes on its own after a drop, so a status signal is
		// only raised once it is permanently closed.
		const listeners: Record<string, Array<(arg: any) => void>> = { data: [], status: [], end: [] };
		const emit = (kind: string, arg: any) => {
			(listeners[kind] || []).forEach((fn) => fn(arg));
		};

		const source = new EventSource(`${commandBase()}/events`, { withCredentials: true });

		source.addEventListener('message', (event: MessageEvent) => {
			try {
				const wrapper = JSON.parse(event.data);

				// The dispatcher unwraps an Events.Event as { contextId, messages: [] }, so forward
				// that shape whole; only the base64 payload bytes inside each message are decoded here.
				(wrapper.messages || []).forEach((message: any) => {
					const pubsub = message && message.pubsubMessage;
					if (pubsub && typeof pubsub.payload === 'string') {
						pubsub.payload = Uint8Array.from(atob(pubsub.payload), (c) => c.charCodeAt(0));
					};
				});

				emit('data', wrapper);
			} catch {
				/* Ignore a malformed frame rather than tearing down the live stream. */
			};
		});

		source.addEventListener('error', () => {
			if (source.readyState === EventSource.CLOSED) {
				emit('status', { code: 1, message: 'Event stream closed' });
			};
		});

		const stream: SessionStream = {
			on: (kind, fn) => {
				if (!listeners[kind]) {
					listeners[kind] = [];
				};
				listeners[kind].push(fn);
				return stream;
			},
			cancel: () => {
				source.close();
			},
		};

		return stream;
	};

};
