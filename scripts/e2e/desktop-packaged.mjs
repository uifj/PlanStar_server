#!/usr/bin/env node
/**
 * Desktop end-to-end run against a *packaged* build, driven over CDP.
 *
 *   node scripts/e2e/desktop-packaged.mjs
 *   HARNESS_API_URL=http://localhost:8080 E2E_EXPECT_FORCED=1 node scripts/e2e/desktop-packaged.mjs
 *
 * Requires:
 *   - a running stack (deploy/podman, TLS or localhost) that has a release staged
 *     (`deploy/podman/scripts/stage-release.sh`) whose version is **higher** than the app's,
 *   - a packaged build: `cd front_web && pnpm dist:mac` → `front_web/build/mac-arm64/*.app`,
 *   - macOS. This is a semi-automatic harness, not part of `pnpm test`.
 *
 * What it proves, and where it has to stop:
 *   sign-in over the cross-site cookie → SSE /api/events → command bus → checkForUpdates
 *   → download-progress → update-downloaded → force modal appears → server retracts → modal closes
 *   → exportLogs(uploaded: true) → 3 log batches spooled while the API is away → replayed and
 *   readable server-side → renderer crash leaves a dump and a crash record on the server
 *
 * The last two legs need knobs because they act on the *server*, not the app:
 *   E2E_OFFLINE_CMD / E2E_ONLINE_CMD   take the API away and bring it back (defaults target the
 *                                      compose stack; for the local stand-in use
 *                                      `sh scripts/e2e/local-api.sh stop|forced`)
 *   E2E_CRASH_LIST_CMD                 counts files under DESKTOP_DATA_ROOT/crash
 *   E2E_LOG_READ_TOKEN                 operator token for GET /api/desktop/logs
 *   E2E_WITH_CRASH=1                   run the crash leg (it kills the window, so it goes last)
 *   E2E_SPOOL_BATCHES / E2E_FLUSH_INTERVAL_MS
 *                                      how many offline flush cycles to wait for; the interval
 *                                      must stay above the uploader's 30 s flush timer
 *
 * It stops at `update-downloaded` deliberately: an **unsigned** .app cannot be installed by macOS,
 * so `quit-and-install` would fail for a reason that has nothing to do with this code base.
 * Verifying the last mile requires a Developer ID certificate + notarization, which is an external
 * prerequisite tracked in docs/deploy/README.md. The plan says so explicitly; this script does not
 * pretend otherwise.
 *
 * Every app-side step is a CDP `Runtime.evaluate` against the renderer, so it exercises the same
 * bridge the UI calls — not a private main-process entry point. The server-side steps read what the
 * server persisted (files in the log/crash roots, the operator log query), because "the shell says
 * it sent it" is not evidence that anything landed.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = join(ROOT, "deploy/podman/e2e-artifacts");

const API_URL = process.env.HARNESS_API_URL ?? "http://localhost:8080";
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9222);
const EXPECT_FORCED = process.env.E2E_EXPECT_FORCED === "1";
const RETRACT_CMD = process.env.E2E_RETRACT_CMD ?? "";
const WITH_CRASH = process.env.E2E_WITH_CRASH === "1";
const DOWNLOAD_TIMEOUT_MS = Number(
	process.env.E2E_DOWNLOAD_TIMEOUT_MS ?? 600_000,
);

// Operator token for the log-read endpoint, so the spool and crash checks can assert what the
// *server* persisted rather than what the shell believes it sent.
const LOG_READ_TOKEN =
	process.env.E2E_LOG_READ_TOKEN ?? "local-desktop-log-read-token";
// Taking the API away and bringing it back is how "offline" is produced for the main process: a
// renderer-level network emulation would not touch the uplink, which runs in main.
const OFFLINE_CMD = process.env.E2E_OFFLINE_CMD ?? "podman stop harness-api-1";
const ONLINE_CMD = process.env.E2E_ONLINE_CMD ?? "podman start harness-api-1";
// Number of separate flush cycles that must land in the spool while offline.
const SPOOL_BATCHES = Number(process.env.E2E_SPOOL_BATCHES ?? 3);
// `DEFAULT_FLUSH_INTERVAL_MS` in electron/main/logUploader.ts, plus slack. A spool file is written
// per flush that finds the uplink down, so one batch per interval.
const FLUSH_INTERVAL_MS = Number(process.env.E2E_FLUSH_INTERVAL_MS ?? 35_000);
// Upper bound for a single renderer round-trip (see `Cdp.evaluate`).
const EVALUATE_TIMEOUT_MS = Number(
	process.env.E2E_EVALUATE_TIMEOUT_MS ?? 180_000,
);
// How long to wait for the blocking modal, which cannot appear before the SPA has mounted.
const MODAL_TIMEOUT_MS = Number(process.env.E2E_MODAL_TIMEOUT_MS ?? 120_000);
// Where Electron's crashReporter dumps land inside the api container (DESKTOP_DATA_ROOT/crash).
const CRASH_LIST_CMD =
	process.env.E2E_CRASH_LIST_CMD ??
	"podman exec harness-api-1 sh -c 'ls -1 /data/desktop/crash 2>/dev/null | wc -l'";

/** Run a host command; returns `{ status, stdout }` and never throws. */
function runShell(command, timeoutMs = 120_000) {
	const result = spawnSync("sh", ["-c", command], {
		encoding: "utf8",
		timeout: timeoutMs,
	});
	return {
		status: result.status ?? 1,
		stdout: (result.stdout ?? "").trim(),
		stderr: (result.stderr ?? "").trim(),
	};
}

