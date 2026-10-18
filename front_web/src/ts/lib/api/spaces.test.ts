import { describe, test, expect, vi, afterEach } from 'vitest';
import { listSpaces, createSpace, ensureBootstrapSpace, DEFAULT_SPACE_NAME } from './spaces';

const space = (id: string, name: string) => ({
	id, name, status: 'active', permission: 'owner', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
});

const json = (body: unknown, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

describe('spaces api', () => {

	afterEach(() => { vi.unstubAllGlobals(); });

	test('listSpaces unwraps the paginated data array', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ data: [space('s1', 'Alpha')], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } })));

		await expect(listSpaces()).resolves.toEqual([space('s1', 'Alpha')]);
	});

	test('listSpaces throws when the request is not ok', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'nope' }, 401)));

		await expect(listSpaces()).rejects.toThrow(/401/);
	});

	test('createSpace posts the trimmed name and returns the created space', async () => {
		const fetchMock = vi.fn(async () => json(space('s2', 'Beta'), 201));
		vi.stubGlobal('fetch', fetchMock);

		await expect(createSpace('Beta')).resolves.toEqual(space('s2', 'Beta'));

		const [url, init]: any = fetchMock.mock.calls[0];
		expect(String(url)).toContain('/spaces');
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('include');
		expect(JSON.parse(init.body)).toEqual({ name: 'Beta' });
	});

	test('ensureBootstrapSpace returns existing spaces without creating one', async () => {
		const fetchMock = vi.fn(async () => json({ data: [space('s1', 'Alpha')], meta: { total: 1 } }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(ensureBootstrapSpace()).resolves.toEqual([space('s1', 'Alpha')]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('ensureBootstrapSpace provisions a default space when the account has none', async () => {
		const fetchMock = vi.fn(async (_url: any, init: any) => {
			if (init?.method === 'POST') { return json(space('s9', DEFAULT_SPACE_NAME), 201); };
			return json({ data: [], meta: { total: 0 } });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(ensureBootstrapSpace()).resolves.toEqual([space('s9', DEFAULT_SPACE_NAME)]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

});
