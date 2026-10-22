#!/usr/bin/env node
/**
 * Self-test for `verify-desktop-feed.mjs`.
 *
 *   node scripts/desktop-feed-contract.mjs
 *
 * `electron-updater` trusts the yml blindly, so the verifier is the only thing standing between a
 * broken build and every installed client downloading 150 MB that fails its own hash check. A gate
 * that has never been observed to *fail* is not a gate — this script proves all three of its
 * refusals by constructing the exact artefacts it is supposed to reject:
 *
 *   1. a correct pair (random bytes as the archive) → exit 0
 *   2. a sha512 that does not match               → exit 1, mentions sha512
 *   3. a referenced archive that is missing       → exit 1, mentions the file
 *
 * Hermetic: no network, no real build, runs in well under a second.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = resolve(HERE, "verify-desktop-feed.mjs");
const pkg = JSON.parse(readFileSync(resolve(HERE, "../package.json"), "utf8"));

const ARTIFACT = `${pkg.productName}-${pkg.version}-arm64-mac.zip`;

const failures = [];
function check(name, condition, detail) {
	console.log(
		`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
	);
	if (!condition) failures.push(name);
}

function runVerifier(dir) {
	const result = spawnSync(process.execPath, [VERIFIER, "--dir", dir], {
		encoding: "utf8",
	});
	return {
		status: result.status,
		output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
	};
}

/** Build a directory with an archive + matching yml; `sha512` can be overridden to corrupt it. */
function makeFixture(
	root,
	{ sha512, referenced = ARTIFACT, writeArtifact = true } = {},
) {
	const bytes = randomBytes(2048);
	const digest = sha512 ?? createHash("sha512").update(bytes).digest("base64");
	if (writeArtifact) writeFileSync(join(root, referenced), bytes);
	writeFileSync(
		join(root, "latest-mac.yml"),
		[
			`version: ${pkg.version}`,
			`files:`,
			`  - url: ${referenced}`,
			`    sha512: ${digest}`,
			`    size: ${bytes.length}`,
			`path: ${referenced}`,
			`sha512: ${digest}`,
			`releaseDate: '2026-01-01T00:00:00.000Z'`,
			"",
		].join("\n"),
	);
}

const root = mkdtempSync(join(tmpdir(), "desktop-feed-contract-"));

try {
	const good = join(root, "good");
	const badHash = join(root, "bad-hash");
	const missing = join(root, "missing-artifact");
	for (const dir of [good, badHash, missing]) {
		mkdirSync(dir, { recursive: true });
	}
	makeFixture(good);
	makeFixture(badHash, {
		sha512: createHash("sha512").update("not-the-archive").digest("base64"),
	});
	makeFixture(missing, { writeArtifact: false });

	const ok = runVerifier(good);
	check(
		"accepts a matching yml + archive",
		ok.status === 0,
		ok.output.trim().split("\n").at(-1),
	);

	const corrupt = runVerifier(badHash);
	check(
		"rejects a sha512 mismatch",
		corrupt.status !== 0 && /sha512/i.test(corrupt.output),
		corrupt.output
			.trim()
			.split("\n")
			.find((l) => /sha512/i.test(l)),
	);

	const absent = runVerifier(missing);
	check(
		"rejects a missing referenced archive",
		absent.status !== 0 && absent.output.includes(ARTIFACT),
		absent.output
			.trim()
			.split("\n")
			.find((l) => l.includes(ARTIFACT)),
	);

	// The version pin is the third leg: a yml built from a different package.json would ship an
	// update whose manifest disagrees with the app it installs.
	const wrongVersion = join(root, "wrong-version");
	mkdirSync(wrongVersion, { recursive: true });
	makeFixture(wrongVersion);
	const yml = readFileSync(
		join(wrongVersion, "latest-mac.yml"),
		"utf8",
	).replace(`version: ${pkg.version}`, "version: 0.0.0-other");
	writeFileSync(join(wrongVersion, "latest-mac.yml"), yml);
	const mismatch = runVerifier(wrongVersion);
	check(
		"rejects a version that differs from package.json",
		mismatch.status !== 0 && /version/i.test(mismatch.output),
		mismatch.output
			.trim()
			.split("\n")
			.find((l) => /version/i.test(l)),
	);

	// A directory with no yml at all must fail rather than pass vacuously.
	const empty = join(root, "empty");
	mkdirSync(empty, { recursive: true });
	const nothing = runVerifier(empty);
	check(
		"rejects a directory with no feed metadata",
		nothing.status !== 0,
		nothing.output.trim().split("\n").at(-1),
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(
	failures.length === 0
		? "\ndesktop feed contract OK"
		: `\n${failures.length} check(s) failed`,
);
process.exit(failures.length === 0 ? 0 : 1);