const countSpoolFiles = (dir) =>
	existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith(".ndjson.gz")).length
		: 0;

const results = [];
const record = (name, ok, detail) => {
	results.push({ name, ok, detail, at: new Date().toISOString() });
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
	);
	return ok;
};
const skip = (name, detail) =>
	console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findApp() {
	if (process.env.E2E_APP_PATH) return process.env.E2E_APP_PATH;
	for (const dir of [
		"build/mac-arm64",
		"build/mac",
		"dist/mac-arm64",
		"dist/mac",
	]) {
		const abs = join(ROOT, "front_web", dir);
		if (!existsSync(abs)) continue;
		const app = readdirSync(abs).find((entry) => entry.endsWith(".app"));
		if (app) return join(abs, app);
	}
	return "";
}

// ---------------------------------------------------------------------------------------------
// Minimal CDP client. Node 24 ships a global WebSocket, so there is no dependency to add.
// ---------------------------------------------------------------------------------------------
class Cdp {
	#socket;
	#next = 1;
	#pending = new Map();

	static async attach(port) {
		const deadline = Date.now() + 60_000;
		let target;
		while (Date.now() < deadline) {
			try {
				const list = await (
					await fetch(`http://127.0.0.1:${port}/json/list`)
				).json();
				target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
				if (target) break;
			} catch {
				// The app is still starting; the inspector endpoint is not up yet.
			}
			await sleep(500);
		}
		if (!target) throw new Error(`no CDP page target on port ${port}`);
		const cdp = new Cdp();
		cdp.#socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => {
			cdp.#socket.addEventListener("open", res, { once: true });
			cdp.#socket.addEventListener("error", rej, { once: true });
		});
		cdp.#socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			const pending = cdp.#pending.get(message.id);
			if (!pending) return;
			cdp.#pending.delete(message.id);
			if (message.error) pending.reject(new Error(message.error.message));
			pending.resolve(message.result);
		});
		// A command that kills its own target (`Page.crash`) never gets a reply, so an unresponded
		// send would hang the harness forever. Fail every in-flight call when the socket goes.
		for (const event of ["close", "error"]) {
			cdp.#socket.addEventListener(
				event,
				() => {
					for (const [id, pending] of cdp.#pending) {
						cdp.#pending.delete(id);
						pending.reject(new Error(`CDP socket ${event} before a reply`));
					}
				},
				{ once: false },
			);
		}
		await cdp.send("Runtime.enable");
		return cdp;
	}

	send(method, params = {}, timeoutMs = 0) {
		const id = this.#next++;
		return new Promise((resolve, reject) => {
			const timer =
				timeoutMs > 0
					? setTimeout(() => {
							if (!this.#pending.has(id)) return;
							this.#pending.delete(id);
							reject(new Error(`${method} timed out after ${timeoutMs}ms`));
						}, timeoutMs)
					: null;
			this.#pending.set(id, {
				resolve: (value) => {
					if (timer) clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					if (timer) clearTimeout(timer);
					reject(error);
				},
			});
			this.#socket.send(JSON.stringify({ id, method, params }));
		});
	}

	/** Evaluate in the page; `awaitPromise` so bridge calls resolve before we read them. */
	async evaluate(expression) {
		// Bounded: an expression whose promise never settles would otherwise hang the harness with
		// no output at all, which is indistinguishable from a slow download.
		const result = await this.send(
			"Runtime.evaluate",
			{
				expression,
				awaitPromise: true,
				returnByValue: true,
				userGesture: true,
			},
			EVALUATE_TIMEOUT_MS,
		);
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? "evaluate threw",
			);
		}
		return result.result.value;
	}

	close() {
		try {
			this.#socket.close();
		} catch {
			// already gone
		}
	}
}

