import { describe, expect, it, vi } from 'vitest';
import { ServiceClient } from './service';

// The whole surface this client needs: a command is JSON posted over the session cookie, and session
// events arrive on the SSE channel. Pinned before the proto-framed gRPC-web client was retired, so
// neither half can leave with it.
describe('ServiceClient transport', () => {

	it('posts a command to the shim as JSON, authenticated by cookie', async () => {
		vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/api/');
		const calls: any[] = [];
		globalThis.fetch = vi.fn(async (url: string, init: any) => {
			calls.push({ url, init });
			return { ok: true, json: async () => ({ error: { code: 0, description: '' }, objectView: {} }) } as any;
		});

		const client = new ServiceClient();
		const response = await new Promise<any>((resolve) => {
			client.request('ObjectOpen', { spaceId: 'space-a', objectId: 'obj-a' }, null, (_error, result) => resolve(result));
		});

		expect(calls[0].url).toBe('http://localhost:8000/api/command/ObjectOpen');
		expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'include' });
		expect(calls[0].init.headers).toMatchObject({ 'Content-Type': 'application/json' });
		expect(JSON.parse(calls[0].init.body)).toEqual({ spaceId: 'space-a', objectId: 'obj-a' });
		expect(response.objectView).toEqual({});

		vi.unstubAllEnvs();
	});

	// The shell's error envelope is a response, not a rejected promise: an HTTP failure has to reach
	// the callback or every command would hang waiting for a reply that never comes.
	it('routes an HTTP failure through the callback', async () => {
		vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/api');
		globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }) as any);

		const client = new ServiceClient();
		const [error, response] = await new Promise<any[]>((resolve) => {
			client.request('ObjectSearch', {}, null, (e, res) => resolve([e, res]));
		});

		expect(error).toMatchObject({ code: 503, message: 'HTTP 503' });
		expect(response).toBeNull();

		vi.unstubAllEnvs();
	});

	it('reads session events off the SSE channel and decodes the frame wrapper', () => {
		vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/api');

		let source: any;
		const closed: string[] = [];
		globalThis.EventSource = class {
			static CLOSED = 2;
			url: string;
			readyState = 1;
			handlers: Record<string, (arg: any) => void> = {};

			constructor (url: string, options: any) {
				this.url = url;
				expect(options).toMatchObject({ withCredentials: true });
				source = this;
			}

			addEventListener (kind: string, fn: (arg: any) => void) {
				this.handlers[kind] = fn;
			}

			close () {
				closed.push(this.url);
			}
		} as any;

		const client = new ServiceClient();
		const received: any[] = [];
		const stream = client.listenSessionEvents();
		stream.on('data', (event: any) => received.push(event));

		expect(source.url).toBe('http://localhost:8000/api/events');

		// One frame carries the { contextId, messages[] } wrapper the dispatcher unwraps, and the
		// Pubsub payload rides as text, so it has to arrive back as bytes.
		const payload = btoa(String.fromCharCode(1, 2, 3));
		source.handlers.message({
			data: JSON.stringify({
				contextId: 'obj-a',
				messages: [{ spaceId: 'space-a', pubsubMessage: { payload } }],
			}),
		});

		expect(received[0].contextId).toBe('obj-a');
		expect(Array.from(received[0].messages[0].pubsubMessage.payload)).toEqual([1, 2, 3]);

		// A malformed frame must not tear the live channel down.
		source.handlers.message({ data: 'not json' });
		expect(received.length).toBe(1);

		stream.cancel();
		expect(closed).toEqual(['http://localhost:8000/api/events']);

		vi.unstubAllEnvs();
	});
});
