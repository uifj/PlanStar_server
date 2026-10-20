#!/usr/bin/env node
/**
 * Desktop mock parity check.
 *
 * Asserts that every method exposed by `electron/preload/bridge.ts` on `window.Desktop` has a
 * corresponding handler in `src/ts/lib/web/electronMock.ts`. A missing handler means a renderer
 * call that works in the Electron shell silently returns `null` in the browser — the exact class
 * of bug this script exists to catch.
 *
 * Usage: `node scripts/check-desktop-mock-parity.mjs` (or `pnpm check:desktop-parity`).
 * Exits 0 when parity holds, 1 with a diff listing when it does not.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const BRIDGE_PATH = resolve(repoRoot, "electron/preload/bridge.ts");
const MOCK_PATH = resolve(repoRoot, "src/ts/lib/web/electronMock.ts");

/**
 * Extract method names from the `desktopBridge` object literal in `bridge.ts`. We look for the
 * `export const desktopBridge: DesktopBridge = { ... };` block and pull every top-level key that
 * is followed by `(` or `:`.
 */
function extractBridgeMethods(source) {
	const start = source.indexOf("export const desktopBridge");
	if (start === -1) {
		throw new Error("could not find `export const desktopBridge` in bridge.ts");
	}
	const braceStart = source.indexOf("{", start);
	let depth = 0;
	let end = -1;
	for (let i = braceStart; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end === -1) {
		throw new Error("unbalanced braces in desktopBridge literal");
	}
	const body = source.slice(braceStart + 1, end);

	const methods = new Set();
	// Match `name(...)` or `name: function` or `name: (` at the top level of the literal.
	// We only care about the first nesting level, so strip nested blocks first.
	const stripped = stripNestedBlocks(body);
	const re = /(?:^|[\n,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/g;
	for (const match of stripped.matchAll(re)) {
		const name = match[1];
		// Skip TypeScript-only constructs that are not runtime methods.
		if (["readonly", "get", "set", "async"].includes(name)) continue;
		methods.add(name);
	}
	return methods;
}

function stripNestedBlocks(source) {
	let out = "";
	let depth = 0;
	for (const ch of source) {
		if (ch === "{" || ch === "(" || ch === "[") {
			depth += 1;
			if (depth === 1) out += ch;
		} else if (ch === "}" || ch === ")" || ch === "]") {
			depth -= 1;
			if (depth === 0) out += ch;
		} else if (depth === 0) {
			out += ch;
		}
	}
	return out;
}

/**
 * Extract handler names registered via `handlers.set("name", ...)` in `electronMock.ts`.
 */
function extractMockHandlers(source) {
	const handlers = new Set();
	const re = /handlers\.set\(\s*["']([A-Za-z0-9_]+)["']/g;
	for (const match of source.matchAll(re)) {
		handlers.add(match[1]);
	}
	return handlers;
}

/**
 * Methods that are identity properties rather than callable methods; the mock exposes them as
 * plain fields, not `handlers.set` entries.
 */
const IDENTITY_PROPS = new Set([
	"isDesktop",
	"platform",
	"electronVersion",
	"chromeVersion",
]);

function main() {
	const bridgeSource = readFileSync(BRIDGE_PATH, "utf8");
	const mockSource = readFileSync(MOCK_PATH, "utf8");

	const bridgeMethods = extractBridgeMethods(bridgeSource);
	const mockHandlers = extractMockHandlers(mockSource);

	const missing = [];
	for (const method of bridgeMethods) {
		if (IDENTITY_PROPS.has(method)) continue;
		if (!mockHandlers.has(method)) {
			missing.push(method);
		}
	}

	if (missing.length === 0) {
		console.log(
			`✓ desktop mock parity OK (${bridgeMethods.size - IDENTITY_PROPS.size} methods)`,
		);
		process.exit(0);
	}

	console.error("✗ desktop mock parity FAILED");
	console.error(
		"  The following window.Desktop methods have no handler in electronMock.ts:",
	);
	for (const name of missing.sort()) {
		console.error(`    - ${name}`);
	}
	console.error("");
	console.error(
		'  Add a `handlers.set("<name>", ...)` entry in electronMock.ts so the Web',
	);
	console.error(
		"  build does not silently return null when the renderer calls the method.",
	);
	process.exit(1);
}

main();