// ---------------------------------------------------------------------------------------------
const log = (message) => console.log(`\n--- ${message}`);

async function main() {
	if (process.platform !== "darwin")
		throw new Error("desktop-packaged.mjs drives a macOS .app");
	const appPath = findApp();
	if (!appPath) {
		console.error(
			"no packaged .app found — run `cd front_web && pnpm dist:mac` first (or set E2E_APP_PATH)",
		);
		process.exit(1);
	}
	const executable = join(
		appPath,
		"Contents",
		"MacOS",
		readdirSync(join(appPath, "Contents", "MacOS"))[0],
	);
	console.log(`app:        ${appPath}`);
	console.log(`api:        ${API_URL}`);
	console.log(`debug port: ${DEBUG_PORT}\n`);

	const child = spawn(executable, [`--remote-debugging-port=${DEBUG_PORT}`], {
		env: { ...process.env, HARNESS_API_URL: API_URL },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const console_ = [];
	child.stdout.on("data", (chunk) => console_.push(chunk.toString()));
	child.stderr.on("data", (chunk) => console_.push(chunk.toString()));

	let cdp;
	try {
		cdp = await Cdp.attach(DEBUG_PORT);

		log("bridge identity");
		const identity = await cdp.evaluate(
			"({ isDesktop: !!window.Desktop?.isDesktop, platform: window.Desktop?.platform, electron: window.Desktop?.electronVersion })",
		);
		record(
			"bridge is present and reports isDesktop",
			identity?.isDesktop === true,
			`${identity?.platform}, electron ${identity?.electron}`,
		);

		log("capabilities (P4: every optional feature defaults on)");
		const caps = await cdp.evaluate("window.Desktop.getCapabilities()");
		for (const key of [
			"autoUpdate",
			"crashReporter",
			"forceUpdate",
			"logUpload",
		]) {
			record(
				`capability ${key} = true`,
				caps?.[key] === true,
				String(caps?.[key]),
			);
		}

		log("sign-in from the desktop origin (P5: cross-site session cookie)");
		// The renderer is served from http://localhost:8321 while the API is another origin, so this
		// is the real cross-site case the plan calls out: the session cookie has to be issued *and*
		// attached again by the browser, from inside the shell, over the bridge the UI uses.
		const email = `e2e-desktop-${Date.now()}@harness.test`;
		const api = API_URL.replace(/\/+$/, "");
		// Embedded as a literal string: the expression is evaluated in the renderer, which has no
		// access to this module's scope.
		const signUpBody = JSON.stringify(
			JSON.stringify({
				email,
				password: "e2e-desktop-password-12345",
				name: "E2E",
			}),
		);
		const signUp = await cdp.evaluate(`(async () => {
			const res = await fetch(${JSON.stringify(`${api}/api/auth/sign-up/email`)}, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: ${signUpBody},
			});
			return { status: res.status };
		})()`);
		record(
			"sign-up from the desktop origin succeeds",
			signUp?.status === 200,
			`status ${signUp?.status}`,
		);

		// No explicit Cookie header here: if the browser refuses to attach the cross-site cookie the
		// answer is an anonymous session, which is exactly the failure this check exists to catch.
		const session = await cdp.evaluate(`(async () => {
			const res = await fetch(${JSON.stringify(`${api}/api/auth/get-session`)}, {
				credentials: "include",
			});
			const body = await res.json().catch(() => null);
			return { status: res.status, user: body?.user?.email ?? null };
		})()`);
		record(
			"session cookie is attached on the next cross-site request",
			session?.user === email,
			`status ${session?.status}, user ${session?.user ?? "(anonymous)"}`,
		);

		log("SSE event stream (the shell's push transport)");
		const sse = await cdp.evaluate(`(async () => {
			const source = new EventSource(${JSON.stringify(`${api}/api/events`)}, {
				withCredentials: true,
			});
			return await new Promise((done) => {
				const timer = setTimeout(() => {
					source.close();
					done({ opened: false, readyState: source.readyState, reason: "timeout" });
				}, 20000);
				source.onopen = () => {
					clearTimeout(timer);
					const state = source.readyState;
					source.close();
					done({ opened: true, readyState: state });
				};
				source.onerror = () => {
					clearTimeout(timer);
					const state = source.readyState;
					source.close();
					done({ opened: false, readyState: state, reason: "error" });
				};
			});
		})()`);
		record(
			"SSE /api/events opens from the desktop origin",
			sse?.opened === true,
			JSON.stringify(sse),
		);

		log("recording update events");
		await cdp.evaluate(`(() => {
			window.__e2e = { states: [], checks: [], forced: [], cleared: [] };
			window.Desktop.onUpdateStateChanged((s) => window.__e2e.states.push(s));
			window.Desktop.onUpdateCheckResult((r) => window.__e2e.checks.push(r));
			window.Desktop.onForceUpdateRequired((p) => window.__e2e.forced.push(p));
			window.Desktop.onForceUpdateCleared((p) => window.__e2e.cleared.push(p));
			return true;
		})()`);

		log("check for updates (command bus)");
		const checkResult = await cdp.evaluate(
			'window.Desktop.executeCommand("check-for-updates")',
		);
		record(
			"check-for-updates returns a result",
			checkResult !== undefined && checkResult !== null,
			JSON.stringify(checkResult)?.slice(0, 160),
		);

		// The updater drives itself to `update-downloaded`; poll the recorded events rather than the
		// query, so a state that only ever arrives as a push is still observed. The payload is a
		// discriminated union on `kind` — reading `state`/`status` yields empty names and turns a
		// finished download into a ten-minute poll.
		const stateName = (s) => s?.kind ?? s?.state ?? s?.status ?? "";
		const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
		let states = [];
		while (Date.now() < deadline) {
			states = await cdp.evaluate("window.__e2e.states");
			const names = states.map(stateName);
			if (names.some((n) => /downloaded|error|not-available/i.test(n))) break;
			await sleep(1000);
		}
		const stateNames = states.map(stateName);
		record(
			"update state stream received",
			states.length > 0,
			`${states.length} event(s): ${[...new Set(stateNames)].join(",")}`,
		);
		record(
			"download-progress observed",
			stateNames.some((n) => /download/i.test(n)),
			stateNames.filter((n) => /download/i.test(n)).join(",") || "(none)",
		);

		// `update-downloaded` is not the last event on the wire: the shell then reports `installing`
		// because a forced release is installed on quit. Matching only the tail state would call a
		// finished, sha512-verified download a failure — so scan the whole stream and use the tail
		// only for display.
		const terminal = stateNames.at(-1) ?? "";
		if (/downloaded/i.test(stateNames.join(","))) {
			record(
				"update-downloaded reached (sha512 verified by electron-updater)",
				true,
				`${stateNames.filter((n) => /downloaded/i.test(n)).join(",")} → ${terminal}`,
			);
		} else if (/not-available/i.test(terminal)) {
			skip(
				"update-downloaded",
				"server reports the same version as the app — bump DESKTOP_RELEASE_VERSION",
			);
		} else {
			record(
				"update-downloaded reached (sha512 verified by electron-updater)",
				false,
				`${terminal || "(no terminal state)"} — ${JSON.stringify(states).slice(0, 300)}`,
			);
		}

		log("forced update");
		const forceState = await cdp.evaluate(
			"window.Desktop.getForceUpdateState()",
		);
		if (EXPECT_FORCED) {
			record(
				"getForceUpdateState returns a state",
				forceState !== null && forceState !== undefined,
				JSON.stringify(forceState)?.slice(0, 160),
			);
			// The popup mounts a tick after the broadcast (and after the startup
			// `getForceUpdateState()` round-trip), so poll instead of sampling once.
			//
			// The window has to cover a cold React mount, not just a broadcast: app.tsx subscribes and
			// then queries inside `desktop.capabilities().then(...)`, so nothing can open the modal
			// until the SPA has booted. When the artifact is already in electron-updater's cache the
			// download legs finish in ~5 s and a 10 s poll measures the boot, not the guard — measured
			// both ways: ~30 s after launch the modal is there, ~9 s after launch it is not yet.
			const modalDeadline = Date.now() + MODAL_TIMEOUT_MS;
			const modalStarted = Date.now();
			let modal = false;
			while (Date.now() < modalDeadline && !modal) {
				modal = await cdp.evaluate(
					'!!document.querySelector("[data-testid=\\"force-update\\"]")',
				);
				if (!modal) await sleep(500);
			}
			record(
				"blocking modal is rendered",
				modal === true,
				modal
					? `after ${((Date.now() - modalStarted) / 1000).toFixed(1)} s`
					: `not present within ${MODAL_TIMEOUT_MS / 1000} s`,
			);
		} else {
			skip("getForceUpdateState modal check", "E2E_EXPECT_FORCED is not 1");
		}

		if (RETRACT_CMD) {
			log("retracting the forced flag server-side");
			// `spawn`, not `spawnSync`: the usual retract command restarts the API, and the new server
			// keeps the inherited stderr pipe open forever — `spawnSync` would wait on that pipe long
			// after the command itself finished. The command is run detached with a hard timeout for
			// the same reason.
			const retract = await new Promise((resolve) => {
				const proc = spawn("sh", ["-c", RETRACT_CMD], {
					stdio: ["ignore", "ignore", "pipe"],
					detached: true,
				});
				let stderr = "";
				proc.stderr.on("data", (chunk) => {
					stderr += chunk.toString();
				});
				const timer = setTimeout(() => {
					resolve({ status: 124, stderr: `${stderr}\n(timed out after 180s)` });
				}, 180_000);
				proc.on("exit", (status) => {
					clearTimeout(timer);
					resolve({ status, stderr });
				});
			});
			record(
				"retract command succeeded",
				retract.status === 0,
				(retract.stderr ?? "").trim().slice(0, 200),
			);

			// Ask again instead of waiting for the 2–15 minute poll: the push only happens when the
			// manifest is re-read, and a user pressing "check for updates" is the normal way that
			// happens in the wild.
			await cdp
				.evaluate('window.Desktop.executeCommand("check-for-updates")')
				.catch(() => undefined);

			let cleared = [];
			let modalGone = false;
			const retractDeadline = Date.now() + 180_000;
			while (Date.now() < retractDeadline) {
				cleared = await cdp.evaluate("window.__e2e.cleared");
				modalGone = await cdp.evaluate(
					'!document.querySelector("[data-testid=\\"force-update\\"], .popupForceUpdate, .forceUpdate")',
				);
				if (cleared.length > 0 && modalGone) break;
				await sleep(2000);
			}
			record(
				"ForceUpdateCleared push arrived",
				cleared.length > 0,
				JSON.stringify(cleared.at(-1) ?? null),
			);
			record(
				"modal closed after retraction",
				modalGone === true,
				String(modalGone),
			);

			// P2 asks for a state that is queryable, not just push-driven: after the retraction the
			// query must answer null, otherwise a rebuilt window would keep blocking.
			const afterRetract = await cdp.evaluate(
				"window.Desktop.getForceUpdateState()",
			);
			record(
				"getForceUpdateState is null after retraction",
				afterRetract === null,
				JSON.stringify(afterRetract)?.slice(0, 120) ?? "null",
			);
		} else {
			skip(
				"retraction closes the modal",
				"set E2E_RETRACT_CMD to the server-side retract command",
			);
		}

		log("log export (P3: uploaded flag)");
		const exported = await cdp.evaluate(
			'window.Desktop.executeCommand("export-logs")',
		);
		record(
			"export-logs returns uploaded=true",
			exported?.uploaded === true,
			JSON.stringify(exported)?.slice(0, 200),
		);

		// `exported.path` is <userData>/exports/<zip>. That is the only way to learn `userData` from
		// out here, and the spool directory and the device id both live beside it.
		const userData = resolve(dirname(exported?.path ?? ""), "..");
		const spoolDir = join(userData, "logs", "pending");
		const deviceIdFile = join(userData, "device-id");
		const deviceId = existsSync(deviceIdFile)
			? readFileSync(deviceIdFile, "utf8").trim()
			: "";
		record(
			"device id is persisted in userData",
			/^[A-Za-z0-9_-]{8,64}$/.test(deviceId),
			deviceId || "(missing)",
		);

		// Shape-agnostic read of the operator log endpoint: the payload is an envelope around an
		// array, and which key holds it is the server's business, not this harness's.
		const queryLogs = async (q) => {
			const url = `${api}/api/desktop/logs?deviceId=${encodeURIComponent(deviceId)}&limit=200&q=${encodeURIComponent(q)}`;
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${LOG_READ_TOKEN}` },
			}).catch(() => null);
			const body = response?.ok
				? await response.json().catch(() => null)
				: null;
			const list = Array.isArray(body)
				? body
				: (body?.records ?? body?.items ?? body?.logs ?? []);
			return {
				status: response?.status ?? 0,
				hits: Array.isArray(list) ? list.length : 0,
			};
		};

		log(`log uplink: ${SPOOL_BATCHES} batches spooled offline, then replayed`);
		const offline = runShell(OFFLINE_CMD);
		if (offline.status !== 0) {
			skip(
				"offline spool and replay",
				`E2E_OFFLINE_CMD failed (${offline.status}): ${(offline.stderr || offline.stdout).slice(0, 120)}`,
			);
		} else {
			try {
				// `export-logs` writes a main-process record on every call and needs no server, so it
				// keeps producing log traffic while the API is down. One spool file is written per
				// flush cycle that finds the uplink unreachable, hence one call per interval.
				for (let batch = 0; batch < SPOOL_BATCHES; batch += 1) {
					await cdp
						.evaluate('window.Desktop.executeCommand("export-logs")')
						.catch(() => null);
					await sleep(FLUSH_INTERVAL_MS);
				}
				const spooled = countSpoolFiles(spoolDir);
				record(
					`${SPOOL_BATCHES} batches spooled while offline`,
					spooled >= SPOOL_BATCHES,
					`${spooled} file(s) in ${spoolDir}`,
				);
			} finally {
				runShell(ONLINE_CMD);
			}

			let ready = false;
			const readyDeadline = Date.now() + 120_000;
			while (Date.now() < readyDeadline) {
				try {
					if ((await fetch(`${api}/api/ready`)).ok) {
						ready = true;
						break;
					}
				} catch {
					// still coming up
				}
				await sleep(2000);
			}
			record("api is serving again before the replay", ready, String(ready));

			// `export-logs` ends in an uplink flush, which drains the spool oldest-first in one call —
			// waiting for the retry backoff instead would mean up to 300 s of doing nothing.
			const replay = await cdp
				.evaluate('window.Desktop.executeCommand("export-logs")')
				.catch(() => null);
			const left = countSpoolFiles(spoolDir);
			record(
				"spool drained after reconnect",
				left === 0,
				`${left} file(s) left, uploaded=${replay?.uploaded}`,
			);

			const replayed = await queryLogs("[export-logs] wrote");
			record(
				"replayed records are readable server-side",
				replayed.status === 200 && replayed.hits >= SPOOL_BATCHES,
				`status ${replayed.status}, ${replayed.hits} matching record(s) for device ${deviceId.slice(0, 12)}`,
			);
		}

		if (WITH_CRASH) {
			log("crash reporting (renderer crash)");
			const dumpsBefore = Number(runShell(CRASH_LIST_CMD).stdout) || 0;
			// `Page.crash` kills the renderer that would have answered it, so this send is expected
			// to fail or time out; the evidence is on the server, not in the reply.
			await cdp.send("Page.crash", {}, 10_000).catch(() => {});
			await sleep(5000);
			// The renderer is gone; the main process reloads it after the crash dump is written.
			record(
				"renderer crashed without taking the app down",
				child.exitCode === null,
				`app pid alive: ${child.exitCode === null}`,
			);

			// Two independent server-side traces: the minidump posted to /api/desktop/crash-report,
			// and the `render-process-gone` record the guard emits into the log uplink. Both are
			// files on the server, which is what "landed" has to mean here.
			await sleep(FLUSH_INTERVAL_MS);
			const dumpsAfter = Number(runShell(CRASH_LIST_CMD).stdout) || 0;
			record(
				"minidump landed under DESKTOP_DATA_ROOT/crash",
				dumpsAfter > dumpsBefore,
				`${dumpsBefore} → ${dumpsAfter} file(s)`,
			);
			const crashLog = await queryLogs("[crash-reporter]");
			record(
				"crash record is queryable server-side",
				crashLog.status === 200 && crashLog.hits > 0,
				`status ${crashLog.status}, ${crashLog.hits} record(s)`,
			);
		} else {
			skip(
				"renderer crash report",
				"E2E_WITH_CRASH is not 1 (crashes the window)",
			);
		}
	} finally {
		if (cdp) cdp.close();
		child.kill("SIGTERM");
	}

	const failed = results.filter((r) => !r.ok);
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	const file = join(
		ARTIFACT_DIR,
		`desktop-packaged-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
	);
	writeFileSync(
		file,
		`${JSON.stringify(
			{
				app: appPath,
				apiUrl: API_URL,
				expectForced: EXPECT_FORCED,
				retractCommand: RETRACT_CMD || null,
				limitations:
					"unsigned .app cannot install; verification stops at update-downloaded",
				passed: results.length - failed.length,
				failed: failed.length,
				results,
				appLog: console_.join("").slice(-20000),
			},
			null,
			2,
		)}\n`,
	);
	console.log(
		`\n${results.length - failed.length} passed, ${failed.length} failed`,
	);
	console.log(`evidence: ${file}`);
	process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
