/**
 * The client's transport seam. Unary ClientCommands go to the Hono command shim as JSON over the
 * session cookie and session events arrive on the SSE channel at <base>/events; the gRPC-web
 * machinery this replaced is retired (ADR-0020). The proto message pairs live in ./service-registry,
 * which scripts/generate-service-registry.js writes — this file is hand-written and must not be
 * regenerated.
 */

import { GrpcWebClientBase, MethodDescriptor, MethodType } from 'grpc-web';
import type { ClientReadableStream } from 'grpc-web';
import * as Commands from 'Proto/pb/protos/commands';
import * as Events from 'Proto/pb/protos/events';
import { serverAddress } from 'Lib/web/serverAddress';
import { registry } from './service-registry';

// The web backend answers ClientCommands as JSON over the Better Auth session cookie, so commands
// go to the same API base the client booted against rather than the gRPC-web hostname.
const commandBase = serverAddress;

export class ServiceClient {

	private client: GrpcWebClientBase;
	private streamClient: GrpcWebClientBase;
	private hostname: string;
	private descriptorCache = new Map<string, MethodDescriptor<any, any>>();
	constructor (hostname: string, credentials: any, options: any) {
		this.hostname = hostname;
		// Unary calls use binary proto framing (application/grpc-web+proto), skipping the
		// base64 encode/decode and ~33% payload overhead of the default 'text' mode.
		// The event stream must stay in text mode: grpc-web reads streaming responses
		// incrementally from XHR responseText, which binary (arraybuffer) mode cannot do.
		this.client = new GrpcWebClientBase({ ...options, format: 'binary' });
		this.streamClient = new GrpcWebClientBase({ ...options, format: 'text' });
	};

	getDescriptor (commandName: string): MethodDescriptor<any, any> | null {
		let descriptor = this.descriptorCache.get(commandName);
		if (descriptor) {
			return descriptor;
		};

		const entry = registry[commandName];
		if (!entry) {
			return null;
		};

		descriptor = new MethodDescriptor(
			`/anytype.ClientCommands/${commandName}`,
			MethodType.UNARY,
			Object as any,
			Object as any,
			(request: any) => entry.req.encode(entry.req.fromPartial(request)).finish(),
			(bytes: Uint8Array) => {
				const res = entry.res.decode(bytes);
				if (!res.toObject) {
					res.toObject = function () { return this; };
				};
				return res;
			},
		);

		this.descriptorCache.set(commandName, descriptor);
		return descriptor;
	};

	request (commandName: string, data: any, metadata: any, callback: (error: any, response: any) => void) {
		// gRPC DevTools interceptor calls getRequestMessage().toObject()
		if (!data.toObject) {
			data.toObject = function () { return this; };
		};

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

	listenSessionEvents (request: Commands.StreamRequest, metadata: any): ClientReadableStream<Events.Event> {
		// The web backend pushes session events over SSE at <base>/events (cookie-authenticated,
		// exactly like the command fetch path). Each `message` frame carries one Events.Event,
		// with the Pubsub payload base64-encoded because SSE frames are text; decode it back to
		// bytes so Mapper.Event.PubsubMessage hands the shell a Uint8Array. EventSource resumes
		// on its own after a drop, so a status signal is only raised once it is permanently closed.
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

		const stream = {
			on: (kind: string, fn: (arg: any) => void) => {
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

		return stream as unknown as ClientReadableStream<Events.Event>;
	};

};
