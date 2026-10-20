import type { BrowserWindow } from "electron";

import { apiUrl, DESKTOP_ORIGIN } from "./desktop";

/**
 * A self-check of the *desktop* path, run inside the real renderer rather than a browser tab.
 *
 * It exists because the desktop target's risk is not React, it is plumbing: whether a renderer served
 * from http://localhost:8321 can hold a session cookie issued on localhost:8000 and still reach the
 * command shim. A CORS mistake and an auth mistake look identical from outside (a blank login page),
 * so the shell performs the whole sequence itself and prints one line of JSON for the log.
 *
 * Only runs when HARNESS_DESKTOP_SMOKE is set; an ordinary launch never touches it.
 */

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
	win: BrowserWindow,
	evaluate: () => Promise<boolean> | boolean,
	tries = 60,
): Promise<boolean> => {
	for (let attempt = 0; attempt < tries; attempt += 1) {
		if (win.isDestroyed()) {
			return false;
		}
		if (await evaluate()) {
			return true;
		}
		await wait(500);
	}
	return false;
};

const inPage = async <T>(win: BrowserWindow, script: string): Promise<T> =>
	win.webContents.executeJavaScript(
		`(async () => { ${script} })()`,
	) as Promise<T>;

export async function runSmoke(win: BrowserWindow): Promise<boolean> {
	const email = `desktop-smoke-${Date.now()}@example.com`;
	const password = `Smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

	// 1. The shell loaded its own renderer, and the app reached a route (not a network error page).
	const booted = await waitFor(win, () =>
		inPage(
			win,
			`return location.href.startsWith(${JSON.stringify(DESKTOP_ORIGIN)});`,
		),
	);
	const beforeLogin = await inPage<{ href: string; title: string }>(
		win,
		"return { href: location.href, title: document.title };",
	);

	// 2. Sign up through the backend from inside the renderer. If the origins were not same-site for
	// cookies, or CORS refused credentials, this resolves but the session never sticks.
	const signed = await inPage<{ status: number; error: unknown }>(
		win,
		`const r = await fetch(${JSON.stringify(`${apiUrl()}/api/auth/sign-up/email`)}, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)}, name: 'Desktop Smoke' }),
		});
		return { status: r.status, error: await r.json().then(x => x && x.error ? x.error : null).catch(() => 'unparseable') };`,
	);

	// 3. The session must survive a reload of the app, which is what the desktop shell is for.
	await win.reload();
	const restored = await waitFor(
		win,
		() =>
			inPage(
				win,
				`return !location.pathname.startsWith('/auth/') && document.querySelectorAll('.sidebar, #main, .page').length > 0;`,
			),
		60,
	);

	// 4. A real command through the shim, from the renderer, with the cookie riding along.
	const command = await inPage<{ code: number; hasAccount: boolean }>(
		win,
		`const r = await fetch(${JSON.stringify(`${apiUrl()}/api/command/AccountSelect`)}, {
			method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: '' }),
		});
		const j = await r.json().catch(() => null);
		return { code: j && j.error ? j.error.code : -1, hasAccount: !!(j && j.account && (j.account.id || j.account.name)) };`,
	);

	const afterLogin = await inPage<{ href: string; title: string }>(
		win,
		"return { href: location.href, title: document.title };",
	);

	const ok =
		booted &&
		restored &&
		signed.status < 300 &&
		command.code === 0 &&
		command.hasAccount;

	console.log(
		`DESKTOP_SMOKE ${JSON.stringify({
			ok,
			signedUpStatus: signed.status,
			signUpError: signed.error,
			routeBeforeLogin: beforeLogin.href.replace(DESKTOP_ORIGIN, ""),
			routeAfterLogin: afterLogin.href.replace(DESKTOP_ORIGIN, ""),
			titleAfterLogin: afterLogin.title,
			accountSelectCode: command.code,
			accountSeen: command.hasAccount,
			created: email,
		})}`,
	);

	return ok;
}
