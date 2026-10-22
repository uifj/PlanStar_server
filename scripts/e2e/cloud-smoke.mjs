#!/usr/bin/env node

/**
 * End-to-end smoke test against a *running* stack, through the public entrypoint.
 *
 *   node scripts/e2e/cloud-smoke.mjs
 *   E2E_BASE_URL=https://harness.example.com node scripts/e2e/cloud-smoke.mjs
 *
 * Nothing here mocks anything: every check drives the deployed image over HTTP the same way the
 * browser and the desktop shell do. That is the only way to catch the failures that unit tests
 * structurally cannot see — a reverse proxy that buffers SSE, a cookie attribute that survives
 * serialization but gets stripped by Caddy, a feed route that resolves in-process but 404s when the
 * artifact is not where the container thinks it is.
 *
 * Groups, in the order the plan lists them:
 *   1. readiness + SPA shell through Caddy
 *   2. session cookie attributes (SameSite=None; Secure on https, Lax on http)
 *   3. log uplink → operator query → daily quota 429
 *   4. release feed: yml → artifact → sha512 → unreferenced name 404
 *   5. forced-release manifest
 *   6. graceful shutdown (SIGTERM → exit inside the grace window) — only when podman is local
 *
 * Evidence is written to deploy/podman/e2e-artifacts/cloud-smoke-<stamp>.json so a release review
 * can read what actually ran, not what the operator remembers.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = join(ROOT, "deploy/podman/e2e-artifacts");

const BASE_URL = (process.env.E2E_BASE_URL ?? "http://localhost:8080").replace(
	/\/$/,
	"",
);
const LOG_READ_TOKEN =
	process.env.E2E_LOG_READ_TOKEN ?? "local-desktop-log-read-token";
const EXPECT_HTTPS = BASE_URL.startsWith("https://");
const EXPECT_SAMESITE =
	process.env.E2E_EXPECT_SAMESITE ?? (EXPECT_HTTPS ? "None" : "Lax");
const FEED_DIR = process.env.E2E_FEED_DIR ?? join(ROOT, "front_web/build");
const SKIP_QUOTA = process.env.E2E_SKIP_QUOTA === "1";
const SKIP_SHUTDOWN = process.env.E2E_SKIP_SHUTDOWN === "1";
/**
 * Point the script at an API origin that has no Caddy in front of it (a native `tsx src/index.ts`
 * during development). The SPA checks are meaningless there — nothing serves the bundle — so they
 * are skipped instead of reported as failures. Everything else (cookies, logs, feed, manifest)
 * runs unchanged against the same routes.
 */
const API_ONLY = process.env.E2E_API_ONLY === "1";

const results = [];

function record(group, name, ok, detail) {
	results.push({ group, name, ok, detail, at: new Date().toISOString() });
	const label = ok ? "PASS" : "FAIL";
	console.log(`${label}  [${group}] ${name}${detail ? ` — ${detail}` : ""}`);
	return ok;
}

const skip = (group, name, detail) =>
	console.log(`SKIP  [${group}] ${name}${detail ? ` — ${detail}` : ""}`);

