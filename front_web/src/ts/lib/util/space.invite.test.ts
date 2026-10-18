import { afterEach, describe, expect, it, vi } from 'vitest';
import UtilSpace from './space';

// The link a member copies from Settings → Invite Members has to open wherever it is pasted. The
// client used to answer with the anytype:// scheme for every private network, which nothing can open
// in a browser — so on web it is this app's own join route instead.
describe('invite link', () => {

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const world = ({ network, arch, origin }: { network: boolean; arch: string; origin: string }) => {
		vi.stubGlobal('U', {
			Data: { isAnytypeNetwork: () => network },
			Common: { getElectron: () => ({ arch }) },
			String: { sprintf: (format: string, ...args: any[]) => args.reduce((out, value) => out.replace('%s', value), format) },
		});
		vi.stubGlobal('J', {
			Url: { invite: 'https://invite.any.coop/%s#%s' },
			Constant: { protocol: 'anytype' },
		});
		vi.stubGlobal('window', { location: { origin } });
	};

	it('hands web members a link their browser can open', () => {
		world({ network: false, arch: 'web', origin: 'http://localhost:3030' });

		expect(UtilSpace.getInviteLink('cid-1', 'key-2')).toBe(
			'http://localhost:3030/invite/?cid=cid-1&key=key-2',
		);
	});

	it('keeps the registered scheme for the desktop build', () => {
		world({ network: false, arch: 'arm64', origin: 'http://localhost:3030' });

		expect(UtilSpace.getInviteLink('cid-1', 'key-2')).toBe('anytype://invite/?cid=cid-1&key=key-2');
	});

	it('keeps the hosted share domain on the hosted network', () => {
		world({ network: true, arch: 'web', origin: 'http://localhost:3030' });

		expect(UtilSpace.getInviteLink('cid-1', 'key-2')).toBe('https://invite.any.coop/cid-1#key-2');
	});
});
