import { describe, expect, it, vi } from 'vitest';
import UtilSpace from './space';

// A published object is served by the harness itself (GET <api base>/publish/:uri), so its link has
// to name this server. Before that route existed the client built the link from the participant
// identity and pointed every published page at the hosted any.coop domain.
describe('publish link', () => {

	it('names the server that serves the public page', () => {
		vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/api/');

		expect(UtilSpace.getPublishDomain()).toBe('http://localhost:8000/api/publish');

		vi.unstubAllEnvs();
	});

	it('keeps a slug to the one addressable segment the route accepts', () => {
		vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/api');

		expect(UtilSpace.getPublishUrl('my trip')).toBe('http://localhost:8000/api/publish/my%20trip');

		vi.unstubAllEnvs();
	});
});