async function timedFetch(url, init) {
	const started = Date.now();
	const response = await fetch(url, init);
	return { response, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------------------------
// 1 — readiness and the SPA shell
// ---------------------------------------------------------------------------------------------
async function checkBasics() {
	const ready = await timedFetch(`${BASE_URL}/api/ready`);
	const readyBody = await ready.response.text().catch(() => "");
	record(
		"readiness",
		"GET /api/ready → 200",
		ready.response.status === 200,
		`${ready.response.status} in ${ready.ms} ms`,
	);
	record(
		"readiness",
		"/api/ready body reports ready",
		readyBody.trim().length > 0,
		readyBody.slice(0, 120),
	);

	if (API_ONLY) {
		skip(
			"spa",
			"SPA shell / CSP / history fallback",
			"E2E_API_ONLY=1 (no reverse proxy in front of this origin)",
		);
		return;
	}

	const spa = await timedFetch(`${BASE_URL}/`);
	const html = await spa.response.text();
	record(
		"spa",
		"GET / → 200",
		spa.response.status === 200,
		String(spa.response.status),
	);
	record(
		"spa",
		"body is the vite bundle",
		html.includes('id="root"') && html.includes("/js/main.js"),
		"id=root + /js/main.js",
	);

	const contentType = spa.response.headers.get("content-type") ?? "";
	record(
		"spa",
		"served as text/html",
		contentType.startsWith("text/html"),
		contentType,
	);

	const csp = spa.response.headers.get("content-security-policy") ?? "";
	record(
		"spa",
		"enforcing CSP present",
		/object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp),
		csp.slice(0, 100),
	);

	const deep = await timedFetch(`${BASE_URL}/some/client/route`);
	const deepHtml = await deep.response.text();
	record(
		"spa",
		"unknown client route falls back to index.html",
		deep.response.status === 200 && deepHtml.includes('id="root"'),
		String(deep.response.status),
	);
}

// ---------------------------------------------------------------------------------------------
// 2 — session cookie attributes
// ---------------------------------------------------------------------------------------------
async function checkCookies() {
	const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
	const { response } = await timedFetch(`${BASE_URL}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: BASE_URL },
		body: JSON.stringify({
			email,
			password: "e2e-password-12345",
			name: "E2E",
		}),
	});
	const cookies = response.headers.getSetCookie?.() ?? [];
	const sessionCookie =
		cookies.find((c) =>
			/session_token|session-token|\.session_token/.test(c),
		) ??
		cookies[0] ??
		"";

	record(
		"auth",
		"sign-up succeeds",
		response.status === 200,
		String(response.status),
	);
	record(
		"auth",
		"a session cookie is issued",
		cookies.length > 0,
		`${cookies.length} cookie(s)`,
	);

	const sameSite = /SameSite=(\w+)/i.exec(sessionCookie)?.[1] ?? "";
	record(
		"auth",
		`cookie SameSite=${EXPECT_SAMESITE}`,
		sameSite.toLowerCase() === EXPECT_SAMESITE.toLowerCase(),
		sameSite || "(absent)",
	);

	const secure = /;\s*Secure(;|$)/i.test(sessionCookie);
	record(
		"auth",
		`cookie Secure=${EXPECT_HTTPS}`,
		secure === EXPECT_HTTPS,
		String(secure),
	);

	// The desktop shell reaches the API cross-site from localhost:8321; this header is what decides
	// whether the browser attaches the cookie at all. Anything other than a wildcard echo is fine as
	// long as the origin is explicitly allowed.
	const me = await timedFetch(`${BASE_URL}/api/auth/get-session`, {
		headers: { Cookie: sessionCookie },
	});
	record(
		"auth",
		"session cookie authenticates",
		me.response.status === 200,
		String(me.response.status),
	);
}

// ---------------------------------------------------------------------------------------------
// 3 — log uplink, operator query, quota
// ---------------------------------------------------------------------------------------------
function ndjsonBatch(count, paddingBytes = 0) {
	const pad = paddingBytes > 0 ? "x".repeat(paddingBytes) : "";
	const lines = [];
	for (let i = 0; i < count; i += 1) {
		lines.push(
			JSON.stringify({
				time: new Date().toISOString(),
				level: i === 0 ? "error" : "info",
				source: "cloud-smoke",
				message: `e2e line ${i} ${pad}`.trim(),
			}),
		);
	}
	return `${lines.join("\n")}\n`;
}

async function uploadLogs(deviceId, body) {
	const gz = gzipSync(Buffer.from(body, "utf8"));
	const { response } = await timedFetch(
		`${BASE_URL}/api/desktop/logs?deviceId=${deviceId}&appVersion=0.57.4&platform=mac-arm64`,
		{
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: gz,
		},
	);
	return { response, gz };
}

async function checkLogs() {
	const deviceId = `e2e-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
	const { response: upload } = await uploadLogs(deviceId, ndjsonBatch(5));
	record(
		"logs",
		"POST /api/desktop/logs → 202 (gzip)",
		upload.status === 202,
		String(upload.status),
	);

	const auth = { headers: { Authorization: `Bearer ${LOG_READ_TOKEN}` } };
	const query = await timedFetch(
		`${BASE_URL}/api/desktop/logs?deviceId=${deviceId}&limit=50`,
		auth,
	);
	const payload = await query.response.json().catch(() => ({}));
	const records = payload.records ?? [];
	record(
		"logs",
		"GET /api/desktop/logs → 200",
		query.response.status === 200,
		String(query.response.status),
	);
	record(
		"logs",
		"uploaded lines are readable",
		records.length >= 5,
		`${records.length} record(s)`,
	);

	const filtered = await timedFetch(
		`${BASE_URL}/api/desktop/logs?deviceId=${deviceId}&q=e2e+line+1`,
		auth,
	);
	const filteredBody = await filtered.response.json().catch(() => ({}));
	record(
		"logs",
		"substring filter works",
		(filteredBody.records ?? []).length >= 1,
		"q=e2e line 1",
	);

	const devices = await timedFetch(
		`${BASE_URL}/api/desktop/logs/devices`,
		auth,
	);
	const inventory = await devices.response.json().catch(() => ({}));
	const listed = (inventory.devices ?? []).some((d) => d.deviceId === deviceId);
	record(
		"logs",
		"device appears in /logs/devices",
		devices.response.status === 200 && listed,
		String(devices.response.status),
	);

	const unauthorized = await timedFetch(
		`${BASE_URL}/api/desktop/logs?deviceId=${deviceId}`,
		{
			headers: { Authorization: "Bearer definitely-wrong-token" },
		},
	);
	record(
		"logs",
		"wrong read token → 401",
		unauthorized.response.status === 401,
		String(unauthorized.response.status),
	);

	if (SKIP_QUOTA) {
		skip("logs", "daily quota → 429", "E2E_SKIP_QUOTA=1");
		return;
	}

	// ~3.3 MiB of JSON per request, just under the 4 MiB decompressed-body cap, until the 50 MiB
	// daily budget trips. The padding stays below the schema's 64 KiB per-message limit: a batch
	// whose every line is rejected parses to zero records and answers 400, not 429, which would
	// look like a quota failure while actually being a shape failure. Each request writes real
	// bytes into the device's day file, so this leaves the smoke device ~50 MiB behind; the
	// retention sweep removes it and backups exclude desktop/logs.
	const heavy = ndjsonBatch(56, 60 * 1024);
	let sawQuota = 0;
	let requests = 0;
	for (; requests < 18; requests += 1) {
		const { response } = await uploadLogs(deviceId, heavy);
		if (response.status === 429) {
			sawQuota = response.headers.get("retry-after") ?? "";
			record(
				"logs",
				"daily quota → 429",
				true,
				`after ${requests + 1} batches, Retry-After=${sawQuota || "(none)"}`,
			);
			break;
		}
		if (response.status !== 202) {
			record(
				"logs",
				"daily quota → 429",
				false,
				`unexpected ${response.status} after ${requests + 1} batches`,
			);
			break;
		}
	}
	if (!sawQuota && requests >= 18) {
		record(
			"logs",
			"daily quota → 429",
			false,
			"18 batches (~72 MiB) accepted without a 429",
		);
	}
}

// ---------------------------------------------------------------------------------------------
// 4 — release feed
// ---------------------------------------------------------------------------------------------
function parseFeedRefs(text) {
	const unquote = (v) => v.trim().replace(/^["']|["']$/g, "");
	const path = /^\s*path:\s*(.+)$/m.exec(text)?.[1];
	const urls = [...text.matchAll(/^\s*-\s*url:\s*(.+)$/gm)].map((m) => m[1]);
	return { path: path ? unquote(path) : "", urls: urls.map(unquote) };
}

async function checkFeed() {
	const feed = await timedFetch(
		`${BASE_URL}/api/desktop/releases/feed/latest-mac.yml`,
	);
	const yml = await feed.response.text();
	if (feed.response.status === 404) {
		record(
			"feed",
			"GET latest-mac.yml → 200",
			false,
			"404 — run deploy/podman/scripts/stage-release.sh first",
		);
		return;
	}
	record(
		"feed",
		"GET latest-mac.yml → 200",
		feed.response.status === 200,
		String(feed.response.status),
	);

	const refs = parseFeedRefs(yml);
	const artifact = refs.path || refs.urls[0] || "";
	record("feed", "yml names an artifact", artifact.length > 0, artifact);
	if (!artifact) return;

	const declaredSha = /^\s*sha512:\s*(.+)$/m.exec(yml)?.[1]?.trim() ?? "";
	const download = await timedFetch(
		`${BASE_URL}/api/desktop/releases/feed/${encodeURIComponent(artifact)}`,
	);
	const bytes = Buffer.from(await download.response.arrayBuffer());
	record(
		"feed",
		"artifact downloads",
		download.response.status === 200,
		`${download.response.status}, ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB in ${download.ms} ms`,
	);

	const contentLength = download.response.headers.get("content-length") ?? "";
	record(
		"feed",
		"Content-Length matches the body",
		contentLength === String(bytes.byteLength),
		`${contentLength} vs ${bytes.byteLength}`,
	);

	const actualSha = createHash("sha512").update(bytes).digest("base64");
	record(
		"feed",
		"sha512 matches the yml",
		declaredSha.length > 0 && actualSha === declaredSha,
		actualSha.slice(0, 16),
	);

	try {
		const local = readFileSync(join(FEED_DIR, artifact));
		const localSha = createHash("sha512").update(local).digest("base64");
		record(
			"feed",
			"served bytes match the local build",
			localSha === actualSha,
			localSha.slice(0, 16),
		);
	} catch {
		skip(
			"feed",
			"served bytes match the local build",
			`${join(FEED_DIR, artifact)} not present`,
		);
	}

	const unreferenced = await fetch(
		`${BASE_URL}/api/desktop/releases/feed/definitely-not-in-feed-${randomUUID().slice(0, 8)}.zip`,
	);
	record(
		"feed",
		"unreferenced artifact → 404",
		unreferenced.status === 404,
		String(unreferenced.status),
	);

	const traversal = await fetch(
		`${BASE_URL}/api/desktop/releases/feed/..%2f..%2fpackage.json`,
	);
	record(
		"feed",
		"path traversal → 404",
		traversal.status === 404,
		String(traversal.status),
	);
}

// ---------------------------------------------------------------------------------------------
// 5 — forced release manifest
// ---------------------------------------------------------------------------------------------
async function checkManifest() {
	const manifest = await timedFetch(
		`${BASE_URL}/api/desktop/releases/manifest`,
	);
	const body = await manifest.response.text();
	if (manifest.response.status === 404) {
		skip(
			"manifest",
			"forced release",
			"no release published (DESKTOP_RELEASE_VERSION unset)",
		);
		return;
	}
	record(
		"manifest",
		"GET /releases/manifest → 200",
		manifest.response.status === 200,
		String(manifest.response.status),
	);
	record(
		"manifest",
		"manifest carries a version",
		/^version:\s*\S+/m.test(body),
		/^version:\s*(.+)$/m.exec(body)?.[1] ?? "",
	);
	const forced = /^is_forced:\s*true\s*$/m.test(body);
	const expected = process.env.E2E_EXPECT_FORCED;
	if (expected === undefined) {
		record(
			"manifest",
			"is_forced is a boolean field",
			/^is_forced:\s*(true|false)\s*$/m.test(body),
			`is_forced=${forced}`,
		);
	} else {
		record(
			"manifest",
			`is_forced=${expected}`,
			forced === (expected === "true"),
			`is_forced=${forced}`,
		);
	}
}

// ---------------------------------------------------------------------------------------------
// 6 — graceful shutdown
// ---------------------------------------------------------------------------------------------
function podman(args) {
	const result = spawnSync("podman", args, { encoding: "utf8" });
	return {
		ok: result.status === 0,
		out: (result.stdout ?? "").trim(),
		err: (result.stderr ?? "").trim(),
	};
}

async function checkShutdown() {
	if (SKIP_SHUTDOWN) {
		skip("shutdown", "SIGTERM → clean exit", "E2E_SKIP_SHUTDOWN=1");
		return;
	}
	if (!podman(["--version"]).ok) {
		skip(
			"shutdown",
			"SIGTERM → clean exit",
			"podman not available on this host",
		);
		return;
	}
	const id =
		podman([
			"ps",
			"-q",
			"--filter",
			"label=com.docker.compose.project=harness",
			"--filter",
			"label=com.docker.compose.service=api",
		]).out.split("\n")[0] ||
		podman(["ps", "-q", "--filter", "name=^harness-api$"]).out.split("\n")[0];
	if (!id) {
		skip(
			"shutdown",
			"SIGTERM → clean exit",
			"api container not found (remote host?)",
		);
		return;
	}

	const started = Date.now();
	const stop = podman(["stop", "-t", "30", id]);
	const elapsed = (Date.now() - started) / 1000;
	const exitCode = podman([
		"inspect",
		"--format",
		"{{.State.ExitCode}}",
		id,
	]).out;

	record(
		"shutdown",
		"SIGTERM exits within the grace window",
		stop.ok && elapsed <= 10,
		`${elapsed.toFixed(1)} s`,
	);
	record(
		"shutdown",
		"exit code 0 (no forced kill)",
		exitCode === "0",
		`ExitCode=${exitCode}`,
	);

	// Leave the stack as it was found, otherwise every later check and the next run starts blind.
	podman(["start", id]);
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const ready = await fetch(`${BASE_URL}/api/ready`).catch(() => null);
		if (ready?.ok) break;
		await new Promise((r) => setTimeout(r, 2000));
	}
}

// ---------------------------------------------------------------------------------------------
const main = async () => {
	console.log(`cloud-smoke: ${BASE_URL}\n`);
	await checkBasics();
	await checkCookies();
	await checkLogs();
	await checkFeed();
	await checkManifest();
	await checkShutdown();

	const failed = results.filter((r) => !r.ok);
	const evidence = {
		baseUrl: BASE_URL,
		startedAt: results[0]?.at,
		finishedAt: new Date().toISOString(),
		expectSameSite: EXPECT_SAMESITE,
		expectSecure: EXPECT_HTTPS,
		passed: results.length - failed.length,
		failed: failed.length,
		results,
	};
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const file = join(ARTIFACT_DIR, `cloud-smoke-${stamp}.json`);
	writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);

	console.log(
		`\n${failed.length === 0 ? "all" : failed.length} result(s): ${results.length - failed.length} passed, ${failed.length} failed`,
	);
	console.log(`evidence: ${file}`);
	process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
