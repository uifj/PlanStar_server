import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the electron `app` module so `buildAboutSnapshot` does not blow up outside an Electron
// runtime. The mock is deliberately minimal: only the fields the function reads.
vi.mock("electron", () => ({
	app: {
		name: "Anytype Harness",
		getVersion: () => "0.0.0-test",
		isPackaged: false,
		getLocale: () => "en-US",
	},
	shell: { showItemInFolder: () => undefined },
}));

import { __test__, buildAboutSnapshot, redactText } from "../exportLogs";

const { isSensitiveKey, REDACTED_PLACEHOLDER } = __test__;

describe("exportLogs", () => {
	describe("redactText", () => {
		it("redacts Bearer tokens", () => {
			const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig";
			const output = redactText(input);
			expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
			expect(output).toContain(REDACTED_PLACEHOLDER);
		});

		it("redacts Basic auth", () => {
			const input = "header Basic dXNlcjpwYXNz== end";
			expect(redactText(input)).toContain(REDACTED_PLACEHOLDER);
			expect(redactText(input)).not.toContain("dXNlcjpwYXNz");
		});

		it("redacts standalone JWTs", () => {
			const jwt =
				"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnopqrstuv";
			expect(redactText(`token=${jwt}`)).toContain(REDACTED_PLACEHOLDER);
		});

		it("redacts JSON password fields", () => {
			const input = '{"username":"alice","password":"hunter2"}';
			const output = redactText(input);
			expect(output).not.toContain("hunter2");
			expect(output).toContain(REDACTED_PLACEHOLDER);
			expect(output).toContain("alice");
		});

		it("redacts logfmt token fields", () => {
			const input = "level=info api_key=abc123 msg=hello";
			const output = redactText(input);
			expect(output).not.toContain("abc123");
			expect(output).toContain(REDACTED_PLACEHOLDER);
		});

		it("preserves whitelisted keys", () => {
			expect(isSensitiveKey("input_tokens")).toBe(false);
			expect(isSensitiveKey("output_tokens")).toBe(false);
			expect(isSensitiveKey("author")).toBe(false);
			expect(isSensitiveKey("authority")).toBe(false);
			expect(isSensitiveKey("sessionStorage")).toBe(false);
		});

		it("flags genuinely sensitive keys", () => {
			expect(isSensitiveKey("password")).toBe(true);
			expect(isSensitiveKey("api_key")).toBe(true);
			expect(isSensitiveKey("secret")).toBe(true);
			expect(isSensitiveKey("auth_token")).toBe(true);
			expect(isSensitiveKey("cookie")).toBe(true);
		});

		it("leaves benign content untouched", () => {
			const input = "[2025-06-15] [info] [main] boot complete in 230ms";
			expect(redactText(input)).toBe(input);
		});
	});

	describe("buildAboutSnapshot", () => {
		it("includes the expected shape", () => {
			// `app` is not available in a pure-node test; the function reads from the electron
			// `app` module which will be undefined here. We only assert the non-electron fields.
			const now = new Date("2025-06-15T12:00:00Z");
			const snapshot = buildAboutSnapshot(now) as Record<string, unknown>;
			expect(snapshot).toHaveProperty("platform");
			expect(snapshot).toHaveProperty("arch");
			expect(snapshot).toHaveProperty("node");
			expect(snapshot.generatedAt).toBe(now.toISOString());
		});
	});

	describe("collectFiles", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "export-logs-test-"));
			mkdirSync(join(dir, "logs"), { recursive: true });
		});
		afterEach(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		it("returns an empty list when the log dir is missing", () => {
			const { collectFiles } = __test__;
			const empty = mkdtempSync(join(tmpdir(), "export-logs-empty-"));
			const result = collectFiles({ userDataDir: empty, now: new Date() });
			// about.json is always present.
			expect(
				result.some(
					(f: { archivePath: string }) => f.archivePath === "about.json",
				),
			).toBe(true);
			rmSync(empty, { recursive: true, force: true });
		});

		it("picks up .log files and redacts them", () => {
			const { collectFiles } = __test__;
			writeFileSync(join(dir, "logs", "2025-06-15.log"), "token=secret123");
			const result = collectFiles({ userDataDir: dir, now: new Date() });
			const log = result.find(
				(f: { archivePath: string }) => f.archivePath === "logs/2025-06-15.log",
			);
			expect(log).toBeDefined();
			expect(log!.data.toString("utf8")).not.toContain("secret123");
			expect(log!.data.toString("utf8")).toContain(REDACTED_PLACEHOLDER);
		});
	});
});
