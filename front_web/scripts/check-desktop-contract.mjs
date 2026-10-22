#!/usr/bin/env node
/**
 * Desktop IPC contract check.
 *
 * `check-desktop-mock-parity.mjs` proves the *renderer* side of the bridge has a handler. This
 * script proves the other direction — that a channel name has an owner on the main-process side —
 * and covers the two failure modes a type checker cannot see:
 *
 *  1. `PlatformChannels.<Key>` referenced in `electron/**` but not declared in `channels.ts`.
 *     (TypeScript catches this today; the scan is a cheap guard against a `.ts` file that is
 *     compiled but not type-checked, and against string channels reintroduced by hand.)
 *  2. A declared channel with no registration:
 *       - `desktop-invoke:*` → `ipcMain.handle(PlatformChannels.<Key>`
 *       - `desktop-send:*`   → `ipcMain.on(PlatformChannels.<Key>`
 *       - `desktop:*`        → a producer (`webContents.send`) or a consumer (`createSubscriber` /
 *                              `ipcRenderer.on`) in the preload bridge.
 *     A missing registration is a silent dead end at runtime: the renderer's `invoke` rejects, and
 *     a push never arrives, but nothing fails at build time.
 *
 * Usage: `node scripts/check-desktop-contract.mjs` (or `pnpm check:desktop-contract`).
 * Exits 0 when the contract holds, 1 with the offending channels otherwise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const channelsPath = resolve(
	repoRoot,
	"packages/desktop-shared/src/channels.ts",
);
const scannedRoot = resolve(repoRoot, "electron");
const preloadDir = resolve(repoRoot, "electron/preload");

const SKIP_DIRS = new Set(["__tests__", "node_modules", "electron-dist"]);

/** Strip block and line comments so a commented-out registration cannot satisfy the check. */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Read the `Key: "channel"` pairs out of the `PlatformChannels` literal, in declaration order. */
function readChannels(source) {
	const body = stripComments(source);
	const start = body.indexOf("export const PlatformChannels");
	if (start === -1) {
		throw new Error(
			"could not find `export const PlatformChannels` in channels.ts",
		);
	}
	const entries = [];
	const re = /\n\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]+)"\s*,/g;
	for (const match of body.slice(start).matchAll(re)) {
		entries.push({ key: match[1], value: match[2] });
	}
	if (entries.length === 0) {
		throw new Error("channels.ts declares no channels");
	}
	return entries;
}

function collectSources(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const stats = statSync(full);
		if (stats.isDirectory()) {
			if (SKIP_DIRS.has(name)) continue;
			collectSources(full, out);
			continue;
		}
		if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
		if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
		out.push(full);
	}
	return out;
}

/** Pick the registration a channel direction requires. */
function requiredPattern(direction, key) {
	const reference = `PlatformChannels\\.${key}\\b`;
	if (direction === "desktop-invoke") {
		return {
			label: "ipcMain.handle(...)",
			re: new RegExp(`ipcMain\\.handle\\(\\s*${reference}`, "g"),
		};
	}
	if (direction === "desktop-send") {
		return {
			label: "ipcMain.on(...)",
			re: new RegExp(`ipcMain\\.on\\(\\s*${reference}`, "g"),
		};
	}
	return {
		label:
			"a producer (webContents.send) or consumer (createSubscriber/ipcRenderer.on)",
		re: new RegExp(
			`(?:createSubscriber(?:<[^>]*>)?\\(\\s*|ipcRenderer\\.on\\(\\s*|\\.send\\(\\s*)${reference}`,
			"g",
		),
	};
}

function directionOf(value) {
	const prefix = value.split(":")[0];
	if (
		prefix === "desktop" ||
		prefix === "desktop-invoke" ||
		prefix === "desktop-send"
	) {
		return prefix;
	}
	return null;
}

function main() {
	const channels = readChannels(readFileSync(channelsPath, "utf8"));
	const knownKeys = new Set(channels.map((entry) => entry.key));

	const files = collectSources(scannedRoot);
	const sources = files.map((file) => ({
		file,
		// The preload is a renderer-side consumer, not a main-process owner: exclude it from the
		// "is there a registration?" scan so `ipcRenderer.on` cannot stand in for `ipcMain.handle`.
		isMain: !file.startsWith(`${preloadDir}/`),
		code: stripComments(readFileSync(file, "utf8")),
	}));
	const mainCode = sources
		.filter((entry) => entry.isMain)
		.map((entry) => entry.code)
		.join("\n");
	const allCode = sources.map((entry) => entry.code).join("\n");

	const problems = [];

	// Rule 1: every referenced key is declared.
	const referenceRe = /PlatformChannels\.([A-Za-z_][A-Za-z0-9_]*)/g;
	for (const { file, code } of sources) {
		for (const match of code.matchAll(referenceRe)) {
			const key = match[1];
			if (knownKeys.has(key)) continue;
			const line = code.slice(0, match.index).split("\n").length;
			problems.push(
				`${relative(repoRoot, file)}:${line} references undeclared PlatformChannels.${key}`,
			);
		}
	}

	// Rule 2: every declared channel has an owner for its direction.
	for (const { key, value } of channels) {
		const direction = directionOf(value);
		if (!direction) {
			problems.push(
				`channels.ts: ${key} ("${value}") has an unknown direction prefix`,
			);
			continue;
		}
		const haystack = direction === "desktop" ? allCode : mainCode;
		const { re, label } = requiredPattern(direction, key);
		re.lastIndex = 0;
		if (!re.test(haystack)) {
			problems.push(`channels.ts: ${key} ("${value}") has no ${label}`);
		}
	}

	// A declared channel nobody talks about is dead weight, but not an error: the preload may
	// legitimately expose a subscription the renderer has not adopted yet. Reported as a note.
	const unused = channels.filter(({ key }) => {
		const re = new RegExp(`PlatformChannels\\.${key}\\b`, "g");
		return (allCode.match(re) ?? []).length === 0;
	});

	if (problems.length > 0) {
		console.error("✗ desktop IPC contract FAILED");
		for (const problem of problems) {
			console.error(`    - ${problem}`);
		}
		console.error("");
		console.error(
			"  A channel with no owner resolves to a rejected invoke or a push that never arrives.",
		);
		process.exit(1);
	}

	const counts = { "desktop-invoke": 0, "desktop-send": 0, desktop: 0 };
	for (const { value } of channels) {
		const direction = directionOf(value);
		if (direction) counts[direction] += 1;
	}
	console.log(
		`✓ desktop IPC contract OK (${counts["desktop-invoke"]} invoke, ${counts["desktop-send"]} send, ${counts.desktop} push)`,
	);
	if (unused.length > 0) {
		console.log(
			`  note: declared but unreferenced: ${unused.map((entry) => entry.key).join(", ")}`,
		);
	}
	process.exit(0);
}

main();
